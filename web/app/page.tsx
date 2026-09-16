"use client"

import { useEffect, useState } from "react"
import type { Job } from "@/shared/schemas/job"
import { NotFoundError, createJob, getJob } from "@/lib/api"
import { useJobStream } from "@/lib/hooks/useJobStream"
import { DEFAULT_PARAMS, paramsFromJob, toApiParams, type JobParams } from "@/lib/jobParams"
import { isLive } from "@/lib/jobMeta"
import { JobsProvider, useJobs } from "@/lib/jobs/JobsContext"
import { isTrajectoryTask } from "@/lib/xyz"
import BatchPanel from "@/app/components/BatchPanel"
import HeaderTabs, { TAB_KEYS, type TabKey } from "@/app/components/HeaderTabs"
import JobBoard from "@/app/components/JobBoard"
import JobList from "@/app/components/JobList"
import LogPanel from "@/app/components/LogPanel"
import SubmitForm from "@/app/components/SubmitForm"
import Viewer3D from "@/app/components/Viewer3D"
import XyzPanel from "@/app/components/XyzPanel"

export default function Page() {
  return (
    <JobsProvider>
      <Portal />
    </JobsProvider>
  )
}

const isMobile = () => window.innerWidth < 768

/** 当前查看任务要显示的结构：结果轨迹 > 运行中轨迹（opt）> 输入 */
const jobXyz = (j: Job) => j.result_xyz || (isTrajectoryTask(j.task) ? j.progress_xyz : null) || j.input_xyz || ""

function Portal() {
  const jobs = useJobs()
  const { setMsg, refresh, onRemoved } = jobs
  const [xyz, setXyz] = useState("")
  const [params, setParams] = useState<JobParams>(DEFAULT_PARAMS)
  const [cur, setCur] = useState<Job | null>(null)
  const [dark, setDark] = useState(false)
  const [sideOpen, setSideOpen] = useState(true)
  const [tab, setTab] = useState<TabKey>("view3d")
  const [batchFocus, setBatchFocus] = useState<{ id: string; n: number } | null>(null)

  const patchParams = (p: Partial<JobParams>) => setParams((prev) => ({ ...prev, ...p }))

  // 运行中任务走 SSE 实时补丁；结束时拉一次全量（补 result_xyz）
  useJobStream(cur && isLive(cur) ? cur.id : null, {
    onData: (p) =>
      setCur((prev) =>
        prev && prev.id === p.id
          ? {
              ...prev,
              status: p.status,
              result_energy: p.result_energy ?? prev.result_energy,
              wall_time: p.wall_time ?? prev.wall_time,
              result_log: p.result_log ?? prev.result_log,
              progress_energy: p.progress_energy ?? prev.progress_energy,
              progress_xyz: p.progress_xyz ?? prev.progress_xyz,
            }
          : prev,
      ),
    onTerminal: async (id) => {
      try {
        const j = await getJob(id)
        setCur((prev) => (prev && prev.id === id ? j : prev))
        refresh()
      } catch {
        /* 下次轮询兜底 */
      }
    },
  })

  // 正在查看的任务被删除时清空
  useEffect(() => onRemoved((ids) => setCur((prev) => (prev && ids.includes(prev.id) ? null : prev))), [onRemoved])

  useEffect(() => {
    if (isMobile()) setSideOpen(false)
    // ?tab=jobs 直接打开指定标签页（便于分享链接）
    const t = new URLSearchParams(window.location.search).get("tab") as TabKey | null
    if (t && TAB_KEYS.includes(t)) setTab(t)
    if (localStorage.getItem("theme") === "dark") {
      document.documentElement.classList.add("dark")
      setDark(true)
    }
  }, [])

  const toggleDark = () => {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    localStorage.setItem("theme", next ? "dark" : "light")
  }

  const show = async (id: string) => {
    try {
      setCur(await getJob(id))
      setTab("view3d")
    } catch (e) {
      if (e instanceof NotFoundError) {
        setMsg(e.message)
        refresh()
      } else console.error(e)
    }
    if (isMobile()) setSideOpen(false)
  }

  const newJob = () => {
    setCur(null)
    setXyz("")
    setTab("view3d")
  }

  // 克隆重跑：当前任务的结构与参数回填表单
  const cloneCur = () => {
    if (!cur) return
    setXyz(cur.input_xyz || "")
    setParams(paramsFromJob(cur))
    setCur(null)
    setTab("view3d")
    setMsg(`已载入 ${cur.id.slice(0, 8)} 参数，修改后提交`)
  }

  const submit = async () => {
    try {
      const j = await createJob({ xyz, ...toApiParams(params) })
      setMsg(`已提交 ${j.id.slice(0, 8)}`)
      refresh()
      show(j.id)
    } catch (e) {
      setMsg(`提交失败: ${String((e as Error)?.message || e)}`)
    }
  }

  // XYZ 面板选帧：作为新输入，改单点后选方法提交
  const useFrame = (frameXyz: string, label: string) => {
    setXyz(frameXyz)
    patchParams({ task: "sp" })
    setCur(null)
    setTab("view3d")
    setMsg(`已取${label}，选方法后提交QM`)
  }

  const openBatch = (id: string) => {
    setBatchFocus({ id, n: Date.now() })
    setTab("batch")
    if (isMobile()) setSideOpen(false)
  }

  const openJobsTab = () => {
    setTab("jobs")
    if (isMobile()) setSideOpen(false)
  }

  const formTab = tab !== "batch" && tab !== "jobs"

  return (
    <div className={`flex h-screen overflow-hidden bg-white dark:bg-black ${dark ? "dark" : ""}`}>
      {/* 侧边栏 */}
      <aside
        className={`${sideOpen ? "w-[300px]" : "w-0"} shrink-0 border-r dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 flex flex-col transition-all duration-200 overflow-hidden`}
      >
        <div className="p-3 flex items-center justify-between border-b dark:border-zinc-800">
          <span className="font-bold text-sm">Chem Portal</span>
          <button onClick={() => setSideOpen(false)} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded">
            ✕
          </button>
        </div>
        <JobList curId={cur?.id ?? null} onSelect={show} onNew={newJob} onOpenBatch={openBatch} onExpand={openJobsTab} />
      </aside>

      {/* 主区 */}
      <div className="flex-1 flex flex-col min-w-0">
        <HeaderTabs
          tab={tab}
          onTab={setTab}
          sideOpen={sideOpen}
          onToggleSide={setSideOpen}
          cur={cur}
          dark={dark}
          onToggleDark={toggleDark}
          onClone={cloneCur}
          onCancel={() => cur && jobs.cancelMany([cur.id])}
          onDelete={() => cur && jobs.deleteMany([cur.id])}
        />

        <div className="flex-1 overflow-auto bg-zinc-50 dark:bg-black p-3 md:p-6">
          <div className={`${tab === "jobs" ? "max-w-7xl" : "max-w-5xl"} mx-auto space-y-4`}>
            {/* 任务 / 批量 tab：隐藏而非卸载，保留筛选、选择与已拖入的文件 */}
            <div className={tab === "jobs" ? "" : "hidden"}>
              <JobBoard active={tab === "jobs"} curId={cur?.id ?? null} onSelect={show} onOpenBatch={openBatch} />
            </div>
            <div className={tab === "batch" ? "" : "hidden"}>
              <BatchPanel active={tab === "batch"} onSelect={show} focusBatch={batchFocus} />
            </div>

            {formTab && <SubmitForm xyz={xyz} params={params} onXyzChange={setXyz} onParamsChange={patchParams} onSubmit={submit} />}

            {/* 3D / XYZ / 日志：3D 查看器隐藏而非卸载，切回时不重新加载 */}
            <div className={`bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm overflow-hidden ${formTab ? "" : "hidden"}`}>
              <div className={tab === "view3d" ? "" : "hidden"}>
                <Viewer3D cur={cur} xyz={cur ? jobXyz(cur) : xyz} />
              </div>
              {tab === "xyz" && <XyzPanel cur={cur} fallbackXyz={xyz} onUseFrame={useFrame} />}
              {tab === "log" && <LogPanel cur={cur} />}
            </div>
          </div>
        </div>
      </div>

      {/* 手机遮罩 */}
      {sideOpen && <div onClick={() => setSideOpen(false)} className="md:hidden fixed inset-0 bg-black/30 z-10" />}
    </div>
  )
}
