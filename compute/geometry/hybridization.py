"""杂化判断：按配位数与键角（不依赖键级）"""
from __future__ import annotations

from .bonds import angle

PLANAR_ANGLE_SUM = 350.0  # 三配位键角和 ≥ 此值视为平面（sp2）
LINEAR_ANGLE = 155.0      # 二配位键角 ≥ 此值视为线性（sp）


def classify(atoms: list) -> None:
    """写入 Atom.hybrid / angle_sum / max_angle"""
    for a in atoms:
        nb = [atoms[i - 1] for i in a.neighbors]
        angles = [angle(a, nb[i], nb[j]) for i in range(len(nb)) for j in range(i + 1, len(nb))]
        a.angle_sum = sum(angles) if angles else None
        a.max_angle = max(angles) if angles else None
        if a.cn >= 4:
            a.hybrid = "sp3"
        elif a.cn == 3:
            # 平面（sp2，如稠环上的 C/B/共轭 N）vs 锥形（sp3，如脂肪胺 N）
            a.hybrid = "sp2" if (a.angle_sum or 0) >= PLANAR_ANGLE_SUM else "sp3"
        elif a.cn == 2:
            if a.element in ("C", "N"):
                a.hybrid = "sp" if (a.max_angle or 0) >= LINEAR_ANGLE else "sp2"
            else:  # O/S 等两配位按 sp3 处理
                a.hybrid = "sp3"
        else:
            a.hybrid = None  # H、卤素等端基不判断
