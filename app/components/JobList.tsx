"use client"

import { useEffect, useMemo, useState } from "react"
import type { JobListItem, JobStatus } from "@/shared/schemas/job"
import Button from "@/app/components/ui/Button"
import { jobImageUrl } from "@/lib/api"
import { createdMs, groupJobs, type GroupBy, type JobGroup, type SortBy } from "@/lib/jobGroups"

/** 运行中耗时文案：Xs / XmYs；时钟 skew 为负则显示"刚刚" */
function elapsedText(createdAt: string, now: number): string {
  const dt = Math.floor((now - createdMs(createdAt)) / 1000)
  if (!Number.isFinite(dt) || dt < 0) return "刚刚"
  if (dt < 60) return `${dt}s`
  return `${Math.floor(dt / 60)}分${dt % 60}秒`
}
export interface JobListProps {
  jobs: JobListItem[]
  trash: JobListItem[]
  curId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onHardDelete: (id: string) => void
  onClear: (statuses: JobStatus[]) => void
  /** 批次分组 → 打开批量页查看该批进度 */
  onOpenBatch?: (batchId: string) => void
  /** 分组整理：整组已结束任务移入回收站 */
  onDeleteMany?: (ids: string[]) => void
  apiHint?: string
}

type StatusFilter = "all" | JobStatus
type ViewMode = "list" | "cards"

function Badge({
  children,
  color = "gray",
}: {
  children: React.ReactNode
  color?: "green" | "blue" | "yellow" | "gray" | "red"
}) {
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
  return <span className={`px-2 py-0.5 rounded-full text-xs ${c}`}>{children}</span>
}

function statusColor(status: string): "green" | "yellow" | "red" | "gray" {
  if (status === "done") return "green"
  if (status === "running" || status === "queued") return "yellow"
  if (status === "failed") return "red"
  return "gray"
}

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "done", label: "已完成" },
  { key: "failed", label: "失败" },
  { key: "cancelled", label: "已取消" },
]

const METHODS: { key: string; label: string }[] = [
  { key: "all", label: "全部方法" },
  { key: "gfn2", label: "GFN2" },
  { key: "gfn1", label: "GFN1" },
  { key: "gfnff", label: "GFN-FF" },
  { key: "uff", label: "UFF" },
  { key: "psi4", label: "psi4" },
]

const GROUP_OPTIONS: { key: GroupBy; label: string }[] = [
  { key: "batch", label: "按批次" },
  { key: "status", label: "按状态" },
  { key: "method", label: "按方法" },
  { key: "date", label: "按日期" },
  { key: "none", label: "不分组" },
]

const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: "time", label: "最新在前" },
  { key: "energy", label: "能量低→高" },
  { key: "name", label: "名称" },
]

const TERMINAL = ["done", "failed", "cancelled"]

/** 浏览器本地记住整理偏好；隐私模式等读写失败时用默认值 */
const PREF_KEY = "jobList.prefs.v1"
interface Prefs {
  groupBy: GroupBy
  sortBy: SortBy
  view: ViewMode
  collapsed: Record<string, boolean>
}
const DEFAULT_PREFS: Prefs = { groupBy: "batch", sortBy: "time", view: "cards", collapsed: {} }

function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(PREF_KEY)
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : DEFAULT_PREFS
  } catch {
    return DEFAULT_PREFS
  }
}

function savePrefs(p: Prefs) {
  try {
    // 折叠记录只留最近 200 个分组，避免无限增长
    const entries = Object.entries(p.collapsed).filter(([, v]) => v).slice(-200)
    window.localStorage.setItem(PREF_KEY, JSON.stringify({ ...p, collapsed: Object.fromEntries(entries) }))
  } catch {
    /* ignore */
  }
}

interface ItemProps {
  j: JobListItem
  now: number
  active: boolean
  trashMode: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onHardDelete: (id: string) => void
}

function JobName({ j, className }: { j: JobListItem; className: string }) {
  return (
    <span className={`font-mono font-semibold truncate ${className}`} title={j.name ? `${j.name} · ${j.id}` : j.id}>
      {j.name || j.id.slice(0, 8)}
    </span>
  )
}

function JobCard({ j, now, active, trashMode, onSelect, onDelete, onRestore, onHardDelete }: ItemProps) {
  const live = j.status === "running" || j.status === "queued"
  const src = jobImageUrl(j.id) + (live ? `?t=${Math.floor(now / 10000)}` : "")
  return (
    <div
      onClick={() => onSelect(j.id)}
      className={`rounded-lg cursor-pointer border p-1.5 min-w-0 ${
        active ? "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700" : "bg-transparent border-transparent hover:bg-white dark:hover:bg-zinc-800"
      }`}
    >
      <div className="rounded-md overflow-hidden bg-white border border-zinc-200 dark:border-zinc-700">
        <img src={src} alt={j.name || j.id.slice(0, 8)} loading="lazy" className="w-full h-auto block" />
      </div>
      <div className="flex justify-between items-center gap-1 mt-1">
        <JobName j={j} className="text-[11px]" />
        <Badge color={statusColor(j.status)}>{j.status}</Badge>
      </div>
      <div className="text-[11px] text-zinc-500 truncate">
        {j.task}/{j.method || "gfn2"} ·{" "}
        {live ? `${j.status === "queued" ? "排队" : "运行"} ${elapsedText(j.created_at, now)}` : `${j.result_energy?.toFixed(3) ?? "—"}`}
      </div>
      {!trashMode ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete(j.id)
          }}
          className="w-full text-[11px] text-zinc-400 hover:text-red-600 mt-0.5"
        >
          删除
        </button>
      ) : (
        <div className="flex gap-1 mt-1">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRestore(j.id)
            }}
            className="flex-1 text-[11px] border rounded py-0.5 dark:border-zinc-700"
          >
            恢复
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onHardDelete(j.id)
            }}
            className="flex-1 text-[11px] border rounded py-0.5 text-red-600 dark:border-zinc-700"
          >
            删除
          </button>
        </div>
      )}
    </div>
  )
}

function JobRow({ j, now, active, trashMode, onSelect, onDelete, onRestore, onHardDelete }: ItemProps) {
  const live = j.status === "running" || j.status === "queued"
  return (
    <div
      onClick={() => onSelect(j.id)}
      className={`p-3 rounded-lg cursor-pointer border ${
        active ? "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700" : "bg-transparent border-transparent hover:bg-white dark:hover:bg-zinc-800"
      }`}
    >
      <div className="flex justify-between items-center gap-1">
        <JobName j={j} className="text-xs" />
        <span className="flex items-center gap-1 shrink-0">
          <Badge color={statusColor(j.status)}>{j.status}</Badge>
          {!trashMode && (
            <button
              title="删除"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(j.id)
              }}
              className="px-1 text-zinc-400 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </span>
      </div>
      <div className="text-xs text-zinc-500 mt-1 truncate">
        {j.task}/{j.method || "gfn2"} ·{" "}
        {live
          ? `${j.status === "queued" ? "排队" : "运行"} ${elapsedText(j.created_at, now)}`
          : `${j.result_energy?.toFixed(3) ?? "—"} · ${j.wall_time?.toFixed(1) ?? ""}s`}
      </div>
      <div className="text-[11px] text-zinc-400">{j.created_at}</div>
      {trashMode && (
        <div className="flex gap-1 mt-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onRestore(j.id)
            }}
            className="flex-1 text-[11px] border rounded-lg py-1 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800"
          >
            恢复
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onHardDelete(j.id)
            }}
            className="flex-1 text-[11px] border rounded-lg py-1 text-red-600 dark:border-zinc-700"
          >
            彻底删除
          </button>
        </div>
      )}
    </div>
  )
}

function GroupHeader({
  g,
  collapsed,
  showBar,
  onToggle,
  onOpenBatch,
  onDeleteMany,
}: {
  g: JobGroup
  collapsed: boolean
  showBar: boolean
  onToggle: () => void
  onOpenBatch?: (batchId: string) => void
  onDeleteMany?: (ids: string[]) => void
}) {
  const total = g.jobs.length
  const ended = g.jobs.filter((j) => TERMINAL.includes(j.status))
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="sticky top-0 z-[1] -mx-2 px-2 py-1.5 bg-zinc-50/95 dark:bg-zinc-900/95 backdrop-blur border-b dark:border-zinc-800">
      <button onClick={onToggle} className="flex items-center gap-1 w-full text-left text-xs" title={g.batchId ? `批次 ${g.batchId}` : g.label}>
        <span className="w-3 text-zinc-400">{collapsed ? "▸" : "▾"}</span>
        <span className="font-medium truncate">{g.label}</span>
        <span className="ml-auto shrink-0 text-zinc-400">{total}</span>
      </button>
      <div className="flex items-center gap-2 pl-4 mt-0.5 text-[11px] text-zinc-500">
        <span className="truncate">
          {g.counts.done > 0 && <span className="text-green-600">{g.counts.done} 完成 </span>}
          {g.counts.running > 0 && <span className="text-yellow-600">{g.counts.running} 运行 </span>}
          {g.counts.failed > 0 && <span className="text-red-600">{g.counts.failed} 失败 </span>}
          {g.counts.cancelled > 0 && <span>{g.counts.cancelled} 取消</span>}
        </span>
        <span className="ml-auto flex gap-2 shrink-0">
          {g.batchId && onOpenBatch && (
            <button onClick={() => onOpenBatch(g.batchId as string)} className="hover:text-black dark:hover:text-white">
              进度
            </button>
          )}
          {onDeleteMany && ended.length > 0 && (
            <button
              onClick={() => {
                if (window.confirm(`把「${g.label}」中 ${ended.length} 个已结束任务移入回收站？（可恢复）`)) onDeleteMany(ended.map((j) => j.id))
              }}
              className="hover:text-red-600"
            >
              清理 {ended.length}
            </button>
          )}
        </span>
      </div>
      {showBar && (
        <div className="ml-4 mt-1 h-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden flex">
          <div className="bg-green-500" style={{ width: pct(g.counts.done) }} />
          <div className="bg-red-500" style={{ width: pct(g.counts.failed) }} />
          <div className="bg-zinc-400" style={{ width: pct(g.counts.cancelled) }} />
          <div className="bg-yellow-400" style={{ width: pct(g.counts.running) }} />
        </div>
      )}
    </div>
  )
}

export default function JobList({
  jobs,
  trash,
  curId,
  onSelect,
  onNew,
  onDelete,
  onRestore,
  onHardDelete,
  onClear,
  onOpenBatch,
  onDeleteMany,
  apiHint,
}: JobListProps) {
  const [query, setQuery] = useState("")
  const [statusF, setStatusF] = useState<StatusFilter>("all")
  const [methodF, setMethodF] = useState("all")
  const [trashMode, setTrashMode] = useState(false)
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  // 挂载后再读本地偏好，避免与预渲染 HTML 不一致
  useEffect(() => setPrefs(loadPrefs()), [])
  const updatePrefs = (u: Partial<Prefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...u }
      savePrefs(next)
      return next
    })

  const source = trashMode ? trash : jobs
  const counts = (s: StatusFilter) => (s === "all" ? source.length : source.filter((j) => j.status === s).length)
  const q = query.trim().toLowerCase()
  const list = source.filter(
    (j) =>
      (statusF === "all" || j.status === statusF || (statusF === "running" && j.status === "queued")) &&
      (methodF === "all" || (j.method || "gfn2") === methodF) &&
      (q === "" ||
        j.id.toLowerCase().includes(q) ||
        (j.name || "").toLowerCase().includes(q) ||
        (j.task || "").toLowerCase().includes(q) ||
        (j.method || "").toLowerCase().includes(q)),
  )
  // now 每秒变：分组只依赖数据与偏好，"今天/昨天"按分钟级刷新足够
  const minute = Math.floor(now / 60000)
  const groups = useMemo(
    () => groupJobs(list, prefs.groupBy, prefs.sortBy, minute * 60000),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, statusF, methodF, q, prefs.groupBy, prefs.sortBy, minute],
  )
  const doneCount = jobs.filter((j) => j.status === "done").length
  const runningCount = jobs.filter((j) => j.status === "running" || j.status === "queued").length
  const grouped = prefs.groupBy !== "none"
  const isCollapsed = (g: JobGroup) => grouped && !!prefs.collapsed[`${prefs.groupBy}|${g.key}`]
  const toggle = (g: JobGroup) => {
    const k = `${prefs.groupBy}|${g.key}`
    updatePrefs({ collapsed: { ...prefs.collapsed, [k]: !prefs.collapsed[k] } })
  }
  const setAllCollapsed = (v: boolean) => {
    const c = { ...prefs.collapsed }
    for (const g of groups) c[`${prefs.groupBy}|${g.key}`] = v
    updatePrefs({ collapsed: c })
  }

  const itemProps = (j: JobListItem): ItemProps => ({
    j,
    now,
    active: curId === j.id,
    trashMode,
    onSelect,
    onDelete,
    onRestore,
    onHardDelete,
  })

  const selectCls = "border rounded-lg px-1 py-1 text-[11px] dark:bg-zinc-950 dark:border-zinc-800"

  return (
    <>
      <div className="p-3 space-y-2 border-b dark:border-zinc-800">
        <Button onClick={onNew} className="w-full">
          ＋ 新建任务
        </Button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索 名称 / id / 任务 / 方法…"
          className="w-full border rounded-lg px-2 py-1.5 text-xs dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
        />
        <div className="flex flex-wrap gap-1">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => setStatusF(c.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] ${
                statusF === c.key ? "bg-black text-white dark:bg-white dark:text-black" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {c.label} {counts(c.key)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <select value={methodF} onChange={(e) => setMethodF(e.target.value)} className={`flex-1 ${selectCls}`}>
            {METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setTrashMode(!trashMode)}
            className={`flex-1 border rounded-lg px-1 py-1 text-[11px] ${
              trashMode ? "bg-black text-white dark:bg-white dark:text-black" : "dark:border-zinc-800 dark:text-zinc-300"
            }`}
          >
            🗑 回收站({trash.length})
          </button>
        </div>
        {!trashMode && (
          <div className="flex gap-1">
            <button
              onClick={() => onClear(["done"])}
              className="flex-1 text-[11px] text-zinc-500 hover:text-red-600 border rounded-lg py-1 dark:border-zinc-800"
            >
              清已完成
            </button>
            <button
              onClick={() => onClear(["failed", "cancelled"])}
              className="flex-1 text-[11px] text-zinc-500 hover:text-red-600 border rounded-lg py-1 dark:border-zinc-800"
            >
              清失败/取消
            </button>
          </div>
        )}
        <div className="flex gap-1">
          <select value={prefs.groupBy} onChange={(e) => updatePrefs({ groupBy: e.target.value as GroupBy })} className={`flex-1 ${selectCls}`} title="分组方式">
            {GROUP_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={prefs.sortBy} onChange={(e) => updatePrefs({ sortBy: e.target.value as SortBy })} className={`flex-1 ${selectCls}`} title="组内排序">
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 text-xs text-zinc-500">
          <span>
            {doneCount} 已完成 · {runningCount} 运行中
          </span>
          <span className="ml-auto flex gap-1">
            {grouped && groups.length > 1 && (
              <>
                <button onClick={() => setAllCollapsed(true)} title="全部折叠" className="px-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800">
                  ⊟
                </button>
                <button onClick={() => setAllCollapsed(false)} title="全部展开" className="px-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800">
                  ⊞
                </button>
              </>
            )}
            <button
              onClick={() => updatePrefs({ view: "list" })}
              title="列表视图"
              className={`px-1.5 rounded ${prefs.view === "list" ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}
            >
              ☰
            </button>
            <button
              onClick={() => updatePrefs({ view: "cards" })}
              title="卡片视图（分子结构）"
              className={`px-1.5 rounded ${prefs.view === "cards" ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}
            >
              ▦
            </button>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2">
        {groups.map((g) => {
          const collapsed = isCollapsed(g)
          return (
            <section key={g.key} className={grouped ? "mb-1" : "pt-2"}>
              {grouped && (
                <GroupHeader
                  g={g}
                  collapsed={collapsed}
                  showBar={prefs.groupBy === "batch" && !!g.batchId}
                  onToggle={() => toggle(g)}
                  onOpenBatch={trashMode ? undefined : onOpenBatch}
                  onDeleteMany={trashMode ? undefined : onDeleteMany}
                />
              )}
              {!collapsed &&
                (prefs.view === "cards" ? (
                  <div className="grid grid-cols-2 gap-2 content-start pt-2">
                    {g.jobs.map((j) => (
                      <JobCard key={j.id} {...itemProps(j)} />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1 pt-1">
                    {g.jobs.map((j) => (
                      <JobRow key={j.id} {...itemProps(j)} />
                    ))}
                  </div>
                ))}
            </section>
          )
        })}
        {list.length === 0 && <div className="text-xs text-zinc-400 text-center py-8">{trashMode ? "回收站是空的" : "暂无任务"}</div>}
      </div>
      {apiHint !== undefined && (
        <div className="p-3 border-t dark:border-zinc-800 text-[11px] text-zinc-500">
          法国VPS 24核 · xtb/psi4/uff · {apiHint || "/api"}
        </div>
      )}
    </>
  )
}
