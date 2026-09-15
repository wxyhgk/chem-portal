"""任务调度：DB 队列 → 按 JOB_CONCURRENCY 限并发认领 → 线程执行。API 进程内单实例"""
import threading
import time

from compute.config import JOB_CONCURRENCY

from ..db import jobs_repo
from ..db.session import ensure_schema
from .runner import run_job

POLL_INTERVAL = 1.0  # 秒

_lock = threading.Lock()
_started = False


def _run(jid: str):
    try:
        run_job(jid)
    except Exception as e:
        print(f"[dispatch] run_job crashed {jid}: {e}")
    finally:
        jobs_repo.fail_if_unfinished(jid, "\n[dispatch] 执行异常退出")


def _loop():
    while True:
        try:
            while (jid := jobs_repo.claim_next(JOB_CONCURRENCY)) is not None:
                threading.Thread(target=_run, args=(jid,), name=f"job-{jid}", daemon=True).start()
        except Exception as e:
            print(f"[dispatch] dispatcher error: {e}")
        time.sleep(POLL_INTERVAL)


def start():
    """API 启动时调用（幂等）：建表/补列，把上次进程退出时中断的任务重新排队，再起调度线程"""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    ensure_schema()
    n = jobs_repo.requeue_running()
    if n:
        print(f"[dispatch] requeued {n} interrupted jobs")
    threading.Thread(target=_loop, name="job-dispatcher", daemon=True).start()
    print(f"[dispatch] dispatcher started, concurrency={JOB_CONCURRENCY}")
