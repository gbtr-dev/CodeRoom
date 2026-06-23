"use client"

import type React from "react"
import { Fragment } from "react"
import type { FileNode, Lang } from "@/lib/highlight"
import { getLang, LANG_META } from "@/lib/highlight"
import {
  ChevronIcon, FolderIcon, FilePlusIcon, FolderPlusIcon,
  RenameIcon, TrashIcon, DownloadIcon, UploadIcon,
} from "@/components/room/Icons"
import { MenuItem, InlineEntry } from "@/components/room/FileTreeHelpers"

/**
 * Sidebar "Explorer": header con il menu "+" (nuovo file/cartella, import,
 * export) e l'albero dei file con drag&drop, rename inline e creazione
 * inline. Esporta anche FileTreeContextMenu, il menu contestuale al click
 * destro su un nodo — vive qui perché condivide stato e azioni con l'albero.
 *
 * Estratto da app/room/[id]/page.tsx, dov'era la parte più grossa del "God
 * Component" della room. Stato e logica (creazione, rename, delete, move,
 * import/export) restano nel genitore: qui arrivano solo come props, stesso
 * approccio già usato per KnockQueue e ParticipantList.
 */

export type Menu = { x: number; y: number; nodeId: string }
export type Creating = { parentId: string; kind: "file" | "folder" }

function sortNodes(list: FileNode[]) {
  return [...list].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export function FileTree({
  nodes,
  rootName,
  rootOpen,
  setRootOpen,
  plusMenu,
  setPlusMenu,
  canEdit,
  activeId,
  dirty,
  dragId,
  setDragId,
  dropTarget,
  setDropTarget,
  renaming,
  setRenaming,
  creating,
  setCreating,
  setMenu,
  canMove,
  moveNode,
  toggleFolder,
  openFile,
  startCreate,
  commitCreate,
  commitRename,
  triggerImportFile,
  triggerImportZip,
  importFileInputRef,
  importZipInputRef,
  handleImportFileChange,
  handleImportZipChange,
  exportProject,
}: {
  nodes: FileNode[]
  rootName: string
  rootOpen: boolean
  setRootOpen: (updater: boolean | ((prev: boolean) => boolean)) => void
  plusMenu: boolean
  setPlusMenu: (updater: boolean | ((prev: boolean) => boolean)) => void
  canEdit: boolean
  activeId: string
  dirty: Set<string>
  dragId: string | null
  setDragId: (id: string | null) => void
  dropTarget: string | null
  setDropTarget: (updater: string | null | ((prev: string | null) => string | null)) => void
  renaming: string | null
  setRenaming: (id: string | null) => void
  creating: Creating | null
  setCreating: (c: Creating | null) => void
  setMenu: (m: Menu | null) => void
  canMove: (id: string, targetParentId: string) => boolean
  moveNode: (id: string, targetParentId: string) => void
  toggleFolder: (id: string) => void
  openFile: (id: string) => void
  startCreate: (parentId: string, kind: "file" | "folder") => void
  commitCreate: (name: string) => void
  commitRename: (id: string, name: string) => void
  triggerImportFile: () => void
  triggerImportZip: () => void
  importFileInputRef: React.RefObject<HTMLInputElement | null>
  importZipInputRef: React.RefObject<HTMLInputElement | null>
  handleImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleImportZipChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  exportProject: () => void
}) {
  function renderTree(parentId: string, depth: number): React.ReactNode {
    const children = sortNodes(nodes.filter((n) => n.parentId === parentId))
    const pad = depth * 12
    return (
      <div className={depth > 0 ? "ml-[12px] border-l border-[#ffffff08]" : ""}>
        {children.map((node) => {
          const isRenaming = renaming === node.id
          if (node.kind === "folder") {
            return (
              <Fragment key={node.id}>
                {isRenaming ? (
                  <InlineEntry icon={<FolderIcon className="h-3.5 w-3.5 text-[#7d8590]" />} pad={pad + 8} defaultValue={node.name} onCommit={(v) => commitRename(node.id, v)} onCancel={() => setRenaming(null)} />
                ) : (
                  <div
                    onDragOver={(e) => { if (dragId && canMove(dragId, node.id)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = "move"; setDropTarget(node.id) } }}
                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((t) => (t === node.id ? null : t)) }}
                    onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragId) moveNode(dragId, node.id) }}
                  >
                    <button
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(node.id) }}
                      onDragEnd={() => { setDragId(null); setDropTarget(null) }}
                      onClick={() => toggleFolder(node.id)}
                      onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id }) }}
                      className={`group flex w-full items-center gap-1.5 rounded-md py-[4px] pr-1 text-left text-[12.5px] font-medium transition-all
                        ${dropTarget === node.id ? "bg-[#22c55e]/10 ring-1 ring-inset ring-[#22c55e]/30" : "hover:bg-[#ffffff06]"}
                        ${dragId === node.id ? "opacity-30" : ""}
                        text-neutral-300`}
                      style={{ paddingLeft: pad + 8 }}
                    >
                      <ChevronIcon className={`h-3 w-3 shrink-0 text-neutral-600 transition-transform duration-150 ${node.open ? "rotate-90" : ""}`} />
                      <FolderIcon className={`h-3.5 w-3.5 shrink-0 transition-colors ${node.open ? "text-[#eab308]/80" : "text-[#eab308]/50"}`} />
                      <span className="flex-1 truncate">{node.name}</span>
                      {canEdit && (
                        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <span role="button" tabIndex={0} aria-label="New file in folder" onClick={(e) => { e.stopPropagation(); startCreate(node.id, "file") }} className="flex h-4 w-4 items-center justify-center rounded text-neutral-600 hover:bg-[#ffffff10] hover:text-neutral-300"><FilePlusIcon className="h-3 w-3" /></span>
                          <span role="button" tabIndex={0} aria-label="New folder in folder" onClick={(e) => { e.stopPropagation(); startCreate(node.id, "folder") }} className="flex h-4 w-4 items-center justify-center rounded text-neutral-600 hover:bg-[#ffffff10] hover:text-neutral-300"><FolderPlusIcon className="h-3 w-3" /></span>
                        </span>
                      )}
                    </button>
                  </div>
                )}
                {node.open && renderTree(node.id, depth + 1)}
              </Fragment>
            )
          }
          const fileLang = getLang(node.name)
          const isActive = node.id === activeId
          return isRenaming ? (
            <InlineEntry key={node.id} icon={<span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: LANG_META[fileLang].dot }} />} pad={pad + 24} defaultValue={node.name} onCommit={(v) => commitRename(node.id, v)} onCancel={() => setRenaming(null)} />
          ) : (
            <button
              key={node.id}
              draggable
              onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(node.id) }}
              onDragEnd={() => { setDragId(null); setDropTarget(null) }}
              onClick={() => openFile(node.id)}
              onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id }) }}
              className={`group flex w-full items-center gap-2 rounded-md py-[4px] pr-2 text-left text-[12.5px] transition-all
                ${isActive
                  ? "bg-[#ffffff0d] text-neutral-100 shadow-[inset_1px_0_0_0_#22c55e60]"
                  : "text-neutral-500 hover:bg-[#ffffff05] hover:text-neutral-300"}
                ${dragId === node.id ? "opacity-30" : ""}`}
              style={{ paddingLeft: pad + 24 }}
            >
              <span className="h-[7px] w-[7px] shrink-0 rounded-full transition-opacity" style={{ backgroundColor: LANG_META[fileLang].dot, opacity: isActive ? 1 : 0.6 }} />
              <span className="truncate">{node.name}</span>
              {dirty.has(node.id) && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#22c55e]/60" />}
            </button>
          )
        })}
        {creating?.parentId === parentId && (
          <InlineEntry
            icon={creating.kind === "folder" ? <FolderIcon className="h-3.5 w-3.5 text-[#7d8590]" /> : <span className="h-2 w-2 rounded-full bg-neutral-600" />}
            pad={creating.kind === "folder" ? pad + 8 : pad + 24}
            defaultValue=""
            placeholder={creating.kind === "folder" ? "folder name" : "filename.ext"}
            onCommit={commitCreate}
            onCancel={() => setCreating(null)}
          />
        )}
      </div>
    )
  }

  return (
    <>
      {/* Explorer header */}
      <div className="flex h-9 shrink-0 items-center justify-between px-3 border-b border-[#ffffff06]">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-700">Explorer</span>
        <div className="relative">
          {canEdit && (
            <button
              onMouseDown={(e) => { e.stopPropagation(); setPlusMenu((v) => !v); setMenu(null) }}
              className="flex h-5 w-5 items-center justify-center rounded text-neutral-600 transition-colors hover:bg-[#1c1c1c] hover:text-neutral-300"
              aria-label="New file or folder"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            </button>
          )}
          {canEdit && plusMenu && (
            <div className="absolute right-0 top-6 z-50 w-48 overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#161616] py-1 shadow-2xl shadow-black/60" onMouseDown={(e) => e.stopPropagation()}>
              <MenuItem icon={<FilePlusIcon className="h-3.5 w-3.5" />} label="New File" onClick={() => startCreate("root", "file")} />
              <MenuItem icon={<FolderPlusIcon className="h-3.5 w-3.5" />} label="New Folder" onClick={() => startCreate("root", "folder")} />
              <div className="my-1 border-t border-[#232323]" />
              <MenuItem icon={<UploadIcon className="h-3.5 w-3.5" />} label="Import File" onClick={triggerImportFile} />
              <MenuItem icon={<UploadIcon className="h-3.5 w-3.5" />} label="Import Project (.zip)" onClick={triggerImportZip} />
              <div className="my-1 border-t border-[#232323]" />
              <MenuItem icon={<DownloadIcon className="h-3.5 w-3.5" />} label="Export Project (.zip)" onClick={() => { setPlusMenu(false); exportProject() }} />
            </div>
          )}
          <input ref={importFileInputRef} type="file" multiple className="hidden" onChange={handleImportFileChange} />
          <input ref={importZipInputRef} type="file" accept=".zip" className="hidden" onChange={handleImportZipChange} />
        </div>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto py-1.5 scrollbar-none px-1.5"
        onDragOver={(e) => { if (dragId && canMove(dragId, "root")) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropTarget("root") } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget((t) => (t === "root" ? null : t)) }}
        onDrop={(e) => { e.preventDefault(); if (dragId) moveNode(dragId, "root") }}
      >
        <button
          onClick={() => setRootOpen((v) => !v)}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-[5px] text-left text-[11px] font-semibold uppercase tracking-wider text-neutral-600 transition-colors hover:bg-[#ffffff06] hover:text-neutral-400 ${dropTarget === "root" ? "bg-[#22c55e]/10" : ""}`}
        >
          <ChevronIcon className={`h-2.5 w-2.5 shrink-0 text-neutral-700 transition-transform duration-150 ${rootOpen ? "rotate-90" : ""}`} />
          <span className="truncate">{rootName}</span>
        </button>
        {rootOpen && renderTree("root", 0)}
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Menu contestuale (click destro su un nodo)                          */
/* ------------------------------------------------------------------ */

export function FileTreeContextMenu({
  menu,
  menuNode,
  canEdit,
  setMenu,
  setRenaming,
  startCreate,
  deleteNode,
  exportFile,
}: {
  menu: Menu | null
  menuNode: FileNode | null | undefined
  canEdit: boolean
  setMenu: (m: Menu | null) => void
  setRenaming: (id: string | null) => void
  startCreate: (parentId: string, kind: "file" | "folder") => void
  deleteNode: (id: string) => void
  exportFile: (node: FileNode) => void
}) {
  if (!menu || !menuNode) return null

  return (
    <div
      className="fixed z-50 w-44 overflow-hidden rounded-lg border border-[#2a2a2a] bg-[#161616] py-1 shadow-2xl shadow-black/60"
      style={{ top: menu.y, left: menu.x }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menuNode.kind === "folder" && (
        <>
          <MenuItem icon={<FilePlusIcon className="h-3.5 w-3.5" />} label="New File" onClick={() => startCreate(menuNode.id, "file")} />
          <MenuItem icon={<FolderPlusIcon className="h-3.5 w-3.5" />} label="New Folder" onClick={() => startCreate(menuNode.id, "folder")} />
          <div className="my-1 border-t border-[#232323]" />
        </>
      )}
      {menuNode.kind === "file" && (
        <>
          <MenuItem icon={<DownloadIcon className="h-3.5 w-3.5" />} label="Export" onClick={() => { setMenu(null); exportFile(menuNode) }} />
          <div className="my-1 border-t border-[#232323]" />
        </>
      )}
      {canEdit && <MenuItem icon={<RenameIcon className="h-3.5 w-3.5" />} label="Rename" onClick={() => { setMenu(null); setRenaming(menuNode.id) }} />}
      {canEdit && <MenuItem icon={<TrashIcon className="h-3.5 w-3.5" />} label="Delete" danger onClick={() => deleteNode(menuNode.id)} />}
    </div>
  )
}