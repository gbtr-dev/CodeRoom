"use client"

import type React from "react"
import type { OutputLine } from "@/lib/useSocket"
import { TerminalIcon, MaximizeIcon } from "@/components/room/Icons"

/**
 * Pannello "Output" sotto l'editor: header con stato di esecuzione e azioni
 * (expand/collapse, clear), e il log delle righe prodotte dall'esecuzione
 * del codice.
 *
 * Estratto da app/room/[id]/page.tsx, dove viveva inline nel componente
 * della room. Lo stato (output, running, outputExpanded, panelHeight) resta
 * nel genitore — l'altezza del pannello è condivisa con il resize handle
 * trascinabile sopra di esso, quindi non ha senso isolarla qui dentro.
 */
export function Terminal({
  output,
  running,
  outputExpanded,
  setOutputExpanded,
  setOutput,
  panelHeight,
  outputEndRef,
}: {
  output: OutputLine[]
  running: boolean
  outputExpanded: boolean
  setOutputExpanded: (updater: boolean | ((prev: boolean) => boolean)) => void
  setOutput: (lines: OutputLine[]) => void
  panelHeight: number
  outputEndRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      className="flex shrink-0 flex-col bg-[#080808]"
      style={{ height: outputExpanded ? "60%" : panelHeight }}
    >
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-[#141414] px-3">
        <div className="flex items-center gap-2">
          <TerminalIcon className="h-3.5 w-3.5 text-neutral-600" />
          <span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-600">Output</span>
          {running && (
            <span className="flex items-center gap-1 rounded-full bg-[#22c55e]/10 px-2 py-0.5 text-[10px] font-sans text-[#22c55e]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#22c55e]" />
              running
            </span>
          )}
          {!running && output.length > 0 && (
            <span className="text-[10px] font-sans text-neutral-700">{output.length} lines</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setOutputExpanded((v) => !v)}
            className="flex h-5 w-5 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-[#161616] hover:text-neutral-400"
            title={outputExpanded ? "Collapse" : "Expand"}
          >
            <MaximizeIcon className="h-3 w-3" />
          </button>
          <button
            onClick={() => setOutput([])}
            className="rounded px-1.5 py-0.5 font-sans text-[11px] text-neutral-600 transition-colors hover:bg-[#161616] hover:text-neutral-300"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.6] cr-scroll">
        {output.length === 0 ? (
          <p className="text-neutral-700 italic">No output yet. Press Run to execute.</p>
        ) : (
          output.map((row, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap ${row.kind === "ok"
                ? "text-[#22c55e]"
                : row.kind === "err"
                  ? "text-red-400"
                  : row.kind === "muted"
                    ? "text-neutral-600"
                    : row.kind === "info"
                      ? "text-[#60a5fa]"
                      : "text-neutral-300"
                }`}
            >
              {row.t}
            </div>
          ))
        )}
        <div ref={outputEndRef} />
      </div>
    </div>
  )
}