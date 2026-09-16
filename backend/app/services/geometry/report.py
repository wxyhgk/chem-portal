"""任务结构分析：挑结构 → compute.geometry 分析 → 组装接口响应"""
from typing import Optional

from compute.geometry import analyze, formula, fragments, sp3_atoms, spiro_list, structure_warnings

from .serialize import atom_dict, fragment_dict
from .structure import MAX_ATOMS, pick


def report(row: dict) -> Optional[dict]:
    """返回 GeometryReport 结构；没有可用坐标时返回 None，原子过多抛 ValueError"""
    xyz, source = pick(row)
    if not xyz:
        return None
    atoms = analyze(xyz)
    if len(atoms) > MAX_ATOMS:
        raise ValueError(f"原子数 {len(atoms)} 超过 {MAX_ATOMS}，暂不支持分析")
    return {
        "job_id": row["id"],
        "source": source,
        "natoms": len(atoms),
        "formula": formula(atoms),
        "sp3": [atom_dict(atoms, a) for a in sp3_atoms(atoms)],
        "spiro_count": len(spiro_list(atoms)),
        "fragments": [fragment_dict(f) for f in fragments(atoms)],
        "warnings": structure_warnings(atoms),
    }
