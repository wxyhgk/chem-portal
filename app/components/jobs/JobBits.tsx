"use client"

// 任务列表（侧边栏）与任务页（主区）共用的小组件与选项
import { useEffect, useRef } from "react"
import type { JobListItem } from "@/shared/schemas/job"
import { createdMs, type GroupBy, type GroupCounts, type SortBy } from "@/lib/jobGroups"
import { METHODS, STATUS_FILTER_LABEL, TONE_BADGE, TONE_BAR, TONE_TEXT, statusTone, type StatusTone } from "@/lib/jobMeta"
import type { StatusFilter } from "@/lib/hooks/useJobOrganizer"

export const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  ...(Object.entries(STATUS_FILTER_LABEL) as [StatusFilter, string][]).map(([key, label]) => ({ key, label })),
]

export const METHOD_FILTERS: { key: string; label: string }[] = [{ key: "all", label: "全部方法" }, ...METHODS.map((m) => ({ key: m.key as string, label: m.short }))]

export const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "batch", label: "按批次" },
  { key: "status", label: "按状态" },
  { key: "method", label: "按方法" },
  { key: "date", label: "按日期" },
  { key: "none", label: "不分组" },
]

export const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: "time", label: "最新在前" },
  { key: "energy", label: "能量低→高" },
  { key: "name", label: "名称" },
]

/** 运行中耗时文案：Xs / X分Y秒；时钟 skew 为负则显示"刚刚" */
export function elapsedText(createdAt: string, now: number): string {
  const dt = Math.floor((now - createdMs(createdAt)) / 1000)
  if (!Number.isFinite(dt) || dt < 0) return "刚刚"
  if (dt < 60) return `${dt}s`
  return `${Math.floor(dt / 60)}分${dt % 60}秒`
}

export function Badge({ children, tone = "gray" }: { children: React.ReactNode; tone?: StatusTone }) {
  return <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${TONE_BADGE[tone]}`}>{children}</span>
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>
}

export function JobName({ j, className }: { j: JobListItem; className: string }) {
  return (
    <span className={`font-mono font-semibold truncate ${className}`} title={j.name ? `${j.name} · ${j.id}` : j.id}>
      {j.name || j.id.slice(0, 8)}
    </span>
  )
}

export function CountsText({ counts }: { counts: GroupCounts }) {
  return (
    <span className="truncate">
      {counts.done > 0 && <span className={TONE_TEXT.green}>{counts.done} 完成 </span>}
      {counts.running > 0 && <span className={TONE_TEXT.yellow}>{counts.running} 运行 </span>}
      {counts.failed > 0 && <span className={TONE_TEXT.red}>{counts.failed} 失败 </span>}
      {counts.cancelled > 0 && <span className={TONE_TEXT.gray}>{counts.cancelled} 取消</span>}
    </span>
  )
}

export function ProgressBar({ counts, total, className }: { counts: GroupCounts; total: number; className: string }) {
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`
  return (
    <div className={`rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden flex ${className}`}>
      <div className={TONE_BAR.green} style={{ width: pct(counts.done) }} />
      <div className={TONE_BAR.red} style={{ width: pct(counts.failed) }} />
      <div className={TONE_BAR.gray} style={{ width: pct(counts.cancelled) }} />
      <div className={TONE_BAR.yellow} style={{ width: pct(counts.running) }} />
    </div>
  )
}

/** 支持半选态的复选框；点击不冒泡（卡片点击另有含义），回调带 shift 以支持范围选择 */
export function Check({
  checked,
  indeterminate,
  onChange,
  title,
  className = "",
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: (v: boolean, shift: boolean) => void
  title?: string
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      readOnly
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked, e.shiftKey)
      }}
      className={`w-4 h-4 cursor-pointer accent-black dark:accent-white ${className}`}
    />
  )
}

/** 分批渲染：接近底部自动加载下一批，也可手动点 */
export function LoadMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onMore)
  cb.current = onMore
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && cb.current(), { rootMargin: "600px" })
    io.observe(el)
    return () => io.disconnect()
  }, [remaining])
  return (
    <div ref={ref} className="py-3 text-center">
      <button onClick={() => cb.current()} className="text-xs text-zinc-500 hover:text-black dark:hover:text-white">
        显示更多（还有 {remaining} 个）
      </button>
    </div>
  )
}
