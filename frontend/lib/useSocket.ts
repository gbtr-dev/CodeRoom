import type React from "react"
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createSocket } from "./socket"
import { applyTextPatch } from "./textPatch"
import type { TextPatch } from "./textPatch"
import type { FileNode, Lang, RemoteParticipant } from "./highlight"
import { RUN_CMD } from "./highlight"
import type { User } from "@/components/auth-provider"

/* ------------------------------------------------------------------ */
/* Tipi                                                                 */
/* ------------------------------------------------------------------ */

export type OutputLine = { t: string; kind: "info" | "ok" | "muted" | "out" | "err" }
export type Knock = { knockId: string; userName: string; avatar?: string | null }
export type Role = "owner" | "editor" | "viewer"
export type ChatMessage = {
  id: number
  room_id: string
  user_id: string | null
  user_name: string
  avatar: string | null
  content: string
  created_at: number
}

type IncomingFile = {
  id: string
  name: string
  type: string
  content?: string
  parentId?: string
  language?: string
}

export interface UseSocketCallbacks {
  setNodes: (updater: FileNode[] | ((prev: FileNode[]) => FileNode[])) => void
  setActiveContent: (updater: string | ((prev: string) => string)) => void
  activeIdRef: { current: string }
  lastSyncedContent: { current: Record<string, string> }
  originals: { current: Record<string, string> }
  importingRef: { current: boolean }
  openFile: (id: string) => void
  setOutput: (lines: OutputLine[]) => void
  setRunning: (running: boolean) => void
  setProgress: (progress: boolean) => void
  outputEndRef: { current: HTMLDivElement | null }
  setFormatting: (v: boolean) => void
  applyFormat: (code: string) => void
}

export interface UseSocketResult {
  socketRef: React.RefObject<ReturnType<typeof createSocket> | null>
  connected: boolean
  participants: RemoteParticipant[]
  myRole: Role
  roomName: string | null
  setRoomName: (name: string | null) => void
  knockQueue: Knock[]
  setKnockQueue: React.Dispatch<React.SetStateAction<Knock[]>>
  knockStatus: "idle" | "pending" | "denied" | "password-required" | "password-wrong"
  submitRoomPassword: (password: string) => void
  roomHasPassword: boolean
  chatMessages: ChatMessage[]
  sendChatMessage: (content: string) => void
}


export function useSocket(
  roomId: string,
  ready: boolean,
  user: User | null,
  callbacks: UseSocketCallbacks,
): UseSocketResult {
  const router = useRouter()

  const socketRef = useRef<ReturnType<typeof createSocket> | null>(null)
  const newFlagClearedRef = useRef(false)
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const [connected, setConnected] = useState(false)
  const [participants, setParticipants] = useState<RemoteParticipant[]>([])
  const [myRole, setMyRole] = useState<Role>("viewer")
  const [roomName, setRoomName] = useState<string | null>(null)
  const [knockQueue, setKnockQueue] = useState<Knock[]>([])
  const [knockStatus, setKnockStatus] = useState<"idle" | "pending" | "denied" | "password-required" | "password-wrong">("idle")
  const [roomHasPassword, setRoomHasPassword] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])

  const cb = useRef(callbacks)
  cb.current = callbacks

  useEffect(() => {
    if (!ready || !user) return

    const socket = createSocket()
    socketRef.current = socket
    socket.connect()

    socket.on("connect", () => {
      setConnected(true)
      const search = new URLSearchParams(window.location.search)
      const isNew = search.has("new")
      const initialName = search.get("name") || undefined
      socket.emit("join-room", { roomId, userName: user.name, isNew, roomName: initialName })
    })

    socket.on("disconnect", () => setConnected(false))

    socket.on("knock-pending", () => {
      setKnockStatus("pending")
    })

    socket.on("knock-denied", () => {
      setKnockStatus("denied")
    })

    socket.on("login-required", () => {
      router.replace(`/login?redirect=${encodeURIComponent(`/room/${roomId}`)}`)
    })

    socket.on("room-password-required", () => {
      setKnockStatus("password-required")
    })

    socket.on("room-wrong-password", () => {
      setKnockStatus("password-wrong")
    })

    socket.on("knock", ({ knockId, userName }: Knock) => {
      setKnockQueue((prev) => [...prev, { knockId, userName }])
    })

    socket.on("room-not-found", () => {
      router.replace(`/?error=room-not-found`)
    })

    socket.on("session-expired", () => {
      router.replace("/login?error=session-expired")
    })

    socket.on("room-deleted", () => {
      router.replace(`/rooms?error=room-deleted`)
    })

    socket.on("room-state", ({ files, participants: parts, roomName: incomingName, role: incomingRole, hasPassword: incomingHasPassword, chatHistory }: {
      files: IncomingFile[]
      participants: { id: string; name: string; color: string; dbUserId?: string; dbRole?: string }[]
      roomName?: string | null
      role?: string
      hasPassword?: boolean
      chatHistory?: ChatMessage[]
    }) => {
      if (files && files.length > 0) {
        const nodes: FileNode[] = files.map((f) => ({
          id: f.id,
          name: f.name,
          kind: f.type as "file" | "folder",
          parentId: f.parentId ?? "root",
          content: f.content ?? "",
          open: true,
        }))
        cb.current.setNodes(nodes)
        for (const n of nodes) {
          if (n.kind === "file") cb.current.lastSyncedContent.current[n.id] = n.content ?? ""
        }
        const firstFile = nodes.find((n) => n.kind === "file")
        if (firstFile) {
          cb.current.openFile(firstFile.id)
        }
      }
      setRoomName(incomingName ?? null)
      if (incomingHasPassword !== undefined) setRoomHasPassword(incomingHasPassword)
      if (chatHistory) setChatMessages(chatHistory)
      setParticipants(
        parts
          .filter((p) => p.id !== socket.id)
          .map((p) => ({ ...p, fileId: cb.current.activeIdRef.current, dbUserId: p.dbUserId, dbRole: p.dbRole as any, avatar: (p as any).avatar ?? null })),
      )
      if (incomingRole) setMyRole(incomingRole as Role)
      
      setKnockStatus("idle")

      if (!newFlagClearedRef.current) {
        newFlagClearedRef.current = true
        const url = new URL(window.location.href)
        if (url.searchParams.has("new")) {
          url.searchParams.delete("new")
          const next = url.pathname + (url.search ? url.search : "")
          router.replace(next)
        }
      }
    })

    socket.on("room-renamed", ({ name }: { name: string | null }) => {
      setRoomName(name ?? null)
    })

    socket.on("participant-joined", (p: { id: string; name: string; color: string; dbUserId?: string; dbRole?: string; avatar?: string | null }) => {
      setParticipants((prev) => [
        ...prev.filter((x) => x.id !== p.id),
        { ...p, fileId: cb.current.activeIdRef.current, dbUserId: p.dbUserId, dbRole: p.dbRole as any, avatar: p.avatar },
      ])
    })

    socket.on("participant-left", ({ id }: { id: string }) => {
      const t = typingTimers.current.get(id)
      if (t) { clearTimeout(t); typingTimers.current.delete(id) }
      setParticipants((prev) => prev.filter((p) => p.id !== id))
    })

    socket.on("member-role-changed", ({ userId, role }: { userId: string; role: Role }) => {
      // Update remote participant roles in the sidebar
      setParticipants((prev) => prev.map((p) => (p.dbUserId === userId ? { ...p, dbRole: role } : p)))
    })

    socket.on("role-refreshed", ({ role }: { role: Role }) => {
      setMyRole(role)
    })

    socket.on("member-kicked", ({ userId }: { userId: string }) => {
      // Rimuovi subito il membro dalla lista, senza aspettare 'participant-left'
      setParticipants((prev) => prev.filter((p) => p.dbUserId !== userId))
      // Se sei tu quello che è stato kickato, esci dalla room
      if (userId === user.id) {
        router.replace(`/rooms?error=kicked`)
      }
    })

    socket.on("code-update", ({ fileId, content, fromSocketId }: { fileId: string; content: string; fromSocketId?: string }) => {

      cb.current.lastSyncedContent.current[fileId] = content

      if (fromSocketId === socket.id) return
      cb.current.setNodes((prev) => prev.map((n) => (n.id === fileId ? { ...n, content } : n)))
      cb.current.setActiveContent((cur) => {
        const aid = cb.current.activeIdRef.current
        return aid === fileId ? content : cur
      })
    })

    socket.on("code-patch", ({ fileId, start, deleteCount, insert }: TextPatch & { fileId: string }) => {
      const apply = (text: string) => applyTextPatch(text, { start, deleteCount, insert })
      cb.current.setNodes((prev) => {
        const next = prev.map((n) => (n.id === fileId ? { ...n, content: apply(n.content ?? "") } : n))
        const updated = next.find((n) => n.id === fileId)?.content
        if (updated !== undefined) cb.current.lastSyncedContent.current[fileId] = updated
        return next
      })
      cb.current.setActiveContent((cur) => {
        const aid = cb.current.activeIdRef.current
        return aid === fileId ? apply(cur) : cur
      })
    })

    socket.on("cursor-update", ({ userId, fileId, line, column, col }: { userId: string; fileId: string; line: number; column?: number; col?: number }) => {
      const cursorCol = column ?? col ?? 0
      setParticipants((prev) => prev.map((p) => (p.id === userId ? { ...p, fileId, line, col: cursorCol, typing: true } : p)))

      const existing = typingTimers.current.get(userId)
      if (existing) clearTimeout(existing)
      typingTimers.current.set(userId, setTimeout(() => {
        typingTimers.current.delete(userId)
        setParticipants((prev) => prev.map((p) => (p.id === userId ? { ...p, typing: false } : p)))
      }, 2000))
    })

    socket.on("run-started", ({ language }: { language: string }) => {
      cb.current.setRunning(true)
      cb.current.setProgress(true)
      cb.current.setOutput([
        { t: `$ ${RUN_CMD[language as Lang] ?? language}`, kind: "info" },
        { t: "Running…", kind: "muted" },
      ])
      setTimeout(() => cb.current.setProgress(false), 1000)
    })

    socket.on("run-result", ({ output, error, exitCode, duration, language }: {
      output: string; error: string; exitCode: number; duration: number; language: string
    }) => {
      cb.current.setRunning(false)
      const lines: OutputLine[] = [{ t: `$ ${RUN_CMD[language as Lang] ?? language}`, kind: "info" }]
      if (output) {
        output.split("\n").forEach((line) => lines.push({ t: line, kind: "out" }))
      }
      if (error) {
        error.split("\n").forEach((line) => lines.push({ t: line, kind: "err" }))
      }
      lines.push({
        t: exitCode === 0
          ? `✓ Exited with code 0  (${duration}ms)`
          : `✗ Exited with code ${exitCode}  (${duration}ms)`,
        kind: exitCode === 0 ? "ok" : "muted",
      })
      cb.current.setOutput(lines)
      setTimeout(() => cb.current.outputEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
    })

    socket.on("format-result", ({ formatted, error }: { formatted: string; error: string }) => {
      cb.current.setFormatting(false)
      if (!error && formatted && cb.current.activeIdRef.current) {
        cb.current.applyFormat(formatted)
        socket.emit("code-update", { fileId: cb.current.activeIdRef.current, content: formatted })
      }
    })

    socket.on("file-created", ({ node, parentId }: { node: IncomingFile; parentId: string | null }) => {
      const newNode: FileNode = {
        id: node.id,
        name: node.name,
        kind: node.type as "file" | "folder",
        parentId: parentId ?? "root",
        content: node.content ?? "",
        open: true,
      }
      cb.current.originals.current[node.id] = node.content ?? ""
      cb.current.setNodes((prev) => {
        if (prev.find((n) => n.id === node.id)) return prev
        return [...prev, newNode]
      })
      // During import we open the file manually at the end — skip auto-open here
      if (node.type === "file" && !cb.current.importingRef.current) cb.current.openFile(node.id)
    })

    socket.on("file-deleted", ({ fileId }: { fileId: string }) => {
      cb.current.setNodes((prev) => prev.filter((n) => n.id !== fileId))
    })

    socket.on("file-renamed", ({ fileId, name }: { fileId: string; name: string }) => {
      cb.current.setNodes((prev) => prev.map((n) => (n.id === fileId ? { ...n, name } : n)))
    })

    socket.on("file-moved", ({ fileId, parentId }: { fileId: string; parentId: string }) => {
      cb.current.setNodes((prev) =>
        prev.map((n) =>
          n.id === fileId
            ? { ...n, parentId }
            : n.id === parentId && n.kind === "folder"
              ? { ...n, open: true }
              : n,
        ),
      )
    })

    socket.on("files-imported", ({ nodes: imported }: { nodes: IncomingFile[] }) => {
      cb.current.setNodes((prev) => {
        const existingIds = new Set(prev.map((n) => n.id))
        const newNodes: FileNode[] = imported
          .filter((n) => !existingIds.has(n.id))
          .map((n) => ({
            id: n.id,
            name: n.name,
            kind: n.type as "file" | "folder",
            parentId: n.parentId ?? "root",
            content: n.content ?? "",
            open: true,
          }))
        return [...prev, ...newNodes]
      })
    })

    socket.on("rate-limited", ({ event }: { event: string }) => {
      console.warn(`[rate-limited] ${event}`)
    })

    socket.on("chat-message", (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev, msg])
    })

    return () => {
      socket.off("connect")
      socket.off("disconnect")
      socket.off("knock-pending")
      socket.off("knock-denied")
      socket.off("knock")
      socket.off("room-not-found")
      socket.off("session-expired")
      socket.off("room-deleted")
      socket.off("room-state")
      socket.off("room-renamed")
      socket.off("participant-joined")
      socket.off("participant-left")
      socket.off("member-role-changed")
      socket.off("role-refreshed")
      socket.off("member-kicked")
      socket.off("code-update")
      socket.off("code-patch")
      socket.off("cursor-update")
      socket.off("run-started")
      socket.off("run-result")
      socket.off("format-result")
      socket.off("file-created")
      socket.off("file-deleted")
      socket.off("file-renamed")
      socket.off("file-moved")
      socket.off("files-imported")
      socket.off("rate-limited")
      socket.off("chat-message")
      socket.off("login-required")
      socket.off("room-password-required")
      socket.off("room-wrong-password")
      socket.disconnect()
      socketRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user, roomId])

  function submitRoomPassword(password: string) {
    if (!socketRef.current) return
    socketRef.current.emit("join-room", {
      roomId,
      userName: user?.name ?? "Anonymous",
      isNew: false,
      password,
    })
  }

  function sendChatMessage(content: string) {
    if (!socketRef.current) return
    socketRef.current.emit("chat-send", { content })
  }

  return {
    socketRef,
    connected,
    participants,
    myRole,
    roomName,
    setRoomName,
    knockQueue,
    setKnockQueue,
    knockStatus,
    submitRoomPassword,
    roomHasPassword,
    chatMessages,
    sendChatMessage,
  }
}