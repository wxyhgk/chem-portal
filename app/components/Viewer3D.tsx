"use client"

import { useState } from "react"
import type { Job } from "@/shared/schemas/job"
import { isTrajectoryTask } from "@/lib/xyz"
import MolViewer from "@/app/components/mol/MolViewer"

export interface Viewer3DProps {
  cur: Job | null
  /** 要显示的结构：当前任务的结果/进度轨迹，或未选任务时表单里的输入 */
  xyz: string
}

export default function Viewer3D({ cur, xyz }: Viewer3DProps) {
  const [frames, setFrames] = useState(1)
  const natoms = parseInt(xyz.split("\n")[0]) || null

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm">
          3D 结构 {cur && <span className="font-normal text-zinc-500">· {frames} 帧 · {cur.id.slice(0, 8)}</span>}
        </span>
        <span className="text-xs text-zinc-500">{cur ? (isTrajectoryTask(cur.task) ? "优化轨迹" : "单帧") : "预览"}</span>
      </div>
      <MolViewer xyz={xyz} controls="full" sizeClass="h-[400px]" emptyText="空画布：粘贴 XYZ、上传 SDF，或在侧边栏选择任务" onFramesChange={setFrames} />
      <div className="text-[11px] text-zinc-500 mt-1">
        当前 {cur ? cur.name || cur.id.slice(0, 8) : "—"} · {natoms ? `${natoms} 原子` : "无结构"}
      </div>
    </div>
  )
}
