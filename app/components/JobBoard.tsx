"use client"

// 任务页（主区）：大卡片 / 表格，分组归类 + 多选批量操作
import { useEffect, useMemo, useState } from "react"
import type { JobListItem } from "@/shared/schemas/job"
import { jobImageUrl } from "@/lib/api"
import { groupJobs, type GroupBy, type JobGroup, type SortBy } from "@/lib/jobGroups"
import { downloadCsv, jobsToCsv } from "@/lib/csv"
import { usePrefs } from "@/lib/hooks/usePrefs"
import {
  Badge,
  Check,
  CountsText,
  GROUP_OPTIONS,
  JobName,
  METHODS,
  ProgressBar,
  SORT_OPTIONS,
  STATUS_CHIPS,
  collapseKey,
  countByStatus,
  elapsedText,
  filterJobs,
  isLive,
  pruneCollapsed,
  statusColor,
  type StatusFilter,
} from "@/app/components/jobs/JobBits"

type BoardView = "cards" | "table"
type CardSize = "s" | "m" | "l"

interface BoardPrefs {
  groupBy: GroupBy
  sortBy: SortBy
  view: BoardView
  size: CardSize
  collapsed: Record<string, boolean>
}

const DEFAULT_PREFS: BoardPrefs = { groupBy: "batch", sortBy: "time", view: "cards", size: "m", collapsed: {} }

const GRID: Record<CardSize, string> = {
  s: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8",
  m: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5",
  l: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3",
}

// 小卡片不显示徽章，用文字颜色表示状态（完整类名写死，Tailwind 才能扫描到）
const STATUS_TEXT: Record<string, string> = {
  green: "text-green-600",
  yellow: "text-yellow-600",
  red: "text-red-600",
  gray: "text-zinc-500",
}

const SIZE_OPTIONS: { key: CardSize; label: string }[] = [
  { key: "s", label: "小" },
  { key: "m", label: "中" },
  { key: "l", label: "大" },
]

export interface JobBoardProps {
  /** 任务页可见时才每秒刷新运行耗时 */
  active: boolean
  jobs: JobListItem[]
  trash: JobListItem[]
  curId: string | null
  msg: string
  onSelect: (id: string) => void
  onOpenBatch: (batchId: string) => void
  onCancelMany: (ids: string[]) => Promise<void>
  onDeleteMany: (ids: string[]) => Promise<void>
  onRestoreMany: (ids: string[]) => Promise<void>
  onHardDeleteMany: (ids: string[]) => Promise<void>
  onRerunMany: (ids: string[]) => Promise<void>
}

const selectCls = "border rounded-lg px-2 py-1.5 text-xs bg-white dark:bg-zinc-950 dark:border-zinc-800"
const actCls = "px-2.5 py-1 rounded-lg border text-xs bg-white dark:bg-zinc-900 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-lg bg-zinc-100 dark:bg-zinc-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`px-2 py-1 rounded-md text-xs ${value === o.key ? "bg-white dark:bg-zinc-950 shadow" : "text-zinc-500"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

interface CardProps {
  j: JobListItem
  now: number
  size: CardSize
  checked: boolean
  selecting: boolean
  active: boolean
  onToggle: () => void
  onOpen: () => void
}

function BoardCard({ j, now, size, checked, selecting, active, onToggle, onOpen }: CardProps) {
  const live = isLive(j)
  const src = jobImageUrl(j.id) + (live ? `?t=${Math.floor(now / 10000)}` : "")
  return (
    <div
      onClick={() => (selecting ? onToggle() : onOpen())}
      className={`group relative rounded-xl border bg-white dark:bg-zinc-900 overflow-hidden cursor-pointer transition min-w-0 ${
        checked
          ? "ring-2 ring-blue-500 border-blue-500"
          : active
            ? "border-zinc-500 dark:border-zinc-400"
            : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      <div className="relative bg-white border-b border-zinc-100 dark:border-zinc-800">
        <img src={src} alt={j.name || j.id.slice(0, 8)} loading="lazy" className="w-full h-auto block" />
        <div className={`absolute top-1.5 left-1.5 rounded bg-white/90 p-0.5 transition ${checked || selecting ? "" : "md:opacity-0 md:group-hover:opacity-100"}`}>
          <Check checked={checked} onChange={onToggle} title="选择" />
        </div>
      </div>
      <div className="p-2 space-y-0.5">
        <div className="flex items-center gap-1 min-w-0">
          <JobName j={j} className={size === "s" ? "text-[11px]" : "text-xs"} />
          {size !== "s" && (
            <span className="ml-auto shrink-0">
              <Badge color={statusColor(j.status)}>{j.status}</Badge>
            </span>
          )}
        </div>
        {size !== "s" && (
          <div className="text-[11px] text-zinc-500 truncate">
            {j.task}/{j.method || "gfn2"}
            {j.batch_id ? " · 📦" : ""}
          </div>
        )}
        <div className={`text-[11px] font-mono truncate ${size === "s" ? STATUS_TEXT[statusColor(j.status)] : ""}`}>
          {live ? `${j.status === "queued" ? "排队" : "运行"} ${elapsedText(j.created_at, now)}` : j.result_energy != null ? `${j.result_energy.toFixed(size === "l" ? 6 : 4)} Eh` : j.status === "done" ? "—" : j.status}
        </div>
        {size === "l" && (
          <div className="text-[11px] text-zinc-400 truncate">
            {j.wall_time != null ? `${j.wall_time.toFixed(1)}s · ` : ""}
            {j.created_at}
          </div>
        )}
      </div>
    </div>
  )
}

type SortCol = { key: SortBy; label: string; cls: string }
const SORT_COLS: Record<string, SortCol> = {
  name: { key: "name", label: "名称", cls: "text-left" },
  energy: { key: "energy", label: "能量 (Eh)", cls: "text-right" },
  time: { key: "time", label: "创建时间", cls: "text-left hidden md:table-cell" },
}

export default function JobBoard(p: JobBoardProps) {
  const [prefs, update] = usePrefs<BoardPrefs>("jobBoard.prefs.v1", DEFAULT_PREFS, pruneCollapsed)
  const [query, setQuery] = useState("")
  const [statusF, setStatusF] = useState<StatusFilter>("all")
  const [methodF, setMethodF] = useState("all")
  const [trashMode, setTrashMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState("")
  const [now, setNow] = useState(() => Date.now())

  const source = trashMode ? p.trash : p.jobs
  const hasLive = source.some(isLive)

  // 只在可见且有运行中任务时每秒刷新耗时，避免后台隐藏时几百张卡片每秒重绘
  useEffect(() => {
    if (!p.active || !hasLive) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [p.active, hasLive])

  // 切换回收站清空选择；数据刷新后去掉已不存在的选中项
  useEffect(() => setSelected(new Set()), [trashMode])
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const ids = new Set(source.map((j) => j.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [source])

  // Esc 清空选择（输入框内不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.key === "Escape" && tag !== "INPUT" && tag !== "TEXTAREA") setSelected(new Set())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const list = useMemo(() => filterJobs(source, statusF, methodF, query), [source, statusF, methodF, query])
  // 数据每 3s 轮询刷新，list 随之重算，"今天/昨天"取计算时刻即可
  const groups = useMemo(() => groupJobs(list, prefs.groupBy, prefs.sortBy, Date.now()), [list, prefs.groupBy, prefs.sortBy])
  const grouped = prefs.groupBy !== "none"

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev)
      for (const id of ids) on ? n.add(id) : n.delete(id)
      return n
    })
  const toggleOne = (id: string) => setMany([id], !selected.has(id))

  const isCollapsed = (g: JobGroup) => grouped && !!prefs.collapsed[collapseKey(prefs.groupBy, g.key)]
  const toggleGroup = (g: JobGroup) => {
    const k = collapseKey(prefs.groupBy, g.key)
    update({ collapsed: { ...prefs.collapsed, [k]: !prefs.collapsed[k] } })
  }
  const setAllCollapsed = (v: boolean) => {
    const c = { ...prefs.collapsed }
    for (const g of groups) c[collapseKey(prefs.groupBy, g.key)] = v
    update({ collapsed: c })
  }

  const selJobs = source.filter((j) => selected.has(j.id))
  const selIds = selJobs.map((j) => j.id)
  const selLive = selJobs.filter(isLive)
  const selecting = selected.size > 0
  const visibleIds = list.map((j) => j.id)

  const run = async (label: string, fn: (ids: string[]) => Promise<void>, ids: string[], confirmText?: string) => {
    if (ids.length === 0 || (confirmText && !window.confirm(confirmText))) return
    setBusy(label)
    try {
      await fn(ids)
      setSelected(new Set())
    } finally {
      setBusy("")
    }
  }

  const exportSelected = () => downloadCsv(`jobs-${new Date().toISOString().slice(0, 10)}-${selJobs.length}.csv`, jobsToCsv(selJobs))

  const groupCheck = (g: JobGroup) => {
    const ids = g.jobs.map((j) => j.id)
    const n = ids.filter((id) => selected.has(id)).length
    return <Check checked={n > 0 && n === ids.length} indeterminate={n > 0} onChange={(on) => setMany(ids, on)} title="选择本组" />
  }

  const sortHeader = (c: SortCol) => (
    <th className={`p-2 font-normal ${c.cls}`}>
      <button onClick={() => update({ sortBy: c.key })} className={prefs.sortBy === c.key ? "text-black dark:text-white font-medium" : "hover:text-black dark:hover:text-white"}>
        {c.label}
        {prefs.sortBy === c.key ? (c.key === "time" ? " ↓" : " ↑") : ""}
      </button>
    </th>
  )

  return (
    <div className="space-y-3">
      <div className="bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold">{trashMode ? "回收站" : "任务"}</div>
          <span className="text-xs text-zinc-500">
            {list.length}/{source.length} 个{groups.length > 1 ? ` · ${groups.length} 组` : ""}
          </span>
          {p.msg && <span className="text-xs text-green-600 truncate">{p.msg}</span>}
          <button
            onClick={() => setTrashMode(!trashMode)}
            className={`ml-auto px-2.5 py-1 rounded-lg border text-xs ${trashMode ? "bg-black text-white dark:bg-white dark:text-black" : "dark:border-zinc-700"}`}
          >
            🗑 回收站({p.trash.length})
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 名称 / id / 任务 / 方法…"
            className="flex-1 min-w-[10rem] border rounded-lg px-2 py-1.5 text-xs dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
          />
          <div className="flex flex-wrap gap-1">
            {STATUS_CHIPS.map((c) => (
              <button
                key={c.key}
                onClick={() => setStatusF(c.key)}
                className={`px-2 py-1 rounded-full text-xs ${
                  statusF === c.key ? "bg-black text-white dark:bg-white dark:text-black" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {c.label} {countByStatus(source, c.key)}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={methodF} onChange={(e) => setMethodF(e.target.value)} className={selectCls} title="方法筛选">
            {METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <select value={prefs.groupBy} onChange={(e) => update({ groupBy: e.target.value as GroupBy })} className={selectCls} title="分组方式">
            {GROUP_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={prefs.sortBy} onChange={(e) => update({ sortBy: e.target.value as SortBy })} className={selectCls} title="组内排序">
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <Segmented<BoardView>
            value={prefs.view}
            options={[
              { key: "cards", label: "▦ 卡片" },
              { key: "table", label: "☰ 表格" },
            ]}
            onChange={(v) => update({ view: v })}
          />
          {prefs.view === "cards" && <Segmented<CardSize> value={prefs.size} options={SIZE_OPTIONS} onChange={(v) => update({ size: v })} />}
          <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
            {grouped && groups.length > 1 && (
              <>
                <button onClick={() => setAllCollapsed(true)} className="hover:text-black dark:hover:text-white">
                  全部折叠
                </button>
                <button onClick={() => setAllCollapsed(false)} className="hover:text-black dark:hover:text-white">
                  全部展开
                </button>
              </>
            )}
            {list.length > 0 && (
              <button onClick={() => setMany(visibleIds, true)} className="hover:text-black dark:hover:text-white">
                全选 {list.length}
              </button>
            )}
          </span>
        </div>
      </div>

      {groups.map((g) => {
        const collapsed = isCollapsed(g)
        return (
          <section key={g.key} className="bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm">
            {grouped && (
              <div
                className={`sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-white/95 dark:bg-zinc-900/95 backdrop-blur rounded-t-xl ${
                  collapsed ? "rounded-b-xl" : "border-b dark:border-zinc-800"
                }`}
              >
                {groupCheck(g)}
                <button onClick={() => toggleGroup(g)} className="flex items-center gap-1 text-sm font-medium min-w-0" title={g.batchId ? `批次 ${g.batchId}` : g.label}>
                  <span className="w-3 text-zinc-400">{collapsed ? "▸" : "▾"}</span>
                  <span className="truncate">{g.label}</span>
                </button>
                <span className="text-xs text-zinc-400">{g.jobs.length}</span>
                <span className="text-xs">
                  <CountsText counts={g.counts} />
                </span>
                {prefs.groupBy === "batch" && g.batchId && <ProgressBar counts={g.counts} total={g.jobs.length} className="w-24 md:w-40 h-1.5" />}
                {g.batchId && !trashMode && (
                  <button onClick={() => p.onOpenBatch(g.batchId as string)} className="ml-auto text-xs text-zinc-500 hover:text-black dark:hover:text-white">
                    批次进度 →
                  </button>
                )}
              </div>
            )}
            {!collapsed &&
              (prefs.view === "cards" ? (
                <div className={`grid gap-3 p-3 ${GRID[prefs.size]}`}>
                  {g.jobs.map((j) => (
                    <BoardCard
                      key={j.id}
                      j={j}
                      now={now}
                      size={prefs.size}
                      checked={selected.has(j.id)}
                      selecting={selecting}
                      active={p.curId === j.id}
                      onToggle={() => toggleOne(j.id)}
                      onOpen={() => p.onSelect(j.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-zinc-500">
                      <tr className="border-b dark:border-zinc-800">
                        <th className="p-2 w-8">{!grouped && groupCheck(g)}</th>
                        {sortHeader(SORT_COLS.name)}
                        <th className="p-2 font-normal text-left">状态</th>
                        <th className="p-2 font-normal text-left hidden sm:table-cell">任务/方法</th>
                        {sortHeader(SORT_COLS.energy)}
                        <th className="p-2 font-normal text-right hidden sm:table-cell">耗时</th>
                        {sortHeader(SORT_COLS.time)}
                      </tr>
                    </thead>
                    <tbody>
                      {g.jobs.map((j) => (
                        <tr
                          key={j.id}
                          onClick={() => (selecting ? toggleOne(j.id) : p.onSelect(j.id))}
                          className={`border-b last:border-b-0 dark:border-zinc-800 cursor-pointer ${
                            selected.has(j.id) ? "bg-blue-50 dark:bg-blue-950" : p.curId === j.id ? "bg-zinc-50 dark:bg-zinc-800" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <td className="p-2 text-center">
                            <Check checked={selected.has(j.id)} onChange={() => toggleOne(j.id)} />
                          </td>
                          <td className="p-2 max-w-[16rem]">
                            <div className="flex items-center gap-1 min-w-0">
                              <JobName j={j} className="text-xs" />
                              {j.batch_id && !grouped && <span title={`批次 ${j.batch_id}`}>📦</span>}
                            </div>
                          </td>
                          <td className="p-2">
                            <Badge color={statusColor(j.status)}>{j.status}</Badge>
                          </td>
                          <td className="p-2 text-zinc-500 hidden sm:table-cell">
                            {j.task}/{j.method || "gfn2"}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {isLive(j) ? <span className="text-yellow-600">{elapsedText(j.created_at, now)}</span> : j.result_energy?.toFixed(6) ?? "—"}
                          </td>
                          <td className="p-2 text-right hidden sm:table-cell">{j.wall_time != null ? `${j.wall_time.toFixed(1)}s` : "—"}</td>
                          <td className="p-2 text-zinc-400 hidden md:table-cell whitespace-nowrap">{j.created_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </section>
        )
      })}

      {list.length === 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 text-sm text-zinc-400 text-center py-16">
          {source.length === 0 ? (trashMode ? "回收站是空的" : "暂无任务") : "没有符合筛选条件的任务"}
        </div>
      )}

      {selecting && (
        <div className="sticky bottom-0 z-20 pt-2">
          <div className="mx-auto max-w-4xl flex flex-wrap items-center gap-2 rounded-xl border dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg px-3 py-2 text-xs">
            <span className="font-medium">已选 {selected.size}</span>
            <button onClick={() => setMany(visibleIds, true)} className="text-zinc-500 hover:text-black dark:hover:text-white">
              全选可见
            </button>
            <button onClick={() => setSelected(new Set())} className="text-zinc-500 hover:text-black dark:hover:text-white">
              清除 (Esc)
            </button>
            <span className="ml-auto flex flex-wrap items-center gap-2">
              {busy && <span className="text-zinc-500">{busy}中…</span>}
              <button onClick={exportSelected} disabled={!!busy} className={actCls}>
                导出 CSV
              </button>
              {!trashMode ? (
                <>
                  <button
                    onClick={() => run("重跑", p.onRerunMany, selIds, `按原参数重跑 ${selIds.length} 个任务？（作为新批次提交，原任务保留）`)}
                    disabled={!!busy}
                    className={actCls}
                  >
                    重跑
                  </button>
                  {selLive.length > 0 && (
                    <button
                      onClick={() => run("取消", p.onCancelMany, selLive.map((j) => j.id), `取消 ${selLive.length} 个运行中/排队任务？`)}
                      disabled={!!busy}
                      className={actCls}
                    >
                      取消运行 {selLive.length}
                    </button>
                  )}
                  <button
                    onClick={() => run("删除", p.onDeleteMany, selIds, `把 ${selIds.length} 个任务移入回收站？（运行中的会先取消，可恢复）`)}
                    disabled={!!busy}
                    className={`${actCls} text-red-600`}
                  >
                    移入回收站
                  </button>
                </>
              ) : (
                <>
                  <button onClick={() => run("恢复", p.onRestoreMany, selIds)} disabled={!!busy} className={actCls}>
                    恢复
                  </button>
                  <button
                    onClick={() => run("彻底删除", p.onHardDeleteMany, selIds, `彻底删除 ${selIds.length} 个任务？此操作不可恢复。`)}
                    disabled={!!busy}
                    className={`${actCls} text-red-600`}
                  >
                    彻底删除
                  </button>
                </>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
