"""可整体高亮的片段：在螺原子处或非环单键处断开，取挂在主体外面的环系"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .atom import formula, heavy_count
from .graph import components_excluding, has_ring, reachable
from .planes import tilt_between

MIN_HEAVY = 5   # 小于此重原子数的片段忽略（甲基、叔丁基等）
MAX_OUT = 20    # 最多返回的片段数


@dataclass
class Fragment:
    kind: str                         # spiro（螺原子处断开）/ bond（单键处断开）
    anchor: int                       # 片段内与主体相连的原子
    partner: Optional[int]            # 主体一侧的原子（bond 时）
    indexes: list                     # 片段全部原子（1 基，含 anchor）
    heavy: int = 0
    formula: str = ""
    tilt_deg: Optional[float] = None  # 与主体平面夹角：0 共面，90 垂直


def fragments(atoms: list, min_heavy: int = MIN_HEAVY, max_out: int = MAX_OUT) -> list:
    all_idx = set(range(1, len(atoms) + 1))
    out, seen = [], set()

    def add(kind: str, anchor: int, partner: Optional[int], idxs: set):
        # 只要含环的挂接单元：甲基/叔丁基这类没有环，直接跳过
        if heavy_count(atoms, idxs) < min_heavy or not has_ring(atoms, idxs):
            return
        key = frozenset(idxs)
        if key in seen:
            return
        seen.add(key)
        out.append(
            Fragment(
                kind=kind, anchor=anchor, partner=partner, indexes=sorted(idxs),
                heavy=heavy_count(atoms, idxs), formula=formula([atoms[i - 1] for i in idxs]),
                tilt_deg=tilt_between(atoms, idxs, all_idx - idxs),
            )
        )

    # 螺原子：删掉它后分成几块，最大的一块是分子主体，其余为挂接片段
    for a in atoms:
        if not a.spiro:
            continue
        comps = sorted(components_excluding(atoms, a.index), key=lambda c: heavy_count(atoms, c), reverse=True)
        for comp in comps[1:]:
            add("spiro", a.index, None, comp | {a.index})

    # 桥键（断开后分子分成两块）：取较小一侧
    for a in atoms:
        if a.element == "H":
            continue
        for b in a.neighbors:
            if b <= a.index or atoms[b - 1].element == "H":
                continue
            side_a = reachable(atoms, a.index, blocked_bond=(a.index, b))
            if b in side_a:
                continue  # 环内的键，断开不分家
            side_b = all_idx - side_a
            if heavy_count(atoms, side_a) <= heavy_count(atoms, side_b):
                add("bond", a.index, b, side_a)
            else:
                add("bond", b, a.index, side_b)

    out.sort(key=lambda f: (-(f.tilt_deg or 0), -f.heavy))
    return out[:max_out]
