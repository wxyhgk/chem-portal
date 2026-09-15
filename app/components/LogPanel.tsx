"use client"

import type { Job } from "@/shared/schemas/job"
import { energyUnit } from "@/lib/jobMeta"

export interface LogPanelProps {
  cur: Job | null
}

export default function LogPanel({ cur }: LogPanelProps) {
  return (
    <div className="p-4">
      <div className="font-semibold text-sm mb-2">
        日志 / 能量 {cur && <span className="font-normal text-zinc-500">· {cur.id.slice(0, 8)}</span>}
      </div>
      {cur ? (
        <>
          <div className="text-xs bg-zinc-50 dark:bg-zinc-800 p-2 rounded mb-2 font-mono">
            E = {cur.result_energy ?? cur.progress_energy ?? "…"} {energyUnit(cur.method)}{cur.result_energy == null && cur.progress_energy != null && " (live)"} · wall {cur.wall_time?.toFixed(2) ?? "…"}s · {cur.status} · {cur.method || "gfn2"}{cur.method === "psi4" && ` ${cur.psi_method || "b3lyp"}/${cur.psi_basis || "def2-SVP"} ×${cur.multiplicity || 1}`}
          </div>
          <pre className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs overflow-auto max-h-[420px]">
            {cur.result_log?.slice(-8000) || "无日志"}
          </pre>
        </>
      ) : (
        <div className="text-xs text-zinc-500">选择任务后显示</div>
      )}
    </div>
  )
}
