"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"

/* ──────────────────────────────────────────────
   Hooks
────────────────────────────────────────────── */

function useInView(threshold = 0.06): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect() } },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, inView]
}

function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [ref, inView] = useInView()
  return (
    <div ref={ref} className={className} style={{
      opacity: inView ? 1 : 0,
      transform: inView ? "translateY(0)" : "translateY(24px)",
      transition: `opacity 0.65s cubic-bezier(.22,1,.36,1) ${delay}ms, transform 0.65s cubic-bezier(.22,1,.36,1) ${delay}ms`,
    }}>
      {children}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Particle canvas (same as homepage)
────────────────────────────────────────────── */

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    const _canvas = canvasRef.current; if (!_canvas) return
    const _ctx = _canvas.getContext("2d"); if (!_ctx) return
    const canvas: HTMLCanvasElement = _canvas
    const ctx: CanvasRenderingContext2D = _ctx
    let raf: number, W = 0, H = 0
    type P = { x: number; y: number; ox: number; oy: number; vx: number; vy: number; r: number; a: number; sp: number }
    const pts: P[] = []

    function resize() {
      W = canvas.offsetWidth; H = canvas.offsetHeight
      canvas.width = W; canvas.height = H
    }
    function init() {
      pts.length = 0
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * W, y = Math.random() * H
        pts.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, r: Math.random() * 1.4 + 0.4, a: Math.random() * 0.3 + 0.05, sp: Math.random() * 0.25 + 0.08 })
      }
    }
    function draw() {
      ctx.clearRect(0, 0, W, H)
      const mx = mouse.current.x, my = mouse.current.y
      for (const p of pts) {
        const dx = mx - p.x, dy = my - p.y, d = Math.sqrt(dx * dx + dy * dy)
        if (d < 110) { const f = (1 - d / 110) * 2.2; p.vx -= (dx / d) * f; p.vy -= (dy / d) * f }
        p.vx += (p.ox - p.x) * 0.04; p.vy += (p.oy - p.y) * 0.04
        p.vx *= 0.88; p.vy *= 0.88; p.x += p.vx; p.y += p.vy
        p.ox += Math.sin(Date.now() * 0.0003 + p.r * 9) * p.sp * 0.05
        p.oy += Math.cos(Date.now() * 0.0002 + p.r * 7) * p.sp * 0.05
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(74,222,128,${p.a})`; ctx.fill()
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.sqrt(dx * dx + dy * dy)
        if (d < 85) {
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y)
          ctx.strokeStyle = `rgba(74,222,128,${0.035 * (1 - d / 85)})`; ctx.lineWidth = 0.5; ctx.stroke()
        }
      }
      raf = requestAnimationFrame(draw)
    }
    resize(); init(); draw()
    const onR = () => { resize(); init() }
    window.addEventListener("resize", onR)
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onR) }
  }, [])

  useEffect(() => {
    const onM = (e: MouseEvent) => {
      const r = canvasRef.current?.getBoundingClientRect()
      if (r) mouse.current = { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onL = () => { mouse.current = { x: -9999, y: -9999 } }
    window.addEventListener("mousemove", onM); window.addEventListener("mouseleave", onL)
    return () => { window.removeEventListener("mousemove", onM); window.removeEventListener("mouseleave", onL) }
  }, [])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full opacity-50" aria-hidden />
}

/* ──────────────────────────────────────────────
   TiltCard — with glow on hover
────────────────────────────────────────────── */

function TiltCard({ children, className = "", accent = false }: { children: React.ReactNode; className?: string; accent?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2)
    const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2)
    el.style.transform = `perspective(900px) rotateX(${-dy * 2.8}deg) rotateY(${dx * 2.8}deg) translateY(-4px)`
    el.style.boxShadow = `0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(74,222,128,0.12), 0 0 32px rgba(74,222,128,0.06)`
  }, [])
  const onLeave = useCallback(() => {
    const el = ref.current; if (!el) return
    el.style.transform = ""
    el.style.boxShadow = ""
  }, [])
  return (
    <div
      ref={ref}
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0c0c0c] ${className}`}
      style={{ transition: "transform 220ms ease, box-shadow 220ms ease, border-color 220ms ease" }}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      {accent && (
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/40 to-transparent" />
      )}
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(74,222,128,0.04), transparent)" }} />
      {children}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Icon box with glow
────────────────────────────────────────────── */

function IconBox({ children, size = "lg" }: { children: React.ReactNode; size?: "sm" | "lg" }) {
  const base = size === "lg"
    ? "mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.08)] text-[#4ade80] shadow-[0_0_20px_rgba(74,222,128,0.15)]"
    : "mb-3 flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.08)] text-[#4ade80] shadow-[0_0_14px_rgba(74,222,128,0.12)]"
  return <div className={base}>{children}</div>
}

/* ──────────────────────────────────────────────
   Mini-previews
────────────────────────────────────────────── */

function CursorPreview() {
  const [blink, setBlink] = useState(true)
  useEffect(() => { const id = setInterval(() => setBlink(v => !v), 560); return () => clearInterval(id) }, [])
  return (
    <div className="relative mt-5 overflow-hidden rounded-xl border border-white/[0.06] bg-[#080808] p-3 font-mono text-[11px] leading-[20px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {[
        { code: "const room = connect('a3f9x2')", c: "#d4d4d4" },
        { code: "socket.on('code', syncEditor)", c: "#9cdcfe" },
        { code: "emitCursor({ line: 2, col: 14 })", c: "#d4d4d4" },
      ].map((l, i) => (
        <div key={i} className="flex gap-3">
          <span className="w-3 shrink-0 select-none text-right text-[#1e1e1e]">{i + 1}</span>
          <span style={{ color: l.c }}>{l.code}</span>
        </div>
      ))}
      <div className="pointer-events-none absolute" style={{ top: 10, left: 58 + 174 }}>
        <span className="absolute -top-[15px] left-0 whitespace-nowrap rounded bg-[#4ade80] px-1.5 py-px text-[8.5px] font-bold text-[#030712] shadow-[0_0_8px_rgba(74,222,128,0.5)]">Alberto</span>
        <div className="h-[18px] w-0.5 rounded bg-[#4ade80] shadow-[0_0_4px_rgba(74,222,128,0.8)]" style={{ opacity: blink ? 1 : 0.1, transition: "opacity 80ms" }} />
      </div>
      <div className="pointer-events-none absolute" style={{ top: 30, left: 58 + 50 }}>
        <span className="absolute -top-[15px] left-0 whitespace-nowrap rounded bg-[#f97316] px-1.5 py-px text-[8.5px] font-bold text-white shadow-[0_0_8px_rgba(249,115,22,0.5)]">Luca</span>
        <div className="h-[18px] w-0.5 rounded bg-[#f97316] shadow-[0_0_4px_rgba(249,115,22,0.8)]" style={{ opacity: blink ? 0.1 : 1, transition: "opacity 80ms" }} />
      </div>
      <style>{`@keyframes tdot{0%,100%{opacity:.2;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}`}</style>
      <div className="mt-2 flex items-center gap-2 border-t border-white/[0.04] pt-2">
        <div className="flex gap-[3px]">
          {[0, 1, 2].map(i => (
            <span key={i} className="h-1 w-1 rounded-full bg-[#4ade80]"
              style={{ animation: `tdot 1.2s ease-in-out ${i * 0.18}s infinite` }} />
          ))}
        </div>
        <span className="text-[11px] text-[#2d2d2d]">Alberto is typing…</span>
      </div>
    </div>
  )
}

function TerminalPreview() {
  return (
    <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#080808] p-3 font-mono text-[11px] leading-[19px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="mb-2 flex gap-[5px]">
        {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => (
          <span key={i} className="h-[9px] w-[9px] rounded-full" style={{ background: c, boxShadow: `0 0 5px ${c}88` }} />
        ))}
      </div>
      <p className="text-[#2a2a2a]">$ node index.js</p>
      <p className="text-[#c0c0c0]">{"{ rooms: 12, users: 48 }"}</p>
      <p className="text-[#4ade80]" style={{ textShadow: "0 0 8px rgba(74,222,128,0.5)" }}>✓ exit 0 · 94ms</p>
    </div>
  )
}

function FileTreePreview() {
  const files = [
    { indent: 0, icon: "▸", name: "src/", c: "#3a3a3a" },
    { indent: 14, dot: "#eab308", name: "index.ts", c: "#e0e0e0", active: true },
    { indent: 14, dot: "#eab308", name: "utils.ts", c: "#2e2e2e" },
    { indent: 14, dot: "#eab308", name: "types.ts", c: "#2e2e2e" },
    { indent: 0, dot: "#64748b", name: "README.md", c: "#2e2e2e" },
  ] as const
  return (
    <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#080808] p-3 font-mono text-[11px] leading-[20px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {files.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded px-1 py-px"
          style={{ paddingLeft: ((f as any).indent ?? 0) + 4, background: (f as any).active ? "rgba(74,222,128,0.07)" : "transparent" }}>
          {"icon" in f
            ? <span className="text-[#2a2a2a]">{f.icon}</span>
            : <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: f.dot }} />}
          <span style={{ color: f.c }}>{f.name}</span>
        </div>
      ))}
    </div>
  )
}

function CodePreview() {
  return (
    <div className="mt-4 rounded-xl border border-white/[0.06] bg-[#080808] p-3 font-mono text-[11px] leading-[20px] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div><span className="text-[#c586c0]">function</span> <span className="text-[#dcdcaa]">connect</span><span className="text-[#d4d4d4]">{"(id) {"}</span></div>
      <div className="pl-4"><span className="text-[#c586c0]">return</span> <span className="text-[#ce9178]">{"`ws://room/${id}`"}</span></div>
      <div><span className="text-[#d4d4d4]">{"}"}</span></div>
      <div className="mt-0.5"><span className="text-[#3a3a3a]">// auto-detected · TypeScript</span></div>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Page
────────────────────────────────────────────── */

function ChatPreview() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 2200)
    return () => clearInterval(id)
  }, [])

  const messages = [
    { name: "Alberto", color: "#4ade80", side: "left", text: "just pushed the auth fix", avatar: "AL" },
    { name: "Luca", color: "#f97316", side: "right", text: "nice, testing now 🔥", avatar: "LU" },
    { name: "Alberto", color: "#4ade80", side: "left", text: "also check the socket handler", avatar: "AL" },
    { name: "Luca", color: "#f97316", side: "right", text: "on it", avatar: "LU" },
  ]

  const visible = Math.min(messages.length, Math.floor(tick / 1) + 1)

  return (
    <div className="w-full max-w-[320px] overflow-hidden rounded-2xl border border-white/[0.07] bg-[#080808]">
      {/* header */}
      <div className="flex h-10 items-center gap-2 border-b border-white/[0.05] px-4">
        <svg className="h-3.5 w-3.5 text-[#4ade80]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span className="font-mono text-[11px] text-[#555]">Chat</span>
        <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-[#333]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" style={{ boxShadow: "0 0 6px rgba(74,222,128,0.6)" }} />
          2 online
        </span>
      </div>
      {/* messages */}
      <div className="flex flex-col gap-2.5 px-3 py-3 min-h-[180px]">
        {messages.slice(0, visible).map((msg, i) => {
          const isRight = msg.side === "right"
          return (
            <div key={i} className="flex gap-2" style={{
              flexDirection: isRight ? "row-reverse" : "row",
              opacity: i < visible ? 1 : 0,
              transform: i < visible ? "translateY(0)" : "translateY(8px)",
              transition: "opacity 0.35s ease, transform 0.35s ease",
            }}>
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                style={{ background: `${msg.color}18`, border: `1.5px solid ${msg.color}45`, color: msg.color }}>
                {msg.avatar}
              </div>
              <div className={`max-w-[180px] rounded-xl px-2.5 py-1.5 font-mono text-[11px] leading-[1.5] ${isRight ? "rounded-tr-sm bg-[#22c55e]/10 text-[#86efac]" : "rounded-tl-sm bg-white/[0.04] text-[#aaa]"}`}>
                {msg.text}
              </div>
            </div>
          )
        })}
      </div>
      {/* input */}
      <div className="border-t border-white/[0.05] px-3 py-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-1.5">
          <span className="font-mono text-[11px] text-[#2a2a2a]">Message…</span>
          <div className="ml-auto flex h-5 w-5 items-center justify-center rounded-md bg-[#22c55e]/20">
            <svg className="h-2.5 w-2.5 text-[#4ade80]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function FeaturesPage() {
  const { user, ready, logout } = useAuth()
  const router = useRouter()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [heroVisible, setHeroVisible] = useState(false)

  useEffect(() => { const t = setTimeout(() => setHeroVisible(true), 60); return () => clearTimeout(t) }, [])

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    if (dropdownOpen) document.addEventListener("mousedown", onOut)
    return () => document.removeEventListener("mousedown", onOut)
  }, [dropdownOpen])


  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#070809] text-[#c8c8c8]">
      <style>{`
        @keyframes shimmer { 0%{background-position:0% center} 100%{background-position:200% center} }
        .shimmer-text {
          background: linear-gradient(90deg, #e0e0e0 0%, #4ade80 40%, #86efac 55%, #e0e0e0 100%);
          -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
          background-size: 200% auto; animation: shimmer 5s linear infinite;
        }
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
        .pulse-dot { animation: pulse-dot 2s ease-in-out infinite; }
      `}</style>

      {/* ── Fixed background ── */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <ParticleField />
        <div className="absolute -left-60 -top-20 h-[800px] w-[800px] rounded-full bg-[radial-gradient(circle,rgba(74,222,128,0.055)_0%,transparent_65%)] blur-[120px]" />
        <div className="absolute right-[-10%] top-[25%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.03)_0%,transparent_65%)] blur-[120px]" />
        <div className="absolute bottom-[5%] left-[30%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.03)_0%,transparent_65%)] blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.015]"
          style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 0)", backgroundSize: "28px 28px" }} />
      </div>

      {/* ── Navbar ── */}
      <header className="sticky top-0 z-50 flex h-[58px] items-center justify-between border-b border-white/[0.05] bg-[#070809]/80 px-7 backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.1)] shadow-[0_0_14px_rgba(74,222,128,0.18)]">
            <span className="font-mono text-[11px] font-bold leading-none tracking-[-1px] text-[#4ade80]">{"</>"}</span>
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.4px] text-[#f5f5f5]">Coderoom</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[13px] text-[#3a3a3a] no-underline transition-colors hover:text-[#999]">← Home</Link>
          {ready && user ? (
            <div ref={dropdownRef} className="relative">
              <button onClick={() => setDropdownOpen(v => !v)}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-all ${dropdownOpen ? "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.06)]" : "border-white/[0.07] bg-white/[0.03]"}`}>
                <span className="flex h-[26px] w-[26px] items-center justify-center overflow-hidden rounded-full border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.12)] text-[11px] font-bold text-[#4ade80]">
                  {user.avatar ? <img src={user.avatar} alt="" className="h-full w-full rounded-full object-cover" /> : user.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="text-[13px] text-[#d4d4d4]">{user.name}</span>
              </button>
              {dropdownOpen && (
                <div className="absolute right-0 top-10 z-50 w-48 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0f10] shadow-2xl">
                  <div className="border-b border-white/[0.06] px-4 py-3">
                    <p className="truncate text-[13px] font-semibold text-[#e0e0e0]">{user.name}</p>
                    <p className="truncate text-[11px] text-[#555]">{user.email}</p>
                  </div>
                  <div className="p-1">
                    {[{ label: "My rooms", href: "/rooms" }, { label: "Settings", href: "/settings" }].map(item => (
                      <button key={item.href} onClick={() => { setDropdownOpen(false); router.push(item.href) }}
                        className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] text-[#888] transition-colors hover:bg-white/[0.05] hover:text-[#ccc]">{item.label}</button>
                    ))}
                  </div>
                  <div className="border-t border-white/[0.06] p-1">
                    <button onClick={() => { setDropdownOpen(false); logout() }}
                      className="flex w-full rounded-lg px-3 py-2 text-left text-[13px] text-[#888] transition-colors hover:bg-[#f87171]/10 hover:text-[#f87171]">Sign out</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" className="rounded-lg bg-[#4ade80] px-4 py-[7px] text-[13px] font-semibold text-[#030712] no-underline shadow-[0_0_16px_rgba(74,222,128,0.3)] transition-all hover:bg-[#22c55e]">Sign in</Link>
          )}
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pb-14 pt-20 text-center">
        <div style={{ opacity: heroVisible ? 1 : 0, transition: "opacity 0.5s ease 0.05s" }}>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-[5px] text-[12px] font-medium text-[#555]">
            <span className="pulse-dot h-[7px] w-[7px] rounded-full bg-[#4ade80]" />
            All features
          </div>
        </div>
        <h1 className="shimmer-text mb-5 text-[clamp(30px,5.5vw,56px)] font-bold leading-[1.06] tracking-[-2px]"
          style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? "translateY(0)" : "translateY(18px)", transition: "opacity 0.7s cubic-bezier(.22,1,.36,1) 0.1s, transform 0.7s cubic-bezier(.22,1,.36,1) 0.1s" }}>
          Everything inside one room.
        </h1>
        <p className="mx-auto max-w-[480px] text-[15.5px] leading-[1.72] text-[#4a4a4a]"
          style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? "translateY(0)" : "translateY(18px)", transition: "opacity 0.7s cubic-bezier(.22,1,.36,1) 0.18s, transform 0.7s cubic-bezier(.22,1,.36,1) 0.18s" }}>
          Real-time collaboration, chat, role-based access, syntax highlighting, code execution and more — shipped as one platform, no plugins required.
        </p>

        {/* Stats row */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4"
          style={{ opacity: heroVisible ? 1 : 0, transition: "opacity 0.7s ease 0.28s" }}>
          {[
            { n: "20+", label: "languages highlighted" },
            { n: "3", label: "access control layers" },
            { n: "3", label: "permission roles" },
            { n: "∞", label: "files per room" },
          ].map(({ n, label }) => (
            <div key={label} className="flex flex-col items-center gap-0.5">
              <span className="text-[22px] font-bold tracking-[-0.5px] text-[#4ade80]" style={{ textShadow: "0 0 20px rgba(74,222,128,0.4)" }}>{n}</span>
              <span className="text-[11.5px] text-[#333]">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Bento grid ── */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-28">

        {/* Row 1 */}
        <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">

          {/* Real-time collaboration — big */}
          <FadeIn delay={0} className="lg:col-span-2 flex">
            <TiltCard className="w-full p-7" accent>
              <div className="mb-4 flex items-center gap-2">
                <span className="rounded-full border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] px-2.5 py-0.5 text-[11px] font-semibold text-[#4ade80]">Core</span>
              </div>
              <IconBox>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
                </svg>
              </IconBox>
              <h2 className="mb-2 text-[20px] font-semibold text-[#aaa]">Real-time collaboration</h2>
              <p className="mb-4 max-w-md text-[13.5px] leading-[1.7] text-[#666]">Every keystroke synced instantly over Socket.IO. Live cursors show exactly who is editing what — names, colors and a typing indicator included.</p>
              <ul className="mb-1 space-y-2">
                {["Shared code sync — no refresh, no conflicts", "Named cursors with per-user colors", '"Is typing" indicator while a teammate edits', "Live participant list with avatars and roles"].map(s => (
                  <li key={s} className="flex items-center gap-2.5 text-[12.5px] text-[#3a3a3a]">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] text-[#4ade80]">
                      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-2.5 w-2.5"><path d="M2 6l2.5 2.5L10 3.5"/></svg>
                    </span>
                    {s}
                  </li>
                ))}
              </ul>
              <CursorPreview />
            </TiltCard>
          </FadeIn>

          {/* Syntax highlighting */}
          <FadeIn delay={70} className="flex">
            <TiltCard className="w-full p-7">
              <IconBox>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
                </svg>
              </IconBox>
              <h2 className="mb-2 text-[17px] font-semibold text-[#aaa]">Syntax highlighting</h2>
              <p className="mb-1 text-[13px] leading-[1.65] text-[#666]">Custom-built highlighter covering 20+ languages. Auto-detected from the file extension, zero config.</p>
              <CodePreview />
              <div className="mt-4 flex flex-wrap gap-1.5">
                {["JS", "TS", "Python", "Go", "Rust", "Java", "C/C++", "HTML", "CSS", "SQL", "JSON", "MD"].map(lang => (
                  <span key={lang} className="rounded-md border border-white/[0.06] bg-[rgba(74,222,128,0.03)] px-2 py-0.5 font-mono text-[10px] text-[#3a3a3a]">{lang}</span>
                ))}
              </div>
            </TiltCard>
          </FadeIn>
        </div>

        {/* Row 2 */}
        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <FadeIn delay={0} className="flex">
            <TiltCard className="w-full p-6">
              <IconBox>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
              </IconBox>
              <h2 className="mb-1.5 text-[16px] font-semibold text-[#aaa]">Multi-file workspace</h2>
              <p className="mb-1 text-[13px] leading-[1.65] text-[#666]">Full nested file tree shared live. Create, rename, move and delete files and folders — all in real time.</p>
              <FileTreePreview />
            </TiltCard>
          </FadeIn>

          <FadeIn delay={60} className="flex">
            <TiltCard className="w-full p-6">
              <IconBox>
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-[#4ade80]">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </IconBox>
              <h2 className="mb-1.5 text-[16px] font-semibold text-[#aaa]">Code execution</h2>
              <p className="mb-1 text-[13px] leading-[1.65] text-[#666]">Run code inside the room. Output streams in real time to every participant through the terminal panel.</p>
              <TerminalPreview />
            </TiltCard>
          </FadeIn>

          <FadeIn delay={120} className="flex">
            <TiltCard className="w-full p-6">
              <IconBox>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </IconBox>
              <h2 className="mb-1.5 text-[16px] font-semibold text-[#aaa]">Import & Export</h2>
              <p className="mb-4 text-[13px] leading-[1.65] text-[#666]">Drop a ZIP to import an entire project. Download your workspace as a ZIP snapshot at any moment.</p>
              <div className="flex flex-col gap-2">
                {[
                  { arrow: "↓", label: "Import ZIP", sub: "Restores full folder structure", c: "#4ade80", glow: "rgba(74,222,128,0.15)" },
                  { arrow: "↑", label: "Export ZIP", sub: "Snapshot at any moment", c: "#94a3b8", glow: "rgba(148,163,184,0.1)" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3 rounded-xl border border-white/[0.05] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/[0.09]">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg font-mono text-[16px]"
                      style={{ color: item.c, textShadow: `0 0 10px ${item.glow}` }}>{item.arrow}</span>
                    <div>
                      <p className="text-[12.5px] font-medium text-[#888]">{item.label}</p>
                      <p className="text-[11px] text-[#4a4a4a]">{item.sub}</p>
                    </div>
                  </div>
                ))}
              </div>
            </TiltCard>
          </FadeIn>
        </div>

        {/* Row 3: Access control + Roles */}
        <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-5">

          {/* Access control */}
          <FadeIn delay={0} className="lg:col-span-3 flex">
            <TiltCard className="w-full p-7" accent>
              <div className="mb-4">
                <span className="rounded-full border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] px-2.5 py-0.5 text-[11px] font-semibold text-[#4ade80]">Security</span>
              </div>
              <IconBox>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </IconBox>
              <h2 className="mb-2 text-[20px] font-semibold text-[#aaa]">Layered access control</h2>
              <p className="mb-6 text-[13.5px] leading-[1.7] text-[#666]">Three independent layers to decide who gets in. Use one or combine all for maximum control — no trade-off needed.</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  {
                    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>,
                    title: "Knock system",
                    desc: "Visitors knock — the owner approves or denies in real time without leaving the room.",
                    tag: "Default",
                  },
                  {
                    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>,
                    title: "Invite links",
                    desc: "Time-limited links (1h / 24h / 7d). Whoever has one joins without knocking.",
                    tag: "No knock",
                  },
                  {
                    svg: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>,
                    title: "Room password",
                    desc: "Lock with a bcrypt-hashed password. Required at the door, even via invite link.",
                    tag: "Optional",
                  },
                ].map((item, i) => (
                  <div key={i} className="group/ac flex flex-col gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-[rgba(74,222,128,0.1)] hover:bg-[rgba(74,222,128,0.02)]">
                    <div className="flex items-start justify-between">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-[rgba(74,222,128,0.2)] bg-[rgba(74,222,128,0.08)] text-[#4ade80] shadow-[0_0_10px_rgba(74,222,128,0.12)]">{item.svg}</span>
                      <span className="rounded-md border border-white/[0.05] px-1.5 py-0.5 text-[9.5px] text-[#2e2e2e]">{item.tag}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-[#999]">{item.title}</p>
                    <p className="text-[11.5px] leading-[1.55] text-[#555]">{item.desc}</p>
                  </div>
                ))}
              </div>
            </TiltCard>
          </FadeIn>

          {/* Role system */}
          <FadeIn delay={80} className="lg:col-span-2 flex">
            <TiltCard className="w-full p-7">
              <IconBox>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </IconBox>
              <h2 className="mb-2 text-[17px] font-semibold text-[#aaa]">Role-based access</h2>
              <p className="mb-5 text-[13px] leading-[1.65] text-[#666]">Three roles, clear permissions. Owner assigns roles to any participant at any time.</p>
              <div className="mb-4 flex gap-2">
                {[
                  { emoji: "👑", name: "Owner", c: "#fbbf24", glow: "rgba(251,191,36,0.2)" },
                  { emoji: "✏️", name: "Editor", c: "#86efac", glow: "rgba(134,239,172,0.2)" },
                  { emoji: "👁", name: "Viewer", c: "#6b7280", glow: "" },
                ].map(r => (
                  <div key={r.name} className="flex flex-1 flex-col items-center gap-1.5 rounded-xl border border-white/[0.05] bg-white/[0.02] py-3"
                    style={{ boxShadow: r.glow ? `inset 0 -1px 0 ${r.glow}` : undefined }}>
                    <span className="text-[15px]">{r.emoji}</span>
                    <span className="text-[11px] font-medium" style={{ color: r.c }}>{r.name}</span>
                  </div>
                ))}
              </div>
              <div className="overflow-hidden rounded-xl border border-white/[0.06]">
                <table className="w-full text-[11.5px]">
                  <thead>
                    <tr className="border-b border-white/[0.05] bg-white/[0.02]">
                      <th className="px-3 py-2 text-left font-medium text-[#2a2a2a]">Action</th>
                      {["👑", "✏️", "👁"].map(e => <th key={e} className="w-8 py-2 text-center font-medium text-[#2a2a2a]">{e}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Edit code", true, true, false],
                      ["View live", true, true, true],
                      ["Manage room", true, false, false],
                      ["Set password", true, false, false],
                      ["Create invites", true, false, false],
                      ["Assign roles", true, false, false],
                    ].map(([label, ...vals], i) => (
                      <tr key={i} className={i % 2 === 0 ? "" : "bg-white/[0.012]"}>
                        <td className="px-3 py-1.5 text-[#333]">{label as string}</td>
                        {(vals as boolean[]).map((v, j) => (
                          <td key={j} className="py-1.5 text-center">
                            {v
                              ? <span className="text-[#4ade80]" style={{ textShadow: "0 0 8px rgba(74,222,128,0.5)" }}>✓</span>
                              : <span className="text-[#1e1e1e]">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TiltCard>
          </FadeIn>
        </div>

        {/* Row 4: 4 small cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">

          <FadeIn delay={0} className="flex">
            <TiltCard className="w-full p-5">
              <IconBox size="sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
                </svg>
              </IconBox>
              <h3 className="mb-1.5 text-[14.5px] font-semibold text-[#999]">Authentication</h3>
              <p className="mb-3 text-[12.5px] leading-[1.65] text-[#606060]">Email & password with persistent sessions. Update name, email, password or delete your account from settings.</p>
              <div className="flex flex-wrap gap-1">
                {["Register", "Login", "Settings", "Delete account"].map(t => (
                  <span key={t} className="rounded-md border border-white/[0.05] bg-white/[0.02] px-2 py-0.5 text-[10.5px] text-[#2e2e2e]">{t}</span>
                ))}
              </div>
            </TiltCard>
          </FadeIn>

          <FadeIn delay={60} className="flex">
            <TiltCard className="w-full p-5">
              <IconBox size="sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
              </IconBox>
              <h3 className="mb-1.5 text-[14.5px] font-semibold text-[#999]">Profile photo</h3>
              <p className="mb-3 text-[12.5px] leading-[1.65] text-[#606060]">Upload and crop to 192×192 JPEG directly in the browser. Visible on cursors, participant list and knock cards.</p>
              <div className="flex items-center gap-2">
                {[["AL", "#4ade80"], ["LU", "#f97316"], ["GH", "#a855f7"]].map(([init, c]) => (
                  <div key={init} className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-bold"
                    style={{ background: `${c}18`, border: `1.5px solid ${c}45`, color: c, boxShadow: `0 0 10px ${c}20` }}>{init}</div>
                ))}
                <span className="text-[10.5px] text-[#2a2a2a]">live in room</span>
              </div>
            </TiltCard>
          </FadeIn>

          <FadeIn delay={120} className="flex">
            <TiltCard className="w-full p-5">
              <IconBox size="sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
                </svg>
              </IconBox>
              <h3 className="mb-1.5 text-[14.5px] font-semibold text-[#999]">Keyboard shortcuts</h3>
              <p className="mb-3 text-[12.5px] leading-[1.65] text-[#606060]">Edit faster without leaving the keyboard.</p>
              <div className="flex flex-col gap-1.5 font-mono">
                {[["Ctrl+S", "Flush changes"], ["Ctrl+/", "Toggle comment"], ["Ctrl+D", "Duplicate line"], ["Ctrl+F", "Search in file"]].map(([k, d]) => (
                  <div key={k} className="flex items-center justify-between gap-2">
                    <kbd className="rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-[#4a4a4a]">{k}</kbd>
                    <span className="text-right text-[11px] text-[#2a2a2a]">{d}</span>
                  </div>
                ))}
              </div>
            </TiltCard>
          </FadeIn>

          <FadeIn delay={180} className="flex">
            <TiltCard className="w-full p-5">
              <IconBox size="sm">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                </svg>
              </IconBox>
              <h3 className="mb-1.5 text-[14.5px] font-semibold text-[#999]">Search & Rooms</h3>
              <p className="mb-3 text-[12.5px] leading-[1.65] text-[#606060]">In-file search with highlighted matches and keyboard navigation. Manage all rooms from your personal dashboard.</p>
              <div className="flex flex-col gap-1.5">
                {["In-file search with highlights", "Navigate matches with ↑↓", "Create, rename, delete rooms", "Filter rooms by name"].map(t => (
                  <div key={t} className="flex items-center gap-2 text-[11px] text-[#2e2e2e]">
                    <span className="h-px w-2.5 shrink-0 rounded bg-[#4ade80]/25" />{t}
                  </div>
                ))}
              </div>
            </TiltCard>
          </FadeIn>
        </div>

        {/* Row 5: Chat */}
        <div className="mt-3">
          <FadeIn delay={0}>
            <TiltCard className="w-full p-7" accent>
              <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
                {/* Left: description */}
                <div className="flex flex-col justify-center">
                  <div className="mb-4">
                    <span className="rounded-full border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] px-2.5 py-0.5 text-[11px] font-semibold text-[#4ade80]">New</span>
                  </div>
                  <IconBox>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </IconBox>
                  <h2 className="mb-2 text-[20px] font-semibold text-[#aaa]">In-room chat</h2>
                  <p className="mb-5 text-[13.5px] leading-[1.7] text-[#666]">
                    Talk without leaving the editor. Messages are real-time and persist across sessions — the last 50 are loaded when you join. Unread badge when the panel is closed.
                  </p>
                  <div className="flex flex-col gap-2">
                    {[
                      "Real-time delivery via Socket.IO",
                      "Last 50 messages persisted in SQLite",
                      "Grouped messages by sender",
                      "Unread badge when panel is closed",
                    ].map(t => (
                      <div key={t} className="flex items-center gap-2 text-[12px] text-[#4a4a4a]">
                        <span className="h-px w-3 shrink-0 rounded bg-[#4ade80]/30" />{t}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: mini chat preview */}
                <div className="flex items-center justify-center">
                  <ChatPreview />
                </div>
              </div>
            </TiltCard>
          </FadeIn>
        </div>

      </section>

      {/* ── Footer ── */}
      <footer className="relative z-10 flex h-[58px] items-center justify-between border-t border-white/[0.05] px-7 text-[12px] text-[#252525]">
        <span>Built by <span className="text-[#3a3a3a]">Luca and Alberto</span></span>
        <Link href="/" className="text-[#252525] no-underline transition-colors hover:text-[#555]">← Back home</Link>
      </footer>
    </main>
  )
}
