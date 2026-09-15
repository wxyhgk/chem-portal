from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path

from .routers.jobs import router as jobs_router
from .core.config import FRONTEND_DIR
from .services.job_service import start_job_dispatcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 任务调度线程：单个与批量统一排队、限并发（单进程 uvicorn；多进程部署需改为外部调度）
    start_job_dispatcher()
    yield


app = FastAPI(title="Chem Portal API (decoupled)", version="2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(jobs_router)

# 前端已分离至 chem-portal-web，本地若仍有 frontend/ 则兼容性托管
if FRONTEND_DIR.exists():
    # 仅当未被 Next.js 接管时，保留静态托管兼容旧部署
    try:
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    except Exception:
        pass
