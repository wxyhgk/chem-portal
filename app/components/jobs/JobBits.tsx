"use client"

// 任务列表（侧边栏）与任务页（主区）共用的小组件、常量与筛选
import { useEffect, useRef } from "react"
import type { JobListItem, JobStatus } from "@/shared/schemas/job"
import { createdMs, type GroupBy, type GroupCounts, type SortBy } from "@/lib/jobGroups"

export type StatusFilter = "all" | JobStatus

export const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "done", label: "已完成" },
  { key: "failed", label: "失败" },
  { key: "cancelled", label: "已取消" },
]

export const METHODS: { key: string; label: string }[] = [
  { key: "all", label: "全部方法" },
  { key: "gfn2", label: "GFN2" },
  { key: "gfn1", label: "GFN1" },
  { key: "gfnff", label: "GFN-FF" },
  { key: "uff", label: "UFF" },
  { key: "psi4", label: "psi4" },
]

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

export const TERMINAL = ["done", "failed", "cancelled"]

export const isLive = (j: JobListItem) => j.status === "running" || j.status === "queued"

export function filterJobs(source: JobListItem[], statusF: StatusFilter, methodF: string, query: string): JobListItem[] {
  const q = query.trim().toLowerCase()
  return source.filter(
    (j) =>
      (statusF === "all" || j.status === statusF || (statusF === "running" && j.status === "queued")) &&
      (methodF === "all" || (j.method || "gfn2") === methodF) &&
      (q === "" ||
        j.id.toLowerCase().includes(q) ||
        (j.name || "").toLowerCase().includes(q) ||
        (j.task || "").toLowerCase().includes(q) ||
        (j.method || "").toLowerCase().includes(q)),
  )
}

export const countByStatus = (source: JobListItem[], s: StatusFilter) =>
  s === "all" ? source.length : source.filter((j) => j.status === s || (s === "running" && j.status === "queued")).length

/** 运行中耗时文案：Xs / X分Y秒；时钟 skew 为负则显示"刚刚" */
export function elapsedText(createdAt: string, now: number): string {
  const dt = Math.floor((now - createdMs(createdAt)) / 1000)
  if (!Number.isFinite(dt) || dt < 0) return "刚刚"
  if (dt < 60) return `${dt}s`
  return `${Math.floor(dt / 60)}分${dt % 60}秒`
}

export function statusColor(status: string): "green" | "yellow" | "red" | "gray" {
  if (status === "done") return "green"
  if (status === "running" || status === "queued") return "yellow"
  if (status === "failed") return "red"
  return "gray"
}

export function Badge({ children, color = "gray" }: { children: React.ReactNode; color?: "green" | "blue" | "yellow" | "gray" | "red" }) {
  const c =
    color === "green"
      ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
      : color === "blue"
        ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
        : color === "yellow"
          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300"
          : color === "red"
            ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
            : "bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300"
  return <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${c}`}>{children}</span>
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
      {counts.done > 0 && <span className="text-green-600">{counts.done} 完成 </span>}
      {counts.running > 0 && <span className="text-yellow-600">{counts.running} 运行 </span>}
      {counts.failed > 0 && <span className="text-red-600">{counts.failed} 失败 </span>}
      {counts.cancelled > 0 && <span className="text-zinc-500">{counts.cancelled} 取消</span>}
    </span>
  )
}

export function ProgressBar({ counts, total, className }: { counts: GroupCounts; total: number; className: string }) {
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`
  return (
    <div className={`rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden flex ${className}`}>
      <div className="bg-green-500" style={{ width: pct(counts.done) }} />
      <div className="bg-red-500" style={{ width: pct(counts.failed) }} />
      <div className="bg-zinc-400" style={{ width: pct(counts.cancelled) }} />
      <div className="bg-yellow-400" style={{ width: pct(counts.running) }} />
    </div>
  )
}

/** 支持半选态的复选框；点击不冒泡（卡片点击另有含义） */
export function Check({ checked, indeterminate, onChange, title, className = "" }: { checked: boolean; indeterminate?: boolean; onChange: (v: boolean) => void; title?: string; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      title={title}
      onChange={(e) => onChange(e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className={`w-4 h-4 cursor-pointer accent-black dark:accent-white ${className}`}
    />
  )
}

/** 分组折叠偏好：key = groupBy|groupKey；只保留最近 200 个已折叠项 */
export const collapseKey = (groupBy: GroupBy, key: string) => `${groupBy}|${key}`
export function pruneCollapsed<T extends { collapsed: Record<string, boolean> }>(p: T): T {
  return { ...p, collapsed: Object.fromEntries(Object.entries(p.collapsed).filter(([, v]) => v).slice(-200)) }
}
