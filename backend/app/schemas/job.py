"""API 请求模型：直接使用 shared 共享契约（运行时 PYTHONPATH 需包含项目根目录）"""
from shared.schemas.job import BatchCreate as BatchIn
from shared.schemas.job import JobCreate as JobIn
from shared.schemas.job import normalize_job_row

__all__ = ["BatchIn", "JobIn", "normalize_job_row"]
