// chem-portal 共享 Job 契约 — 前后端唯一真实来源
// 前端 (chem-portal-web) 与后端 (FastAPI) 均从此导入，保持字段/枚举一致
// 路径: shared/schemas/job.ts
// 后端 Python 镜像: shared/schemas/job.py (字段一一对应)

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type JobTask = "sp" | "opt";
export type JobMethod = "gfn2" | "gfn1" | "gfnff" | "uff" | "psi4";
export type PsiMethod = "hf" | "b3lyp" | "pbe" | "mp2";

/** 完整的 Job 实体，对应 DB 行 + API 返回 */
export interface Job {
  id: string;
  created_at: string;          // ISO8601, DB: TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  status: JobStatus;             // cancelled: 用户主动取消（终态）
  method: JobMethod;
  charge: number;
  threads: number;
  input_xyz: string;            // 输入 xyz 文本 (legacy 列名 xyz 兼容)
  task: JobTask;
  psi_method?: PsiMethod | null;  // 仅 method=psi4 时有效
  psi_basis?: string | null;      // 仅 method=psi4 时有效，默认 def2-SVP
  multiplicity?: number | null;   // 自旋多重度，默认 1（旧行可能缺失）
  progress_energy?: number | null;  // 运行中实时能量（SSE 推送，结束时以 result_energy 为准）
  progress_xyz?: string | null;     // 运行中实时轨迹（opt 任务，SSE 推送）
  result_energy?: number | null;
  result_log?: string | null;
  result_xyz?: string | null;   // 优化轨迹 (opt) 或单点结果
  wall_time?: number | null;    // 秒
  deleted?: number | null;      // 软删标记 1=回收站（列表默认排除）
  name?: string | null;         // 任务名（SDF 标题/文件名）
  batch_id?: string | null;     // 批量提交的批次 id（单个提交为空）
}

/** 创建任务的请求体 — POST /api/jobs */
export interface JobCreate {
  xyz: string;                  // 前端提交字段名为 xyz，后端写入 input_xyz
  method?: JobMethod;           // 默认 gfn2
  charge?: number;              // 默认 0
  threads?: number;             // 默认 8
  task?: JobTask;               // 默认 sp
  psi_method?: PsiMethod;       // 仅 method=psi4 时生效，默认 b3lyp
  psi_basis?: string;           // 仅 method=psi4 时生效，默认 def2-SVP
  multiplicity?: number;        // 自旋多重度 1-8，默认 1
  name?: string;                // 任务名，≤200 字符
}

/** 批量中的单个分子 */
export interface BatchItem {
  xyz: string;                  // 前端经 /api/embed 由 SDF 生成
  name?: string;
  charge?: number;              // 缺省用批次 charge（前端带入 SDF 形式电荷）
}

/** 批量创建请求体 — POST /api/jobs/batch（只入队，后端限并发执行），items ≤2000 */
export interface BatchCreate extends Omit<JobCreate, "xyz" | "name"> {
  items: BatchItem[];
}

/** 批次汇总 — GET /api/batches */
export interface BatchSummary {
  batch_id: string;
  created_at: string;
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  method?: JobMethod | null;
  task?: JobTask | null;
}

/** 列表页轻量返回 — GET /api/jobs */
export type JobListItem = Pick<Job, "id" | "status" | "method" | "charge" | "threads" | "task" | "created_at" | "result_energy" | "wall_time" | "name" | "batch_id">;

/** 单个任务详情 — GET /api/jobs/{id} */
export type JobDetail = Job;

export const getApiBase = (): string => {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL
  if (typeof window !== "undefined") return ""
  return "http://CHEM_PORTAL_HOST:18081"
}

// 示例导入 (chem-portal-web 中):
// import type { Job, JobCreate, JobStatus } from "../../../chem-portal/shared/schemas/job";
// 或配置 tsconfig paths: "@shared/*": ["../chem-portal/shared/*"]
//   import type { Job } from "@shared/schemas/job";
