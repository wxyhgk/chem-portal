"""螺原子判定：存在两个环只共用该原子（共用一条边的是稠合，不算）"""
from __future__ import annotations

from .graph import MAX_RING, rings_through


def mark_spiro(atoms: list, max_ring: int = MAX_RING) -> None:
    for a in atoms:
        if a.cn < 4:  # 螺原子必为四配位
            continue
        rings = rings_through(atoms, a.index, max_ring)
        a.spiro = any(rings[i] & rings[j] == {a.index} for i in range(len(rings)) for j in range(i + 1, len(rings)))


def spiro_list(atoms: list) -> list:
    return [a for a in atoms if a.spiro]


def ring_sizes_at(atoms: list, idx: int, max_ring: int = MAX_RING) -> list:
    """经过某原子的各环大小（升序）：螺（芴-吖啶）的螺碳为 [5, 6]"""
    return sorted(len(r) for r in rings_through(atoms, idx, max_ring))
