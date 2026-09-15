"use client"

import type { JobMethod, JobTask, PsiMethod } from "@/shared/schemas/job"

const inputCls = "w-full mt-1 border rounded-lg p-2 text-sm dark:bg-zinc-950 dark:border-zinc-800"

export interface BaseParamFieldsProps {
  task: JobTask
  method: JobMethod
  charge: number
  threads: number
  onTaskChange: (v: JobTask) => void
  onMethodChange: (v: JobMethod) => void
  onChargeChange: (v: number) => void
  onThreadsChange: (v: number) => void
  /** 批量模式下 charge 取自各分子 SDF，隐藏统一 charge */
  hideCharge?: boolean
}

/** 任务 / 方法 / charge / threads —— 以 Fragment 输出，由父级 grid 排版 */
export function BaseParamFields({ task, method, charge, threads, onTaskChange, onMethodChange, onChargeChange, onThreadsChange, hideCharge }: BaseParamFieldsProps) {
  return (
    <>
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
      {!hideCharge && (
        <label className="text-xs">
          charge
          <input
            type="number"
            value={charge}
            onChange={(e) => onChargeChange(parseInt(e.target.value) || 0)}
            className="w-full mt-1 border rounded-lg p-2 dark:bg-zinc-950 dark:border-zinc-800"
          />
        </label>
      )}
      <label className="text-xs">
        threads
        <input
          type="number"
          value={threads}
          onChange={(e) => onThreadsChange(parseInt(e.target.value) || 8)}
          className="w-full mt-1 border rounded-lg p-2 dark:bg-zinc-950 dark:border-zinc-800"
        />
      </label>
    </>
  )
}

export interface PsiParamFieldsProps {
  psiMethod: PsiMethod
  psiBasis: string
  multiplicity: number
  onPsiMethodChange: (v: PsiMethod) => void
  onPsiBasisChange: (v: string) => void
  onMultiplicityChange: (v: number) => void
}

/** psi4 专用参数（仅 method=psi4 时由父级渲染） */
export function PsiParamFields({ psiMethod, psiBasis, multiplicity, onPsiMethodChange, onPsiBasisChange, onMultiplicityChange }: PsiParamFieldsProps) {
  return (
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
  )
}
