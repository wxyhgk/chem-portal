/** 触发浏览器下载文本文件；bom=true 让 Excel 正确识别 UTF-8 中文 */
export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8", bom = false) {
  const url = URL.createObjectURL(new Blob([bom ? "﻿" + text : text], { type: mime }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 立即 revoke 在部分浏览器会中断下载
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 文件名安全化：去掉 .sdf/.mol 后缀与非法字符 */
export function safeFileBase(name: string): string {
  return name.replace(/\.(sdf|sd|mol)$/i, "").replace(/[^\w.\-]+/g, "_") || "job"
}
