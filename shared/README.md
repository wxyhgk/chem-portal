# Shared 共享契约

前后端共享的 Job 类型定义，唯一真实来源。

- `schemas/job.py` — Pydantic 模型，**唯一来源**（后端直接使用：`from shared.schemas.job import JobCreate`）
- `schemas/job.ts` — TypeScript 类型，**由 job.py 自动生成，不要手改**（前端副本：`web/shared/schemas/job.ts`）

修改字段的流程：

```bash
# 1. 改 shared/schemas/job.py（docstring / Field(description=...) 会成为 TS 注释）
python -m scripts.gen_ts            # 2. 生成 job.ts（--check 只检查是否一致）
cd web
bash scripts/sync-shared.sh --to-web   # 3. 同步到前端仓库
bash scripts/sync-shared.sh --check
npx tsc --noEmit                        # 4. 前端类型检查
```

前端请求一律走同源 `/api/*`（Next 代理 + 登录保护），不要让浏览器直连后端。
