"use client"

// 任务页（主区）：大卡片 / 表格，分组归类 + 多选批量操作 + 右侧详情抽屉
import { useEffect, useMemo, useRef, useState } from "react"
import type { JobListItem } from "@/shared/schemas/job"
import { jobImageUrl } from "@/lib/api"
import { groupJobs, type GroupBy, type JobGroup, type SortBy } from "@/lib/jobGroups"
import { downloadCsv, jobsToCsv } from "@/lib/csv"
import { usePrefs } from "@/lib/hooks/usePrefs"
import JobDetailDrawer from "@/app/components/jobs/JobDetailDrawer"
import {
  Badge,
  Check,
  CountsText,
  GROUP_OPTIONS,
  JobName,
  LoadMore,
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

// 详情抽屉在大屏并排显示，主区变窄 → 列数减少
const GRID: Record<CardSize, { full: string; narrow: string }> = {
  s: { full: "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8", narrow: "grid-cols-3 xl:grid-cols-5" },
  m: { full: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5", narrow: "grid-cols-2 xl:grid-cols-3" },
  l: { full: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3", narrow: "grid-cols-1 xl:grid-cols-2" },
}

// 每组首批渲染数量，滚到底自动加载下一批
const PAGE: Record<BoardView, number> = { cards: 60, table: 200 }

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

const QUICK_SELECT: { key: string; label: string }[] = [
  { key: "visible", label: "全部可见" },
  { key: "failed", label: "失败的" },
  { key: "done", label: "已完成的" },
  { key: "live", label: "运行中 / 排队" },
  { key: "cancelled", label: "已取消的" },
  { key: "invert", label: "反选" },
  { key: "none", label: "清除选择" },
]

export interface JobBoardProps {
  /** 任务页可见时才响应快捷键、刷新运行耗时 */
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

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)
}

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
  current: boolean
  opened: boolean
  onClick: (e: React.MouseEvent) => void
  onCheck: (shift: boolean) => void
}

function BoardCard({ j, now, size, checked, selecting, current, opened, onClick, onCheck }: CardProps) {
  const live = isLive(j)
  const src = jobImageUrl(j.id) + (live ? `?t=${Math.floor(now / 10000)}` : "")
  return (
    <div
      id={`job-${j.id}`}
      onClick={onClick}
      className={`group relative select-none rounded-xl border bg-white dark:bg-zinc-900 overflow-hidden cursor-pointer transition min-w-0 ${
        checked
          ? "ring-2 ring-blue-500 border-blue-500"
          : opened
            ? "ring-2 ring-zinc-900 dark:ring-zinc-100 border-transparent"
            : current
              ? "border-zinc-500 dark:border-zinc-400"
              : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
      }`}
    >
      <div className="relative bg-white border-b border-zinc-100 dark:border-zinc-800">
        <img src={src} alt={j.name || j.id.slice(0, 8)} loading="lazy" draggable={false} className="w-full h-auto block" />
        <div className={`absolute top-1.5 left-1.5 rounded bg-white/90 p-0.5 transition ${checked || selecting ? "" : "md:opacity-0 md:group-hover:opacity-100"}`}>
          <Check checked={checked} onChange={(_, shift) => onCheck(shift)} title="选择（Shift 连选）" />
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
          {live
            ? `${j.status === "queued" ? "排队" : "运行"} ${elapsedText(j.created_at, now)}`
            : j.result_energy != null
              ? `${j.result_energy.toFixed(size === "l" ? 6 : 4)} ${j.method === "uff" ? "kcal/mol" : "Eh"}`
              : j.status === "done"
                ? "—"
                : j.status}
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
  energy: { key: "energy", label: "能量", cls: "text-right" },
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
  const [detailId, setDetailId] = useState<string | null>(null)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const anchorRef = useRef<string | null>(null)

  const source = trashMode ? p.trash : p.jobs
  const hasLive = source.some(isLive)

  // 只在可见且有运行中任务时每秒刷新耗时，避免后台隐藏时几百张卡片每秒重绘
  useEffect(() => {
    if (!p.active || !hasLive) return
    setNow(Date.now())
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [p.active, hasLive])

  // 切换回收站：清空选择、关闭抽屉；数据刷新后去掉已不存在的选中项 / 详情
  useEffect(() => {
    setSelected(new Set())
    setDetailId(null)
  }, [trashMode])
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const ids = new Set(source.map((j) => j.id))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
    setDetailId((id) => (id && !source.some((j) => j.id === id) ? null : id))
  }, [source])

  // 视图/筛选变化时分页回到首批
  useEffect(() => setLimits({}), [prefs.groupBy, prefs.sortBy, prefs.view, statusF, methodF, query, trashMode])

  const list = useMemo(() => filterJobs(source, statusF, methodF, query), [source, statusF, methodF, query])
  // 数据每 3s 轮询（无变化时引用不变），"今天/昨天"取计算时刻即可
  const groups = useMemo(() => groupJobs(list, prefs.groupBy, prefs.sortBy, Date.now()), [list, prefs.groupBy, prefs.sortBy])
  const grouped = prefs.groupBy !== "none"
  const isCollapsed = (g: JobGroup) => grouped && !!prefs.collapsed[collapseKey(prefs.groupBy, g.key)]

  // 可见顺序（未折叠分组的完整列表，不受分批渲染影响）：范围选择与抽屉上下切换共用
  const flat = useMemo(
    () => groups.filter((g) => !(grouped && prefs.collapsed[collapseKey(prefs.groupBy, g.key)])).flatMap((g) => g.jobs),
    [groups, grouped, prefs.collapsed, prefs.groupBy],
  )
  const pageSize = PAGE[prefs.view]
  const limitOf = (g: JobGroup) => limits[g.key] ?? pageSize
  const showMore = (key: string) => setLimits((l) => ({ ...l, [key]: (l[key] ?? pageSize) + pageSize }))

  const setMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev)
      for (const id of ids) on ? n.add(id) : n.delete(id)
      return n
    })
  const toggleOne = (id: string) => setMany([id], !selected.has(id))
  const rangeSelect = (fromId: string, toId: string) => {
    const a = flat.findIndex((j) => j.id === fromId)
    const b = flat.findIndex((j) => j.id === toId)
    if (a < 0 || b < 0) return toggleOne(toId)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    setMany(flat.slice(lo, hi + 1).map((j) => j.id), true)
  }

  const handleCheck = (id: string, shift: boolean) => {
    if (shift && anchorRef.current && anchorRef.current !== id) rangeSelect(anchorRef.current, id)
    else toggleOne(id)
    anchorRef.current = id
  }

  // 点击：Shift 连选；Ctrl/⌘ 或已在选择中 → 切换选择；否则打开详情抽屉
  const handleItemClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && anchorRef.current) {
      rangeSelect(anchorRef.current, id)
    } else if (e.metaKey || e.ctrlKey || selected.size > 0) {
      toggleOne(id)
    } else {
      setDetailId(id)
    }
    anchorRef.current = id
  }

  // 确保任务已在分批渲染范围内，并滚动到可见
  const reveal = (id: string) => {
    const g = groups.find((x) => x.jobs.some((j) => j.id === id))
    if (!g) return
    const idx = g.jobs.findIndex((j) => j.id === id)
    setLimits((l) => ((l[g.key] ?? pageSize) <= idx ? { ...l, [g.key]: idx + pageSize } : l))
    window.setTimeout(() => document.getElementById(`job-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50)
  }

  const detailIndex = detailId ? flat.findIndex((j) => j.id === detailId) : -1
  const step = (d: number) => {
    const n = detailIndex >= 0 ? flat[detailIndex + d] : undefined
    if (!n) return
    setDetailId(n.id)
    anchorRef.current = n.id
    reveal(n.id)
  }

  const quickSelect = (key: string) => {
    const only = (f: (j: JobListItem) => boolean) => setSelected(new Set(list.filter(f).map((j) => j.id)))
    if (key === "visible") only(() => true)
    else if (key === "failed") only((j) => j.status === "failed")
    else if (key === "done") only((j) => j.status === "done")
    else if (key === "live") only(isLive)
    else if (key === "cancelled") only((j) => j.status === "cancelled")
    else if (key === "invert") setSelected((prev) => new Set(list.filter((j) => !prev.has(j.id)).map((j) => j.id)))
    else if (key === "none") setSelected(new Set())
  }

  // 快捷键：Esc 先关抽屉再清选择；Ctrl/⌘+A 全选可见；抽屉打开时 ↑↓ / j k 切换
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e: KeyboardEvent) => {
    if (!p.active || isTyping(e.target)) return
    if (e.key === "Escape") {
      if (detailId) setDetailId(null)
      else setSelected(new Set())
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
      e.preventDefault()
      setSelected(new Set(list.map((j) => j.id)))
      return
    }
    if (!detailId || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "j") {
      e.preventDefault()
      step(1)
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "k") {
      e.preventDefault()
      step(-1)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [])

  const isGroupCollapsedToggle = (g: JobGroup) => {
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

  const run = async (label: string, fn: (ids: string[]) => Promise<void>, ids: string[], confirmText?: string, clearSelection = true) => {
    if (ids.length === 0 || (confirmText && !window.confirm(confirmText))) return false
    setBusy(label)
    try {
      await fn(ids)
      if (clearSelection) setSelected(new Set())
      return true
    } finally {
      setBusy("")
    }
  }

  // 抽屉里删除/彻底删除后自动切到相邻任务，方便连续处理
  const removeFromDrawer = async (label: string, fn: (ids: string[]) => Promise<void>, id: string, confirmText: string) => {
    const next = flat[detailIndex + 1] || flat[detailIndex - 1]
    if (await run(label, fn, [id], confirmText, false)) setDetailId(next ? next.id : null)
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
    <div className={`space-y-3 ${detailId ? "lg:mr-[496px]" : ""}`}>
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
          <select
            value=""
            onChange={(e) => {
              quickSelect(e.target.value)
              e.target.value = ""
            }}
            className={selectCls}
            title="快速选择（Ctrl/⌘+A 全选，Shift 点击连选）"
          >
            <option value="" disabled>
              快速选择…
            </option>
            {QUICK_SELECT.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
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
          </span>
        </div>
        <div className="hidden md:block text-[11px] text-zinc-400">
          点卡片看详情（↑↓ 切换，Esc 关闭）· Ctrl/⌘ 点击多选 · Shift 点击连选 · Ctrl/⌘+A 全选
        </div>
      </div>

      {groups.map((g) => {
        const collapsed = isCollapsed(g)
        const limit = limitOf(g)
        const shown = g.jobs.slice(0, limit)
        return (
          <section key={g.key} className="bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm">
            {grouped && (
              <div
                className={`sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 bg-white/95 dark:bg-zinc-900/95 backdrop-blur rounded-t-xl ${
                  collapsed ? "rounded-b-xl" : "border-b dark:border-zinc-800"
                }`}
              >
                {groupCheck(g)}
                <button onClick={() => isGroupCollapsedToggle(g)} className="flex items-center gap-1 text-sm font-medium min-w-0" title={g.batchId ? `批次 ${g.batchId}` : g.label}>
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
                <div className={`grid gap-3 p-3 ${detailId ? GRID[prefs.size].narrow : GRID[prefs.size].full}`}>
                  {shown.map((j) => (
                    <BoardCard
                      key={j.id}
                      j={j}
                      now={now}
                      size={prefs.size}
                      checked={selected.has(j.id)}
                      selecting={selecting}
                      current={p.curId === j.id}
                      opened={detailId === j.id}
                      onClick={(e) => handleItemClick(e, j.id)}
                      onCheck={(shift) => handleCheck(j.id, shift)}
                    />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  {/* table-fixed + 固定列宽：各分组表格列对齐 */}
                  <table className="w-full text-xs table-fixed">
                    <colgroup>
                      <col className="w-10" />
                      <col />
                      <col className="w-24" />
                      <col className="w-28 hidden sm:table-column" />
                      <col className="w-36" />
                      <col className="w-20 hidden sm:table-column" />
                      <col className="w-40 hidden md:table-column" />
                    </colgroup>
                    <thead className="text-zinc-500">
                      <tr className="border-b dark:border-zinc-800">
                        <th className="p-2">{!grouped && groupCheck(g)}</th>
                        {sortHeader(SORT_COLS.name)}
                        <th className="p-2 font-normal text-left">状态</th>
                        <th className="p-2 font-normal text-left hidden sm:table-cell">任务/方法</th>
                        {sortHeader(SORT_COLS.energy)}
                        <th className="p-2 font-normal text-right hidden sm:table-cell">耗时</th>
                        {sortHeader(SORT_COLS.time)}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((j) => (
                        <tr
                          key={j.id}
                          id={`job-${j.id}`}
                          onClick={(e) => handleItemClick(e, j.id)}
                          className={`select-none border-b last:border-b-0 dark:border-zinc-800 cursor-pointer ${
                            selected.has(j.id)
                              ? "bg-blue-50 dark:bg-blue-950"
                              : detailId === j.id
                                ? "bg-zinc-100 dark:bg-zinc-800"
                                : p.curId === j.id
                                  ? "bg-zinc-50 dark:bg-zinc-800/60"
                                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800"
                          }`}
                        >
                          <td className="p-2 text-center">
                            <Check checked={selected.has(j.id)} onChange={(_, shift) => handleCheck(j.id, shift)} />
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-1 min-w-0">
                              <JobName j={j} className="text-xs" />
                              {j.batch_id && !grouped && <span title={`批次 ${j.batch_id}`}>📦</span>}
                            </div>
                          </td>
                          <td className="p-2">
                            <Badge color={statusColor(j.status)}>{j.status}</Badge>
                          </td>
                          <td className="p-2 text-zinc-500 hidden sm:table-cell truncate">
                            {j.task}/{j.method || "gfn2"}
                          </td>
                          <td className="p-2 text-right font-mono truncate">
                            {isLive(j) ? <span className="text-yellow-600">{elapsedText(j.created_at, now)}</span> : j.result_energy?.toFixed(6) ?? "—"}
                          </td>
                          <td className="p-2 text-right hidden sm:table-cell">{j.wall_time != null ? `${j.wall_time.toFixed(1)}s` : "—"}</td>
                          <td className="p-2 text-zinc-400 hidden md:table-cell truncate">{j.created_at}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            {!collapsed && g.jobs.length > limit && <LoadMore remaining={g.jobs.length - limit} onMore={() => showMore(g.key)} />}
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
            <button onClick={() => quickSelect("visible")} className="text-zinc-500 hover:text-black dark:hover:text-white">
              全选可见
            </button>
            <button onClick={() => quickSelect("invert")} className="text-zinc-500 hover:text-black dark:hover:text-white">
              反选
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

      {detailId && (
        <JobDetailDrawer
          jobId={detailId}
          item={source.find((j) => j.id === detailId)}
          index={detailIndex}
          total={flat.length}
          trashMode={trashMode}
          busy={busy}
          onClose={() => setDetailId(null)}
          onPrev={() => step(-1)}
          onNext={() => step(1)}
          onOpen3D={p.onSelect}
          onOpenBatch={p.onOpenBatch}
          onRerun={(id) => run("重跑", p.onRerunMany, [id], "按原参数重跑这个任务？（作为新批次提交，原任务保留）", false)}
          onCancel={(id) => run("取消", p.onCancelMany, [id], "取消这个任务？", false)}
          onDelete={(id) => removeFromDrawer("删除", p.onDeleteMany, id, "把这个任务移入回收站？（可恢复）")}
          onRestore={(id) => removeFromDrawer("恢复", p.onRestoreMany, id, "恢复这个任务？")}
          onHardDelete={(id) => removeFromDrawer("彻底删除", p.onHardDeleteMany, id, "彻底删除这个任务？此操作不可恢复。")}
        />
      )}
    </div>
  )
}
