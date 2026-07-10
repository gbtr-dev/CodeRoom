"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:45032"

/* ──────────────────────────────────────────────
   useInView
────────────────────────────────────────────── */

function useInView(threshold = 0.05): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [v, setV] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setV(true); obs.disconnect() } }, { threshold })
    obs.observe(el); return () => obs.disconnect()
  }, [threshold])
  return [ref, v]
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [ref, v] = useInView()
  return (
    <div ref={ref} className={className} style={{
      opacity: v ? 1 : 0,
      transform: v ? "translateY(0)" : "translateY(20px)",
      transition: `opacity 0.55s cubic-bezier(.22,1,.36,1) ${delay}ms, transform 0.55s cubic-bezier(.22,1,.36,1) ${delay}ms`,
    }}>{children}</div>
  )
}

/* ──────────────────────────────────────────────
   Floating-label input
────────────────────────────────────────────── */

function FloatInput({ label, id, danger = false, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; danger?: boolean }) {
  const [focused, setFocused] = useState(false)
  const hasValue = !!props.value
  const lifted = focused || hasValue

  return (
    <div className="relative">
      <input
        id={id}
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e) }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e) }}
        className={`peer h-14 w-full rounded-xl border bg-[#0b0c0d] px-4 pt-5 pb-1 text-[13.5px] text-[#c8c8c8] outline-none transition-all disabled:opacity-40 ${
          danger
            ? "border-[#f87171]/20 placeholder-transparent focus:border-[#f87171]/50 focus:shadow-[0_0_0_3px_rgba(248,113,113,0.06)]"
            : "border-white/[0.07] placeholder-transparent focus:border-[rgba(74,222,128,0.35)] focus:shadow-[0_0_0_3px_rgba(74,222,128,0.05)]"
        } ${props.className ?? ""}`}
        placeholder={label}
      />
      <label
        htmlFor={id}
        className={`pointer-events-none absolute left-4 transition-all duration-200 ${
          lifted ? "top-[8px] text-[10.5px] font-semibold tracking-[0.08em]" : "top-[50%] -translate-y-1/2 text-[13.5px]"
        } ${
          focused
            ? danger ? "text-[#f87171]/70" : "text-[#4ade80]/80"
            : "text-[#3a3a3a]"
        }`}
      >
        {label}
      </label>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Animated save button
────────────────────────────────────────────── */

type BtnState = "idle" | "loading" | "saved"

function SaveButton({ onSave, disabled, label = "Save changes", danger = false }: { onSave: () => Promise<boolean>; disabled: boolean; label?: string; danger?: boolean }) {
  const [state, setState] = useState<BtnState>("idle")

  async function handle() {
    if (state !== "idle" || disabled) return
    setState("loading")
    const ok = await onSave()
    if (ok) {
      setState("saved")
      setTimeout(() => setState("idle"), 2000)
    } else {
      setState("idle")
    }
  }

  const base = "relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-xl text-[13px] font-semibold transition-all duration-200"
  const green = state === "saved"
    ? "bg-[rgba(74,222,128,0.15)] text-[#4ade80] shadow-[0_0_20px_rgba(74,222,128,0.15)]"
    : "bg-[rgba(74,222,128,0.08)] text-[#4ade80] hover:bg-[rgba(74,222,128,0.16)] hover:shadow-[0_0_16px_rgba(74,222,128,0.1)] disabled:opacity-30"
  const red = state === "saved"
    ? "bg-[rgba(248,113,113,0.15)] text-[#f87171]"
    : "bg-[rgba(248,113,113,0.08)] text-[#f87171] hover:bg-[rgba(248,113,113,0.16)] disabled:opacity-30"

  return (
    <button onClick={handle} disabled={state !== "idle" || disabled} className={`${base} ${danger ? red : green}`}>
      {state === "loading" && <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />}
      {state === "saved" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
      {state === "idle" && label}
      {state === "loading" && "Saving…"}
      {state === "saved" && "Saved!"}
    </button>
  )
}

/* ──────────────────────────────────────────────
   Section wrapper
────────────────────────────────────────────── */

function Section({ children, danger = false }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`group relative overflow-hidden rounded-2xl border transition-colors ${
      danger
        ? "border-[#f87171]/15 bg-[#f87171]/[0.02] hover:border-[#f87171]/25"
        : "border-white/[0.06] bg-white/[0.015] hover:border-white/[0.1]"
    }`}>
      <div className={`absolute inset-x-0 top-0 h-px ${danger ? "bg-gradient-to-r from-transparent via-[#f87171]/30 to-transparent" : "bg-gradient-to-r from-transparent via-[#4ade80]/20 to-transparent"}`} />
      <div className="px-6 py-6">{children}</div>
    </div>
  )
}

function SectionHeader({ icon, title, subtitle, danger = false }: { icon: React.ReactNode; title: string; subtitle: string; danger?: boolean }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
        danger
          ? "border-[#f87171]/20 bg-[#f87171]/[0.08] text-[#f87171]"
          : "border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.07)] text-[#4ade80] shadow-[0_0_12px_rgba(74,222,128,0.12)]"
      }`}>
        {icon}
      </div>
      <div>
        <p className="text-[14px] font-semibold text-[#999]">{title}</p>
        <p className="text-[11.5px] text-[#3a3a3a]">{subtitle}</p>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Error line
────────────────────────────────────────────── */

function ErrLine({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <p className="flex items-center gap-1.5 text-[12px] text-[#f87171]">{msg}</p>
}

/* ──────────────────────────────────────────────
   Page
────────────────────────────────────────────── */

export default function SettingsPage() {
  const { user, ready, logout, updateUser } = useAuth()
  const router = useRouter()
  const [heroVisible, setHeroVisible] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Avatar
  const [avatarLoading, setAvatarLoading] = useState(false)
  const [avatarErr, setAvatarErr] = useState<string | null>(null)
  const [avatarDrag, setAvatarDrag] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Name
  const [name, setName] = useState("")
  const [nameErr, setNameErr] = useState<string | null>(null)

  // Email
  const [email, setEmail] = useState("")
  const [emailPassword, setEmailPassword] = useState("")
  const [emailErr, setEmailErr] = useState<string | null>(null)

  // Password
  const [currentPw, setCurrentPw] = useState("")
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [pwErr, setPwErr] = useState<string | null>(null)

  // Delete
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletePw, setDeletePw] = useState("")
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const deletePwRef = useRef<HTMLInputElement>(null)

  useEffect(() => { const t = setTimeout(() => setHeroVisible(true), 60); return () => clearTimeout(t) }, [])
  useEffect(() => { if (ready && !user) router.replace("/login?redirect=/settings") }, [ready, user, router])
  useEffect(() => { if (user) { setName(user.name); setEmail(user.email) } }, [user])
  useEffect(() => { if (deleteOpen) setTimeout(() => deletePwRef.current?.focus(), 60) }, [deleteOpen])
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setDeleteOpen(false); setDropdownOpen(false) } }
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey)
  }, [])
  useEffect(() => {
    function onOut(e: MouseEvent) { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false) }
    if (dropdownOpen) document.addEventListener("mousedown", onOut)
    return () => document.removeEventListener("mousedown", onOut)
  }, [dropdownOpen])

  /* ── image resize ── */
  function resizeImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file)
      img.onload = () => {
        const S = 192; const c = document.createElement("canvas"); c.width = S; c.height = S
        const ctx = c.getContext("2d")!; const sc = Math.max(S / img.width, S / img.height)
        ctx.drawImage(img, (S - img.width * sc) / 2, (S - img.height * sc) / 2, img.width * sc, img.height * sc)
        URL.revokeObjectURL(url); resolve(c.toDataURL("image/jpeg", 0.85))
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("load")) }
      img.src = url
    })
  }

  async function handleAvatarFile(file: File) {
    if (!file.type.startsWith("image/")) { setAvatarErr("Please select an image file"); return }
    setAvatarLoading(true); setAvatarErr(null)
    try {
      const avatar = await resizeImage(file)
      const res = await fetch(`${BACKEND_URL}/auth/me/avatar`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ avatar }) })
      const data = await res.json()
      if (!res.ok) { setAvatarErr(data.error ?? "Upload failed"); return }
      updateUser(data.user)
    } catch { setAvatarErr("Failed to process image") }
    finally { setAvatarLoading(false); if (avatarInputRef.current) avatarInputRef.current.value = "" }
  }

  async function removeAvatar() {
    setAvatarLoading(true); setAvatarErr(null)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me/avatar`, { method: "DELETE", credentials: "include" })
      const data = await res.json()
      if (!res.ok) { setAvatarErr(data.error ?? "Failed to remove avatar"); return }
      updateUser(data.user)
    } catch { setAvatarErr("Cannot connect to server") }
    finally { setAvatarLoading(false) }
  }

  /* ── save handlers (return true=ok, false=err) ── */
  async function saveName(): Promise<boolean> {
    setNameErr(null)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me/name`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ name: name.trim() }) })
      const data = await res.json()
      if (!res.ok) { setNameErr(data.error ?? "Failed to update name"); return false }
      updateUser(data.user); return true
    } catch { setNameErr("Cannot connect to server"); return false }
  }

  async function saveEmail(): Promise<boolean> {
    setEmailErr(null)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me/email`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: email.trim(), currentPassword: emailPassword }) })
      const data = await res.json()
      if (!res.ok) { setEmailErr(data.error ?? "Failed to update email"); return false }
      updateUser(data.user); setEmailPassword(""); return true
    } catch { setEmailErr("Cannot connect to server"); return false }
  }

  async function savePassword(): Promise<boolean> {
    setPwErr(null)
    if (newPw !== confirmPw) { setPwErr("Passwords don't match"); return false }
    if (newPw.length < 6) { setPwErr("Password must be at least 6 characters"); return false }
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me/password`, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }) })
      const data = await res.json()
      if (!res.ok) { setPwErr(data.error ?? "Failed to update password"); return false }
      setCurrentPw(""); setNewPw(""); setConfirmPw(""); return true
    } catch { setPwErr("Cannot connect to server"); return false }
  }

  async function deleteAccount() {
    if (!deletePw) return
    setDeleteLoading(true); setDeleteErr(null)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/me`, { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ password: deletePw }) })
      const data = await res.json()
      if (!res.ok) { setDeleteErr(data.error ?? "Failed to delete account"); return }
      window.location.href = "/"
    } catch { setDeleteErr("Cannot connect to server") }
    finally { setDeleteLoading(false) }
  }

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#070809]">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-[#4ade80]" />
      </div>
    )
  }

  const initials = user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()

  return (
    <div className="relative min-h-screen bg-[#070809] text-[#c8c8c8]">
      <style>{`
        @keyframes fadeup { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
        @keyframes scalein { from{opacity:0;transform:scale(.92)} to{opacity:1;transform:scale(1)} }
        @keyframes shimmer { 0%{background-position:0% center} 100%{background-position:200% center} }
        @keyframes cur-blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes tdot { 0%,100%{opacity:.2;transform:translateY(0)} 50%{opacity:1;transform:translateY(-2px)} }
        .shimmer-hi {
          background: linear-gradient(90deg,#ccc 0%,#4ade80 45%,#ccc 100%);
          -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
          background-size:200% auto;animation:shimmer 4s linear infinite;
        }
      `}</style>

      {/* ambient */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-48 -top-24 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(74,222,128,0.055)_0%,transparent_65%)] blur-[110px]" />
        <div className="absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.03)_0%,transparent_65%)] blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.013]" style={{ backgroundImage: "radial-gradient(circle,#fff 1px,transparent 0)", backgroundSize: "28px 28px" }} />
      </div>

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 flex h-[58px] items-center justify-between border-b border-white/[0.05] bg-[#070809]/80 px-6 backdrop-blur-xl">
        <button onClick={() => router.push("/")} className="flex items-center gap-2.5 transition-opacity hover:opacity-80">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.1)] shadow-[0_0_12px_rgba(74,222,128,0.15)]">
            <span className="font-mono text-[11px] font-bold leading-none tracking-[-1px] text-[#4ade80]">{"</>"}</span>
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.4px] text-[#f0f0f0]">Coderoom</span>
        </button>

        <div className="flex items-center gap-2">
          <button onClick={() => router.push("/rooms")} className="hidden items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-[#3a3a3a] transition-colors hover:bg-white/[0.04] hover:text-[#777] sm:flex">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
            </svg>
            My Rooms
          </button>
          <div ref={dropdownRef} className="relative">
            <button onClick={() => setDropdownOpen(v => !v)}
              className={`flex h-8 w-8 items-center justify-center overflow-hidden rounded-full text-[12px] font-bold ring-2 ring-transparent transition-all hover:ring-[rgba(74,222,128,0.3)] ${dropdownOpen ? "ring-[rgba(74,222,128,0.35)]" : ""} bg-[rgba(74,222,128,0.1)] text-[#4ade80]`}>
              {user.avatar ? <img src={user.avatar} alt="" className="h-full w-full object-cover" /> : initials}
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-10 z-50 w-48 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0f10] shadow-2xl" style={{ animation: "scalein 0.15s ease" }}>
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <p className="truncate text-[13px] font-semibold text-[#d0d0d0]">{user.name}</p>
                  <p className="truncate text-[11px] text-[#444]">{user.email}</p>
                </div>
                <div className="p-1">
                  <button onClick={() => { setDropdownOpen(false); router.push("/rooms") }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-[#666] transition-colors hover:bg-white/[0.05] hover:text-[#aaa]">My Rooms</button>
                  <button onClick={() => { setDropdownOpen(false); logout() }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-[#666] transition-colors hover:bg-[#f87171]/10 hover:text-[#f87171]">Sign out</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <main className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-24 pt-10">
        <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f) }} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">

          {/* ══ LEFT SIDEBAR ══ */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-[78px] lg:self-start"
            style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? "none" : "translateY(16px)", transition: "opacity .6s .06s, transform .6s .06s" }}>

            {/* Profile card */}
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.018]">
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/25 to-transparent" />
              <div className="flex flex-col items-center gap-4 px-6 py-7 text-center">
                {/* Avatar */}
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setAvatarDrag(true) }}
                  onDragLeave={() => setAvatarDrag(false)}
                  onDrop={e => { e.preventDefault(); setAvatarDrag(false); const f = e.dataTransfer.files[0]; if (f) handleAvatarFile(f) }}
                  className="group relative flex h-[88px] w-[88px] items-center justify-center overflow-hidden rounded-[22px] border-2 transition-all duration-300"
                  style={{
                    borderColor: avatarDrag ? "rgba(74,222,128,0.7)" : "rgba(74,222,128,0.25)",
                    boxShadow: avatarDrag ? "0 0 36px rgba(74,222,128,0.3)" : "0 0 24px rgba(74,222,128,0.12)",
                    background: "rgba(74,222,128,0.06)",
                  }}
                >
                  {user.avatar
                    ? <img src={user.avatar} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    : <span className="text-[30px] font-bold text-[#4ade80]">{initials}</span>
                  }
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                    {avatarLoading
                      ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                      : <><svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span className="text-[10px] font-semibold text-white">Change</span></>
                    }
                  </div>
                </button>

                {avatarErr && <p className="text-[11.5px] text-[#f87171]">{avatarErr}</p>}

                <div>
                  <h1 className="shimmer-hi text-[20px] font-bold tracking-[-0.4px]">{user.name}</h1>
                  <p className="mt-0.5 text-[12px] text-[#333]">{user.email}</p>
                </div>

                <span className="rounded-full border border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.06)] px-3 py-1 text-[11px] font-semibold text-[#4ade80]">Free plan</span>

                {user.avatar && (
                  <button onClick={removeAvatar} disabled={avatarLoading}
                    className="-mt-1 text-[11px] text-[#2a2a2a] underline-offset-2 transition-colors hover:text-[#f87171] hover:underline disabled:opacity-40">
                    Remove photo
                  </button>
                )}
              </div>
            </div>

            {/* "How you appear" preview */}
            <div className="relative overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015]">
              <div className="border-b border-white/[0.05] px-4 py-3">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-[#2e2e2e]">How you appear in rooms</p>
              </div>
              <div className="p-3">
                <div className="relative h-[82px] overflow-hidden rounded-xl border border-white/[0.05] bg-[#070809] px-3 py-2.5 font-mono text-[10px] leading-[18px]">
                  {["const room = createRoom('x')", "socket.emit('join', { name })", "cursor.track(position)"].map((line, i) => (
                    <div key={i} className="flex gap-2.5">
                      <span className="w-3 shrink-0 select-none text-right text-[#181818]">{i + 1}</span>
                      <span className="text-[#232323]">{line}</span>
                    </div>
                  ))}
                  <div className="pointer-events-none absolute" style={{ top: 22, left: 50 + 96 }}>
                    <div className="mb-0.5 flex w-fit items-center gap-1 rounded bg-[#4ade80] px-1.5 py-[2px] shadow-[0_0_8px_rgba(74,222,128,0.5)]">
                      {user.avatar && <img src={user.avatar} alt="" className="h-[9px] w-[9px] rounded-full object-cover" />}
                      <span className="text-[8.5px] font-bold leading-none text-[#030712]">{user.name}</span>
                    </div>
                    <div className="h-[16px] w-0.5 rounded bg-[#4ade80] shadow-[0_0_4px_rgba(74,222,128,0.8)]"
                      style={{ animation: "cur-blink 1s step-end infinite" }} />
                  </div>
                  <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-1.5">
                    <div className="flex gap-[3px]">
                      {[0, 1, 2].map(i => (
                        <span key={i} className="h-[4px] w-[4px] rounded-full bg-[#4ade80]"
                          style={{ animation: `tdot 1.2s ease-in-out ${i * 0.18}s infinite` }} />
                      ))}
                    </div>
                    <span className="text-[9.5px] text-[#1e1e1e]">{user.name} is typing…</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick nav */}
            <div className="flex flex-col gap-0.5 overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.015] p-1.5">
              {[
                { label: "My Rooms", sub: "All your coding spaces", href: "/rooms", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>, c: "#4ade80" },
                { label: "Features", sub: "Explore what's possible", href: "/features", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>, c: "#a78bfa" },
                { label: "Docs", sub: "How Coderoom is built", href: "/docs", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>, c: "#60a5fa" },
                { label: "← Home", sub: "Back to landing page", href: "/", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>, c: "#555" },
                { label: "Sign out", sub: "End your session", href: null, icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>, c: "#f87171" },
              ].map(item => (
                <button key={item.label}
                  onClick={() => item.href ? router.push(item.href) : logout()}
                  className="group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all hover:bg-white/[0.04]">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.03]" style={{ color: item.c }}>{item.icon}</span>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium text-[#666]">{item.label}</p>
                    <p className="truncate text-[10.5px] text-[#282828]">{item.sub}</p>
                  </div>
                </button>
              ))}
            </div>

          </aside>

          {/* ══ RIGHT: form sections ══ */}
          <div className="flex flex-col gap-4">

          {/* Display name */}
          <Reveal delay={0}>
            <Section>
              <SectionHeader
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>}
                title="Display name"
                subtitle={`Currently: ${user.name}`}
              />
              <div className="flex flex-col gap-3">
                <FloatInput
                  id="name"
                  label="Your name"
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); setNameErr(null) }}
                  onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") (e.currentTarget as HTMLElement).blur() }}
                  maxLength={60}
                />
                <ErrLine msg={nameErr} />
                <SaveButton
                  onSave={saveName}
                  disabled={!name.trim() || name.trim() === user.name}
                  label="Save name"
                />
              </div>
            </Section>
          </Reveal>

          {/* Email */}
          <Reveal delay={50}>
            <Section>
              <SectionHeader
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>}
                title="Email address"
                subtitle={`Currently: ${user.email}`}
              />
              <div className="flex flex-col gap-3">
                <FloatInput id="email" label="Email address" type="email" value={email} onChange={e => { setEmail(e.target.value); setEmailErr(null) }} />
                <FloatInput id="email-pw" label="Current password" type="password" value={emailPassword}
                  onChange={e => { setEmailPassword(e.target.value); setEmailErr(null) }}
                  onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") (e.currentTarget as HTMLElement).blur() }}
                />
                <ErrLine msg={emailErr} />
                <SaveButton onSave={saveEmail} disabled={!email.trim() || !emailPassword || email.trim() === user.email} label="Save email" />
              </div>
            </Section>
          </Reveal>

          {/* Password */}
          <Reveal delay={100}>
            <Section>
              <SectionHeader
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
                title="Password"
                subtitle="Use a strong password of at least 6 characters"
              />
              <div className="flex flex-col gap-3">
                <FloatInput id="cur-pw" label="Current password" type="password" value={currentPw} onChange={e => { setCurrentPw(e.target.value); setPwErr(null) }} />
                <FloatInput id="new-pw" label="New password" type="password" value={newPw} onChange={e => { setNewPw(e.target.value); setPwErr(null) }} />
                <FloatInput id="conf-pw" label="Confirm new password" type="password" value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setPwErr(null) }}
                  onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") (e.currentTarget as HTMLElement).blur() }}
                />
                {newPw && (
                  <div className="flex gap-1">
                    {[1, 2, 3].map(i => {
                      const score = newPw.length >= 12 ? 3 : newPw.length >= 8 ? 2 : newPw.length >= 6 ? 1 : 0
                      const c = score >= i ? (score === 3 ? "#4ade80" : score === 2 ? "#fbbf24" : "#f87171") : "#1e1e1e"
                      return <div key={i} className="h-1 flex-1 rounded-full transition-colors duration-300" style={{ background: c }} />
                    })}
                  </div>
                )}
                <ErrLine msg={pwErr} />
                <SaveButton onSave={savePassword} disabled={!currentPw || !newPw || !confirmPw} label="Change password" />
              </div>
            </Section>
          </Reveal>

          {/* Danger */}
          <Reveal delay={150}>
            <Section danger>
              <SectionHeader
                icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>}
                title="Danger zone"
                subtitle="Permanent and irreversible actions"
                danger
              />
              <p className="mb-4 text-[13px] leading-[1.65] text-[#444]">
                Deleting your account removes all your rooms and files forever. <span className="text-[#f87171]/60">This cannot be undone.</span>
              </p>
              <button onClick={() => setDeleteOpen(true)}
                className="flex h-10 items-center gap-2 rounded-xl border border-[#f87171]/25 bg-[#f87171]/[0.07] px-5 text-[13px] font-semibold text-[#f87171] transition-all hover:bg-[#f87171]/[0.14] hover:shadow-[0_0_16px_rgba(248,113,113,0.1)]">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
                Delete my account
              </button>
            </Section>
          </Reveal>

          </div>{/* end right panel */}
        </div>{/* end grid */}
      </main>

      {/* ── Footer ── */}
      <footer className="relative z-10 flex h-[58px] items-center justify-between border-t border-white/[0.05] px-7 text-[12px] text-[#252525]">
        <span>Built by <span className="text-[#3a3a3a]">Luca and Alberto</span></span>
        <button onClick={() => router.push("/")} className="text-[#252525] transition-colors hover:text-[#555]">← Back home</button>
      </footer>

      {/* ── Delete modal ── */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => !deleteLoading && setDeleteOpen(false)}>
          <div onClick={e => e.stopPropagation()}
            className="w-full max-w-[360px] overflow-hidden rounded-2xl border border-[#f87171]/20 bg-[#0c0d0e] shadow-2xl"
            style={{ animation: "scalein 0.18s cubic-bezier(.22,1,.36,1)" }}>

            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#f87171]/30 to-transparent" />

            <div className="px-6 pt-6 pb-5">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-[#f87171]/10">
                <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                </svg>
              </div>
              <h2 className="mb-1 text-[15px] font-semibold text-[#d0d0d0]">Delete account</h2>
              <p className="mb-4 text-[13px] leading-relaxed text-[#555]">
                This permanently deletes your account, all rooms and files. Enter your password to confirm.
              </p>

              <FloatInput
                id="del-pw"
                label="Your password"
                type="password"
                value={deletePw}
                onChange={e => { setDeletePw(e.target.value); setDeleteErr(null) }}
                onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") deleteAccount() }}
                disabled={deleteLoading}
                danger
              />
              <ErrLine msg={deleteErr} />
            </div>

            <div className="flex items-center gap-2 border-t border-white/[0.05] px-6 py-4">
              <button onClick={() => setDeleteOpen(false)} disabled={deleteLoading}
                className="flex-1 rounded-xl border border-white/[0.06] py-2.5 text-[13px] text-[#555] transition-colors hover:text-[#888] disabled:opacity-50">
                Cancel
              </button>
              <button onClick={deleteAccount} disabled={deleteLoading || !deletePw}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#f87171]/10 py-2.5 text-[13px] font-semibold text-[#f87171] transition-all hover:bg-[#f87171]/20 disabled:opacity-40">
                {deleteLoading
                  ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#f87171]/30 border-t-[#f87171]" />
                  : "Delete account"
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
