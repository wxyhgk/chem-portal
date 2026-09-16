"""compute.geometry 的结果 → 接口字段（GeometryAtom / GeometryFragment）"""
from compute.geometry import ring_sizes_at


def atom_dict(atoms: list, a) -> dict:
    return {
        "index": a.index,
        "element": a.element,
        "cn": a.cn,
        "hybrid": a.hybrid,
        "angle_sum": round(a.angle_sum, 1) if a.angle_sum is not None else None,
        "spiro": a.spiro,
        "ring_sizes": ring_sizes_at(atoms, a.index) if a.spiro else [],
        "neighbors": a.neighbor_formula(atoms),
    }


def fragment_dict(f) -> dict:
    return {
        "kind": f.kind,
        "anchor": f.anchor,
        "partner": f.partner,
        "indexes": f.indexes,
        "heavy": f.heavy,
        "formula": f.formula,
        "tilt_deg": f.tilt_deg,
    }
