// lib/api.ts — 前端统一 API 封装（契约来源: @shared/schemas/job.ts）
// 基地址代理优先：默认相对路径 /api/*（next.config.mjs rewrite 到后端），仅显式设置 NEXT_PUBLIC_API_URL 时直连
// 通过 tsconfig paths 别名 @shared/* 与 @/* 可被 app/page.tsx 直接 import

import type { Job, JobCreate, JobListItem, JobStatus, JobTask, JobMethod, PsiMethod } from "@shared/schemas/job";
import { getApiBase } from "@shared/schemas/job";

// 统一基地址 — 与 shared/schemas/job.ts#getApiBase 一致
export const API_BASE = getApiBase();

/** SSE 实时推送地址 — GET /api/jobs/{id}/events（相对路径时走 rewrite 代理） */
export const jobEventsUrl = (id: string): string => `${API_BASE}/api/jobs/${id}/events`;

/** 任务分子卡片图 — GET /api/jobs/{id}/image.svg（相对路径时走 rewrite 代理） */
export const jobImageUrl = (id: string): string => `${API_BASE}/api/jobs/${id}/image.svg`;
/** SDF → 3D XYZ（RDKit ETKDG 距离几何） */
export async function embedSdf(sdf: string): Promise<{ xyz: string }> {
  const r = await fetch(`${API_BASE}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sdf }),
  });
  if (!r.ok) throw new Error(`embedSdf ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function listJobs(showDeleted = false): Promise<JobListItem[]> {
  const r = await fetch(`${API_BASE}/api/jobs${showDeleted ? "?show_deleted=1" : ""}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`listJobs ${r.status}`);
  return r.json();
}

/** 取消运行中/排队任务（保留可见，状态 cancelled） */
export async function cancelJob(id: string): Promise<{ id: string; status: JobStatus }> {
  const r = await fetch(`${API_BASE}/api/jobs/${id}/cancel`, { method: "POST" });
  if (!r.ok) throw new Error(`cancelJob ${r.status}`);
  return r.json();
}

/** 删除任务（软删进回收站；运行中先取消；hard=1 物理删除） */
export async function removeJob(id: string, hard = false): Promise<void> {
  const r = await fetch(`${API_BASE}/api/jobs/${id}${hard ? "?hard=1" : ""}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`removeJob ${r.status}`);
}

/** 从回收站恢复 */
export async function restoreJob(id: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/jobs/${id}/restore`, { method: "POST" });
  if (!r.ok) throw new Error(`restoreJob ${r.status}`);
}

/** 一键清理终态任务（软删）。返回清理数。 */
export async function clearJobs(statuses: string[]): Promise<{ cleared: number }> {
  const r = await fetch(`${API_BASE}/api/jobs/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ statuses }),
  });
  if (!r.ok) throw new Error(`clearJobs ${r.status}`);
  return r.json();
}


export async function createJob(input: JobCreate): Promise<{ id: string; status: JobStatus }> {
  const r = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`createJob ${r.status}`);
  return r.json();
}

export async function getJob(id: string): Promise<Job> {
  const r = await fetch(`${API_BASE}/api/jobs/${id}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`getJob ${r.status}`);
  return r.json();
}

// 使用示例 (在 app/page.tsx 中):
// import { createJob, listJobs, getJob, API_BASE } from "@/lib/api";
// import type { Job } from "@shared/schemas/job";
// const job = await createJob({ xyz, task: "opt", charge: 0, threads: 8 });
// cancel/download 等占位暂不需要，按需再扩展
