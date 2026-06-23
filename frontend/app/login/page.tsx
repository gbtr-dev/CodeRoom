"use client"

import type React from "react"
import { Suspense, useState, useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/components/auth-provider"

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */
function MailIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 7-10 6L2 7" />
    </svg>
  )
}
function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
    </svg>
  )
}
function EyeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.2A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a18 18 0 0 1-3.2 4.1M6.6 6.6A18 18 0 0 0 2 11s3.5 7 10 7a10.9 10.9 0 0 0 4.1-.8" />
      <path d="m9.5 9.5a3 3 0 0 0 4.2 4.2M2 2l20 20" />
    </svg>
  )
}
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5Z" />
    </svg>
  )
}
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* Animated terminal lines (left panel)                               */
/* ------------------------------------------------------------------ */
const TERMINAL_LINES = [
  { prompt: "$", cmd: "coderoom create", delay: 0 },
  { prompt: "→", cmd: "Room #a3f9 created", delay: 600, accent: true },
  { prompt: "$", cmd: "invite alice@dev.io", delay: 1400 },
  { prompt: "→", cmd: "Invite sent ✓", delay: 2000, accent: true },
  { prompt: "$", cmd: "git commit -m 'live!'", delay: 2900 },
  { prompt: "→", cmd: "3 collaborators online", delay: 3500, accent: true },
]

function TerminalPanel() {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (shown >= TERMINAL_LINES.length) return
    const t = setTimeout(() => setShown((n) => n + 1), TERMINAL_LINES[shown].delay + 120)
    return () => clearTimeout(t)
  }, [shown])

  return (
    <div className="hidden lg:flex flex-col justify-center h-full px-14 select-none" aria-hidden="true">
      <div className="mb-10">
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-block h-2 w-2 rounded-full bg-[#4ade80] shadow-[0_0_8px_rgba(74,222,128,0.7)]" />
          <span className="font-mono text-[11px] text-[#3a3a3a] tracking-widest uppercase">terminal</span>
        </div>
        <h2 className="text-[34px] font-bold tracking-[-1.2px] text-[#f0f0f0] leading-[1.15]">
          Code together,<br />
          <span style={{
            background: "linear-gradient(90deg, #4ade80 0%, #22d3ee 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
          }}>ship faster.</span>
        </h2>
        <p className="mt-3 text-[14px] text-[#444] max-w-[300px] leading-relaxed">
          Real-time collaborative rooms with live execution and instant sharing.
        </p>
      </div>

      <div className="rounded-xl border border-white/[0.06] bg-[#0a0a0a] overflow-hidden" style={{ boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/[0.05] bg-white/[0.02]">
          <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <span className="h-3 w-3 rounded-full bg-[#28c840]" />
          <span className="ml-3 font-mono text-[11px] text-[#333]">coderoom — bash</span>
        </div>
        <div className="p-5 space-y-2 min-h-[180px]">
          {TERMINAL_LINES.slice(0, shown).map((line, i) => (
            <div key={i} className="flex items-baseline gap-2.5 font-mono text-[13px]" style={{ animation: "term-line 0.2s ease both" }}>
              <span className={line.accent ? "text-[#4ade80]" : "text-[#555]"}>{line.prompt}</span>
              <span className={line.accent ? "text-[#a3e6b8]" : "text-[#ccc]"}>{line.cmd}</span>
            </div>
          ))}
          {shown < TERMINAL_LINES.length && (
            <div className="flex items-baseline gap-2.5 font-mono text-[13px]">
              <span className="text-[#555]">$</span>
              <span className="inline-block h-[14px] w-[2px] bg-[#4ade80] animate-[cursor-blink_0.9s_ease_infinite]" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Mouse-tracking glow                                                 */
/* ------------------------------------------------------------------ */
function useMouseGlow() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect()
      el.style.setProperty("--glow-x", `${((e.clientX - rect.left) / rect.width) * 100}%`)
      el.style.setProperty("--glow-y", `${((e.clientY - rect.top) / rect.height) * 100}%`)
    }
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [])
  return ref
}

/* ------------------------------------------------------------------ */
/* Floating label input                                                */
/* ------------------------------------------------------------------ */
function Field({
  icon: Icon,
  label,
  ...props
}: { icon: React.ComponentType<{ className?: string }>; label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false)
  const hasValue = String(props.value ?? "").length > 0
  const lifted = focused || hasValue
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 transition-all duration-200"
      style={{
        background: focused ? "rgba(74,222,128,0.03)" : "rgba(255,255,255,0.025)",
        border: focused ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(255,255,255,0.07)",
        boxShadow: focused ? "0 0 0 3px rgba(74,222,128,0.07)" : "none",
      }}
    >
      <Icon className={`h-[15px] w-[15px] shrink-0 transition-colors duration-200 ${focused ? "text-[#4ade80]" : "text-[#3a3a3a]"}`} />
      <div className="relative flex-1">
        <label
          className="pointer-events-none absolute left-0 font-sans transition-all duration-150"
          style={{
            top: lifted ? "8px" : "50%",
            transform: lifted ? "translateY(0) scale(0.78)" : "translateY(-50%) scale(1)",
            transformOrigin: "left center",
            color: focused ? "rgba(74,222,128,0.8)" : "#3a3a3a",
            fontSize: "14px",
          }}
        >
          {label}
        </label>
        <input
          {...props}
          onFocus={(e) => { setFocused(true); props.onFocus?.(e) }}
          onBlur={(e) => { setFocused(false); props.onBlur?.(e) }}
          className="w-full border-none bg-transparent pt-5 pb-2 font-sans text-[14px] text-[#e8e8e8] outline-none"
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Password field                                                      */
/* ------------------------------------------------------------------ */
function PasswordField({ value, onChange, showPw, onToggleShow, autoComplete }: {
  value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  showPw: boolean; onToggleShow: () => void; autoComplete: string
}) {
  const [focused, setFocused] = useState(false)
  const lifted = focused || value.length > 0
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 transition-all duration-200"
      style={{
        background: focused ? "rgba(74,222,128,0.03)" : "rgba(255,255,255,0.025)",
        border: focused ? "1px solid rgba(74,222,128,0.4)" : "1px solid rgba(255,255,255,0.07)",
        boxShadow: focused ? "0 0 0 3px rgba(74,222,128,0.07)" : "none",
      }}
    >
      <LockIcon className={`h-[15px] w-[15px] shrink-0 transition-colors duration-200 ${focused ? "text-[#4ade80]" : "text-[#3a3a3a]"}`} />
      <div className="relative flex-1">
        <label
          className="pointer-events-none absolute left-0 font-sans transition-all duration-150"
          style={{
            top: lifted ? "8px" : "50%",
            transform: lifted ? "translateY(0) scale(0.78)" : "translateY(-50%) scale(1)",
            transformOrigin: "left center",
            color: focused ? "rgba(74,222,128,0.8)" : "#3a3a3a",
            fontSize: "14px",
          }}
        >
          Password
        </label>
        <input
          type={showPw ? "text" : "password"} value={value} onChange={onChange}
          aria-label="Password" autoComplete={autoComplete}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          className="w-full border-none bg-transparent pt-5 pb-2 font-sans text-[14px] text-[#e8e8e8] outline-none"
        />
      </div>
      <button type="button" onClick={onToggleShow} aria-label={showPw ? "Hide password" : "Show password"}
        className="shrink-0 cursor-pointer border-none bg-transparent p-0 text-[#333] transition-colors hover:text-[#4ade80]">
        {showPw ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070809]" />}>
      <LoginInner />
    </Suspense>
  )
}

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  const { login, signup } = useAuth()

  const redirect = params.get("redirect") || "/"
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [visible, setVisible] = useState(false)
  // slide direction: "left" = going to signup, "right" = going to login
  const [slideDir, setSlideDir] = useState<"left" | "right">("left")
  const [animating, setAnimating] = useState(false)
  const [displayMode, setDisplayMode] = useState<"login" | "signup">("login")
  const glowRef = useMouseGlow()

  useEffect(() => { const t = setTimeout(() => setVisible(true), 40); return () => clearTimeout(t) }, [])

  function switchMode(m: "login" | "signup") {
    if (m === mode || animating) return
    const dir = m === "signup" ? "left" : "right"
    setSlideDir(dir)
    setAnimating(true)
    setError(null)
    // after exit anim (~180ms), swap content, then enter
    setTimeout(() => {
      setDisplayMode(m)
      setMode(m)
      setAnimating(false)
    }, 200)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (mode === "signup" && name.trim().length < 2) { setError("Please enter your name."); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Please enter a valid email address."); return }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return }
    setLoading(true)
    try {
      const result = mode === "login" ? await login(email, password) : await signup(name, email, password)
      if (result.error) { setError(result.error); return }
      router.push(redirect)
    } finally {
      setLoading(false)
    }
  }

  // animation classes based on state
  const exitClass = animating
    ? (slideDir === "left" ? "form-exit-left" : "form-exit-right")
    : ""
  const enterClass = !animating
    ? (slideDir === "left" ? "form-enter-left" : "form-enter-right")
    : ""

  return (
    <main className="relative flex min-h-screen overflow-hidden bg-[#070809] text-[#c8c8c8]">
      <style>{`
        @keyframes term-line {
          from { opacity: 0; transform: translateX(-6px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-5px); }
          40% { transform: translateX(5px); }
          60% { transform: translateX(-3px); }
          80% { transform: translateX(3px); }
        }
        /* Slide-out left (going to signup) */
        @keyframes slide-out-left {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(-28px); }
        }
        /* Slide-out right (going to login) */
        @keyframes slide-out-right {
          from { opacity: 1; transform: translateX(0); }
          to   { opacity: 0; transform: translateX(28px); }
        }
        /* Slide-in from right (new content after going left) */
        @keyframes slide-in-from-right {
          from { opacity: 0; transform: translateX(28px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        /* Slide-in from left (new content after going right) */
        @keyframes slide-in-from-left {
          from { opacity: 0; transform: translateX(-28px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        .form-exit-left  { animation: slide-out-left  0.18s cubic-bezier(.4,0,1,1) both; }
        .form-exit-right { animation: slide-out-right 0.18s cubic-bezier(.4,0,1,1) both; }
        .form-enter-left  { animation: slide-in-from-right 0.22s cubic-bezier(0,.6,.4,1) both; }
        .form-enter-right { animation: slide-in-from-left  0.22s cubic-bezier(0,.6,.4,1) both; }
        .error-shake { animation: shake 0.32s ease both; }
      `}</style>

      {/* ambient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="blob-a absolute left-[5%] top-[-5%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(74,222,128,0.07)_0%,transparent_70%)] blur-[100px]" />
        <div className="blob-b absolute bottom-[-10%] right-[0%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.05)_0%,transparent_70%)] blur-[100px]" />
        <div className="absolute inset-0 opacity-[0.018]" style={{
          backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)",
        }} />
      </div>

      {/* Left panel */}
      <div
        className="relative hidden lg:block lg:w-[52%] border-r border-white/[0.04]"
        style={{
          opacity: visible ? 1 : 0,
          transform: visible ? "translateX(0)" : "translateX(-16px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        <div className="absolute top-8 left-10">
          <Link href="/" className="flex items-center gap-2.5 no-underline hover:opacity-75 transition-opacity">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)]">
              <span className="font-mono text-[11px] font-bold text-[#4ade80] tracking-[-1px]">{"</>"}</span>
            </div>
            <span className="text-[15px] font-semibold tracking-[-0.4px] text-[#f0f0f0]">Coderoom</span>
          </Link>
        </div>
        <TerminalPanel />
      </div>

      {/* Right panel */}
      <div className="relative flex flex-1 flex-col">
        {/* mobile logo */}
        <header className="flex lg:hidden h-[58px] items-center border-b border-white/[0.04] px-6">
          <Link href="/" className="flex items-center gap-2.5 no-underline hover:opacity-75 transition-opacity">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)]">
              <span className="font-mono text-[10px] font-bold text-[#4ade80]">{"</>"}</span>
            </div>
            <span className="text-[14px] font-semibold text-[#f0f0f0]">Coderoom</span>
          </Link>
        </header>

        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(20px)",
              transition: "opacity 0.55s cubic-bezier(.22,1,.36,1) 0.1s, transform 0.55s cubic-bezier(.22,1,.36,1) 0.1s",
            }}
            className="w-full max-w-[420px]"
          >
            {/* ── The unified card ── */}
            <div
              ref={glowRef}
              className="relative rounded-2xl border border-white/[0.07] backdrop-blur-xl overflow-hidden"
              style={{
                background: `radial-gradient(circle at var(--glow-x, 50%) var(--glow-y, 0%), rgba(74,222,128,0.04) 0%, transparent 55%), rgba(10,10,10,0.92)`,
                boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.04)",
              }}
            >
              {/* shimmer top line */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(74,222,128,0.5)] to-transparent" />

              {/* ── Tab switcher — inside the card ── */}
              <div className="px-6 pt-6 pb-0">
                <div
                  className="relative flex rounded-xl border border-white/[0.06] bg-white/[0.03] p-1"
                >
                  {/* sliding pill */}
                  <div
                    className="absolute top-1 bottom-1 w-[calc(50%-4px)] rounded-[10px] transition-all duration-300 ease-[cubic-bezier(.34,1.36,.64,1)]"
                    style={{
                      left: mode === "login" ? "4px" : "calc(50%)",
                      background: "rgba(74,222,128,0.12)",
                      boxShadow: "0 0 0 1px rgba(74,222,128,0.22)",
                    }}
                  />
                  {(["login", "signup"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => switchMode(m)}
                      className="relative z-10 flex-1 cursor-pointer rounded-[10px] border-none bg-transparent py-2 text-[13px] font-medium transition-colors duration-200"
                      style={{ color: mode === m ? "#4ade80" : "#3a3a3a" }}
                    >
                      {m === "login" ? "Sign in" : "Sign up"}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Animated form area ── */}
              <div className="overflow-hidden">
                <div className={`px-6 pb-7 pt-6 ${exitClass || enterClass}`}>
                  {/* heading */}
                  <div className="mb-6">
                    <h1 className="text-[21px] font-bold tracking-[-0.5px] text-[#f0f0f0]">
                      {displayMode === "login" ? "Welcome back" : "Create your account"}
                    </h1>
                    <p className="mt-1 text-[13px] text-[#3a3a3a]">
                      {displayMode === "login"
                        ? "Sign in to your Coderoom account."
                        : "Start coding with your team today."}
                    </p>
                  </div>

                  <form onSubmit={submit} className="flex flex-col gap-3">
                    {displayMode === "signup" && (
                      <Field icon={UserIcon} label="Full name" type="text"
                        value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                    )}
                    <Field icon={MailIcon} label="Email" type="email"
                      value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                    <PasswordField
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      showPw={showPw} onToggleShow={() => setShowPw((v) => !v)}
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                    />

                    {error && (
                      <p role="alert" className="error-shake m-0 rounded-xl border border-[rgba(248,113,113,0.25)] bg-[rgba(248,113,113,0.06)] px-4 py-3 text-[13px] text-[#f87171]">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit" disabled={loading}
                      className="btn-ripple relative mt-1 flex cursor-pointer items-center justify-center gap-2 overflow-hidden rounded-xl border-none bg-[#4ade80] px-5 py-[14px] text-[14px] font-semibold text-[#030712] transition-all duration-150 hover:-translate-y-[1px] hover:bg-[#22c55e] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ boxShadow: loading ? "none" : "0 0 24px rgba(74,222,128,0.28), 0 4px 12px rgba(0,0,0,0.4)" }}
                    >
                      {loading ? (
                        <>
                          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-[rgba(3,7,18,0.25)] border-t-[#030712]" />
                          {mode === "login" ? "Signing in…" : "Creating account…"}
                        </>
                      ) : (
                        mode === "login" ? "Sign in" : "Create account"
                      )}
                    </button>
                  </form>

                  {/* divider */}
                  <div className="my-5 flex items-center gap-3 text-[11px] text-[#2e2e2e] uppercase tracking-widest">
                    <span className="h-px flex-1 bg-white/[0.05]" />or<span className="h-px flex-1 bg-white/[0.05]" />
                  </div>

                  <div className="flex gap-2">
                    {[["Google", <GoogleIcon key="g" className="h-4 w-4" />], ["GitHub", <GithubIcon key="gh" className="h-4 w-4" />]].map(([label, icon]) => (
                      <button key={label as string} type="button" disabled title="Coming soon"
                        className="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] py-2.5 text-[13px] text-[#2e2e2e] opacity-35">
                        {icon}{label}
                      </button>
                    ))}
                  </div>

                  <p className="mt-5 text-center text-[13px] text-[#383838]">
                    {mode === "login" ? "No account? " : "Already a member? "}
                    <button type="button" onClick={() => switchMode(mode === "login" ? "signup" : "login")}
                      className="cursor-pointer border-none bg-transparent p-0 text-[13px] font-semibold text-[#4ade80] transition-opacity hover:opacity-75">
                      {mode === "login" ? "Sign up free" : "Sign in"}
                    </button>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}