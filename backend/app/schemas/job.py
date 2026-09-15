import sys
from pathlib import Path

# 优先使用 shared/schemas 共享契约，保证与 chem-portal-web 类型一致
try:
    sys.path.insert(0, str(Path(__file__).resolve().parents[4]))
    from shared.schemas.job import JobCreate as SharedJobCreate, BatchCreate as SharedBatchCreate  # type: ignore

    JobIn = SharedJobCreate
    BatchIn = SharedBatchCreate
except Exception:
    from typing import Optional  # noqa: F401
    from pydantic import BaseModel

    class JobIn(BaseModel):  # type: ignore
        xyz: str
        method: str = "gfn2"
        charge: int = 0
        threads: int = 8
        task: str = "sp"
        name: Optional[str] = None

    class BatchItemIn(BaseModel):  # type: ignore
        xyz: str
        name: Optional[str] = None
        charge: Optional[int] = None

    class BatchIn(BaseModel):  # type: ignore
        items: list[BatchItemIn]
        method: str = "gfn2"
        charge: int = 0
        threads: int = 8
        task: str = "sp"

        def to_job(self, item):
            return JobIn(xyz=item.xyz, name=item.name, charge=self.charge if item.charge is None else item.charge,
                         method=self.method, threads=self.threads, task=self.task)

# 导出 normalize 辅助（shared 缺失时为透传）
try:
    from shared.schemas.job import normalize_job_row  # type: ignore
except Exception:
    def normalize_job_row(r):  # type: ignore
        return r

__all__ = ["JobIn", "normalize_job_row"]
