"use client"

import { useRef, useState } from "react"
import { embedSdf } from "@/lib/api"
import type { JobParams } from "@/lib/jobParams"
import { useJobs } from "@/lib/jobs/JobsContext"
import Button from "@/app/components/ui/Button"
import { BaseParamFields, PsiParamFields } from "@/app/components/JobParamsFields"

const SDF_MAX_BYTES = 200000

export interface SubmitFormProps {
  xyz: string
  params: JobParams
  onXyzChange: (v: string) => void
  onParamsChange: (patch: Partial<JobParams>) => void
  onSubmit: () => void
}

export default function SubmitForm({ xyz, params, onXyzChange, onParamsChange, onSubmit }: SubmitFormProps) {
  const { msg } = useJobs()
  const fileRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState("")

  const uploadSdf = async (f: File | undefined) => {
    if (!f) return
    if (f.size > SDF_MAX_BYTES) {
      setNote("文件过大（>200KB）")
      return
    }
    setNote("距离几何生成 3D 坐标中…")
    try {
      const { xyz: gen, charge } = await embedSdf(await f.text())
      onXyzChange(gen)
      onParamsChange({ charge })
      setNote(`已生成 ${gen.split("\n")[0]} 原子 3D 坐标（charge 取 SDF 形式电荷 ${charge}），可预览后提交`)
    } catch (e) {
      setNote(`转换失败: ${String(e)}`)
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-xl border dark:border-zinc-800 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold">提交任务</div>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".sdf,.mol"
            className="hidden"
            onChange={(e) => {
              uploadSdf(e.target.files?.[0])
              e.target.value = ""
            }}
          />
          <Button variant="outline" onClick={() => fileRef.current?.click()} className="text-xs">
            上传 SDF
          </Button>
        </div>
      </div>
      <textarea
        value={xyz}
        placeholder="粘贴 XYZ 坐标，或点右上“上传 SDF”自动生成 3D 结构…"
        onChange={(e) => onXyzChange(e.target.value)}
        className="w-full h-28 font-mono text-xs border rounded-lg p-3 dark:bg-zinc-950 dark:border-zinc-800 dark:text-zinc-100"
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-3">
        <BaseParamFields params={params} onChange={onParamsChange} />
        <div className="flex items-end col-span-2 md:col-span-1">
          <Button onClick={onSubmit} disabled={!xyz.trim()} title={xyz.trim() ? "提交计算" : "先粘贴 XYZ 或上传 SDF"} className="w-full disabled:opacity-40">
            提交计算
          </Button>
        </div>
      </div>
      {params.method === "psi4" && <PsiParamFields params={params} onChange={onParamsChange} />}
      {note && <div className="text-xs text-blue-600 mt-2">{note}</div>}
      {msg && <div className="text-xs text-green-600 mt-2">{msg}</div>}
    </div>
  )
}
