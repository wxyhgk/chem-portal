import "./globals.css"
export const metadata = { title: "Chem Portal", description: "24核法国VPS · xtb 在线计算" }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh"><body className="bg-gray-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">{children}</body></html>
}
