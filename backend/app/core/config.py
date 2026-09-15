import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/
PROJECT_DIR = BACKEND_DIR.parent
DB_PATH = PROJECT_DIR / "database" / "chem.db"
FRONTEND_DIR = PROJECT_DIR / "frontend"

XTB_BIN = os.getenv("XTB_BIN", "/root/Software/xtb/xtb_v6.7.1/bin/xtb")
REDIS_URL = os.getenv("REDIS_URL", "")

MAX_JOBS_LIST = 500
# 同时运行任务总数（单个 + 批量，API 进程内调度器统一执行；默认 6，批量页 4 线程 × 6 = 24 核）
# BATCH_CONCURRENCY 为旧名，仍兼容
JOB_CONCURRENCY = max(1, int(os.getenv("JOB_CONCURRENCY", os.getenv("BATCH_CONCURRENCY", "6"))))
# 超时（秒）：~150 原子 GFN2 opt 600s 跑不完，默认放宽到 1 小时
XTB_TIMEOUT = int(os.getenv("XTB_TIMEOUT", "3600"))
PSI4_TIMEOUT = int(os.getenv("PSI4_TIMEOUT", "3600"))
RESULT_LOG_LIMIT = 8000
RESULT_XYZ_LIMIT = 200000

def truncate_xyz_at_frame_boundary(txt: str, limit: int = RESULT_XYZ_LIMIT) -> str:
    if len(txt) <= limit: return txt
    # 在 limit 内找最后一个完整帧边界：下一帧以 "^\\d+\\s*$" 开头
    cut = txt[:limit]
    # 回溯找最后一个 "\\n<number>\\n" 后的换行
    import re
    # 找所有帧头位置
    for m in reversed(list(re.finditer(r"\n\d+\s*\n", cut))):
        # 确保该帧头后有完整的一帧（n+2 行）
        # 直接截到该帧头前（保留上一帧完整）
        return cut[:m.start()+1]
    return cut[:limit - (limit % 1024)]
