"""最小二乘平面与平面夹角"""
from __future__ import annotations

import math
from typing import Optional


def plane_normal(coords):
    """最小二乘平面法向量（SVD 最小奇异向量）"""
    import numpy as np

    pts = np.array(coords, dtype=float)
    _, _, vh = np.linalg.svd(pts - pts.mean(axis=0), full_matrices=False)
    return vh[2]


def tilt_between(atoms: list, group_a: set, group_b: set) -> Optional[float]:
    """两部分各自拟合平面后的夹角（度）：0 共面 / 90 垂直；重原子少于 3 个返回 None"""
    import numpy as np

    ca = [atoms[i - 1].xyz for i in group_a if atoms[i - 1].element != "H"]
    cb = [atoms[i - 1].xyz for i in group_b if atoms[i - 1].element != "H"]
    if len(ca) < 3 or len(cb) < 3:
        return None
    try:
        cos = abs(float(np.dot(plane_normal(ca), plane_normal(cb))))
        return round(math.degrees(math.acos(max(-1.0, min(1.0, cos)))), 1)
    except Exception:
        return None
