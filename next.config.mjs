/** @type {import('next').NextConfig} */
const nextConfig = {
  // 自托管不做 gzip：SSE 无限流会被压缩器攒包饿死（浏览器发 Accept-Encoding 必中招）。
  // Vercel 边缘压缩不受此开关影响，照常工作。
  compress: false,
  async rewrites() {
    return {
      afterFiles: [
        {
          source: "/api/:path*",
          destination: `${process.env.NEXT_PUBLIC_API_URL || "http://CHEM_PORTAL_HOST:18081"}/api/:path*`
        }
      ]
    }
  }
}
export default nextConfig
