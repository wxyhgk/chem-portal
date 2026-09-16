"""连键与几何量：距离、键角、按共价半径成键"""
from __future__ import annotations

import math

from .atom import Atom
from .elements import radius

BOND_TOL = 0.45  # 成键判据：d ≤ r1 + r2 + BOND_TOL
MIN_BOND = 0.4   # 小于此距离视为坐标重叠，不成键


def distance(a: Atom, b: Atom) -> float:
    return math.dist(a.xyz, b.xyz)


def angle(center: Atom, a: Atom, b: Atom) -> float:
    """a–center–b 夹角（度）"""
    v1 = [a.xyz[k] - center.xyz[k] for k in range(3)]
    v2 = [b.xyz[k] - center.xyz[k] for k in range(3)]
    n1 = math.sqrt(sum(x * x for x in v1)) or 1e-9
    n2 = math.sqrt(sum(x * x for x in v2)) or 1e-9
    cos = max(-1.0, min(1.0, sum(v1[k] * v2[k] for k in range(3)) / (n1 * n2)))
    return math.degrees(math.acos(cos))


def expected_length(a: Atom, b: Atom) -> float:
    return radius(a.element) + radius(b.element)


def build_bonds(atoms: list, tol: float = BOND_TOL) -> None:
    """按共价半径连键，结果写进 Atom.neighbors"""
    radii = [radius(a.element) for a in atoms]
    for i in range(len(atoms)):
        for j in range(i + 1, len(atoms)):
            d = distance(atoms[i], atoms[j])
            if MIN_BOND < d <= radii[i] + radii[j] + tol:
                atoms[i].neighbors.append(j + 1)
                atoms[j].neighbors.append(i + 1)
