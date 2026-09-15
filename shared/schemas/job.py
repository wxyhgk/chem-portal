"""
chem-portal 共享 Job 契约 — Python 镜像 (与 job.ts 字段一一对应)
路径: shared/schemas/job.py
前端 TS 镜像: shared/schemas/job.ts
所有 API/DB/Worker 均从此导入，保证前后端类型一致。
"""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

JobStatus = Literal["queued", "running", "done", "failed", "cancelled"]
JobTask = Literal["sp", "opt"]
JobMethod = Literal["gfn2", "gfn1", "gfnff", "uff", "psi4"]
PsiMethod = Literal["hf", "b3lyp", "pbe", "mp2"]

class JobCreate(BaseModel):
    """POST /api/jobs 请求体 — 前端提交 xyz，后端写入 input_xyz"""
    xyz: str = Field(..., description="XYZ 文本，多帧轨迹亦可")
    method: JobMethod = Field(default="gfn2", description="gfn2/gfn1/gfnff/uff/psi4")
    charge: int = Field(default=0)
    threads: int = Field(default=8, ge=1, le=32)
    task: JobTask = Field(default="sp", description="sp:单点  opt:几何优化")
    # psi4 专用（仅 method=psi4 时生效）
    psi_method: PsiMethod = Field(default="b3lyp", description="psi4 方法: hf/b3lyp/pbe/mp2")
    psi_basis: str = Field(default="def2-SVP", description="psi4 基组，默认 def2-SVP")
    multiplicity: int = Field(default=1, ge=1, le=8, description="自旋多重度")
    name: Optional[str] = Field(default=None, max_length=200, description="任务名（SDF 标题/文件名）")

    @model_validator(mode="after")
    def _reject_blank_xyz(self):
        if not (self.xyz or "").strip():
            raise ValueError("xyz 为空：请粘贴 XYZ 坐标或上传 SDF 生成")
        return self

class BatchItem(BaseModel):
    """批量中的单个分子"""
    xyz: str = Field(..., description="XYZ 文本（前端经 /api/embed 由 SDF 生成）")
    name: Optional[str] = Field(default=None, max_length=200)
    charge: Optional[int] = Field(default=None, description="缺省用批次 charge（前端带入 SDF 形式电荷）")

    @model_validator(mode="after")
    def _reject_blank_xyz(self):
        if not (self.xyz or "").strip():
            raise ValueError("xyz 为空")
        return self

class BatchCreate(BaseModel):
    """POST /api/jobs/batch 请求体 — 共用计算参数，逐分子建任务（只入队，后端限并发执行）"""
    items: list[BatchItem] = Field(..., min_length=1, max_length=2000)
    method: JobMethod = Field(default="gfn2")
    charge: int = Field(default=0)
    threads: int = Field(default=8, ge=1, le=32)
    task: JobTask = Field(default="sp")
    psi_method: PsiMethod = Field(default="b3lyp")
    psi_basis: str = Field(default="def2-SVP")
    multiplicity: int = Field(default=1, ge=1, le=8)

    def to_job(self, item: BatchItem) -> JobCreate:
        return JobCreate(
            xyz=item.xyz, name=item.name,
            charge=self.charge if item.charge is None else item.charge,
            method=self.method, threads=self.threads, task=self.task,
            psi_method=self.psi_method, psi_basis=self.psi_basis, multiplicity=self.multiplicity,
        )

class BatchSummary(BaseModel):
    """GET /api/batches 批次汇总"""
    batch_id: str
    created_at: str
    total: int
    queued: int
    running: int
    done: int
    failed: int
    cancelled: int
    method: Optional[JobMethod] = None
    task: Optional[JobTask] = None

class Job(BaseModel):
    """完整 Job 实体 — 对应 DB 行与 GET /api/jobs/{id} 返回"""
    id: str
    created_at: str  # ISO8601
    status: JobStatus
    method: JobMethod
    charge: int
    threads: int
    input_xyz: str
    task: JobTask
    psi_method: Optional[PsiMethod] = None
    psi_basis: Optional[str] = None
    multiplicity: int = 1
    progress_energy: Optional[float] = None
    progress_xyz: Optional[str] = None
    result_energy: Optional[float] = None
    result_log: Optional[str] = None
    result_xyz: Optional[str] = None
    wall_time: Optional[float] = None
    deleted: int = 0

class JobListItem(BaseModel):
    """GET /api/jobs 列表轻量返回"""
    id: str
    status: JobStatus
    method: Optional[JobMethod] = None
    charge: int
    threads: int
    task: Optional[JobTask] = None
    created_at: str
    result_energy: Optional[float] = None
    wall_time: Optional[float] = None

# 兼容 legacy 列名 xyz (旧 DB 可能列名为 xyz 而非 input_xyz)
def normalize_job_row(row: dict) -> dict:
    """将 DB row 归一化为 Job 字段：xyz -> input_xyz"""
    if "xyz" in row and "input_xyz" not in row:
        row["input_xyz"] = row.pop("xyz")
    # 处理 input_xyz 可能为 None 而 xyz 有值的情况
    if row.get("input_xyz") is None and row.get("xyz"):
        row["input_xyz"] = row.pop("xyz")
    row.pop("xyz", None)
    return row

__all__ = ["Job", "JobCreate", "JobListItem", "JobStatus", "JobTask", "JobMethod", "normalize_job_row"]
