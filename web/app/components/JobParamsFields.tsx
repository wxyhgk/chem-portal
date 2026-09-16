"use client"

import type { JobMethod, JobTask, PsiMethod } from "@/shared/schemas/job"
import type { JobParams } from "@/lib/jobParams"
import { METHODS, PSI_METHODS, TASKS } from "@/lib/jobMeta"

const inputCls = "w-full mt-1 border rounded-lg p-2 text-sm dark:bg-zinc-950 dark:border-zinc-800"

export interface ParamFieldsProps {
  params: JobParams
  onChange: (patch: Partial<JobParams>) => void
}

/** 任务 / 方法 / charge / threads —— 以 Fragment 输出，由父级 grid 排版 */
export function BaseParamFields({ params, onChange, hideCharge }: ParamFieldsProps & { hideCharge?: boolean }) {
  return (
    <>
      <label className="text-xs">
        任务
        <select value={params.task} onChange={(e) => onChange({ task: e.target.value as JobTask })} className={inputCls}>
          {TASKS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        方法
        <select value={params.method} onChange={(e) => onChange({ method: e.target.value as JobMethod })} className={inputCls}>
          {METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {!hideCharge && (
        <label className="text-xs">
          charge
          <input type="number" value={params.charge} onChange={(e) => onChange({ charge: parseInt(e.target.value) || 0 })} className={inputCls} />
        </label>
      )}
      <label className="text-xs">
        threads
        <input type="number" min={1} max={32} value={params.threads} onChange={(e) => onChange({ threads: parseInt(e.target.value) || 1 })} className={inputCls} />
      </label>
    </>
  )
}

/** psi4 专用参数（仅 method=psi4 时由父级渲染） */
export function PsiParamFields({ params, onChange }: ParamFieldsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3 border-t dark:border-zinc-800 pt-3">
      <label className="text-xs">
        psi4 方法
        <select value={params.psiMethod} onChange={(e) => onChange({ psiMethod: e.target.value as PsiMethod })} className={inputCls}>
          {PSI_METHODS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        基组
        <input type="text" value={params.psiBasis} placeholder="def2-SVP" onChange={(e) => onChange({ psiBasis: e.target.value })} className={`${inputCls} font-mono`} />
      </label>
      <label className="text-xs">
        自旋多重度
        <input
          type="number"
          min={1}
          max={8}
          value={params.multiplicity}
          onChange={(e) => onChange({ multiplicity: Math.min(8, Math.max(1, parseInt(e.target.value) || 1)) })}
          className={inputCls}
        />
      </label>
    </div>
  )
}
