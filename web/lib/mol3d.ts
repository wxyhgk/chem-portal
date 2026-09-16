// 3Dmol.js 封装：按需加载脚本（全站只加载一次）、公共类型与显示样式
export const MOL3D_SRC = "https://cdnjs.cloudflare.com/ajax/libs/3Dmol/2.1.0/3Dmol-min.js"

export interface Mol3DViewer {
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

export interface Mol3DLib {
  createViewer: (el: HTMLElement, opts: unknown) => Mol3DViewer
}

declare global {
  interface Window {
    $3Dmol?: Mol3DLib
  }
}

/** 球棍模型 */
export const BALL_STICK = { stick: { radius: 0.12 }, sphere: { scale: 0.23 } }

export const bgColor = (dark: boolean) => (dark ? "black" : "white")

let loading: Promise<Mol3DLib> | null = null

export function load3Dmol(): Promise<Mol3DLib> {
  if (window.$3Dmol) return Promise.resolve(window.$3Dmol)
  if (!loading) {
    loading = new Promise<Mol3DLib>((resolve, reject) => {
      const s = document.createElement("script")
      s.src = MOL3D_SRC
      s.async = true
      s.onload = () => (window.$3Dmol ? resolve(window.$3Dmol) : reject(new Error("3Dmol 加载后未定义")))
      s.onerror = () => {
        loading = null // 允许下次重试
        reject(new Error("3D 组件加载失败（网络或 CDN 不可达）"))
      }
      document.head.appendChild(s)
    })
  }
  return loading
}
