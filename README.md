# Chem Portal - 在线计算化学任务提交平台

法国VPS 24核128G - 基于 xtb-mcp (3×8核最优) 构建

## 目录
- backend/  FastAPI API (已解耦，不再托管前端)
- frontend/ 旧静态前端 (已废弃，前端迁移至 chem-portal-web)
- chem-portal-web/ Next.js 14 前端 (Vercel)
- shared/ 共享 Job 契约 (前后端类型一致)
- worker/ 任务执行器 (Redis 队列 + DB 轮询)
- database/ SQLite/PostgreSQL
- docker-compose.yml  解耦 api/worker/redis/db (api:18080)

## 快速启动 (解耦版)
```bash
docker compose up --build -d
# api: http://localhost:18080
# 前端: cd chem-portal-web && NEXT_PUBLIC_API_URL=http://localhost:18080 npm run dev
```

## 共享契约
见 `shared/README.md` 与 `shared/schemas/job.ts` / `job.py`
