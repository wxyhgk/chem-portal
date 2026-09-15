"use client"

import { useRef, useState, useCallback } from "react"

/** setInterval 句柄（浏览器 number / Node Timeout），计时器归属本模块 */
export type TimerHandle = number | NodeJS.Timeout

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
  setBackgroundColor?: (c: string) => void
}

export interface UseViewerReturn {
  viewerElRef: React.RefObject<HTMLDivElement>
  ready: boolean
  frames: number
  frame: number
  viewerErr: string
  debug: string
  countFrames: (txt: string) => number
  initViewer: (initialXyz: string, dark: boolean) => void
  setBackground: (dark: boolean) => void
  renderXyz: (txt: string) => void
  play: (speed: number) => void
  pause: () => void
  reset: () => void
  goToFrame: (n: number) => void
}

export function useViewer(): UseViewerReturn {
  const viewerElRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<ViewerInstance | null>(null)
  const timerRef = useRef<TimerHandle | undefined>(undefined)
  const lastTxtRef = useRef<string>("")
  const frameRef = useRef<number>(0)
  const framesRef = useRef<number>(0)
  const playingRef = useRef<boolean>(false)
  const speedRef = useRef<number>(250)
  // 跟随最新帧：默认开；用户手动拖条后关闭（细看模式），按播放/重置/换分子时恢复
  const followRef = useRef<boolean>(true)
  const [ready, setReady] = useState(false)
  const [frames, setFrames] = useState(0)
  const [frame, setFrame] = useState(0)
  const [viewerErr, setViewerErr] = useState("")
  const [debug, setDebug] = useState("")

  const countFrames = useCallback((txt: string): number => {
    return txt.trim().split("\n").filter((l) => /^\s*\d+\s*$/.test(l)).length || 1
  }, [])

  const renderXyz = useCallback(
    (txt: string) => {
      const v = viewerRef.current
      const el = viewerElRef.current
      if (!v || !el) {
        setDebug(`viewer未就绪 v=${!!v} el=${!!el} txt=${txt.slice(0, 20)}`)
        setTimeout(() => renderXyz(txt), 400)
        return
      }
      el.style.position = "relative"
      if (txt === lastTxtRef.current) return
      // 同一轨迹变长（SSE 进度推送）视为生长：跟随最新帧；换分子则落最后一帧
      const growing = lastTxtRef.current !== "" && txt.startsWith(lastTxtRef.current)
      lastTxtRef.current = txt
      clearInterval(timerRef.current)
      v.clear()
      try {
        v.removeAllModels?.()
      } catch {
        /* ignore */
      }
      if (!txt || txt.trim().length < 5) {
        setDebug("空画布，等待输入…")
        try {
          v.resize()
          v.render()
        } catch (e: unknown) {
          setViewerErr(String(e))
        }
        playingRef.current = false
        frameRef.current = 0
        framesRef.current = 1
        setFrames(1)
        setFrame(0)
        return
      }
      const f = countFrames(txt)
      framesRef.current = f
      setFrames(f)
      // 新分子默认停在最后一帧；生长时跟随最新（除非用户拖过条）；动画只走播放键
      const startFrame = growing && !followRef.current ? Math.min(frameRef.current, f - 1) : f - 1
      frameRef.current = startFrame
      setFrame(startFrame)
      setDebug(`渲染 ${f}帧 ${txt.split("\n")[0]}原子 ${txt.slice(0, 30).replace(/\n/g, "|")}`)
      setViewerErr("")
      try {
        if (v.addModelsAsFrames) v.addModelsAsFrames(txt, "xyz")
        else v.addModel(txt, "xyz")
      } catch (e: unknown) {
        setViewerErr("addModels失败: " + String(e))
        console.error(e)
      }
      try {
        v.setStyle({}, { stick: { radius: 0.12 }, sphere: { scale: 0.23 } })
        v.zoomTo()
        v.setFrame(startFrame)
        v.resize()
        v.render()
      } catch (e: unknown) {
        setViewerErr("render失败: " + String(e))
      }
      if (growing && playingRef.current && f > 1) {
        const speed = speedRef.current
        timerRef.current = setInterval(() => {
          setFrame((p) => {
            const n = (p + 1) % framesRef.current
            try {
              v.setFrame(n)
              v.render()
            } catch {
              /* ignore */
            }
            frameRef.current = n
            return n
          })
        }, speed)
      } else {
        playingRef.current = false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [countFrames],
  )

  const initViewer = useCallback(
    (initialXyz: string, dark: boolean) => {
      const el = viewerElRef.current
      const w = window as unknown as { $3Dmol?: { createViewer: (el: HTMLElement, opts: unknown) => unknown } }
      if (!w.$3Dmol || !el) return
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) {
        setTimeout(() => initViewer(initialXyz, dark), 200)
        return
      }
      el.style.position = "relative"
      viewerRef.current = w.$3Dmol.createViewer(el, { backgroundColor: dark ? "black" : "white" }) as ViewerInstance
      lastTxtRef.current = ""
      setReady(true)
      const ro = new ResizeObserver(() => {
        try {
          viewerRef.current?.resize()
          viewerRef.current?.render()
        } catch {
          /* ignore */
        }
      })
      ro.observe(el)
      window.addEventListener("resize", () => {
        try {
          viewerRef.current?.resize()
          viewerRef.current?.render()
        } catch {
          /* ignore */
        }
      })
      renderXyz(initialXyz)
    },
    [renderXyz],
  )

  const setBackground = useCallback((dark: boolean) => {
    try {
      viewerRef.current?.setBackgroundColor?.(dark ? "black" : "white")
      viewerRef.current?.render()
    } catch {
      /* ignore */
    }
  }, [])

  const play = useCallback((speed: number) => {
    const v = viewerRef.current
    if (!v || framesRef.current <= 1) return
    speedRef.current = speed
    playingRef.current = true
    followRef.current = true
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setFrame((p) => {
        const n = (p + 1) % framesRef.current
        try {
          v.setFrame(n)
          v.render()
        } catch {
          /* ignore */
        }
        frameRef.current = n
        return n
      })
    }, speed)
  }, [])

  const pause = useCallback(() => {
    playingRef.current = false
    clearInterval(timerRef.current)
  }, [])

  const reset = useCallback(() => {
    playingRef.current = false
    clearInterval(timerRef.current)
    frameRef.current = 0
    setFrame(0)
    try {
      viewerRef.current?.setFrame(0)
      viewerRef.current?.render()
    } catch {
      /* ignore */
    }
  }, [])

  const goToFrame = useCallback((n: number) => {
    followRef.current = false
    frameRef.current = n
    setFrame(n)
    try {
      viewerRef.current?.setFrame(n)
      viewerRef.current?.render()
    } catch {
      /* ignore */
    }
  }, [])

  return {
    viewerElRef,
    ready,
    frames,
    frame,
    viewerErr,
    debug,
    countFrames,
    initViewer,
    setBackground,
    renderXyz,
    play,
    pause,
    reset,
    goToFrame,
  }
}
