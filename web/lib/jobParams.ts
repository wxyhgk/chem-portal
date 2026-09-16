// 计算参数：单个提交表单与批量面板各持有一份，互不影响
import type { Job, JobCreate, JobMethod, JobTask, PsiMethod } from "@/shared/schemas/job"

export interface JobParams {
  task: JobTask
  method: JobMethod
  charge: number
  threads: number
  psiMethod: PsiMethod
  psiBasis: string
  multiplicity: number
}

export const DEFAULT_PARAMS: JobParams = { task: "opt", method: "gfn2", charge: 0, threads: 8, psiMethod: "b3lyp", psiBasis: "def2-SVP", multiplicity: 1 }

/** 批量默认 4 线程：xtb 超过 ~4 线程加速很差，多任务少线程吞吐更高（后端并发 6 × 4 = 24 核） */
export const DEFAULT_BATCH_PARAMS: JobParams = { ...DEFAULT_PARAMS, threads: 4 }

/** 转成接口请求字段（不含逐分子的 xyz / name） */
export function toApiParams(p: JobParams): Omit<JobCreate, "xyz" | "name"> {
  return {
    task: p.task,
    method: p.method,
    charge: p.charge,
    threads: Math.min(32, Math.max(1, p.threads || 1)),
    ...(p.method === "psi4" ? { psi_method: p.psiMethod, psi_basis: p.psiBasis.trim() || "def2-SVP", multiplicity: p.multiplicity } : {}),
  }
}

/** 从已有任务回填参数（克隆 / 重跑）；旧数据的 md 任务按 opt 处理 */
export function paramsFromJob(j: Job): JobParams {
  return {
    task: (j.task as string) === "md" ? "opt" : j.task,
    method: j.method,
    charge: j.charge ?? 0,
    threads: j.threads || DEFAULT_PARAMS.threads,
    psiMethod: j.psi_method || DEFAULT_PARAMS.psiMethod,
    psiBasis: j.psi_basis || DEFAULT_PARAMS.psiBasis,
    multiplicity: j.multiplicity || 1,
  }
}
