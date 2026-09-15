"""
psi4 执行器 — def2-SVP 级别，支持 sp/opt，带轨迹
"""
import os, re, subprocess, tempfile, time
import queue
import threading
from pathlib import Path
from dataclasses import dataclass
from typing import Callable, Optional

PSI4_ENV_PYTHON = "/root/micromamba/envs/chem/bin/python"
def _default_psi4_memory() -> str:
    """每进程内存 = 物理内存 80% ÷ 同时运行任务数，封顶 16GB、至少 2GB（机器无 swap，防止并发 psi4 撑爆内存）"""
    try:
        with open("/proc/meminfo") as f:
            kb = next(int(l.split()[1]) for l in f if l.startswith("MemTotal:"))
        conc = max(1, int(os.getenv("JOB_CONCURRENCY", os.getenv("BATCH_CONCURRENCY", "6"))))
        return f"{max(2, min(16, int(kb / 1024 / 1024 * 0.8 / conc)))}GB"
    except Exception:
        return "4GB"


# 每个 psi4 进程内存上限；大基组/MP2 内存不足会退到磁盘 I/O。未设置或格式非法时按上面自动计算
PSI4_MEMORY = os.getenv("PSI4_MEMORY", "").strip()
if not re.fullmatch(r"\d+(\.\d+)?\s*(MB|GB|MiB|GiB)", PSI4_MEMORY):
    PSI4_MEMORY = _default_psi4_memory()
RESULT_LOG_LIMIT = 8000
RESULT_XYZ_LIMIT = 200000

@dataclass
class Psi4Result:
    energy: Optional[float]
    log: str
    result_xyz: Optional[str]
    wall_time: float
    returncode: int
    success: bool

def _xyz_to_psi4_block(xyz: str, charge: int, mult: int) -> str:
    lines = xyz.strip().splitlines()
    if len(lines) >= 3 and lines[0].strip().isdigit():
        try:
            n = int(lines[0].strip())
            coords = lines[2:2+n] if len(lines) >= 2+n else lines[2:]
            if len(coords) != n:
                coords = [l for l in lines if not l.strip().isdigit() and l.strip()]
                if coords and re.match(r"^\s*\d", coords[0]):
                    coords = coords[1:]
        except Exception:
            coords = lines[2:]
    else:
        coords = lines
    geom = "\n".join(l.strip() for l in coords if l.strip())
    return f"{charge} {mult}\n{geom}\n"

def _collect_stream(proc: "subprocess.Popen", timeout: int, on_output: Optional[Callable[[str], None]] = None, is_cancelled: Optional[Callable[[], bool]] = None) -> tuple:
    """流式收子进程输出：调用线程触发 on_output，超时则 kill。返回 (lines, timed_out)。"""
    q: "queue.Queue" = queue.Queue()
    def _reader() -> None:
        try:
            for line in proc.stdout:  # type: ignore
                q.put(line)
        finally:
            q.put(None)
    threading.Thread(target=_reader, daemon=True).start()
    lines: list = []
    deadline = time.time() + timeout
    timed_out = False
    cancelled = False
    while True:
        if is_cancelled is not None and is_cancelled():
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
        line = item if isinstance(item, str) else item.decode(errors="replace")
        line = line.rstrip("\n")
        lines.append(line)
        if on_output:
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

def _watch_psi4_files(td_path, stop, on_output=None, on_progress=None):
    """轮询 psi4.out（新行即转 on_output）与轨迹文件；节流 2s 调 on_progress(energy, xyz)。"""
    import re as _re
    import time as _time
    energy_rx = _re.compile(r"Total Energy\s*=\s*(-?\d+\.\d+)")
    offset = 0
    last_energy = None
    last_sent = [None, -1]
    last_push = [_time.time()]
    while not stop.is_set():
        try:
            out_file = td_path / "psi4.out"
            if out_file.exists():
                text = out_file.read_text(errors="replace")
                new = text[offset:]
                offset = len(text)
                if new.strip():
                    if on_output:
                        for ln in new.splitlines()[-400:]:
                            on_output(ln)
                    ms = energy_rx.findall(new)
                    if ms:
                        try:
                            last_energy = float(ms[-1])
                        except Exception:
                            pass
            traj = None
            for cand in ("trajectory.xyz", "psi4_opt_trajectory.xyz", "opt_trajectory.xyz"):
                p = td_path / cand
                if p.exists():
                    try:
                        t = p.read_text(errors="replace")
                        if t and len(t.strip()) > 10:
                            traj = t
                            break
                    except Exception:
                        pass
            now = _time.time()
            if on_progress and now - last_push[0] >= 2.0:
                sig = (last_energy, len(traj) if traj else -1)
                if sig != (last_sent[0], last_sent[1]):
                    last_sent = [sig[0], sig[1]]
                    last_push[0] = now
                    on_progress(last_energy, traj)
        except Exception:
            pass
        stop.wait(1.0)

def _run_psi4_script(xyz: str, charge: int, mult: int, method: str, basis: str, task: str, threads: int, timeout: int, on_output: Optional[Callable[[str], None]] = None, on_progress: Optional[Callable[[Optional[float], Optional[str]], None]] = None, is_cancelled: Optional[Callable[[], bool]] = None):
    geom_block = _xyz_to_psi4_block(xyz, charge, mult)
    method = method.lower()
    psi_method = "scf" if method == "hf" else "mp2" if method == "mp2" else method
    basis = basis or "def2-SVP"
    # 用 repr 避免引号冲突
    xyz_repr = repr(xyz.strip())
    geom_repr = repr(geom_block.strip())
    script = f"""
import psi4, sys, traceback, os, glob, pathlib
psi4.set_num_threads({threads})
psi4.set_memory('{PSI4_MEMORY}')
psi4.core.set_output_file('psi4.out', False)
mol_str = {geom_repr}
# mol_str 已含电荷多重度
mol_str_full = mol_str
try:
    mol = psi4.geometry(mol_str_full)
    psi4.set_options({{'basis': '{basis}', 'reference': 'rhf' if {mult}==1 else 'uhf', 'optking__write_trajectory': True}})
    if '{task}' == 'opt':
        e, wfn = psi4.optimize('{psi_method}/{basis}', molecule=mol, return_wfn=True)
        traj = None
        for cand in ['trajectory.xyz', 'psi4_opt_trajectory.xyz', 'opt_trajectory.xyz']:
            p = pathlib.Path(cand)
            if p.exists():
                try:
                    t = p.read_text()
                    if t and len(t.strip()) > 10:
                        traj = t
                        break
                except: pass
        if not traj:
            # 兜底：cclib 从 psi4.out 解析，或拼 2 帧
            try:
                from cclib.io import ccopen
                data = ccopen('psi4.out').parse()
                if data and getattr(data, 'atomcoords', None) is not None:
                    # 用 cclib 轨迹拼 xyz
                    import numpy as np
                    coords = data.atomcoords  # shape (n_step, n_atom, 3)
                    symbols = [s for s in data.atomnos]
                    # 符号表
                    from periodictable import elements
                    syms = [elements[n].symbol for n in symbols]
                    out = []
                    for step in range(len(coords)):
                        out.append(str(len(syms)))
                        out.append(f\"step {{step}} b3lyp/def2-SVP\")
                        for s, (x,y,z) in zip(syms, coords[step]):
                            out.append(f\"{{s}} {{x:.6f}} {{y:.6f}} {{z:.6f}}\")
                    traj = \"\\n\".join(out)
            except Exception as ex:
                pass
        if not traj:
            # 最后兜底：输入 + 终态 2 帧
            try:
                final_xyz = wfn.molecule().to_string(dtype='xyz') if wfn else mol.to_string(dtype='xyz')
                input_xyz = {xyz_repr}
                if input_xyz and input_xyz[0].isdigit():
                    traj = input_xyz.strip() + \"\\n\" + final_xyz.strip()
                else:
                    traj = final_xyz
            except:
                traj = mol.to_string(dtype='xyz') if 'wfn' in locals() else \"\"
        print(f\"FINAL_ENERGY {{e}}\")
        print(\"XYZ_START\")
        print(traj)
        print(\"XYZ_END\")
    else:
        e = psi4.energy('{psi_method}/{basis}', molecule=mol)
        print(f\"FINAL_ENERGY {{e}}\")
        print(\"XYZ_START\")
        print(mol.to_string(dtype='xyz'))
        print(\"XYZ_END\")
except Exception as ex:
    traceback.print_exc()
    sys.exit(1)
"""
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        py_file = td_path / "run_psi4.py"
        py_file.write_text(script)
        env = os.environ.copy()
        env["OMP_NUM_THREADS"] = str(threads)
        env["MKL_NUM_THREADS"] = str(threads)
        try:
            proc = subprocess.Popen([PSI4_ENV_PYTHON, str(py_file)], cwd=td, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)
            stop = threading.Event()
            watcher = threading.Thread(target=_watch_psi4_files, args=(td_path, stop, on_output, on_progress), daemon=True)
            watcher.start()
            try:
                lines, timed_out, cancelled = _collect_stream(proc, timeout, on_output, is_cancelled)
            finally:
                stop.set()
                watcher.join(timeout=5)
            combined_tail = "\n".join(lines)
            if cancelled:
                return combined_tail + "\n[CANCELLED by user]", None, -2
            if timed_out:
                return combined_tail + f"\n[TIMEOUT {timeout}s]", None, -1
            psi_out = ""
            out_file = td_path / "psi4.out"
            if out_file.exists():
                try:
                    psi_out = out_file.read_text()[-8000:]
                except: pass
            combined = combined_tail + "\n" + psi_out
            import re as _re
            m = _re.search(r"XYZ_START\s*(.*?)\s*XYZ_END", combined, flags=_re.S)
            result_xyz = m.group(1).strip() if m else None
            if result_xyz and len(result_xyz) > RESULT_XYZ_LIMIT:
                result_xyz = result_xyz[:RESULT_XYZ_LIMIT]
            return combined, result_xyz, proc.returncode
        except FileNotFoundError:
            return f"psi4 python not found: {PSI4_ENV_PYTHON}", None, -1
        except Exception as e:
            return f"psi4 exec error: {e}", None, -1

def _parse_energy(log: str) -> Optional[float]:
    try:
        import tempfile, pathlib
        from cclib.io import ccopen
        with tempfile.NamedTemporaryFile(mode="w", suffix=".out", delete=False) as f:
            f.write(log)
            fname = f.name
        try:
            data = ccopen(fname).parse()
            if data and getattr(data, "scfenergies", None):
                return float(data.scfenergies[-1]) if isinstance(data.scfenergies[-1], (int,float)) else float(data.scfenergies[-1][-1])
            if data and getattr(data, "mpenergies", None):
                return float(data.mpenergies[-1])
        finally:
            pathlib.Path(fname).unlink(missing_ok=True)
    except: pass
    m = re.search(r"FINAL_ENERGY\s+([-\d.]+)", log)
    if m:
        try: return float(m.group(1))
        except: pass
    m2 = re.search(r"Total Energy\s*=\s*([-\d.]+)", log)
    if m2:
        try: return float(m2.group(1))
        except: pass
    return None

def run_psi4(xyz: str, charge: int = 0, multiplicity: int = 1, threads: int = 4, task: str = "sp", psi_method: str = "b3lyp", psi_basis: str = "def2-SVP", timeout: int = 600, on_output: Optional[Callable[[str], None]] = None, on_progress: Optional[Callable[[Optional[float], Optional[str]], None]] = None, is_cancelled: Optional[Callable[[], bool]] = None) -> Psi4Result:
    t0 = time.time()
    task = task if task in ("sp", "opt") else "sp"
    threads = max(1, min(int(threads or 4), 8))
    log, result_xyz, rc = _run_psi4_script(xyz, charge, multiplicity, psi_method, psi_basis, task, threads, timeout, on_output, on_progress, is_cancelled)
    energy = _parse_energy(log)
    wall = time.time() - t0
    if len(log) > RESULT_LOG_LIMIT:
        log = log[-RESULT_LOG_LIMIT:]
    return Psi4Result(energy=energy, log=log, result_xyz=result_xyz, wall_time=wall, returncode=rc, success=(rc == 0 and energy is not None))
