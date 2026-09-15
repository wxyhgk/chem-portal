# Shared 共享契约

前后端共享的 Job 类型定义，唯一真实来源。

- `schemas/job.py` — Pydantic 模型（后端直接使用：`from shared.schemas.job import JobCreate`）
- `schemas/job.ts` — TypeScript 类型（前端副本：`chem-portal-web/shared/schemas/job.ts`）

两边字段需一一对应。修改后同步到前端并检查：

```bash
cd ../chem-portal-web
bash scripts/sync-shared.sh --to-web   # 以后端仓库为准覆盖前端副本
bash scripts/sync-shared.sh --check
```

前端请求一律走同源 `/api/*`（Next 代理 + 登录保护），不要让浏览器直连后端。
