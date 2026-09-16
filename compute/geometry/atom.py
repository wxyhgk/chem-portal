"""原子与 XYZ 解析"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .elements import normalize_symbol


@dataclass
class Atom:
    index: int            # 1 基，与 XYZ 行号对应
    element: str
    xyz: tuple
    neighbors: list = field(default_factory=list)  # 1 基邻居，由 bonds.build_bonds 填充
    hybrid: Optional[str] = None
    angle_sum: Optional[float] = None
    max_angle: Optional[float] = None
    spiro: bool = False

    @property
    def cn(self) -> int:
        """配位数"""
        return len(self.neighbors)

    def neighbor_formula(self, atoms: list) -> str:
        counts: dict = {}
        for n in self.neighbors:
            e = atoms[n - 1].element
            counts[e] = counts.get(e, 0) + 1
        return "".join(f"{e}{c}" for e, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def parse_xyz(text: str, frame: int = -1) -> list:
    """解析 XYZ（多帧取第 frame 帧，默认最后一帧），返回 [Atom, ...]"""
    lines = (text or "").splitlines()
    frames, i = [], 0
    while i < len(lines):
        head = lines[i].strip()
        if not head:
            i += 1
            continue
        if not head.isdigit():
            break
        n = int(head)
        body = lines[i + 2 : i + 2 + n]
        if len(body) < n:
            break
        frames.append(body)
        i += 2 + n
    if not frames:
        raise ValueError("XYZ 解析失败：未找到帧头（原子数一行）")
    atoms = []
    for k, line in enumerate(frames[frame], start=1):
        p = line.split()
        atoms.append(Atom(index=k, element=normalize_symbol(p[0]), xyz=(float(p[1]), float(p[2]), float(p[3]))))
    return atoms


def formula(atoms: list) -> str:
    counts: dict = {}
    for a in atoms:
        counts[a.element] = counts.get(a.element, 0) + 1
    return " ".join(f"{e}{c}" for e, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def heavy_count(atoms: list, idxs) -> int:
    return sum(1 for i in idxs if atoms[i - 1].element != "H")
