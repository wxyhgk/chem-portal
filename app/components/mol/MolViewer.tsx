"use client"

// 3D 分子查看器（3D 页与详情抽屉共用）：多帧轨迹播放/拖动；运行中轨迹增长时跟随最新帧
import { useEffect, useRef, useState } from "react"
import { BALL_STICK, bgColor, load3Dmol, type Mol3DLib, type Mol3DViewer } from "@/lib/mol3d"
import { useDarkMode } from "@/lib/hooks/useDarkMode"
import { parseXyzFrames } from "@/lib/xyz"

export interface MolViewerProps {
  xyz: string
  /** full：播放/暂停、重置、速度、帧滑块；compact：播放 + 帧滑块（仅多帧时显示） */
  controls?: "full" | "compact"
  /** 画布容器尺寸类名 */
  sizeClass?: string
  emptyText?: string
  onFramesChange?: (frames: number) => void
}

const btn = "px-2.5 py-1 rounded-md border text-xs dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40"

export default function MolViewer({ xyz, controls = "compact", sizeClass = "aspect-[4/3]", emptyText = "无结构", onFramesChange }: MolViewerProps) {
  const dark = useDarkMode()
  const elRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Mol3DViewer | null>(null)
  const lastXyzRef = useRef("")
  const followRef = useRef(true) // 轨迹增长时跟随最新帧；用户拖到非末帧后关闭
  const darkRef = useRef(dark)
  darkRef.current = dark
  const framesCb = useRef(onFramesChange)
  framesCb.current = onFramesChange
  const [ready, setReady] = useState(false)
  const [err, setErr] = useState("")
  const [frames, setFrames] = useState(1)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(250) // 帧间隔 ms

  // 创建 viewer：等脚本加载且容器可见（隐藏的 tab 尺寸为 0，此时创建画布会失效）
  useEffect(() => {
    const el = elRef.current
    if (!el) return
    let alive = true
    let lib: Mol3DLib | null = null
    const tryInit = () => {
      if (!alive || !lib || viewerRef.current || el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        viewerRef.current = lib.createViewer(el, { backgroundColor: bgColor(darkRef.current) })
        setReady(true)
      } catch (e) {
        setErr(`3D 初始化失败: ${String(e)}`)
      }
    }
    const ro = new ResizeObserver(() => {
      const v = viewerRef.current
      if (!v) return tryInit()
      try {
        v.resize()
        v.render()
      } catch {
        /* ignore */
      }
    })
    ro.observe(el)
    load3Dmol()
      .then((l) => {
        lib = l
        tryInit()
      })
      .catch((e) => alive && setErr(String(e?.message || e)))
    return () => {
      alive = false
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
    if (!v) return
    try {
      v.setBackgroundColor?.(bgColor(dark))
      v.render()
    } catch {
      /* ignore */
    }
  }, [dark, ready])

  const showFrame = (n: number) => {
    try {
      viewerRef.current?.setFrame(n)
      viewerRef.current?.render()
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const v = viewerRef.current
    if (!ready || !v || xyz === lastXyzRef.current) return
    // 同一轨迹变长（运行中推送）：保留视角，跟随最新帧；换结构：重新居中停在末帧
    const growing = lastXyzRef.current !== "" && xyz.startsWith(lastXyzRef.current)
    lastXyzRef.current = xyz
    const n = Math.max(1, parseXyzFrames(xyz).length)
    if (!growing) {
      followRef.current = true
      setPlaying(false)
    }
    const target = followRef.current ? n - 1 : Math.min(frame, n - 1)
    try {
      v.clear()
      v.removeAllModels?.()
      if (xyz.trim()) {
        if (v.addModelsAsFrames) v.addModelsAsFrames(xyz, "xyz")
        else v.addModel(xyz, "xyz")
        v.setStyle({}, BALL_STICK)
      }
      if (!growing) v.zoomTo()
      v.setFrame(target)
      v.resize()
      v.render()
      setErr("")
    } catch (e) {
      setErr(`渲染失败: ${String(e)}`)
    }
    setFrames(n)
    setFrame(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xyz, ready])

  useEffect(() => {
    framesCb.current?.(frames)
  }, [frames])

  useEffect(() => {
    if (!playing || frames <= 1) return
    const t = window.setInterval(() => {
      setFrame((p) => {
        const n = (p + 1) % frames
        showFrame(n)
        return n
      })
    }, speed)
    return () => window.clearInterval(t)
  }, [playing, frames, speed])

  const goTo = (n: number) => {
    setPlaying(false)
    followRef.current = n === frames - 1
    setFrame(n)
    showFrame(n)
  }
  const play = () => {
    followRef.current = true
    setPlaying(true)
  }
  const reset = () => {
    setPlaying(false)
    followRef.current = false
    setFrame(0)
    showFrame(0)
  }

  const overlay = err || (!xyz.trim() ? emptyText : "")

  return (
    <div>
      <div className={`relative w-full ${sizeClass} rounded-lg border dark:border-zinc-800 bg-white dark:bg-black overflow-hidden`}>
        <div ref={elRef} className="absolute inset-0" />
        {overlay && (
          <div className={`absolute inset-0 flex items-center justify-center p-4 text-center text-xs pointer-events-none ${err ? "text-red-600" : "text-zinc-400"}`}>
            {overlay}
          </div>
        )}
      </div>
      {controls === "full" ? (
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <button className={btn} onClick={playing ? () => setPlaying(false) : play} disabled={frames <= 1}>
            {playing ? "⏸ 暂停" : "▶ 播放"}
          </button>
          <button className={btn} onClick={reset} disabled={frames <= 1}>
            重置
          </button>
          <label className="text-xs flex items-center gap-1 text-zinc-500">
            速度
            <input type="range" min={50} max={800} step={50} value={850 - speed} onChange={(e) => setSpeed(850 - parseInt(e.target.value))} className="w-24" />
          </label>
          <input
            type="range"
            min={0}
            max={Math.max(0, frames - 1)}
            value={frame}
            disabled={frames <= 1}
            onChange={(e) => goTo(parseInt(e.target.value))}
            className="flex-1 min-w-[120px]"
          />
          <span className="text-xs text-zinc-600 dark:text-zinc-400 tabular-nums">
            {frame + 1}/{frames}
          </span>
        </div>
      ) : (
        frames > 1 && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={playing ? () => setPlaying(false) : play} className={btn}>
              {playing ? "⏸" : "▶"}
            </button>
            <input type="range" min={0} max={frames - 1} value={frame} onChange={(e) => goTo(parseInt(e.target.value))} className="flex-1" />
            <span className="text-[11px] text-zinc-500 tabular-nums">
              {frame + 1}/{frames}
            </span>
          </div>
        )
      )}
    </div>
  )
}
