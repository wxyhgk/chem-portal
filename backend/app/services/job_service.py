"""任务业务操作（供路由调用）：建任务 / 批量、查询、取消、回收站。
SQL 在 db.jobs_repo；执行在 services.runner；调度在 services.dispatcher。
"""
from typing import Iterable, Optional

from ..db import jobs_repo
from . import cancellation


def create_job(job) -> str:
    return jobs_repo.insert_job(job)


def create_batch(jobs: Iterable) -> tuple:
    """整批入队，返回 (batch_id, ids)；由调度器按并发上限执行"""
    return jobs_repo.insert_batch(jobs)


def list_jobs(limit: int, show_deleted: bool = False, batch_id: Optional[str] = None) -> list:
    return jobs_repo.list_jobs(limit, show_deleted, batch_id)


def list_batches(limit: int = 30) -> list:
    return jobs_repo.list_batches(limit)


def get_job(jid: str) -> Optional[dict]:
    return jobs_repo.get_job(jid)


def _cancel(jid: str):
    cancellation.request(jid)  # 运行中：执行线程下一次轮询时终止
    jobs_repo.cancel_if_queued(jid)  # 排队中：直接落 cancelled


def cancel_job(jid: str) -> Optional[str]:
    """返回最终语义：cancelled（已受理）/ 已是终态时返回该状态 / 任务不存在返回 None"""
    status = jobs_repo.get_status(jid)
    if status is None or status in jobs_repo.TERMINAL:
        return status
    _cancel(jid)
    return "cancelled"


def remove_job(jid: str, hard: bool = False) -> bool:
    """移入回收站或彻底删除；未结束的任务先取消，避免删除后仍占用计算资源"""
    status = jobs_repo.get_status(jid)
    if status is None:
        return False
    if status not in jobs_repo.TERMINAL:
        _cancel(jid)
    return jobs_repo.hard_delete(jid) if hard else jobs_repo.soft_delete(jid)


def restore_job(jid: str) -> bool:
    return jobs_repo.restore(jid)


def clear_jobs(statuses: Iterable[str]) -> int:
    return jobs_repo.clear_terminal(statuses or [])
