"use client"

import { useState } from "react"

import type { Job } from "@/shared/schemas/job"
import { isTrajectoryTask } from "@/lib/xyz"
import Button from "@/app/components/ui/Button"

export interface Viewer3DProps {
  cur: Job | null
  frames: number
  frame: number
  viewerErr: string
  debug: string
  viewerElRef: React.RefObject<HTMLDivElement>
  onPlay: (speed: number) => void
  onPause: () => void
  onReset: () => void
  onFrameChange: (n: number) => void
}

export default function Viewer3D({
  cur,
  frames,
  frame,
  viewerErr,
  debug,
  viewerElRef,
  onPlay,
  onPause,
  onReset,
  onFrameChange,
}: Viewer3DProps) {
  const [speed, setSpeed] = useState(250)

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-sm">
          3D 结构 {cur && <span className="font-normal text-zinc-500">· {frames} 帧 · {cur.id.slice(0, 8)}</span>}
        </span>
        <span className="text-xs text-zinc-500">{cur ? (isTrajectoryTask(cur.task) ? "优化轨迹" : "单帧") : "预览"}</span>
      </div>
      <div ref={viewerElRef} className="mol-viewer rounded-lg border dark:border-zinc-800 bg-white" />
      <div className="text-[11px] font-mono bg-zinc-50 dark:bg-zinc-900 p-2 rounded mt-2 overflow-auto">
        {debug || "等待渲染..."} {viewerErr && <span className="text-red-600">· {viewerErr}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Button onClick={() => onPlay(speed)}>▶ 播放</Button>
        <Button variant="outline" onClick={onPause}>
          ⏸ 暂停
        </Button>
        <Button variant="ghost" onClick={onReset}>
          重置
        </Button>
        <label className="text-xs flex items-center gap-1">
          速度
          <input
            type="range"
            min={50}
            max={800}
            value={speed}
            onChange={(e) => setSpeed(parseInt(e.target.value) || 250)}
            className="w-24"
          />
        </label>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames - 1)}
          value={frame}
          onChange={(e) => onFrameChange(parseInt(e.target.value))}
          className="flex-1 min-w-[120px]"
        />
        <span className="text-xs text-zinc-600 dark:text-zinc-400">
          {frame + 1}/{frames || 1}
        </span>
      </div>
      <div className="text-[11px] text-zinc-500 mt-1">
        当前 {cur ? cur.id.slice(0, 8) : "—"} · {cur ? (cur.result_xyz || cur.input_xyz || "").split("\n")[0] + " 原子" : "空画布，粘贴 XYZ 或上传 SDF"} · 点击侧边栏切换任务
      </div>
    </div>
  )
}
