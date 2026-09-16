"use client"

// 结构分析按钮：sp3 中心、螺原子、结构异常（后端按坐标判断，优先用优化后结构）
import { useEffect, useState } from "react"
import type { GeometryReport } from "@/shared/schemas/job"
import { NotFoundError, getGeometry } from "@/lib/api"

const SOURCE_LABEL: Record<string, string> = { result: "优化后结构", progress: "运行中结构", input: "输入结构" }

const btn = "px-2.5 py-1 rounded-lg border text-xs bg-white dark:bg-zinc-900 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"

export interface GeometryPanelProps {
  jobId: string
  className?: string
  /** 当前高亮的原子（1 基），由父组件同时传给 MolViewer */
  highlight?: number[]
  onHighlight?: (indexes: number[]) => void
}

export default function GeometryPanel({ jobId, className = "", highlight = [], onHighlight }: GeometryPanelProps) {
  const [report, setReport] = useState<GeometryReport | null>(null)
  const [err, setErr] = useState("")
  const [loading, setLoading] = useState(false)

  // 换任务时收起上一次的结果并清掉高亮
  useEffect(() => {
    setReport(null)
    setErr("")
    onHighlight?.([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  const run = async () => {
    setLoading(true)
    setErr("")
    try {
      setReport(await getGeometry(jobId))
    } catch (e) {
      setErr(e instanceof NotFoundError ? "任务不存在或已被删除" : `分析失败: ${String((e as Error)?.message || e)}`)
    } finally {
      setLoading(false)
    }
  }

  const sp3 = report?.sp3 ?? []
  const allHighlighted = sp3.length > 0 && sp3.every((a) => highlight.includes(a.index))
  const toggleAtom = (index: number) => onHighlight?.(highlight.length === 1 && highlight[0] === index ? [] : [index])

  return (
    <div className={className}>
      <div className="flex items-center gap-2">
        <button
          onClick={
            report
              ? () => {
                  setReport(null)
                  onHighlight?.([])
                }
              : run
          }
          disabled={loading}
          className={btn}
        >
          {loading ? "分析中…" : report ? "收起结构分析" : "🔬 结构分析"}
        </button>
        {err && <span className="text-xs text-red-600">{err}</span>}
        {report && (
          <span className="text-xs text-zinc-500 truncate">
            {SOURCE_LABEL[report.source] ?? report.source} · {report.natoms} 原子 {report.formula}
          </span>
        )}
      </div>

      {report && (
        <div className="mt-2 border rounded-lg dark:border-zinc-800 text-xs">
          <div className="px-3 py-2 border-b dark:border-zinc-800 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              sp3 重原子 <b>{sp3.length}</b> 个
            </span>
            <span>
              螺原子 <b className={report.spiro_count ? "text-blue-600" : ""}>{report.spiro_count ?? 0}</b> 个
            </span>
            {(report.warnings?.length ?? 0) > 0 && <span className="text-red-600">结构可疑 {report.warnings?.length} 处</span>}
            {onHighlight && sp3.length > 0 && (
              <button
                onClick={() => onHighlight(allHighlighted ? [] : sp3.map((a) => a.index))}
                className="ml-auto text-blue-600 hover:underline"
              >
                {allHighlighted ? "取消高亮" : `在 3D 中高亮全部 ${sp3.length} 个`}
              </button>
            )}
          </div>

          {sp3.length === 0 ? (
            <div className="px-3 py-2 text-zinc-500">未发现 sp3 中心：所有重原子均为平面（sp2）</div>
          ) : (
            <div className="max-h-48 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-950 text-zinc-500">
                  <tr>
                    <th className="text-left px-3 py-1 font-normal">原子</th>
                    <th className="text-right px-2 py-1 font-normal">配位</th>
                    <th className="text-right px-2 py-1 font-normal">键角和</th>
                    <th className="text-left px-2 py-1 font-normal">邻居</th>
                    <th className="text-left px-3 py-1 font-normal">环</th>
                  </tr>
                </thead>
                <tbody>
                  {sp3.map((a) => (
                    <tr
                      key={a.index}
                      onClick={() => toggleAtom(a.index)}
                      title={onHighlight ? "点击在 3D 中高亮该原子" : undefined}
                      className={`border-t dark:border-zinc-800 ${onHighlight ? "cursor-pointer" : ""} ${
                        highlight.includes(a.index) ? "bg-fuchsia-50 dark:bg-fuchsia-950" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      }`}
                    >
                      <td className="px-3 py-1 font-mono">
                        #{a.index} {a.element}
                      </td>
                      <td className="px-2 py-1 text-right">{a.cn}</td>
                      <td className="px-2 py-1 text-right font-mono">{a.angle_sum != null ? `${a.angle_sum.toFixed(1)}°` : "—"}</td>
                      <td className="px-2 py-1 font-mono text-zinc-500">{a.neighbors}</td>
                      <td className="px-3 py-1">
                        {a.spiro ? <span className="text-blue-600">★ 螺原子 {(a.ring_sizes ?? []).join("+")} 元环</span> : <span className="text-zinc-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {(report.warnings?.length ?? 0) > 0 && (
            <div className="px-3 py-2 border-t dark:border-zinc-800 text-red-600 space-y-0.5 max-h-28 overflow-auto">
              {report.warnings?.slice(0, 8).map((w, i) => (
                <div key={i} className="font-mono">
                  {w}
                </div>
              ))}
              {(report.warnings?.length ?? 0) > 8 && <div className="text-zinc-500">…… 其余 {(report.warnings?.length ?? 0) - 8} 处</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
