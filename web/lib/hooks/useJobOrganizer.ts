"use client"

// 任务整理逻辑（侧边栏与任务页共用）：搜索/状态/方法筛选、分组排序、折叠偏好、分批渲染
import { useEffect, useMemo, useState } from "react"
import type { JobListItem } from "@/shared/schemas/job"
import { groupJobs, type GroupBy, type JobGroup, type SortBy } from "@/lib/jobGroups"
import { statusBucket, type StatusBucket } from "@/lib/jobMeta"
import { usePrefs } from "@/lib/hooks/usePrefs"

export type StatusFilter = "all" | StatusBucket

export interface OrganizerPrefs {
  groupBy: GroupBy
  sortBy: SortBy
  collapsed: Record<string, boolean>
}

export function filterJobs(source: JobListItem[], statusF: StatusFilter, methodF: string, query: string): JobListItem[] {
  const q = query.trim().toLowerCase()
  return source.filter(
    (j) =>
      (statusF === "all" || statusBucket(j.status) === statusF) &&
      (methodF === "all" || (j.method || "gfn2") === methodF) &&
      (q === "" ||
        j.id.toLowerCase().includes(q) ||
        (j.name || "").toLowerCase().includes(q) ||
        (j.task || "").toLowerCase().includes(q) ||
        (j.method || "").toLowerCase().includes(q)),
  )
}

const collapseKey = (groupBy: GroupBy, key: string) => `${groupBy}|${key}`

/** 折叠偏好只保留最近 200 个已折叠项 */
function pruneCollapsed<T extends OrganizerPrefs>(p: T): T {
  return { ...p, collapsed: Object.fromEntries(Object.entries(p.collapsed).filter(([, v]) => v).slice(-200)) }
}

interface Options<P extends OrganizerPrefs> {
  storageKey: string
  defaults: P
  /** 每组首批渲染数量（可随视图变化） */
  pageSizeOf: (prefs: P) => number
  /** 变化时分批渲染回到首批（如切换回收站） */
  resetKey?: unknown
}

export function useJobOrganizer<P extends OrganizerPrefs>(source: JobListItem[], { storageKey, defaults, pageSizeOf, resetKey }: Options<P>) {
  const [prefs, update] = usePrefs<P>(storageKey, defaults, pruneCollapsed)
  const [query, setQuery] = useState("")
  const [statusF, setStatusF] = useState<StatusFilter>("all")
  const [methodF, setMethodF] = useState("all")
  const [limits, setLimits] = useState<Record<string, number>>({})
  const pageSize = pageSizeOf(prefs)

  useEffect(() => setLimits({}), [prefs.groupBy, prefs.sortBy, statusF, methodF, query, resetKey, pageSize])

  const list = useMemo(() => filterJobs(source, statusF, methodF, query), [source, statusF, methodF, query])
  // 列表每 3s 轮询（无变化时引用不变），"今天/昨天"取计算时刻即可
  const groups = useMemo(() => groupJobs(list, prefs.groupBy, prefs.sortBy, Date.now()), [list, prefs.groupBy, prefs.sortBy])
  const grouped = prefs.groupBy !== "none"
  const isCollapsed = (g: JobGroup) => grouped && !!prefs.collapsed[collapseKey(prefs.groupBy, g.key)]

  // 可见顺序（未折叠分组的完整列表，不受分批渲染影响）：范围选择与上下切换用
  const flat = useMemo(
    () => groups.filter((g) => !(grouped && prefs.collapsed[collapseKey(prefs.groupBy, g.key)])).flatMap((g) => g.jobs),
    [groups, grouped, prefs.collapsed, prefs.groupBy],
  )

  const toggleGroup = (g: JobGroup) => {
    const k = collapseKey(prefs.groupBy, g.key)
    update({ collapsed: { ...prefs.collapsed, [k]: !prefs.collapsed[k] } } as Partial<P>)
  }
  const setAllCollapsed = (v: boolean) => {
    const c = { ...prefs.collapsed }
    for (const g of groups) c[collapseKey(prefs.groupBy, g.key)] = v
    update({ collapsed: c } as Partial<P>)
  }

  const limitOf = (g: JobGroup) => limits[g.key] ?? pageSize
  const showMore = (key: string) => setLimits((l) => ({ ...l, [key]: (l[key] ?? pageSize) + pageSize }))
  /** 确保任务已在分批渲染范围内 */
  const reveal = (id: string) => {
    const g = groups.find((x) => x.jobs.some((j) => j.id === id))
    if (!g) return
    const idx = g.jobs.findIndex((j) => j.id === id)
    setLimits((l) => ((l[g.key] ?? pageSize) <= idx ? { ...l, [g.key]: idx + pageSize } : l))
  }
  const countOf = (s: StatusFilter) => (s === "all" ? source.length : source.filter((j) => statusBucket(j.status) === s).length)

  return {
    prefs,
    update,
    query,
    setQuery,
    statusF,
    setStatusF,
    methodF,
    setMethodF,
    list,
    groups,
    grouped,
    flat,
    isCollapsed,
    toggleGroup,
    setAllCollapsed,
    limitOf,
    showMore,
    reveal,
    countOf,
  }
}
