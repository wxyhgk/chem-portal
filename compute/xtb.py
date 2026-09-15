"""xtb 执行器：GFN2 / GFN1 / GFN-FF，sp / opt；流式输出、实时能量与优化轨迹、超时与取消"""
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

from .base import ExecResult, Hooks, JobSpec, collect_stream, truncate_xyz_at_frame_boundary
from .config import PROGRESS_XYZ_LIMIT, RESULT_XYZ_LIMIT, XTB_BIN, XTB_TIMEOUT

# 必须显式传方法：xtb 不带参数默认 GFN2（此前 gfn1/gfnff 因此都按 GFN2 计算）
METHOD_FLAGS = {"gfn2": ["--gfn", "2"], "gfn1": ["--gfn", "1"], "gfnff": ["--gfnff"]}
PROGRESS_EVERY = 2.0  # 进度回调节流（秒）
# opt 迭代表一行：序号 E dE(科学计数) ...（占据数表第三列非科学计数，不会误配）
_ITER_ENERGY = re.compile(r"^\s*\d+\s+(-?\d+\.\d+)\s+-?\d+\.\d+[Ee][+-]?\d+")


# xtb 输出开头约 4KB 是 logo 与文献引用，对排查无用；落库日志从 Calculation Setup 开始，只保留版本行
_SETUP_BLOCK = re.compile(r"^\s*-{20,}\s*\n\s*\|\s*Calculation Setup", re.M)
_VERSION_LINE = re.compile(r"xtb version[^\n]*")


def strip_banner(out: str) -> str:
    m = _SETUP_BLOCK.search(out)
    if not m:
        return out
    v = _VERSION_LINE.search(out[: m.start()])
    return f"[{v.group(0).strip() if v else 'xtb'} · logo 与文献引用已省略]\n{out[m.start():]}"


def build_command(spec: JobSpec, xyz_path: str, xtb_bin: str = XTB_BIN) -> list:
    flags = METHOD_FLAGS.get(spec.method)
    if flags is None:
        raise ValueError(f"xtb 不支持的方法: {spec.method}")
    cmd = [xtb_bin, xyz_path, "--opt" if spec.task == "opt" else "--sp", "--chrg", str(spec.charge), *flags]
    if spec.multiplicity > 1:
        cmd += ["--uhf", str(spec.multiplicity - 1)]  # 未成对电子数
    return cmd


def _final_energy(out: str) -> Optional[float]:
    energy = None
    for line in out.splitlines():
        if "TOTAL ENERGY" in line:
            try:
                energy = float(line.split()[-3])
            except (ValueError, IndexError):
                pass
    return energy


def _read(path: Path, limit: int) -> Optional[str]:
    try:
        t = path.read_text()
    except OSError:
        return None
    return truncate_xyz_at_frame_boundary(t, limit) if len(t.strip()) > 10 else None


def _progress_traj(td: Path, task: str) -> Optional[str]:
    if task != "opt":
        return None
    for name in ("xtbopt.xyz", "xtbopt.log"):
        p = td / name
        if p.exists():
            t = _read(p, PROGRESS_XYZ_LIMIT)
            if t:
                return t
    return None


def _final_traj(td: Path, task: str) -> Optional[str]:
    opt_log, opt_xyz = td / "xtbopt.log", td / "xtbopt.xyz"
    if task == "opt" and opt_log.exists():
        return _read(opt_log, RESULT_XYZ_LIMIT)
    if opt_xyz.exists():
        return _read(opt_xyz, RESULT_XYZ_LIMIT)
    return None


def run_xtb(spec: JobSpec, hooks: Hooks, timeout: float = XTB_TIMEOUT, xtb_bin: str = XTB_BIN) -> ExecResult:
    t0 = time.time()
    threads = max(1, min(int(spec.threads or 8), 32))
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        inp = tdp / "input.xyz"
        inp.write_text(spec.xyz or "")
        cmd = build_command(spec, str(inp), xtb_bin)
        env = os.environ.copy()
        env["OMP_NUM_THREADS"] = env["MKL_NUM_THREADS"] = str(threads)
        env.setdefault("OMP_STACKSIZE", "512M")  # 大分子默认栈太小会段错误
        proc = subprocess.Popen(cmd, cwd=td, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)

        state = {"energy": None, "pushed": t0}

        def on_line(line: str):
            hooks.on_output(line)
            m = _ITER_ENERGY.match(line)
            if m:
                state["energy"] = float(m.group(1))
            now = time.time()
            if now - state["pushed"] >= PROGRESS_EVERY:
                state["pushed"] = now
                hooks.on_progress(state["energy"], _progress_traj(tdp, spec.task))

        lines, timed_out, cancelled = collect_stream(proc, timeout, on_line, hooks.is_cancelled)
        out = strip_banner("\n".join(lines))
        if cancelled:
            return ExecResult("cancelled", None, out + "\n[CANCELLED by user]", None, time.time() - t0)
        if timed_out:
            return ExecResult("failed", None, out + f"\n[TIMEOUT {timeout:g}s] xtb 未在时限内结束，已终止（可调 XTB_TIMEOUT）", None, time.time() - t0)
        energy = _final_energy(out)
        result_xyz = _final_traj(tdp, spec.task)
        ok = proc.returncode == 0 and energy is not None
        if not ok:
            out += f"\n[xtb 异常结束 rc={proc.returncode}{'' if energy is not None else '，未解析到 TOTAL ENERGY'}]"
        return ExecResult("done" if ok else "failed", energy, out, result_xyz, time.time() - t0)
