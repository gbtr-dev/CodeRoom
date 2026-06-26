"use client"

import { useState, useRef, useEffect } from "react"
import type React from "react"
import type { Socket } from "socket.io-client"
import type { Knock } from "@/lib/useSocket"


/* ------------------------------------------------------------------ */
/* Schermata inserimento password                                      */
/* ------------------------------------------------------------------ */

export function RoomPasswordScreen({
  wrongPassword,
  onSubmit,
}: {
  wrongPassword: boolean
  onSubmit: (password: string) => void
}) {
  const [pw, setPw] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  function submit() {
    if (!pw.trim()) return
    onSubmit(pw)
    setPw("")
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0d0d0d] font-mono text-[13px] text-neutral-500">
      <div className="flex w-full max-w-xs flex-col items-center gap-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/20">
          <svg className="h-5 w-5 text-[#4ade80]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div>
          <p className="font-sans text-[15px] font-semibold text-neutral-200">Password required</p>
          <p className="mt-1.5 font-sans text-[12px] text-neutral-500">This room is password-protected.</p>
        </div>
        {wrongPassword && (
          <p className="font-sans text-[12px] text-red-400">Incorrect password, try again.</p>
        )}
        <div className="flex w-full flex-col gap-2">
          <input
            ref={inputRef}
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit() }}
            placeholder="Room password"
            className="h-10 w-full rounded-xl border border-[#2a2a2a] bg-[#141414] px-3 font-sans text-[13px] text-neutral-200 placeholder:text-neutral-700 outline-none focus:border-[#22c55e]/30"
          />
          <button
            onClick={submit}
            disabled={!pw.trim()}
            className="flex h-10 w-full items-center justify-center rounded-xl bg-[#22c55e] font-sans text-[13px] font-medium text-[#0a0a0a] transition-colors hover:bg-[#26d066] disabled:opacity-40"
          >
            Enter room
          </button>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Schermata "in attesa di approvazione"                               */
/* ------------------------------------------------------------------ */

export function KnockWaitingScreen() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0d0d0d] font-mono text-[13px] text-neutral-500">
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/20">
          <span className="text-xl">🚪</span>
        </div>
        <div>
          <p className="font-sans text-[15px] font-semibold text-neutral-200">Waiting for approval</p>
          <p className="mt-1.5 font-sans text-[12px] text-neutral-500">The owner has been notified.<br />You'll be let in once they approve your request.</p>
        </div>
        <div className="flex items-center gap-2 text-neutral-600">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-500" />
          <span className="font-sans text-[11px]">Knock sent…</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Schermata "accesso negato"                                          */
/* ------------------------------------------------------------------ */

export function KnockDeniedScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#0d0d0d] font-mono text-[13px] text-neutral-500">
      <div className="flex flex-col items-center gap-5 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 ring-1 ring-inset ring-red-500/20">
          <span className="text-xl">🔒</span>
        </div>
        <div>
          <p className="font-sans text-[15px] font-semibold text-neutral-200">Access denied</p>
          <p className="mt-1.5 font-sans text-[12px] text-neutral-500">The owner declined your request<br />or no owner was online to approve it.</p>
        </div>
        <button
          onClick={onBack}
          className="mt-1 flex h-8 items-center rounded-lg bg-[#1a1a1a] px-4 font-sans text-[12px] text-neutral-300 transition-colors hover:bg-[#242424]"
        >
          Back to my rooms
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Pannello di approvazione — visibile solo all'owner                  */
/* ------------------------------------------------------------------ */

export function KnockApprovalPanel({
  knockQueue,
  socketRef,
  setKnockQueue,
}: {
  knockQueue: Knock[]
  socketRef: React.RefObject<Socket | null>
  setKnockQueue: React.Dispatch<React.SetStateAction<Knock[]>>
}) {
  if (knockQueue.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
      {knockQueue.map(({ knockId, userName, avatar }) => (
        <div
          key={knockId}
          className="flex w-72 items-center gap-3 rounded-xl border border-[#2a2a2a] bg-[#161616] p-3.5 shadow-2xl shadow-black/60"
        >
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/20 text-[11px] font-bold text-[#22c55e] overflow-hidden">
            {avatar
              ? <img src={avatar} alt="" className="absolute inset-0 h-full w-full object-cover rounded-lg" />
              : userName.slice(0, 2).toUpperCase()
            }
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-sans text-[12px] font-medium text-neutral-200 truncate">{userName}</p>
            <p className="font-sans text-[11px] text-neutral-500">wants to join</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                socketRef.current?.emit("deny-knock", { knockId })
                setKnockQueue((prev) => prev.filter((k) => k.knockId !== knockId))
              }}
              className="flex h-7 items-center rounded-md bg-red-500/10 px-2.5 font-sans text-[11px] font-medium text-red-400 transition-colors hover:bg-red-500/20"
            >
              Deny
            </button>
            <button
              onClick={() => {
                socketRef.current?.emit("approve-knock", { knockId })
                setKnockQueue((prev) => prev.filter((k) => k.knockId !== knockId))
              }}
              className="flex h-7 items-center rounded-md bg-[#22c55e]/10 px-2.5 font-sans text-[11px] font-medium text-[#22c55e] transition-colors hover:bg-[#22c55e]/20"
            >
              Admit
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}