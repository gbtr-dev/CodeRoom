import { randomUUID } from 'crypto'
import {
  dbGetOrCreateRoom,
  dbGetFiles,
  dbCreateFile,
  dbUpdateFileContent,
  dbDeleteFile,
  type RoomRole,
} from './db'

export type FileNode = {
  id: string
  name: string
  type: 'file' | 'folder'
  content?: string
  children?: FileNode[]
  language?: string
}

export type Room = {
  id: string
  participants: Map<string, { name: string; color: string; userId?: string; role?: RoomRole; avatar?: string | null }>
  fileContent: Map<string, string>
  cacheLoaded: boolean
}

const rooms = new Map<string, Room>()

const COLORS = ['#3b82f6','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316']

function pickColor(room: Room): string {
  const used = new Set(Array.from(room.participants.values()).map((p) => p.color))
  const free = COLORS.find((c) => !used.has(c))
  if (free) return free
  // Palette exhausted: generate a unique HSL color spread evenly around the wheel
  const index = room.participants.size
  const hue = Math.round((index * 137.508) % 360) // golden-angle distribution
  return `hsl(${hue},70%,55%)`
}

const DB_FLUSH_MS = 750

const dirtyFiles = new Set<string>()
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
const fileRoomIndex = new Map<string, string>()

function getLangFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    py: 'python', go: 'go', md: 'markdown', json: 'json',
  }
  return map[ext] ?? 'plaintext'
}

function ensureCacheLoaded(room: Room) {
  if (room.cacheLoaded) return
  const rows = dbGetFiles(room.id)
  for (const row of rows) {
    if (row.kind === 'file') {
      room.fileContent.set(row.id, row.content ?? '')
      fileRoomIndex.set(row.id, room.id)
    }
  }
  room.cacheLoaded = true
}

function cancelPendingFlush(fileId: string) {
  const timer = flushTimers.get(fileId)
  if (timer) {
    clearTimeout(timer)
    flushTimers.delete(fileId)
  }
  dirtyFiles.delete(fileId)
}

function flushFileToDb(fileId: string) {
  cancelPendingFlush(fileId)
  const roomId = fileRoomIndex.get(fileId)
  if (!roomId) return
  const room = rooms.get(roomId)
  const content = room?.fileContent.get(fileId)
  if (content === undefined) return
  dbUpdateFileContent(fileId, roomId, content)
}

function scheduleDbFlush(fileId: string, roomId: string) {
  dirtyFiles.add(fileId)
  fileRoomIndex.set(fileId, roomId)

  const existing = flushTimers.get(fileId)
  if (existing) clearTimeout(existing)

  flushTimers.set(fileId, setTimeout(() => {
    flushTimers.delete(fileId)
    if (!dirtyFiles.has(fileId)) return
    dirtyFiles.delete(fileId)
    const room = rooms.get(roomId)
    const content = room?.fileContent.get(fileId)
    if (content === undefined) return
    dbUpdateFileContent(fileId, roomId, content)
  }, DB_FLUSH_MS))
}

export function flushRoomContent(roomId: string) {
  const room = rooms.get(roomId)
  if (!room) return
  for (const fileId of room.fileContent.keys()) {
    if (dirtyFiles.has(fileId)) flushFileToDb(fileId)
  }
}

export function flushAllRoomContent() {
  for (const fileId of [...dirtyFiles]) flushFileToDb(fileId)
}

export function getOrCreateRoom(roomId: string): Room {
  dbGetOrCreateRoom(roomId)
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      fileContent: new Map(),
      cacheLoaded: false,
    })
  }
  return rooms.get(roomId)!
}

export function getRoomFiles(roomId: string): FileNode[] {
  const room = getOrCreateRoom(roomId)
  const rows = dbGetFiles(roomId)
  for (const row of rows) {
    if (!room.cacheLoaded && row.kind === 'file') {
      room.fileContent.set(row.id, row.content ?? '')
      fileRoomIndex.set(row.id, roomId)
    }
  }
  room.cacheLoaded = true
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.kind,
    content: row.kind === 'file' ? (room.fileContent.get(row.id) ?? row.content) : undefined,
    language: getLangFromName(row.name),
    parentId: row.parent_id,
  })) as any
}

export function getFileContent(roomId: string, fileId: string): string {
  const room = getOrCreateRoom(roomId)
  ensureCacheLoaded(room)
  return room.fileContent.get(fileId) ?? ''
}

export function addParticipant(roomId: string, socketId: string, name: string, userId?: string, role?: RoomRole, avatar?: string | null) {
  const room = getOrCreateRoom(roomId)
  const color = pickColor(room)
  room.participants.set(socketId, { name, color, userId, role, avatar })
  return { name, color, userId, role, avatar }
}

export function removeParticipant(roomId: string, socketId: string) {
  const room = rooms.get(roomId)
  if (!room) return
  room.participants.delete(socketId)
  if (room.participants.size === 0) {
    flushRoomContent(roomId)
    rooms.delete(roomId)
  }
}

/**
 * Restituisce true se il file appartiene davvero a roomId e l'update è
 * stato applicato. `room.fileContent` è popolato solo con i file (non le
 * cartelle) effettivamente caricati per QUESTA room — quindi un fileId
 * sconosciuto al momento del check (perché appartiene a un'altra room, o
 * è una cartella, o non esiste) viene scartato qui, prima ancora di
 * toccare il DB.
 */
export function updateFileContent(roomId: string, fileId: string, content: string): boolean {
  const room = getOrCreateRoom(roomId)
  ensureCacheLoaded(room)
  if (!room.fileContent.has(fileId)) return false
  room.fileContent.set(fileId, content)
  fileRoomIndex.set(fileId, roomId)
  scheduleDbFlush(fileId, roomId)
  return true
}

/** Restituisce il nuovo contenuto, o null se il file non appartiene a roomId. */
export function applyFilePatch(
  roomId: string,
  fileId: string,
  start: number,
  deleteCount: number,
  insert: string,
): string | null {
  const room = getOrCreateRoom(roomId)
  ensureCacheLoaded(room)
  if (!room.fileContent.has(fileId)) return null
  const current = room.fileContent.get(fileId) ?? ''
  const updated = current.slice(0, start) + insert + current.slice(start + deleteCount)
  updateFileContent(roomId, fileId, updated)
  return updated
}

export function createFile(roomId: string, parentId: string | null, name: string, type: 'file' | 'folder', content?: string) {
  const id = randomUUID()
  const node = {
    id,
    name,
    kind: type,
    parentId: parentId ?? 'root',
    content: type === 'file' ? (content ?? '') : undefined,
  }
  dbCreateFile(roomId, node)

  const room = getOrCreateRoom(roomId)
  if (type === 'file') {
    room.fileContent.set(id, content ?? '')
    fileRoomIndex.set(id, roomId)
  }

  return {
    id,
    name,
    type,
    content: node.content,
    language: getLangFromName(name),
    parentId: node.parentId,
  }
}

function removeFileFromCache(fileId: string, room?: Room) {
  cancelPendingFlush(fileId)
  room?.fileContent.delete(fileId)
  fileRoomIndex.delete(fileId)
}

/** Restituisce true se il file apparteneva a roomId ed è stato cancellato. */
export function deleteFile(roomId: string, fileId: string): boolean {
  const room = getOrCreateRoom(roomId)
  ensureCacheLoaded(room)
  const rows = dbGetFiles(roomId)

  // fileId deve essere effettivamente uno dei file/cartelle di QUESTA room.
  // Senza questo controllo, un fileId di un'altra room non avrebbe
  // discendenti da trovare qui (i `rows` sono già scoped a roomId), ma
  // verrebbe comunque passato a dbDeleteFile come unico elemento — il che
  // un tempo cancellava il file altrui, perché dbDeleteFile non
  // verificava room_id.
  if (!rows.some((row) => row.id === fileId)) return false

  const toRemove = new Set<string>([fileId])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (toRemove.has(row.parent_id) && !toRemove.has(row.id)) {
        toRemove.add(row.id)
        changed = true
      }
    }
  }
  for (const id of toRemove) removeFileFromCache(id, room)

  // Pass all IDs: the DB CTE would handle it alone, but using the
  // already-collected set avoids a second recursive scan in SQLite.
  // dbDeleteFile is still scoped to room_id as defense-in-depth.
  dbDeleteFile([...toRemove], roomId)
  return true
}

export function removeRoom(roomId: string) {
  flushRoomContent(roomId)
  rooms.delete(roomId)
}

export function hasOnlineOwner(roomId: string): boolean {
  const room = rooms.get(roomId)
  if (!room) return false
  return Array.from(room.participants.values()).some(p => p.role === 'owner')
}