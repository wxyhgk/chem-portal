"""分子几何分析（只用坐标，不需要键级）：连键 → 杂化（sp/sp2/sp3）→ 螺原子。

含硼分子用 RDKit 的键感知常出错，这里改用共价半径连键 + 键角判断，对 B/N 掺杂稠环稳定。
输入可以是单帧或多帧 XYZ（轨迹默认取最后一帧）。

命令行：python -m compute.geometry mol.xyz
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field
from typing import Optional

# 共价半径（Å，Cordero 2008）
COVALENT_RADII = {
    "H": 0.31, "B": 0.84, "C": 0.76, "N": 0.71, "O": 0.66, "F": 0.57,
    "Si": 1.11, "P": 1.07, "S": 1.05, "Cl": 1.02, "Br": 1.20, "I": 1.39,
}
DEFAULT_RADIUS = 0.80
BOND_TOL = 0.45       # 成键判据：d ≤ r1 + r2 + BOND_TOL
PLANAR_ANGLE_SUM = 350.0  # 三配位键角和 ≥ 此值视为平面（sp2）
LINEAR_ANGLE = 155.0      # 二配位键角 ≥ 此值视为线性（sp）
MAX_RING = 12             # 螺原子判定时搜索的最大环尺寸

# 正常配位数上限，超出说明坐标有问题（ETKDG 初始结构常见：氢挤到邻近碳上）
MAX_VALENCE = {"H": 1, "F": 1, "Cl": 1, "Br": 1, "I": 1, "O": 2, "N": 4, "B": 4, "C": 4, "S": 6, "P": 5}
SHORT_BOND_RATIO = 0.75   # 键长 < 共价半径和 × 此值 视为过短


@dataclass
class Atom:
    index: int            # 1 基，与 XYZ 行号对应
    element: str
    xyz: tuple
    neighbors: list = field(default_factory=list)  # 1 基邻居
    hybrid: Optional[str] = None
    angle_sum: Optional[float] = None
    max_angle: Optional[float] = None
    spiro: bool = False

    @property
    def cn(self) -> int:
        return len(self.neighbors)

    def neighbor_formula(self, atoms) -> str:
        counts: dict = {}
        for n in self.neighbors:
            counts[atoms[n - 1].element] = counts.get(atoms[n - 1].element, 0) + 1
        return "".join(f"{e}{c}" for e, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def _norm_symbol(s: str) -> str:
    return s[:1].upper() + s[1:].lower()


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
        atoms.append(Atom(index=k, element=_norm_symbol(p[0]), xyz=(float(p[1]), float(p[2]), float(p[3]))))
    return atoms


def _dist(a: Atom, b: Atom) -> float:
    return math.dist(a.xyz, b.xyz)


def build_bonds(atoms: list, tol: float = BOND_TOL) -> None:
    """按共价半径连键，结果写进 Atom.neighbors"""
    radii = [COVALENT_RADII.get(a.element, DEFAULT_RADIUS) for a in atoms]
    for i in range(len(atoms)):
        for j in range(i + 1, len(atoms)):
            d = _dist(atoms[i], atoms[j])
            if 0.4 < d <= radii[i] + radii[j] + tol:
                atoms[i].neighbors.append(j + 1)
                atoms[j].neighbors.append(i + 1)


def _angle(center: Atom, a: Atom, b: Atom) -> float:
    v1 = [a.xyz[k] - center.xyz[k] for k in range(3)]
    v2 = [b.xyz[k] - center.xyz[k] for k in range(3)]
    n1 = math.sqrt(sum(x * x for x in v1)) or 1e-9
    n2 = math.sqrt(sum(x * x for x in v2)) or 1e-9
    cos = max(-1.0, min(1.0, sum(v1[k] * v2[k] for k in range(3)) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def classify(atoms: list) -> None:
    """按配位数与键角写入 Atom.hybrid / angle_sum / max_angle"""
    for a in atoms:
        nb = [atoms[i - 1] for i in a.neighbors]
        angles = [_angle(a, nb[i], nb[j]) for i in range(len(nb)) for j in range(i + 1, len(nb))]
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


def _shortest_path(atoms: list, start: int, goal: int, banned: int, max_len: int) -> Optional[list]:
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
    """经过 idx 的环（每对邻居各取最短环），返回原子集合列表"""
    nb = atoms[idx - 1].neighbors
    rings = []
    for x in range(len(nb)):
        for y in range(x + 1, len(nb)):
            path = _shortest_path(atoms, nb[x], nb[y], banned=idx, max_len=max_ring - 1)
            if path:
                rings.append(set(path) | {idx})
    return rings


def mark_spiro(atoms: list, max_ring: int = MAX_RING) -> None:
    """螺原子：存在两个环只共用该原子（共用一条边的是稠合，不算）"""
    for a in atoms:
        if a.cn < 4:
            continue
        rings = rings_through(atoms, a.index, max_ring)
        a.spiro = any(rings[i] & rings[j] == {a.index} for i in range(len(rings)) for j in range(i + 1, len(rings)))


def analyze(xyz: str, frame: int = -1) -> list:
    """XYZ → [Atom]（已连键、已判杂化、已标螺原子）"""
    atoms = parse_xyz(xyz, frame)
    build_bonds(atoms)
    classify(atoms)
    mark_spiro(atoms)
    return atoms


def sp3_atoms(atoms: list, heavy_only: bool = True) -> list:
    return [a for a in atoms if a.hybrid == "sp3" and (not heavy_only or a.element != "H")]


def spiro_list(atoms: list) -> list:
    return [a for a in atoms if a.spiro]


def ring_sizes_at(atoms: list, idx: int, max_ring: int = MAX_RING) -> list:
    """经过某原子的各环大小（升序），螺芴的螺碳为 [5, 5]"""
    return sorted(len(r) for r in rings_through(atoms, idx, max_ring))


def neighborhood(atoms: list, idx: int, depth: int = 2) -> list:
    """idx 周围 depth 根键以内的原子（不含自身），用于看 sp3 中心附近的环境"""
    seen, frontier = {idx}, {idx}
    for _ in range(depth):
        nxt = {n for i in frontier for n in atoms[i - 1].neighbors} - seen
        seen |= nxt
        frontier = nxt
    return sorted(seen - {idx})


def structure_warnings(atoms: list) -> list:
    """坐标是否合理：超配位、孤立原子、键长过短。ETKDG 初始结构常不合理，判断杂化应使用优化后结构。"""
    warns = []
    for a in atoms:
        limit = MAX_VALENCE.get(a.element)
        if limit is not None and a.cn > limit:
            nb = ", ".join(f"#{i}{atoms[i - 1].element} {_dist(a, atoms[i - 1]):.2f}Å" for i in a.neighbors)
            warns.append(f"#{a.index}{a.element} {a.cn} 配位（上限 {limit}）：{nb}")
        if a.cn == 0:
            warns.append(f"#{a.index}{a.element} 与任何原子都不成键（坐标异常或分子已解离）")
    for a in atoms:
        for b in a.neighbors:
            if b <= a.index:
                continue
            other = atoms[b - 1]
            expect = COVALENT_RADII.get(a.element, DEFAULT_RADIUS) + COVALENT_RADII.get(other.element, DEFAULT_RADIUS)
            d = _dist(a, other)
            if d < expect * SHORT_BOND_RATIO:
                warns.append(f"#{a.index}{a.element}-#{b}{other.element} 键长仅 {d:.2f}Å（正常约 {expect:.2f}Å）")
    return warns


def formula(atoms: list) -> str:
    counts: dict = {}
    for a in atoms:
        counts[a.element] = counts.get(a.element, 0) + 1
    return " ".join(f"{e}{c}" for e, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])))


def summarize(xyz: str, frame: int = -1) -> str:
    """一行摘要 + 每个 sp3 重原子的明细（螺原子标 ★）"""
    atoms = analyze(xyz, frame)
    sp3 = sp3_atoms(atoms)
    spiro = [a for a in sp3 if a.spiro]
    warns = structure_warnings(atoms)
    head = f"{len(atoms)} 原子 {formula(atoms)} · sp3 重原子 {len(sp3)} 个 · 螺原子 {len(spiro)} 个"
    lines = [head]
    for a in sp3:
        extra = f"★ 螺原子 环 {'+'.join(str(s) for s in ring_sizes_at(atoms, a.index))} 元" if a.spiro else ""
        lines.append(
            f"  #{a.index:<4} {a.element:<2} 配位 {a.cn}  键角和 {a.angle_sum:6.1f}°  邻居 {a.neighbor_formula(atoms):<8}" + extra
        )
    if warns:
        lines.append(f"  ⚠ 结构可疑 {len(warns)} 处（判断请用优化后结构）：")
        lines += [f"    {w}" for w in warns[:5]]
        if len(warns) > 5:
            lines.append(f"    …… 其余 {len(warns) - 5} 处")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys

    for path in sys.argv[1:]:
        print(f"== {path}")
        print(summarize(open(path).read()))
