// SDF/MOL 文本拆分 — 批量提交用（后端 /api/embed 只取第一个分子，多分子文件在前端按 $$$$ 拆开）

export interface SdfMolecule {
  name: string   // 标题行；为空时用文件名（多分子加序号）
  block: string  // 单个分子 molblock（含 M  END）
}

/** 按 $$$$ 拆分，丢弃不含 M  END 的残块 */
export function splitSdf(text: string, fileName: string): SdfMolecule[] {
  const base = fileName.replace(/\.(sdf|sd|mol)$/i, "")
  // 分隔符连同行尾换行一起吃掉；不能 trim 前导空行 —— 空标题行本身就是 molblock 第 1 行
  const blocks = (text || "")
    .replace(/\r\n?/g, "\n")
    .split(/^\$\$\$\$[^\n]*\n?/m)
    .filter((b) => b.includes("M  END"))
  return blocks.map((block, i) => {
    const title = block.split("\n")[0].trim()
    const name = title || (blocks.length > 1 ? `${base}_${i + 1}` : base)
    return { name, block }
  })
}
