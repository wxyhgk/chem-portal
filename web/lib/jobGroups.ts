// 任务卡片分组/排序 — 侧边栏整理归类用（纯函数，便于单测）
import type { JobListItem } from "@/shared/schemas/job"
// 相对路径：本文件需可单独编译做单元测试
import { METHODS, STATUS_BUCKET_LABEL, methodLabel, statusBucket, type StatusBucket } from "./jobMeta"

export type GroupBy = "none" | "batch" | "status" | "method" | "date"
export type SortBy = "time" | "energy" | "name"

export interface GroupCounts {
  running: number // 含 queued
  done: number
  failed: number
  cancelled: number
}

export interface JobGroup {
  key: string
  label: string
  batchId: string | null
  jobs: JobListItem[]
  counts: GroupCounts
}

/** created_at 是 SQLite CURRENT_TIMESTAMP（UTC，无时区标记）→ 按 UTC 解析；已有时区则不动 */
export function createdMs(createdAt: string): number {
  const s = (createdAt || "").trim().replace(" ", "T")
  const t = Date.parse(/([Zz]|[+-]\d{2}:?\d{2})$/.test(s) ? s : s + "Z")
  return Number.isFinite(t) ? t : NaN
}

const STATUS_ORDER: string[] = Object.keys(STATUS_BUCKET_LABEL)
const METHOD_ORDER: string[] = METHODS.map((m) => m.key)

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" })
const pad = (n: number) => String(n).padStart(2, "0")

function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function shortTime(ms: number): string {
  if (!Number.isFinite(ms)) return "—"
  const d = new Date(ms)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const statusKey = statusBucket

/** 批次内名称公共前缀，去掉尾部数字/分隔符：raw220.sdf…raw231.sdf → "raw" */
export function commonNamePrefix(names: string[]): string {
  const ns = names.filter(Boolean)
  if (ns.length < 2) return ""
  let p = ns[0]
  for (const n of ns) {
    while (p && !n.startsWith(p)) p = p.slice(0, -1)
  }
  return p.replace(/[\d_.\-\s]+$/, "")
}

export function sortJobs(jobs: JobListItem[], sortBy: SortBy): JobListItem[] {
  const arr = jobs.slice() // sort 稳定：同秒创建的保持接口顺序
  if (sortBy === "energy") {
    return arr.sort((a, b) => {
      const ea = a.result_energy, eb = b.result_energy
      if (ea == null && eb == null) return 0
      if (ea == null) return 1
      if (eb == null) return -1
      return ea - eb
    })
  }
  if (sortBy === "name") return arr.sort((a, b) => collator.compare(a.name || a.id, b.name || b.id))
  return arr.sort((a, b) => (createdMs(b.created_at) || 0) - (createdMs(a.created_at) || 0))
}

function countOf(jobs: JobListItem[]): GroupCounts {
  const c: GroupCounts = { running: 0, done: 0, failed: 0, cancelled: 0 }
  for (const j of jobs) {
    const k = statusKey(j.status) as keyof GroupCounts
    if (k in c) c[k]++
  }
  return c
}

function batchLabel(jobs: JobListItem[]): string {
  const times = jobs.map((j) => createdMs(j.created_at)).filter(Number.isFinite)
  const first = times.length ? Math.min(...times) : NaN
  const methods = new Set(jobs.map((j) => j.method || "gfn2"))
  const tasks = new Set(jobs.map((j) => j.task || "sp"))
  const kind = methods.size === 1 && tasks.size === 1 ? `${[...tasks][0]}/${[...methods][0]}` : "混合参数"
  const prefix = commonNamePrefix(jobs.map((j) => j.name || ""))
  return `${prefix ? `${prefix}* · ` : ""}${shortTime(first)} · ${kind}`
}

export function groupJobs(jobs: JobListItem[], groupBy: GroupBy, sortBy: SortBy, now: number = Date.now()): JobGroup[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "全部任务", batchId: null, jobs: sortJobs(jobs, sortBy), counts: countOf(jobs) }]
  }
  const buckets = new Map<string, JobListItem[]>()
  const keyOf = (j: JobListItem): string => {
    if (groupBy === "batch") return j.batch_id ? `b:${j.batch_id}` : "single"
    if (groupBy === "status") return `s:${statusKey(j.status)}`
    if (groupBy === "method") return `m:${j.method || "gfn2"}`
    const ms = createdMs(j.created_at)
    return `d:${Number.isFinite(ms) ? localDay(ms) : "unknown"}`
  }
  for (const j of jobs) {
    const k = keyOf(j)
    const b = buckets.get(k)
    if (b) b.push(j)
    else buckets.set(k, [j])
  }

  const today = localDay(now)
  const yesterday = localDay(now - 86400000)
  const newest = (js: JobListItem[]) => Math.max(...js.map((j) => createdMs(j.created_at) || 0))

  const groups: JobGroup[] = [...buckets.entries()].map(([key, js]) => {
    let label = key
    let batchId: string | null = null
    if (key === "single") label = "单个任务"
    else if (key.startsWith("b:")) {
      batchId = key.slice(2)
      label = batchLabel(js)
    } else if (key.startsWith("s:")) label = STATUS_BUCKET_LABEL[key.slice(2) as StatusBucket] || key.slice(2)
    else if (key.startsWith("m:")) label = methodLabel(key.slice(2))
    else if (key.startsWith("d:")) {
      const d = key.slice(2)
      label = d === today ? "今天" : d === yesterday ? "昨天" : d === "unknown" ? "未知日期" : d
    }
    return { key, label, batchId, jobs: sortJobs(js, sortBy), counts: countOf(js) }
  })

  const rank = (order: string[], k: string) => {
    const i = order.indexOf(k)
    return i === -1 ? order.length : i
  }
  if (groupBy === "status") groups.sort((a, b) => rank(STATUS_ORDER, a.key.slice(2)) - rank(STATUS_ORDER, b.key.slice(2)))
  else if (groupBy === "method") groups.sort((a, b) => rank(METHOD_ORDER, a.key.slice(2)) - rank(METHOD_ORDER, b.key.slice(2)))
  else groups.sort((a, b) => newest(b.jobs) - newest(a.jobs)) // batch / date：最近活动在前
  return groups
}
