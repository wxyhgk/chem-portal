"use client"

import type { Job } from "@/shared/schemas/job"
import Button from "@/app/components/ui/Button"

export type TabKey = "view3d" | "xyz" | "log" | "jobs" | "batch"

export interface HeaderTabsProps {
  tab: TabKey
  onTab: (k: TabKey) => void
  sideOpen: boolean
  onToggleSide: (v: boolean) => void
  cur: Job | null
  dark: boolean
  onToggleDark: () => void
  onClone: () => void
  onCancel: () => void
  onDelete: () => void
}

const TABS: { key: TabKey; label: string }[] = [
  { key: "view3d", label: "🧬 3D" },
  { key: "xyz", label: "XYZ" },
  { key: "log", label: "日志" },
  { key: "jobs", label: "📋 任务" },
  { key: "batch", label: "📦 批量" },
]

export const TAB_KEYS: TabKey[] = TABS.map((t) => t.key)

export default function HeaderTabs({ tab, onTab, sideOpen, onToggleSide, cur, dark, onToggleDark, onClone, onCancel, onDelete }: HeaderTabsProps) {
  return (
    <header className="h-12 flex items-center gap-2 px-3 border-b dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
      {!sideOpen && (
        <Button variant="ghost" onClick={() => onToggleSide(true)}>
          ☰
        </Button>
      )}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1 min-w-0 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap ${tab === t.key ? "bg-white dark:bg-zinc-800 shadow" : "text-zinc-500"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden md:block text-xs text-zinc-500">
          {cur ? `${cur.id.slice(0, 8)} · ${cur.task} · ${cur.status}` : "未选择任务"}
        </span>
        {cur && (cur.status === "queued" || cur.status === "running") && (
          <Button variant="outline" onClick={onCancel} className="text-xs">
            ⏹ 取消
          </Button>
        )}
        {cur && (
          <>
            <Button variant="outline" onClick={onClone} className="text-xs">
              ⧉ 重跑
            </Button>
            <Button variant="ghost" onClick={onDelete} className="text-xs">
              删除
            </Button>
          </>
        )}
      </div>
    </header>
  )
}
