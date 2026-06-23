import type React from "react"
import type { Socket } from "socket.io-client"
import type { FileNode } from "./highlight"
import type { Creating, Menu } from "@/components/room/FileTree"

/**
 * Le mutazioni del file tree: toggle di una cartella, creazione, rename,
 * delete e move (drag&drop) di file/cartelle. Ogni mutazione aggiorna prima
 * lo stato locale (`nodes`) in modo ottimistico, poi notifica il server via
 * socket — gli altri client convergono sullo stesso stato tramite gli
 * eventi "file-created/renamed/deleted/moved" gestiti in useSocket.
 *
 * Estratto da app/room/[id]/page.tsx, dove viveva mischiato con editor,
 * import/export e socket nello stesso componente. Lo stato dei tab aperti
 * (openTabs/activeId) resta di proprietà del genitore — arriva qui solo
 * perché deleteNode deve chiudere i tab dei file cancellati — così come
 * dragId/dropTarget e i popup di menu/creazione/rename, che sono UI dello
 * stesso file tree ma vivono nel genitore insieme al resto dei popup della
 * pagina (context menu, plus menu, export menu).
 */

export interface UseFileTreeArgs {
  nodes: FileNode[]
  setNodes: (updater: FileNode[] | ((prev: FileNode[]) => FileNode[])) => void
  socketRef: React.RefObject<Socket | null>
  openTabs: string[]
  setOpenTabs: (updater: string[] | ((prev: string[]) => string[])) => void
  activeId: string
  setActiveId: (id: string) => void
  creating: Creating | null
  setCreating: (c: Creating | null) => void
  setRenaming: (id: string | null) => void
  setMenu: (m: Menu | null) => void
  setPlusMenu: (updater: boolean | ((prev: boolean) => boolean)) => void
  setDragId: (id: string | null) => void
  setDropTarget: (updater: string | null | ((prev: string | null) => string | null)) => void
}

export interface UseFileTreeResult {
  toggleFolder: (id: string) => void
  startCreate: (parentId: string, kind: "file" | "folder") => void
  commitCreate: (name: string) => void
  commitRename: (id: string, name: string) => void
  deleteNode: (id: string) => void
  canMove: (id: string, targetParentId: string) => boolean
  moveNode: (id: string, targetParentId: string) => void
}

export function useFileTree({
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
}: UseFileTreeArgs): UseFileTreeResult {
  function toggleFolder(id: string) {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, open: !n.open } : n)))
  }

  function startCreate(parentId: string, kind: "file" | "folder") {
    setMenu(null)
    setPlusMenu(false)
    if (parentId !== "root") setNodes((prev) => prev.map((n) => (n.id === parentId ? { ...n, open: true } : n)))
    setCreating({ parentId, kind })
  }

  function commitCreate(name: string) {
    const c = creating
    setCreating(null)
    if (!c || !name.trim()) return
    socketRef.current?.emit("create-file", { parentId: c.parentId === "root" ? null : c.parentId, name: name.trim(), type: c.kind })
  }

  function commitRename(id: string, name: string) {
    setRenaming(null)
    const trimmed = name.trim()
    if (!trimmed) return
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, name: trimmed } : n)))
    socketRef.current?.emit("rename-file", { fileId: id, name: trimmed })
  }

  function deleteNode(id: string) {
    setMenu(null)
    const toRemove = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      for (const n of nodes) {
        if (toRemove.has(n.parentId) && !toRemove.has(n.id)) {
          toRemove.add(n.id)
          changed = true
        }
      }
    }
    setNodes((prev) => prev.filter((n) => !toRemove.has(n.id)))
    const idx = openTabs.findIndex((t) => toRemove.has(t))
    const remaining = openTabs.filter((t) => !toRemove.has(t))
    setOpenTabs(remaining)
    if (toRemove.has(activeId)) {
      setActiveId(remaining[idx] ?? remaining[remaining.length - 1] ?? "")
    }
    socketRef.current?.emit("delete-file", { fileId: id })
  }

  function descendantsOf(id: string) {
    const set = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      for (const n of nodes) {
        if (set.has(n.parentId) && !set.has(n.id)) {
          set.add(n.id)
          changed = true
        }
      }
    }
    return set
  }

  // Optimistic client-side guard for drag-drop UX. The server always
  // re-validates the move in dbMoveFile, so a stale local tree can't
  // cause actual data corruption — only a spurious optimistic update
  // that gets corrected on the next server broadcast.
  function canMove(id: string, targetParentId: string) {
    const node = nodes.find((n) => n.id === id)
    if (!node) return false
    if (node.parentId === targetParentId) return false
    if (node.kind === "folder" && descendantsOf(id).has(targetParentId)) return false
    return true
  }

  function moveNode(id: string, targetParentId: string) {
    setDragId(null)
    setDropTarget(null)
    if (!canMove(id, targetParentId)) return
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id
          ? { ...n, parentId: targetParentId }
          : n.id === targetParentId && n.kind === "folder"
            ? { ...n, open: true }
            : n,
      ),
    )
    socketRef.current?.emit("move-file", { fileId: id, parentId: targetParentId })
  }

  return {
    toggleFolder,
    startCreate,
    commitCreate,
    commitRename,
    deleteNode,
    canMove,
    moveNode,
  }
}