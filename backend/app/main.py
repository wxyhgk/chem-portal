from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.gzip import GZipMiddleware

from .routers.jobs import router as jobs_router
from .services import dispatcher


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 任务调度线程：单个与批量统一排队、限并发（单进程 uvicorn；多进程部署需改为外部调度）
    dispatcher.start()
    yield


# 只监听本机，浏览器经 chem-portal-web 的 /api 代理（带登录）访问，因此不需要 CORS
app = FastAPI(title="Chem Portal API", version="2.1", lifespan=lifespan)

# JSON 列表字段名重复多，gzip 约压到 1/10；Starlette 默认不压 text/event-stream，SSE 不受影响
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.include_router(jobs_router)
