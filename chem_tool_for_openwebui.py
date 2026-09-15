"""
Chem Portal Tool for Open WebUI
直接粘到 Open WebUI → Admin → Tools → + Create Tool → 粘贴此文件内容 → Save
然后在对话里让模型调用它，例如：“用 xyz 帮我做个 opt”

API 默认 http://127.0.0.1:18081（Open WebUI 与 chem-portal 同一 VPS，走内网更快）
若 Open WebUI 在容器内，改成 http://CHEM_PORTAL_HOST:18081
"""

import time
import requests


class Tools:
    class Valves(BaseModel := __import__("pydantic").BaseModel):
        api_url: str = __import__("pydantic").Field(
            default="http://127.0.0.1:18081",
            description="Chem Portal 后端地址，VPS 内网用 127.0.0.1:18081，容器用 CHEM_PORTAL_HOST:18081",
        )
        poll_interval: float = __import__("pydantic").Field(
            default=1.5, description="轮询间隔秒"
        )
        timeout: int = __import__("pydantic").Field(
            default=600, description="最大等待秒"
        )

    def __init__(self):
        # pydantic Valves 会由 Open WebUI 自动注入
        try:
            self.valves = self.Valves()
        except Exception:
            self.valves = type("V", (), {"api_url": "http://127.0.0.1:18081", "poll_interval": 1.5, "timeout": 600})()

    def submit_sp(
        self, xyz: str, charge: int = 0, threads: int = 8
    ) -> str:
        """
        提交单点能计算 (xtb GFN2 sp)

        :param xyz: XYZ 格式字符串，例如 "3\\nH2O\\nO 0 0 0\\nH 0.757 0 0.586\\nH -0.757 0 0.586\\n"
        :param charge: 分子电荷，默认 0
        :param threads: 线程数，默认 8
        """
        return self._submit_and_wait(xyz, task="sp", charge=charge, threads=threads)

    def submit_opt(
        self, xyz: str, charge: int = 0, threads: int = 8
    ) -> str:
        """
        提交几何优化 (xtb GFN2 opt)，返回轨迹动画数据

        :param xyz: XYZ 格式字符串
        :param charge: 电荷
        :param threads: 线程数，建议 8（VPS 24核最优 3×8 并发）
        """
        return self._submit_and_wait(xyz, task="opt", charge=charge, threads=threads)

    def get_job(self, job_id: str) -> str:
        """
        查询已有任务状态

        :param job_id: 任务 id，例如 75bd94d3782f
        """
        url = f"{self.valves.api_url.rstrip('/')}/api/jobs/{job_id}"
        try:
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            j = r.json()
            xyz_preview = (j.get("result_xyz") or j.get("input_xyz") or "")[:600].replace("\n", "|")
            return (
                f"job {j['id']} [{j['task']}] {j['status']}\n"
                f"E = {j.get('result_energy')} Eh  wall={j.get('wall_time')}s\n"
                f"xyz_len={len(j.get('result_xyz') or '')} preview={xyz_preview}\n"
                f"查看 3D: {self.valves.api_url.rstrip('/')}/api/jobs/{j['id']}"
            )
        except Exception as e:
            return f"查询失败: {e}"

    def list_jobs(self, limit: int = 5) -> str:
        """
        列出最近任务

        :param limit: 返回条数
        """
        url = f"{self.valves.api_url.rstrip('/')}/api/jobs"
        try:
            r = requests.get(url, timeout=10)
            r.raise_for_status()
            js = r.json()[:limit]
            lines = [
                f"{j['id'][:8]} {j['task']} {j['status']} E={j.get('result_energy')} wall={j.get('wall_time')}"
                for j in js
            ]
            return "\n".join(lines) if lines else "暂无任务"
        except Exception as e:
            return f"查询失败: {e}"

    # 内部轮询
    def _submit_and_wait(self, xyz: str, task: str, charge: int, threads: int) -> str:
        base = self.valves.api_url.rstrip("/")
        try:
            r = requests.post(
                f"{base}/api/jobs",
                json={"xyz": xyz, "task": task, "charge": charge, "threads": threads},
                timeout=15,
            )
            r.raise_for_status()
            jid = r.json().get("id")
            if not jid:
                return f"提交失败: {r.text[:500]}"
        except Exception as e:
            return f"提交失败: {e}"

        # 轮询
        t0 = time.time()
        while time.time() - t0 < self.valves.timeout:
            time.sleep(self.valves.poll_interval)
            try:
                r = requests.get(f"{base}/api/jobs/{jid}", timeout=10)
                r.raise_for_status()
                j = r.json()
                if j.get("status") in ("done", "failed"):
                    preview = (j.get("result_xyz") or "")[:500].replace("\n", "|")
                    return (
                        f"任务 {jid} 完成 [{j['status']}]\n"
                        f"task={j['task']} E={j.get('result_energy')} Eh wall={j.get('wall_time')}s\n"
                        f"能量: {j.get('result_energy')} Eh\n"
                        f"轨迹帧数≈{ (j.get('result_xyz') or '').count('energy:') }  preview={preview[:300]}\n"
                        f"完整 XYZ 可下载: {base}/api/jobs/{jid} 的 result_xyz 字段\n"
                        f"在 chem-portal 前端查看 3D 动画: http://CHEM_PORTAL_HOST:18080 (侧边栏 {jid[:8]})"
                    )
            except Exception as e:
                return f"轮询失败 {jid}: {e}"
        return f"任务 {jid} 超时，仍在运行中，可稍后用 get_job 查询"
