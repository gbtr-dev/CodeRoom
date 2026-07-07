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

type AuthContextValue = {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<{ error?: string }>
  signup: (name: string, email: string, password: string) => Promise<{ error?: string }>
  logout: () => void
  updateUser: (u: User) => void
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"

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

  async function login(email: string, password: string): Promise<{ error?: string }> {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? "Login failed" }
      setUser({ ...data.user, avatar: sanitizeAvatar(data.user.avatar) })
      return {}
    } catch {
      return { error: "Cannot connect to server" }
    }
  }

  async function signup(name: string, email: string, password: string): Promise<{ error?: string }> {
    try {
      const res = await fetch(`${BACKEND_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) return { error: data.error ?? "Signup failed" }
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

  return (
    <AuthContext.Provider value={{ user, ready, login, signup, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider")
  return ctx
}
