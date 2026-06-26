"use client"

import type React from "react"
import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useAuth } from "@/components/auth-provider"

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */
function roomLabel(id: string) {
  // "room-a3f9x2" → "a3f9x2"
  return id.startsWith("room-") ? id.slice(5) : id
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
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
function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5M21 12H9" />
    </svg>
  )
}
function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* useInView hook                                                       */
/* ------------------------------------------------------------------ */
function useInView(threshold = 0.15): [React.RefObject<HTMLDivElement | null>, boolean] {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect() } },
      { threshold }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [threshold])
  return [ref, inView]
}

/* ------------------------------------------------------------------ */
/* Particle canvas                                                     */
/* ------------------------------------------------------------------ */
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouse = useRef({ x: -9999, y: -9999 })

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    const rawCtx = canvasEl.getContext("2d")
    if (!rawCtx) return
    const ctx = rawCtx as CanvasRenderingContext2D
    const canvas = canvasEl as HTMLCanvasElement
    let raf: number
    let W = 0, H = 0

    const PARTICLE_COUNT = 80
    type Particle = { x: number; y: number; ox: number; oy: number; vx: number; vy: number; r: number; alpha: number; speed: number }
    const particles: Particle[] = []

    function resize() {
      W = canvas.offsetWidth
      H = canvas.offsetHeight
      canvas.width = W
      canvas.height = H
    }

    function init() {
      particles.length = 0
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const x = Math.random() * W
        const y = Math.random() * H
        particles.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, r: Math.random() * 1.5 + 0.4, alpha: Math.random() * 0.35 + 0.05, speed: Math.random() * 0.3 + 0.1 })
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H)
      const mx = mouse.current.x
      const my = mouse.current.y

      for (const p of particles) {
        const dx = mx - p.x
        const dy = my - p.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const RADIUS = 120

        if (dist < RADIUS) {
          const force = (1 - dist / RADIUS) * 2.5
          p.vx -= (dx / dist) * force
          p.vy -= (dy / dist) * force
        }

        // drift back to origin
        p.vx += (p.ox - p.x) * 0.04
        p.vy += (p.oy - p.y) * 0.04
        p.vx *= 0.88
        p.vy *= 0.88
        p.x += p.vx
        p.y += p.vy

        // subtle drift
        p.ox += Math.sin(Date.now() * 0.0003 + p.r * 10) * p.speed * 0.05
        p.oy += Math.cos(Date.now() * 0.0002 + p.r * 7) * p.speed * 0.05

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(74,222,128,${p.alpha})`
        ctx.fill()
      }

      // draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 90) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(74,222,128,${0.04 * (1 - d / 90)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }

    resize()
    init()
    draw()

    const onResize = () => { resize(); init() }
    window.addEventListener("resize", onResize)
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize) }
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
    const onLeave = () => { mouse.current = { x: -9999, y: -9999 } }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseleave", onLeave)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseleave", onLeave) }
  }, [])

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full opacity-60" aria-hidden="true" />
}

/* ------------------------------------------------------------------ */
/* Parallax blobs                                                      */
/* ------------------------------------------------------------------ */
function ParallaxBlobs() {
  const blobA = useRef<HTMLDivElement>(null)
  const blobB = useRef<HTMLDivElement>(null)
  const blobC = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const y = window.scrollY
        if (blobA.current) blobA.current.style.transform = `translateY(${y * 0.18}px)`
        if (blobB.current) blobB.current.style.transform = `translateY(${y * 0.11}px)`
        if (blobC.current) blobC.current.style.transform = `translateY(${y * 0.22}px)`
        ticking = false
      })
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 opacity-[0.025]" style={{
        backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
        backgroundSize: "48px 48px",
        maskImage: "radial-gradient(ellipse 90% 70% at 50% 20%, black 30%, transparent 100%)",
      }} />
      <div ref={blobA} className="blob-a absolute left-[5%] top-0 h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(74,222,128,0.12)_0%,transparent_70%)] blur-[80px]" />
      <div ref={blobB} className="blob-b absolute right-0 top-[20%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.09)_0%,transparent_70%)] blur-[80px]" />
      <div ref={blobC} className="blob-c absolute bottom-[10%] left-[30%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.07)_0%,transparent_70%)] blur-[80px]" />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Fade-in section wrapper                                             */
/* ------------------------------------------------------------------ */
function FadeIn({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const [ref, inView] = useInView(0.12)
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? "translateY(0px)" : "translateY(32px)",
        transition: `opacity 0.65s cubic-bezier(.22,1,.36,1) ${delay}ms, transform 0.65s cubic-bezier(.22,1,.36,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Tilt card wrapper                                                   */
/* ------------------------------------------------------------------ */
function TiltCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = (e.clientX - cx) / (rect.width / 2)
    const dy = (e.clientY - cy) / (rect.height / 2)
    el.style.transform = `perspective(600px) rotateX(${-dy * 5}deg) rotateY(${dx * 5}deg) translateY(-3px)`
  }, [])

  const onLeave = useCallback(() => {
    if (ref.current) ref.current.style.transform = "perspective(600px) rotateX(0deg) rotateY(0deg) translateY(0px)"
  }, [])

  return (
    <div
      ref={ref}
      className={`feature-card tilt-card flex flex-col ${className}`}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{ transition: "transform 200ms ease, border-color 250ms ease, box-shadow 250ms ease" }}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Page transition hook                                                */
/* ------------------------------------------------------------------ */
function usePageTransition() {
  const router = useRouter()
  const overlayRef = useRef<HTMLDivElement>(null)

  const navigate = useCallback((href: string) => {
    const overlay = overlayRef.current
    if (!overlay) { router.push(href); return }

    // fade in overlay
    overlay.style.transition = "opacity 0.22s ease"
    overlay.style.opacity = "1"
    overlay.style.pointerEvents = "all"

    setTimeout(() => router.push(href), 220)
  }, [router])

  return { overlayRef, navigate }
}

/* ------------------------------------------------------------------ */
/* Animated counter                                                    */
/* ------------------------------------------------------------------ */
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [ref, inView] = useInView(0.3)
  const [val, setVal] = useState(0)

  useEffect(() => {
    if (!inView) return
    let start = 0
    const duration = 1200
    const step = (ts: number) => {
      if (!start) start = ts
      const progress = Math.min((ts - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setVal(Math.round(eased * to))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [inView, to])

  return <span ref={ref}>{val}{suffix}</span>
}

/* ------------------------------------------------------------------ */
/* Animated terminal typing preview                                    */
/* ------------------------------------------------------------------ */
const TYPING_LINES = [
  { text: "// Coderoom · collaborative session started", color: "#6a737d", delay: 0 },
  { text: "const room = await connect('room-a3f9x2')", color: "#d4d4d4", delay: 420 },
  { text: "", color: "", delay: 700 },
  { text: "async function loadSessions(roomId) {", color: "#d4d4d4", delay: 900 },
  { text: "  const users = await db.query(", color: "#d4d4d4", delay: 1180 },
  { text: '    "SELECT * FROM users WHERE room = ?"', color: "#ce9178", delay: 1440 },
  { text: "  )", color: "#d4d4d4", delay: 1680 },
  { text: "  return { roomId, users }", color: "#d4d4d4", delay: 1900 },
  { text: "}", color: "#d4d4d4", delay: 2100 },
]

function EditorPreview() {
  const [visibleLines, setVisibleLines] = useState(0)
  const [blink, setBlink] = useState(true)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    TYPING_LINES.forEach((_, i) => {
      const t = setTimeout(() => setVisibleLines(i + 1), TYPING_LINES[i].delay + 300)
      timers.push(t)
    })
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    const id = setInterval(() => setBlink((v) => !v), 600)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="w-full max-w-[800px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[rgba(10,10,10,0.9)] shadow-[0_40px_100px_rgba(0,0,0,0.7),0_0_0_0.5px_rgba(74,222,128,0.08),inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      {/* topbar */}
      <div className="flex items-center justify-between border-b border-white/5 bg-[rgba(15,15,15,0.9)] px-4 py-2.5">
        <div className="flex gap-[7px]">
          {["#ff5f57", "#febc2e", "#28c840"].map((c, i) => (
            <span key={i} className="block h-[11px] w-[11px] rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}55` }} />
          ))}
        </div>
        <div className="flex gap-0.5">
          {["index.js", "utils.js", "README.md"].map((f, i) => (
            <span
              key={f}
              className="rounded-[5px] px-[11px] py-[3px] font-mono text-[11px] transition-all duration-200"
              style={{
                color: i === 0 ? "#e0e0e0" : "#444",
                background: i === 0 ? "rgba(74,222,128,0.08)" : "transparent",
                borderBottom: i === 0 ? "1.5px solid #4ade80" : "none",
              }}
            >{f}</span>
          ))}
        </div>
        <span className="rounded-full border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)] px-[10px] py-[3px] font-mono text-[11px] text-[#4ade80]">
          room-a3f9x2
        </span>
      </div>

      {/* body */}
      <div className="flex h-[230px]">
        {/* sidebar */}
        <div className="w-[140px] shrink-0 border-r border-white/5 bg-[rgba(12,12,12,0.8)] p-3">
          <p className="mb-2.5 text-[9px] uppercase tracking-[0.12em] text-neutral-700">Explorer</p>
          {[
            { name: "src", indent: 0, dot: null, folder: true },
            { name: "index.js", indent: 14, dot: "#eab308", active: true },
            { name: "utils.js", indent: 14, dot: "#eab308" },
            { name: "README.md", indent: 0, dot: "#94a3b8" },
          ].map((f) => (
            <div
              key={f.name}
              className="mb-0.5 flex items-center gap-1.5 rounded font-mono text-[11px] transition-colors duration-150"
              style={{
                color: f.active ? "#e0e0e0" : "#3a3a3a",
                padding: `3px 6px`,
                paddingLeft: 6 + (f.indent || 0),
                background: f.active ? "rgba(74,222,128,0.07)" : "transparent",
              }}
            >
              {f.folder
                ? <span className="text-[9px] text-neutral-600">▸</span>
                : <span className="block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: f.dot || "#333" }} />
              }
              {f.name}
            </div>
          ))}
          <p className="mb-2 mt-[18px] text-[9px] uppercase tracking-[0.12em] text-neutral-700">Online</p>
          <div className="flex gap-[5px]">
            {[["AL", "#4ade80"], ["LU", "#f97316"], ["GH", "#a855f7"]].map(([init, color]) => (
              <div
                key={init}
                className="flex h-[22px] w-[22px] items-center justify-center rounded-full text-[8px] font-bold"
                style={{ background: `${color}25`, border: `1.5px solid ${color}60`, color: color as string }}
              >{init}</div>
            ))}
          </div>
        </div>

        {/* code editor */}
        <div className="relative flex-1 overflow-hidden bg-[rgba(10,10,10,0.5)] py-3 font-mono text-[12.5px] leading-[22px]">
          {TYPING_LINES.slice(0, visibleLines).map((line, i) => (
            <div key={i} className="flex gap-4 whitespace-pre pl-4">
              <span className="w-[18px] shrink-0 select-none text-right text-[#252525]">{i + 1}</span>
              <span style={{ color: line.color || "transparent" }}>{line.text}</span>
            </div>
          ))}
          {visibleLines < TYPING_LINES.length && (
            <div className="flex gap-4 pl-4">
              <span className="w-[18px] shrink-0 text-right text-[#252525]">{visibleLines + 1}</span>
              <span className="block h-[18px] w-0.5 rounded-sm bg-[#4ade80]" style={{ opacity: blink ? 1 : 0, transition: "opacity 100ms" }} />
            </div>
          )}
          {visibleLines >= TYPING_LINES.length && (
            <>
              <div className="pointer-events-none absolute" style={{ top: 10 + 22, left: 64 + 185 }}>
                <span className="absolute -top-[17px] left-0 whitespace-nowrap rounded bg-[#4ade80] px-1.5 py-px font-sans text-[9px] font-semibold text-[#030712]">Alberto</span>
                <span className="block w-0.5 rounded-sm bg-[#4ade80]" style={{ height: 20, opacity: blink ? 1 : 0.25, transition: "opacity 120ms" }} />
              </div>
              <div className="pointer-events-none absolute" style={{ top: 10 + 3 * 22, left: 64 + 62 }}>
                <span className="absolute -top-[17px] left-0 whitespace-nowrap rounded bg-[#f97316] px-1.5 py-px font-sans text-[9px] font-semibold text-white">Luca</span>
                <span className="block w-0.5 rounded-sm bg-[#f97316]" style={{ height: 20, opacity: blink ? 0.25 : 1, transition: "opacity 120ms" }} />
              </div>
            </>
          )}
        </div>

        {/* output panel */}
        <div className="flex w-[220px] shrink-0 flex-col overflow-hidden border-l border-white/5 bg-[rgba(8,8,8,0.8)]">
          <div className="flex items-center justify-between border-b border-white/[0.04] px-3.5 py-2">
            <span className="font-sans text-[11px] text-neutral-600">Terminal</span>
            <div className="flex items-center gap-1.5">
              <span className="block h-1.5 w-1.5 rounded-full bg-[#4ade80] shadow-[0_0_6px_rgba(74,222,128,0.6)]" />
              <span className="rounded border border-white/[0.07] bg-white/[0.04] px-[7px] py-px font-sans text-[10px] text-neutral-600">JS</span>
            </div>
          </div>
          {visibleLines >= TYPING_LINES.length ? (
            <div className="flex flex-col gap-[3px] overflow-hidden px-3.5 py-2.5">
              {[
                { t: "$ node index.js", c: "#444" },
                { t: "{ roomId: 'a3f9x2', n: 3 }", c: "#d4d4d4" },
                { t: "✓ code 0  (118ms)", c: "#4ade80" },
              ].map((l, i) => (
                <p key={i} className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-[11px]" style={{ color: l.c }}>{l.t}</p>
              ))}
            </div>
          ) : (
            <div className="px-3.5 py-2.5">
              <p className="m-0 font-mono text-[11px] text-[#333]">Waiting for run…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Feature icons                                                       */
/* ------------------------------------------------------------------ */
function FeatureIcon({ name }: { name: string }) {
  const icons: Record<string, React.ReactElement> = {
    users: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#4ade80]">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    play: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#4ade80]">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    ),
    folder: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#4ade80]">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    ),
    lock: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#4ade80]">
        <rect x="3" y="11" width="18" height="11" rx="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
    link: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#4ade80]">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    ),
    code: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#4ade80]">
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    "import-export": (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] text-[#4ade80]">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <polyline points="12 15 12 3" />
        <path d="M3 9v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9" />
      </svg>
    ),
  }
  return icons[name] || null
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */
const FEATURES = [
  { icon: "users", title: "Real-time collaboration", desc: "See every cursor and keystroke live. Everyone stays in sync with no conflicts." },
  { icon: "play", title: "Live code execution", desc: "Run  any type of code directly in the room. Output streams to every participant." },
  { icon: "folder", title: "Multi-file explorer", desc: "Create folders, rename, drag and drop. A full project structure shared in real time." },
  { icon: "import-export", title: "Import & Export", desc: "Download your files locally or import projects. Seamlessly transfer code in and out of the room." },
  { icon: "link", title: "Instant invite", desc: "Copy a link and share it. Anyone with the room ID can join in one click." },
  { icon: "code", title: "Syntax highlighting", desc: "Live highlighting for JS, TS, Python, Go, JSON and Markdown. Auto-detected from extension." },
]

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const router = useRouter()
  const { user, ready, logout } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [roomId, setRoomId] = useState("")
  const [roomError, setRoomError] = useState(false)
  const [userRooms, setUserRooms] = useState<{ id: string; name?: string | null; last_seen: number }[]>([])
  const joinRef = useRef<HTMLInputElement>(null)
  const { overlayRef, navigate } = usePageTransition()

  // hero entrance
  const [heroVisible, setHeroVisible] = useState(false)
  useEffect(() => { const t = setTimeout(() => setHeroVisible(true), 60); return () => clearTimeout(t) }, [])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false)
    }
    if (dropdownOpen) document.addEventListener("mousedown", onClickOutside)
    return () => document.removeEventListener("mousedown", onClickOutside)
  }, [dropdownOpen])

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("error=room-not-found")) {
      setRoomError(true)
      setTimeout(() => setRoomError(false), 4000)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"
    fetch(`${BACKEND_URL}/auth/rooms`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.rooms) setUserRooms(d.rooms) })
      .catch(() => {})
  }, [user])

  useEffect(() => {
    if (joinOpen) setTimeout(() => joinRef.current?.focus(), 50)
  }, [joinOpen])

  function generateRoomId() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
    let id = ""
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
    return `room-${id}`
  }

  function requireAuth(next: string) { navigate(`/login?redirect=${encodeURIComponent(next)}`) }

  function createRoom() {
    const target = `/room/${generateRoomId()}?new=1`
    if (!user) return requireAuth(target)
    navigate(target)
  }

  function joinRoom(e: React.FormEvent) {
    e.preventDefault()
    const id = roomId.trim()
    if (!id) return
    const target = `/room/${encodeURIComponent(id)}`
    if (!user) return requireAuth(target)
    navigate(target)
  }

  function timeAgo(ts: number) {
    const diff = Math.floor(Date.now() / 1000) - ts
    if (diff < 60) return "just now"
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden bg-[#070809] text-[#c8c8c8]">

      {/* ── Page transition overlay ── */}
      <div
        ref={overlayRef}
        className="page-transition-overlay"
        style={{ opacity: 0, pointerEvents: "none" }}
        aria-hidden="true"
      />

      {/* ── Background (parallax blobs + particle field) ── */}
      <ParallaxBlobs />
      <div className="pointer-events-none fixed inset-0 z-[1] h-full w-full">
        <ParticleField />
      </div>

      {/* ── Navbar ── */}
      <header
        className="nav-glass sticky top-0 z-50 flex h-[58px] items-center justify-between px-7"
        style={{
          opacity: heroVisible ? 1 : 0,
          transform: heroVisible ? "translateY(0)" : "translateY(-8px)",
          transition: "opacity 0.5s ease, transform 0.5s ease",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.1)] shadow-[0_0_12px_rgba(74,222,128,0.15)]">
            <span className="font-mono text-[11px] font-bold leading-none tracking-[-1px] text-[#4ade80]">{"</>"}</span>
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.4px] text-[#f5f5f5]">Coderoom</span>
        </div>

        <div className="flex items-center gap-2.5">
          <a
            href="https://github.com/gbtr-dev/coderoom"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-[7px] rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-[13px] text-[#777] no-underline transition-all duration-150 hover:border-white/[0.14] hover:text-[#ccc] hover:scale-[1.03] hover:-translate-y-px active:scale-[0.97]"
          >
            <GithubIcon className="h-3.5 w-3.5" /> Star on GitHub
          </a>

          {ready && user ? (
            <div ref={dropdownRef} className="relative">
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 transition-all duration-150 hover:scale-[1.02] ${dropdownOpen ? "border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.06)]" : "border-white/[0.07] bg-white/[0.03]"}`}
                aria-label="User menu"
              >
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.12)] text-[11px] font-bold text-[#4ade80] overflow-hidden">
                  {user.avatar
                    ? <img src={user.avatar} alt="" className="h-full w-full object-cover rounded-full" />
                    : user.name.slice(0, 2).toUpperCase()
                  }
                </span>
                <span className="text-[13px] text-[#d4d4d4]">{user.name}</span>
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0f10] shadow-2xl">
                  <div className="border-b border-white/[0.06] px-4 py-3">
                    <p className="truncate text-[13px] font-semibold text-[#e0e0e0]">{user.name}</p>
                    <p className="truncate text-[11px] text-[#555]">{user.email}</p>
                  </div>
                  <div className="p-1">
                    <button
                      onClick={() => { setDropdownOpen(false); navigate("/rooms") }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[#888] transition-colors hover:bg-white/[0.05] hover:text-[#ccc]"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                      My Rooms
                    </button>
                    <button
                      onClick={() => { setDropdownOpen(false); navigate("/settings") }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[#888] transition-colors hover:bg-white/[0.05] hover:text-[#ccc]"
                    >
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                      Settings
                    </button>
                  </div>
                  <div className="border-t border-white/[0.06] p-1">
                    <button
                      onClick={() => { setDropdownOpen(false); logout() }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[#888] transition-colors hover:bg-[#f87171]/10 hover:text-[#f87171]"
                    >
                      <LogoutIcon className="h-3.5 w-3.5" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-[#4ade80] px-4 py-[7px] text-[13px] font-semibold text-[#030712] no-underline shadow-[0_0_16px_rgba(74,222,128,0.3)] transition-all duration-150 hover:bg-[#22c55e] hover:-translate-y-px hover:scale-[1.03] active:scale-[0.97]"
            >Sign in</Link>
          )}
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative z-10 flex flex-col items-center border-b border-white/5 px-6 pb-24 pt-[88px] text-center">

        {/* badge */}
        <div
          className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-3.5 py-[5px] text-[12px] font-medium text-[#666]"
          style={{
            opacity: heroVisible ? 1 : 0,
            transition: "opacity 0.5s ease 0.05s",
          }}
        >
          <span className="status-dot block h-[7px] w-[7px] shrink-0 rounded-full bg-[#4ade80]" />
          Real-time collaborative editor
        </div>

        {/* headline */}
        <h1
          className="shimmer-text mb-[22px] text-[clamp(40px,7vw,68px)] font-bold leading-[1.05] tracking-[-2.5px]"
          style={{
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.7s cubic-bezier(.22,1,.36,1) 0.1s, transform 0.7s cubic-bezier(.22,1,.36,1) 0.1s",
          }}
        >
          Code together,<br />in real time.
        </h1>

        <p
          className="mb-10 max-w-[520px] text-[17.5px] leading-[1.7] text-[#6a6a6a]"
          style={{
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.7s cubic-bezier(.22,1,.36,1) 0.2s, transform 0.7s cubic-bezier(.22,1,.36,1) 0.2s",
          }}
        >
          Spin up a shared room in seconds. Write code with your team, see every cursor live, and run JS or Python without leaving the browser.
        </p>

        {/* error */}
        {roomError && (
          <div
            className="mb-5 flex w-full max-w-[440px] items-center gap-2 rounded-[10px] border border-[rgba(248,113,113,0.3)] bg-[rgba(248,113,113,0.06)] px-4 py-2.5 text-[13px] text-[#f87171]"
            style={{ animation: "slide-up 0.25s ease both" }}
          >
            Room not found. Check the ID or create a new one.
          </div>
        )}

        {/* CTA */}
        <div
          className="mb-16 flex w-full max-w-[460px] flex-col gap-2.5"
          style={{
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "translateY(0)" : "translateY(20px)",
            transition: "opacity 0.7s cubic-bezier(.22,1,.36,1) 0.28s, transform 0.7s cubic-bezier(.22,1,.36,1) 0.28s",
          }}
        >
          <div className="flex gap-2.5">
            <button
              onClick={createRoom}
              className="btn-create btn-ripple flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-none px-5 py-3.5 text-[15px] font-semibold active:scale-[0.97]"
              style={{ transition: "background 150ms ease, transform 150ms ease, box-shadow 150ms ease" }}
            >
              <PlusIcon className="h-4 w-4" /> Create a Room
            </button>
            <button
              onClick={() => setJoinOpen((v) => !v)}
              className="flex flex-1 cursor-pointer items-center justify-center rounded-xl border border-white/10 px-5 py-3.5 text-[15px] font-medium text-[#c8c8c8] transition-all duration-150 hover:border-white/20 hover:bg-white/[0.04] hover:-translate-y-px active:scale-[0.97]"
              style={{ background: joinOpen ? "rgba(255,255,255,0.04)" : "transparent" }}
            >
              Join a Room
            </button>
          </div>

          {joinOpen && (
            <div
              className="flex items-center gap-2 rounded-xl border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.03)] p-2 font-mono"
              style={{ animation: "slide-up 0.2s ease both" }}
            >
              <span className="pl-2 text-[14px] text-[#4ade80]">$</span>
              <input
                ref={joinRef}
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") joinRoom(e as any) }}
                placeholder="paste-room-id"
                className="flex-1 border-none bg-transparent font-mono text-[14px] text-[#d4d4d4] outline-none placeholder:text-neutral-700"
              />
              <button
                onClick={joinRoom as any}
                className="flex cursor-pointer items-center gap-1.5 rounded-lg border-none bg-[#4ade80] px-3.5 py-[7px] text-[13px] font-semibold text-[#030712] transition-all duration-100 hover:bg-[#22c55e] active:scale-[0.95]"
              >
                Join <ArrowRightIcon className="h-3 w-3" />
              </button>
            </div>
          )}

          {ready && !user && (
            <p className="flex items-center justify-center gap-1.5 text-[12.5px] text-[#555]">
              <LockIcon className="h-3.5 w-3.5" />
              You need an <Link href="/login" className="font-medium text-[#4ade80] no-underline hover:underline">account</Link> to create or join a room.
            </p>
          )}
        </div>

        {/* Editor preview */}
        <div
          className="flex w-full justify-center"
          style={{
            opacity: heroVisible ? 1 : 0,
            transform: heroVisible ? "translateY(0) scale(1)" : "translateY(32px) scale(0.98)",
            transition: "opacity 0.9s cubic-bezier(.22,1,.36,1) 0.38s, transform 0.9s cubic-bezier(.22,1,.36,1) 0.38s",
          }}
        >
          <EditorPreview />
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="relative z-10 mx-auto w-full max-w-[960px] border-b border-white/5 px-6 py-24">
        <FadeIn>
          <div className="mb-12">
            <p className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4ade80]">Features</p>
            <h2 className="mb-3 text-[32px] font-bold tracking-[-0.8px] text-[#f0f0f0]">Everything you need to code together</h2>
            <p className="max-w-[480px] text-[15px] text-[#6a6a6a]">Built for developer teams who want to collaborate without friction.</p>
          </div>
        </FadeIn>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <FadeIn key={f.title} delay={i * 60} className="h-full">
              <TiltCard className="h-full rounded-2xl p-6">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[11px] border border-[rgba(74,222,128,0.15)] bg-[rgba(74,222,128,0.07)] transition-all duration-300 group-hover:border-[rgba(74,222,128,0.35)] group-hover:bg-[rgba(74,222,128,0.14)]">
                  <FeatureIcon name={f.icon} />
                </div>
                <p className="mb-2 text-[14.5px] font-semibold text-[#e0e0e0]">{f.title}</p>
                <p className="text-[13.5px] leading-[1.6] text-[#6a6a6a]">{f.desc}</p>
              </TiltCard>
            </FadeIn>
          ))}
        </div>
      </section>

      {/* ── MY ROOMS ── */}
      {ready && user && (
        <section className="relative z-10 mx-auto w-full max-w-[960px] border-b border-white/5 px-6 py-24">
          <FadeIn>
            <div className="mb-10 flex items-end justify-between gap-4">
              <div>
                <p className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#4ade80]">Your rooms</p>
                <h2 className="text-[32px] font-bold tracking-[-0.8px] text-[#f0f0f0]">Pick up where you left off</h2>
              </div>
              <button
                onClick={() => navigate("/rooms")}
                className="mb-1 flex shrink-0 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3.5 py-2 text-[13px] text-[#666] transition-all duration-150 hover:border-[rgba(74,222,128,0.2)] hover:text-[#4ade80]"
              >
                View all
                {userRooms.length > 4 && (
                  <span className="rounded-full bg-[rgba(74,222,128,0.1)] px-1.5 py-px text-[11px] font-semibold text-[#4ade80]">
                    {userRooms.length}
                  </span>
                )}
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
              </button>
            </div>
          </FadeIn>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))" }}>
            {userRooms.slice(0, 4).map((r, i) => (
              <FadeIn key={r.id} delay={i * 50}>
                <div className="room-card flex flex-col gap-3 rounded-2xl p-[24.5px]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5 overflow-hidden">
                      <p className={`truncate text-[13px] font-medium ${r.name ? "font-sans text-[#e0e0e0]" : "font-mono text-[#e0e0e0]"}`}>
                        {r.name || roomLabel(r.id)}
                      </p>
                      <p className="truncate font-mono text-[11px] text-[#3a3a3a]" style={!r.name ? { visibility: "hidden" } : undefined}>
                        {r.name ? r.id : "\u00A0"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-[#444]">{timeAgo(r.last_seen)}</span>
                  </div>
                  <button
                    onClick={() => navigate(`/room/${r.id}`)}
                    className="mt-auto flex cursor-pointer items-center gap-[5px] border-none bg-none p-0 text-[12.5px] font-semibold text-[#4ade80] transition-all duration-150 hover:gap-2"
                  >
                    Open room <ArrowRightIcon className="h-3 w-3" />
                  </button>
                </div>
              </FadeIn>
            ))}
            <FadeIn delay={userRooms.length * 50}>
              <div
                onClick={createRoom}
                className="room-card flex cursor-pointer flex-col items-center justify-between gap-3 rounded-2xl border border-dashed border-white/[0.06] p-[27.5px] transition-all duration-200 hover:border-[rgba(74,222,128,0.2)]"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(74,222,128,0.12)] bg-[rgba(74,222,128,0.06)] transition-all duration-200 group-hover:scale-110">
                  <PlusIcon className="h-4 w-4 text-[#4ade80]" />
                </div>
                <p className="text-[13px] text-[#3a3a3a]">New room</p>
              </div>
            </FadeIn>
          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <FadeIn className="relative z-10 mt-auto">
        <footer className="flex h-[58px] items-center justify-between border-t border-white/5 px-7 text-[12px] text-[#333]">
          <span>Built by <span className="text-[#555]">Luca</span></span>

        </footer>
      </FadeIn>
    </main>
  )
}