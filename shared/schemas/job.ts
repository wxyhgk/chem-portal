// ⚠️ 自动生成，请勿手改。来源：chem-portal/shared/schemas/job.py（Pydantic 模型）
// 修改字段：改 job.py → 在 chem-portal 目录运行 `python -m scripts.gen_ts`
//          → 前端仓库运行 `bash scripts/sync-shared.sh --to-web`

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type JobTask = "sp" | "opt";
export type JobMethod = "gfn2" | "gfn1" | "gfnff" | "uff" | "psi4";
export type PsiMethod = "hf" | "b3lyp" | "pbe" | "mp2";

/** 创建任务的请求体 — POST /api/jobs（前端提交 xyz，后端写入 input_xyz） */
export interface JobCreate {
  xyz: string;  // XYZ 文本，多帧轨迹亦可
  method?: JobMethod;  // 默认 gfn2
  charge?: number;  // 默认 0
  threads?: number;  // 范围 1–32；默认 8
  task?: JobTask;  // sp 单点 / opt 几何优化；默认 sp
  psi_method?: PsiMethod;  // 仅 method=psi4 时生效；默认 b3lyp
  psi_basis?: string;  // 仅 method=psi4 时生效；默认 def2-SVP
  multiplicity?: number;  // 自旋多重度；范围 1–8；默认 1
  name?: string | null;  // 任务名（SDF 标题/文件名）；长度 0–200
}

/** 批量中的单个分子 */
export interface BatchItem {
  xyz: string;  // XYZ 文本（前端经 /api/embed 由 SDF 生成）
  name?: string | null;  // 长度 0–200
  charge?: number | null;  // 缺省用批次 charge（前端带入 SDF 形式电荷）
}

/** 批量创建请求体 — POST /api/jobs/batch（共用计算参数，逐分子入队，后端限并发执行） */
export interface BatchCreate {
  items: BatchItem[];  // 长度 1–2000
  method?: JobMethod;  // 默认 gfn2
  charge?: number;  // 默认 0
  threads?: number;  // 范围 1–32；默认 8
  task?: JobTask;  // 默认 sp
  psi_method?: PsiMethod;  // 默认 b3lyp
  psi_basis?: string;  // 默认 def2-SVP
  multiplicity?: number;  // 范围 1–8；默认 1
}

/** 批次汇总 — GET /api/batches */
export interface BatchSummary {
  batch_id: string;
  created_at: string;  // 批次最早任务的提交时间（UTC）
  total: number;
  queued: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  method?: JobMethod | null;
  task?: JobTask | null;
}

/** 完整任务 — GET /api/jobs/{id}（不存在返回 404） */
export interface Job {
  id: string;
  created_at: string;  // UTC，SQLite CURRENT_TIMESTAMP 格式（无时区标记）
  status: JobStatus;
  method: JobMethod;
  charge: number;
  threads: number;
  input_xyz: string;
  task: JobTask;
  psi_method?: PsiMethod | null;  // 仅 method=psi4 时有效
  psi_basis?: string | null;  // 仅 method=psi4 时有效
  multiplicity?: number;  // 自旋多重度；默认 1
  progress_energy?: number | null;  // 运行中实时能量（结束后以 result_energy 为准）
  progress_xyz?: string | null;  // 运行中实时轨迹（opt）
  result_energy?: number | null;  // Eh；UFF 为 kcal/mol
  result_log?: string | null;  // 保留开头与结尾，≤ 12000 字符
  result_xyz?: string | null;  // opt 为多帧轨迹，sp 为单帧
  wall_time?: number | null;  // 秒
  deleted?: number;  // 1 = 回收站；默认 0
  name?: string | null;  // 任务名（SDF 标题/文件名）
  batch_id?: string | null;  // 批量提交的批次 id；单个提交为空
}

/** 列表轻量字段 — GET /api/jobs */
export interface JobListItem {
  id: string;
  status: JobStatus;
  method: JobMethod;
  charge: number;
  threads: number;
  task: JobTask;
  created_at: string;  // UTC，SQLite CURRENT_TIMESTAMP 格式
  result_energy?: number | null;  // Eh；UFF 为 kcal/mol
  wall_time?: number | null;
  name?: string | null;
  batch_id?: string | null;
}

/** 结构分析中的一个 sp3 中心 */
export interface GeometryAtom {
  index: number;  // 1 基，与 XYZ 行号一致
  element: string;
  cn: number;  // 配位数
  hybrid: string;
  angle_sum?: number | null;  // 键角和（度）；正四面体约 656.8
  spiro?: boolean;  // 两个环只共用该原子；默认 False
  ring_sizes?: number[];  // 经过该原子的各环大小
  neighbors?: string;  // 邻居元素统计，如 C4；默认 
}

/** 结构分析 — GET /api/jobs/{id}/geometry（只用坐标判断杂化与螺原子，不依赖键级） */
export interface GeometryReport {
  job_id: string;
  source: "result" | "progress" | "input";  // 分析所用结构：结果/运行中/输入
  natoms: number;
  formula: string;
  sp3?: GeometryAtom[];  // sp3 重原子（不含氢）
  spiro_count?: number;  // 默认 0
  warnings?: string[];  // 结构可疑之处；输入结构常见超配位
}
