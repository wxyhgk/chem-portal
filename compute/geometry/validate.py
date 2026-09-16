"""坐标合理性检查：ETKDG 初始结构常不合理，杂化判断应使用优化后结构"""
from __future__ import annotations

from .bonds import distance, expected_length
from .elements import MAX_VALENCE

SHORT_BOND_RATIO = 0.75  # 键长 < 共价半径和 × 此值 视为过短


def structure_warnings(atoms: list) -> list:
    warns = []
    for a in atoms:
        limit = MAX_VALENCE.get(a.element)
        if limit is not None and a.cn > limit:
            nb = ", ".join(f"#{i}{atoms[i - 1].element} {distance(a, atoms[i - 1]):.2f}Å" for i in a.neighbors)
            warns.append(f"#{a.index}{a.element} {a.cn} 配位（上限 {limit}）：{nb}")
        if a.cn == 0:
            warns.append(f"#{a.index}{a.element} 与任何原子都不成键（坐标异常或分子已解离）")
    for a in atoms:
        for b in a.neighbors:
            if b <= a.index:
                continue
            other = atoms[b - 1]
            expect, d = expected_length(a, other), distance(a, other)
            if d < expect * SHORT_BOND_RATIO:
                warns.append(f"#{a.index}{a.element}-#{b}{other.element} 键长仅 {d:.2f}Å（正常约 {expect:.2f}Å）")
    return warns
