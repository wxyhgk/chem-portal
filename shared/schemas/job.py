"""
chem-portal 共享 Job 契约 — 唯一真实来源（Pydantic 模型）
路径: shared/schemas/job.py
前端 TypeScript 类型 shared/schemas/job.ts 由本文件生成：在项目根目录运行 `python -m scripts.gen_ts`
模型的 docstring 与 Field(description=...) 会成为 TS 注释。
"""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field, model_validator

JobStatus = Literal["queued", "running", "done", "failed", "cancelled"]
JobTask = Literal["sp", "opt"]
JobMethod = Literal["gfn2", "gfn1", "gfnff", "uff", "psi4"]
PsiMethod = Literal["hf", "b3lyp", "pbe", "mp2"]


class JobCreate(BaseModel):
    """创建任务的请求体 — POST /api/jobs（前端提交 xyz，后端写入 input_xyz）"""
    xyz: str = Field(..., description="XYZ 文本，多帧轨迹亦可")
    method: JobMethod = Field(default="gfn2")
    charge: int = Field(default=0)
    threads: int = Field(default=8, ge=1, le=32)
    task: JobTask = Field(default="sp", description="sp 单点 / opt 几何优化")
    psi_method: PsiMethod = Field(default="b3lyp", description="仅 method=psi4 时生效")
    psi_basis: str = Field(default="def2-SVP", description="仅 method=psi4 时生效")
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
    """批量创建请求体 — POST /api/jobs/batch（共用计算参数，逐分子入队，后端限并发执行）"""
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
    """批次汇总 — GET /api/batches"""
    batch_id: str
    created_at: str = Field(..., description="批次最早任务的提交时间（UTC）")
    total: int
    queued: int
    running: int
    done: int
    failed: int
    cancelled: int
    method: Optional[JobMethod] = None
    task: Optional[JobTask] = None


class Job(BaseModel):
    """完整任务 — GET /api/jobs/{id}（不存在返回 404）"""
    id: str
    created_at: str = Field(..., description="UTC，SQLite CURRENT_TIMESTAMP 格式（无时区标记）")
    status: JobStatus
    method: JobMethod
    charge: int
    threads: int
    input_xyz: str
    task: JobTask
    psi_method: Optional[PsiMethod] = Field(default=None, description="仅 method=psi4 时有效")
    psi_basis: Optional[str] = Field(default=None, description="仅 method=psi4 时有效")
    multiplicity: int = Field(default=1, description="自旋多重度")
    progress_energy: Optional[float] = Field(default=None, description="运行中实时能量（结束后以 result_energy 为准）")
    progress_xyz: Optional[str] = Field(default=None, description="运行中实时轨迹（opt）")
    result_energy: Optional[float] = Field(default=None, description="Eh；UFF 为 kcal/mol")
    result_log: Optional[str] = Field(default=None, description="保留开头与结尾，≤ 12000 字符")
    result_xyz: Optional[str] = Field(default=None, description="opt 为多帧轨迹，sp 为单帧")
    wall_time: Optional[float] = Field(default=None, description="秒")
    deleted: int = Field(default=0, description="1 = 回收站")
    name: Optional[str] = Field(default=None, description="任务名（SDF 标题/文件名）")
    batch_id: Optional[str] = Field(default=None, description="批量提交的批次 id；单个提交为空")


class JobListItem(BaseModel):
    """列表轻量字段 — GET /api/jobs"""
    id: str
    status: JobStatus
    method: JobMethod
    charge: int
    threads: int
    task: JobTask
    created_at: str = Field(..., description="UTC，SQLite CURRENT_TIMESTAMP 格式")
    result_energy: Optional[float] = Field(default=None, description="Eh；UFF 为 kcal/mol")
    wall_time: Optional[float] = None
    name: Optional[str] = None
    batch_id: Optional[str] = None


class GeometryAtom(BaseModel):
    """结构分析中的一个 sp3 中心"""
    index: int = Field(..., description="1 基，与 XYZ 行号一致")
    element: str
    cn: int = Field(..., description="配位数")
    hybrid: str
    angle_sum: Optional[float] = Field(default=None, description="键角和（度）；正四面体约 656.8")
    spiro: bool = Field(default=False, description="两个环只共用该原子")
    ring_sizes: list[int] = Field(default_factory=list, description="经过该原子的各环大小")
    neighbors: str = Field(default="", description="邻居元素统计，如 C4")


class GeometryReport(BaseModel):
    """结构分析 — GET /api/jobs/{id}/geometry（只用坐标判断杂化与螺原子，不依赖键级）"""
    job_id: str
    source: Literal["result", "progress", "input"] = Field(..., description="分析所用结构：结果/运行中/输入")
    natoms: int
    formula: str
    sp3: list[GeometryAtom] = Field(default_factory=list, description="sp3 重原子（不含氢）")
    spiro_count: int = 0
    warnings: list[str] = Field(default_factory=list, description="结构可疑之处；输入结构常见超配位")


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


__all__ = [
    "BatchCreate", "BatchItem", "BatchSummary", "GeometryAtom", "GeometryReport", "Job", "JobCreate", "JobListItem",
    "JobMethod", "JobStatus", "JobTask", "PsiMethod", "normalize_job_row",
]
