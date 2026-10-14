"use client"

import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#070809] font-mono">
      <div className="relative z-10 flex flex-col items-center gap-8 px-6 text-center">
        <a href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[rgba(74,222,128,0.1)] ring-1 ring-inset ring-[rgba(74,222,128,0.2)]">
            <span style={{ fontFamily: "monospace", fontSize: "12px", fontWeight: "bold", color: "#4ade80", letterSpacing: "-1px" }}>{"</>"}</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight text-[#f0f0f0]">Coderoom</span>
        </a>

        <div className="flex flex-col items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f87171]">Error</p>
          <h1 className="text-[72px] font-bold leading-none tracking-[-3px] text-[#f0f0f0]">500</h1>
        </div>

        <div className="w-full max-w-[400px] rounded-2xl border border-white/[0.06] bg-[#0a0a0a]/80">
          <div className="flex items-center gap-1.5 border-b border-white/[0.05] px-4 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-auto text-[11px] text-[#2a2a2a]">terminal</span>
          </div>
          <div className="space-y-1.5 px-4 py-4 text-left text-[13px] leading-relaxed">
            <p className="text-[#f87171]">{"→ Unexpected error occurred"}</p>
            {error.digest && (
              <p className="text-[#555]">digest: <span className="text-[#888]">{error.digest}</span></p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={reset}
            className="flex items-center gap-2 rounded-xl border border-white/10 px-5 py-2.5 text-[13px] font-medium text-[#c8c8c8] transition-all hover:border-white/20 hover:bg-white/[0.04]"
          >
            Try again
          </button>
          <a
            href="/"
            className="btn-create flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold"
          >
            Back to home
          </a>
        </div>
      </div>
    </div>
  )
}
