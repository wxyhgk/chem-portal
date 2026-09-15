"use client"

// 任务数据与批量操作（全站共享）：列表轮询（ETag，标签页隐藏时暂停）、取消/删除/恢复/重跑/清理、提示消息
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import type { Job, JobListItem, JobStatus } from "@/shared/schemas/job"
import { cancelJob, clearJobs, createBatch, getJob, listJobsIfChanged, removeJob, restoreJob } from "@/lib/api"
import { paramsFromJob, toApiParams } from "@/lib/jobParams"
import { runPool } from "@/lib/pool"

const POLL_MS = 3000
const ACTION_CONCURRENCY = 8

export interface JobsApi {
  jobs: JobListItem[]
  trash: JobListItem[]
  msg: string
  setMsg: (m: string) => void
  refresh: () => Promise<void>
  cancelMany: (ids: string[]) => Promise<void>
  /** 移入回收站（运行中的会先取消） */
  deleteMany: (ids: string[]) => Promise<void>
  restoreMany: (ids: string[]) => Promise<void>
  hardDeleteMany: (ids: string[]) => Promise<void>
  /** 按原参数重跑：参数相同的合成一个新批次，原任务保留 */
  rerunMany: (ids: string[]) => Promise<void>
  clearByStatus: (statuses: JobStatus[]) => Promise<void>
  /** 订阅“任务被删除”（软删 / 彻底删除），返回取消订阅函数 */
  onRemoved: (fn: (ids: string[]) => void) => () => void
}

const JobsContext = createContext<JobsApi | null>(null)

const errText = (e: unknown) => String((e as Error)?.message || e)

export function JobsProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<JobListItem[]>([])
  const [trash, setTrash] = useState<JobListItem[]>([])
  const [msg, setMsg] = useState("")
  const etags = useRef<{ jobs: string | null; trash: string | null }>({ jobs: null, trash: null })
  const removedListeners = useRef(new Set<(ids: string[]) => void>())

  // 条件请求：列表没变时服务端回 304，不替换数组引用（下游不重新分组、不重渲染）
  const refresh = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([listJobsIfChanged(false, etags.current.jobs), listJobsIfChanged(true, etags.current.trash)])
      if (a.items) {
        setJobs(a.items)
        etags.current.jobs = a.etag
      }
      if (b.items) {
        setTrash(b.items)
        etags.current.trash = b.etag
      }
    } catch (e) {
      console.error(e)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = window.setInterval(() => !document.hidden && refresh(), POLL_MS)
    const onVisible = () => !document.hidden && refresh()
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      window.clearInterval(t)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [refresh])

  const onRemoved = useCallback((fn: (ids: string[]) => void) => {
    removedListeners.current.add(fn)
    return () => {
      removedListeners.current.delete(fn)
    }
  }, [])

  const actions = useMemo(() => {
    const each = async (ids: string[], fn: (id: string) => Promise<unknown>) => {
      let n = 0
      await runPool(ids, ACTION_CONCURRENCY, async (id) => {
        try {
          await fn(id)
          n++
        } catch (e) {
          console.error(e)
        }
      })
      return n
    }
    const notifyRemoved = (ids: string[]) => removedListeners.current.forEach((fn) => fn(ids))

    return {
      cancelMany: async (ids: string[]) => {
        const n = await each(ids, cancelJob)
        await refresh()
        setMsg(`已取消 ${n}/${ids.length} 个`)
      },
      deleteMany: async (ids: string[]) => {
        const n = await each(ids, (id) => removeJob(id))
        notifyRemoved(ids)
        await refresh()
        setMsg(`已移入回收站 ${n}/${ids.length} 个`)
      },
      restoreMany: async (ids: string[]) => {
        const n = await each(ids, restoreJob)
        await refresh()
        setMsg(`已恢复 ${n}/${ids.length} 个`)
      },
      hardDeleteMany: async (ids: string[]) => {
        const n = await each(ids, (id) => removeJob(id, true))
        notifyRemoved(ids)
        await refresh()
        setMsg(`已彻底删除 ${n}/${ids.length} 个`)
      },
      rerunMany: async (ids: string[]) => {
        const details: Job[] = []
        await each(ids, async (id) => {
          const j = await getJob(id)
          if (j?.input_xyz) details.push(j)
        })
        const order = new Map(ids.map((id, i) => [id, i]))
        details.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
        // 电荷逐分子携带，其余参数相同的合成一个批次
        const byParams = new Map<string, Job[]>()
        for (const j of details) {
          const { charge: _charge, ...shared } = toApiParams(paramsFromJob(j))
          const k = JSON.stringify(shared)
          byParams.set(k, [...(byParams.get(k) || []), j])
        }
        let n = 0
        let batches = 0
        let err = ""
        for (const group of byParams.values()) {
          const { charge: _charge, ...shared } = toApiParams(paramsFromJob(group[0]))
          try {
            const r = await createBatch({ ...shared, items: group.map((j) => ({ xyz: j.input_xyz, name: j.name || j.id.slice(0, 8), charge: j.charge })) })
            n += r.count
            batches++
          } catch (e) {
            err = errText(e)
          }
        }
        await refresh()
        setMsg(`已重跑 ${n}/${ids.length} 个（${batches} 个新批次）${err ? ` · 部分失败: ${err}` : ""}`)
      },
      clearByStatus: async (statuses: JobStatus[]) => {
        try {
          const r = await clearJobs(statuses)
          await refresh()
          setMsg(`已清理 ${r.cleared} 个任务`)
        } catch (e) {
          setMsg(`清理失败: ${errText(e)}`)
        }
      },
    }
  }, [refresh])

  const value = useMemo<JobsApi>(() => ({ jobs, trash, msg, setMsg, refresh, onRemoved, ...actions }), [jobs, trash, msg, refresh, onRemoved, actions])

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>
}

export function useJobs(): JobsApi {
  const v = useContext(JobsContext)
  if (!v) throw new Error("useJobs 需在 JobsProvider 内使用")
  return v
}
