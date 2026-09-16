"use client"

// 侧边栏任务列表：快速切换任务；完整整理/多选操作在主区「任务」页（JobBoard）
import { useEffect, useState } from "react"
import type { JobListItem } from "@/shared/schemas/job"
import Button from "@/app/components/ui/Button"
import { jobImageUrl } from "@/lib/api"
import type { GroupBy, JobGroup, SortBy } from "@/lib/jobGroups"
import { formatEnergy, isLive, isTerminal } from "@/lib/jobMeta"
import { useJobs } from "@/lib/jobs/JobsContext"
import { useJobOrganizer, type OrganizerPrefs } from "@/lib/hooks/useJobOrganizer"
import { CountsText, GROUP_OPTIONS, JobName, LoadMore, METHOD_FILTERS, ProgressBar, SORT_OPTIONS, STATUS_CHIPS, StatusBadge, elapsedText } from "@/app/components/jobs/JobBits"

export interface JobListProps {
  curId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  /** 批次分组 → 打开批量页查看该批进度 */
  onOpenBatch?: (batchId: string) => void
  /** 在主区「任务」页打开（大卡片 + 多选） */
  onExpand?: () => void
}

type ViewMode = "list" | "cards"

interface Prefs extends OrganizerPrefs {
  view: ViewMode
}
const DEFAULT_PREFS: Prefs = { groupBy: "batch", sortBy: "time", view: "cards", collapsed: {} }

// 侧边栏每组首批渲染数量（任务多时滚到底自动加载）
const SIDEBAR_PAGE = 40

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

const liveText = (j: JobListItem, now: number) => `${j.status === "queued" ? "排队" : "运行"} ${elapsedText(j.created_at, now)}`

function TrashActions({ j, onRestore, onHardDelete, compact }: Pick<ItemProps, "j" | "onRestore" | "onHardDelete"> & { compact: boolean }) {
  const cls = compact ? "flex-1 text-[11px] border rounded py-0.5 dark:border-zinc-700" : "flex-1 text-[11px] border rounded-lg py-1 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-800"
  return (
    <div className={`flex gap-1 ${compact ? "mt-1" : "mt-2"}`}>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRestore(j.id)
        }}
        className={cls}
      >
        恢复
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onHardDelete(j.id)
        }}
        className={`${cls} text-red-600`}
      >
        {compact ? "删除" : "彻底删除"}
      </button>
    </div>
  )
}

function JobCard(p: ItemProps) {
  const { j, now, active, trashMode } = p
  const live = isLive(j)
  const src = jobImageUrl(j.id) + (live ? `?t=${Math.floor(now / 10000)}` : "")
  return (
    <div
      onClick={() => p.onSelect(j.id)}
      className={`rounded-lg cursor-pointer border p-1.5 min-w-0 ${
        active ? "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700" : "bg-transparent border-transparent hover:bg-white dark:hover:bg-zinc-800"
      }`}
    >
      <div className="rounded-md overflow-hidden bg-white border border-zinc-200 dark:border-zinc-700">
        <img src={src} alt={j.name || j.id.slice(0, 8)} loading="lazy" className="w-full h-auto block" />
      </div>
      <div className="flex justify-between items-center gap-1 mt-1">
        <JobName j={j} className="text-[11px]" />
        <StatusBadge status={j.status} />
      </div>
      <div className="text-[11px] text-zinc-500 truncate">
        {j.task}/{j.method || "gfn2"} · {live ? liveText(j, now) : formatEnergy(j.result_energy, j.method, 3)}
      </div>
      {!trashMode ? (
        <button
          onClick={(e) => {
            e.stopPropagation()
            p.onDelete(j.id)
          }}
          className="w-full text-[11px] text-zinc-400 hover:text-red-600 mt-0.5"
        >
          删除
        </button>
      ) : (
        <TrashActions j={j} onRestore={p.onRestore} onHardDelete={p.onHardDelete} compact />
      )}
    </div>
  )
}

function JobRow(p: ItemProps) {
  const { j, now, active, trashMode } = p
  const live = isLive(j)
  return (
    <div
      onClick={() => p.onSelect(j.id)}
      className={`p-3 rounded-lg cursor-pointer border ${
        active ? "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700" : "bg-transparent border-transparent hover:bg-white dark:hover:bg-zinc-800"
      }`}
    >
      <div className="flex justify-between items-center gap-1">
        <JobName j={j} className="text-xs" />
        <span className="flex items-center gap-1 shrink-0">
          <StatusBadge status={j.status} />
          {!trashMode && (
            <button
              title="删除"
              onClick={(e) => {
                e.stopPropagation()
                p.onDelete(j.id)
              }}
              className="px-1 text-zinc-400 hover:text-red-600"
            >
              ✕
            </button>
          )}
        </span>
      </div>
      <div className="text-xs text-zinc-500 mt-1 truncate">
        {j.task}/{j.method || "gfn2"} · {live ? liveText(j, now) : `${formatEnergy(j.result_energy, j.method, 3)} · ${j.wall_time?.toFixed(1) ?? ""}s`}
      </div>
      <div className="text-[11px] text-zinc-400">{j.created_at}</div>
      {trashMode && <TrashActions j={j} onRestore={p.onRestore} onHardDelete={p.onHardDelete} compact={false} />}
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
  const ended = g.jobs.filter((j) => isTerminal(j.status))
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

export default function JobList({ curId, onSelect, onNew, onOpenBatch, onExpand }: JobListProps) {
  const api = useJobs()
  const [trashMode, setTrashMode] = useState(false)
  const source = trashMode ? api.trash : api.jobs
  const org = useJobOrganizer<Prefs>(source, { storageKey: "jobList.prefs.v1", defaults: DEFAULT_PREFS, pageSizeOf: () => SIDEBAR_PAGE, resetKey: trashMode })
  const { prefs, update, groups, grouped } = org

  // 有运行中任务时每秒刷新耗时文案
  const hasLive = source.some(isLive)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!hasLive) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [hasLive])

  const itemProps = (j: JobListItem): ItemProps => ({
    j,
    now,
    active: curId === j.id,
    trashMode,
    onSelect,
    onDelete: (id) => api.deleteMany([id]),
    onRestore: (id) => api.restoreMany([id]),
    onHardDelete: (id) => window.confirm("彻底删除这个任务？此操作不可恢复。") && api.hardDeleteMany([id]),
  })

  const selectCls = "border rounded-lg px-1 py-1 text-[11px] dark:bg-zinc-950 dark:border-zinc-800"
  const toggleCls = (on: boolean) => `px-1.5 rounded ${on ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`

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
          value={org.query}
          onChange={(e) => org.setQuery(e.target.value)}
          placeholder="搜索 名称 / id / 任务 / 方法…"
          className="w-full border rounded-lg px-2 py-1.5 text-xs dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
        />
        <div className="flex flex-wrap gap-1">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => org.setStatusF(c.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] ${
                org.statusF === c.key ? "bg-black text-white dark:bg-white dark:text-black" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {c.label} {org.countOf(c.key)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <select value={org.methodF} onChange={(e) => org.setMethodF(e.target.value)} className={`flex-1 ${selectCls}`}>
            {METHOD_FILTERS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setTrashMode(!trashMode)}
            className={`flex-1 border rounded-lg px-1 py-1 text-[11px] ${trashMode ? "bg-black text-white dark:bg-white dark:text-black" : "dark:border-zinc-800 dark:text-zinc-300"}`}
          >
            🗑 回收站({api.trash.length})
          </button>
        </div>
        {!trashMode && (
          <div className="flex gap-1">
            <button onClick={() => api.clearByStatus(["done"])} className="flex-1 text-[11px] text-zinc-500 hover:text-red-600 border rounded-lg py-1 dark:border-zinc-800">
              清已完成
            </button>
            <button
              onClick={() => api.clearByStatus(["failed", "cancelled"])}
              className="flex-1 text-[11px] text-zinc-500 hover:text-red-600 border rounded-lg py-1 dark:border-zinc-800"
            >
              清失败/取消
            </button>
          </div>
        )}
        <div className="flex gap-1">
          <select value={prefs.groupBy} onChange={(e) => update({ groupBy: e.target.value as GroupBy })} className={`flex-1 ${selectCls}`} title="分组方式">
            {GROUP_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={prefs.sortBy} onChange={(e) => update({ sortBy: e.target.value as SortBy })} className={`flex-1 ${selectCls}`} title="组内排序">
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 text-xs text-zinc-500">
          <span>
            {api.jobs.filter((j) => j.status === "done").length} 已完成 · {api.jobs.filter(isLive).length} 运行中
          </span>
          <span className="ml-auto flex gap-1">
            {grouped && groups.length > 1 && (
              <>
                <button onClick={() => org.setAllCollapsed(true)} title="全部折叠" className={toggleCls(false)}>
                  ⊟
                </button>
                <button onClick={() => org.setAllCollapsed(false)} title="全部展开" className={toggleCls(false)}>
                  ⊞
                </button>
              </>
            )}
            <button onClick={() => update({ view: "list" })} title="列表视图" className={toggleCls(prefs.view === "list")}>
              ☰
            </button>
            <button onClick={() => update({ view: "cards" })} title="卡片视图（分子结构）" className={toggleCls(prefs.view === "cards")}>
              ▦
            </button>
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-auto px-2 pb-2">
        {groups.map((g) => {
          const collapsed = org.isCollapsed(g)
          const limit = org.limitOf(g)
          const shown = g.jobs.slice(0, limit)
          return (
            <section key={g.key} className={grouped ? "mb-1" : "pt-2"}>
              {grouped && (
                <GroupHeader
                  g={g}
                  collapsed={collapsed}
                  showBar={prefs.groupBy === "batch" && !!g.batchId}
                  onToggle={() => org.toggleGroup(g)}
                  onOpenBatch={trashMode ? undefined : onOpenBatch}
                  onDeleteMany={trashMode ? undefined : api.deleteMany}
                />
              )}
              {!collapsed &&
                (prefs.view === "cards" ? (
                  <div className="grid grid-cols-2 gap-2 content-start pt-2">
                    {shown.map((j) => (
                      <JobCard key={j.id} {...itemProps(j)} />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1 pt-1">
                    {shown.map((j) => (
                      <JobRow key={j.id} {...itemProps(j)} />
                    ))}
                  </div>
                ))}
              {!collapsed && g.jobs.length > limit && <LoadMore remaining={g.jobs.length - limit} onMore={() => org.showMore(g.key)} />}
            </section>
          )
        })}
        {org.list.length === 0 && <div className="text-xs text-zinc-400 text-center py-8">{trashMode ? "回收站是空的" : "暂无任务"}</div>}
      </div>
      <div className="p-3 border-t dark:border-zinc-800 text-[11px] text-zinc-500">法国VPS 24核 · xtb/psi4/uff · /api 代理</div>
    </>
  )
}
