"use client"

import type { ButtonHTMLAttributes } from "react"

type Variant = "default" | "ghost" | "outline"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export default function Button({ children, variant = "default", className = "", ...p }: ButtonProps) {
  const base = "px-3 py-2 rounded-lg text-sm font-medium transition"
  const v =
    variant === "ghost"
      ? "hover:bg-zinc-100 dark:hover:bg-zinc-800"
      : variant === "outline"
        ? "border bg-white dark:bg-zinc-900 dark:border-zinc-700 hover:bg-gray-50"
        : "bg-black dark:bg-white dark:text-black text-white hover:bg-zinc-800"
  return (
    <button className={`${base} ${v} ${className}`} {...p}>
      {children}
    </button>
  )
}
