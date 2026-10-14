"use client"

import { useEffect, useRef, useState } from "react"
import type { ChatMessage } from "@/lib/useSocket"

interface ChatPanelProps {
  open: boolean
  onClose: () => void
  messages: ChatMessage[]
  onSend: (content: string) => void
  currentUserId: string | undefined
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function Avatar({ name, src }: { name: string; src: string | null }) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className="h-6 w-6 shrink-0 rounded-full object-cover ring-1 ring-white/10"
      />
    )
  }
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1e1e1e] ring-1 ring-white/10 text-[10px] font-semibold text-[#888]">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

export default function ChatPanel({ open, onClose, messages, onSend, currentUserId }: ChatPanelProps) {
  const [draft, setDraft] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
      setTimeout(() => inputRef.current?.focus(), 120)
    }
  }, [open])

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, open])

  function send() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onSend(trimmed)
    setDraft("")
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <>
      {/* backdrop mobile */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}

      {/* panel */}
      <div
        className={`
          fixed bottom-0 right-0 z-40 flex flex-col
          h-[calc(100dvh-44px)] w-[320px]
          border-l border-white/[0.06] bg-[#0c0c0c]
          transition-transform duration-200 ease-in-out
          ${open ? "translate-x-0" : "translate-x-full"}
        `}
      >
        {/* header */}
        <div className="flex h-[44px] shrink-0 items-center gap-2 border-b border-white/[0.06] px-4">
          <svg className="h-3.5 w-3.5 text-[#4ade80]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <span className="text-[12px] font-semibold text-[#aaa]">Chat</span>
          <button
            onClick={onClose}
            className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-[#555] hover:text-[#aaa] transition-colors"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin">
          {messages.length === 0 && (
            <p className="py-8 text-center text-[11px] text-[#444]">No messages yet. Say hello!</p>
          )}
          {messages.map((msg, i) => {
            const isMe = msg.user_id === currentUserId
            const prevMsg = messages[i - 1]
            const grouped = prevMsg && prevMsg.user_id === msg.user_id && msg.created_at - prevMsg.created_at < 60
            return (
              <div key={msg.id} className={`flex gap-2 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                {!grouped ? (
                  <Avatar name={msg.user_name} src={msg.avatar} />
                ) : (
                  <div className="w-6 shrink-0" />
                )}
                <div className={`flex flex-col gap-0.5 max-w-[220px] ${isMe ? "items-end" : "items-start"}`}>
                  {!grouped && (
                    <div className={`flex items-baseline gap-1.5 ${isMe ? "flex-row-reverse" : "flex-row"}`}>
                      <span className="text-[11px] font-medium text-[#888]">{isMe ? "you" : msg.user_name}</span>
                      <span className="text-[10px] text-[#444]">{formatTime(msg.created_at)}</span>
                    </div>
                  )}
                  <div
                    className={`
                      rounded-xl px-3 py-1.5 text-[12px] leading-[1.5] break-words
                      ${isMe
                        ? "bg-[#22c55e]/15 text-[#a7f3c7] rounded-tr-sm"
                        : "bg-white/[0.05] text-[#c8c8c8] rounded-tl-sm"
                      }
                    `}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {/* input */}
        <div className="shrink-0 border-t border-white/[0.06] p-3">
          <div className="flex items-end gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2 focus-within:border-[#22c55e]/30 transition-colors">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Message…"
              rows={1}
              className="flex-1 resize-none bg-transparent text-[12px] text-[#e0e0e0] placeholder:text-[#444] outline-none max-h-[100px] leading-[1.5]"
              style={{ height: "auto" }}
              onInput={(e) => {
                const t = e.currentTarget
                t.style.height = "auto"
                t.style.height = `${Math.min(t.scrollHeight, 100)}px`
              }}
            />
            <button
              onClick={send}
              disabled={!draft.trim()}
              className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#22c55e] text-[#0a0a0a] disabled:opacity-30 hover:bg-[#26d066] transition-colors"
            >
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-[#333]">Enter to send · Shift+Enter for newline</p>
        </div>
      </div>
    </>
  )
}
