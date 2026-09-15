# Shared 共享契约

前后端共享的 Job 类型定义，唯一真实来源。

- `schemas/job.ts` — TypeScript 契约 (前端)
- `schemas/job.py` — Python 契约 (后端/Worker)，字段与 TS 一一对应

## 导入示例

### 前端 (chem-portal-web, Next.js 14)
```ts
import type { Job, JobCreate } from "@/shared/schemas/job";
import { getApiBase } from "@/shared/schemas/job";
const API = getApiBase(); // process.env.NEXT_PUBLIC_API_URL || "http://CHEM_PORTAL_HOST:18080"
```

或使用 `lib/api.ts` 封装：
```ts
import { listJobs, createJob, API_BASE } from "@/lib/api";
```

### 后端 (FastAPI)
```python
from shared.schemas.job import JobCreate, Job, normalize_job_row
# POST /api/jobs 使用 JobCreate，DB 行用 normalize_job_row 兼容 xyz/input_xyz
```

### 基础设施解耦
- `docker-compose.yml` 将 api / worker / redis / db 解耦
- api 不再 `StaticFiles` 托管前端，前端独立部署于 Vercel
- 任务通过 `redis` 队列 `chem:jobs` 解耦，缺失时回退 `BackgroundTasks`
