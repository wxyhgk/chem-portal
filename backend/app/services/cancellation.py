"""运行中任务的取消登记（进程内）：接口登记，执行线程通过 Hooks.is_cancelled 轮询。
仅适用于调度与执行在同一进程（当前单进程 uvicorn）。
"""
import threading
import time

_TTL = 7200  # 登记保留时长（秒），过期自动清理
_lock = threading.Lock()
_requested: dict = {}


def request(jid: str):
    with _lock:
        _requested[jid] = time.time()


def is_requested(jid: str) -> bool:
    with _lock:
        t = _requested.get(jid)
        if t is None:
            return False
        if time.time() - t > _TTL:
            _requested.pop(jid, None)
            return False
        return True
