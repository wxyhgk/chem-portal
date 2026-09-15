"use client"

import { useEffect, useRef, useState } from "react"
import type { BatchSummary, JobListItem } from "@/shared/schemas/job"
import { createBatch, embedSdf, listBatches, listJobs } from "@/lib/api"
import { downloadCsv, jobsToCsv } from "@/lib/csv"
import { DEFAULT_BATCH_PARAMS, toApiParams, type JobParams } from "@/lib/jobParams"
import { TONE_TEXT, formatEnergy, isLive, statusTone, type StatusTone } from "@/lib/jobMeta"
import { useJobs } from "@/lib/jobs/JobsContext"
import { runPool } from "@/lib/pool"
import { splitSdf } from "@/lib/sdf"
import Button from "@/app/components/ui/Button"
import { BaseParamFields, PsiParamFields } from "@/app/components/JobParamsFields"
import { ProgressBar } from "@/app/components/jobs/JobBits"

const MAX_ITEMS = 2000 // 与后端 BatchCreate.items 上限一致
const MAX_BLOCK = 200000 // 与后端 /api/embed 截断长度一致
const EMBED_CONCURRENCY = 4
const POLL_MS = 3000

type ItemStatus = "embedding" | "ready" | "error"

interface Item {
  key: string
  file: string
  name: string
  block: string
  status: ItemStatus
  xyz?: string
  charge?: number
  natoms?: number
  err?: string
}

const ITEM_STATUS: Record<ItemStatus, { label: string; tone: StatusTone }> = {
  embedding: { label: "生成3D…", tone: "yellow" },
  ready: { label: "就绪", tone: "green" },
  error: { label: "失败", tone: "red" },
}

export interface BatchPanelProps {
  active: boolean
  onSelect: (id: string) => void
  /** 外部（侧边栏/任务页批次分组）指定要查看的批次；n 变化即重新定位，同一批次可重复点 */
  focusBatch?: { id: string; n: number } | null
}

export default function BatchPanel({ active, onSelect, focusBatch }: BatchPanelProps) {
  const api = useJobs()
  const fileRef = useRef<HTMLInputElement>(null)
  const seq = useRef(0)
  const [params, setParams] = useState<JobParams>(DEFAULT_BATCH_PARAMS)
  const [items, setItems] = useState<Item[]>([])
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState("")
  const [batches, setBatches] = useState<BatchSummary[]>([])
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batchJobs, setBatchJobs] = useState<JobListItem[]>([])

  const patchParams = (p: Partial<JobParams>) => setParams((prev) => ({ ...prev, ...p }))

  useEffect(() => {
    if (focusBatch) setBatchId(focusBatch.id)
  }, [focusBatch])

  const patchItem = (key: string, u: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...u } : it)))

  const addFiles = async (files: File[]) => {
    const added: Item[] = []
    for (const f of files) {
      let mols
      try {
        mols = splitSdf(await f.text(), f.name)
      } catch (e) {
        setNote(`读取 ${f.name} 失败: ${String(e)}`)
        continue
      }
      if (mols.length === 0) setNote(`${f.name} 中没有找到分子（缺少 M  END）`)
      for (const m of mols) {
        const tooBig = m.block.length > MAX_BLOCK
        added.push({ key: `m${seq.current++}`, file: f.name, name: m.name, block: m.block, status: tooBig ? "error" : "embedding", err: tooBig ? "分子块超过 200KB" : undefined })
      }
    }
    if (added.length === 0) return
    const room = MAX_ITEMS - items.length
    if (added.length > room) setNote(`单批最多 ${MAX_ITEMS} 个分子，已忽略多出的 ${added.length - Math.max(room, 0)} 个`)
    const accepted = added.slice(0, Math.max(room, 0))
    setItems((prev) => [...prev, ...accepted])
    await runPool(
      accepted.filter((it) => it.status === "embedding"),
      EMBED_CONCURRENCY,
      async (it) => {
        try {
          const r = await embedSdf(it.block)
          patchItem(it.key, { status: "ready", xyz: r.xyz, charge: r.charge, natoms: parseInt(r.xyz.split("\n")[0]) || undefined })
        } catch (e) {
          patchItem(it.key, { status: "error", err: String((e as Error)?.message || e).replace(/^embedSdf \d+: /, "") })
        }
      },
    )
  }

  const ready = items.filter((it) => it.status === "ready")
  const embedding = items.filter((it) => it.status === "embedding").length
  const failed = items.filter((it) => it.status === "error").length

  const refreshBatches = async () => {
    try {
      const b = await listBatches()
      setBatches(b)
      setBatchId((cur) => cur ?? b[0]?.batch_id ?? null)
    } catch (e) {
      console.error(e)
    }
  }

  const submit = async () => {
    if (ready.length === 0) return
    setSubmitting(true)
    try {
      // 电荷逐分子取 SDF 形式电荷，其余参数整批共用
      const { charge: _charge, ...shared } = toApiParams(params)
      const r = await createBatch({ ...shared, items: ready.map((it) => ({ xyz: it.xyz as string, name: it.name, charge: it.charge })) })
      const sent = new Set(ready.map((it) => it.key))
      setItems((prev) => prev.filter((it) => !sent.has(it.key)))
      setNote(`已提交批次 ${r.batch_id}（${r.count} 个任务），排队按并发上限执行`)
      setBatchId(r.batch_id)
      api.refresh()
      refreshBatches()
    } catch (e) {
      setNote(`提交失败: ${String((e as Error)?.message || e)}`)
    } finally {
      setSubmitting(false)
    }
  }

  // 面板可见时轮询批次汇总与当前批次任务
  useEffect(() => {
    if (!active) return
    refreshBatches()
    const t = window.setInterval(refreshBatches, POLL_MS)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  useEffect(() => {
    if (!active || !batchId) {
      setBatchJobs([])
      return
    }
    let stop = false
    const load = async () => {
      try {
        const js = await listJobs(false, batchId)
        if (!stop) setBatchJobs(js.slice().reverse()) // 接口按新→旧，展示按提交顺序
      } catch (e) {
        console.error(e)
      }
    }
    load()
    const t = window.setInterval(load, POLL_MS)
    return () => {
      stop = true
      window.clearInterval(t)
    }
  }, [active, batchId])

  const cur = batches.find((b) => b.batch_id === batchId)
  const finished = cur ? cur.done + cur.failed + cur.cancelled : 0
  const unfinished = batchJobs.filter(isLive)

  const cancelUnfinished = async () => {
    if (unfinished.length === 0 || !window.confirm(`取消本批次 ${unfinished.length} 个未完成任务？`)) return
    await api.cancelMany(unfinished.map((j) => j.id))
    refreshBatches()
  }

  const exportCsv = () => downloadCsv(`batch-${batchId}.csv`, jobsToCsv(batchJobs))

  return (
    <div className="space-y-4">
      <div className="bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">批量提交</div>
          <div className="flex gap-2">
            {failed > 0 && (
              <Button variant="ghost" onClick={() => setItems((prev) => prev.filter((it) => it.status !== "error"))} className="text-xs">
                移除失败 {failed}
              </Button>
            )}
            {items.length > 0 && (
              <Button variant="ghost" onClick={() => setItems([])} className="text-xs">
                清空
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".sdf,.sd,.mol"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(Array.from(e.target.files || []))
                e.target.value = ""
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="text-xs">
              选择 SDF 文件
            </Button>
          </div>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(Array.from(e.dataTransfer.files).filter((f) => /\.(sdf|sd|mol)$/i.test(f.name)))
          }}
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center text-xs cursor-pointer ${
            dragging ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-zinc-300 dark:border-zinc-700 text-zinc-500"
          }`}
        >
          拖入多个 .sdf / .mol 文件（多分子 SDF 会按 $$$$ 拆开），2D 结构自动生成 3D 坐标；电荷取自 SDF 形式电荷
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          <BaseParamFields params={params} onChange={patchParams} hideCharge />
          <div className="flex items-end">
            <Button onClick={submit} disabled={ready.length === 0 || embedding > 0 || submitting} className="w-full disabled:opacity-40">
              {submitting ? "提交中…" : embedding > 0 ? `生成中 ${embedding}` : `提交 ${ready.length} 个`}
            </Button>
          </div>
        </div>
        {params.method === "psi4" && <PsiParamFields params={params} onChange={patchParams} />}

        {items.length > 0 && (
          <div className="mt-3 max-h-80 overflow-auto border rounded-lg dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="text-left p-2">#</th>
                  <th className="text-left p-2">名称</th>
                  <th className="text-left p-2 hidden md:table-cell">文件</th>
                  <th className="text-right p-2">原子</th>
                  <th className="text-right p-2">电荷</th>
                  <th className="text-left p-2">状态</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.key} className="border-t dark:border-zinc-800">
                    <td className="p-2 text-zinc-400">{i + 1}</td>
                    <td className="p-2 font-mono max-w-[12rem] truncate" title={it.name}>
                      {it.name}
                    </td>
                    <td className="p-2 text-zinc-500 hidden md:table-cell max-w-[10rem] truncate" title={it.file}>
                      {it.file}
                    </td>
                    <td className="p-2 text-right">{it.natoms ?? "—"}</td>
                    <td className="p-2 text-right">{it.charge ?? "—"}</td>
                    <td className={`p-2 ${TONE_TEXT[ITEM_STATUS[it.status].tone]}`} title={it.err}>
                      {ITEM_STATUS[it.status].label}
                      {it.err && <span className="ml-1 text-zinc-400 truncate inline-block max-w-[10rem] align-bottom">{it.err}</span>}
                    </td>
                    <td className="p-2 text-right">
                      <button onClick={() => setItems((prev) => prev.filter((x) => x.key !== it.key))} className="text-zinc-400 hover:text-red-600">
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {note && <div className="text-xs text-blue-600 mt-2">{note}</div>}
      </div>

      <div className="bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm p-4">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="text-sm font-semibold">批次进度</div>
          <select value={batchId ?? ""} onChange={(e) => setBatchId(e.target.value || null)} className="border rounded-lg px-2 py-1 text-xs dark:bg-zinc-950 dark:border-zinc-800">
            {batches.length === 0 && <option value="">暂无批次</option>}
            {batches.map((b) => (
              <option key={b.batch_id} value={b.batch_id}>
                {b.created_at} · {b.task}/{b.method} · {b.total} 个
              </option>
            ))}
          </select>
          <div className="ml-auto flex gap-2">
            {unfinished.length > 0 && (
              <Button variant="ghost" onClick={cancelUnfinished} className="text-xs">
                取消未完成 {unfinished.length}
              </Button>
            )}
            <Button variant="outline" onClick={exportCsv} disabled={batchJobs.length === 0} className="text-xs disabled:opacity-40">
              导出 CSV
            </Button>
          </div>
        </div>
        {cur && (
          <>
            <ProgressBar counts={cur} total={cur.total} className="h-2" />
            <div className="text-xs text-zinc-500 mt-1">
              {finished}/{cur.total} 结束 · {cur.done} 完成 · {cur.failed} 失败 · {cur.cancelled} 取消 · {cur.running} 运行 · {cur.queued} 排队
            </div>
          </>
        )}
        {batchJobs.length > 0 && (
          <div className="mt-3 max-h-96 overflow-auto border rounded-lg dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-950 text-zinc-500">
                <tr>
                  <th className="text-left p-2">名称</th>
                  <th className="text-left p-2 hidden md:table-cell">id</th>
                  <th className="text-left p-2">状态</th>
                  <th className="text-right p-2">能量</th>
                  <th className="text-right p-2">耗时</th>
                </tr>
              </thead>
              <tbody>
                {batchJobs.map((j) => (
                  <tr key={j.id} onClick={() => onSelect(j.id)} className="border-t dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <td className="p-2 font-mono max-w-[14rem] truncate" title={j.name || j.id}>
                      {j.name || j.id.slice(0, 8)}
                    </td>
                    <td className="p-2 font-mono text-zinc-400 hidden md:table-cell">{j.id.slice(0, 8)}</td>
                    <td className={`p-2 ${TONE_TEXT[statusTone(j.status)]}`}>{j.status}</td>
                    <td className="p-2 text-right font-mono">{formatEnergy(j.result_energy, j.method)}</td>
                    <td className="p-2 text-right">{j.wall_time != null ? `${j.wall_time.toFixed(1)}s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
