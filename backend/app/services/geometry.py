"""任务结构分析：取任务的最佳可用结构，交给 compute.geometry 判断 sp3 / 螺原子 / 结构异常"""
from typing import Optional

from compute.geometry import analyze, formula, ring_sizes_at, sp3_atoms, spiro_list, structure_warnings

MAX_ATOMS = 2000  # 连键为 O(n²)，超大体系直接拒绝而不是拖住接口


def pick_structure(row: dict) -> tuple:
    """优先用优化结果，其次运行中轨迹，最后输入结构。返回 (xyz, source)"""
    for xyz, source in ((row.get("result_xyz"), "result"), (row.get("progress_xyz"), "progress"), (row.get("input_xyz"), "input")):
        if xyz and xyz.strip():
            return xyz, source
    return "", "input"


def report(row: dict) -> Optional[dict]:
    """返回 GeometryReport 结构；没有可用坐标时返回 None"""
    xyz, source = pick_structure(row)
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
        "sp3": [
            {
                "index": a.index,
                "element": a.element,
                "cn": a.cn,
                "hybrid": a.hybrid,
                "angle_sum": round(a.angle_sum, 1) if a.angle_sum is not None else None,
                "spiro": a.spiro,
                "ring_sizes": ring_sizes_at(atoms, a.index) if a.spiro else [],
                "neighbors": a.neighbor_formula(atoms),
            }
            for a in sp3_atoms(atoms)
        ],
        "spiro_count": len(spiro_list(atoms)),
        "warnings": structure_warnings(atoms),
    }
