# Chem Portal Web - Next.js 前端

## 本地开发
```bash
cd chem-portal-web
npm install
npm run dev  # http://localhost:3000（开发环境不设 PORTAL_PASSWORD 则不校验登录）
```
**注意**：生产服务 `chem-portal-web.service` 直接使用本目录的 `.next/`，不要在这里跑 `next dev`（会覆盖构建产物导致线上 500）。

## 架构
- 浏览器只访问本站（:18080），所有请求走同源 `/api/*`
- `next.config.mjs` 把 `/api/*` rewrite 到后端 `API_INTERNAL_URL`（默认 `http://127.0.0.1:18081`，后端只监听本机）
- SSE `/api/jobs/{id}/events` 由 `app/api/jobs/[id]/events/route.ts` 逐块透传（避开 rewrite 的压缩缓冲）
- `middleware.ts` 全站 Basic Auth：账号密码来自 `PORTAL_USER` / `PORTAL_PASSWORD`，生产环境未配置密码返回 503

## 部署（本机 systemd）
```bash
NODE_ENV=production npx next build     # rewrites 在 build 时固化；不要设置 NEXT_PUBLIC_API_URL
systemctl restart chem-portal-web
```
- 登录凭据：`/etc/chem-portal/web.env`（`chem-portal-web.service.d/auth.conf` 读取），改密码后重启服务即可，无需重新 build
- 后端：`chem-portal-api.service`（任务调度在 API 进程内，`JOB_CONCURRENCY` 控制同时运行数）
- 数据库每日备份：`chem-portal-backup.timer` → `/root/Backups/chem-portal-db/`

## 共享契约
`shared/schemas/job.ts|py` 与后端仓库 `../chem-portal/shared` 保持一致：`bash scripts/sync-shared.sh --check`
