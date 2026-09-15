"""任务 HTTP 接口：只做请求/响应适配，业务在 services"""
import asyncio
import hashlib
import json
import os
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ValidationError

from compute import psi4 as compute_psi4
from compute.config import XTB_BIN

from ..core.config import LIST_LIMIT_MAX, MAX_JOBS_LIST
from ..schemas.job import BatchIn, JobIn
from ..services import chem, job_service

router = APIRouter(prefix="/api", tags=["jobs"])

SDF_MAX_CHARS = 200000
SSE_MAX_TICKS = 7200  # 0.5s 一次，上限 1 小时
SSE_FIELDS = ("id", "status", "result_energy", "wall_time", "result_log", "progress_energy", "progress_xyz")


class EmbedIn(BaseModel):
    sdf: str


class ClearIn(BaseModel):
    statuses: list = ["done", "failed"]


@router.post("/embed")
def embed_sdf(inp: EmbedIn):
    """SDF → 3D XYZ（含形式电荷、标题）；多分子 SDF 只取第一个（批量由前端按 $$$$ 拆分逐个调用）"""
    sdf = (inp.sdf or "")[:SDF_MAX_CHARS]
    if "M  END" not in sdf:
        raise HTTPException(400, "not an SDF block (missing M  END)")
    try:
        return chem.sdf_to_xyz(sdf)
    except ImportError:
        raise HTTPException(500, "RDKit 未安装")
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/jobs")
def create_job(job: JobIn):
    """单个任务入队；与批量共用调度器并发上限，单个提交优先认领"""
    return {"id": job_service.create_job(job), "status": "queued"}


@router.post("/jobs/batch")
def create_batch(inp: BatchIn):
    """批量建任务：共用计算参数，逐分子入队"""
    try:
        jobs = [inp.to_job(it) for it in inp.items]
    except ValidationError as e:
        raise HTTPException(422, str(e)[:500])
    batch_id, ids = job_service.create_batch(jobs)
    return {"batch_id": batch_id, "ids": ids, "count": len(ids)}


@router.get("/jobs")
def list_jobs(request: Request, show_deleted: int = 0, batch_id: Optional[str] = None, limit: int = MAX_JOBS_LIST):
    """任务列表（轻量字段）。带 ETag：前端每 3s 轮询，内容没变回 304"""
    rows = job_service.list_jobs(max(1, min(limit, LIST_LIMIT_MAX)), bool(show_deleted), batch_id)
    body = json.dumps(rows, ensure_ascii=False, separators=(",", ":")).encode()
    etag = '"' + hashlib.md5(body).hexdigest() + '"'
    headers = {"ETag": etag, "Cache-Control": "no-cache"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=body, media_type="application/json", headers=headers)


@router.get("/batches")
def list_batches(limit: int = 30):
    """最近批次汇总（按状态计数）"""
    return job_service.list_batches(max(1, min(limit, 200)))


@router.post("/jobs/clear")
def clear_jobs(inp: ClearIn):
    """一键清理终态任务（软删进回收站）"""
    return {"cleared": job_service.clear_jobs(inp.statuses)}


@router.post("/jobs/{jid}/cancel")
def cancel_job(jid: str):
    """取消运行中/排队任务（杀进程，状态 cancelled，保留可见）"""
    status = job_service.cancel_job(jid)
    if status is None:
        raise HTTPException(404, "job not found")
    return {"id": jid, "status": status}


@router.post("/jobs/{jid}/restore")
def restore_job(jid: str):
    """从回收站恢复"""
    if not job_service.restore_job(jid):
        raise HTTPException(404, "job not found")
    return {"id": jid, "deleted": 0}


@router.delete("/jobs/{jid}")
def delete_job(jid: str, hard: int = 0):
    """软删进回收站（未结束的先取消）；hard=1 物理删除"""
    if not job_service.remove_job(jid, hard=bool(hard)):
        raise HTTPException(404, "job not found")
    return {"id": jid, "deleted": 1, "hard": bool(hard)}


@router.get("/jobs/{jid}/image.svg")
def job_image(jid: str):
    """任务分子卡片图：终态长缓存，运行中不缓存"""
    row = job_service.get_job(jid)
    svg = chem.job_card_svg(row) if row else None
    if svg is None:
        return Response(content=chem.PLACEHOLDER_SVG, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})
    terminal = row.get("status") in ("done", "failed", "cancelled")
    return Response(content=svg, media_type="image/svg+xml", headers={"Cache-Control": "public, max-age=86400" if terminal else "no-store"})


@router.get("/jobs/{jid}")
def get_job(jid: str):
    row = job_service.get_job(jid)
    # 历史行为：不存在时 200 + error（前端按有无 id 判断）；改 404 需前后端一起调整
    return row if row else {"error": "not found"}


@router.get("/jobs/{jid}/events")
async def job_events(jid: str, request: Request):
    """SSE：运行中任务的 status/energy/log/轨迹实时推送，结束或断连即关流"""

    async def gen():
        last = None
        for _ in range(SSE_MAX_TICKS):
            if await request.is_disconnected():
                break
            row = job_service.get_job(jid)
            if row is None:
                yield "event: gone\ndata: {}\n\n"
                break
            payload = json.dumps({k: row.get(k) for k in SSE_FIELDS}, ensure_ascii=False)
            if payload != last:
                last = payload
                yield f"data: {payload}\n\n"
            if row.get("status") in ("done", "failed", "cancelled"):
                break
            await asyncio.sleep(0.5)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/health")
def health():
    return {"ok": True, "xtb": os.path.exists(XTB_BIN), "psi4": compute_psi4.available()}
