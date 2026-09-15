"use client"

import { useCallback, useEffect, useState } from "react"

/**
 * 浏览器本地记住的界面偏好：挂载后再读（避免与预渲染 HTML 不一致），
 * 隐私模式等读写失败时静默使用默认值。
 */
export function usePrefs<T extends object>(key: string, defaults: T, sanitize?: (p: T) => T) {
  const [prefs, setPrefs] = useState<T>(defaults)

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw) setPrefs({ ...defaults, ...JSON.parse(raw) })
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const update = useCallback(
    (u: Partial<T>) =>
      setPrefs((prev) => {
        const next = { ...prev, ...u }
        try {
          window.localStorage.setItem(key, JSON.stringify(sanitize ? sanitize(next) : next))
        } catch {
          /* ignore */
        }
        return next
      }),
    [key, sanitize],
  )

  return [prefs, update] as const
}
