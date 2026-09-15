"""执行一个已认领的任务：读任务 → compute.run → 写结果。计算逻辑全部在 compute 包"""
import threading
import time
import traceback
from typing import Optional

import compute
from compute.base import Hooks, JobSpec, clip_log
from compute.config import PROGRESS_XYZ_LIMIT, RESULT_LOG_LIMIT

from ..db import jobs_repo
from . import cancellation

PUSH_EVERY = 2.0  # 运行中落库节流（秒）
LIVE_LINES = 5000  # 内存里保留的实时日志行数


class _ProgressSink:
    """执行回调 → 节流落库（日志尾部 + 实时能量/轨迹）；psi4 的文件监视线程也会调用，需线程安全"""

    def __init__(self, jid: str):
        self.jid = jid
        self.lines: list = []
        self.energy: Optional[float] = None
        self.xyz: Optional[str] = None
        self.dirty = False
        self.last_push = time.time()
        self.lock = threading.Lock()

    def on_output(self, line: str):
        with self.lock:
            self.lines.append(line)
            if len(self.lines) > LIVE_LINES:
                del self.lines[: LIVE_LINES // 2]
            self.dirty = True
        self._flush_if_due()

    def on_progress(self, energy: Optional[float], xyz: Optional[str]):
        with self.lock:
            if energy is not None:
                self.energy = energy
            if xyz is not None:
                self.xyz = xyz
            self.dirty = True
        self._flush_if_due()

    def _flush_if_due(self):
        now = time.time()
        with self.lock:
            if not self.dirty or now - self.last_push < PUSH_EVERY:
                return
            self.last_push, self.dirty = now, False
            log = "\n".join(self.lines)[-RESULT_LOG_LIMIT:]
            energy, xyz = self.energy, self.xyz
        jobs_repo.push_progress(self.jid, energy=energy, xyz=xyz[:PROGRESS_XYZ_LIMIT] if xyz else None, log=log)


def run_job(jid: str):
    row = jobs_repo.get_job(jid)
    if row is None:
        return
    if cancellation.is_requested(jid):
        jobs_repo.mark_cancelled_before_start(jid)
        return
    jobs_repo.mark_running(jid)
    spec = JobSpec.from_row(row)
    sink = _ProgressSink(jid)
    hooks = Hooks(on_output=sink.on_output, on_progress=sink.on_progress, is_cancelled=lambda: cancellation.is_requested(jid))
    t0 = time.time()
    try:
        r = compute.run(spec, hooks)
        jobs_repo.finish(jid, r.status, r.energy, clip_log(r.log), r.result_xyz, r.wall_time)
    except Exception as e:
        jobs_repo.finish(jid, "failed", None, clip_log(f"{spec.method} error: {e}\n{traceback.format_exc()}"), None, time.time() - t0)
