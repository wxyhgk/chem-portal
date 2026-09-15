# Worker 服务

独立 xtb 执行服务，与 `backend/app.py` 的 `BackgroundTasks` 解耦。

## 架构

```
backend /api/jobs  --enqueue-->  queue (Redis LIST 或 SQLite queued 行)
                                   |
                              worker (3并发×8核) --poll/BRPOP--> claim -> run_xtb() -> UPDATE jobs SET status/done/failed
```

- **优先 Redis**: 有 `redis` 库且 `REDIS_URL` 可连时，使用 `chem:queue` LIST，`BRPOP` 消费。
- **无 Redis 回退**: 轮询 `SELECT ... WHERE status='queued'` + `UPDATE ... WHERE status='queued'` 原子认领，兼容现有 `chem.db`。
- **不抢文件**: 每个任务在 `TemporaryDirectory` 独立执行，通过 `OMP_NUM_THREADS` 控制 8 核。

## 文件

- `worker.py` - 主循环，`ThreadPoolExecutor(max_workers=3)`，优雅退出
- `queue.py` - `enqueue(job_id)` / `dequeue_claim()` / `poll_wait_claim()`
- `executors/xtb.py` - `run_xtb(xyz, charge, threads, task)` 封装 `xtb --sp/--opt`，解析 `TOTAL ENERGY`，读取 `xtbopt.log` 轨迹
- `start.sh` - 启动脚本
- `install_service.sh` - systemd 服务安装

## 配置 (环境变量)

| 变量 | 默认 | 说明 |
|------|------|------|
| `CHEM_DB` | `../database/chem.db` | SQLite 路径 |
| `XTB_BIN` | `/root/Software/xtb/xtb_v6.7.1/bin/xtb` | xtb 二进制 |
| `WORKER_CONCURRENCY` | `3` | 并发任务数 (3×8=24核) |
| `WORKER_THREADS_PER_JOB` | `8` | 单任务 OMP 线程 |
| `WORKER_POLL_INTERVAL` | `2` | SQLite 轮询间隔 |
| `REDIS_URL` | `redis://127.0.0.1:6379/0` | 有则用，无则 SQLite |
| `REDIS_QUEUE_KEY` | `chem:queue` | Redis 队列 key |

## 启动

```bash
# 前台
bash worker/start.sh
# 或
WORKER_CONCURRENCY=2 python3 -m worker.worker

# 后台/多实例 (24核 3×8 最优)
nohup python3 -m worker.worker > worker.log 2>&1 &

# systemd
bash worker/install_service.sh
systemctl daemon-reload && systemctl enable --now chem-worker
journalctl -u chem-worker -f
```

## Backend 接入 (可选)

`backend/app.py` 的 `create_job` 改为入队而非 `bg.add_task`:

```python
from worker.queue import enqueue  # 或直接复制 enqueue 逻辑避免依赖

@app.post("/api/jobs")
def create_job(job: JobIn):
    jid = uuid.uuid4().hex[:12]
    con = db()
    con.execute("INSERT INTO jobs ...", (jid, "queued", ...))
    con.commit(); con.close()
    enqueue(jid)  # 推 Redis 或仅靠 queued 行
    return {"id": jid, "status": "queued"}
```

存量 `queued` 任务无需额外迁移，worker 轮询即可消费。

## 验证

```bash
python3 -c "from worker.executors.xtb import run_xtb; print(run_xtb(open('tests/h2o.xyz').read(), task='sp'))"
python3 -m worker.worker  # 观察日志 Mode: SQLite polling / Redis queue
```
