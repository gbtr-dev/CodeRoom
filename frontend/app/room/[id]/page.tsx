"use client"

import type React from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useAuth } from "@/components/auth-provider"
import { useSocket } from "@/lib/useSocket"
import type { OutputLine } from "@/lib/useSocket"
import { useImportExport } from "@/lib/useImportExport"
import { useFileTree } from "@/lib/useFileTree"

/* ------------------------------------------------------------------ */
/* Types & language metadata                                           */
/* ------------------------------------------------------------------ */

import type { Lang, HighlightCache, FileNode } from "@/lib/highlight"
import { getLang, highlightCode, defaultNodes, LANG_META, RUN_CMD } from "@/lib/highlight"

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

import {
  CopyIcon, CheckIcon, PlayIcon, ShareIcon, CloseIcon, ChevronIcon, UserPlusIcon, LockIcon,
  RenameIcon, DownloadIcon,
} from "@/components/room/Icons"

/* ------------------------------------------------------------------ */
/* Editor & Terminal                                                    */
/* ------------------------------------------------------------------ */

import { Editor, GUTTER_OVERSCAN, LINE_HEIGHT, CHAR_WIDTH } from "@/components/room/Editor"
import { Terminal } from "@/components/room/Terminal"

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type ViewState = { sel: number; top: number; left: number }

const CODE_SYNC_DEBOUNCE_MS = 120
const CODE_SYNC_MAX_WAIT_MS = 400
const CURSOR_THROTTLE_MS = 80

import { computeTextPatch, applyTextPatch } from "@/lib/textPatch"
import type { TextPatch } from "@/lib/textPatch"

/* ------------------------------------------------------------------ */
/* Role UI helpers                                                     */
/* ------------------------------------------------------------------ */

import { MenuItem } from "@/components/room/FileTreeHelpers"
import { KnockWaitingScreen, KnockDeniedScreen, KnockApprovalPanel, RoomPasswordScreen } from "@/components/room/KnockQueue"
import { ParticipantList } from "@/components/room/ParticipantList"
import { FileTree, FileTreeContextMenu } from "@/components/room/FileTree"
import type { Menu, Creating } from "@/components/room/FileTree"
import ChatPanel from "@/components/ChatPanel"

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001"

export default function CoderoomPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user, ready } = useAuth()
  const roomId = params?.id ? decodeURIComponent(params.id) : "room-a3f9x2"
  const rootName = `${roomId.startsWith("room-") ? "coderoom-" + roomId.slice(5) : roomId}/`

  useEffect(() => {
    if (ready && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(`/room/${roomId}`)}`)
    }
  }, [ready, user, router, roomId])

  const [nodes, setNodes] = useState<FileNode[]>(defaultNodes)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string>("")
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  const [activeContent, setActiveContent] = useState<string>("")
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState("")
  const nameInputRef = useRef<HTMLInputElement>(null)

  const [rootOpen, setRootOpen] = useState(true)
  const [partsOpen, setPartsOpen] = useState(true)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [plusMenu, setPlusMenu] = useState(false)
  const [exportMenu, setExportMenu] = useState(false)
  const [kickTarget, setKickTarget] = useState<{ id: string; name: string } | null>(null)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)

  const [copied, setCopied] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteExpiry, setInviteExpiry] = useState(86400)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteCopied, setInviteCopied] = useState(false)

  const [lockOpen, setLockOpen] = useState(false)
  const [lockPassword, setLockPassword] = useState("")
  const [lockLoading, setLockLoading] = useState(false)
  const [lockHasPassword, setLockHasPassword] = useState<boolean | null>(null)
  const [panelHeight, setPanelHeight] = useState(220)
  const [output, setOutput] = useState<OutputLine[]>([])
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const [stdinModal, setStdinModal] = useState(false)
  const [stdinValue, setStdinValue] = useState("")
  const [stdinFields, setStdinFields] = useState<string[]>([])

  const [activeLine, setActiveLine] = useState(1)
  const [activeCol, setActiveCol] = useState(0)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchIndex, setSearchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const [editorViewportHeight, setEditorViewportHeight] = useState(0)

  const draggingRef = useRef(false)
  const importingRef = useRef(false)

  const activeIdRef = useRef(activeId)
  useEffect(() => { activeIdRef.current = activeId }, [activeId])
  const containerRef = useRef<HTMLDivElement>(null)
  const editorViewportRef = useRef<HTMLDivElement | null>(null)
  const editorViewportRO = useRef<ResizeObserver | null>(null)

  const setEditorViewportRef = useCallback((el: HTMLDivElement | null) => {
    editorViewportRef.current = el
    if (editorViewportRO.current) {
      editorViewportRO.current.disconnect()
      editorViewportRO.current = null
    }
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height ?? 0
      setEditorViewportHeight(h)
    })
    ro.observe(el)
    editorViewportRO.current = ro
    const h = el.clientHeight
    setEditorViewportHeight(h)
    if (h === 0) requestAnimationFrame(() => { if (el.isConnected) setEditorViewportHeight(el.clientHeight) })
  }, [])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const highlightRef = useRef<HTMLPreElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const outputEndRef = useRef<HTMLDivElement>(null)
  const viewState = useRef<Record<string, ViewState>>({})
  const originals = useRef<Record<string, string>>(
    Object.fromEntries(defaultNodes().filter((n) => n.kind === "file").map((n) => [n.id, n.content ?? ""])),
  )
  const lastSyncedContent = useRef<Record<string, string>>({})
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const maxSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSyncRef = useRef<{ fileId: string; content: string } | null>(null)
  const cursorThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastCursorEmitRef = useRef(0)
  const highlightCacheRef = useRef<Record<string, HighlightCache>>({})

  const [chatOpen, setChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const prevMsgCount = useRef(0)

  const {
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
  } = useSocket(roomId, ready, user, {
    setNodes,
    setActiveContent,
    activeIdRef,
    lastSyncedContent,
    originals,
    importingRef,
    openFile: (id: string) => openFile(id),
    setOutput,
    setRunning,
    setProgress,
    outputEndRef,
  })

  useEffect(() => { setLockHasPassword(roomHasPassword) }, [roomHasPassword])

  useEffect(() => {
    const newCount = chatMessages.length
    if (newCount > prevMsgCount.current && !chatOpen) {
      setUnreadCount((c) => c + (newCount - prevMsgCount.current))
    }
    prevMsgCount.current = newCount
  }, [chatMessages, chatOpen])

  const canEdit = myRole === "owner" || myRole === "editor"
  const isOwner = myRole === "owner"

  const activeNode = nodes.find((n) => n.id === activeId && n.kind === "file")

  const code = activeContent
  const lang: Lang = activeNode ? getLang(activeNode.name) : "md"
  const lineCount = code.split("\n").length
  const remoteCursors = participants.filter((p) => p.fileId === activeId)

  const highlightedCode = useMemo(() => {
    const prevCache = activeId ? highlightCacheRef.current[activeId] : undefined
    const { html, cache } = highlightCode(code, lang, prevCache)
    if (activeId) highlightCacheRef.current[activeId] = cache
    return html
  }, [code, lang, activeId])

  const searchMatches = useMemo(() => {
    if (!searchQuery.trim() || !code) return []
    const q = searchQuery.toLowerCase()
    const src = code.toLowerCase()
    const matches: { start: number; end: number }[] = []
    let i = 0
    while (i < src.length) {
      const idx = src.indexOf(q, i)
      if (idx === -1) break
      matches.push({ start: idx, end: idx + q.length })
      i = idx + 1
    }
    return matches
  }, [code, searchQuery])

  const searchHighlights = useMemo(() => {
    if (!searchOpen || !searchMatches.length) return []
    return searchMatches.map((m, i) => {
      const before = code.slice(0, m.start)
      const lines = before.split("\n")
      const line = lines.length
      const col = lines[lines.length - 1].length
      const matchText = code.slice(m.start, m.end)
      const firstNL = matchText.indexOf("\n")
      const chars = firstNL === -1 ? matchText.length : firstNL
      return {
        top: 12 + (line - 1) * LINE_HEIGHT - scroll.top,
        left: 16 + col * CHAR_WIDTH - scroll.left,
        width: Math.max(chars * CHAR_WIDTH, 2),
        isCurrent: i === searchIndex,
      }
    })
  }, [searchMatches, searchIndex, searchOpen, scroll, code])

  const gutterRange = useMemo(() => {
    const estimatedVisible = editorViewportHeight > 0
      ? Math.ceil(editorViewportHeight / LINE_HEIGHT)
      : Math.ceil(600 / LINE_HEIGHT)
    const firstVisible = Math.floor(scroll.top / LINE_HEIGHT)
    const start = Math.max(0, firstVisible - GUTTER_OVERSCAN)
    const end = Math.min(lineCount, firstVisible + estimatedVisible + GUTTER_OVERSCAN)
    return { start, end }
  }, [scroll.top, editorViewportHeight, lineCount])

  useEffect(() => {
    const node = nodes.find((n) => n.id === activeId && n.kind === "file")
    const content = node?.content ?? ""
    setActiveContent(content)
    if (activeId) lastSyncedContent.current[activeId] = content
  }, [activeId])

  function flushCodeSync() {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current)
      syncTimerRef.current = null
    }
    if (maxSyncTimerRef.current) {
      clearTimeout(maxSyncTimerRef.current)
      maxSyncTimerRef.current = null
    }
    const pending = pendingSyncRef.current
    if (!pending) return
    pendingSyncRef.current = null

    const { fileId, content } = pending
    const lastSynced = lastSyncedContent.current[fileId] ?? ""
    if (content === lastSynced) return

    const patch = computeTextPatch(lastSynced, content)
    const patchSize = patch.deleteCount + patch.insert.length
    if (patchSize < content.length) {
      socketRef.current?.emit("code-patch", { fileId, ...patch })
    } else {
      socketRef.current?.emit("code-change", { fileId, content })
    }
    lastSyncedContent.current[fileId] = content
  }

  function scheduleCodeSync(fileId: string, content: string) {
    pendingSyncRef.current = { fileId, content }
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(flushCodeSync, CODE_SYNC_DEBOUNCE_MS)
    if (!maxSyncTimerRef.current) {
      maxSyncTimerRef.current = setTimeout(flushCodeSync, CODE_SYNC_MAX_WAIT_MS)
    }
  }

  useEffect(() => {
    return () => {
      flushCodeSync()
      if (cursorThrottleRef.current) clearTimeout(cursorThrottleRef.current)
    }
  }, [activeId])

  useEffect(() => {
    return () => {
      flushCodeSync()
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
      if (maxSyncTimerRef.current) clearTimeout(maxSyncTimerRef.current)
      if (cursorThrottleRef.current) clearTimeout(cursorThrottleRef.current)
    }
  }, [])

  useEffect(() => {
    setSearchIndex(0)

  }, [searchMatches])

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.select(), 30)
  }, [searchOpen])

  /* ------------------------------------------------------------------ */
  /* File system helpers                                                 */
  /* ------------------------------------------------------------------ */

  function nodeName(id: string) {
    return nodes.find((n) => n.id === id)?.name ?? "—"
  }

  function openFile(id: string) {
    setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setActiveId(id)
  }

  function closeTab(id: string, e?: React.MouseEvent) {
    e?.stopPropagation()
    const idx = openTabs.indexOf(id)
    const next = openTabs.filter((t) => t !== id)
    setOpenTabs(next)
    if (activeId === id) {
      const fallback = next[idx] ?? next[idx - 1] ?? ""
      setActiveId(fallback)
    }
  }

  const {
    toggleFolder,
    startCreate,
    commitCreate,
    commitRename,
    deleteNode,
    canMove,
    moveNode,
  } = useFileTree({
    nodes,
    setNodes,
    socketRef,
    openTabs,
    setOpenTabs,
    activeId,
    setActiveId,
    creating,
    setCreating,
    setRenaming,
    setMenu,
    setPlusMenu,
    setDragId,
    setDropTarget,
  })

  /* ------------------------------------------------------------------ */
  /* Import / Export                                                     */
  /* ------------------------------------------------------------------ */

  const {
    importing,
    importFileInputRef,
    importZipInputRef,
    exportFile,
    exportActiveFile: exportActiveFileFn,
    exportProject,
    triggerImportFile: triggerImportFileFn,
    triggerImportZip: triggerImportZipFn,
    handleImportFileChange,
    handleImportZipChange,
  } = useImportExport({
    socketRef,
    nodes,
    roomName,
    rootName,
    importingRef,
    openFile: (id: string) => openFile(id),
  })

  function exportActiveFile() {
    exportActiveFileFn(activeNode)
  }
  function triggerImportFile() {
    setPlusMenu(false)
    triggerImportFileFn()
  }
  function triggerImportZip() {
    setPlusMenu(false)
    triggerImportZipFn()
  }

  /* ------------------------------------------------------------------ */
  /* Editor sync                                                         */
  /* ------------------------------------------------------------------ */

  function saveViewState() {
    const ta = textareaRef.current
    if (!ta || !activeId) return
    viewState.current[activeId] = { sel: ta.selectionStart, top: ta.scrollTop, left: ta.scrollLeft }
  }

  function syncScroll() {
    const ta = textareaRef.current
    if (!ta) return
    if (highlightRef.current) {
      highlightRef.current.scrollTop = ta.scrollTop
      highlightRef.current.scrollLeft = ta.scrollLeft
    }

    setScroll({ top: ta.scrollTop, left: ta.scrollLeft })
    saveViewState()
  }

  function updateLocalCursor() {
    const ta = textareaRef.current
    if (!ta) return
    const before = ta.value.slice(0, ta.selectionStart)
    const line = before.split("\n").length
    const col = before.split("\n").pop()?.length ?? 0
    setActiveLine(line)
    setActiveCol(col)
    saveViewState()
  }

  function emitCursorMoveThrottled() {
    const ta = textareaRef.current
    const fileId = activeIdRef.current
    if (!ta || !fileId) return

    const before = ta.value.slice(0, ta.selectionStart)
    const line = before.split("\n").length
    const col = before.split("\n").pop()?.length ?? 0

    const doEmit = () => {
      lastCursorEmitRef.current = Date.now()
      socketRef.current?.emit("cursor-move", { fileId, line, column: col })
    }

    const elapsed = Date.now() - lastCursorEmitRef.current
    if (elapsed >= CURSOR_THROTTLE_MS) {
      doEmit()
      return
    }
    if (cursorThrottleRef.current) return
    cursorThrottleRef.current = setTimeout(() => {
      cursorThrottleRef.current = null
      doEmit()
    }, CURSOR_THROTTLE_MS - elapsed)
  }

  function updateActiveLine() {
    updateLocalCursor()
    emitCursorMoveThrottled()
  }

  function onCodeChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value

    setActiveContent(value)
    setDirty((prev) => {
      const next = new Set(prev)
      if (value !== (originals.current[activeId] ?? "")) next.add(activeId)
      else next.delete(activeId)
      return next
    })
    updateLocalCursor()
    emitCursorMoveThrottled()
    scheduleCodeSync(activeId, value)
  }

  function goToMatch(idx: number) {
    const match = searchMatches[idx]
    if (!match || !textareaRef.current) return
    const ta = textareaRef.current
    ta.focus()
    ta.setSelectionRange(match.start, match.end)
    requestAnimationFrame(() => syncScroll())
  }

  function closeSearch() {
    setSearchOpen(false)
    setSearchQuery("")
    setSearchIndex(0)
    textareaRef.current?.focus()
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { closeSearch(); return }
    if (e.key === "Enter" && searchMatches.length > 0) {
      e.preventDefault()
      const next = e.shiftKey
        ? (searchIndex - 1 + searchMatches.length) % searchMatches.length
        : (searchIndex + 1) % searchMatches.length
      setSearchIndex(next)
      goToMatch(next)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const ta = e.currentTarget
    const ctrl = e.ctrlKey || e.metaKey

    // Ctrl+S — flush immediato
    if (ctrl && e.key === "s") {
      e.preventDefault()
      flushCodeSync()
      return
    }

    // Ctrl+F — apri search
    if (ctrl && e.key === "f") {
      e.preventDefault()
      setSearchOpen(true)
      setTimeout(() => { searchInputRef.current?.select() }, 30)
      return
    }

    // Escape — chiudi search se aperta
    if (e.key === "Escape" && searchOpen) {
      closeSearch()
      return
    }

    // Ctrl+D — duplica riga corrente
    if (ctrl && e.key === "d") {
      e.preventDefault()
      const start = ta.selectionStart
      const value = ta.value
      const lineStart = value.lastIndexOf("\n", start - 1) + 1
      const lineEnd = value.indexOf("\n", start)
      const line = value.slice(lineStart, lineEnd === -1 ? value.length : lineEnd)
      const insertAt = lineEnd === -1 ? value.length : lineEnd
      const newValue = value.slice(0, insertAt) + "\n" + line + value.slice(insertAt)
      applyValue(newValue)
      requestAnimationFrame(() => {
        const offset = lineEnd === -1 ? line.length + 1 : line.length + 1
        ta.selectionStart = ta.selectionEnd = start + offset
      })
      return
    }

    // Ctrl+/ — commenta/decommenta riga/selezione
    if (ctrl && e.key === "/") {
      e.preventDefault()
      const commentChar = LANG_META[lang].comment
      if (!commentChar) return
      const value = ta.value
      const selStart = ta.selectionStart
      const selEnd = ta.selectionEnd
      const lineStart = value.lastIndexOf("\n", selStart - 1) + 1
      const lineEnd = selEnd === selStart
        ? (value.indexOf("\n", selStart) === -1 ? value.length : value.indexOf("\n", selStart))
        : selEnd
      const block = value.slice(lineStart, lineEnd)
      const lines = block.split("\n")
      const allCommented = lines.every((l) => l.trimStart().startsWith(commentChar + " ") || l.trimStart().startsWith(commentChar))
      const toggled = allCommented
        ? lines.map((l) => l.replace(new RegExp(`^(\\s*)${commentChar.replace(/\//g, "\\/")} ?`), "$1")).join("\n")
        : lines.map((l) => l.replace(/^(\s*)/, `$1${commentChar} `)).join("\n")
      const delta = toggled.length - block.length
      const newValue = value.slice(0, lineStart) + toggled + value.slice(lineEnd)
      applyValue(newValue)
      requestAnimationFrame(() => {
        ta.selectionStart = selStart + (selStart > lineStart ? (allCommented ? -2 : 2) : 0)
        ta.selectionEnd = selEnd + delta
      })
      return
    }

    if (e.key === "Tab") {
      e.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const value = ta.value
      const INDENT = "  "

      if (start !== end && value.slice(start, end).includes("\n")) {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1
        const block = value.slice(lineStart, end)
        if (e.shiftKey) {
          const dedented = block.replace(/^( {1,2}|\t)/gm, "")
          const next = value.slice(0, lineStart) + dedented + value.slice(end)
          const removed = block.length - dedented.length
          applyValue(next)
          requestAnimationFrame(() => {
            ta.selectionStart = Math.max(lineStart, start - 2)
            ta.selectionEnd = end - removed
          })
        } else {
          const indented = block.replace(/^/gm, INDENT)
          const added = indented.length - block.length
          const next = value.slice(0, lineStart) + indented + value.slice(end)
          applyValue(next)
          requestAnimationFrame(() => {
            ta.selectionStart = start + INDENT.length
            ta.selectionEnd = end + added
          })
        }
      } else if (e.shiftKey) {
        const lineStart = value.lastIndexOf("\n", start - 1) + 1
        const leading = value.slice(lineStart, start).match(/ {1,2}$/)
        if (leading) {
          const cut = leading[0].length
          const next = value.slice(0, start - cut) + value.slice(start)
          applyValue(next)
          requestAnimationFrame(() => {
            ta.selectionStart = ta.selectionEnd = start - cut
          })
        }
      } else {
        const next = value.slice(0, start) + INDENT + value.slice(end)
        applyValue(next)
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = start + INDENT.length
        })
      }
    }
    const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']', '"': '"', "'": "'" }

    // auto-pairing
    if (pairs[e.key]) {
      e.preventDefault()
      const start = ta.selectionStart
      const end = ta.selectionEnd
      const value = ta.value
      const closing = pairs[e.key]
      const newValue = value.slice(0, start) + e.key + closing + value.slice(end)
      applyValue(newValue)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 1
      })
    }

    // indentation 
    if (e.key === "Enter") {
      e.preventDefault()
      const start = ta.selectionStart
      const value = ta.value
      const INDENT = "  "

      const lineStart = value.lastIndexOf("\n", start - 1) + 1
      const currentLine = value.slice(lineStart, start)
      
      const leadingSpaces = currentLine.match(/^(\s*)/)?.[1] ?? ""
      
      const trimmedLine = currentLine.trim()
      const needsExtraIndent = /[{(\[]$/.test(trimmedLine)
      
      const afterCursor = value.slice(start)
      const hasClosingBracket = /^[}\])]/.test(afterCursor)
      
      let newValue: string
      let cursorPos: number

      if (needsExtraIndent && hasClosingBracket) {
        
        const nextIndent = leadingSpaces + INDENT
        const nextLine = "\n" + nextIndent
        const closingLine = "\n" + leadingSpaces
        newValue = value.slice(0, start) + nextLine + closingLine + value.slice(start)
        cursorPos = start + nextLine.length
      } else if (needsExtraIndent) {

        const nextIndent = leadingSpaces + INDENT
        newValue = value.slice(0, start) + "\n" + nextIndent + value.slice(start)
        cursorPos = start + nextIndent.length + 1
      } else {

        newValue = value.slice(0, start) + "\n" + leadingSpaces + value.slice(start)
        cursorPos = start + leadingSpaces.length + 1
      }
      
      applyValue(newValue)
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = cursorPos
      })
    }
  }

  function applyValue(value: string) {
    setActiveContent(value)
    setDirty((prev) => {
      const next = new Set(prev)
      if (value !== (originals.current[activeId] ?? "")) next.add(activeId)
      else next.delete(activeId)
      return next
    })
    scheduleCodeSync(activeId, value)
  }

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta || !activeNode) return
    const vs = viewState.current[activeId] ?? { sel: 0, top: 0, left: 0 }
    ta.scrollTop = vs.top
    ta.scrollLeft = vs.left
    ta.selectionStart = ta.selectionEnd = Math.min(vs.sel, ta.value.length)
    if (highlightRef.current) {
      highlightRef.current.scrollTop = vs.top
      highlightRef.current.scrollLeft = vs.left
    }

    setScroll({ top: vs.top, left: vs.left })
    setActiveLine(ta.value.slice(0, vs.sel).split("\n").length)
  }, [activeId])

  useEffect(() => {
    if (!menu && !plusMenu && !exportMenu) return
    function onDown() { setMenu(null); setPlusMenu(false); setExportMenu(false); setInviteOpen(false); setLockOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { setMenu(null); setPlusMenu(false); setExportMenu(false); setInviteOpen(false); setLockOpen(false) } }
    window.addEventListener("mousedown", onDown)
    window.addEventListener("keydown", onKey)
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey) }
  }, [menu, plusMenu, exportMenu])

  useEffect(() => {
    if (!kickTarget) return
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setKickTarget(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [kickTarget])

  const [shared, setShared] = useState(false)

  function startEditName() {
    if (!isOwner) return
    setNameInput(roomName ?? "")
    setEditingName(true)
  }

  function commitNameEdit() {
    const trimmed = nameInput.trim().slice(0, 60)
    setEditingName(false)
    if (trimmed === (roomName ?? "")) return
    setRoomName(trimmed || null)
    socketRef.current?.emit("rename-room", { name: trimmed })
  }

  useEffect(() => {
    if (editingName) nameInputRef.current?.focus()
  }, [editingName])

  function shareRoom() {
    const url = `${window.location.origin}/room/${roomId}`
    navigator.clipboard?.writeText(url).catch(() => { })
    setShared(true)
    setTimeout(() => setShared(false), 2000)
  }

  async function setRoomPassword(remove = false) {
    if (!remove && lockPassword.length < 4) return
    setLockLoading(true)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/rooms/${roomId}/password`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: remove ? null : lockPassword }),
      })
      if (res.ok) {
        setLockHasPassword(!remove)
        setLockPassword("")
        if (remove) setLockOpen(false)
      }
    } finally {
      setLockLoading(false)
    }
  }

  async function generateInvite() {
    setInviteLoading(true)
    setInviteLink(null)
    try {
      const res = await fetch(`${BACKEND_URL}/auth/rooms/${roomId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ expiresIn: inviteExpiry }),
      })
      const data = await res.json()
      if (!res.ok) return
      const link = `${window.location.origin}/invite/${data.token}`
      setInviteLink(link)
      navigator.clipboard?.writeText(link).catch(() => {})
      setInviteCopied(true)
      setTimeout(() => setInviteCopied(false), 2500)
    } finally {
      setInviteLoading(false)
    }
  }

  function run() {
    if (!activeNode) return
    if (!canEdit) return
    if (!RUN_CMD[lang]) {
      setOutput([{ t: `▲ ${activeNode.name} is not an executable file.`, kind: "muted" }])
      return
    }
    if (!activeContent.trim()) {
      setOutput([{ t: "▲ File is empty. Write some code first.", kind: "muted" }])
      return
    }
    const prompts = extractInputPrompts(activeContent, lang)
    setStdinFields(prompts.map(() => ""))
    setStdinValue("")
    setStdinModal(true)
  }

  function extractInputPrompts(code: string, language: string): string[] {
    const prompts: string[] = []
    if (language === 'py') {
      for (const m of code.matchAll(/input\s*\(\s*["']([^"']*)["']\s*\)/g)) prompts.push(m[1])
    } else if (['js', 'jsx', 'ts', 'tsx'].includes(language)) {
      for (const m of code.matchAll(/(?:question|prompt)\s*\(\s*["'`]([^"'`]*)["'`]/g)) prompts.push(m[1])
    } else if (language === 'java') {
      for (const m of code.matchAll(/System\.out\.print(?:ln)?\s*\(\s*["']([^"']*)["']\s*\)/g)) prompts.push(m[1])
    }
    return prompts
  }

  function submitRun(stdin: string) {
    setStdinModal(false)
    setRunning(true)
    setProgress(true)
    setOutput([{ t: `$ ${RUN_CMD[lang]}`, kind: "info" }, { t: "Running…", kind: "muted" }])
    socketRef.current?.emit("run-code", { language: lang, code: activeContent, stdin: stdin || undefined })
    setTimeout(() => setProgress(false), 1000)
  }

  function startDrag(e: React.MouseEvent) {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = "row-resize"
    document.body.style.userSelect = "none"
  }

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const next = rect.bottom - e.clientY
      setPanelHeight(Math.min(Math.max(next, 96), rect.height - 160))
    }
    function onUp() { draggingRef.current = false; document.body.style.cursor = ""; document.body.style.userSelect = "" }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
  }, [])

  /* ------------------------------------------------------------------ */
  /* File tree rendering                                                 */
  /* ------------------------------------------------------------------ */

  const menuNode = menu ? nodes.find((n) => n.id === menu.nodeId) : null


  if (!ready || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-[#0d0d0d] font-mono text-[13px] text-neutral-500">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/20">
            <span className="text-base font-bold text-[#22c55e]">{"</>"}</span>
          </div>
          <div className="flex items-center gap-2.5">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-700 border-t-[#22c55e]" />
            <span>{ready && !user ? "Redirecting to sign in…" : "Loading room…"}</span>
          </div>
        </div>
      </div>
    )
  }

  if (knockStatus === "password-required" || knockStatus === "password-wrong") {
    return (
      <RoomPasswordScreen
        wrongPassword={knockStatus === "password-wrong"}
        onSubmit={submitRoomPassword}
      />
    )
  }

  if (knockStatus === "pending") {
    return <KnockWaitingScreen />
  }

  if (knockStatus === "denied") {
    return <KnockDeniedScreen onBack={() => router.replace("/rooms")} />
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0d0d0d] font-mono text-[13px] text-neutral-300">
      {/* ---------------- Top bar ---------------- */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-[#1e1e1e] bg-[#0a0a0a] px-3">
        {/* Left: brand + breadcrumb */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/")}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-[#1a1a1a]"
            title="Go to home"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[#22c55e]/15 ring-1 ring-inset ring-[#22c55e]/30">
              <span style={{ fontFamily: 'monospace', fontSize: '10px', fontWeight: 'bold', color: '#22c55e', lineHeight: 1, letterSpacing: '-1px' }}>{"</>"}</span>
            </div>
            <span className="font-sans text-sm font-semibold tracking-tight text-neutral-100 hidden sm:inline">Coderoom</span>
          </button>
          <span className="text-neutral-700">/</span>
          {editingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitNameEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitNameEdit()
                if (e.key === "Escape") setEditingName(false)
              }}
              placeholder="Room name…"
              maxLength={60}
              className="h-6 w-40 rounded-md border border-[#22c55e]/40 bg-[#141414] px-2 text-[12px] font-sans text-neutral-200 outline-none"
            />
          ) : isOwner ? (
            <button
              onClick={startEditName}
              className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-sans transition-colors hover:bg-[#1a1a1a]"
              title="Rename room"
            >
              <span className={roomName ? "font-medium text-neutral-200" : "text-neutral-500 italic"}>
                {roomName || "Untitled room"}
              </span>
              <RenameIcon className="h-3 w-3 text-neutral-600 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ) : (
            <span className="px-2 py-1 text-[12px] font-sans font-medium text-neutral-200">
              {roomName || "Untitled room"}
            </span>
          )}
          <span className="text-neutral-700">/</span>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(roomId).catch(() => { })
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-sans text-neutral-400 transition-colors hover:bg-[#1a1a1a] hover:text-neutral-200"
            title="Copy room ID"
          >
            <span className="text-neutral-300 font-medium">{roomId}</span>
            {copied
              ? <CheckIcon className="h-3 w-3 text-[#22c55e]" />
              : <CopyIcon className="h-3 w-3 text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity" />}
          </button>
        </div>

        {/* Right: status + actions */}
        <div className="flex items-center gap-1.5">
          {importing && (
            <div className="flex items-center gap-1.5 rounded-full border border-[#2a2a2a] bg-[#141414] py-1 pl-2 pr-2.5">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-600 border-t-neutral-300" />
              <span className="font-sans text-[11px] text-neutral-400">Importing…</span>
            </div>
          )}

          {/* connection status */}
          <div className="flex items-center gap-1.5 rounded-full border border-[#1e1e1e] bg-[#141414] py-1 pl-2 pr-2.5">
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full ${connected ? 'animate-ping bg-[#22c55e] opacity-50' : 'bg-neutral-600'}`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${connected ? 'bg-[#22c55e]' : 'bg-neutral-600'}`} />
            </span>
            <span className="font-sans text-[11px] text-neutral-500">
              {connected ? `${participants.length + 1} online` : "offline"}
            </span>
          </div>
          
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); setExportMenu((v) => !v); setMenu(null); setPlusMenu(false) }}
              title="Export"
              className="flex items-center gap-1.5 rounded-md border border-[#2a2a2a] px-2.5 py-1.5 font-sans text-[12px] text-neutral-400 transition-all hover:border-[#3a3a3a] hover:bg-[#161616] hover:text-neutral-200"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export</span>
              <ChevronIcon className="h-3 w-3 rotate-90 text-neutral-600" />
            </button>
            {exportMenu && (
              <div
                className="absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#161616] py-1 shadow-2xl shadow-black/60"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {activeNode && (
                  <MenuItem
                    icon={<DownloadIcon className="h-3.5 w-3.5" />}
                    label={`Export "${activeNode.name}"`}
                    onClick={() => { setExportMenu(false); exportActiveFile() }}
                  />
                )}
                <MenuItem
                  icon={<DownloadIcon className="h-3.5 w-3.5" />}
                  label="Export entire room (.zip)"
                  onClick={() => { setExportMenu(false); exportProject() }}
                />
              </div>
            )}
          </div>

          <button
            onClick={shareRoom}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-sans text-[12px] transition-all ${shared
              ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]"
              : "border-[#2a2a2a] text-neutral-400 hover:border-[#3a3a3a] hover:bg-[#161616] hover:text-neutral-200"
              }`}
          >
            {shared ? <CheckIcon className="h-3.5 w-3.5" /> : <ShareIcon className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{shared ? "Copied!" : "Share"}</span>
          </button>

          {isOwner && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setInviteOpen((v) => !v); setExportMenu(false); setMenu(null); setPlusMenu(false) }}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-sans text-[12px] transition-all ${inviteOpen ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]" : "border-[#2a2a2a] text-neutral-400 hover:border-[#3a3a3a] hover:bg-[#161616] hover:text-neutral-200"}`}
              >
                <UserPlusIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Invite</span>
              </button>
              {inviteOpen && (
                <div
                  className="absolute right-0 top-9 z-50 w-72 rounded-xl border border-[#2a2a2a] bg-[#161616] p-4 shadow-2xl shadow-black/60"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <p className="mb-3 font-sans text-[12px] font-semibold text-neutral-200">Invite link</p>
                  <div className="mb-3 flex gap-1.5">
                    {([["1h", 3600], ["24h", 86400], ["7d", 604800]] as [string, number][]).map(([label, val]) => (
                      <button
                        key={val}
                        onClick={() => { setInviteExpiry(val); setInviteLink(null) }}
                        className={`flex-1 rounded-lg border py-1.5 font-sans text-[11px] font-medium transition-colors ${inviteExpiry === val ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]" : "border-[#2a2a2a] text-neutral-500 hover:border-[#3a3a3a] hover:text-neutral-300"}`}
                      >{label}</button>
                    ))}
                  </div>
                  {inviteLink ? (
                    <div className="flex items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 py-2">
                      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-neutral-500">{inviteLink}</span>
                      <button
                        onClick={() => { navigator.clipboard?.writeText(inviteLink).catch(() => {}); setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000) }}
                        className="shrink-0 font-sans text-[11px] text-[#22c55e]"
                      >{inviteCopied ? "Copied!" : "Copy"}</button>
                    </div>
                  ) : (
                    <button
                      onClick={generateInvite}
                      disabled={inviteLoading}
                      className="flex h-8 w-full items-center justify-center rounded-lg bg-[#22c55e]/10 font-sans text-[12px] font-medium text-[#22c55e] transition-colors hover:bg-[#22c55e]/20 disabled:opacity-50"
                    >{inviteLoading ? "Generating…" : "Generate link"}</button>
                  )}
                </div>
              )}
            </div>
          )}

          {isOwner && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setLockOpen((v) => !v); setInviteOpen(false); setExportMenu(false); setMenu(null); setPlusMenu(false) }}
                title={lockHasPassword ? "Room password set" : "Set room password"}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-sans text-[12px] transition-all ${lockHasPassword ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : lockOpen ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]" : "border-[#2a2a2a] text-neutral-400 hover:border-[#3a3a3a] hover:bg-[#161616] hover:text-neutral-200"}`}
              >
                <LockIcon className="h-3.5 w-3.5" open={!lockHasPassword} />
                <span className="hidden sm:inline">Lock</span>
              </button>
              {lockOpen && (
                <div
                  className="absolute right-0 top-9 z-50 w-64 rounded-xl border border-[#2a2a2a] bg-[#161616] p-4 shadow-2xl shadow-black/60"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <p className="mb-1 font-sans text-[12px] font-semibold text-neutral-200">Room password</p>
                  <p className="mb-3 font-sans text-[11px] text-neutral-500">
                    {lockHasPassword ? "This room is password-protected." : "Visitors must enter this password to join."}
                  </p>
                  {lockHasPassword ? (
                    <div className="flex flex-col gap-2">
                      <input
                        type="password"
                        value={lockPassword}
                        onChange={(e) => setLockPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") setRoomPassword() }}
                        placeholder="New password"
                        className="h-8 w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 font-sans text-[12px] text-neutral-200 placeholder:text-neutral-700 outline-none focus:border-[#22c55e]/30"
                      />
                      <button
                        onClick={() => setRoomPassword()}
                        disabled={lockLoading || lockPassword.length < 4}
                        className="flex h-8 w-full items-center justify-center rounded-lg bg-[#22c55e]/10 font-sans text-[12px] font-medium text-[#22c55e] transition-colors hover:bg-[#22c55e]/20 disabled:opacity-50"
                      >{lockLoading ? "Saving…" : "Change password"}</button>
                      <button
                        onClick={() => setRoomPassword(true)}
                        disabled={lockLoading}
                        className="flex h-8 w-full items-center justify-center rounded-lg bg-red-500/10 font-sans text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                      >{lockLoading ? "Removing…" : "Remove password"}</button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <input
                        type="password"
                        value={lockPassword}
                        onChange={(e) => setLockPassword(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") setRoomPassword() }}
                        placeholder="Set password (min 4 chars)"
                        className="h-8 w-full rounded-lg border border-[#2a2a2a] bg-[#0d0d0d] px-2.5 font-sans text-[12px] text-neutral-200 placeholder:text-neutral-700 outline-none focus:border-[#22c55e]/30"
                      />
                      <button
                        onClick={() => setRoomPassword()}
                        disabled={lockLoading || lockPassword.length < 4}
                        className="flex h-8 w-full items-center justify-center rounded-lg bg-[#22c55e]/10 font-sans text-[12px] font-medium text-[#22c55e] transition-colors hover:bg-[#22c55e]/20 disabled:opacity-50"
                      >{lockLoading ? "Saving…" : "Set password"}</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <button
            onClick={() => { setChatOpen((v) => { if (!v) setUnreadCount(0); return !v }) }}
            title="Chat"
            className={`relative flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-sans text-[12px] transition-all ${chatOpen ? "border-[#22c55e]/40 bg-[#22c55e]/10 text-[#22c55e]" : "border-[#2a2a2a] text-neutral-400 hover:border-[#3a3a3a] hover:bg-[#161616] hover:text-neutral-200"}`}
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="hidden sm:inline">Chat</span>
            {unreadCount > 0 && !chatOpen && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#22c55e] px-1 text-[9px] font-bold text-[#0a0a0a]">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {canEdit && (
            <button
              onClick={run}
              disabled={running}
              className="group relative flex items-center gap-1.5 overflow-hidden rounded-md bg-[#22c55e] px-3 py-1.5 font-sans text-[12px] font-medium text-[#0a0a0a] transition-all hover:bg-[#26d066] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#0a0a0a]/30 border-t-[#0a0a0a]" />
              ) : (
                <PlayIcon className="h-3.5 w-3.5" />
              )}
              <span>{running ? "Running…" : "Run"}</span>
            </button>
          )}
        </div>
      </header>

      {/* progress bar */}
      <div className="relative z-20 h-0.5 shrink-0 overflow-hidden bg-transparent">
        {progress && <div className="run-bar absolute inset-y-0 left-0 w-full bg-[#22c55e] shadow-[0_0_8px_#22c55e]" />}
      </div>

      {/* ---------------- Body ---------------- */}
      <div className="flex min-h-0 flex-1">
        {/* sidebar */}
        <aside className="hidden w-[220px] shrink-0 flex-col border-r border-[#ffffff08] bg-[#080808] md:flex">
          <FileTree
            nodes={nodes}
            rootName={rootName}
            rootOpen={rootOpen}
            setRootOpen={setRootOpen}
            plusMenu={plusMenu}
            setPlusMenu={setPlusMenu}
            canEdit={canEdit}
            activeId={activeId}
            dirty={dirty}
            dragId={dragId}
            setDragId={setDragId}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            renaming={renaming}
            setRenaming={setRenaming}
            creating={creating}
            setCreating={setCreating}
            setMenu={setMenu}
            canMove={canMove}
            moveNode={moveNode}
            toggleFolder={toggleFolder}
            openFile={openFile}
            startCreate={startCreate}
            commitCreate={commitCreate}
            commitRename={commitRename}
            triggerImportFile={triggerImportFile}
            triggerImportZip={triggerImportZip}
            importFileInputRef={importFileInputRef}
            importZipInputRef={importZipInputRef}
            handleImportFileChange={handleImportFileChange}
            handleImportZipChange={handleImportZipChange}
            exportProject={exportProject}
          />

          {/* participants section */}
          <ParticipantList
            user={user}
            myRole={myRole}
            participants={participants}
            activeId={activeId}
            nodeName={nodeName}
            isOwner={isOwner}
            socketRef={socketRef}
            partsOpen={partsOpen}
            setPartsOpen={setPartsOpen}
            onKick={setKickTarget}
          />
        </aside>

        {/* editor + output */}
        <div ref={containerRef} className="flex min-w-0 flex-1 flex-col">
          {/* tab bar */}
          <div className="flex h-9 shrink-0 items-center overflow-x-auto border-b border-[#1a1a1a] bg-[#0a0a0a] cr-scroll">
            {openTabs.length === 0 && <span className="px-4 text-[12px] text-neutral-700">No files open</span>}
            {openTabs.map((id) => {
              const node = nodes.find((n) => n.id === id)
              if (!node) return null
              const tabLang = getLang(node.name)
              const isActive = id === activeId
              const isDirty = dirty.has(id)
              return (
                <div
                  key={id}
                  onMouseDown={() => setActiveId(id)}
                  className={`group/tab relative flex h-full shrink-0 cursor-pointer items-center gap-2 border-r border-[#161616] px-3 text-[12px] select-none transition-colors ${isActive
                    ? "bg-[#0d0d0d] text-neutral-100"
                    : "bg-[#0a0a0a] text-neutral-500 hover:bg-[#0d0d0d] hover:text-neutral-300"
                    }`}
                >
                  {isActive && <span className="absolute inset-x-0 bottom-0 h-px bg-[#22c55e]" />}
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LANG_META[tabLang].dot }} />
                  <span className="font-sans">{node.name}</span>
                  <button
                    onClick={(e) => closeTab(id, e)}
                    className="flex h-4 w-4 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-[#2a2a2a] hover:text-neutral-300"
                    aria-label={`Close ${node.name}`}
                  >
                    {isDirty ? (
                      <><span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]/80 group-hover/tab:hidden" /><CloseIcon className="hidden h-3 w-3 group-hover/tab:block" /></>
                    ) : (
                      <CloseIcon className="h-3 w-3 opacity-0 group-hover/tab:opacity-100 transition-opacity" />
                    )}
                  </button>
                </div>
              )
            })}
          </div>

          {/* editor */}
          <Editor
            activeNodeName={activeNode?.name ?? ""}
            code={code}
            lang={lang}
            lineCount={lineCount}
            highlightedCode={highlightedCode}
            canEdit={canEdit}
            activeLine={activeLine}
            activeCol={activeCol}
            scroll={scroll}
            gutterRange={gutterRange}
            remoteCursors={remoteCursors}
            dirty={dirty}
            activeId={activeId}
            textareaRef={textareaRef}
            highlightRef={highlightRef}
            gutterRef={gutterRef}
            setEditorViewportRef={setEditorViewportRef}
            onCodeChange={onCodeChange}
            onKeyDown={onKeyDown}
            syncScroll={syncScroll}
            flushCodeSync={flushCodeSync}
            updateActiveLine={updateActiveLine}
            onNewFile={() => startCreate("root", "file")}
            searchOpen={searchOpen}
            searchQuery={searchQuery}
            searchIndex={searchIndex}
            searchMatches={searchMatches}
            searchHighlights={searchHighlights}
            searchInputRef={searchInputRef}
            onSearchQueryChange={(q) => setSearchQuery(q)}
            onSearchNavigate={(dir) => {
              if (!searchMatches.length) return
              const next = (searchIndex + dir + searchMatches.length) % searchMatches.length
              setSearchIndex(next)
              goToMatch(next)
            }}
            onSearchClose={closeSearch}
          />

          {/* resize handle */}
          <div onMouseDown={startDrag} className="group relative flex h-[5px] shrink-0 cursor-row-resize items-center justify-center border-t border-[#141414] bg-[#0a0a0a] transition-colors hover:bg-[#141414]">
            <div className="h-px w-6 rounded-full bg-[#2a2a2a] transition-colors group-hover:bg-[#404040]" />
          </div>

          {/* output panel */}
          <Terminal
            output={output}
            running={running}
            outputExpanded={outputExpanded}
            setOutputExpanded={setOutputExpanded}
            setOutput={setOutput}
            panelHeight={panelHeight}
            outputEndRef={outputEndRef}
          />
        </div>
      </div>

      {/* stdin modal */}
      {stdinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setStdinModal(false)}>
          <div className="w-[460px] rounded-lg border border-[#1e1e1e] bg-[#0e0e0e] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 font-sans text-[13px] font-semibold text-neutral-200">Input del programma</p>
            {stdinFields.length > 0 ? (
              <>
                <p className="mb-3 font-sans text-[11px] text-neutral-600">Inserisci i valori richiesti dal programma.</p>
                <div className="flex flex-col gap-2">
                  {stdinFields.map((val, i) => {
                    const prompts = extractInputPrompts(activeContent, lang)
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <label className="w-40 shrink-0 truncate font-mono text-[11px] text-neutral-500">{prompts[i] || `Input ${i + 1}`}</label>
                        <input
                          autoFocus={i === 0}
                          value={val}
                          onChange={(e) => setStdinFields(prev => prev.map((v, j) => j === i ? e.target.value : v))}
                          onKeyDown={(e) => { if (e.key === "Enter") submitRun(stdinFields.join("\n")) }}
                          className="flex-1 rounded border border-[#1e1e1e] bg-[#080808] px-3 py-1.5 font-mono text-[12px] text-neutral-200 outline-none focus:border-[#2e2e2e]"
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 font-sans text-[11px] text-neutral-600">Un valore per riga, nell&apos;ordine in cui il programma li chiede. Lascia vuoto se non serve input.</p>
                <textarea
                  autoFocus
                  value={stdinValue}
                  onChange={(e) => setStdinValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submitRun(stdinValue) }}
                  placeholder={"Mario\n25"}
                  className="h-28 w-full resize-none rounded border border-[#1e1e1e] bg-[#080808] px-3 py-2 font-mono text-[12px] text-neutral-200 placeholder-neutral-700 outline-none focus:border-[#2e2e2e]"
                />
              </>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setStdinModal(false)} className="rounded px-3 py-1.5 font-sans text-[12px] text-neutral-500 hover:text-neutral-300">Cancel</button>
              <button
                onClick={() => submitRun(stdinFields.length > 0 ? stdinFields.join("\n") : stdinValue)}
                className="rounded bg-[#22c55e]/10 px-3 py-1.5 font-sans text-[12px] text-[#22c55e] hover:bg-[#22c55e]/20"
              >
                Run ↵
              </button>
            </div>
          </div>
        </div>
      )}

      {/* context menu */}
      <FileTreeContextMenu
        menu={menu}
        menuNode={menuNode}
        canEdit={canEdit}
        setMenu={setMenu}
        setRenaming={setRenaming}
        startCreate={startCreate}
        deleteNode={deleteNode}
        exportFile={exportFile}
      />

      {/* knock approval panel — visible only to owners */}
      {isOwner && (
        <KnockApprovalPanel knockQueue={knockQueue} socketRef={socketRef} setKnockQueue={setKnockQueue} />
      )}

      {/* kick confirmation modal */}
      {kickTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setKickTarget(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xs rounded-xl border border-[#2a2a2a] bg-[#161616] p-5 shadow-2xl shadow-black/60"
          >
            <h2 className="font-sans text-[14px] font-semibold text-neutral-100">Remove from room</h2>
            <p className="mt-1.5 font-sans text-[12px] leading-relaxed text-neutral-500">
              <span className="font-medium text-neutral-300">{kickTarget.name}</span> will lose access immediately and won&apos;t see this room in their list anymore.
            </p>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setKickTarget(null)}
                className="flex h-8 items-center rounded-lg px-3 font-sans text-[12px] text-neutral-500 transition-colors hover:text-neutral-300"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  socketRef.current?.emit("kick-member", { userId: kickTarget.id })
                  setKickTarget(null)
                }}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-red-500/10 px-3 font-sans text-[12px] font-medium text-red-400 transition-colors hover:bg-red-500/20"
              >
                <CloseIcon className="h-3 w-3" />
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      <ChatPanel
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        messages={chatMessages}
        onSend={sendChatMessage}
        currentUserId={user?.id}
      />

      <style>{`
        @keyframes crBlink { 0%, 50% { opacity: 1 } 50.01%, 100% { opacity: 0 } }
        @keyframes run-progress { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
        @keyframes typingDot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4 } 30% { transform: translateY(-3px); opacity: 1 } }
        .run-bar { animation: run-progress 1.2s ease-in-out infinite; }
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { scrollbar-width: none; -ms-overflow-style: none; }
        .cr-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .cr-scroll::-webkit-scrollbar-track { background: transparent; }
        .cr-scroll::-webkit-scrollbar-thumb {
          background-color: #2a2a2a;
          border-radius: 8px;
          border: 2px solid transparent;
          background-clip: padding-box;
        }
        .cr-scroll::-webkit-scrollbar-thumb:hover { background-color: #3a3a3a; }
        .cr-scroll::-webkit-scrollbar-corner { background: transparent; }
        .cr-scroll { scrollbar-width: thin; scrollbar-color: #2a2a2a transparent; }
        .scrollbar-thin::-webkit-scrollbar { width: 4px; }
        .scrollbar-thin::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-thin::-webkit-scrollbar-thumb { background-color: #2a2a2a; border-radius: 4px; }
        .scrollbar-thin { scrollbar-width: thin; scrollbar-color: #2a2a2a transparent; }
      `}</style>
    </div>
  )
}