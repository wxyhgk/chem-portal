"use client"

// 详情抽屉里的独立 3Dmol 视图（不占用 3D 页的主 viewer）；多帧轨迹可播放/拖动
import { useEffect, useRef, useState } from "react"
import { parseXyzFrames } from "@/lib/xyz"

interface ViewerInstance {
  clear: () => void
  removeAllModels?: () => void
  addModelsAsFrames?: (txt: string, fmt: string) => void
  addModel: (txt: string, fmt: string) => void
  setStyle: (sel: unknown, style: unknown) => void
  zoomTo: () => void
  setFrame: (n: number) => void
  resize: () => void
  render: () => void
}

type Win = { $3Dmol?: { createViewer: (el: HTMLElement, opts: unknown) => ViewerInstance } }

const MAX_INIT_TRIES = 100 // 约 30s 等 page.tsx 注入的 3Dmol 脚本

export default function MiniViewer({ xyz, loading }: { xyz: string; loading?: boolean }) {
  const elRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ViewerInstance | null>(null)
  const lastRef = useRef("")
  const [ready, setReady] = useState(false)
  const [initErr, setInitErr] = useState("")
  const [frames, setFrames] = useState(1)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    let alive = true
    let tries = 0
    let timer: number | undefined
    const init = () => {
      if (!alive) return
      const w = window as unknown as Win
      const el = elRef.current
      if (!w.$3Dmol || !el || el.clientWidth === 0) {
        if (++tries > MAX_INIT_TRIES) return setInitErr("3D 组件未加载")
        timer = window.setTimeout(init, 300)
        return
      }
      viewerRef.current = w.$3Dmol.createViewer(el, { backgroundColor: document.documentElement.classList.contains("dark") ? "black" : "white" })
      setReady(true)
    }
    init()
    const ro = new ResizeObserver(() => {
      try {
        viewerRef.current?.resize()
        viewerRef.current?.render()
      } catch {
        /* ignore */
      }
    })
    if (elRef.current) ro.observe(elRef.current)
    return () => {
      alive = false
      window.clearTimeout(timer)
      ro.disconnect()
      try {
        viewerRef.current?.clear()
      } catch {
        /* ignore */
      }
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    const v = viewerRef.current
    if (!ready || !v || xyz === lastRef.current) return
    // 同一轨迹变长（运行中推送）不重置视角，跟随最新帧；换任务则重新居中
    const growing = lastRef.current !== "" && xyz.startsWith(lastRef.current)
    lastRef.current = xyz
    const n = Math.max(1, parseXyzFrames(xyz).length)
    try {
      v.clear()
      v.removeAllModels?.()
      if (xyz.trim()) {
        if (v.addModelsAsFrames) v.addModelsAsFrames(xyz, "xyz")
        else v.addModel(xyz, "xyz")
        v.setStyle({}, { stick: { radius: 0.12 }, sphere: { scale: 0.23 } })
      }
      if (!growing) v.zoomTo()
      v.setFrame(n - 1)
      v.resize()
      v.render()
    } catch (e) {
      console.error(e)
    }
    setFrames(n)
    setFrame(n - 1)
    if (!growing) setPlaying(false)
  }, [xyz, ready])

  useEffect(() => {
    if (!playing || frames <= 1) return
    const t = window.setInterval(() => {
      setFrame((prev) => {
        const n = (prev + 1) % frames
        try {
          viewerRef.current?.setFrame(n)
          viewerRef.current?.render()
        } catch {
          /* ignore */
        }
        return n
      })
    }, 200)
    return () => window.clearInterval(t)
  }, [playing, frames])

  const goTo = (n: number) => {
    setPlaying(false)
    setFrame(n)
    try {
      viewerRef.current?.setFrame(n)
      viewerRef.current?.render()
    } catch {
      /* ignore */
    }
  }

  return (
    <div>
      <div className="relative w-full aspect-[4/3] rounded-lg border dark:border-zinc-800 bg-white overflow-hidden">
        <div ref={elRef} className="absolute inset-0" />
        {(!xyz || initErr) && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400 pointer-events-none">
            {initErr || (loading ? "加载中…" : "无结构")}
          </div>
        )}
      </div>
      {frames > 1 && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => setPlaying(!playing)}
            className="px-2 py-1 rounded-md border text-xs dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            {playing ? "⏸" : "▶"}
          </button>
          <input type="range" min={0} max={frames - 1} value={frame} onChange={(e) => goTo(parseInt(e.target.value))} className="flex-1" />
          <span className="text-[11px] text-zinc-500 tabular-nums">
            {frame + 1}/{frames}
          </span>
        </div>
      )}
    </div>
  )
}
