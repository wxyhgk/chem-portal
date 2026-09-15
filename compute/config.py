"""计算相关配置（唯一来源）：均可由环境变量覆盖，API 进程与测试共用"""
import os
import re

XTB_BIN = os.getenv("XTB_BIN", "/root/Software/xtb/xtb_v6.7.1/bin/xtb")
PSI4_PYTHON = os.getenv("PSI4_PYTHON", "/root/micromamba/envs/chem/bin/python")

# 超时（秒）：~150 原子 GFN2 opt 600s 跑不完，默认放宽到 1 小时
XTB_TIMEOUT = int(os.getenv("XTB_TIMEOUT", "3600"))
PSI4_TIMEOUT = int(os.getenv("PSI4_TIMEOUT", "3600"))

# 同时运行任务总数（调度器按它限流，psi4 内存按它分摊）；BATCH_CONCURRENCY 为旧名，仍兼容
JOB_CONCURRENCY = max(1, int(os.getenv("JOB_CONCURRENCY", os.getenv("BATCH_CONCURRENCY", "6"))))

RESULT_LOG_LIMIT = 12000  # 落库日志上限（保留开头 + 结尾）；xtb 去掉引用 banner 后单点日志约 9KB，可完整保存
RESULT_XYZ_LIMIT = 200000  # 落库结果轨迹上限（按帧截断）
PROGRESS_XYZ_LIMIT = 100000  # 运行中推送的轨迹上限


def _default_psi4_memory() -> str:
    """每进程内存 = 物理内存 80% ÷ 同时运行任务数，封顶 16GB、至少 2GB（机器无 swap，防止并发 psi4 撑爆内存）"""
    try:
        with open("/proc/meminfo") as f:
            kb = next(int(line.split()[1]) for line in f if line.startswith("MemTotal:"))
        return f"{max(2, min(16, int(kb / 1024 / 1024 * 0.8 / JOB_CONCURRENCY)))}GB"
    except Exception:
        return "4GB"


# psi4 每进程内存上限；大基组/MP2 内存不足会退到磁盘 I/O。未设置或格式非法时自动计算
PSI4_MEMORY = os.getenv("PSI4_MEMORY", "").strip()
if not re.fullmatch(r"\d+(\.\d+)?\s*(MB|GB|MiB|GiB)", PSI4_MEMORY):
    PSI4_MEMORY = _default_psi4_memory()
