# Chem Portal 后端 - 计算化学任务 API

单仓：根目录是后端与计算层，`web/` 是 Next.js 前端。浏览器只访问前端，前端把 `/api/*` 代理到本服务（后端只监听本机）。

## 目录
- `backend/app/` FastAPI 应用
  - `routers/jobs.py` HTTP 接口（只做请求/响应适配）
  - `services/job_service.py` 任务操作；`runner.py` 执行单个任务；`dispatcher.py` 队列调度；`cancellation.py` 取消登记；`chem.py` RDKit 工具
  - `db/session.py` 连接与建表/补列；`db/jobs_repo.py` 全部 SQL
- `compute/` 计算执行层：xtb / psi4 / uff 的唯一实现，不碰数据库；`compute/config.py` 计算配置
- `shared/schemas/` 前后端共享契约（`job.py` / `job.ts`，前端仓库用 `scripts/sync-shared.sh` 同步）
- `database/` SQLite 库（`chem.db` 不入 git；`schema.sql` 仅作参考）
- `scripts/backup_db.sh` 数据库每日备份（systemd `chem-portal-backup.timer`）
- `web/` Next.js 前端（全站 Basic Auth，`/api/*` 代理到本服务）

## 运行（systemd）
- `chem-portal-api.service`：`uvicorn backend.app.main:app --host 127.0.0.1 --port 18081`，`WorkingDirectory` 与 `PYTHONPATH` 为本目录
- 重启前确认没有运行中的任务（运行中的任务会在重启后自动重新排队、从头计算）

## 配置（环境变量）
| 变量 | 默认 | 说明 |
|---|---|---|
| `JOB_CONCURRENCY` | 6 | 同时运行任务数（单个提交优先于批量） |
| `XTB_BIN` | `/root/Software/xtb/xtb_v6.7.1/bin/xtb` | |
| `XTB_TIMEOUT` / `PSI4_TIMEOUT` | 3600 | 秒；超时标记为 failed |
| `PSI4_PYTHON` | `/root/micromamba/envs/chem/bin/python` | psi4 所在环境 |
| `PSI4_MEMORY` | 物理内存 80% ÷ 并发数，≤ 16GB | 每个 psi4 进程 |
