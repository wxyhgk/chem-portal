"use client"

import type { Job } from "@/shared/schemas/job"
import { parseXyzFrames, frameToXyz, minEnergyFrame } from "@/lib/xyz"
import Button from "@/app/components/ui/Button"

export interface XyzPanelProps {
  cur: Job | null
  fallbackXyz: string
  onUseFrame?: (xyz: string, label: string) => void
}

export default function XyzPanel({ cur, fallbackXyz, onUseFrame }: XyzPanelProps) {
  const download = () => {
    if (!cur) return
    const t = cur.result_xyz || cur.input_xyz || ""
    const b = new Blob([t], { type: "text/plain" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(b)
    a.download = cur.id + ".xyz"
    a.click()
  }

  const traj = cur ? parseXyzFrames(cur.result_xyz || "") : []
  const showQm = !!onUseFrame && traj.length > 1

  const useMin = () => {
    const f = minEnergyFrame(traj)
    if (f && onUseFrame) onUseFrame(frameToXyz(f), f.energy !== null ? `能量最低帧 E=${f.energy.toFixed(4)}` : "末帧")
  }
  const useLast = () => {
    const f = traj[traj.length - 1]
    if (f && onUseFrame) onUseFrame(frameToXyz(f), "末帧")
  }

  return (
    <div className="p-4">
      <div className="flex justify-between mb-2">
        <span className="font-semibold text-sm">
          XYZ 轨迹 {cur && <span className="font-normal text-zinc-500">· {cur.id.slice(0, 8)}</span>}
          {traj.length > 1 && <span className="font-normal text-zinc-500"> · {traj.length} 帧</span>}
        </span>
        <div className="flex gap-2">
          {showQm && (
            <>
              <Button variant="outline" onClick={useMin}>
                能量最低帧跑QM
              </Button>
              <Button variant="outline" onClick={useLast}>
                末帧跑QM
              </Button>
            </>
          )}
          <Button variant="outline" onClick={download}>
            下载
          </Button>
        </div>
      </div>
      <pre className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-xs overflow-auto max-h-[420px]">
        {cur ? (cur.result_xyz || cur.input_xyz || "").slice(0, 20000) : fallbackXyz}
      </pre>
    </div>
  )
}
