// 任务领域词汇（唯一来源）：状态、方法、任务类型、能量单位
import type { JobListItem, JobMethod, JobStatus, JobTask, PsiMethod } from "@/shared/schemas/job"

export type StatusTone = "green" | "yellow" | "red" | "gray"

export const TERMINAL_STATUSES: JobStatus[] = ["done", "failed", "cancelled"]
export const isTerminal = (s: string) => (TERMINAL_STATUSES as string[]).includes(s)
export const isLiveStatus = (s: string) => s === "running" || s === "queued"
export const isLive = (j: Pick<JobListItem, "status">) => isLiveStatus(j.status)

const STATUS_TONE: Record<JobStatus, StatusTone> = { done: "green", running: "yellow", queued: "yellow", failed: "red", cancelled: "gray" }
export const statusTone = (s: string): StatusTone => STATUS_TONE[s as JobStatus] ?? "gray"

// 完整类名写死，Tailwind 才能扫描到
export const TONE_TEXT: Record<StatusTone, string> = {
  green: "text-green-600",
  yellow: "text-yellow-600",
  red: "text-red-600",
  gray: "text-zinc-500",
}
export const TONE_BADGE: Record<StatusTone, string> = {
  green: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-zinc-800 dark:text-zinc-300",
}
export const TONE_BAR: Record<StatusTone, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
  gray: "bg-zinc-400",
}

/** 筛选与按状态分组时 queued 并入 running；顺序即分组显示顺序 */
export type StatusBucket = "running" | "failed" | "done" | "cancelled"
export const statusBucket = (s: string): StatusBucket => (s === "queued" ? "running" : (s as StatusBucket))
export const STATUS_BUCKET_LABEL: Record<StatusBucket, string> = { running: "运行中 / 排队", failed: "失败", done: "已完成", cancelled: "已取消" }
export const STATUS_FILTER_LABEL: Record<StatusBucket, string> = { running: "运行中", done: "已完成", failed: "失败", cancelled: "已取消" }

export const METHODS: { key: JobMethod; short: string; label: string }[] = [
  { key: "gfn2", short: "GFN2", label: "xtb GFN2" },
  { key: "gfn1", short: "GFN1", label: "xtb GFN1" },
  { key: "gfnff", short: "GFN-FF", label: "xtb GFN-FF" },
  { key: "uff", short: "UFF", label: "UFF 全元素力场" },
  { key: "psi4", short: "psi4", label: "psi4 ab initio" },
]
export const methodLabel = (m?: string | null) => METHODS.find((x) => x.key === (m || "gfn2"))?.label ?? String(m)

export const TASKS: { key: JobTask; label: string }[] = [
  { key: "sp", label: "单点 sp" },
  { key: "opt", label: "优化 opt + 动画" },
]

export const PSI_METHODS: { key: PsiMethod; label: string }[] = [
  { key: "b3lyp", label: "B3LYP" },
  { key: "hf", label: "HF" },
  { key: "pbe", label: "PBE" },
  { key: "mp2", label: "MP2" },
]

/** 能量单位：UFF 力场为 kcal/mol，其余量化方法为 Hartree */
export const energyUnit = (method?: string | null) => (method === "uff" ? "kcal/mol" : "Eh")

export function formatEnergy(e: number | null | undefined, method?: string | null, digits = 6): string {
  return e == null ? "—" : `${e.toFixed(digits)} ${energyUnit(method)}`
}
