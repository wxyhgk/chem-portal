"""计算执行层：xtb / psi4 / uff 的唯一实现。

只负责计算本身（子进程、输出解析、超时与取消），不接触数据库；
由 backend/app/services/runner.py 调用，通过 Hooks 回传实时输出与进度。
"""
from .base import ExecResult, Hooks, JobSpec
from .psi4 import run_psi4
from .uff import run_uff
from .xtb import METHOD_FLAGS, run_xtb


def run(spec: JobSpec, hooks: Hooks) -> ExecResult:
    """按 spec.method 分派到对应执行器；不支持的方法抛 ValueError"""
    if spec.method == "psi4":
        return run_psi4(spec, hooks)
    if spec.method == "uff":
        return run_uff(spec, hooks)
    if spec.method in METHOD_FLAGS:
        return run_xtb(spec, hooks)
    raise ValueError(f"不支持的方法: {spec.method}")


__all__ = ["ExecResult", "Hooks", "JobSpec", "run", "run_psi4", "run_uff", "run_xtb"]
