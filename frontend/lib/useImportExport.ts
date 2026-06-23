import type React from "react"
import { useRef, useState } from "react"
import JSZip from "jszip"
import type { Socket } from "socket.io-client"
import type { FileNode } from "./highlight"

/**
 * Tutta la logica di import/export file e progetto: export di un singolo
 * file, export dell'intero progetto come .zip, import di uno o più file
 * sciolti, e import di un intero .zip (con parsing della struttura cartelle,
 * filtro dei file binari/lock-file, e un singolo round-trip al server per
 * crearli tutti).
 *
 * Estratto da app/room/[id]/page.tsx, dove viveva mischiato con file tree,
 * editor e socket nello stesso componente. Le dipendenze (socket, file tree,
 * nome stanza) restano di proprietà del genitore e arrivano come argomenti:
 * stesso approccio già usato per useSocket, qui applicato a un dominio più
 * piccolo e isolato (non tocca lo stato dell'editor né i listener socket).
 */

export interface UseImportExportArgs {
  socketRef: React.RefObject<Socket | null>
  nodes: FileNode[]
  roomName: string | null
  rootName: string
  /** Ref condiviso con useSocket: durante l'import sospende l'auto-apertura dei file creati. */
  importingRef: { current: boolean }
  /** Apre un file nell'editor dopo un import riuscito. */
  openFile: (id: string) => void
}

export interface UseImportExportResult {
  importing: boolean
  importFileInputRef: React.RefObject<HTMLInputElement | null>
  importZipInputRef: React.RefObject<HTMLInputElement | null>
  exportFile: (node: FileNode) => void
  exportActiveFile: (activeNode: FileNode | undefined) => void
  exportProject: () => Promise<void>
  triggerImportFile: () => void
  triggerImportZip: () => void
  handleImportFileChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
  handleImportZipChange: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>
}

// Estensioni binarie / illeggibili in un editor di testo — saltate durante
// l'import di un .zip.
const SKIP_EXT = new Set([
  ".db", ".db-shm", ".db-wal", ".sqlite", ".sqlite3",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm",
  ".exe", ".dll", ".so", ".dylib", ".bin",
  ".lock", // package-lock.json is fine, but pnpm-lock.yaml / yarn.lock are huge noise
])
const SKIP_NAME = ["__MACOSX", ".DS_Store", "node_modules", ".next", ".git", "dist", "build"]

export function useImportExport({
  socketRef,
  nodes,
  roomName,
  rootName,
  importingRef,
  openFile,
}: UseImportExportArgs): UseImportExportResult {
  const [importing, setImporting] = useState(false)

  const importFileInputRef = useRef<HTMLInputElement>(null)
  const importZipInputRef = useRef<HTMLInputElement>(null)

  // Crea un file/cartella sul server e attende l'id reale assegnato dal
  // backend. Lo stato locale (`nodes`) viene aggiornato automaticamente dal
  // listener "file-created" registrato in useSocket, quindi qui ci limitiamo
  // a risolvere la promise per poter incatenare le creazioni (es. cartelle
  // annidate durante un import).
  function createFileAsync(
    parentId: string | null,
    name: string,
    kind: "file" | "folder",
    content?: string,
  ): Promise<{ id: string; name: string; type: "file" | "folder"; content?: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`File creation timed out: ${name}`)), 15_000)
      socketRef.current?.emit("create-file", { parentId, name, type: kind, content }, (node: any) => {
        clearTimeout(timer)
        resolve(node)
      })
    })
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  function exportFile(node: FileNode) {
    if (node.kind !== "file") return
    const blob = new Blob([node.content ?? ""], { type: "text/plain;charset=utf-8" })
    downloadBlob(blob, node.name)
  }

  function exportActiveFile(activeNode: FileNode | undefined) {
    if (!activeNode) return
    exportFile(activeNode)
  }

  async function exportProject() {
    const zip = new JSZip()

    function addNode(node: FileNode, target: JSZip) {
      if (node.kind === "folder") {
        const folder = target.folder(node.name)
        if (!folder) return
        nodes.filter((n) => n.parentId === node.id).forEach((child) => addNode(child, folder))
      } else {
        target.file(node.name, node.content ?? "")
      }
    }

    nodes.filter((n) => n.parentId === "root").forEach((node) => addNode(node, zip))

    const blob = await zip.generateAsync({ type: "blob" })
    const baseName = (roomName?.trim() || rootName.replace(/\/$/, "") || "coderoom-project").replace(/[\\/:*?"<>|]/g, "-")
    downloadBlob(blob, `${baseName}.zip`)
  }

  function triggerImportFile() {
    importFileInputRef.current?.click()
  }

  function triggerImportZip() {
    importZipInputRef.current?.click()
  }

  async function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ""
    if (files.length === 0) return
    importingRef.current = true
    setImporting(true)
    try {
      let firstId: string | null = null
      for (const file of files) {
        const content = await file.text()
        const node = await createFileAsync(null, file.name, "file", content)
        if (!firstId) firstId = node.id
      }
      if (firstId) openFile(firstId)
    } catch (err) {
      console.error("[import] File import failed:", err)
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }

  async function handleImportZipChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    importingRef.current = true
    setImporting(true)
    try {
      const zip = await JSZip.loadAsync(file)

      const filePaths: string[] = []
      const folderPaths = new Set<string>()

      Object.keys(zip.files).forEach((rawPath) => {
        if (SKIP_NAME.some((s) => rawPath.includes(s))) return
        const entry = zip.files[rawPath]
        const clean = rawPath.replace(/\/+$/, "")
        if (!clean) return

        if (entry.dir) {
          folderPaths.add(clean)
        } else {
          const ext = clean.includes(".") ? "." + clean.split(".").pop()!.toLowerCase() : ""
          if (SKIP_EXT.has(ext)) return
          // Skip files that look like lock files even without matching extension
          const basename = clean.split("/").pop() ?? ""
          if (basename === "pnpm-lock.yaml" || basename === "yarn.lock") return
          filePaths.push(clean)
          // Ensure all ancestor folders are registered
          const segments = clean.split("/")
          for (let i = 1; i < segments.length; i++) folderPaths.add(segments.slice(0, i).join("/"))
        }
      })

      // Build the entry list ordered so parents always come before children.
      // We assign temporary IDs client-side; the backend resolves them to real UUIDs.
      let tempCounter = 0
      const nextTempId = () => `tmp-${++tempCounter}`

      const pathToTempId: Record<string, string> = {}
      type ImportEntry = { tempId: string; parentTempId: string | null; name: string; type: "file" | "folder"; content?: string }
      const entries: ImportEntry[] = []

      const sortedFolders = Array.from(folderPaths).sort((a, b) => a.split("/").length - b.split("/").length)
      for (const folderPath of sortedFolders) {
        const segments = folderPath.split("/")
        const name = segments[segments.length - 1]
        const parentPath = segments.slice(0, -1).join("/")
        const tempId = nextTempId()
        pathToTempId[folderPath] = tempId
        entries.push({ tempId, parentTempId: parentPath ? pathToTempId[parentPath] ?? null : null, name, type: "folder" })
      }

      let firstFileTempId: string | null = null
      for (const filePath of filePaths.sort()) {
        const content = await zip.files[filePath].async("string")
        const segments = filePath.split("/")
        const name = segments[segments.length - 1]
        const parentPath = segments.slice(0, -1).join("/")
        const tempId = nextTempId()
        pathToTempId[filePath] = tempId
        entries.push({ tempId, parentTempId: parentPath ? pathToTempId[parentPath] ?? null : null, name, type: "file", content })
        if (!firstFileTempId) firstFileTempId = tempId
      }

      if (entries.length === 0) return

      // Single round-trip: send everything at once
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ZIP import timed out")), 30_000)
        socketRef.current?.emit("import-zip", { entries }, (idMap: Record<string, string>) => {
          clearTimeout(timer)
          // files-imported event already updated nodes for all clients;
          // just open the first file for the importer
          if (firstFileTempId) {
            const firstRealId = idMap[firstFileTempId]
            if (firstRealId) openFile(firstRealId)
          }
          resolve()
        })
      })
    } catch (err) {
      console.error("[import] ZIP import failed:", err)
    } finally {
      importingRef.current = false
      setImporting(false)
    }
  }

  return {
    importing,
    importFileInputRef,
    importZipInputRef,
    exportFile,
    exportActiveFile,
    exportProject,
    triggerImportFile,
    triggerImportZip,
    handleImportFileChange,
    handleImportZipChange,
  }
}