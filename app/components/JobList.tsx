"use client"

// 侧边栏任务列表：快速切换任务；完整整理/多选操作在主区「任务」页（JobBoard）
import { useEffect, useMemo, useState } from "react"
import type { JobListItem, JobStatus } from "@/shared/schemas/job"
import Button from "@/app/components/ui/Button"
import { jobImageUrl } from "@/lib/api"
import { groupJobs, type GroupBy, type JobGroup, type SortBy } from "@/lib/jobGroups"
import { usePrefs } from "@/lib/hooks/usePrefs"
import {
  Badge,
  CountsText,
  GROUP_OPTIONS,
  JobName,
  METHODS,
  ProgressBar,
  SORT_OPTIONS,
  STATUS_CHIPS,
  TERMINAL,
  collapseKey,
  countByStatus,
  elapsedText,
  filterJobs,
  isLive,
  pruneCollapsed,
  statusColor,
  type StatusFilter,
} from "@/app/components/jobs/JobBits"

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
  /** 在主区「任务」页打开（大卡片 + 多选） */
  onExpand?: () => void
  apiHint?: string
}

type ViewMode = "list" | "cards"

interface Prefs {
  groupBy: GroupBy
  sortBy: SortBy
  view: ViewMode
  collapsed: Record<string, boolean>
}
const DEFAULT_PREFS: Prefs = { groupBy: "batch", sortBy: "time", view: "cards", collapsed: {} }

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

function JobCard({ j, now, active, trashMode, onSelect, onDelete, onRestore, onHardDelete }: ItemProps) {
  const live = isLive(j)
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
  const live = isLive(j)
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
  const ended = g.jobs.filter((j) => TERMINAL.includes(j.status))
  return (
    <div className="sticky top-0 z-[1] -mx-2 px-2 py-1.5 bg-zinc-50/95 dark:bg-zinc-900/95 backdrop-blur border-b dark:border-zinc-800">
      <button onClick={onToggle} className="flex items-center gap-1 w-full text-left text-xs" title={g.batchId ? `批次 ${g.batchId}` : g.label}>
        <span className="w-3 text-zinc-400">{collapsed ? "▸" : "▾"}</span>
        <span className="font-medium truncate">{g.label}</span>
        <span className="ml-auto shrink-0 text-zinc-400">{g.jobs.length}</span>
      </button>
      <div className="flex items-center gap-2 pl-4 mt-0.5 text-[11px] text-zinc-500">
        <CountsText counts={g.counts} />
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
      {showBar && <ProgressBar counts={g.counts} total={g.jobs.length} className="ml-4 mt-1 h-1" />}
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
  onExpand,
  apiHint,
}: JobListProps) {
  const [query, setQuery] = useState("")
  const [statusF, setStatusF] = useState<StatusFilter>("all")
  const [methodF, setMethodF] = useState("all")
  const [trashMode, setTrashMode] = useState(false)
  const [prefs, updatePrefs] = usePrefs<Prefs>("jobList.prefs.v1", DEFAULT_PREFS, pruneCollapsed)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const source = trashMode ? trash : jobs
  const list = useMemo(() => filterJobs(source, statusF, methodF, query), [source, statusF, methodF, query])
  // now 每秒变：分组只按分钟刷新（"今天/昨天"够用）
  const minute = Math.floor(now / 60000)
  const groups = useMemo(() => groupJobs(list, prefs.groupBy, prefs.sortBy, minute * 60000), [list, prefs.groupBy, prefs.sortBy, minute])
  const doneCount = jobs.filter((j) => j.status === "done").length
  const runningCount = jobs.filter(isLive).length
  const grouped = prefs.groupBy !== "none"
  const isCollapsed = (g: JobGroup) => grouped && !!prefs.collapsed[collapseKey(prefs.groupBy, g.key)]
  const toggle = (g: JobGroup) => {
    const k = collapseKey(prefs.groupBy, g.key)
    updatePrefs({ collapsed: { ...prefs.collapsed, [k]: !prefs.collapsed[k] } })
  }
  const setAllCollapsed = (v: boolean) => {
    const c = { ...prefs.collapsed }
    for (const g of groups) c[collapseKey(prefs.groupBy, g.key)] = v
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
        <div className="flex gap-2">
          <Button onClick={onNew} className="flex-1">
            ＋ 新建任务
          </Button>
          {onExpand && (
            <Button variant="outline" onClick={onExpand} title="在主区打开任务页：大卡片、表格、多选批量操作">
              ⤢
            </Button>
          )}
        </div>
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
              {c.label} {countByStatus(source, c.key)}
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
