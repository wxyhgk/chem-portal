"""psi4 执行器：在独立 conda 环境的子进程里运行，sp / opt；psi4.out 实时转发、优化轨迹、超时与取消"""
import os
import re
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

from .base import ExecResult, Hooks, JobSpec, collect_stream
from .config import PSI4_MEMORY, PSI4_PYTHON, PSI4_TIMEOUT, RESULT_XYZ_LIMIT

MAX_THREADS = 8
PROGRESS_EVERY = 2.0


def available() -> bool:
    """psi4 是否可用：只查包元数据不 import（import 需 ~6s，会误报不可用）"""
    if not os.path.exists(PSI4_PYTHON):
        return False
    try:
        r = subprocess.run(
            [PSI4_PYTHON, "-c", "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('psi4') else 1)"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return r.returncode == 0
    except Exception:
        return False


def _xyz_to_psi4_block(xyz: str, charge: int, mult: int) -> str:
    lines = xyz.strip().splitlines()
    if len(lines) >= 3 and lines[0].strip().isdigit():
        try:
            n = int(lines[0].strip())
            coords = lines[2 : 2 + n] if len(lines) >= 2 + n else lines[2:]
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


def _watch_psi4_files(td_path: Path, stop: threading.Event, hooks: Hooks):
    """轮询 psi4.out（新行转 on_output）与轨迹文件；节流调 on_progress(energy, xyz)"""
    energy_rx = re.compile(r"Total Energy\s*=\s*(-?\d+\.\d+)")
    offset = 0
    last_energy = None
    last_sent = (None, -1)
    last_push = time.time()
    while not stop.is_set():
        try:
            out_file = td_path / "psi4.out"
            if out_file.exists():
                text = out_file.read_text(errors="replace")
                new = text[offset:]
                offset = len(text)
                if new.strip():
                    for ln in new.splitlines()[-400:]:
                        hooks.on_output(ln)
                    ms = energy_rx.findall(new)
                    if ms:
                        last_energy = float(ms[-1])
            traj = None
            for cand in ("trajectory.xyz", "psi4_opt_trajectory.xyz", "opt_trajectory.xyz"):
                p = td_path / cand
                if p.exists():
                    t = p.read_text(errors="replace")
                    if t and len(t.strip()) > 10:
                        traj = t
                        break
            now = time.time()
            sig = (last_energy, len(traj) if traj else -1)
            if now - last_push >= PROGRESS_EVERY and sig != last_sent:
                last_sent, last_push = sig, now
                hooks.on_progress(last_energy, traj)
        except Exception:
            pass
        stop.wait(1.0)


def _build_script(spec: JobSpec, task: str, threads: int) -> str:
    mult = spec.multiplicity
    geom_repr = repr(_xyz_to_psi4_block(spec.xyz, spec.charge, mult).strip())
    xyz_repr = repr(spec.xyz.strip())  # 用 repr 避免引号冲突
    method = spec.psi_method.lower()
    psi_method = "scf" if method == "hf" else "mp2" if method == "mp2" else method
    basis = spec.psi_basis or "def2-SVP"
    return f"""
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
                        out.append(f\"step {{step}} {psi_method}/{basis}\")
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


def _parse_energy(log: str) -> Optional[float]:
    try:
        from cclib.io import ccopen

        with tempfile.NamedTemporaryFile(mode="w", suffix=".out", delete=False) as f:
            f.write(log)
            fname = f.name
        try:
            data = ccopen(fname).parse()
            if data and getattr(data, "scfenergies", None):
                last = data.scfenergies[-1]
                return float(last) if isinstance(last, (int, float)) else float(last[-1])
            if data and getattr(data, "mpenergies", None):
                return float(data.mpenergies[-1])
        finally:
            Path(fname).unlink(missing_ok=True)
    except Exception:
        pass
    for rx in (r"FINAL_ENERGY\s+([-\d.]+)", r"Total Energy\s*=\s*([-\d.]+)"):
        m = re.search(rx, log)
        if m:
            try:
                return float(m.group(1))
            except ValueError:
                pass
    return None


def run_psi4(spec: JobSpec, hooks: Hooks, timeout: float = PSI4_TIMEOUT) -> ExecResult:
    t0 = time.time()
    task = spec.task if spec.task in ("sp", "opt") else "sp"
    threads = max(1, min(int(spec.threads or 4), MAX_THREADS))
    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        py_file = td_path / "run_psi4.py"
        py_file.write_text(_build_script(spec, task, threads))
        env = os.environ.copy()
        env["OMP_NUM_THREADS"] = env["MKL_NUM_THREADS"] = str(threads)
        try:
            proc = subprocess.Popen([PSI4_PYTHON, str(py_file)], cwd=td, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)
        except FileNotFoundError:
            return ExecResult("failed", None, f"psi4 python not found: {PSI4_PYTHON}", None, time.time() - t0)
        stop = threading.Event()
        watcher = threading.Thread(target=_watch_psi4_files, args=(td_path, stop, hooks), daemon=True)
        watcher.start()
        try:
            lines, timed_out, cancelled = collect_stream(proc, timeout, hooks.on_output, hooks.is_cancelled)
        finally:
            stop.set()
            watcher.join(timeout=5)
        out = "\n".join(lines)
        if cancelled:
            return ExecResult("cancelled", None, out + "\n[CANCELLED by user]", None, time.time() - t0)
        if timed_out:
            return ExecResult("failed", None, out + f"\n[TIMEOUT {timeout:g}s] psi4 未在时限内结束，已终止（可调 PSI4_TIMEOUT）", None, time.time() - t0)
        psi_out = ""
        out_file = td_path / "psi4.out"
        if out_file.exists():
            try:
                psi_out = out_file.read_text()[-8000:]
            except OSError:
                pass
        combined = out + "\n" + psi_out
        m = re.search(r"XYZ_START\s*(.*?)\s*XYZ_END", combined, flags=re.S)
        result_xyz = m.group(1).strip()[:RESULT_XYZ_LIMIT] if m else None
        energy = _parse_energy(combined)
        ok = proc.returncode == 0 and energy is not None
        return ExecResult("done" if ok else "failed", energy, combined, result_xyz, time.time() - t0)
