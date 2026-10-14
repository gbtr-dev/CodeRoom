"use client"

import { useEffect, useRef, useCallback, useState } from "react"

function usePageTransition() {
  const overlayRef = useRef<HTMLDivElement>(null)
  const navigate = useCallback((href: string) => {
    const overlay = overlayRef.current
    if (!overlay) { window.location.href = href; return }
    overlay.style.transition = "opacity 180ms ease"
    overlay.style.opacity = "1"
    overlay.style.pointerEvents = "all"
    setTimeout(() => { window.location.href = href }, 190)
  }, [])
  return { overlayRef, navigate }
}

export default function NotFound() {
  const { overlayRef, navigate } = usePageTransition()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pathname, setPathname] = useState("")

  useEffect(() => {
    setPathname(window.location.pathname)
  }, [])

  // Animated grid of dots in the background
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    let raf: number
    let t = 0

    function resize() {
      if (!canvas) return
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener("resize", resize)

    function draw() {
      if (!canvas || !ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const cols = Math.ceil(canvas.width / 40) + 1
      const rows = Math.ceil(canvas.height / 40) + 1

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * 40
          const y = r * 40
          // Wave pulse outward from centre
          const cx = canvas.width / 2
          const cy = canvas.height / 2
          const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
          const wave = Math.sin(dist / 60 - t * 1.4)
          const alpha = Math.max(0, wave * 0.12 + 0.04)
          ctx.beginPath()
          ctx.arc(x, y, 1, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(74,222,128,${alpha})`
          ctx.fill()
        }
      }
      t += 0.016
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      window.removeEventListener("resize", resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070809] font-mono">

      {/* Page transition overlay */}
      <div
        ref={overlayRef}
        className="page-transition-overlay"
        style={{ opacity: 0, pointerEvents: "none" }}
        aria-hidden="true"
      />

      {/* Animated dot grid */}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />

      {/* Blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="blob-a absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-[#4ade80]/[0.03] blur-[120px]" />
        <div className="blob-b absolute -bottom-20 right-0 h-[400px] w-[400px] rounded-full bg-[#22d3ee]/[0.025] blur-[100px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center">

        {/* Logo */}
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2.5 transition-opacity hover:opacity-70"
          aria-label="Go home"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[rgba(74,222,128,0.1)] ring-1 ring-inset ring-[rgba(74,222,128,0.2)]">
            <span style={{ fontFamily: "monospace", fontSize: "12px", fontWeight: "bold", color: "#4ade80", letterSpacing: "-1px" }}>{"</>"}</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-[#f0f0f0]">Coderoom</span>
        </button>

        {/* 404 */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4ade80]">Error</p>
          <h1 className="text-[96px] font-bold leading-none tracking-[-4px] text-[#f0f0f0] md:text-[128px]">
            404
          </h1>
        </div>

        {/* Terminal block */}
        <div className="w-full max-w-[400px] rounded-2xl border border-white/[0.06] bg-[#0a0a0a]/80 backdrop-blur-sm">
          <div className="flex items-center gap-1.5 border-b border-white/[0.05] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-auto text-[11px] text-[#2a2a2a]">terminal</span>
          </div>
          <div className="space-y-1.5 px-4 py-4 text-left text-[13px] leading-relaxed">
            <p>
              <span className="text-[#4ade80]">$</span>
              <span className="text-[#888]"> GET </span>
              <span className="text-[#ce9178]">{pathname || "/..."}</span>
            </p>
            <p className="text-red-400">{"→ Error: page not found"}</p>
            <p>
              <span className="text-[#4ade80]">$</span>
              <span className="text-[#888]"> exit code </span>
              <span className="text-[#b5cea8]">404</span>
            </p>
            <p className="flex items-center gap-1">
              <span className="text-[#4ade80]">$</span>
              <span className="inline-block h-4 w-2 animate-[cursor-blink_1s_step-end_infinite] bg-[#4ade80]" />
            </p>
          </div>
        </div>

        {/* Message */}
        <p className="max-w-[320px] text-[14px] leading-relaxed text-[#444]">
          This page doesn't exist or was moved. Head back home to keep coding.
        </p>

        {/* CTA */}
        <button
          onClick={() => navigate("/")}
          className="btn-create flex items-center gap-2 rounded-xl px-6 py-3 text-[14px] font-semibold"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          Back to home
        </button>

      </div>
    </div>
  )
}