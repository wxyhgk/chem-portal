"""
chem-portal worker — 通过 Redis 队列与 DB 轮询解耦执行 xtb 任务
- 优先: BLPOP redis 队列 chem:jobs (api 推入 job_id)
- 回退: 轮询 DB 中 status='queued' 的任务 (兼容无 redis 场景)
- 执行逻辑与 backend/app.py:run_job 保持一致，直接复用或独立实现
"""
import os, time, subprocess, tempfile, sqlite3, sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
SHARED_DIR = PROJECT_DIR / "shared"
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

try:
    from shared.schemas.job import normalize_job_row
except Exception:
    def normalize_job_row(r): return r

DB = Path(os.getenv("DATABASE_URL", "")) if os.getenv("DATABASE_URL","").startswith("/") else PROJECT_DIR / "database" / "chem.db"
# 若 DATABASE_URL 是 postgres:// 则仍回退到 sqlite 文件 (worker 需同时支持 postgres，可扩展)
# 此处保持与现有 SQLite 兼容，postgres 支持可后续通过 sqlalchemy/psycopg 扩展
XTB = os.getenv("XTB_BIN", "/root/Software/xtb/xtb_v6.7.1/bin/xtb")
XTB_TIMEOUT = int(os.getenv("XTB_TIMEOUT", "3600"))  # 与 backend/app/core/config.py 一致
PSI4_TIMEOUT = int(os.getenv("PSI4_TIMEOUT", "3600"))
REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")

def db_conn():
    # timeout: API 批量并发写进度时避免 "database is locked" 使 worker 崩溃
    con = sqlite3.connect(str(DB), timeout=30)
    con.row_factory = sqlite3.Row
    return con

def run_job(job_id: str):
    con = db_conn()
    row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        con.close(); return
    row = dict(row)
    row = normalize_job_row(row)
    con.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
    con.commit()
    xyz = row.get("input_xyz") or row.get("xyz")
    threads = row.get("threads", 8)
    task = row.get("task") or "sp"
    charge = row.get("charge", 0)
    method = (row.get("method") or "gfn2").lower()
    psi_method = row.get("psi_method") or "b3lyp"
    psi_basis = row.get("psi_basis") or "def2-SVP"
    multiplicity = row.get("multiplicity") or 1
    t0 = time.time()
    # psi4 分支 — 独立进程，线程限制 4 核
    if method == "psi4":
        try:
            from worker.executors.psi4 import run_psi4 as psi4_run
            r = psi4_run(xyz or "", charge=charge, multiplicity=multiplicity, threads=threads, task=task, psi_method=psi_method, psi_basis=psi_basis, timeout=PSI4_TIMEOUT)
            status = "done" if r.success else "failed"
            con.execute("UPDATE jobs SET status=?, result_energy=?, result_log=?, result_xyz=?, wall_time=? WHERE id=?",
                        (status, r.energy, r.log[:8000], r.result_xyz, r.wall_time, job_id))
            con.commit()
            print(f"[worker] psi4 {task} {psi_method}/{psi_basis} {job_id} energy={r.energy} wall={r.wall_time:.1f}s")
        except Exception as e:
            wall = time.time() - t0
            import traceback
            con.execute("UPDATE jobs SET status='failed', result_log=?, wall_time=? WHERE id=?", (f"psi4 error: {e}\n{traceback.format_exc()}"[:8000], wall, job_id))
            con.commit()
            print(f"[worker] psi4 failed {job_id}: {e}")
        finally:
            con.close()
        return
    try:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "input.xyz"
            p.write_text(xyz or "")
            if task == "opt":
                cmd = [XTB, str(p), "--opt", "--chrg", str(charge)]
            else:
                cmd = [XTB, str(p), "--sp", "--chrg", str(charge)]
            env = os.environ.copy()
            env["OMP_NUM_THREADS"] = str(threads)
            env["MKL_NUM_THREADS"] = str(threads)
            proc = subprocess.run(cmd, cwd=td, capture_output=True, text=True, timeout=XTB_TIMEOUT, env=env)
            out = proc.stdout + "\n" + proc.stderr
            energy = None
            for line in out.splitlines():
                if "TOTAL ENERGY" in line:
                    try: energy = float(line.split()[-3])
                    except: pass
            result_xyz = None
            opt_log = Path(td) / "xtbopt.log"
            opt_xyz = Path(td) / "xtbopt.xyz"
            if task == "opt" and opt_log.exists():
                try: result_xyz = opt_log.read_text()[:50000]
                except: pass
            elif opt_xyz.exists():
                try: result_xyz = opt_xyz.read_text()[:50000]
                except: pass
            wall = time.time() - t0
            con.execute("UPDATE jobs SET status='done', result_energy=?, result_log=?, result_xyz=?, wall_time=? WHERE id=?",
                        (energy, out[:8000], result_xyz, wall, job_id))
            con.commit()
            print(f"[worker] done {job_id} energy={energy} wall={wall:.1f}s")
    except Exception as e:
        wall = time.time() - t0
        try:
            con.execute("UPDATE jobs SET status='failed', result_log=?, wall_time=? WHERE id=?", (str(e)[:8000], wall, job_id))
            con.commit()
        except: pass
        print(f"[worker] failed {job_id}: {e}")
    finally:
        con.close()

def redis_loop():
    try:
        import redis
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.ping()
        print(f"[worker] connected redis {REDIS_URL}, BLPOP chem:jobs")
        while True:
            item = r.blpop("chem:jobs", timeout=5)
            if item:
                _, job_id = item
                print(f"[worker] dequeue {job_id}")
                run_job(job_id)
            else:
                # 无 redis 任务时也轮询 DB 防止遗漏
                poll_db_once()
    except Exception as e:
        print(f"[worker] redis unavailable ({e}), fallback to DB polling")
        poll_loop()

def poll_db_once():
    con = db_conn()
    try:
        # 批量任务（batch_id 非空）由 API 进程调度器限并发执行，worker 不认领
        try:
            rows = con.execute("SELECT id FROM jobs WHERE status='queued' AND batch_id IS NULL ORDER BY created_at LIMIT 1").fetchall()
        except sqlite3.OperationalError as e:
            if "no such column" not in str(e):
                raise
            rows = con.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchall()
        for r in rows:
            jid = r["id"]
            con.close()
            run_job(jid)
            return True
        return False
    finally:
        try: con.close()
        except: pass

def poll_loop():
    print("[worker] polling DB every 2s")
    while True:
        found = poll_db_once()
        time.sleep(2 if found else 2)

if __name__ == "__main__":
    # 优先 redis，若未安装 redis-py 则直接轮询
    try:
        import redis  # noqa
        redis_loop()
    except ImportError:
        print("[worker] redis-py not installed, using DB poll")
        poll_loop()
