"use client"

import { useEffect, useState } from "react"

/** 跟随 <html class="dark">（由页面主题开关切换），组件无需层层传 dark */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(false)
  useEffect(() => {
    const el = document.documentElement
    const update = () => setDark(el.classList.contains("dark"))
    update()
    const mo = new MutationObserver(update)
    mo.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => mo.disconnect()
  }, [])
  return dark
}
