// 任务结果导出 CSV（批量页 / 任务页多选共用）
import type { JobListItem } from "@/shared/schemas/job"
import { downloadText } from "@/lib/download"

function cell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function jobsToCsv(jobs: JobListItem[]): string {
  const head = ["name", "id", "status", "method", "task", "charge", "energy_Eh", "wall_time_s", "created_at", "batch_id"]
  const rows = jobs.map((j) => [j.name, j.id, j.status, j.method, j.task, j.charge, j.result_energy, j.wall_time?.toFixed(2), j.created_at, j.batch_id])
  return [head, ...rows].map((r) => r.map(cell).join(",")).join("\n")
}

export function downloadCsv(filename: string, csv: string) {
  downloadText(filename, csv, "text/csv;charset=utf-8", true)
}
