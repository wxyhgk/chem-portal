"""分子几何分析（只用坐标，不需要键级）：连键 → 杂化 → 螺原子 → 挂接片段 → 结构检查。

含硼分子用 RDKit 的键感知常出错，这里改用共价半径连键 + 键角判断，对 B/N 掺杂稠环稳定。
输入可以是单帧或多帧 XYZ（轨迹默认取最后一帧）。

模块划分：
    elements       元素数据（共价半径、配位上限）
    atom           Atom / XYZ 解析 / 分子式
    bonds          距离、键角、按共价半径连键
    graph          图算法：路径、环、连通块、邻域（与化学无关）
    hybridization  sp / sp2 / sp3 判断
    spiro          螺原子判定
    planes         最小二乘平面与夹角
    fragments      挂接片段切分
    validate       坐标合理性检查
    report         串联流程与文字摘要

命令行：python -m compute.geometry mol.xyz
"""
from .atom import Atom, formula, heavy_count, parse_xyz
from .bonds import BOND_TOL, build_bonds, distance
from .elements import COVALENT_RADII, MAX_VALENCE
from .fragments import Fragment, fragments
from .graph import MAX_RING, components_excluding, neighborhood, reachable, rings_through, shortest_path
from .hybridization import classify
from .planes import tilt_between
from .report import analyze, sp3_atoms, summarize
from .spiro import mark_spiro, ring_sizes_at, spiro_list
from .validate import structure_warnings

__all__ = [
    "Atom", "Fragment", "COVALENT_RADII", "MAX_VALENCE", "MAX_RING", "BOND_TOL",
    "parse_xyz", "build_bonds", "distance", "formula", "heavy_count",
    "shortest_path", "rings_through", "reachable", "components_excluding", "neighborhood",
    "classify", "mark_spiro", "spiro_list", "ring_sizes_at", "tilt_between",
    "fragments", "structure_warnings", "analyze", "sp3_atoms", "summarize",
]
