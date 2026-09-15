"use client"

import { useRef, useState } from "react"
import type { JobMethod, JobTask, PsiMethod } from "@/shared/schemas/job"
import { embedSdf } from "@/lib/api"
import Button from "@/app/components/ui/Button"

export interface SubmitFormProps {
  xyz: string
  task: JobTask
  method: JobMethod
  charge: number
  threads: number
  psiMethod: PsiMethod
  psiBasis: string
  multiplicity: number
  msg: string
  onXyzChange: (v: string) => void
  onTaskChange: (v: JobTask) => void
  onMethodChange: (v: JobMethod) => void
  onChargeChange: (v: number) => void
  onThreadsChange: (v: number) => void
  onPsiMethodChange: (v: PsiMethod) => void
  onPsiBasisChange: (v: string) => void
  onMultiplicityChange: (v: number) => void
  onSubmit: () => void
}

const inputCls = "w-full mt-1 border rounded-lg p-2 text-sm dark:bg-zinc-950 dark:border-zinc-800"

export default function SubmitForm({
  xyz,
  task,
  method,
  charge,
  threads,
  psiMethod,
  psiBasis,
  multiplicity,
  msg,
  onXyzChange,
  onTaskChange,
  onMethodChange,
  onChargeChange,
  onThreadsChange,
  onPsiMethodChange,
  onPsiBasisChange,
  onMultiplicityChange,
  onSubmit,
}: SubmitFormProps) {
  const isPsi4 = method === "psi4"
  const fileRef = useRef<HTMLInputElement>(null)
  const [note, setNote] = useState("")

  const uploadSdf = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 200000) {
      setNote("文件过大（>200KB）")
      return
    }
    setNote("距离几何生成 3D 坐标中…")
    try {
      const { xyz: gen } = await embedSdf(await f.text())
      onXyzChange(gen)
      setNote(`已生成 ${gen.split("\n")[0]} 原子 3D 坐标，可预览后提交`)
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
        <label className="text-xs">
          任务
          <select value={task} onChange={(e) => onTaskChange(e.target.value as JobTask)} className={inputCls}>
            <option value="sp">单点 sp</option>
            <option value="opt">优化 opt + 动画</option>
          </select>
        </label>
        <label className="text-xs">
          方法
          <select value={method} onChange={(e) => onMethodChange(e.target.value as JobMethod)} className={inputCls}>
            <option value="gfn2">xtb GFN2</option>
            <option value="gfn1">xtb GFN1</option>
            <option value="gfnff">xtb GFN-FF</option>
            <option value="uff">UFF 全元素力场</option>
            <option value="psi4">psi4 ab initio</option>
          </select>
        </label>
        <label className="text-xs">
          charge
          <input
            type="number"
            value={charge}
            onChange={(e) => onChargeChange(parseInt(e.target.value) || 0)}
            className="w-full mt-1 border rounded-lg p-2 dark:bg-zinc-950 dark:border-zinc-800"
          />
        </label>
        <label className="text-xs">
          threads
          <input
            type="number"
            value={threads}
            onChange={(e) => onThreadsChange(parseInt(e.target.value) || 8)}
            className="w-full mt-1 border rounded-lg p-2 dark:bg-zinc-950 dark:border-zinc-800"
          />
        </label>
        <div className="flex items-end col-span-2 md:col-span-1">
          <Button onClick={onSubmit} disabled={!xyz.trim()} title={xyz.trim() ? "提交计算" : "先粘贴 XYZ 或上传 SDF"} className="w-full disabled:opacity-40">
            提交计算
          </Button>
        </div>
      </div>
      {isPsi4 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 border-t dark:border-zinc-800 pt-3">
          <label className="text-xs">
            psi4 方法
            <select value={psiMethod} onChange={(e) => onPsiMethodChange(e.target.value as PsiMethod)} className={inputCls}>
              <option value="b3lyp">B3LYP</option>
              <option value="hf">HF</option>
              <option value="pbe">PBE</option>
              <option value="mp2">MP2</option>
            </select>
          </label>
          <label className="text-xs">
            基组
            <input
              type="text"
              value={psiBasis}
              placeholder="def2-SVP"
              onChange={(e) => onPsiBasisChange(e.target.value)}
              className="w-full mt-1 border rounded-lg p-2 font-mono dark:bg-zinc-950 dark:border-zinc-800"
            />
          </label>
          <label className="text-xs">
            自旋多重度
            <input
              type="number"
              min={1}
              max={8}
              value={multiplicity}
              onChange={(e) => onMultiplicityChange(Math.min(8, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-full mt-1 border rounded-lg p-2 dark:bg-zinc-950 dark:border-zinc-800"
            />
          </label>
        </div>
      )}
      {note && <div className="text-xs text-blue-600 mt-2">{note}</div>}
      {msg && <div className="text-xs text-green-600 mt-2">{msg}</div>}
    </div>
  )
}
