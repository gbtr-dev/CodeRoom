"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"

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
      transform: inView ? "translateY(0)" : "translateY(22px)",
      transition: `opacity 0.6s cubic-bezier(.22,1,.36,1) ${delay}ms, transform 0.6s cubic-bezier(.22,1,.36,1) ${delay}ms`,
    }}>
      {children}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Particle field
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
    function resize() { W = canvas.offsetWidth; H = canvas.offsetHeight; canvas.width = W; canvas.height = H }
    function init() {
      pts.length = 0
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * W, y = Math.random() * H
        pts.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, r: Math.random() * 1.3 + 0.4, a: Math.random() * 0.25 + 0.04, sp: Math.random() * 0.2 + 0.07 })
      }
    }
    function draw() {
      ctx.clearRect(0, 0, W, H)
      const mx = mouse.current.x, my = mouse.current.y
      for (const p of pts) {
        const dx = mx - p.x, dy = my - p.y, d = Math.sqrt(dx * dx + dy * dy)
        if (d < 100) { const f = (1 - d / 100) * 2; p.vx -= (dx / d) * f; p.vy -= (dy / d) * f }
        p.vx += (p.ox - p.x) * 0.04; p.vy += (p.oy - p.y) * 0.04
        p.vx *= 0.88; p.vy *= 0.88; p.x += p.vx; p.y += p.vy
        p.ox += Math.sin(Date.now() * 0.0003 + p.r * 9) * p.sp * 0.05
        p.oy += Math.cos(Date.now() * 0.0002 + p.r * 7) * p.sp * 0.05
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(74,222,128,${p.a})`; ctx.fill()
      }
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, d = Math.sqrt(dx * dx + dy * dy)
        if (d < 80) {
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y)
          ctx.strokeStyle = `rgba(74,222,128,${0.03 * (1 - d / 80)})`; ctx.lineWidth = 0.5; ctx.stroke()
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
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full opacity-40" aria-hidden />
}

/* ──────────────────────────────────────────────
   TiltCard
────────────────────────────────────────────── */

function TiltCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current; if (!el) return
    const r = el.getBoundingClientRect()
    const dx = (e.clientX - r.left - r.width / 2) / (r.width / 2)
    const dy = (e.clientY - r.top - r.height / 2) / (r.height / 2)
    el.style.transform = `perspective(900px) rotateX(${-dy * 2.5}deg) rotateY(${dx * 2.5}deg) translateY(-3px)`
    el.style.boxShadow = `0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(74,222,128,0.1), 0 0 28px rgba(74,222,128,0.05)`
  }, [])
  const onLeave = useCallback(() => {
    const el = ref.current; if (!el) return
    el.style.transform = ""; el.style.boxShadow = ""
  }, [])
  return (
    <div ref={ref} className={`group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-[#0c0c0c] ${className}`}
      style={{ transition: "transform 220ms ease, box-shadow 220ms ease" }}
      onMouseMove={onMove} onMouseLeave={onLeave}>
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ade80]/30 to-transparent" />
      <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: "radial-gradient(ellipse 60% 40% at 50% 0%, rgba(74,222,128,0.03), transparent)" }} />
      {children}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Code block with copy
────────────────────────────────────────────── */

function CodeBlock({ code, lang = "" }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#080808]">
      {lang && (
        <div className="flex items-center justify-between border-b border-white/[0.05] px-4 py-2">
          <span className="font-mono text-[10px] text-[#444]">{lang}</span>
          <button onClick={copy} className="font-sans text-[10px] text-[#555] transition-colors hover:text-[#4ade80]">
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}
      {!lang && (
        <button onClick={copy} className="absolute right-3 top-3 z-10 font-sans text-[10px] text-[#444] opacity-0 transition-all group-hover:opacity-100 hover:text-[#4ade80]">
          {copied ? "Copied!" : "Copy"}
        </button>
      )}
      <pre className="overflow-x-auto p-4 font-mono text-[12px] leading-[1.7] text-[#c8c8c8]">
        <code>{code}</code>
      </pre>
    </div>
  )
}

/* ──────────────────────────────────────────────
   Section label
────────────────────────────────────────────── */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#4ade80]">
      {children}
    </p>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[28px] font-bold tracking-[-0.5px] text-[#c0c0c0] md:text-[32px]">
      {children}
    </h2>
  )
}

/* ──────────────────────────────────────────────
   Pill badge
────────────────────────────────────────────── */

function Pill({ children, dim = false }: { children: React.ReactNode; dim?: boolean }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] ${dim
      ? "border-white/[0.06] text-[#555]"
      : "border-[#4ade80]/20 bg-[#4ade80]/[0.06] text-[#4ade80]"
    }`}>
      {children}
    </span>
  )
}

/* ──────────────────────────────────────────────
   File tree preview
────────────────────────────────────────────── */

type TreeNode = { name: string; kind?: "folder" | "file"; children?: TreeNode[]; dim?: boolean }

function TreeItem({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const isFolder = node.kind === "folder" || node.children
  return (
    <div>
      <div className="flex items-center gap-1.5 py-[2px]" style={{ paddingLeft: depth * 16 }}>
        {isFolder ? (
          <svg className="h-3 w-3 shrink-0 text-[#4ade80]/60" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
          </svg>
        ) : (
          <svg className="h-3 w-3 shrink-0 text-[#555]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          </svg>
        )}
        <span className={`font-mono text-[11px] ${isFolder ? "text-[#4ade80]/80" : node.dim ? "text-[#444]" : "text-[#999]"}`}>
          {node.name}
        </span>
      </div>
      {node.children?.map((c, i) => <TreeItem key={i} node={c} depth={depth + 1} />)}
    </div>
  )
}

/* ──────────────────────────────────────────────
   Data
────────────────────────────────────────────── */

const backendStack = [
  { name: "Fastify v5", role: "HTTP server / REST API", color: "#f97316" },
  { name: "Socket.IO v4", role: "WebSocket – real-time sync", color: "#4ade80" },
  { name: "better-sqlite3", role: "Synchronous SQLite database", color: "#60a5fa" },
  { name: "bcryptjs", role: "Password hashing", color: "#a78bfa" },
  { name: "nanoid", role: "Unique IDs for rooms & files", color: "#facc15" },
  { name: "TypeScript v6", role: "Static typing", color: "#38bdf8" },
]

const frontendStack = [
  { name: "Next.js 16", role: "App Router framework", color: "#e2e8f0" },
  { name: "React 19", role: "UI rendering", color: "#38bdf8" },
  { name: "Tailwind CSS v4", role: "Utility-first styling", color: "#38bdf8" },
  { name: "Socket.IO Client", role: "WebSocket connection", color: "#4ade80" },
  { name: "JSZip", role: "Import/Export workspace ZIP", color: "#facc15" },
  { name: "TypeScript 5.7", role: "Static typing", color: "#38bdf8" },
]

const dbTables = [
  { name: "users", desc: "User accounts", cols: "id, name, email, password_hash, avatar" },
  { name: "sessions", desc: "httpOnly session tokens", cols: "id, user_id, created_at, expires_at" },
  { name: "rooms", desc: "Rooms with optional name & password", cols: "id, name, created_by, password_hash" },
  { name: "room_members", desc: "Membership and role per room", cols: "user_id, room_id, role, last_seen" },
  { name: "files", desc: "Files and folders with content", cols: "id, room_id, name, kind, parent_id, content" },
  { name: "chat_messages", desc: "Chat messages per room", cols: "id, room_id, user_id, user_name, avatar, content, created_at" },
  { name: "invites", desc: "Tokenized invite links with TTL", cols: "token, room_id, created_by, expires_at" },
  { name: "login_attempts", desc: "Brute-force rate limit counters", cols: "email, count, first_attempt_at, locked_until" },
]

const projectTree: TreeNode[] = [
  {
    name: "Coderoom/", kind: "folder", children: [
      {
        name: "backend/", kind: "folder", children: [
          {
            name: "src/", kind: "folder", children: [
              { name: "index.ts", kind: "file" },
              { name: "auth.ts", kind: "file" },
              { name: "socket.ts", kind: "file" },
              { name: "db.ts", kind: "file" },
              { name: "rooms.ts", kind: "file" },
              { name: "executor.ts", kind: "file" },
              { name: "csrf.ts", kind: "file" },
              { name: "rateLimiter.ts", kind: "file" },
            ]
          },
          { name: "coderoom.db", kind: "file", dim: true },
          { name: ".env", kind: "file", dim: true },
        ]
      },
      {
        name: "frontend/", kind: "folder", children: [
          {
            name: "app/", kind: "folder", children: [
              { name: "page.tsx", kind: "file" },
              { name: "features/", kind: "folder" },
              { name: "room/[id]/", kind: "folder" },
              { name: "rooms/", kind: "folder" },
              { name: "settings/", kind: "folder" },
              { name: "docs/", kind: "folder" },
            ]
          },
          {
            name: "components/", kind: "folder", children: [
              { name: "ChatPanel.tsx", kind: "file" },
              { name: "auth-provider.tsx", kind: "file" },
              { name: "room/", kind: "folder" },
            ]
          },
          {
            name: "lib/", kind: "folder", children: [
              { name: "useSocket.ts", kind: "file" },
              { name: "highlight.ts", kind: "file" },
              { name: "textPatch.ts", kind: "file" },
            ]
          },
          { name: ".env.local", kind: "file", dim: true },
        ]
      },
    ]
  }
]

const backendEnv = `# backend/.env

# Required in production (NODE_ENV=production).
# Used to sign/verify session tokens. Must be long, random,
# and never committed to the repository. Generate with:
#   openssl rand -hex 64
JWT_SECRET=your_secret_here

# Runtime mode: 'development' | 'production'
NODE_ENV=development

# Frontend origin — set this to your domain in production
# e.g. CORS_ORIGIN=https://yourdomain.com
# Default if unset: http://localhost:3000
CORS_ORIGIN=`

const setupSteps = [
  {
    n: "01",
    title: "Clone the repository",
    code: `git clone <repo-url>\ncd Coderoom`,
    lang: "bash",
  },
  {
    n: "02",
    title: "Backend",
    code: `cd backend\nnpm install\n\n# Create .env file (see Env Vars section)\n# The DB is created automatically on first run\n\nnpm run dev    # port 3001`,
    lang: "bash",
  },
  {
    n: "03",
    title: "Frontend",
    code: `cd frontend\nnpm install\n\n# Create frontend/.env.local\n# NEXT_PUBLIC_BACKEND_URL=http://localhost:3001\n\nnpm run dev    # port 3000`,
    lang: "bash",
  },
  {
    n: "04",
    title: "Production build",
    code: `# Backend\ncd backend && npm run build && npm start\n\n# Frontend\ncd frontend && npm run build && npm start`,
    lang: "bash",
  },
]

const features = [
  { icon: "⚡", label: "Collaborative editor", desc: "Sync via diff/patch — only sends the changed characters, not the whole file" },
  { icon: "👁", label: "Live cursors", desc: "Real-time cursor position and typing indicator for every participant" },
  { icon: "📁", label: "File system", desc: "File/folder tree with drag & drop to move items" },
  { icon: "▶", label: "Code execution", desc: "Run JS (Node) and Python with terminal output" },
  { icon: "🗜", label: "Import / Export ZIP", desc: "Upload or download the entire workspace as a ZIP" },
  { icon: "🔑", label: "Knock system", desc: "Guests knock, the owner approves or denies access" },
  { icon: "🔒", label: "Room password", desc: "bcrypt-protected, required on every access" },
  { icon: "🔗", label: "Invite links", desc: "Tokenized links with configurable TTL: 1h / 24h / 7d" },
  { icon: "🎭", label: "Roles", desc: "Owner · Editor · Viewer with granular permissions" },
  { icon: "💬", label: "In-room chat", desc: "Real-time messages, last 50 persisted in SQLite" },
  { icon: "🖼", label: "Profile avatar", desc: "Upload + canvas-side resize to 192×192 JPEG" },
  { icon: "🔍", label: "File search", desc: "Ctrl+F with highlighted matches and navigation" },
  { icon: "⌨", label: "Shortcuts", desc: "Ctrl+S · Ctrl+/ · Ctrl+D · Ctrl+F" },
  { icon: "🎨", label: "Syntax highlighting", desc: "20+ languages, custom engine with no external deps" },
]

/* ──────────────────────────────────────────────
   Page
────────────────────────────────────────────── */

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState("stack")

  const nav = [
    { id: "stack", label: "Stack" },
    { id: "architecture", label: "Architecture" },
    { id: "database", label: "Database" },
    { id: "env", label: "Env Vars" },
    { id: "setup", label: "Setup" },
    { id: "features", label: "Features" },
  ]

  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
    setActiveSection(id)
  }

  useEffect(() => {
    const ids = nav.map(n => n.id)
    const observers: IntersectionObserver[] = []
    ids.forEach(id => {
      const el = document.getElementById(id)
      if (!el) return
      const obs = new IntersectionObserver(
        ([e]) => { if (e.isIntersecting) setActiveSection(id) },
        { threshold: 0.3 }
      )
      obs.observe(el)
      observers.push(obs)
    })
    return () => observers.forEach(o => o.disconnect())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen bg-[#070809] text-[#c8c8c8] selection:bg-[#4ade80]/20">

      {/* ── Hero ── */}
      <section className="relative overflow-hidden pb-20 pt-32">
        <ParticleField />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#070809]" />

        <div className="relative mx-auto max-w-5xl px-6">
          <FadeIn>
            <Link href="/" className="mb-8 inline-flex items-center gap-2 font-mono text-[11px] text-[#555] transition-colors hover:text-[#4ade80]">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
              </svg>
              Back home
            </Link>
          </FadeIn>

          <FadeIn delay={80}>
            <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4ade80]">Documentation</p>
            <h1 className="text-[44px] font-bold tracking-[-1px] text-[#e0e0e0] md:text-[56px]"
              style={{ background: "linear-gradient(135deg,#e8e8e8 30%,#4ade80 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              How Coderoom is built
            </h1>
            <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#666]">
              Tech stack, architecture, database schema, environment variables, and setup instructions.
            </p>
          </FadeIn>

          {/* quick stats */}
          <FadeIn delay={160}>
            <div className="mt-10 flex flex-wrap gap-3">
              {[
                ["Fastify v5", "backend"],
                ["Next.js 16", "frontend"],
                ["Socket.IO v4", "real-time"],
                ["SQLite", "database"],
                ["TypeScript", "everywhere"],
              ].map(([name, sub]) => (
                <div key={name} className="flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] px-3.5 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#4ade80]" />
                  <span className="font-mono text-[12px] text-[#aaa]">{name}</span>
                  <span className="font-mono text-[10px] text-[#444]">{sub}</span>
                </div>
              ))}
            </div>
          </FadeIn>
        </div>
      </section>

      {/* ── Body layout: sticky nav + content ── */}
      <div className="mx-auto max-w-5xl px-6 pb-32">
        <div className="flex gap-12">

          {/* sticky sidebar nav */}
          <aside className="hidden w-[160px] shrink-0 lg:block">
            <div className="sticky top-8">
              <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.14em] text-[#333]">Sections</p>
              <nav className="flex flex-col gap-1">
                {nav.map(item => (
                  <button
                    key={item.id}
                    onClick={() => scrollTo(item.id)}
                    className={`text-left font-sans text-[12px] transition-all duration-150 py-1 px-2 rounded-md ${
                      activeSection === item.id
                        ? "text-[#4ade80] bg-[#4ade80]/[0.07]"
                        : "text-[#555] hover:text-[#999]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>

              <div className="mt-8 border-t border-white/[0.05] pt-6">
                <Link href="/features" className="block font-sans text-[11px] text-[#444] transition-colors hover:text-[#4ade80]">
                  → Features page
                </Link>
                <Link href="/rooms" className="mt-2 block font-sans text-[11px] text-[#444] transition-colors hover:text-[#4ade80]">
                  → Your rooms
                </Link>
              </div>
            </div>
          </aside>

          {/* main content */}
          <main className="min-w-0 flex-1 space-y-24">

            {/* ── Stack ── */}
            <section id="stack">
              <FadeIn>
                <SectionLabel>01 · Stack</SectionLabel>
                <SectionTitle>Technologies</SectionTitle>
                <p className="mt-3 text-[14px] leading-relaxed text-[#666]">
                  Monorepo with two independent workspaces. Every technical choice prioritizes operational simplicity: no ORM, no containers required, SQLite managed in-process.
                </p>
              </FadeIn>

              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <FadeIn delay={60}>
                  <TiltCard className="h-full p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[14px]">⚙</div>
                      <div>
                        <p className="font-sans text-[13px] font-semibold text-[#ccc]">Backend</p>
                        <p className="font-mono text-[10px] text-[#444]">Node.js · TypeScript</p>

                      </div>
                    </div>
                    <div className="space-y-2.5">
                      {backendStack.map(s => (
                        <div key={s.name} className="flex items-center justify-between">
                          <span className="font-mono text-[12px]" style={{ color: s.color }}>{s.name}</span>
                          <span className="font-sans text-[11px] text-[#555]">{s.role}</span>
                        </div>
                      ))}
                    </div>
                  </TiltCard>
                </FadeIn>

                <FadeIn delay={120}>
                  <TiltCard className="h-full p-5">
                    <div className="mb-4 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-[14px]">🖥</div>
                      <div>
                        <p className="font-sans text-[13px] font-semibold text-[#ccc]">Frontend</p>
                        <p className="font-mono text-[10px] text-[#444]">Next.js · App Router</p>
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      {frontendStack.map(s => (
                        <div key={s.name} className="flex items-center justify-between">
                          <span className="font-mono text-[12px]" style={{ color: s.color }}>{s.name}</span>
                          <span className="font-sans text-[11px] text-[#555]">{s.role}</span>
                        </div>
                      ))}
                    </div>
                  </TiltCard>
                </FadeIn>
              </div>
            </section>

            {/* ── Architecture ── */}
            <section id="architecture">
              <FadeIn>
                <SectionLabel>02 · Architecture</SectionLabel>
                <SectionTitle>Project structure</SectionTitle>
                <p className="mt-3 text-[14px] leading-relaxed text-[#666]">
                  Monorepo with two independent workspaces. The backend exposes REST (auth, profile, invites) and WebSocket (all real-time events). The frontend consumes both.
                </p>
              </FadeIn>

              <FadeIn delay={80}>
                <div className="mt-8 grid gap-4 lg:grid-cols-2">
                  <TiltCard className="p-5">
                    <p className="mb-4 font-mono text-[11px] text-[#4ade80]/70">File tree</p>
                    <div className="overflow-hidden">
                      {projectTree.map((n, i) => <TreeItem key={i} node={n} />)}
                    </div>
                  </TiltCard>

                  <div className="flex flex-col gap-4">
                    {[
                      { file: "socket.ts", desc: "All WebSocket events: join, code sync, cursors, chat, knock, roles, file tree." },
                      { file: "db.ts", desc: "SQLite schema, prepared statements and exported functions. No ORM — direct queries for maximum performance." },
                      { file: "auth.ts", desc: "REST routes for login, signup, sessions, profile, avatar, invites. httpOnly cookies + CSRF protection." },
                      { file: "useSocket.ts", desc: "Frontend hook managing the full Socket.IO lifecycle: connection, events, participant state and chat." },
                      { file: "highlight.ts", desc: "Custom syntax highlighting with no external dependencies — tokenizer for 20+ languages." },
                      { file: "textPatch.ts", desc: "Text diff/patch: sends only the changed characters, not the full file, on every keystroke." },
                    ].map((item, i) => (
                      <FadeIn key={item.file} delay={i * 40}>
                        <div className="rounded-xl border border-white/[0.06] bg-[#0a0a0a] p-3.5 transition-colors hover:border-white/[0.1]">
                          <p className="font-mono text-[12px] text-[#4ade80]/80">{item.file}</p>
                          <p className="mt-1 font-sans text-[12px] leading-relaxed text-[#555]">{item.desc}</p>
                        </div>
                      </FadeIn>
                    ))}
                  </div>
                </div>
              </FadeIn>

              <FadeIn delay={100}>
                <div className="mt-8 rounded-2xl border border-white/[0.07] bg-[#0a0a0a] p-5">
                  <p className="mb-4 font-mono text-[11px] text-[#4ade80]/70">Data flow — joining a room</p>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                    {[
                      { label: "Client", color: "#4ade80" },
                      { arrow: true },
                      { label: "socket.emit('join-room')", color: "#aaa" },
                      { arrow: true },
                      { label: "auth cookie", color: "#facc15" },
                      { arrow: true },
                      { label: "SQLite lookup", color: "#60a5fa" },
                      { arrow: true },
                      { label: "admitUser()", color: "#4ade80" },
                      { arrow: true },
                      { label: "room-state", color: "#aaa" },
                      { arrow: true },
                      { label: "Editor + Chat", color: "#4ade80" },
                    ].map((s, i) =>
                      "arrow" in s
                        ? <span key={i} className="text-[#333]">→</span>
                        : <span key={i} className="rounded-md border border-white/[0.07] px-2 py-0.5" style={{ color: s.color }}>{s.label}</span>
                    )}
                  </div>
                </div>
              </FadeIn>
            </section>

            {/* ── Database ── */}
            <section id="database">
              <FadeIn>
                <SectionLabel>03 · Database</SectionLabel>
                <SectionTitle>SQLite schema</SectionTitle>
                <p className="mt-3 text-[14px] leading-relaxed text-[#666]">
                  The schema is created automatically on startup. No migration commands needed — columns added later are applied via a conditional <code className="font-mono text-[#4ade80]">ALTER TABLE</code>.
                </p>
              </FadeIn>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {dbTables.map((t, i) => (
                  <FadeIn key={t.name} delay={i * 40}>
                    <div className="rounded-xl border border-white/[0.07] bg-[#0c0c0c] p-4 transition-all hover:border-[#4ade80]/15">
                      <div className="flex items-start justify-between gap-3">
                        <p className="font-mono text-[12px] font-semibold text-[#4ade80]/90">{t.name}</p>
                      </div>
                      <p className="mt-1 font-sans text-[11px] text-[#555]">{t.desc}</p>
                      <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-[#3a3a3a]">{t.cols}</p>
                    </div>
                  </FadeIn>
                ))}
              </div>

              <FadeIn delay={80}>
                <div className="mt-6 rounded-xl border border-white/[0.06] bg-[#0a0a0a] p-4">
                  <p className="mb-2 font-mono text-[10px] text-[#444]">Default ports</p>
                  <div className="flex gap-6">
                    <div><span className="font-mono text-[12px] text-[#4ade80]">:3000</span><span className="ml-2 font-sans text-[11px] text-[#555]">Frontend — Next.js</span></div>
                    <div><span className="font-mono text-[12px] text-[#4ade80]">:3001</span><span className="ml-2 font-sans text-[11px] text-[#555]">Backend — Fastify + Socket.IO</span></div>
                  </div>
                </div>
              </FadeIn>
            </section>

            {/* ── Env Vars ── */}
            <section id="env">
              <FadeIn>
                <SectionLabel>04 · Env Vars</SectionLabel>
                <SectionTitle>Environment variables</SectionTitle>
                <p className="mt-3 text-[14px] leading-relaxed text-[#666]">
                  A single <code className="font-mono text-[#4ade80]">.env</code> file lives in the <code className="font-mono text-[#4ade80]">backend/</code> folder. The frontend has no environment file — it connects to the backend at the hardcoded default <code className="font-mono text-[#4ade80]">http://localhost:3001</code>.
                </p>
              </FadeIn>

              <div className="mt-8">
                <FadeIn delay={60}>
                  <p className="mb-2 font-mono text-[11px] text-[#555]">backend/.env</p>
                  <CodeBlock code={backendEnv} lang=".env" />
                </FadeIn>
              </div>

              <FadeIn delay={160}>
                <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4">
                  <span className="mt-0.5 text-[14px]">⚠</span>
                  <div>
                    <p className="font-sans text-[12px] font-semibold text-amber-400/80">Production</p>
                    <p className="mt-0.5 font-sans text-[12px] text-[#555]">
                      Set <code className="font-mono text-[#aaa]">NODE_ENV=production</code> to enable the <code className="font-mono text-[#aaa]">Secure</code> flag on session cookies over HTTPS.
                      Update <code className="font-mono text-[#aaa]">CORS_ORIGIN</code> to your frontend domain.
                    </p>
                  </div>
                </div>
              </FadeIn>
            </section>

            {/* ── Setup ── */}
            <section id="setup">
              <FadeIn>
                <SectionLabel>05 · Setup</SectionLabel>
                <SectionTitle>Installation & setup</SectionTitle>
                <p className="mt-3 text-[14px] leading-relaxed text-[#666]">
                  Prerequisites: Node.js 18+ and Python 3 (for Python code execution inside rooms).
                </p>
              </FadeIn>

              <div className="mt-8 space-y-6">
                {setupSteps.map((step, i) => (
                  <FadeIn key={step.n} delay={i * 60}>
                    <div className="flex gap-4">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-[#0c0c0c]">
                        <span className="font-mono text-[10px] text-[#4ade80]/60">{step.n}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="mb-2 font-sans text-[13px] font-semibold text-[#bbb]">{step.title}</p>
                        <CodeBlock code={step.code} lang={step.lang} />
                      </div>
                    </div>
                  </FadeIn>
                ))}
              </div>

              <FadeIn delay={80}>
                <div className="mt-8 rounded-2xl border border-white/[0.07] bg-[#0c0c0c] p-5">
                  <p className="mb-4 font-mono text-[11px] text-[#4ade80]/70">Troubleshooting</p>
                  <div className="space-y-4">
                    <div>
                      <p className="font-mono text-[12px] text-[#aaa]">EADDRINUSE :3001</p>
                      <p className="mt-1 font-sans text-[11px] text-[#555]">Porta già in uso. Su Windows:</p>
                      <div className="mt-2">
                        <CodeBlock code={`netstat -ano | findstr :3001\ntaskkill /PID <PID> /F`} lang="cmd" />
                      </div>
                    </div>
                    <div className="border-t border-white/[0.05] pt-4">
                      <p className="font-mono text-[12px] text-[#aaa]">Cannot connect to server</p>
                      <p className="mt-1 font-sans text-[11px] text-[#555]">Make sure the backend is running and <code className="font-mono text-[#4ade80]">NEXT_PUBLIC_BACKEND_URL</code> points to the correct port. Also check that <code className="font-mono text-[#4ade80]">node_modules</code> is installed in both folders.</p>
                    </div>
                    <div className="border-t border-white/[0.05] pt-4">
                      <p className="font-mono text-[12px] text-[#aaa]">DB not created</p>
                      <p className="mt-1 font-sans text-[11px] text-[#555]"><code className="font-mono text-[#4ade80]">coderoom.db</code> is generated automatically inside <code className="font-mono text-[#4ade80]">backend/</code> on first run. Make sure the process has write permission on that directory.</p>
                    </div>
                  </div>
                </div>
              </FadeIn>
            </section>

            {/* ── Features ── */}
            <section id="features">
              <FadeIn>
                <SectionLabel>06 · Features</SectionLabel>
                <SectionTitle>What Coderoom does</SectionTitle>
                <p className="mt-3 text-[14px] leading-relaxed text-[#666]">
                  All implemented features. For a more visual overview visit the{" "}
                  <Link href="/features" className="text-[#4ade80]/80 hover:text-[#4ade80] transition-colors">features page</Link>.
                </p>
              </FadeIn>

              <div className="mt-8 grid gap-3 sm:grid-cols-2">
                {features.map((f, i) => (
                  <FadeIn key={f.label} delay={Math.floor(i / 2) * 40}>
                    <div className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-[#0a0a0a] p-3.5 transition-all hover:border-white/[0.1]">
                      <span className="mt-0.5 text-[16px] leading-none">{f.icon}</span>
                      <div>
                        <p className="font-sans text-[12px] font-semibold text-[#bbb]">{f.label}</p>
                        <p className="mt-0.5 font-sans text-[11px] text-[#555]">{f.desc}</p>
                      </div>
                    </div>
                  </FadeIn>
                ))}
              </div>
            </section>

          </main>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.05]">
        <div className="mx-auto flex h-[58px] max-w-5xl items-center justify-between px-6">
          <p className="font-sans text-[11px] text-[#333]">Built by Luca and Alberto</p>
          <Link href="/" className="font-sans text-[11px] text-[#444] transition-colors hover:text-[#4ade80]">
            ← Back home
          </Link>
        </div>
      </footer>

      <style>{`
        @keyframes shimmer {
          0% { background-position: -200% center }
          100% { background-position: 200% center }
        }
      `}</style>
    </div>
  )
}
