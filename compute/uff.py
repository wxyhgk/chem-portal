"""UFF 执行器：RDKit 全元素力场（能量单位 kcal/mol），sp / opt。
输入为纯坐标 XYZ（无键级），内部经键感知补全；无子进程，取消在优化轮次之间检查。
"""
import time

from .base import ExecResult, Hooks, JobSpec

OPT_ROUNDS = 10
ITERS_PER_ROUND = 50


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


def run_uff(spec: JobSpec, hooks: Hooks, opt_rounds: int = OPT_ROUNDS, iters_per_round: int = ITERS_PER_ROUND) -> ExecResult:
    t0 = time.time()
    lines: list = []

    def emit(s: str):
        lines.append(s)
        hooks.on_output(s)

    def finish(status: str, energy, result_xyz) -> ExecResult:
        return ExecResult(status, energy, "\n".join(lines), result_xyz, time.time() - t0)

    try:
        from rdkit.Chem import AllChem
    except ImportError:
        emit("RDKit 未安装")
        return finish("failed", None, None)
    try:
        mol = _mol_from_xyz(spec.xyz, spec.charge)
        ff = AllChem.UFFGetMoleculeForceField(mol)
        if ff is None:
            emit("UFF 无可用参数（该元素组合不支持）")
            return finish("failed", None, None)
        if spec.task != "opt":
            e = ff.CalcEnergy()
            emit(f"UFF single-point energy: {e:.6f} kcal/mol")
            return finish("done", e, _xyz_of(mol, f"UFF/sp E={e:.6f}"))
        frames = [_xyz_of(mol, f"UFF/opt start E={ff.CalcEnergy():.6f}")]
        energy = None
        for r in range(max(1, opt_rounds)):
            if hooks.is_cancelled():
                emit("[CANCELLED by user]")
                return finish("cancelled", energy, "\n".join(frames))
            rc = ff.Minimize(maxIts=max(1, iters_per_round))
            energy = ff.CalcEnergy()
            emit(f"UFF round {r + 1}/{opt_rounds} E={energy:.6f} rc={rc}")
            frames.append(_xyz_of(mol, f"UFF/opt round {r + 1} E={energy:.6f}"))
            hooks.on_progress(energy, "\n".join(frames))
            if rc == 0:
                emit("UFF converged")
                break
        return finish("done" if energy is not None else "failed", energy, "\n".join(frames))
    except Exception as e:
        emit(f"UFF error: {e}")
        return finish("failed", None, None)
