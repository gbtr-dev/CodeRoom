"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"

type InviteInfo = {
  token: string
  roomId: string
  roomName: string | null
  expiresAt: number
}

function timeLeft(expiresAt: number): string {
  const diff = expiresAt - Math.floor(Date.now() / 1000)
  if (diff <= 0) return "expired"
  if (diff < 3600) return `${Math.ceil(diff / 60)}m left`
  if (diff < 86400) return `${Math.ceil(diff / 3600)}h left`
  return `${Math.ceil(diff / 86400)}d left`
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  const { user, ready } = useAuth()
  const router = useRouter()

  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [password, setPassword] = useState("")
  const [wrongPassword, setWrongPassword] = useState(false)
  const [requiresPassword, setRequiresPassword] = useState(false)

  useEffect(() => {
    fetch(`${BACKEND_URL}/invite/${token}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.roomId) setInfo(data)
        else setNotFound(true)
      })
      .catch(() => setNotFound(true))
  }, [token])

  async function join() {
    if (!user) {
      router.push(`/login?redirect=/invite/${token}`)
      return
    }
    if (requiresPassword && !password) return
    setJoining(true)
    setError(null)
    setWrongPassword(false)
    try {
      const res = await fetch(`${BACKEND_URL}/invite/${token}/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(password ? { password } : {}),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.requiresPassword) { setRequiresPassword(true); return }
        if (data.wrongPassword) { setWrongPassword(true); setPassword(""); return }
        setError(data.error ?? "Failed to join room")
        return
      }
      router.push(`/room/${data.roomId}`)
    } catch {
      setError("Cannot connect to server")
    } finally {
      setJoining(false)
    }
  }

  if (!ready || (!info && !notFound)) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#070809]">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-[#4ade80]" />
      </div>
    )
  }

  if (notFound) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#070809] text-[#c8c8c8]">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/10 ring-1 ring-inset ring-red-500/20">
            <svg className="h-5 w-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div>
            <p className="font-sans text-[15px] font-semibold text-[#f0f0f0]">Invite link not found</p>
            <p className="mt-1.5 font-sans text-[12px] text-[#555]">This link may have expired or already been used.</p>
          </div>
          <button onClick={() => router.push("/")} className="mt-1 flex h-8 items-center rounded-lg bg-[#1a1a1a] px-4 font-sans text-[12px] text-neutral-300 transition-colors hover:bg-[#242424]">
            Go home
          </button>
        </div>
      </div>
    )
  }

  const roomLabel = info!.roomName ?? info!.roomId

  return (
    <div className="flex h-screen items-center justify-center bg-[#070809] text-[#c8c8c8]">
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.07] bg-white/[0.015] p-8 shadow-2xl">

        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/20">
          <svg className="h-5 w-5 text-[#4ade80]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4ade80]">You've been invited</p>
        <h1 className="mt-1 text-[22px] font-bold tracking-[-0.4px] text-[#f0f0f0]">{roomLabel}</h1>
        <p className="mt-1 text-[12px] text-[#555]">Invite expires in {timeLeft(info!.expiresAt)}</p>

        {!user && (
          <p className="mt-4 rounded-lg bg-white/[0.03] px-3 py-2.5 font-sans text-[12px] text-[#888]">
            You need to be logged in to join this room.
          </p>
        )}

        {user && requiresPassword && (
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-[11px] text-[#555]">
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              This room is password-protected.
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setWrongPassword(false) }}
              onKeyDown={(e) => { if (e.key === "Enter") join() }}
              placeholder="Room password"
              className="h-10 w-full rounded-xl border border-white/[0.07] bg-white/[0.04] px-3 font-sans text-[13px] text-[#f0f0f0] placeholder:text-[#444] outline-none focus:border-[#22c55e]/30"
            />
            {wrongPassword && <p className="text-[12px] text-red-400">Incorrect password.</p>}
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}

        <button
          onClick={join}
          disabled={joining || (!!user && requiresPassword && !password)}
          className="mt-5 flex h-10 w-full items-center justify-center rounded-xl bg-[#22c55e] font-sans text-[13px] font-semibold text-[#0a0a0a] transition-colors hover:bg-[#26d066] disabled:opacity-50"
        >
          {joining ? "Joining…" : user ? "Join room" : "Log in to join"}
        </button>

        {user && (
          <p className="mt-3 text-center font-sans text-[11px] text-[#444]">
            Joining as <span className="text-[#666]">{user.name}</span>
          </p>
        )}
      </div>
    </div>
  )
}
