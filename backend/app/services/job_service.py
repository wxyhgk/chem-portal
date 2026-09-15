import time
import uuid
import sqlite3
import subprocess
import tempfile
import os
import queue
import threading
from pathlib import Path

from ..db.session import get_connection, ensure_progress_columns
from ..core.config import XTB_BIN, REDIS_URL, XTB_TIMEOUT, PSI4_TIMEOUT, RESULT_LOG_LIMIT, RESULT_XYZ_LIMIT, MAX_JOBS_LIST, JOB_CONCURRENCY, truncate_xyz_at_frame_boundary
DISPATCH_POLL_INTERVAL = 1.0  # 调度器轮询间隔（秒）
PROGRESS_PUSH_EVERY = 2.0  # 运行中落库节流（秒）
PROGRESS_XYZ_LIMIT = 100000  # SSE/DB 进度轨迹上限（小于终值 200000）
PROGRESS_LIVE_LINES = 5000  # 内存 live 缓冲行数上限
_XTB_ENERGY_RE = None
_PSI_ENERGY_RE = None
_progress_ensured = False


def _ensure_progress():
    global _progress_ensured
    if _progress_ensured:
        return
    ensure_progress_columns()
    _progress_ensured = True


def _energy_res():
    import re
    global _XTB_ENERGY_RE, _PSI_ENERGY_RE
    if _XTB_ENERGY_RE is None:
        # xtb opt 迭代表：序号 E dE(sci) ...（占据数表第三列非科学计数，不会误配）
        _XTB_ENERGY_RE = re.compile(r"^\s*\d+\s+(-?\d+\.\d+)\s+-?\d+\.\d+[Ee][+-]?\d+")
        _PSI_ENERGY_RE = re.compile(r"Total Energy\s*=\s*(-?\d+\.\d+)")
    return _XTB_ENERGY_RE, _PSI_ENERGY_RE


def _parse_xtb_energy(line: str):
    rx, _ = _energy_res()
    m = rx.match(line)
    if not m:
        return None
    try:
        return float(m.group(1))
    except Exception:
        return None


def _parse_psi_energy(text: str):
    _, rx = _energy_res()
    ms = rx.findall(text)
    if not ms:
        return None
    try:
        return float(ms[-1])
    except Exception:
        return None


def _push_progress(job_id: str, energy=None, xyz=None, log=None):
    """自建短连接写进度（调用线程安全，watcher 线程亦可调）"""
    sets, vals = [], []
    if energy is not None:
        sets.append("progress_energy=?")
        vals.append(energy)
    if xyz is not None:
        sets.append("progress_xyz=?")
        vals.append(xyz[:PROGRESS_XYZ_LIMIT])
    if log is not None:
        sets.append("result_log=?")
        vals.append(log[-RESULT_LOG_LIMIT:])
    if not sets:
        return
    con2 = get_connection()
    try:
        con2.execute(f"UPDATE jobs SET {','.join(sets)} WHERE id=?", (*vals, job_id))
        con2.commit()
    finally:
        con2.close()


def _read_opt_xyz(td, task):
    if task != "opt":
        return None
    for name in ("xtbopt.xyz", "xtbopt.log"):
        p = Path(td) / name
        if p.exists():
            try:
                t = p.read_text()
                if len(t.strip()) > 10:
                    return truncate_xyz_at_frame_boundary(t, PROGRESS_XYZ_LIMIT)
            except Exception:
                pass
    return None

# normalize 兼容 shared
try:
    from ..schemas.job import normalize_job_row
except Exception:
    def normalize_job_row(r): return r


def _enqueue_redis(job_id: str) -> bool:
    if not REDIS_URL:
        return False
    try:
        import redis
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.rpush("chem:jobs", job_id)
        return True
    except Exception as e:
        print(f"[job_service] redis enqueue failed {e}, fallback to BackgroundTasks")
        return False


_CANCELS: dict = {}
_CANCEL_LOCK = threading.Lock()


def request_cancel(job_id: str):
    with _CANCEL_LOCK:
        _CANCELS[job_id] = time.time()


def is_cancelled(job_id: str) -> bool:
    with _CANCEL_LOCK:
        t = _CANCELS.get(job_id)
        if t is None:
            return False
        if time.time() - t > 7200:
            _CANCELS.pop(job_id, None)
            return False
        return True


def _collect_stream(proc, timeout, on_output=None, is_cancelled=None):
    """流式收子进程输出：调用线程触发 on_output，超时/取消则 kill。返回 (lines, timed_out, cancelled)。"""
    q: queue.Queue = queue.Queue()
    def _reader():
        try:
            for line in proc.stdout:
                q.put(line)
        finally:
            q.put(None)
    threading.Thread(target=_reader, daemon=True).start()
    lines: list = []
    deadline = time.time() + timeout
    timed_out = False
    cancelled = False
    while True:
        if is_cancelled is not None and is_cancelled():
            cancelled = True
            break
        wait = deadline - time.time()
        if wait <= 0:
            timed_out = True
            break
        try:
            item = q.get(timeout=min(wait, 0.5))
        except queue.Empty:
            continue
        if item is None:
            break
        line = item if isinstance(item, str) else item.decode(errors="replace")
        line = line.rstrip("\n")
        lines.append(line)
        if on_output:
            on_output(line)
    if timed_out or cancelled:
        try:
            proc.kill()
        except Exception:
            pass
    try:
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    return lines, timed_out, cancelled



def run_job(job_id: str):
    _ensure_progress()
    con = get_connection()
    row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    if not row:
        con.close()
        return
    row_dict = normalize_job_row(dict(row))
    if is_cancelled(job_id):
        con.execute("UPDATE jobs SET status='cancelled', result_log=? WHERE id=?", ("[CANCELLED by user before start]", job_id))
        con.commit()
        con.close()
        return
    con.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
    con.commit()
    xyz = row_dict.get("input_xyz") or row_dict.get("xyz")
    threads = row_dict.get("threads", 8) or 8
    task = row_dict.get("task") or "sp"
    charge = row_dict.get("charge", 0) or 0
    method = (row_dict.get("method") or "gfn2").lower()
    psi_method = row_dict.get("psi_method") or "b3lyp"
    psi_basis = row_dict.get("psi_basis") or "def2-SVP"
    multiplicity = row_dict.get("multiplicity") or 1
    t0 = time.time()
    # psi4 分支
    if method == "psi4":
        try:
            # 复用 worker 执行器，避免代码重复
            import sys
            sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
            from worker.executors.psi4 import run_psi4 as psi4_run
            live: list = []
            last_push = [t0]
            live_lock = threading.Lock()
            def _on_line(line: str):
                with live_lock:
                    live.append(line)
                    if len(live) > PROGRESS_LIVE_LINES:
                        del live[:PROGRESS_LIVE_LINES // 2]
                    now = time.time()
                    if now - last_push[0] >= PROGRESS_PUSH_EVERY:
                        last_push[0] = now
                        _push_progress(job_id, log="\n".join(live))
            def _on_progress(energy=None, xyz=None):
                _push_progress(job_id, energy=energy, xyz=xyz)
            r = psi4_run(xyz or "", charge=charge, multiplicity=multiplicity, threads=threads, task=task, psi_method=psi_method, psi_basis=psi_basis, timeout=PSI4_TIMEOUT, on_output=_on_line, on_progress=_on_progress, is_cancelled=lambda: is_cancelled(job_id))
            if r.returncode == -2:
                wall = time.time() - t0
                con.execute("UPDATE jobs SET status='cancelled', result_log=?, wall_time=? WHERE id=?", (r.log[:RESULT_LOG_LIMIT], wall, job_id))
                con.commit()
                return
            status = "done" if r.success else "failed"
            con.execute(
                "UPDATE jobs SET status=?, result_energy=?, result_log=?, result_xyz=?, wall_time=? WHERE id=?",
                (status, r.energy, r.log[:RESULT_LOG_LIMIT], r.result_xyz, r.wall_time, job_id),
            )
            con.commit()
        except Exception as e:
            import traceback
            wall = time.time() - t0
            con.execute("UPDATE jobs SET status='failed', result_log=?, wall_time=? WHERE id=?", (f"psi4 error: {e}\n{traceback.format_exc()}"[:RESULT_LOG_LIMIT], wall, job_id))
            con.commit()
        finally:
            con.close()
        return
    # UFF 分支（RDKit 全元素力场；无子进程，取消靠轮次检查）
    if method == "uff":
        try:
            import sys
            sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
            from worker.executors.uff import run_uff as uff_run
            live: list = []
            last_push = [t0]
            live_lock = threading.Lock()
            def _on_line(line: str):
                with live_lock:
                    live.append(line)
                    if len(live) > PROGRESS_LIVE_LINES:
                        del live[:PROGRESS_LIVE_LINES // 2]
                    now = time.time()
                    if now - last_push[0] >= PROGRESS_PUSH_EVERY:
                        last_push[0] = now
                        _push_progress(job_id, log="\n".join(live))
            def _on_progress(energy=None, xyz=None):
                _push_progress(job_id, energy=energy, xyz=xyz)
            r = uff_run(xyz or "", charge=charge, task=task, on_output=_on_line, on_progress=_on_progress, is_cancelled=lambda: is_cancelled(job_id))
            if is_cancelled(job_id):
                wall = time.time() - t0
                con.execute("UPDATE jobs SET status='cancelled', result_log=?, wall_time=? WHERE id=?", ((r.log + "\n[CANCELLED by user]")[:RESULT_LOG_LIMIT], wall, job_id))
                con.commit()
                return
            status = "done" if r.success else "failed"
            con.execute(
                "UPDATE jobs SET status=?, result_energy=?, result_log=?, result_xyz=?, wall_time=? WHERE id=?",
                (status, r.energy, r.log[:RESULT_LOG_LIMIT], r.result_xyz, r.wall_time, job_id),
            )
            con.commit()
        except Exception as e:
            import traceback
            wall = time.time() - t0
            con.execute("UPDATE jobs SET status='failed', result_log=?, wall_time=? WHERE id=?", (f"uff error: {e}\n{traceback.format_exc()}"[:RESULT_LOG_LIMIT], wall, job_id))
            con.commit()
        finally:
            con.close()
        return
    try:
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "input.xyz"
            p.write_text(xyz or "")
            if task == "opt":
                cmd = [XTB_BIN, str(p), "--opt", "--chrg", str(charge)]
            else:
                cmd = [XTB_BIN, str(p), "--sp", "--chrg", str(charge)]
            env = os.environ.copy()
            env["OMP_NUM_THREADS"] = str(threads)
            env["MKL_NUM_THREADS"] = str(threads)
            proc = subprocess.Popen(cmd, cwd=td, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)
            live = []
            last_push = [t0]
            last_energy: list = []
            def _on_line(line: str):
                live.append(line)
                if len(live) > PROGRESS_LIVE_LINES:
                    del live[:PROGRESS_LIVE_LINES // 2]
                e = _parse_xtb_energy(line)
                if e is not None:
                    last_energy[:] = [e]
                now = time.time()
                if now - last_push[0] >= PROGRESS_PUSH_EVERY:
                    last_push[0] = now
                    _push_progress(job_id, energy=last_energy[0] if last_energy else None, xyz=_read_opt_xyz(td, task), log="\n".join(live))
            lines, timed_out, cancelled = _collect_stream(proc, XTB_TIMEOUT, _on_line, lambda: is_cancelled(job_id))
            out = "\n".join(lines)
            if cancelled:
                wall = time.time() - t0
                con.execute("UPDATE jobs SET status='cancelled', result_log=?, wall_time=? WHERE id=?", ((out + "\n[CANCELLED by user]")[:RESULT_LOG_LIMIT], wall, job_id))
                con.commit()
                return
            if timed_out:
                # 超时被 kill：标失败（此前误落 done 且无能量）；保留日志尾部便于看跑到哪一步
                wall = time.time() - t0
                marker = f"\n[TIMEOUT {XTB_TIMEOUT}s] xtb 未在时限内结束，已终止（可调 XTB_TIMEOUT）"
                con.execute("UPDATE jobs SET status='failed', result_log=?, wall_time=? WHERE id=?", (out[-(RESULT_LOG_LIMIT - len(marker)):] + marker, wall, job_id))
                con.commit()
                return
            energy = None
            for line in out.splitlines():
                if "TOTAL ENERGY" in line:
                    try:
                        energy = float(line.split()[-3])
                    except Exception:
                        pass
            result_xyz = None
            opt_log = Path(td) / "xtbopt.log"
            opt_xyz = Path(td) / "xtbopt.xyz"
            if task == "opt" and opt_log.exists():
                try:
                    result_xyz = truncate_xyz_at_frame_boundary(opt_log.read_text(), RESULT_XYZ_LIMIT)
                except Exception:
                    pass
            elif opt_xyz.exists():
                try:
                    result_xyz = truncate_xyz_at_frame_boundary(opt_xyz.read_text(), RESULT_XYZ_LIMIT)
                except Exception:
                    pass
            wall = time.time() - t0
            # xtb 异常退出或没解析出能量不算完成
            status = "done" if proc.returncode == 0 and energy is not None else "failed"
            con.execute(
                "UPDATE jobs SET status=?, result_energy=?, result_log=?, result_xyz=?, wall_time=? WHERE id=?",
                (status, energy, out[:RESULT_LOG_LIMIT], result_xyz, wall, job_id),
            )
            con.commit()
    except Exception as e:
        wall = time.time() - t0
        con.execute("UPDATE jobs SET status='failed', result_log=?, wall_time=? WHERE id=?", (str(e)[:RESULT_LOG_LIMIT], wall, job_id))
        con.commit()
    finally:
        con.close()


def _insert_job(con, job, batch_id=None) -> str:
    """插入一行 queued 任务（不 commit），返回 job id"""
    jid = uuid.uuid4().hex[:12]
    # 兼容部分旧调用未传 psi 字段
    psi_method = getattr(job, "psi_method", None) or "b3lyp"
    psi_basis = getattr(job, "psi_basis", None) or "def2-SVP"
    multiplicity = getattr(job, "multiplicity", None) or 1
    name = (getattr(job, "name", None) or "").strip()[:200] or None
    try:
        con.execute(
            "INSERT INTO jobs (id,status,method,charge,threads,input_xyz,task,psi_method,psi_basis,multiplicity,name,batch_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (jid, "queued", job.method, job.charge, job.threads, job.xyz, job.task, psi_method, psi_basis, multiplicity, name, batch_id),
        )
    except sqlite3.OperationalError:
        # 批量依赖 batch_id 列，旧表不回退
        if batch_id:
            raise
        # 回退旧表
        try:
            con.execute(
                "INSERT INTO jobs (id,status,method,charge,threads,input_xyz,task) VALUES (?,?,?,?,?,?,?)",
                (jid, "queued", job.method, job.charge, job.threads, job.xyz, job.task),
            )
        except sqlite3.OperationalError:
            con.execute(
                "INSERT INTO jobs (id,status,method,charge,threads,xyz,task) VALUES (?,?,?,?,?,?,?)",
                (jid, "queued", job.method, job.charge, job.threads, job.xyz, job.task),
            )
    return jid


def create_job(job) -> str:
    """插入 DB 并尝试推 Redis，返回 job id。是否走 BackgroundTasks 由 router 决定。"""
    _ensure_progress()
    con = get_connection()
    try:
        jid = _insert_job(con, job)
        con.commit()
    finally:
        con.close()
    return jid


def create_batch(jobs) -> tuple:
    """批量入队：同一事务插入，状态 queued，由调度器按 JOB_CONCURRENCY 拉取。返回 (batch_id, ids)"""
    _ensure_progress()
    batch_id = "b" + uuid.uuid4().hex[:11]
    con = get_connection()
    try:
        ids = [_insert_job(con, j, batch_id) for j in jobs]
        con.commit()
    finally:
        con.close()
    return batch_id, ids


_LIST_COLS = "id,status,method,charge,threads,task,created_at,result_energy,wall_time"


def list_jobs(limit: int = MAX_JOBS_LIST, show_deleted: bool = False, batch_id: str = None):
    con = get_connection()
    where = ["deleted=1" if show_deleted else "COALESCE(deleted,0)=0"]
    args: list = []
    if batch_id:
        where.append("batch_id=?")
        args.append(batch_id)
    try:
        rows = con.execute(
            f"SELECT {_LIST_COLS},name,batch_id FROM jobs WHERE {' AND '.join(where)} ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
    except sqlite3.OperationalError:
        rows = con.execute(
            f"SELECT {_LIST_COLS} FROM jobs ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def list_batches(limit: int = 30):
    """最近批次汇总（排除回收站中的任务）"""
    con = get_connection()
    try:
        rows = con.execute(
            "SELECT batch_id, MIN(created_at) AS created_at, COUNT(*) AS total,"
            " SUM(status='queued') AS queued, SUM(status='running') AS running, SUM(status='done') AS done,"
            " SUM(status='failed') AS failed, SUM(status='cancelled') AS cancelled,"
            " MIN(method) AS method, MIN(task) AS task"
            " FROM jobs WHERE batch_id IS NOT NULL AND COALESCE(deleted,0)=0"
            " GROUP BY batch_id ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    finally:
        con.close()
    return [dict(r) for r in rows]


def _cancel_if_queued(jid: str):
    """排队中直接落 cancelled（批量任务可能长时间排队，不等调度器）；已开跑的由 run_job 的取消标记处理"""
    con = get_connection()
    try:
        con.execute("UPDATE jobs SET status='cancelled', result_log=? WHERE id=? AND status='queued'", ("[CANCELLED by user before start]", jid))
        con.commit()
    finally:
        con.close()


def cancel_job(jid: str) -> str:
    """运行中/排队任务请求取消；返回最终语义：cancelled(已受理) / done / failed / not-found"""
    con = get_connection()
    row = con.execute("SELECT status FROM jobs WHERE id=?", (jid,)).fetchone()
    con.close()
    if not row:
        return "not-found"
    if row["status"] in ("done", "failed", "cancelled"):
        return row["status"]
    request_cancel(jid)
    _cancel_if_queued(jid)
    return "cancelled"


def remove_job(jid: str, hard: bool = False) -> str:
    """软删进回收站（运行中先取消）；hard=1 物理删除。返回 ok / not-found"""
    con = get_connection()
    row = con.execute("SELECT status FROM jobs WHERE id=?", (jid,)).fetchone()
    if not row:
        con.close()
        return "not-found"
    if hard:
        con.execute("DELETE FROM jobs WHERE id=?", (jid,))
    else:
        if row["status"] in ("queued", "running"):
            request_cancel(jid)
            _cancel_if_queued(jid)
        try:
            con.execute("UPDATE jobs SET deleted=1 WHERE id=?", (jid,))
        except sqlite3.OperationalError:
            con.close()
            return "not-found"
    con.commit()
    con.close()
    return "ok"


def restore_job(jid: str) -> str:
    con = get_connection()
    try:
        cur = con.execute("UPDATE jobs SET deleted=0 WHERE id=?", (jid,))
        con.commit()
        ok = cur.rowcount > 0
    except sqlite3.OperationalError:
        ok = False
    con.close()
    return "ok" if ok else "not-found"


def clear_jobs(statuses) -> int:
    """一键清理终态任务（软删）。返回清理数。"""
    allowed = {"done", "failed", "cancelled"}
    want = [s for s in (statuses or []) if s in allowed]
    if not want:
        return 0
    con = get_connection()
    try:
        cur = con.execute(f"UPDATE jobs SET deleted=1 WHERE status IN ({','.join('?' * len(want))}) AND COALESCE(deleted,0)=0", (*want,))
        con.commit()
        n = cur.rowcount
    except sqlite3.OperationalError:
        n = 0
    con.close()
    return n


def get_job(jid: str):
    con = get_connection()
    row = con.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
    con.close()
    if not row:
        return None
    return normalize_job_row(dict(row))


_dispatcher_lock = threading.Lock()
_dispatcher_started = False


def _claim_next_job():
    """认领一个排队任务（CAS queued→running）：单个提交优先于批量，其余按提交顺序；运行中已达 JOB_CONCURRENCY 或无可认领则返回 None"""
    con = get_connection()
    try:
        running = con.execute("SELECT COUNT(*) FROM jobs WHERE status='running'").fetchone()[0]
        if running >= JOB_CONCURRENCY:
            return None
        row = con.execute(
            "SELECT id FROM jobs WHERE status='queued' AND COALESCE(deleted,0)=0 ORDER BY (batch_id IS NOT NULL), created_at, rowid LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        cur = con.execute("UPDATE jobs SET status='running' WHERE id=? AND status='queued'", (row["id"],))
        con.commit()
        return row["id"] if cur.rowcount == 1 else None
    finally:
        con.close()


def _run_claimed_job(jid: str):
    try:
        run_job(jid)
    except Exception as e:
        print(f"[dispatch] run_job crashed {jid}: {e}")
    finally:
        # 兜底：run_job 未落终态则标失败，避免永久占住并发槽
        con = get_connection()
        try:
            con.execute(
                "UPDATE jobs SET status='failed', result_log=COALESCE(result_log,'') || ? WHERE id=? AND status IN ('running','queued')",
                ("\n[dispatch] 执行异常退出", jid),
            )
            con.commit()
        finally:
            con.close()


def _dispatch_loop():
    while True:
        try:
            while (jid := _claim_next_job()) is not None:
                threading.Thread(target=_run_claimed_job, args=(jid,), name=f"job-{jid}", daemon=True).start()
        except Exception as e:
            print(f"[dispatch] dispatcher error: {e}")
        time.sleep(DISPATCH_POLL_INTERVAL)


def start_job_dispatcher():
    """API 进程启动时调用：上次进程退出时中断的任务（单个与批量都在 DB 队列里）重新排队，再起调度线程（幂等）"""
    global _dispatcher_started
    with _dispatcher_lock:
        if _dispatcher_started:
            return
        _dispatcher_started = True
    _ensure_progress()
    con = get_connection()
    try:
        n = con.execute(
            "UPDATE jobs SET status='queued', result_log=NULL, progress_energy=NULL, progress_xyz=NULL WHERE status='running'"
        ).rowcount
        con.commit()
    finally:
        con.close()
    if n:
        print(f"[dispatch] requeued {n} interrupted jobs")
    threading.Thread(target=_dispatch_loop, name="job-dispatcher", daemon=True).start()
    print(f"[dispatch] dispatcher started, concurrency={JOB_CONCURRENCY}")


__all__ = ["run_job", "create_job", "create_batch", "list_jobs", "list_batches", "get_job", "_enqueue_redis", "start_job_dispatcher"]
