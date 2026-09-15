import sqlite3
from ..core.config import DB_PATH

def get_connection():
    # timeout: 批量并发时多线程写进度，默认 5s 易 "database is locked"
    con = sqlite3.connect(str(DB_PATH), timeout=30)
    con.row_factory = sqlite3.Row
    return con


def ensure_progress_columns():
    """实时推送列（失败即重）：progress_energy REAL, progress_xyz TEXT"""
    con = get_connection()
    try:
        # WAL：并发任务写进度时读写互不阻塞（设置持久化在库文件上，重复执行无副作用）
        con.execute("PRAGMA journal_mode=WAL")
        cols = {r[1] for r in con.execute("PRAGMA table_info(jobs)").fetchall()}
        if "progress_energy" not in cols:
            con.execute("ALTER TABLE jobs ADD COLUMN progress_energy REAL")
        if "progress_xyz" not in cols:
            con.execute("ALTER TABLE jobs ADD COLUMN progress_xyz TEXT")
        if "md_time" not in cols:
            con.execute("ALTER TABLE jobs ADD COLUMN md_time REAL")
        if "md_temp" not in cols:
            con.execute("ALTER TABLE jobs ADD COLUMN md_temp REAL")
        if "deleted" not in cols:
            con.execute("ALTER TABLE jobs ADD COLUMN deleted INTEGER DEFAULT 0")
        # 批量：任务名（SDF 标题/文件名）+ 批次 id
        if "name" not in cols:
            con.execute("ALTER TABLE jobs ADD COLUMN name TEXT")
        if "batch_id" not in cols:
            con.execute("ALTER TABLE jobs ADD COLUMN batch_id TEXT")
        con.execute("CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id)")
        con.commit()
    finally:
        con.close()
