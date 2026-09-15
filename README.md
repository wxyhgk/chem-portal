# Chem Portal Web - Next.js 前端 (Vercel)

## 本地开发
```bash
cd chem-portal-web
npm install
npm run dev  # http://localhost:3000
```

## Vercel 部署
1. 推送到 GitHub
2. Vercel 导入仓库，框架选 Next.js
3. 环境变量：无需设置（默认走相对路径 `/api/*`，由 `next.config.mjs` rewrite 代理到 `http://CHEM_PORTAL_HOST:18081`；Vercel 为 https，直连 http 后端会被浏览器拦截）
4. 部署完成即获全球 CDN 域名

## 后端 CORS
法国VPS需允许 Vercel 域名：
```bash
# backend/app.py 已需加：
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
```
