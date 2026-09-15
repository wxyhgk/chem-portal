import { NextResponse, type NextRequest } from "next/server"

// 全站 Basic Auth：页面、静态资源、/api 代理、SSE 都经过这里（后端只监听本机，唯一入口是本站）。
// 账号密码来自服务环境变量 PORTAL_USER / PORTAL_PASSWORD（systemd EnvironmentFile）；
// 生产环境未配置密码时拒绝访问，避免误部署成公开站点。
export const config = { matcher: "/:path*" }

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export function middleware(req: NextRequest) {
  const user = process.env.PORTAL_USER || "chem"
  const pass = process.env.PORTAL_PASSWORD
  if (!pass) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next()
    return new NextResponse("PORTAL_PASSWORD not configured", { status: 503 })
  }
  const auth = req.headers.get("authorization") || ""
  if (auth.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6))
      const i = decoded.indexOf(":")
      if (i >= 0 && safeEqual(decoded.slice(0, i), user) && safeEqual(decoded.slice(i + 1), pass)) return NextResponse.next()
    } catch {
      /* 非法 base64 → 401 */
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Chem Portal", charset="UTF-8"' },
  })
}
