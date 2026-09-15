-- Chem Portal 任务表（SQLite）。与 backend/app/db/session.py 的 _SCHEMA 保持一致；
-- API 启动时会自动建表、为旧库补列并开启 WAL，一般无需手动执行本文件。
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,  -- UTC
  status TEXT NOT NULL,          -- queued / running / done / failed / cancelled
  method TEXT,                   -- gfn2 / gfn1 / gfnff / uff / psi4
  charge INTEGER DEFAULT 0,
  threads INTEGER DEFAULT 8,
  input_xyz TEXT NOT NULL,
  task TEXT DEFAULT 'sp',        -- sp / opt
  psi_method TEXT,               -- 仅 psi4
  psi_basis TEXT,                -- 仅 psi4
  multiplicity INTEGER DEFAULT 1,
  result_energy REAL,            -- Eh（UFF 为 kcal/mol）
  result_log TEXT,               -- 保留开头 + 结尾，≤ 12000 字符（xtb 已去掉引用 banner）
  result_xyz TEXT,               -- opt 为多帧轨迹
  wall_time REAL,                -- 秒
  progress_energy REAL,          -- 运行中实时能量
  progress_xyz TEXT,             -- 运行中实时轨迹
  deleted INTEGER DEFAULT 0,     -- 1 = 回收站
  name TEXT,                     -- 任务名（SDF 标题/文件名）
  batch_id TEXT                  -- 批量提交的批次 id
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id);
