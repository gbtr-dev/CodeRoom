"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function RoomError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#070809] font-mono text-center px-6">
      <div className="flex flex-col items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f87171]">Room error</p>
        <h1 className="text-[32px] font-bold tracking-tight text-[#f0f0f0]">Something went wrong</h1>
        <p className="text-[14px] text-[#555]">The room encountered an unexpected error.</p>
      </div>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-xl border border-white/10 px-5 py-2.5 text-[13px] font-medium text-[#c8c8c8] transition-all hover:border-white/20 hover:bg-white/[0.04]"
        >
          Try again
        </button>
        <button
          onClick={() => router.push("/rooms")}
          className="btn-create rounded-xl px-5 py-2.5 text-[13px] font-semibold"
        >
          My rooms
        </button>
      </div>
    </div>
  )
}
