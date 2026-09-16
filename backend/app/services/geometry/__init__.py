"""任务结构分析（薄适配层）：structure 挑结构、serialize 转接口字段、report 组装响应"""
from .report import report
from .structure import MAX_ATOMS, pick

__all__ = ["report", "pick", "MAX_ATOMS"]
