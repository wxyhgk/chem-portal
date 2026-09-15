-- Chem Portal 任务表 (SQLite/PostgreSQL 通用)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL, -- queued/running/done/failed
  method TEXT, -- gfn2/gfn1/gfnff/psi4
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
  wall_time REAL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
