"""
UFF 执行器 — RDKit 全元素力场，sp/opt，opt 输出能量轨迹
输入为纯坐标 XYZ（无键级），内部经键感知补全后计算。
"""
import time
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class UffResult:
    energy: Optional[float]
    log: str
    result_xyz: Optional[str]
    wall_time: float
    success: bool


def _mol_from_xyz(xyz: str, charge: int):
    from rdkit import Chem
    from rdkit.Chem import rdDetermineBonds
    mol = Chem.MolFromXYZBlock((xyz or "").strip())
    if mol is None:
        raise ValueError("XYZ 解析失败")
    rdDetermineBonds.DetermineBonds(mol, charge=charge)
    return mol


def _xyz_of(mol, comment: str) -> str:
    from rdkit import Chem
    block = Chem.MolToXYZBlock(mol).strip().splitlines()
    return "\n".join([block[0], comment] + block[2:])


def run_uff(
    xyz: str,
    charge: int = 0,
    task: str = "sp",
    on_output: Optional[Callable[[str], None]] = None,
    on_progress: Optional[Callable[[Optional[float], Optional[str]], None]] = None,
    is_cancelled: Optional[Callable[[], bool]] = None,
    opt_rounds: int = 10,
    iters_per_round: int = 50,
) -> UffResult:
    t0 = time.time()
    lines: list = []

    def emit(s: str):
        lines.append(s)
        if on_output:
            on_output(s)

    def finish(energy, result_xyz, success):
        wall = time.time() - t0
        return UffResult(energy=energy, log="\n".join(lines), result_xyz=result_xyz, wall_time=wall, success=success)

    try:
        from rdkit.Chem import AllChem
    except ImportError:
        emit("RDKit 未安装")
        return finish(None, None, False)
    try:
        mol = _mol_from_xyz(xyz, charge)
        ff = AllChem.UFFGetMoleculeForceField(mol)
        if ff is None:
            emit("UFF 无可用参数（该元素组合不支持）")
            return finish(None, None, False)
        if task != "opt":
            e = ff.CalcEnergy()
            emit(f"UFF single-point energy: {e:.6f} kcal/mol")
            return finish(e, _xyz_of(mol, f"UFF/sp E={e:.6f}"), True)
        frames = [_xyz_of(mol, f"UFF/opt start E={ff.CalcEnergy():.6f}")]
        energy = None
        for r in range(max(1, opt_rounds)):
            if is_cancelled is not None and is_cancelled():
                emit("[CANCELLED by user]")
                return finish(energy, "\n".join(frames), False)
            rc = ff.Minimize(maxIts=max(1, iters_per_round))
            energy = ff.CalcEnergy()
            emit(f"UFF round {r + 1}/{opt_rounds} E={energy:.6f} rc={rc}")
            frames.append(_xyz_of(mol, f"UFF/opt round {r + 1} E={energy:.6f}"))
            if on_progress:
                on_progress(energy, "\n".join(frames))
            if rc == 0:
                emit("UFF converged")
                break
        return finish(energy, "\n".join(frames), energy is not None)
    except Exception as e:
        emit(f"UFF error: {e}")
        return finish(None, None, False)
