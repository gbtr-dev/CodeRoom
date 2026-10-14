"use client"

import type React from "react"
import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useAuth } from "@/components/auth-provider"

type View =
  | { kind: "ready" }
  | { kind: "loading" }
  | { kind: "verified"; purpose: "signup" | "change"; email: string }
  | { kind: "expired" }
  | { kind: "taken" }
  | { kind: "invalid" }
  | { kind: "error" }

function StatusIcon({ tone }: { tone: "ok" | "bad" | "wait" | "ready" }) {
  const color = tone === "ok" ? "#4ade80" : tone === "bad" ? "#f87171" : "#a3a3a3"
  return (
    <div
      className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border"
      style={{ borderColor: `${color}40`, background: `${color}14`, color }}
    >
      {tone === "wait" ? (
        <span className="block h-5 w-5 animate-spin rounded-full border-2 border-current/30 border-t-current" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden="true">
          {tone === "ok" ? <path d="M20 6 9 17l-5-5" /> : tone === "ready" ? <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></> : <path d="M18 6 6 18M6 6l12 12" />}
        </svg>
      )}
    </div>
  )
}

function ActionLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-6 flex w-full items-center justify-center rounded-xl bg-[#4ade80] px-5 py-[14px] text-[14px] font-semibold text-[#030712] no-underline transition-all duration-150 hover:bg-[#22c55e] active:scale-[0.98]"
    >
      {children}
    </Link>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070809]" />}>
      <VerifyEmailInner />
    </Suspense>
  )
}

function VerifyEmailInner() {
  const params = useSearchParams()
  // Retain the token only in component memory after removing it from the URL.
  const [token] = useState(() => params.get("token"))
  const { verifyEmail, logout } = useAuth()
  const [view, setView] = useState<View>({ kind: token ? "ready" : "invalid" })
  const inFlight = useRef(false)
  const consumed = useRef(false)

  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, "", window.location.pathname)
  }, [token])

  async function confirm() {
    if (!token || inFlight.current || consumed.current) return
    inFlight.current = true
    setView({ kind: "loading" })
    try {
      const result = await verifyEmail(token)
      if (result.status === "verified") {
        consumed.current = true
        setView({ kind: "verified", purpose: result.purpose, email: result.email })
        if (result.purpose === "change") void logout()
      } else {
        consumed.current = result.status !== "error"
        setView({ kind: result.status })
      }
    } catch {
      setView({ kind: "error" })
    } finally {
      inFlight.current = false
    }
  }

  const confirmButton = (label: string, disabled = false) => (
    <button type="button" onClick={confirm} disabled={disabled} aria-busy={disabled}
      className="mt-6 flex w-full cursor-pointer items-center justify-center rounded-xl bg-[#4ade80] px-5 py-[14px] text-[14px] font-semibold text-[#030712] transition-colors hover:bg-[#22c55e] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#4ade80] disabled:cursor-wait disabled:opacity-60">
      {label}
    </button>
  )

  let icon: React.ReactNode = <StatusIcon tone="wait" />
  let title = "Confirming your email…"
  let text: React.ReactNode = "One moment, please."
  let action: React.ReactNode = null

  switch (view.kind) {
    case "ready":
      icon = <StatusIcon tone="ready" />
      title = "Confirm your email"
      text = "Confirm only if you requested this registration or email change. Opening this page does not activate the link."
      action = confirmButton("Confirm email")
      break
    case "loading":
      action = confirmButton("Confirming…", true)
      break
    case "verified":
      icon = <StatusIcon tone="ok" />
      if (view.purpose === "change") {
        title = "Email address updated"
        text = (
          <>Your email is now <strong className="font-semibold text-[#d4d4d4] break-all">{view.email}</strong>. For your security you were signed out everywhere: sign in again with the new address.</>
        )
        action = <ActionLink href="/login">Sign in</ActionLink>
      } else {
        title = "Email confirmed"
        text = <>Your account is active. You can sign in with <strong className="font-semibold text-[#d4d4d4] break-all">{view.email}</strong> now.</>
        action = <ActionLink href="/login">Continue to sign in</ActionLink>
      }
      break
    case "expired":
      icon = <StatusIcon tone="bad" />
      title = "This link has expired"
      text = "Confirmation links are valid for 24 hours. Repeat registration to request a new link, or repeat the email change from Settings."
      action = <ActionLink href="/login">Go to sign in</ActionLink>
      break
    case "taken":
      icon = <StatusIcon tone="bad" />
      title = "Address already in use"
      text = "Another account started using this email address before you confirmed it, so your email was not changed."
      action = <ActionLink href="/settings">Back to settings</ActionLink>
      break
    case "invalid":
      icon = <StatusIcon tone="bad" />
      title = "This link doesn't work"
      text = "It may be incomplete or have been used already. If you already confirmed your email, you can sign in."
      action = <ActionLink href="/login">Go to sign in</ActionLink>
      break
    case "error":
      icon = <StatusIcon tone="bad" />
      title = "Couldn't reach the server"
      text = "Check your connection and try again."
      action = confirmButton("Try again")
      break
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070809] px-6 py-12 text-[#c8c8c8]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute left-[5%] top-[-5%] h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(74,222,128,0.07)_0%,transparent_70%)] blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[0%] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.05)_0%,transparent_70%)] blur-[100px]" />
      </div>

      <div className="relative w-full max-w-[420px]">
        <Link href="/" className="mb-6 flex items-center justify-center gap-2.5 no-underline transition-opacity hover:opacity-75">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[rgba(74,222,128,0.25)] bg-[rgba(74,222,128,0.08)]">
            <span className="font-mono text-[11px] font-bold tracking-[-1px] text-[#4ade80]">{"</>"}</span>
          </div>
          <span className="text-[15px] font-semibold tracking-[-0.4px] text-[#f0f0f0]">Coderoom</span>
        </Link>

        <div
          className="relative overflow-hidden rounded-2xl border border-white/[0.07] px-6 pb-7 pt-8 text-center backdrop-blur-xl"
          style={{ background: "rgba(10,10,10,0.92)", boxShadow: "0 40px 100px rgba(0,0,0,0.7), 0 0 0 0.5px rgba(255,255,255,0.04)" }}
          role="status"
          aria-live="polite"
        >
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[rgba(74,222,128,0.5)] to-transparent" />
          {icon}
          <h1 className="text-[21px] font-bold tracking-[-0.5px] text-[#f0f0f0]">{title}</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[#6b6b6b]">{text}</p>
          {action}
        </div>
      </div>
    </main>
  )
}