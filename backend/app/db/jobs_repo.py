"""jobs 表的全部 SQL；其他模块不直接写 SQL"""
import uuid
from contextlib import contextmanager
from typing import Iterable, Optional

from shared.schemas.job import normalize_job_row

from .session import get_connection

TERMINAL = ("done", "failed", "cancelled")
_LIST_COLS = "id,status,method,charge,threads,task,created_at,result_energy,wall_time,name,batch_id"


@contextmanager
def _conn():
    """短连接：正常退出提交，异常时不提交（关闭即回滚）"""
    con = get_connection()
    try:
        yield con
        con.commit()
    finally:
        con.close()


# ---- 创建 ----

def _insert(con, job, batch_id: Optional[str]) -> str:
    jid = uuid.uuid4().hex[:12]
    name = (getattr(job, "name", None) or "").strip()[:200] or None
    con.execute(
        "INSERT INTO jobs (id,status,method,charge,threads,input_xyz,task,psi_method,psi_basis,multiplicity,name,batch_id)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (jid, "queued", job.method, job.charge, job.threads, job.xyz, job.task, job.psi_method, job.psi_basis, job.multiplicity, name, batch_id),
    )
    return jid


def insert_job(job) -> str:
    with _conn() as con:
        return _insert(con, job, None)


def insert_batch(jobs: Iterable) -> tuple:
    """同一事务插入整批，返回 (batch_id, ids)"""
    batch_id = "b" + uuid.uuid4().hex[:11]
    with _conn() as con:
        ids = [_insert(con, j, batch_id) for j in jobs]
    return batch_id, ids


# ---- 查询 ----

def list_jobs(limit: int, show_deleted: bool = False, batch_id: Optional[str] = None) -> list:
    where = ["deleted=1" if show_deleted else "COALESCE(deleted,0)=0"]
    args: list = []
    if batch_id:
        where.append("batch_id=?")
        args.append(batch_id)
    with _conn() as con:
        rows = con.execute(
            f"SELECT {_LIST_COLS} FROM jobs WHERE {' AND '.join(where)} ORDER BY created_at DESC, rowid DESC LIMIT ?",
            (*args, limit),
        ).fetchall()
    return [dict(r) for r in rows]


def list_batches(limit: int) -> list:
    """最近批次汇总（排除回收站中的任务）"""
    with _conn() as con:
        rows = con.execute(
            "SELECT batch_id, MIN(created_at) AS created_at, COUNT(*) AS total,"
            " SUM(status='queued') AS queued, SUM(status='running') AS running, SUM(status='done') AS done,"
            " SUM(status='failed') AS failed, SUM(status='cancelled') AS cancelled,"
            " MIN(method) AS method, MIN(task) AS task"
            " FROM jobs WHERE batch_id IS NOT NULL AND COALESCE(deleted,0)=0"
            " GROUP BY batch_id ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_job(jid: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
    return normalize_job_row(dict(row)) if row else None


def get_status(jid: str) -> Optional[str]:
    with _conn() as con:
        row = con.execute("SELECT status FROM jobs WHERE id=?", (jid,)).fetchone()
    return row["status"] if row else None


# ---- 回收站 / 取消 ----

def cancel_if_queued(jid: str) -> bool:
    """排队中直接落 cancelled；已开跑的由执行线程感知取消标记"""
    with _conn() as con:
        cur = con.execute("UPDATE jobs SET status='cancelled', result_log=? WHERE id=? AND status='queued'", ("[CANCELLED by user before start]", jid))
    return cur.rowcount > 0


def soft_delete(jid: str) -> bool:
    with _conn() as con:
        return con.execute("UPDATE jobs SET deleted=1 WHERE id=?", (jid,)).rowcount > 0


def hard_delete(jid: str) -> bool:
    with _conn() as con:
        return con.execute("DELETE FROM jobs WHERE id=?", (jid,)).rowcount > 0


def restore(jid: str) -> bool:
    with _conn() as con:
        return con.execute("UPDATE jobs SET deleted=0 WHERE id=?", (jid,)).rowcount > 0


def clear_terminal(statuses: Iterable[str]) -> int:
    """把指定终态任务软删进回收站，返回数量"""
    want = [s for s in statuses if s in TERMINAL]
    if not want:
        return 0
    with _conn() as con:
        cur = con.execute(f"UPDATE jobs SET deleted=1 WHERE status IN ({','.join('?' * len(want))}) AND COALESCE(deleted,0)=0", want)
    return cur.rowcount


# ---- 调度与执行 ----

def claim_next(max_running: int) -> Optional[str]:
    """认领一个排队任务（CAS queued→running）：单个提交优先于批量，其余按提交顺序；运行中已满返回 None"""
    with _conn() as con:
        if con.execute("SELECT COUNT(*) FROM jobs WHERE status='running'").fetchone()[0] >= max_running:
            return None
        row = con.execute(
            "SELECT id FROM jobs WHERE status='queued' AND COALESCE(deleted,0)=0 ORDER BY (batch_id IS NOT NULL), created_at, rowid LIMIT 1"
        ).fetchone()
        if row is None:
            return None
        cur = con.execute("UPDATE jobs SET status='running' WHERE id=? AND status='queued'", (row["id"],))
    return row["id"] if cur.rowcount == 1 else None


def requeue_running() -> int:
    """进程重启后把中断的 running 任务重新排队"""
    with _conn() as con:
        return con.execute("UPDATE jobs SET status='queued', result_log=NULL, progress_energy=NULL, progress_xyz=NULL WHERE status='running'").rowcount


def mark_running(jid: str):
    with _conn() as con:
        con.execute("UPDATE jobs SET status='running' WHERE id=?", (jid,))


def mark_cancelled_before_start(jid: str):
    with _conn() as con:
        con.execute("UPDATE jobs SET status='cancelled', result_log=? WHERE id=?", ("[CANCELLED by user before start]", jid))


def push_progress(jid: str, energy: Optional[float] = None, xyz: Optional[str] = None, log: Optional[str] = None):
    sets, vals = [], []
    for col, val in (("progress_energy", energy), ("progress_xyz", xyz), ("result_log", log)):
        if val is not None:
            sets.append(f"{col}=?")
            vals.append(val)
    if not sets:
        return
    with _conn() as con:
        con.execute(f"UPDATE jobs SET {','.join(sets)} WHERE id=?", (*vals, jid))


def finish(jid: str, status: str, energy: Optional[float], log: str, result_xyz: Optional[str], wall_time: float):
    with _conn() as con:
        con.execute(
            "UPDATE jobs SET status=?, result_energy=?, result_log=?, result_xyz=?, wall_time=? WHERE id=?",
            (status, energy, log, result_xyz, wall_time, jid),
        )


def fail_if_unfinished(jid: str, note: str):
    """兜底：执行线程异常退出仍未落终态时标失败，避免永久占住并发槽"""
    with _conn() as con:
        con.execute(
            "UPDATE jobs SET status='failed', result_log=COALESCE(result_log,'') || ? WHERE id=? AND status IN ('running','queued')",
            (note, jid),
        )
