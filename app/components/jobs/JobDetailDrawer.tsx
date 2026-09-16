"use client"

// 任务详情抽屉：任务页点卡片从右侧滑出，列表保持原位（↑↓ / Esc 由 JobBoard 统一处理）
import { useEffect, useRef, useState } from "react"
import type { Job, JobListItem } from "@/shared/schemas/job"
import { NotFoundError, getJob } from "@/lib/api"
import { useJobStream } from "@/lib/hooks/useJobStream"
import { isTrajectoryTask } from "@/lib/xyz"
import { createdMs } from "@/lib/jobGroups"
import { downloadText, safeFileBase } from "@/lib/download"
import { energyUnit, isTerminal } from "@/lib/jobMeta"
import MolViewer from "@/app/components/mol/MolViewer"
import GeometryPanel from "@/app/components/mol/GeometryPanel"
import { StatusBadge, elapsedText } from "@/app/components/jobs/JobBits"

const LOG_TAIL = 3000

// 终态任务详情缓存：上下切换时不重复拉取（opt 轨迹可达数百 KB）
const cache = new Map<string, Job>()
const CACHE_MAX = 30
function remember(j: Job) {
  if (!isTerminal(j.status)) return
  cache.delete(j.id)
  cache.set(j.id, j)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
}

export interface JobDetailDrawerProps {
  jobId: string
  item?: JobListItem
  index: number
  total: number
  trashMode: boolean
  busy: string
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onOpen3D: (id: string) => void
  onOpenBatch: (batchId: string) => void
  onRerun: (id: string) => void
  onCancel: (id: string) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onHardDelete: (id: string) => void
}

const btn =
  "px-2.5 py-1 rounded-lg border text-xs bg-white dark:bg-zinc-900 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"
const navBtn = "px-2 py-1 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30"

function localTime(createdAt: string): string {
  const ms = createdMs(createdAt)
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : createdAt
}

export default function JobDetailDrawer(p: JobDetailDrawerProps) {
  const [job, setJob] = useState<Job | null>(() => cache.get(p.jobId) ?? null)
  const [err, setErr] = useState("")
  const [fullLog, setFullLog] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const logRef = useRef<HTMLPreElement>(null)
  const listStatus = p.item?.status

  // 切换任务、或列表轮询发现状态变化时拉详情；终态且状态一致走缓存
  useEffect(() => {
    setFullLog(false)
    const cached = cache.get(p.jobId)
    if (cached && (!listStatus || cached.status === listStatus)) {
      setJob(cached)
      setErr("")
      return
    }
    setJob((prev) => (prev?.id === p.jobId ? prev : null))
    setErr("")
    let alive = true
    getJob(p.jobId)
      .then((j) => {
        if (!alive) return
        remember(j)
        setJob(j)
      })
      .catch((e) => alive && setErr(e instanceof NotFoundError ? "任务不存在或已被删除" : `加载失败: ${String(e?.message || e)}`))
    return () => {
      alive = false
    }
  }, [p.jobId, listStatus])

  const live = !!job && (job.status === "running" || job.status === "queued")

  // 运行中：SSE 实时补丁；结束时拉一次全量（补 result_xyz）
  useJobStream(live ? p.jobId : null, {
    onData: (d) =>
      setJob((prev) =>
        prev && prev.id === d.id
          ? {
              ...prev,
              status: d.status,
              result_energy: d.result_energy ?? prev.result_energy,
              wall_time: d.wall_time ?? prev.wall_time,
              result_log: d.result_log ?? prev.result_log,
              progress_energy: d.progress_energy ?? prev.progress_energy,
              progress_xyz: d.progress_xyz ?? prev.progress_xyz,
            }
          : prev,
      ),
    onTerminal: (id) => {
      getJob(id)
        .then((j) => {
          remember(j)
          setJob((prev) => (prev?.id === id ? j : prev))
        })
        .catch(() => {})
    },
  })

  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [live])

  // 运行中日志自动滚到底
  useEffect(() => {
    if (live && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.result_log, live])

  const st = job?.status || p.item?.status || "queued"
  const name = job?.name || p.item?.name || p.jobId.slice(0, 8)
  const method = job?.method || p.item?.method || "gfn2"
  const unit = energyUnit(method)
  const xyz = job ? job.result_xyz || (isTrajectoryTask(job.task) ? job.progress_xyz : null) || job.input_xyz || "" : ""
  const natoms = parseInt((job?.input_xyz || "").split("\n")[0]) || null
  const energy = job?.result_energy ?? p.item?.result_energy
  const log = job?.result_log || ""
  const createdAt = job?.created_at || p.item?.created_at || ""
  const batchId = job?.batch_id || p.item?.batch_id
  const base = safeFileBase(name)
  const isLiveSt = st === "running" || st === "queued"

  return (
    <>
      <div onClick={p.onClose} className="lg:hidden fixed inset-0 z-30 bg-black/30" />
      <aside
        className="fixed inset-y-0 right-0 z-40 w-full sm:w-[440px] lg:w-[480px] bg-white dark:bg-zinc-950 border-l dark:border-zinc-800 shadow-2xl flex flex-col"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex items-center gap-1 px-4 py-3 border-b dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono font-semibold text-sm truncate" title={name}>
                {name}
              </span>
              <StatusBadge status={st} />
            </div>
            <div className="text-[11px] text-zinc-400 font-mono select-all">{p.jobId}</div>
          </div>
          {p.index >= 0 && <span className="text-xs text-zinc-400 tabular-nums mr-1">{`${p.index + 1}/${p.total}`}</span>}
          <button onClick={p.onPrev} disabled={p.index <= 0} title="上一个（↑）" className={navBtn}>
            ↑
          </button>
          <button onClick={p.onNext} disabled={p.index < 0 || p.index >= p.total - 1} title="下一个（↓）" className={navBtn}>
            ↓
          </button>
          <button onClick={p.onClose} title="关闭（Esc）" className={navBtn}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {!p.trashMode ? (
              <>
                <button className={btn} onClick={() => p.onOpen3D(p.jobId)}>
                  🧬 3D 页查看
                </button>
                <button className={btn} disabled={!!p.busy} onClick={() => p.onRerun(p.jobId)}>
                  重跑
                </button>
                {isLiveSt && (
                  <button className={btn} disabled={!!p.busy} onClick={() => p.onCancel(p.jobId)}>
                    取消
                  </button>
                )}
                <button className={`${btn} text-red-600`} disabled={!!p.busy} onClick={() => p.onDelete(p.jobId)}>
                  移入回收站
                </button>
              </>
            ) : (
              <>
                <button className={btn} disabled={!!p.busy} onClick={() => p.onRestore(p.jobId)}>
                  恢复
                </button>
                <button className={`${btn} text-red-600`} disabled={!!p.busy} onClick={() => p.onHardDelete(p.jobId)}>
                  彻底删除
                </button>
              </>
            )}
            <button className={btn} disabled={!xyz} onClick={() => downloadText(`${base}.xyz`, xyz)}>
              下载 XYZ
            </button>
            <button className={btn} disabled={!log} onClick={() => downloadText(`${base}.log`, log)}>
              下载日志
            </button>
            {p.busy && <span className="text-xs text-zinc-500">{p.busy}中…</span>}
          </div>

          {err && <div className="text-xs text-red-600">{err}</div>}

          <MolViewer xyz={xyz} controls="compact" emptyText={!job && !err ? "加载中…" : "无结构"} />

          <GeometryPanel jobId={p.jobId} />

          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-zinc-500">能量</dt>
            <dd className="font-mono break-all">
              {energy != null ? (
                `${energy.toFixed(8)} ${unit}`
              ) : isLiveSt && job?.progress_energy != null ? (
                <span className="text-yellow-600">
                  {job.progress_energy.toFixed(6)} {unit}（实时）
                </span>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-zinc-500">耗时</dt>
            <dd>
              {job?.wall_time != null
                ? `${job.wall_time.toFixed(1)} s`
                : isLiveSt
                  ? `${st === "queued" ? "排队" : "运行"} ${elapsedText(createdAt, now)}（自提交起）`
                  : "—"}
            </dd>
            <dt className="text-zinc-500">计算</dt>
            <dd>
              {job?.task || p.item?.task} / {method}
              {method === "psi4" && job ? ` · ${job.psi_method || "b3lyp"}/${job.psi_basis || "def2-SVP"}` : ""}
            </dd>
            <dt className="text-zinc-500">电荷 / 多重度</dt>
            <dd>
              {job?.charge ?? p.item?.charge ?? 0} / {job?.multiplicity ?? 1}
            </dd>
            <dt className="text-zinc-500">线程</dt>
            <dd>{job?.threads ?? p.item?.threads ?? "—"}</dd>
            <dt className="text-zinc-500">原子数</dt>
            <dd>{natoms ?? "—"}</dd>
            <dt className="text-zinc-500">提交时间</dt>
            <dd>{createdAt ? localTime(createdAt) : "—"}</dd>
            {batchId && (
              <>
                <dt className="text-zinc-500">批次</dt>
                <dd>
                  <button onClick={() => p.onOpenBatch(batchId)} className="font-mono underline decoration-dotted hover:text-black dark:hover:text-white">
                    {batchId} →
                  </button>
                </dd>
              </>
            )}
          </dl>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold">日志{isLiveSt ? "（实时）" : ""}</span>
              {log.length > LOG_TAIL && (
                <button onClick={() => setFullLog(!fullLog)} className="text-xs text-zinc-500 hover:text-black dark:hover:text-white">
                  {fullLog ? "只看结尾" : `显示全部（${log.length} 字符）`}
                </button>
              )}
            </div>
            <pre ref={logRef} className="bg-zinc-900 text-zinc-100 p-3 rounded-lg text-[11px] leading-relaxed overflow-auto max-h-80 whitespace-pre">
              {log ? (fullLog ? log : log.slice(-LOG_TAIL)) : job ? "无日志" : "加载中…"}
            </pre>
          </div>
        </div>
      </aside>
    </>
  )
}
