"use client"

import type React from "react"
import type { Lang, RemoteParticipant } from "@/lib/highlight"
import { LANG_META } from "@/lib/highlight"
import { FilePlusIcon } from "@/components/room/Icons"

export const LINE_HEIGHT = 22
export const CHAR_WIDTH = 8.4
export const GUTTER = 56
export const GUTTER_OVERSCAN = 10

export type GutterRange = { start: number; end: number }

export function Editor({
  activeNodeName,
  code,
  lang,
  lineCount,
  highlightedCode,
  canEdit,
  activeLine,
  activeCol,
  scroll,
  gutterRange,
  remoteCursors,
  dirty,
  activeId,
  textareaRef,
  highlightRef,
  gutterRef,
  setEditorViewportRef,
  onCodeChange,
  onKeyDown,
  syncScroll,
  flushCodeSync,
  updateActiveLine,
  onNewFile,
  searchOpen,
  searchQuery,
  searchIndex,
  searchMatches,
  searchHighlights,
  searchInputRef,
  onSearchQueryChange,
  onSearchNavigate,
  onSearchClose,
}: {
  activeNodeName: string
  code: string
  lang: Lang
  lineCount: number
  highlightedCode: string
  canEdit: boolean
  activeLine: number
  activeCol: number
  scroll: { top: number; left: number }
  gutterRange: GutterRange
  remoteCursors: RemoteParticipant[]
  dirty: Set<string>
  activeId: string
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  highlightRef: React.RefObject<HTMLPreElement | null>
  gutterRef: React.RefObject<HTMLDivElement | null>
  setEditorViewportRef: (el: HTMLDivElement | null) => void
  onCodeChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  syncScroll: () => void
  flushCodeSync: () => void
  updateActiveLine: () => void
  onNewFile: () => void
  searchOpen?: boolean
  searchQuery?: string
  searchIndex?: number
  searchMatches?: { start: number; end: number }[]
  searchHighlights?: { top: number; left: number; width: number; isCurrent: boolean }[]
  searchInputRef?: React.RefObject<HTMLInputElement | null>
  onSearchQueryChange?: (q: string) => void
  onSearchNavigate?: (dir: 1 | -1) => void
  onSearchClose?: () => void
}) {
  if (!activeNodeName) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[#0d0d0d]">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#22c55e]/8 ring-1 ring-inset ring-[#22c55e]/15">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-[#22c55e]/60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        </div>
        <p className="font-sans text-[13px] text-neutral-600">Open a file to start editing</p>
        <button
          onClick={onNewFile}
          className="mt-1 flex items-center gap-2 rounded-md border border-[#2a2a2a] px-3 py-1.5 font-sans text-[12px] text-neutral-400 transition-colors hover:border-[#3a3a3a] hover:bg-[#141414] hover:text-neutral-200"
        >
          <FilePlusIcon className="h-3.5 w-3.5" />
          New file
        </button>
      </div>
    )
  }

  return (
    <>
      <div
        className="relative min-h-0 flex-1 cursor-text overflow-hidden"
        style={{ background: '#0d0d0d' }}
        onMouseDown={(e) => { if (e.target !== textareaRef.current) textareaRef.current?.focus() }}
      >
        <div ref={setEditorViewportRef} className="flex h-full">
          {/* gutter */}
          <div ref={gutterRef} className="relative shrink-0 select-none overflow-hidden" style={{ width: GUTTER, background: '#0d0d0d' }} aria-hidden="true">
            <div style={{ position: 'absolute', top: 12 + gutterRange.start * LINE_HEIGHT - scroll.top, left: 0, right: 0 }}>
              {Array.from({ length: gutterRange.end - gutterRange.start }, (_, i) => {
                const lineNo = gutterRange.start + i + 1
                const isActiveLine = lineNo === activeLine
                const hasRemote = remoteCursors.some((p) => p.line === lineNo)
                return (
                  <div key={lineNo} className={`pr-4 text-right text-[12px] tabular-nums transition-colors ${isActiveLine ? "text-neutral-300" : "text-neutral-700"}`} style={{ height: LINE_HEIGHT, lineHeight: `${LINE_HEIGHT}px` }}>
                    {hasRemote ? <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#22c55e]" /> : null}
                    {lineNo}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="relative min-w-0 flex-1">
            {/* active line bg */}
            <div className="pointer-events-none absolute left-0 right-0" style={{ top: 12 + (activeLine - 1) * LINE_HEIGHT - scroll.top, height: LINE_HEIGHT, background: 'rgba(255,255,255,0.025)' }} aria-hidden="true" />
            {/* syntax highlight */}
            <pre ref={highlightRef} aria-hidden="true" className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre px-4 py-3 font-mono text-[13.5px]" style={{ lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}>
              <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
            </pre>
            {/* textarea */}
            <textarea
              ref={textareaRef}
              value={code}
              onChange={canEdit ? onCodeChange : undefined}
              onKeyDown={canEdit ? onKeyDown : undefined}
              onScroll={syncScroll}
              onBlur={canEdit ? flushCodeSync : undefined}
              onClick={updateActiveLine}
              onKeyUp={updateActiveLine}
              onFocus={updateActiveLine}
              readOnly={!canEdit}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              aria-label={`${activeNodeName} code editor${!canEdit ? " (read-only)" : ""}`}
              className={`absolute inset-0 m-0 h-full w-full resize-none overflow-auto whitespace-pre border-0 bg-transparent px-4 py-3 font-mono text-[13.5px] text-transparent outline-none cr-scroll ${canEdit ? "caret-neutral-200" : "caret-transparent"}`}
              style={{ lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}
            />
            {/* search highlights */}
            {searchHighlights?.map((h, i) => (
              <div
                key={i}
                className="pointer-events-none absolute z-10 rounded-[2px]"
                style={{
                  top: h.top,
                  left: h.left,
                  width: h.width,
                  height: LINE_HEIGHT,
                  background: h.isCurrent ? 'rgba(250,204,21,0.35)' : 'rgba(250,204,21,0.12)',
                }}
              />
            ))}
            {/* remote cursors */}
            {remoteCursors.map((p) => {
              const top = 12 + ((p.line ?? 1) - 1) * LINE_HEIGHT - scroll.top
              const left = 16 + (p.col ?? 0) * CHAR_WIDTH - scroll.left
              return (
                <div key={p.id} className="pointer-events-none absolute z-20" style={{ top, left }}>
                  <span className="absolute -top-[18px] left-0 whitespace-nowrap rounded-[3px] px-1.5 py-0.5 font-sans text-[10px] font-semibold leading-none text-white shadow-lg" style={{ backgroundColor: p.color }}>
                    {p.name.split(" ")[0]}
                  </span>
                  <span className="block w-0.5 rounded-full opacity-80" style={{ height: LINE_HEIGHT, backgroundColor: p.color }} />
                </div>
              )
            })}
          </div>
        </div>

        {/* search bar */}
        {searchOpen && (
          <div className="absolute right-3 top-2 z-30 flex items-center gap-1.5 rounded-lg border border-[#2a2a2a] bg-[#161616] px-2 py-1.5 shadow-xl shadow-black/50">
            <input
              ref={searchInputRef}
              value={searchQuery ?? ""}
              onChange={(e) => onSearchQueryChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { onSearchClose?.(); return }
                if (e.key === "Enter" && (searchMatches?.length ?? 0) > 0) {
                  e.preventDefault()
                  onSearchNavigate?.(e.shiftKey ? -1 : 1)
                }
              }}
              placeholder="Search…"
              spellCheck={false}
              className="w-36 bg-transparent font-mono text-[12px] text-neutral-200 outline-none placeholder:text-neutral-600"
            />
            <span className="shrink-0 font-sans text-[10px] tabular-nums text-neutral-600">
              {(searchMatches?.length ?? 0) > 0 ? `${(searchIndex ?? 0) + 1}/${searchMatches!.length}` : "0/0"}
            </span>
            <div className="flex gap-px">
              <button onClick={() => onSearchNavigate?.(-1)} title="Previous (Shift+Enter)" className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-[#2a2a2a] hover:text-neutral-200">↑</button>
              <button onClick={() => onSearchNavigate?.(1)}  title="Next (Enter)"           className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-[#2a2a2a] hover:text-neutral-200">↓</button>
              <button onClick={() => onSearchClose?.()} title="Close (Esc)"               className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-[#2a2a2a] hover:text-neutral-200">✕</button>
            </div>
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-[#141414] bg-[#0a0a0a] px-3">
        <div className="flex items-center gap-3 text-[11px] text-neutral-600">
          <span>{LANG_META[lang].label}</span>
          <span className="h-3 w-px bg-[#1e1e1e]" />
          <span>Ln {activeLine}, Col {activeCol + 1}</span>
          <span className="h-3 w-px bg-[#1e1e1e]" />
          <span>{lineCount} lines</span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-neutral-600">
          {!canEdit && <span className="text-[#9ca3af]/60 flex items-center gap-1">🔒 read-only</span>}
          {canEdit && dirty.has(activeId) && <span className="text-[#22c55e]/70">● modified</span>}
          <span>UTF-8</span>
        </div>
      </div>
    </>
  )
}