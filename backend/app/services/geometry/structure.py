"""从任务行里挑出最值得分析的结构"""
from typing import Optional

MAX_ATOMS = 2000  # 连键为 O(n²)，超大体系直接拒绝而不是拖住接口

SOURCES = (("result_xyz", "result"), ("progress_xyz", "progress"), ("input_xyz", "input"))


def pick(row: dict) -> tuple:
    """优先用优化结果，其次运行中轨迹，最后输入结构。返回 (xyz, source)；都没有则 ("", "input")"""
    for column, source in SOURCES:
        xyz = row.get(column)
        if xyz and xyz.strip():
            return xyz, source
    return "", "input"
