"use client"

import type React from "react"
import { useEffect, useRef, useState } from "react"
import { ChevronIcon, CheckIcon } from "./Icons"

const ROLE_STYLES: Record<string, { label: string; cls: string }> = {
  owner:  { label: "owner",  cls: "bg-[#a78bfa]/10 text-[#a78bfa]" },
  editor: { label: "editor", cls: "bg-[#f59e0b]/10 text-[#f59e0b]" },
  viewer: { label: "viewer", cls: "bg-[#6b7280]/10 text-[#9ca3af]" },
}

const ROLE_OPTIONS: { value: "editor" | "viewer"; label: string; hint: string }[] = [
  { value: "editor", label: "Editor", hint: "Can edit files and run code" },
  { value: "viewer", label: "Viewer", hint: "Read-only access" },
]

export function RoleBadge({ role }: { role: string }) {
  const s = ROLE_STYLES[role] ?? ROLE_STYLES.viewer
  return (
    <span className={`text-[10px] rounded-full px-2 py-0.5 font-sans font-medium ${s.cls}`}>
      {s.label}
    </span>
  )
}

const ROLE_MENU_HEIGHT = 100

export function RoleMenu({ currentRole, onChange }: { currentRole: string; onChange: (r: "editor" | "viewer") => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const s = ROLE_STYLES[currentRole] ?? ROLE_STYLES.viewer

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      // Chiude se il click è fuori sia dal trigger che dal menu
      if (triggerRef.current?.contains(e.target as Node)) return
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("keydown", onKey)
    }
  }, [open])

  function toggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open) {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) {
        const spaceBelow = window.innerHeight - r.bottom
        // Se lo spazio sotto non basta, apri verso l'alto
        const top = spaceBelow < ROLE_MENU_HEIGHT + 12
          ? r.top - ROLE_MENU_HEIGHT - 6
          : r.bottom + 6
        setPos({ top, left: Math.max(8, r.right - 176) })
      }
    }
    setOpen((v) => !v)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={toggle}
        title="Change role"
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1.5 text-[10px] font-medium font-sans transition-colors hover:brightness-125 ${s.cls}`}
      >
        {s.label}
        <ChevronIcon className={`h-2.5 w-2.5 rotate-90 opacity-70 transition-transform duration-150 ${open ? "rotate-[270deg]" : ""}`} />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-[200] w-44 overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#161616] py-1 shadow-2xl shadow-black/60"
          style={{ top: pos.top, left: pos.left }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ROLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              role="menuitemradio"
              aria-checked={opt.value === currentRole}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left transition-colors hover:bg-[#1e1e1e]"
            >
              <span className="flex flex-col gap-0.5">
                <span className={`text-[11px] font-medium font-sans ${opt.value === currentRole ? "text-neutral-100" : "text-neutral-300"}`}>
                  {opt.label}
                </span>
                <span className="text-[9.5px] leading-snug text-neutral-500">{opt.hint}</span>
              </span>
              {opt.value === currentRole && <CheckIcon className="mt-0.5 h-3 w-3 shrink-0 text-[#22c55e]" />}
            </button>
          ))}
        </div>
      )}
    </>
  )
}