"""API 进程配置（数据库、列表上限）。计算相关配置的唯一来源是 compute.config"""
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/
PROJECT_DIR = BACKEND_DIR.parent
DB_PATH = PROJECT_DIR / "database" / "chem.db"

MAX_JOBS_LIST = 500  # GET /api/jobs 默认条数（前端显式传 limit 拉全量）
LIST_LIMIT_MAX = 20000
