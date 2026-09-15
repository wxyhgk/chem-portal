import asyncio
import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ValidationError
from ..core.config import MAX_JOBS_LIST
from ..schemas.job import JobIn, BatchIn
from ..services.job_service import create_job as svc_create, list_jobs as svc_list, get_job as svc_get
from ..services import job_service as _svc
svc_cancel = _svc.cancel_job
svc_remove = _svc.remove_job
svc_restore = _svc.restore_job
svc_clear = _svc.clear_jobs
svc_create_batch = _svc.create_batch
svc_list_batches = _svc.list_batches

router = APIRouter(prefix="/api", tags=["jobs"])


class EmbedIn(BaseModel):
    sdf: str


def _rdkit_sdf_to_xyz(sdf: str) -> dict:
    """SDF → 3D XYZ（RDKit ETKDGv3 距离几何 + UFF 快清）；返回 xyz / charge(形式电荷) / name(标题行)；抛 ValueError 说明原因"""
    from rdkit import Chem
    from rdkit.Chem import AllChem
    block = sdf.split("$$$$")[0]
    mol = Chem.MolFromMolBlock(block)
    if mol is None:
        raise ValueError("RDKit 无法解析 SDF")
    charge = Chem.GetFormalCharge(mol)
    name = mol.GetProp("_Name").strip() if mol.HasProp("_Name") else ""
    mol = Chem.AddHs(mol)
    ps = AllChem.ETKDGv3()
    ps.randomSeed = 42
    ps.numThreads = 4
    if AllChem.EmbedMolecule(mol, ps) != 0:
        raise ValueError("ETKDG 嵌入失败（检查成键/价态）")
    try:
        AllChem.UFFOptimizeMolecule(mol, maxIters=100)
    except Exception:
        pass
    xyz = Chem.MolToXYZBlock(mol)
    if not xyz or not xyz.splitlines()[0].strip().isdigit():
        raise ValueError("XYZ 生成为空")
    return {"xyz": xyz, "charge": charge, "name": name}


@router.post("/embed")
def embed_sdf(inp: EmbedIn):
    """SDF → 3D XYZ（含形式电荷、标题），供任务输入预览；多分子 SDF 只取第一个（批量由前端按 $$$$ 拆分逐个调用）"""
    sdf = (inp.sdf or "")[:200000]
    if "M  END" not in sdf:
        raise HTTPException(400, "not an SDF block (missing M  END)")
    try:
        return _rdkit_sdf_to_xyz(sdf)
    except ImportError:
        raise HTTPException(500, "RDKit 未安装")
    except ValueError as e:
        raise HTTPException(422, str(e))

@router.post("/jobs")
def create_job(job: JobIn):
    """单个任务入队；与批量共用调度器并发上限，单个提交优先认领"""
    jid = svc_create(job)
    return {"id": jid, "status": "queued"}

@router.post("/jobs/batch")
def create_batch(inp: BatchIn):
    """批量建任务：共用计算参数，逐分子入队（由调度器按 JOB_CONCURRENCY 限并发）"""
    try:
        jobs = [inp.to_job(it) for it in inp.items]
    except ValidationError as e:
        raise HTTPException(422, str(e)[:500])
    batch_id, ids = svc_create_batch(jobs)
    return {"batch_id": batch_id, "ids": ids, "count": len(ids)}

@router.get("/jobs")
def list_jobs(show_deleted: int = 0, batch_id: Optional[str] = None, limit: int = MAX_JOBS_LIST):
    return svc_list(limit=max(1, min(limit, 5000)), show_deleted=bool(show_deleted), batch_id=batch_id)

@router.get("/batches")
def list_batches(limit: int = 30):
    """最近批次汇总（按状态计数）"""
    return svc_list_batches(limit=max(1, min(limit, 200)))


class ClearIn(BaseModel):
    statuses: list = ["done", "failed"]


@router.post("/jobs/clear")
def clear_jobs(inp: ClearIn):
    """一键清理终态任务（软删进回收站）。返回清理数。"""
    return {"cleared": svc_clear(inp.statuses)}


@router.post("/jobs/{jid}/cancel")
def cancel_job(jid: str):
    """取消运行中/排队任务（杀进程，状态 cancelled，保留可见）"""
    st = svc_cancel(jid)
    if st == "not-found":
        raise HTTPException(404, "job not found")
    return {"id": jid, "status": st}


@router.post("/jobs/{jid}/restore")
def restore_job(jid: str):
    """从回收站恢复"""
    if svc_restore(jid) != "ok":
        raise HTTPException(404, "job not found")
    return {"id": jid, "deleted": 0}


@router.delete("/jobs/{jid}")
def delete_job(jid: str, hard: int = 0):
    """软删进回收站（运行中先取消）；hard=1 物理删除"""
    if svc_remove(jid, hard=bool(hard)) != "ok":
        raise HTTPException(404, "job not found")
    return {"id": jid, "deleted": 1, "hard": bool(hard)}


def _last_frame_xyz(text: str):
    """多帧 xyz 取最后一帧；解析失败返回 None"""
    import re
    if not text or not text.strip():
        return None
    lines = text.strip().splitlines()
    starts = [i for i, l in enumerate(lines) if re.match(r"^\s*\d+\s*$", l)]
    if not starts:
        return text if len(lines) > 2 else None
    i = starts[-1]
    try:
        n = int(lines[i].strip())
    except Exception:
        return None
    frame = lines[i:i + 2 + n]
    if len(frame) < 3:
        return None
    return "\n".join(frame)


def _xyz_to_svg(xyz: str, charge: int, w: int = 240, h: int = 180):
    """XYZ → 2D SVG（RDKit 键感知+平面坐标）；失败返回 None"""
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, rdDetermineBonds, Draw
    except ImportError:
        return None
    try:
        mol = Chem.MolFromXYZBlock(xyz.strip())
        if mol is None:
            return None
        rdDetermineBonds.DetermineBonds(mol, charge=charge or 0)
        AllChem.Compute2DCoords(mol)
        d = Draw.MolDraw2DSVG(w, h)
        d.DrawMolecule(mol)
        d.FinishDrawing()
        return d.GetDrawingText()
    except Exception:
        return None


_PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#f4f4f5"/><text x="120" y="95" text-anchor="middle" font-size="42" fill="#a1a1aa">?</text></svg>'


@router.get("/jobs/{jid}/image.svg")
def job_image(jid: str):
    """任务分子卡片图：终态帧 > 进度帧 > 输入；终态长缓存，运行中不缓存"""
    from fastapi.responses import Response
    row = svc_get(jid)
    svg = None
    if row:
        try:
            charge = int(row.get("charge") or 0)
        except Exception:
            charge = 0
        for txt in (row.get("result_xyz"), row.get("progress_xyz"), row.get("input_xyz")):
            frame = _last_frame_xyz(txt or "")
            if frame:
                svg = _xyz_to_svg(frame, charge)
                if svg:
                    break
    if svg is None:
        return Response(content=_PLACEHOLDER_SVG, media_type="image/svg+xml", headers={"Cache-Control": "no-store"})
    terminal = bool(row) and row.get("status") in ("done", "failed", "cancelled")
    headers = {"Cache-Control": "public, max-age=86400"} if terminal else {"Cache-Control": "no-store"}
    return Response(content=svg, media_type="image/svg+xml", headers=headers)

@router.get("/jobs/{jid}")
def get_job(jid: str):
    row = svc_get(jid)
    if not row:
        return {"error": "not found"}
    return row

@router.get("/jobs/{jid}/events")
async def job_events(jid: str, request: Request):
    """SSE：运行中任务的 result_log/status/energy 实时推送，结束/断连即关流（异步，不占线程池）。"""
    async def gen():
        last = None
        for _ in range(7200):  # 上限 1 小时
            if await request.is_disconnected():
                break
            row = svc_get(jid)
            if row is None:
                yield "event: gone\ndata: {}\n\n"
                break
            payload = json.dumps({k: row.get(k) for k in ("id", "status", "result_energy", "wall_time", "result_log", "progress_energy", "progress_xyz")}, ensure_ascii=False)
            if payload != last:
                last = payload
                yield f"data: {payload}\n\n"
            if row.get("status") in ("done", "failed", "cancelled"):
                break
            await asyncio.sleep(0.5)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
@router.get("/health")
def health():
    import os
    from ..core.config import XTB_BIN, REDIS_URL
    redis_ok = False
    if REDIS_URL:
        try:
            import redis
            redis.from_url(REDIS_URL).ping()
            redis_ok = True
        except Exception:
            pass
    # psi4 是否可用：只查包元数据不 import（import 需 ~6s，会误报不可用）
    psi4_ok = os.path.exists("/root/micromamba/envs/chem/bin/python")
    if psi4_ok:
        try:
            import subprocess
            r = subprocess.run(["/root/micromamba/envs/chem/bin/python", "-c", "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('psi4') else 1)"], capture_output=True, text=True, timeout=5)
            psi4_ok = r.returncode == 0
        except Exception:
            psi4_ok = False
    return {"ok": True, "xtb": os.path.exists(XTB_BIN), "redis": redis_ok, "psi4": psi4_ok, "decoupled": True}
