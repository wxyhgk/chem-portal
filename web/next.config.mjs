/** @type {import('next').NextConfig} */
// 后端只监听本机；浏览器经本站 /api/* 代理访问（middleware.ts 做登录保护）。
// 注意 rewrites 在 build 时固化，改 API_INTERNAL_URL 需重新 build。
const API_INTERNAL_URL = process.env.API_INTERNAL_URL || "http://127.0.0.1:18081"

const nextConfig = {
  // 自托管不做 gzip：SSE 无限流会被压缩器攒包饿死（浏览器发 Accept-Encoding 必中招）。
  // Vercel 边缘压缩不受此开关影响，照常工作。
  compress: false,
  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/api/:path*",
          destination: `${API_INTERNAL_URL}/api/:path*`
        }
      ]
    }
  }
}
export default nextConfig
