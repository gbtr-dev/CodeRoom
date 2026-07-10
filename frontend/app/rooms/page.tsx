"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function ArrowRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
function PlusIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}
function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}
function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}
function RoomsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}
function GridIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}
function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  )
}
function EditIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
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

/* ------------------------------------------------------------------ */
/* Page transition                                                     */
/* ------------------------------------------------------------------ */


function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
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

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`
  return new Date(ts * 1000).toLocaleDateString("en", { month: "short", day: "numeric" })
}

function roomLabel(id: string) {
  // "room-a3f9x2" → "a3f9x2"
  return id.startsWith("room-") ? id.slice(5) : id
}

function generateRoomId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const id = Array.from(bytes, (b) => chars[b % chars.length]).join("")
  return `room-${id}`
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Room = { id: string; name: string | null; last_seen: number; role: "owner" | "editor" | "viewer" }
type View = "grid" | "list"
type Sort = "recent" | "name"

export default function RoomsPage() {
  const { user, ready, logout } = useAuth()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { overlayRef, navigate } = usePageTransition()

  const [rooms, setRooms] = useState<Room[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [view, setView] = useState<View>("grid")
  const [sort, setSort] = useState<Sort>("recent")
  const [joinId, setJoinId] = useState("")
  const [joinOpen, setJoinOpen] = useState(false)
  const joinRef = useRef<HTMLInputElement>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [newRoomName, setNewRoomName] = useState("")
  const createRef = useRef<HTMLInputElement>(null)

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameRef = useRef<HTMLInputElement>(null)

  const [deletingRoom, setDeletingRoom] = useState<Room | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const [leavingRoom, setLeavingRoom] = useState<Room | null>(null)
  const [leaveLoading, setLeaveLoading] = useState(false)

  // Redirect to login if not authenticated
  useEffect(() => {
    if (ready && !user) {
      router.replace(`/login?redirect=/rooms`)
    }
  }, [ready, user, router])

  // Fetch rooms from backend
  useEffect(() => {
    if (!user) return
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:45032"
    fetch(`${BACKEND_URL}/auth/rooms`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.rooms) { setRooms(d.rooms); setNextCursor(d.nextCursor ?? null) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  async function loadMore() {
    if (!nextCursor || loadingMore) return
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:45032"
    setLoadingMore(true)
    try {
      const r = await fetch(`${BACKEND_URL}/auth/rooms?cursor=${nextCursor}`, { credentials: "include" })
      const d = await r.json()
      if (d.rooms) {
        setRooms((prev) => [...prev, ...d.rooms])
        setNextCursor(d.nextCursor ?? null)
      }
    } catch {}
    finally { setLoadingMore(false) }
  }

  // Open join input
  useEffect(() => {
    if (joinOpen) setTimeout(() => joinRef.current?.focus(), 50)
  }, [joinOpen])

  // Open create-room name input
  useEffect(() => {
    if (createOpen) {
      setNewRoomName("")
      setTimeout(() => createRef.current?.focus(), 50)
    }
  }, [createOpen])

  // Open rename input
  useEffect(() => {
    if (renamingId) setTimeout(() => renameRef.current?.focus(), 50)
  }, [renamingId])

  // Close join/create on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setJoinOpen(false)
        setCreateOpen(false)
        setRenamingId(null)
        setDeletingRoom(null)
        setLeavingRoom(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  function createRoom() {
    const name = newRoomName.trim().slice(0, 60)
    const id = generateRoomId()
    const query = name ? `?new=1&name=${encodeURIComponent(name)}` : `?new=1`
    navigate(`/room/${id}${query}`)
  }

  function openRoom(id: string) {
    navigate(`/room/${encodeURIComponent(id)}`)
  }

  function joinRoom() {
    const id = joinId.trim()
    if (!id) return
    navigate(`/room/${encodeURIComponent(id)}`)
  }

  function startRename(r: Room) {
    setRenamingId(r.id)
    setRenameValue(r.name ?? "")
  }

  async function commitRename(id: string) {
    const name = renameValue.trim().slice(0, 60)
    setRenamingId(null)
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:45032"
    try {
      const res = await fetch(`${BACKEND_URL}/auth/rooms/${encodeURIComponent(id)}/name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (res.ok) {
        setRooms((prev) => prev.map((r) => (r.id === id ? { ...r, name: data.name ?? null } : r)))
      }
    } catch { }
  }

  async function deleteRoom() {
    if (!deletingRoom) return
    const id = deletingRoom.id
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:45032"
    setDeleteLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/rooms/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      })
      if (res.ok) {
        setRooms((prev) => prev.filter((r) => r.id !== id))
        setDeletingRoom(null)
      }
    } catch {
    } finally {
      setDeleteLoading(false)
    }
  }

  async function leaveRoom() {
    if (!leavingRoom) return
    const id = leavingRoom.id
    const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:45032"
    setLeaveLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/rooms/${encodeURIComponent(id)}/leave`, {
        method: "POST",
        credentials: "include",
      })
      if (res.ok) {
        setRooms((prev) => prev.filter((r) => r.id !== id))
        setLeavingRoom(null)
      }
    } catch {
    } finally {
      setLeaveLoading(false)
    }
  }

  // Filter + sort
  const filtered = rooms
    .filter((r) => (r.name ?? "").toLowerCase().includes(query.toLowerCase()) || r.id.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) =>
      sort === "recent" ? b.last_seen - a.last_seen : (a.name ?? roomLabel(a.id)).localeCompare(b.name ?? roomLabel(b.id))
    )

  if (!ready || !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#070809]">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-700 border-t-[#4ade80]" />
      </div>
    )
  }

  return (
    <div className="relative min-h-screen bg-[#070809] text-[#c8c8c8]">

      {/* Page transition overlay */}
      <div
        ref={overlayRef}
        className="page-transition-overlay"
        style={{ opacity: 0, pointerEvents: "none" }}
        aria-hidden="true"
      />

      {/* Subtle background gradient */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="blob-a absolute -top-32 -left-32 h-[480px] w-[480px] rounded-full bg-[#4ade80]/[0.025] blur-[100px]" />
        <div className="blob-b absolute top-1/2 right-0 h-[360px] w-[360px] rounded-full bg-[#22d3ee]/[0.02] blur-[120px]" />
      </div>

      {/* ── Header ── */}
      <header className="nav-glass sticky top-0 z-40 flex h-[58px] items-center justify-between px-6">
        <div className="flex items-center gap-3">
          {/* Logo / back to home */}
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
            aria-label="Go to home"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(74,222,128,0.12)] ring-1 ring-inset ring-[rgba(74,222,128,0.2)]">
              <span style={{ fontFamily: "monospace", fontSize: "11px", fontWeight: "bold", color: "#4ade80", letterSpacing: "-1px" }}>{"</>"}</span>
            </div>
            <span className="text-[15px] font-semibold tracking-[-0.4px] text-[#f5f5f5]">Coderoom</span>
          </button>
          <span className="text-[#2a2a2a]">/</span>
          <span className="text-[14px] font-medium text-[#888]">My Rooms</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] text-[#555] transition-colors hover:bg-white/[0.04] hover:text-[#aaa]"
          >
            <HomeIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Home</span>
          </button>

          {/* Avatar dropdown */}
          <div ref={dropdownRef} className="relative">
            <button
              onClick={() => setDropdownOpen((v) => !v)}
              className={`flex h-8 w-8 items-center justify-center rounded-full text-[13px] font-bold tracking-tight transition-all ring-2 ring-transparent hover:ring-[rgba(74,222,128,0.3)] ${dropdownOpen ? "ring-[rgba(74,222,128,0.4)]" : ""} bg-[rgba(74,222,128,0.1)] text-[#4ade80] overflow-hidden`}
              aria-label="User menu"
            >
              {user?.avatar
                ? <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                : user?.name?.split(" ").map((w: string) => w[0]).join("").slice(0, 2).toUpperCase()
              }
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0e0f10] shadow-2xl">
                {/* User info */}
                <div className="border-b border-white/[0.06] px-4 py-3">
                  <p className="truncate text-[13px] font-semibold text-[#e0e0e0]">{user?.name}</p>
                  <p className="truncate text-[11px] text-[#555]">{user?.email}</p>
                </div>

                {/* Menu items */}
                <div className="p-1">
                  <button
                    onClick={() => { setDropdownOpen(false); navigate("/settings") }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] text-[#888] transition-colors hover:bg-white/[0.05] hover:text-[#ccc]"
                  >
                    <SettingsIcon className="h-3.5 w-3.5" />
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
        </div>
      </header>

      {/* ── Main content ── */}
      <main className="mx-auto w-full max-w-[1000px] px-6 py-12">

        {/* Page title */}
        <div className="mb-10 flex flex-col gap-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#4ade80]">Workspace</p>
          <h1 className="text-[32px] font-bold tracking-[-0.8px] text-[#f0f0f0]">Your rooms</h1>
          <p className="mt-1 text-[14px] text-[#555]">
            {rooms.length > 0
              ? `${rooms.length} room${rooms.length !== 1 ? "s" : ""} — pick up where you left off`
              : "No rooms yet. Create your first one below."}
          </p>
        </div>

        {/* ── Toolbar ── */}
        <div className="mb-6 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative flex-1" style={{ minWidth: 180 }}>
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#3a3a3a]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter rooms…"
              className="h-9 w-full rounded-xl border border-white/[0.06] bg-white/[0.03] pl-9 pr-3 text-[13px] text-[#ccc] placeholder-[#333] outline-none transition-colors focus:border-[rgba(74,222,128,0.25)] focus:bg-white/[0.05]"
            />
          </div>

          {/* Sort */}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="h-9 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 text-[13px] text-[#888] outline-none transition-colors hover:border-white/[0.1] focus:border-[rgba(74,222,128,0.25)]"
          >
            <option value="recent">Most recent</option>
            <option value="name">Name A–Z</option>
          </select>

          {/* View toggle */}
          <div className="flex items-center rounded-xl border border-white/[0.06] bg-white/[0.03] p-0.5">
            <button
              onClick={() => setView("grid")}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${view === "grid" ? "bg-white/[0.08] text-[#f0f0f0]" : "text-[#444] hover:text-[#888]"}`}
              aria-label="Grid view"
            >
              <GridIcon className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setView("list")}
              className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${view === "list" ? "bg-white/[0.08] text-[#f0f0f0]" : "text-[#444] hover:text-[#888]"}`}
              aria-label="List view"
            >
              <ListIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Join by ID */}
          <div className="relative">
            {joinOpen ? (
              <div className="flex items-center gap-2">
                <input
                  ref={joinRef}
                  type="text"
                  value={joinId}
                  onChange={(e) => setJoinId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") joinRoom() }}
                  placeholder="room-id"
                  className="h-9 w-36 rounded-xl border border-[rgba(74,222,128,0.25)] bg-white/[0.04] px-3 font-mono text-[13px] text-[#ccc] placeholder-[#333] outline-none"
                />
                <button
                  onClick={joinRoom}
                  className="flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[13px] text-[#888] transition-colors hover:border-[rgba(74,222,128,0.2)] hover:text-[#4ade80]"
                >
                  Join <ArrowRightIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setJoinOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 text-[13px] text-[#888] transition-colors hover:border-white/[0.1] hover:text-[#ccc]"
              >
                Join by ID
              </button>
            )}
          </div>

          {/* Create room */}
          <button
            onClick={() => setCreateOpen(true)}
            className="btn-create flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            New room
          </button>
        </div>

        {/* ── Room list ── */}
        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-[14px] text-[#444]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#2a2a2a] border-t-[#4ade80]" />
            Loading rooms…
          </div>
        ) : filtered.length === 0 && query ? (
          <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
            <p className="text-[15px] text-[#444]">No rooms match <span className="text-[#888]">"{query}"</span></p>
            <button onClick={() => setQuery("")} className="text-[13px] text-[#4ade80] hover:underline">Clear filter</button>
          </div>
        ) : filtered.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.06] bg-white/[0.02]">
              <span style={{ fontFamily: "monospace", fontSize: "18px", fontWeight: "bold", color: "#2a2a2a" }}>{"</>"}</span>
            </div>
            <div>
              <p className="text-[15px] font-medium text-[#555]">No rooms yet</p>
              <p className="mt-1 text-[13px] text-[#333]">Create a room to get started</p>
            </div>
            <button onClick={() => setCreateOpen(true)} className="btn-create mt-2 flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold">
              <PlusIcon className="h-4 w-4" /> Create your first room
            </button>
          </div>
        ) : view === "grid" ? (
          /* Grid view */
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {filtered.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => { if (renamingId !== r.id) openRoom(r.id) }}
                onKeyDown={(e) => { if (e.key === "Enter" && renamingId !== r.id) openRoom(r.id) }}
                className="room-card group flex cursor-pointer flex-col gap-4 rounded-2xl p-5 text-left"
              >
                {/* Room icon */}
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.05] bg-white/[0.03] transition-colors group-hover:border-[rgba(74,222,128,0.15)] group-hover:bg-[rgba(74,222,128,0.05)]">
                  <span style={{ fontFamily: "monospace", fontSize: "12px", fontWeight: "bold", color: "#4ade80", opacity: 0.7 }}>{"</>"}</span>
                </div>

                <div className="flex flex-col gap-1 flex-1">
                  {renamingId === r.id ? (
                    <input
                      ref={renameRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(r.id)
                        if (e.key === "Escape") setRenamingId(null)
                      }}
                      onBlur={() => commitRename(r.id)}
                      placeholder="Room name…"
                      maxLength={60}
                      className="h-7 w-full rounded-md border border-[rgba(74,222,128,0.3)] bg-white/[0.04] px-2 text-[13px] text-[#e0e0e0] outline-none"
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p className={`truncate text-[14px] font-semibold ${r.name ? "font-sans text-[#e0e0e0]" : "font-mono text-[#e0e0e0]"}`}>
                        {r.name || roomLabel(r.id)}
                      </p>
                      {r.role === "owner" ? (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); startRename(r) }}
                            className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-[#3a3a3a] opacity-0 transition-all hover:text-[#4ade80] hover:bg-[rgba(74,222,128,0.08)] group-hover:opacity-100"
                            aria-label="Rename room"
                          >
                            <EditIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingRoom(r) }}
                            className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-[#3a3a3a] opacity-0 transition-all hover:text-[#f87171] hover:bg-[rgba(248,113,113,0.08)] group-hover:opacity-100"
                            aria-label="Delete room"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setLeavingRoom(r) }}
                          className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-[#3a3a3a] opacity-0 transition-all hover:text-[#f87171] hover:bg-[rgba(248,113,113,0.08)] group-hover:opacity-100"
                          aria-label="Leave room"
                        >
                          <LogoutIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  <p className="font-mono text-[11px] text-[#333] truncate">{r.id}</p>
                </div>

                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] text-[#444]">
                    <ClockIcon className="h-3 w-3" />
                    {timeAgo(r.last_seen)}
                  </span>
                  <span className="flex items-center gap-1 text-[12px] font-semibold text-[#4ade80] opacity-0 transition-all group-hover:opacity-100 group-hover:gap-1.5">
                    Open <ArrowRightIcon className="h-3 w-3" />
                  </span>
                </div>
              </div>
            ))}

            {/* New room card */}
            <button
              onClick={() => setCreateOpen(true)}
              className="room-card group flex min-h-[140px] flex-col items-center justify-center gap-2.5 rounded-2xl border border-dashed border-white/[0.05] p-5 transition-all hover:border-[rgba(74,222,128,0.2)]"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[rgba(74,222,128,0.12)] bg-[rgba(74,222,128,0.05)] transition-all group-hover:scale-110">
                <PlusIcon className="h-4 w-4 text-[#4ade80]" />
              </div>
              <p className="text-[13px] text-[#3a3a3a] transition-colors group-hover:text-[#555]">New room</p>
            </button>
          </div>
        ) : (
          /* List view */
          <div className="flex flex-col divide-y divide-white/[0.04] rounded-2xl border border-white/[0.06] overflow-hidden">
            {filtered.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onClick={() => { if (renamingId !== r.id) openRoom(r.id) }}
                onKeyDown={(e) => { if (e.key === "Enter" && renamingId !== r.id) openRoom(r.id) }}
                className="group flex cursor-pointer items-center gap-4 bg-white/[0.015] px-5 py-4 text-left transition-colors hover:bg-white/[0.04]"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.03] transition-colors group-hover:border-[rgba(74,222,128,0.15)]">
                  <span style={{ fontFamily: "monospace", fontSize: "10px", fontWeight: "bold", color: "#4ade80", opacity: 0.6 }}>{"</>"}</span>
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  {renamingId === r.id ? (
                    <input
                      ref={renameRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(r.id)
                        if (e.key === "Escape") setRenamingId(null)
                      }}
                      onBlur={() => commitRename(r.id)}
                      placeholder="Room name…"
                      maxLength={60}
                      className="h-7 w-full max-w-xs rounded-md border border-[rgba(74,222,128,0.3)] bg-white/[0.04] px-2 text-[13px] text-[#e0e0e0] outline-none"
                    />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <p className={`truncate text-[14px] font-semibold ${r.name ? "font-sans text-[#e0e0e0]" : "font-mono text-[#e0e0e0]"}`}>
                        {r.name || roomLabel(r.id)}
                      </p>
                      {r.role === "owner" ? (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); startRename(r) }}
                            className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-[#3a3a3a] opacity-0 transition-all hover:text-[#4ade80] hover:bg-[rgba(74,222,128,0.08)] group-hover:opacity-100"
                            aria-label="Rename room"
                          >
                            <EditIcon className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDeletingRoom(r) }}
                            className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-[#3a3a3a] opacity-0 transition-all hover:text-[#f87171] hover:bg-[rgba(248,113,113,0.08)] group-hover:opacity-100"
                            aria-label="Delete room"
                          >
                            <TrashIcon className="h-3.5 w-3.5" />
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setLeavingRoom(r) }}
                          className="shrink-0 flex items-center justify-center h-6 w-6 rounded-md text-[#3a3a3a] opacity-0 transition-all hover:text-[#f87171] hover:bg-[rgba(248,113,113,0.08)] group-hover:opacity-100"
                          aria-label="Leave room"
                        >
                          <LogoutIcon className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  <p className="font-mono text-[11px] text-[#333]">{r.id}</p>
                </div>

                <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-[#444]">
                  <ClockIcon className="h-3.5 w-3.5" />
                  {timeAgo(r.last_seen)}
                </span>

                <span className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-[#4ade80] opacity-0 transition-all group-hover:opacity-100 group-hover:gap-1.5">
                  Open <ArrowRightIcon className="h-3.5 w-3.5" />
                </span>
              </div>
            ))}
          </div>
        )}
        {/* Load more */}
        {nextCursor && !query && (
          <div className="flex justify-center pt-2 pb-4">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-[13px] text-[#888] transition-colors hover:border-white/[0.12] hover:text-[#ccc] disabled:opacity-50"
            >
              {loadingMore ? "Loading\u2026" : "Load more"}
            </button>
          </div>
        )}
      </main>

      {/* ── Create room modal ── */}
      {createOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setCreateOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0c0d0e] p-5 shadow-2xl"
          >
            <h2 className="text-[15px] font-semibold text-[#f0f0f0]">New room</h2>
            <p className="mt-1 text-[13px] text-[#555]">Give your room a name so you can find it easily later.</p>
            <input
              ref={createRef}
              type="text"
              value={newRoomName}
              onChange={(e) => setNewRoomName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createRoom() }}
              placeholder="e.g. Frontend exercise"
              maxLength={60}
              className="mt-4 h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] text-[#ccc] placeholder-[#444] outline-none transition-colors focus:border-[rgba(74,222,128,0.3)] focus:bg-white/[0.05]"
            />
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setCreateOpen(false)}
                className="flex h-9 items-center rounded-xl px-3 text-[13px] text-[#888] transition-colors hover:text-[#ccc]"
              >
                Cancel
              </button>
              <button onClick={createRoom} className="btn-create flex h-9 items-center gap-2 rounded-xl px-4 text-[13px] font-semibold">
                <PlusIcon className="h-3.5 w-3.5" />
                Create room
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Delete room modal ── */}
      {deletingRoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !deleteLoading && setDeletingRoom(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0c0d0e] p-5 shadow-2xl"
          >
            <h2 className="text-[15px] font-semibold text-[#f0f0f0]">Delete room</h2>
            <p className="mt-1 text-[13px] text-[#888]">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-[#ccc]">
                {deletingRoom.name || roomLabel(deletingRoom.id)}
              </span>
              ? This will permanently remove all of its files. This action cannot be undone.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setDeletingRoom(null)}
                disabled={deleteLoading}
                className="flex h-9 items-center rounded-xl px-3 text-[13px] text-[#888] transition-colors hover:text-[#ccc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={deleteRoom}
                disabled={deleteLoading}
                className="flex h-9 items-center gap-2 rounded-xl bg-[#f87171]/10 px-4 text-[13px] font-semibold text-[#f87171] transition-colors hover:bg-[#f87171]/20 disabled:opacity-50"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                {deleteLoading ? "Deleting…" : "Delete room"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ── Leave room modal ── */}
      {leavingRoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !leaveLoading && setLeavingRoom(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0c0d0e] p-5 shadow-2xl"
          >
            <h2 className="text-[15px] font-semibold text-[#f0f0f0]">Leave room</h2>
            <p className="mt-1 text-[13px] text-[#888]">
              Are you sure you want to leave{" "}
              <span className="font-semibold text-[#ccc]">
                {leavingRoom.name || roomLabel(leavingRoom.id)}
              </span>
              ? You&apos;ll need to be invited or knock again to rejoin.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setLeavingRoom(null)}
                disabled={leaveLoading}
                className="flex h-9 items-center rounded-xl px-3 text-[13px] text-[#888] transition-colors hover:text-[#ccc] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={leaveRoom}
                disabled={leaveLoading}
                className="flex h-9 items-center gap-2 rounded-xl bg-[#f87171]/10 px-4 text-[13px] font-semibold text-[#f87171] transition-colors hover:bg-[#f87171]/20 disabled:opacity-50"
              >
                <LogoutIcon className="h-3.5 w-3.5" />
                {leaveLoading ? "Leaving…" : "Leave room"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}