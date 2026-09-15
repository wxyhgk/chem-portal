"""执行器公共类型与工具：任务参数、回调、结果；子进程流式收集；日志/轨迹截断"""
import queue
import re
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Callable, Optional

from .config import RESULT_LOG_LIMIT

LOG_HEAD = 3000  # 截断时保留的开头长度（计算设置与程序调用），其余留给结尾（xtb SUMMARY 距结尾约 4-5KB）


@dataclass
class JobSpec:
    """一次计算的输入参数（与 DB 行 / 请求体解耦）"""
    xyz: str
    method: str = "gfn2"
    task: str = "sp"
    charge: int = 0
    multiplicity: int = 1
    threads: int = 8
    psi_method: str = "b3lyp"
    psi_basis: str = "def2-SVP"

    @classmethod
    def from_row(cls, row: dict) -> "JobSpec":
        return cls(
            xyz=row.get("input_xyz") or row.get("xyz") or "",
            method=(row.get("method") or "gfn2").lower(),
            task=row.get("task") or "sp",
            charge=int(row.get("charge") or 0),
            multiplicity=int(row.get("multiplicity") or 1),
            threads=int(row.get("threads") or 8),
            psi_method=row.get("psi_method") or "b3lyp",
            psi_basis=row.get("psi_basis") or "def2-SVP",
        )


@dataclass
class Hooks:
    """执行过程回调；可能在执行线程或其辅助线程中调用，实现方需线程安全"""
    on_output: Callable[[str], None] = lambda line: None
    on_progress: Callable[[Optional[float], Optional[str]], None] = lambda energy, xyz: None
    is_cancelled: Callable[[], bool] = lambda: False


@dataclass
class ExecResult:
    status: str  # done | failed | cancelled
    energy: Optional[float]
    log: str  # 完整输出，落库前由调用方 clip_log
    result_xyz: Optional[str]
    wall_time: float


def collect_stream(proc: subprocess.Popen, timeout: float, on_output: Callable[[str], None], is_cancelled: Callable[[], bool]) -> tuple:
    """流式收子进程输出（在调用线程触发 on_output），超时/取消则 kill。返回 (lines, timed_out, cancelled)"""
    q: queue.Queue = queue.Queue()

    def _reader():
        try:
            for line in proc.stdout:
                q.put(line)
        finally:
            q.put(None)

    threading.Thread(target=_reader, daemon=True).start()
    lines: list = []
    deadline = time.time() + timeout
    timed_out = cancelled = False
    while True:
        if is_cancelled():
            cancelled = True
            break
        wait = deadline - time.time()
        if wait <= 0:
            timed_out = True
            break
        try:
            item = q.get(timeout=min(wait, 0.5))
        except queue.Empty:
            continue
        if item is None:
            break
        line = (item if isinstance(item, str) else item.decode(errors="replace")).rstrip("\n")
        lines.append(line)
        on_output(line)
    if timed_out or cancelled:
        try:
            proc.kill()
        except Exception:
            pass
    try:
        proc.wait(timeout=10)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass
    return lines, timed_out, cancelled


def truncate_xyz_at_frame_boundary(txt: str, limit: int) -> str:
    """多帧 XYZ 超长时在 limit 内最后一个帧头之前截断，保证帧完整"""
    if len(txt) <= limit:
        return txt
    cut = txt[:limit]
    for m in reversed(list(re.finditer(r"\n\d+\s*\n", cut))):
        return cut[: m.start() + 1]
    return cut[: limit - (limit % 1024)]


def clip_log(text: str, limit: int = RESULT_LOG_LIMIT, head: int = LOG_HEAD) -> str:
    """日志落库截断：保留开头（程序调用、计算设置）与结尾（最终结果、报错、超时/取消标记）"""
    text = text or ""
    if len(text) <= limit:
        return text
    marker = "\n\n…[省略 {} 字符]…\n\n"
    tail = limit - head - len(marker.format(len(text)))
    return text[:head] + marker.format(len(text) - head - tail) + text[-tail:]
