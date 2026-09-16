"use client"

import { useEffect, useRef } from "react"
import { NotFoundError, getJob, jobEventsUrl } from "@/lib/api";
import type { Job } from "@/shared/schemas/job"

/** SSE 推送的任务补丁（与后端 /api/jobs/{id}/events 字段一致，不含 result_xyz） */
export interface JobPatch {
  id: string
  status: Job["status"]
  result_energy?: number | null
  wall_time?: number | null
  result_log?: string | null
  progress_energy?: number | null
  progress_xyz?: string | null
}

interface StreamOpts {
  onData: (p: JobPatch) => void
  onTerminal?: (id: string) => void
}
const TERMINAL = ["done", "failed", "cancelled"]

/**
 * 订阅运行中任务的实时推送：
 * - 优先 EventSource(SSE)，经 /api rewrite 代理，无 mixed content 问题
 * - SSE 出错自动降级为 3s 轮询 getJob；任务结束（done/failed）自动关流/停轮询
 */
export function useJobStream(jobId: string | null, opts: StreamOpts) {
  const cbRef = useRef(opts)
  cbRef.current = opts

  useEffect(() => {
    if (!jobId) return
    let es: EventSource | null = null
    let timer: number | undefined
    let stopped = false

    const finish = (finalStatus: string) => {
      if (stopped) return
      stopped = true
      es?.close()
      if (timer !== undefined) window.clearInterval(timer)
      if (TERMINAL.includes(finalStatus)) cbRef.current.onTerminal?.(jobId)
    }

    const poll = () => {
      timer = window.setInterval(async () => {
        try {
          const j = await getJob(jobId)
          cbRef.current.onData({
            id: j.id,
            status: j.status,
            result_energy: j.result_energy,
            wall_time: j.wall_time,
            result_log: j.result_log,
            progress_energy: j.progress_energy,
            progress_xyz: j.progress_xyz,
          })
        } catch (e) {
          // 任务已被删除：停止轮询；其他错误下一轮重试
          if (e instanceof NotFoundError) finish("gone")
        }
      }, 3000)
    }

    try {
      es = new EventSource(jobEventsUrl(jobId))
      es.onmessage = (ev) => {
        try {
          const p = JSON.parse(ev.data) as JobPatch
          if (!p || p.id !== jobId) return
          cbRef.current.onData(p)
          if (TERMINAL.includes(p.status)) finish(p.status)
        } catch {
          /* 坏帧跳过 */
        }
      }
      es.onerror = () => {
        es?.close()
        es = null
        if (!stopped) poll()
      }
    } catch {
      poll()
    }

    return () => {
      stopped = true
      es?.close()
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [jobId])
}
