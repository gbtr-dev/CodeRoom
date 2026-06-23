"use client"

import type { Socket } from "socket.io-client"
import type { User } from "@/components/auth-provider"
import type { RemoteParticipant } from "@/lib/highlight"
import type { Role } from "@/lib/useSocket"
import { ChevronIcon, CloseIcon } from "@/components/room/Icons"
import { RoleBadge, RoleMenu } from "@/components/room/RoleMenu"

/**
 * Sezione "Participants" della sidebar: utente corrente + lista remoti, con
 * badge/menu di ruolo e azione di kick per l'owner.
 *
 * Estratto da app/room/[id]/page.tsx, dove viveva inline nel componente
 * della room. Lo stato resta dove era: partsOpen e il target del kick sono
 * gestiti dal genitore (il secondo perché apre un dialog di conferma
 * condiviso con altre azioni, non solo questa lista).
 */
export function ParticipantList({
  user,
  myRole,
  participants,
  activeId,
  nodeName,
  isOwner,
  socketRef,
  partsOpen,
  setPartsOpen,
  onKick,
}: {
  user: User
  myRole: Role
  participants: RemoteParticipant[]
  activeId: string | null
  nodeName: (id: string) => string
  isOwner: boolean
  socketRef: React.RefObject<Socket | null>
  partsOpen: boolean
  setPartsOpen: (updater: boolean | ((prev: boolean) => boolean)) => void
  onKick: (target: { id: string; name: string }) => void
}) {
  return (
    <div className="shrink-0 border-t border-[#1a1a1a]">
      <button
        onClick={() => setPartsOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-600 transition-colors hover:text-neutral-400"
      >
        <ChevronIcon className={`h-2.5 w-2.5 shrink-0 transition-transform duration-150 ${partsOpen ? "rotate-90" : ""}`} />
        Participants
        <span className="ml-auto rounded-full bg-[#1c1c1c] px-1.5 py-0.5 text-[10px] tabular-nums text-neutral-500 ring-1 ring-inset ring-white/5">{participants.length + 1}</span>
      </button>
      {partsOpen && (
        <ul className="max-h-56 overflow-auto px-2 pb-2.5 space-y-px cr-scroll">
          {/* current user */}
          <li className="flex items-center gap-2 rounded-md px-2 py-2 bg-[#111111]">
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#22c55e]/20 text-[10px] font-bold text-[#22c55e] ring-1 ring-inset ring-[#22c55e]/20">
              {user.avatar
                ? <img src={user.avatar} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" />
                : user.name.slice(0, 2).toUpperCase()
              }
              <span className="absolute -bottom-px -right-px z-10 h-2 w-2 rounded-full border border-[#111111] bg-[#22c55e]" />
            </span>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-sans text-[11.5px] font-medium text-neutral-100">{user.name}</span>
              <span className="text-[10px] text-neutral-600 truncate">{activeId ? nodeName(activeId) : "—"}</span>
            </div>
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <RoleBadge role={myRole} />
              <span className="text-[9px] rounded-full px-1.5 py-px bg-[#22c55e]/10 text-[#22c55e] font-sans leading-tight">you</span>
            </div>
          </li>

          {/* divider when there are remote participants */}
          {participants.length > 0 && (
            <li aria-hidden className="px-1 pt-1 pb-0.5">
              <div className="border-t border-[#1e1e1e]" />
            </li>
          )}

          {/* remote participants */}
          {participants.map((p) => (
            <li key={p.id} className="group/part flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-[#141414]">
              <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-inset ring-white/10" style={{ backgroundColor: p.avatar ? undefined : p.color }}>
                {p.avatar
                  ? <img src={p.avatar} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" />
                  : p.name.slice(0, 2).toUpperCase()
                }
                <span className="absolute -bottom-px -right-px z-10 h-2 w-2 rounded-full border border-[#0a0a0a] bg-[#22c55e]" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate font-sans text-[11.5px] font-medium text-neutral-200">{p.name}</span>
                  {p.typing && (
                    <span className="flex shrink-0 items-center gap-[2px]" aria-label="typing">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="block h-1 w-1 rounded-full bg-[#22c55e]/70"
                          style={{ animation: `typingDot 1.2s ease-in-out ${i * 0.2}s infinite` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-neutral-600 truncate">{p.fileId ? nodeName(p.fileId) : "—"}</span>
              </div>
              <div className="ml-auto flex items-center gap-1 shrink-0">
                {isOwner && p.dbUserId && p.dbRole !== "owner" ? (
                  <RoleMenu
                    currentRole={p.dbRole ?? "viewer"}
                    onChange={(role: "editor" | "viewer") => socketRef.current?.emit("set-member-role", { userId: p.dbUserId, role })}
                  />
                ) : (
                  <RoleBadge role={p.dbRole ?? "viewer"} />
                )}
                {isOwner && p.dbUserId && p.dbRole !== "owner" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onKick({ id: p.dbUserId!, name: p.name })
                    }}
                    title="Remove from room"
                    aria-label={`Remove ${p.name} from room`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-700 opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-400 group-hover/part:opacity-100"
                  >
                    <CloseIcon className="h-3 w-3" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}