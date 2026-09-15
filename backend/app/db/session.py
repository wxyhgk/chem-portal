import sqlite3

from ..core.config import DB_PATH

# 新库直接建全；旧库由 _ADDED_COLUMNS 补列（database/schema.sql 与此保持一致）
_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL,
  method TEXT,
  charge INTEGER DEFAULT 0,
  threads INTEGER DEFAULT 8,
  input_xyz TEXT NOT NULL,
  task TEXT DEFAULT 'sp',
  psi_method TEXT,
  psi_basis TEXT,
  multiplicity INTEGER DEFAULT 1,
  result_energy REAL,
  result_log TEXT,
  result_xyz TEXT,
  wall_time REAL,
  progress_energy REAL,
  progress_xyz TEXT,
  deleted INTEGER DEFAULT 0,
  name TEXT,
  batch_id TEXT
)
"""

_ADDED_COLUMNS = [
    ("psi_method", "TEXT"),
    ("psi_basis", "TEXT"),
    ("multiplicity", "INTEGER DEFAULT 1"),
    ("progress_energy", "REAL"),
    ("progress_xyz", "TEXT"),
    ("deleted", "INTEGER DEFAULT 0"),
    ("name", "TEXT"),
    ("batch_id", "TEXT"),
]


def get_connection():
    # timeout: 并发任务多线程写进度，默认 5s 易 "database is locked"
    con = sqlite3.connect(str(DB_PATH), timeout=30)
    con.row_factory = sqlite3.Row
    return con


def ensure_schema():
    """建表 / 旧库补列 / 索引 / WAL（幂等，API 启动时调用）"""
    con = get_connection()
    try:
        # WAL：并发任务写进度时读写互不阻塞（设置持久化在库文件上）
        con.execute("PRAGMA journal_mode=WAL")
        con.execute(_SCHEMA)
        cols = {r[1] for r in con.execute("PRAGMA table_info(jobs)").fetchall()}
        for name, decl in _ADDED_COLUMNS:
            if name not in cols:
                con.execute(f"ALTER TABLE jobs ADD COLUMN {name} {decl}")
        con.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)")
        con.execute("CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id)")
        con.commit()
    finally:
        con.close()
