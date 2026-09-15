/** SSE 直通代理 — GET /api/jobs/{id}/events
 * rewrite 代理会对浏览器 gzip 响应做压缩缓冲（连接不断但无帧，前端假订阅；
 * curl 无压缩故不受影响）。Route Handler 优先级高于 afterFiles rewrite，
 * 在此逐块透传上游事件流（经实测浏览器可达）。
 */
export const dynamic = "force-dynamic";

const BACKEND = process.env.API_INTERNAL_URL || "http://127.0.0.1:18081";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/api/jobs/${params.id}/events`, {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
    });
  } catch (e) {
    console.error(`[events] upstream unreachable ${params.id}: ${String(e).slice(0, 120)}`);
    return new Response("upstream events unavailable", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("upstream events unavailable", { status: 502 });
  }
  const reader = upstream.body.getReader();
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
