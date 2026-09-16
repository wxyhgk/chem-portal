"""分子图上的通用算法（与化学无关）：路径、可达集、环、连通块"""
from __future__ import annotations

from collections import deque
from typing import Optional

MAX_RING = 12  # 找环时搜索的最大环尺寸


def shortest_path(atoms: list, start: int, goal: int, banned: int, max_len: int) -> Optional[list]:
    """在删掉 banned 的图上找 start→goal 最短路径（1 基索引）"""
    prev = {start: None}
    q = deque([(start, 0)])
    while q:
        cur, d = q.popleft()
        if cur == goal:
            path, node = [], cur
            while node is not None:
                path.append(node)
                node = prev[node]
            return path
        if d >= max_len:
            continue
        for nxt in atoms[cur - 1].neighbors:
            if nxt != banned and nxt not in prev:
                prev[nxt] = cur
                q.append((nxt, d + 1))
    return None


def rings_through(atoms: list, idx: int, max_ring: int = MAX_RING) -> list:
    """经过 idx 的环：删掉 idx 后每对邻居之间若仍连通，该最短路径 + idx 即一个环"""
    nb = atoms[idx - 1].neighbors
    rings = []
    for x in range(len(nb)):
        for y in range(x + 1, len(nb)):
            path = shortest_path(atoms, nb[x], nb[y], banned=idx, max_len=max_ring - 1)
            if path:
                rings.append(set(path) | {idx})
    return rings


def reachable(atoms: list, start: int, blocked_atom: int = 0, blocked_bond: tuple = ()) -> set:
    """从 start 出发能到达的原子集合，可屏蔽一个原子或一条键"""
    seen, stack = {start}, [start]
    while stack:
        x = stack.pop()
        for y in atoms[x - 1].neighbors:
            if y == blocked_atom or (x, y) == blocked_bond or (y, x) == blocked_bond or y in seen:
                continue
            seen.add(y)
            stack.append(y)
    return seen


def components_excluding(atoms: list, idx: int) -> list:
    """删掉 idx 后剩余部分的连通块"""
    rest = set(range(1, len(atoms) + 1)) - {idx}
    comps = []
    while rest:
        comp = reachable(atoms, next(iter(rest)), blocked_atom=idx)
        rest -= comp
        comps.append(comp)
    return comps


def has_ring(atoms: list, idxs: set) -> bool:
    """子图内边数 ≥ 点数即含环"""
    edges = sum(1 for i in idxs for j in atoms[i - 1].neighbors if j in idxs and j > i)
    return edges >= len(idxs)


def neighborhood(atoms: list, idx: int, depth: int = 2) -> list:
    """idx 周围 depth 根键以内的原子（不含自身）"""
    seen, frontier = {idx}, {idx}
    for _ in range(depth):
        nxt = {n for i in frontier for n in atoms[i - 1].neighbors} - seen
        seen |= nxt
        frontier = nxt
    return sorted(seen - {idx})
