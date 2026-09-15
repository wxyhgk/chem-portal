// 多帧 XYZ 轨迹解析 — MD/opt 轨迹选帧跑 QM 用
// 帧格式: <natoms>\n<comment(含 energy: -x.x 可选)>\n<coords...>

export interface XyzFrame {
  natoms: number
  comment: string
  energy: number | null
  body: string
}

/** opt 产出多帧轨迹（可播放/选帧），sp 为单帧 */
export function isTrajectoryTask(task: string): boolean {
  return task === "opt"
}

/** 解析多帧 xyz 文本为帧数组；单帧亦可（返回 1 帧） */
export function parseXyzFrames(txt: string): XyzFrame[] {
  const lines = (txt || "").split("\n")
  const frames: XyzFrame[] = []
  let i = 0
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === "") i++
    if (i >= lines.length) break
    const n = parseInt(lines[i].trim(), 10)
    if (!Number.isFinite(n) || n <= 0 || i + 1 >= lines.length) break
    const comment = lines[i + 1] ?? ""
    const body = lines.slice(i + 2, i + 2 + n).join("\n")
    const m = comment.match(/energy:\s*(-?\d+\.\d+)/)
    frames.push({ natoms: n, comment, energy: m ? parseFloat(m[1]) : null, body })
    i += 2 + n
  }
  return frames
}

/** 单帧重组为标准 xyz 文本 */
export function frameToXyz(f: XyzFrame): string {
  return `${f.natoms}\n${f.comment}\n${f.body}\n`
}

/** 能量最低帧（无能量信息则取末帧） */
export function minEnergyFrame(frames: XyzFrame[]): XyzFrame | null {
  if (frames.length === 0) return null
  const withE = frames.filter((f) => f.energy !== null)
  if (withE.length === 0) return frames[frames.length - 1]
  return withE.reduce((a, b) => ((b.energy as number) < (a.energy as number) ? b : a))
}
