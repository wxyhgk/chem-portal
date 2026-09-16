"""把各步串起来：XYZ → 连键 → 杂化 → 螺原子；以及文字摘要"""
from __future__ import annotations

from .atom import formula, parse_xyz
from .bonds import build_bonds
from .fragments import fragments
from .hybridization import classify
from .spiro import mark_spiro, ring_sizes_at, spiro_list
from .validate import structure_warnings

LOG_WARN_PREVIEW = 5


def analyze(xyz: str, frame: int = -1) -> list:
    """XYZ → [Atom]（已连键、已判杂化、已标螺原子）"""
    atoms = parse_xyz(xyz, frame)
    build_bonds(atoms)
    classify(atoms)
    mark_spiro(atoms)
    return atoms


def sp3_atoms(atoms: list, heavy_only: bool = True) -> list:
    return [a for a in atoms if a.hybrid == "sp3" and (not heavy_only or a.element != "H")]


def summarize(xyz: str, frame: int = -1) -> str:
    """一行摘要 + 每个 sp3 重原子的明细（螺原子标 ★）+ 挂接片段 + 结构检查"""
    atoms = analyze(xyz, frame)
    sp3, spiro, frags = sp3_atoms(atoms), spiro_list(atoms), fragments(atoms)
    warns = structure_warnings(atoms)
    lines = [f"{len(atoms)} 原子 {formula(atoms)} · sp3 重原子 {len(sp3)} 个 · 螺原子 {len(spiro)} 个 · 挂接片段 {len(frags)} 个"]
    for a in sp3:
        extra = f"★ 螺原子 环 {'+'.join(str(s) for s in ring_sizes_at(atoms, a.index))} 元" if a.spiro else ""
        lines.append(f"  #{a.index:<4} {a.element:<2} 配位 {a.cn}  键角和 {a.angle_sum:6.1f}°  邻居 {a.neighbor_formula(atoms):<8}" + extra)
    for f in frags:
        conn = f"螺原子 #{f.anchor}" if f.kind == "spiro" else f"单键 #{f.anchor}–#{f.partner}"
        lines.append(f"  片段 {f.formula:<14} {f.heavy:>3} 重原子 · 与主体夹角 {f.tilt_deg}° · {conn}")
    if warns:
        lines.append(f"  ⚠ 结构可疑 {len(warns)} 处（判断请用优化后结构）：")
        lines += [f"    {w}" for w in warns[:LOG_WARN_PREVIEW]]
        if len(warns) > LOG_WARN_PREVIEW:
            lines.append(f"    …… 其余 {len(warns) - LOG_WARN_PREVIEW} 处")
    return "\n".join(lines)
