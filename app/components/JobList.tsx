"use client"

import { useEffect, useState } from "react"
import type { JobListItem, JobStatus } from "@/shared/schemas/job"
import Button from "@/app/components/ui/Button"
import { jobImageUrl } from "@/lib/api"

/** created_at 是 SQLite CURRENT_TIMESTAMP（UTC，无时区标记）→ 按 UTC 解析；已有时区则不动 */
function createdMs(createdAt: string): number {
  const s = (createdAt || "").trim().replace(" ", "T")
  const t = Date.parse(/([Zz]|[+-]\d{2}:?\d{2})$/.test(s) ? s : s + "Z")
  return Number.isFinite(t) ? t : NaN
}

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
  apiHint?: string
}

type StatusFilter = "all" | JobStatus

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
]

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
  apiHint,
}: JobListProps) {
  const [query, setQuery] = useState("")
  const [statusF, setStatusF] = useState<StatusFilter>("all")
  const [methodF, setMethodF] = useState("all")
  const [trashMode, setTrashMode] = useState(false)
  const [view, setView] = useState<"list" | "cards">("cards")
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const source = trashMode ? trash : jobs
  const counts = (s: StatusFilter) => (s === "all" ? source.length : source.filter((j) => j.status === s).length)
  const q = query.trim().toLowerCase()
  const list = source.filter(
    (j) =>
      (statusF === "all" || j.status === statusF || (statusF === "running" && j.status === "queued")) &&
      (methodF === "all" || (j.method || "gfn2") === methodF) &&
      (q === "" ||
        j.id.toLowerCase().includes(q) ||
        (j.task || "").toLowerCase().includes(q) ||
        (j.method || "").toLowerCase().includes(q)),
  )
  const doneCount = jobs.filter((j) => j.status === "done").length
  const runningCount = jobs.filter((j) => j.status === "running" || j.status === "queued").length

  return (
    <>
      <div className="p-3 space-y-2 border-b dark:border-zinc-800">
        <Button onClick={onNew} className="w-full">
          ＋ 新建任务
        </Button>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索 id / 任务 / 方法…"
          className="w-full border rounded-lg px-2 py-1.5 text-xs dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
        />
        <div className="flex flex-wrap gap-1">
          {STATUS_CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => setStatusF(c.key)}
              className={`px-2 py-0.5 rounded-full text-[11px] ${
                statusF === c.key
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {c.label} {counts(c.key)}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <select
            value={methodF}
            onChange={(e) => setMethodF(e.target.value)}
            className="flex-1 border rounded-lg px-1 py-1 text-[11px] dark:bg-zinc-950 dark:border-zinc-800"
          >
            {METHODS.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => setTrashMode(!trashMode)}
            className={`flex-1 border rounded-lg px-1 py-1 text-[11px] ${
              trashMode
                ? "bg-black text-white dark:bg-white dark:text-black"
                : "dark:border-zinc-800 dark:text-zinc-300"
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
        <div className="flex gap-2 text-xs text-zinc-500">
          <span>
            {doneCount} 已完成 · {runningCount} 运行中
          </span>
          <span className="ml-auto flex gap-1">
            <button
              onClick={() => setView("list")}
              title="列表视图"
              className={`px-1.5 rounded ${view === "list" ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}
            >
              ☰
            </button>
            <button
              onClick={() => setView("cards")}
              title="卡片视图（分子结构）"
              className={`px-1.5 rounded ${view === "cards" ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-zinc-200 dark:hover:bg-zinc-800"}`}
            >
              ▦
            </button>
          </span>
        </div>
      </div>
      {view === "cards" ? (
        <div className="flex-1 overflow-auto p-2 grid grid-cols-2 gap-2 content-start">
          {list.map((j) => {
            const live = j.status === "running" || j.status === "queued"
            const src = jobImageUrl(j.id) + (live ? `?t=${Math.floor(now / 10000)}` : "")
            return (
              <div
                key={j.id}
                onClick={() => onSelect(j.id)}
                className={`rounded-lg cursor-pointer border p-1.5 ${
                  curId === j.id
                    ? "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                    : "bg-transparent border-transparent hover:bg-white dark:hover:bg-zinc-800"
                }`}
              >
                <div className="rounded-md overflow-hidden bg-white border border-zinc-200 dark:border-zinc-700">
                  <img src={src} alt={j.id.slice(0, 8)} loading="lazy" className="w-full h-auto block" />
                </div>
                <div className="flex justify-between items-center mt-1">
                  <span className="font-mono text-[11px] font-semibold">{j.id.slice(0, 8)}</span>
                  <Badge color={statusColor(j.status)}>{j.status}</Badge>
                </div>
                <div className="text-[11px] text-zinc-500 truncate">
                  {j.task}/{j.method || "gfn2"} ·{" "}
                  {live
                    ? `${j.status === "queued" ? "排队" : "运行"} ${elapsedText(j.created_at, now)}`
                    : `${j.result_energy?.toFixed(3) ?? "—"}`}
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
          })}
          {list.length === 0 && <div className="col-span-2 text-xs text-zinc-400 text-center py-8">{trashMode ? "回收站是空的" : "暂无任务"}</div>}
        </div>
      ) : (
      <div className="flex-1 overflow-auto p-2 space-y-1">
        {list.map((j) => (
          <div
            key={j.id}
            onClick={() => onSelect(j.id)}
            className={`p-3 rounded-lg cursor-pointer border ${
              curId === j.id
                ? "bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-700"
                : "bg-transparent border-transparent hover:bg-white dark:hover:bg-zinc-800"
            }`}
          >
            <div className="flex justify-between items-center">
              <span className="font-mono text-xs font-semibold">{j.id.slice(0, 8)}</span>
              <span className="flex items-center gap-1">
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
              {j.status === "running" || j.status === "queued"
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
        ))}
      </div>
      )}
      {apiHint !== undefined && (
        <div className="p-3 border-t dark:border-zinc-800 text-[11px] text-zinc-500">
          法国VPS 24核 · xtb/psi4/uff · {apiHint || "/api"}
        </div>
      )}
    </>
  )
}
