"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type User = {
  id: string
  name: string
  email: string
  avatar?: string | null
}

/** Neutral signup acknowledgement; does not disclose account or delivery status. */
export type PendingVerification = {
  email: string
  resendToken: string
}

export type VerifyEmailResult =
  | { status: "verified"; purpose: "signup" | "change"; email: string }
  | { status: "expired" | "invalid" | "taken" | "error" }

type AuthContextValue = {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<{ error?: string; code?: string }>
  signup: (name: string, email: string, password: string) => Promise<{ error?: string; pending?: PendingVerification }>
  logout: () => void
  updateUser: (u: User) => void
  verifyEmail: (token: string) => Promise<VerifyEmailResult>
  resendVerification: (email: string, resendToken?: string) => Promise<{ error?: string }>
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:45032"

export function sanitizeAvatar(avatar: string | null | undefined): string | null {
  return avatar?.startsWith('data:image/') ? avatar : null
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)

  /* On mount: ask the backend who we are. The session lives in an httpOnly
     cookie that the browser attaches automatically (credentials: 'include'),
     so there's no token to read from localStorage here anymore. */
  useEffect(() => {
    fetch(`${BACKEND_URL}/auth/me`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setUser({ ...data.user, avatar: sanitizeAvatar(data.user.avatar) })
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  async function login(email: string, password: string): Promise<{ error?: string; code?: string }> {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? "Login failed", code: data.code }
      setUser({ ...data.user, avatar: sanitizeAvatar(data.user.avatar) })
      return {}
    } catch {
      return { error: "Cannot connect to server" }
    }
  }

  async function signup(name: string, email: string, password: string): Promise<{ error?: string; pending?: PendingVerification }> {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? "Signup failed" }
      // The account must be confirmed by email before it can be used: there is no session yet
      if (data.status === "verification_required") {
        return { pending: { email: data.email, resendToken: data.resendToken } }
      }
      // Older backend (no email confirmation): the user is signed in right away
      setUser({ ...data.user, avatar: sanitizeAvatar(data.user.avatar) })
      return {}
    } catch {
      return { error: "Cannot connect to server" }
    }
  }

  async function logout() {
    try {
      await fetch(`${BACKEND_URL}/auth/logout`, {
        method: "POST",
        credentials: "include",
      })
    } catch {
      // Ignore errors on logout
    } finally {
      setUser(null)
    }
  }

  function updateUser(u: User) {
    setUser(u)
  }

  async function verifyEmail(token: string): Promise<VerifyEmailResult> {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.status === "verified") {
        return { status: "verified", purpose: data.purpose === "change" ? "change" : "signup", email: String(data.email ?? "") }
      }
      if (data.code === "token_expired") return { status: "expired" }
      if (data.code === "email_taken") return { status: "taken" }
      if (data.code === "invalid_token") return { status: "invalid" }
      return { status: "error" }
    } catch {
      return { status: "error" }
    }
  }

  async function resendVerification(email: string, resendToken?: string): Promise<{ error?: string }> {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, resendToken }),
      })
      if (res.status === 429) return { error: "Too many attempts. Please wait a minute and try again." }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) return { error: data.error ?? "Could not send the email. Please try again." }
      return {}
    } catch {
      return { error: "Cannot connect to server" }
    }
  }

  return (
    <AuthContext.Provider value={{ user, ready, login, signup, logout, updateUser, verifyEmail, resendVerification }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
