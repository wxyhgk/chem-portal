"""
xtb 执行器 - 封装 subprocess 调用 /root/Software/xtb/xtb_v6.7.1/bin/xtb
支持 task=sp/opt，sp 用 --sp，opt 用 --opt 并读取 xtbopt.log 轨迹
每个任务使用独立 TemporaryDirectory，不与 backend 抢文件
"""
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from dataclasses import dataclass
from typing import Optional

DEFAULT_XTB_BIN = "/root/Software/xtb/xtb_v6.7.1/bin/xtb"
RESULT_LOG_LIMIT = 8000
RESULT_XYZ_LIMIT = 200000

def _truncate_at_frame(txt: str, lim: int = RESULT_XYZ_LIMIT) -> str:
    if len(txt) <= lim: return txt
    import re
    cut = txt[:lim]
    for m in reversed(list(re.finditer(r"\n\d+\s*\n", cut))):
        return cut[:m.start()+1]
    return cut


@dataclass
class XtbResult:
    energy: Optional[float]
    log: str
    result_xyz: Optional[str]
    wall_time: float
    returncode: int
    success: bool


def _parse_energy(output: str) -> Optional[float]:
    for line in output.splitlines():
        if "TOTAL ENERGY" in line:
            try:
                # e.g. " | TOTAL ENERGY            -5.070369819160 Eh |"
                # or  " TOTAL ENERGY  -5.07 Eh"
                # 原逻辑: split()[-3]
                parts = line.split()
                # 找到 Eh 前的数
                for i, p in enumerate(parts):
                    if p == "Eh" and i > 0:
                        return float(parts[i - 1])
                # fallback: 倒数第三个
                return float(parts[-3])
            except Exception:
                continue
    # 备用: 正则匹配
    m = re.search(r"TOTAL ENERGY\s+([\-0-9.]+)\s*Eh", output)
    if m:
        try:
            return float(m.group(1))
        except Exception:
            pass
    return None


def run_xtb(
    xyz: str,
    charge: int = 0,
    threads: int = 8,
    task: str = "sp",
    xtb_bin: str = DEFAULT_XTB_BIN,
    timeout: int = 600,
    method: str = "gfn2",
) -> XtbResult:
    """
    执行 xtb 任务，返回 XtbResult
    - xyz: 输入 XYZ 内容 (字符串)
    - charge: 电荷
    - threads: OMP 线程数 (单任务 8 核)
    - task: sp | opt
    - xtb_bin: xtb 可执行文件路径
    - timeout: 超时秒数
    """
    t0 = time.time()
    log_text = ""
    result_xyz = None
    energy = None
    returncode = -1
    success = False

    # 线程数限制与校验
    try:
        threads = int(threads)
    except Exception:
        threads = 8
    threads = max(1, min(threads, 32))

    task = task if task in ("sp", "opt") else "sp"

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        inp = td_path / "input.xyz"
        inp.write_text(xyz)

        if task == "opt":
            cmd = [xtb_bin, str(inp), "--opt", "--chrg", str(charge)]
        else:
            cmd = [xtb_bin, str(inp), "--sp", "--chrg", str(charge)]

        env = os.environ.copy()
        env["OMP_NUM_THREADS"] = str(threads)
        env["MKL_NUM_THREADS"] = str(threads)
        env["OMP_STACKSIZE"] = env.get("OMP_STACKSIZE", "512M")

        try:
            proc = subprocess.run(
                cmd,
                cwd=td,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            log_text = (proc.stdout or "") + "\n" + (proc.stderr or "")
            returncode = proc.returncode
            energy = _parse_energy(log_text)

            # opt: 读取轨迹
            opt_log = td_path / "xtbopt.log"
            opt_xyz = td_path / "xtbopt.xyz"
            if task == "opt" and opt_log.exists():
                try:
                    traj = opt_log.read_text()
                    result_xyz = _truncate_at_frame(traj, RESULT_XYZ_LIMIT)
                except Exception:
                    pass
            elif opt_xyz.exists():
                try:
                    result_xyz = _truncate_at_frame(opt_xyz.read_text(), RESULT_XYZ_LIMIT)
                except Exception:
                    pass

            # 对于 sp，也可以尝试读取最终 xyz（若有）
            if task == "sp" and result_xyz is None:
                # 有些版本会生成 xtbsp.xyz / 无则为 None
                for cand in ["xtbsp.xyz", "xtb.xyz"]:
                    p = td_path / cand
                    if p.exists():
                        try:
                            result_xyz = _truncate_at_frame(p.read_text(), RESULT_XYZ_LIMIT)
                            break
                        except Exception:
                            pass

            success = proc.returncode == 0

        except subprocess.TimeoutExpired as e:
            log_text = (e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")) + "\n" + \
                       (e.stderr.decode() if isinstance(e.stderr, bytes) else (e.stderr or "")) + \
                       f"\n[TIMEOUT after {timeout}s]"
            if not log_text.strip():
                log_text = f"xtb timeout after {timeout}s"
            energy = _parse_energy(log_text)
        except FileNotFoundError:
            log_text = f"xtb binary not found: {xtb_bin}"
        except Exception as e:
            log_text = f"xtb execution error: {e}"

    wall = time.time() - t0
    # 截断
    if len(log_text) > RESULT_LOG_LIMIT:
        log_text = log_text[:RESULT_LOG_LIMIT]

    return XtbResult(
        energy=energy,
        log=log_text,
        result_xyz=result_xyz,
        wall_time=wall,
        returncode=returncode,
        success=success,
    )
