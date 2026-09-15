"""
队列抽象 - Redis 优先，SQLite 轮询兼容

设计目标:
- 生产环境有 Redis 时: 使用 Redis LIST (chem:queue) 做高性能队列，BRPOP 消费
- 无 Redis 时: 自动回退到 SQLite 轮询 (兼容现有 chem.db，无需额外依赖)
- backend 入队只需调 enqueue(job_id)，worker 调 dequeue_claim() 原子认领

隔离性: file 竞争隔离靠 executors 的 TemporaryDirectory；DB 竞争靠原子 CAS (WHERE status='queued')
"""
import os
import time
import sqlite3
import logging
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# 可通过环境变量覆盖
REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
REDIS_QUEUE_KEY = os.getenv("REDIS_QUEUE_KEY", "chem:queue")
DB_PATH = Path(os.getenv("CHEM_DB", str(Path(__file__).resolve().parents[1] / "database" / "chem.db")))
POLL_INTERVAL = float(os.getenv("WORKER_POLL_INTERVAL", "2"))

_redis_client = None
_redis_available: Optional[bool] = None


def get_redis():
    """懒加载 Redis，若无 redis 库或连不上则返回 None 并记忆"""
    global _redis_client, _redis_available
    if _redis_available is False:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        import redis  # type: ignore
    except ImportError:
        _redis_available = False
        logger.info("redis-py not installed, fallback to SQLite polling")
        return None
    try:
        client = redis.Redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=2, decode_responses=True)
        client.ping()
        _redis_client = client
        _redis_available = True
        logger.info(f"Redis connected: {REDIS_URL} queue={REDIS_QUEUE_KEY}")
        return client
    except Exception as e:
        _redis_available = False
        logger.info(f"Redis unavailable ({e}), fallback to SQLite polling")
        return None


def _db():
    con = sqlite3.connect(str(DB_PATH), timeout=30.0, isolation_level=None)
    con.row_factory = sqlite3.Row
    # WAL 提升并发
    try:
        con.execute("PRAGMA journal_mode=WAL;")
        con.execute("PRAGMA busy_timeout=5000;")
    except Exception:
        pass
    return con


def enqueue(job_id: str) -> bool:
    """
    将 job_id 入队。优先推 Redis，失败则仅依赖 SQLite 的 queued 状态 (轮询可见)。
    返回 True 表示已入队/可见。
    """
    r = get_redis()
    if r is not None:
        try:
            r.lpush(REDIS_QUEUE_KEY, job_id)
            return True
        except Exception as e:
            logger.warning(f"Redis lpush failed, fallback to SQLite: {e}")
    # SQLite 模式无需额外动作 - job 已标记 queued，worker 轮询即可
    return True


def dequeue_claim(timeout: int = 5) -> Optional[str]:
    """
    消费一条任务并原子认领，返回 job_id 或 None
    - Redis 模式: BRPOP + CAS 校验 (若 job 已被其他 worker 认领则跳过)
    - SQLite 模式: SELECT queued + UPDATE CAS
    """
    r = get_redis()
    if r is not None:
        try:
            item = r.brpop(REDIS_QUEUE_KEY, timeout=timeout)
            if item:
                _, job_id = item
                # 原子认领: 仅当仍为 queued 时置为 running
                con = _db()
                try:
                    cur = con.execute("UPDATE jobs SET status='running' WHERE id=? AND status='queued'", (job_id,))
                    con.commit()
                    if cur.rowcount == 1:
                        return job_id
                    else:
                        # 已被其他路径认领/取消，继续取下一条
                        logger.info(f"job {job_id} already claimed, skip")
                        return dequeue_claim(timeout=1)
                finally:
                    con.close()
        except Exception as e:
            logger.warning(f"Redis brpop error: {e}, fallback to SQLite poll")

    # SQLite 轮询 (含 Redis 失败回退)
    return _poll_claim_sqlite()


def _poll_claim_sqlite() -> Optional[str]:
    con = _db()
    try:
        # 使用 IMMEDIATE 事务避免并发抢同一 job
        con.execute("BEGIN IMMEDIATE")
        row = con.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1").fetchone()
        if not row:
            con.execute("ROLLBACK")
            return None
        jid = row["id"]
        cur = con.execute("UPDATE jobs SET status='running' WHERE id=? AND status='queued'", (jid,))
        if cur.rowcount == 1:
            con.execute("COMMIT")
            return jid
        else:
            con.execute("ROLLBACK")
            return None
    except sqlite3.OperationalError as e:
        try:
            con.execute("ROLLBACK")
        except Exception:
            pass
        if "locked" in str(e).lower():
            time.sleep(0.2)
        return None
    except Exception as e:
        try:
            con.execute("ROLLBACK")
        except Exception:
            pass
        logger.error(f"SQLite poll error: {e}")
        return None
    finally:
        con.close()


def poll_wait_claim(poll_interval: float = POLL_INTERVAL) -> Optional[str]:
    """
    供 worker 常驻循环使用的阻塞式等待: Redis 时 BRPOP 已阻塞，无 Redis 时 sleep 轮询
    """
    r = get_redis()
    if r is not None:
        # Redis 已在 dequeue_claim 中阻塞，无需额外 sleep
        return dequeue_claim(timeout=int(max(1, poll_interval * 2)))
    else:
        jid = _poll_claim_sqlite()
        if jid is None:
            time.sleep(poll_interval)
        return jid
