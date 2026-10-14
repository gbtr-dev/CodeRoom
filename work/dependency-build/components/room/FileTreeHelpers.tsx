"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"

export function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left font-sans text-[12px] transition-colors hover:bg-[#1e1e1e] ${danger ? "text-red-400 hover:text-red-300" : "text-neutral-300 hover:text-neutral-100"}`}>
      {icon}{label}
    </button>
  )
}

export function InlineEntry({ icon, pad, defaultValue, placeholder, onCommit, onCancel }: { icon: React.ReactNode; pad: number; defaultValue: string; placeholder?: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState(defaultValue)
  const ref = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <div className="flex items-center gap-2 py-[2px] pr-2" style={{ paddingLeft: pad }}>
      {icon}
      <input
        ref={ref}
        value={val}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        onBlur={() => { if (!cancelled.current) onCommit(val) }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onCommit(val) } else if (e.key === "Escape") { cancelled.current = true; onCancel() } }}
        className="w-full rounded border border-[#22c55e]/50 bg-[#0d0d0d] px-1.5 py-0.5 font-sans text-[12px] text-neutral-100 outline-none focus:border-[#22c55e]/70 focus:ring-1 focus:ring-[#22c55e]/20"
      />
    </div>
  )
}