"""
Chem Portal API — 解耦版
- 已移除对前端静态托管的耦合 (不再 mount frontend/)
- 前端已分离至 chem-portal-web (Next.js 14, Vercel)，通过 NEXT_PUBLIC_API_URL 调用本 API
- 通过 shared/schemas/job.py 共享 Job 契约，保证前后端类型一致
- 通过 Redis 队列与 worker 解耦 (api -> redis -> worker)，无 redis 时回退 BackgroundTasks
"""
import sqlite3, uuid, time, subprocess, tempfile, os, sys
from pathlib import Path
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware

# 共享契约优先，缺失时回退本地定义 (保证容器内仍可运行)
try:
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from shared.schemas.job import JobCreate as SharedJobCreate, normalize_job_row  # type: ignore
    from pydantic import BaseModel as _BM  # noqa
    JobIn = SharedJobCreate
except Exception:
    from pydantic import BaseModel
    class JobIn(BaseModel):  # type: ignore
        xyz: str
        method: str = "gfn2"
        charge: int = 0
        threads: int = 8
        task: str = "sp"
    def normalize_job_row(r): return r

DB = Path(__file__).parent.parent / "database" / "chem.db"
XTB = os.getenv("XTB_BIN", "/root/Software/xtb/xtb_v6.7.1/bin/xtb")
REDIS_URL = os.getenv("REDIS_URL", "")

app = FastAPI(title="Chem Portal API (decoupled)", version="2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

def db():
    con = sqlite3.connect(str(DB))
    con.row_factory = sqlite3.Row
    return con

def _enqueue_redis(job_id: str) -> bool:
    if not REDIS_URL:
        return False
    try:
        import redis
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.rpush("chem:jobs", job_id)
        return True
    except Exception as e:
        print(f"[api] redis enqueue failed {e}, fallback to BackgroundTasks")
        return False

def run_job(job_id: str):
    con = db()
    row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        con.close(); return
    row = normalize_job_row(dict(row))
    con.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
    con.commit()
    xyz = row.get("input_xyz") or row.get("xyz")
    if xyz is None:
        xyz = row.get("input_xyz")
    threads = row.get("threads", 8)
    task = row.get("task") or "sp"
    charge = row.get("charge", 0)
    t0 = time.time()
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
            proc = subprocess.run(cmd, cwd=td, capture_output=True, text=True, timeout=600, env=env)
            out = proc.stdout + "\n" + proc.stderr
            energy = None
            for line in out.splitlines():
                if "TOTAL ENERGY" in line:
                    try:
                        energy = float(line.split()[-3])
                    except: pass
            result_xyz = None
            opt_log = Path(td) / "xtbopt.log"
            opt_xyz = Path(td) / "xtbopt.xyz"
            if task == "opt" and opt_log.exists():
                try:
                    result_xyz = opt_log.read_text()[:50000]
                except: pass
            elif opt_xyz.exists():
                try:
                    result_xyz = opt_xyz.read_text()[:50000]
                except: pass
            wall = time.time() - t0
            con.execute("UPDATE jobs SET status='done', result_energy=?, result_log=?, result_xyz=?, wall_time=? WHERE id=?", (energy, out[:8000], result_xyz, wall, job_id))
            con.commit()
    except Exception as e:
        wall = time.time() - t0
        con.execute("UPDATE jobs SET status='failed', result_log=?, wall_time=? WHERE id=?", (str(e)[:8000], wall, job_id))
        con.commit()
    finally:
        con.close()

@app.post("/api/jobs")
def create_job(job: JobIn, bg: BackgroundTasks):
    jid = uuid.uuid4().hex[:12]
    con = db()
    try:
        con.execute("INSERT INTO jobs (id,status,method,charge,threads,input_xyz,task) VALUES (?,?,?,?,?,?,?)", (jid, "queued", job.method, job.charge, job.threads, job.xyz, job.task))
    except sqlite3.OperationalError:
        con.execute("INSERT INTO jobs (id,status,method,charge,threads,xyz,task) VALUES (?,?,?,?,?,?,?)", (jid, "queued", job.method, job.charge, job.threads, job.xyz, job.task))
    con.commit()
    con.close()
    # 优先推 Redis 队列，worker 消费；失败则本地 BackgroundTasks 执行 (兼容单机无 redis)
    if not _enqueue_redis(jid):
        bg.add_task(run_job, jid)
    return {"id": jid, "status": "queued"}

@app.get("/api/jobs")
def list_jobs():
    con = db()
    rows = con.execute("SELECT id,status,method,charge,threads,task,created_at,result_energy,wall_time FROM jobs ORDER BY created_at DESC LIMIT 50").fetchall()
    con.close()
    return [dict(r) for r in rows]

@app.get("/api/jobs/{jid}")
def get_job(jid: str):
    con = db()
    row = con.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
    con.close()
    if not row:
        return {"error": "not found"}
    return normalize_job_row(dict(row))

@app.get("/api/health")
def health():
    redis_ok = False
    if REDIS_URL:
        try:
            import redis
            redis.from_url(REDIS_URL).ping()
            redis_ok = True
        except: pass
    return {"ok": True, "xtb": os.path.exists(XTB), "redis": redis_ok, "decoupled": True}

# 已移除 frontend 静态托管 — 前端由 chem-portal-web (Next.js) 独立部署，配置 NEXT_PUBLIC_API_URL 指向本 API
# 原代码:
# frontend = Path(__file__).parent.parent / "frontend"
# if frontend.exists():
#     app.mount("/", StaticFiles(directory=str(frontend), html=True), name="frontend")
