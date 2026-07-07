import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.join(process.cwd(), 'coderoom.db')
const db = new Database(DB_PATH)

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    name TEXT,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS room_members (
    user_id TEXT NOT NULL,
    room_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'editor', 'viewer')),
    last_seen INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, room_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('file', 'folder')),
    parent_id TEXT NOT NULL DEFAULT 'root',
    content TEXT DEFAULT '',
    is_open INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
  );

  -- Sessioni di login: 'id' è il token opaco generato lato server e usato
  -- come valore del cookie httpOnly. Niente JWT: la validità di un token
  -- si verifica con una lookup qui, il che rende le sessioni revocabili
  -- (logout, cambio password) — cosa impossibile con un JWT stateless.
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  -- room_members has a composite PK (user_id, room_id), which SQLite indexes
  -- automatically and covers lookups by user_id alone (e.g. dbGetUserRooms).
  -- It does NOT cover lookups by room_id alone (e.g. dbGetRoomMembers,
  -- dbDeleteRoom), since room_id is the second column of that PK.
  CREATE INDEX IF NOT EXISTS idx_room_members_room_id ON room_members(room_id);

  -- files is queried frequently by room_id (dbGetFiles, dbDeleteRoom) but
  -- only has an index on its own PK (id).
  CREATE INDEX IF NOT EXISTS idx_files_room_id ON files(room_id);

  -- files.parent_id is walked by the recursive CTE in dbDeleteFile and by
  -- any tree-navigation queries, so it benefits from an index too.
  CREATE INDEX IF NOT EXISTS idx_files_parent_id ON files(parent_id);

  -- users.email already has an implicit unique index from the UNIQUE
  -- constraint above, so no extra index is needed there.

  -- sessions is looked up by its PK (id, the opaque token) on every
  -- authenticated request, and scanned by user_id on logout-all/password
  -- change and by expires_at during cleanup.
  CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS login_attempts (
    email TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0,
    first_attempt_at INTEGER NOT NULL,
    locked_until INTEGER
  );

  CREATE TABLE IF NOT EXISTS invites (
    token TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_invites_room_id ON invites(room_id);

  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT,
    user_name TEXT NOT NULL,
    avatar TEXT,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
`)

// Migration: add `avatar` column to users table if it doesn't exist yet
const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]
if (!userColumns.some((c) => c.name === 'avatar')) {
  db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`)
}

// Migration: add `name` and `password_hash` columns to rooms table if they don't exist yet
const roomColumns = db.prepare(`PRAGMA table_info(rooms)`).all() as { name: string }[]
if (!roomColumns.some((c) => c.name === 'name')) {
  db.exec(`ALTER TABLE rooms ADD COLUMN name TEXT`)
}
if (!roomColumns.some((c) => c.name === 'password_hash')) {
  db.exec(`ALTER TABLE rooms ADD COLUMN password_hash TEXT`)
}

// Migration: add `role` column to room_members if it doesn't exist yet
const memberColumns = db.prepare(`PRAGMA table_info(room_members)`).all() as { name: string }[]
if (!memberColumns.some((c) => c.name === 'role')) {
  db.exec(`ALTER TABLE room_members ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'editor', 'viewer'))`)
  // Promote existing members of rooms they created to owner
  db.exec(`
    UPDATE room_members SET role = 'owner'
    WHERE (user_id, room_id) IN (
      SELECT created_by, id FROM rooms WHERE created_by IS NOT NULL
    )
  `)
}

/* ------------------------------------------------------------------ */
/* Prepared statements                                                 */
/* ------------------------------------------------------------------ */

// Rooms
const stmtSelectRoomId = db.prepare('SELECT id FROM rooms WHERE id = ?')
const stmtInsertRoomIdOnly = db.prepare('INSERT INTO rooms (id) VALUES (?)')
const stmtUpdateRoomName = db.prepare('UPDATE rooms SET name = ? WHERE id = ?')
const stmtSelectRoom = db.prepare('SELECT id, name, created_by, created_at, password_hash FROM rooms WHERE id = ?')
const stmtSetRoomPassword = db.prepare('UPDATE rooms SET password_hash = ? WHERE id = ?')
const stmtClearRoomPassword = db.prepare('UPDATE rooms SET password_hash = NULL WHERE id = ?')
const stmtInsertRoom = db.prepare('INSERT OR IGNORE INTO rooms (id, created_by, name) VALUES (?, ?, ?)')
const stmtDeleteRoomById = db.prepare('DELETE FROM rooms WHERE id = ?')

// Files
const stmtSelectFilesByRoom = db.prepare('SELECT * FROM files WHERE room_id = ? ORDER BY created_at ASC')
const stmtInsertFile = db.prepare(`
  INSERT OR IGNORE INTO files (id, room_id, name, kind, parent_id, content)
  VALUES (?, ?, ?, ?, ?, ?)
`)

const stmtUpdateFileContent = db.prepare('UPDATE files SET content = ? WHERE id = ? AND room_id = ?')
const stmtRenameFile = db.prepare('UPDATE files SET name = ? WHERE id = ? AND room_id = ?')

const stmtMoveFile = db.prepare(`
  UPDATE files
  SET parent_id = ?
  WHERE id = ? AND room_id = ?
    AND (
      ? = 'root'
      OR EXISTS (
        SELECT 1 FROM files p WHERE p.id = ? AND p.room_id = ? AND p.kind = 'folder'
      )
    )
`)

const stmtGetDescendants = db.prepare(`
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM files WHERE id = ? AND room_id = ?
    UNION ALL
    SELECT f.id FROM files f
    INNER JOIN descendants d ON f.parent_id = d.id
  )
  SELECT id FROM descendants
`)
const stmtDeleteFileTree = db.prepare(`
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM files WHERE id = ? AND room_id = ?
    UNION ALL
    SELECT f.id FROM files f
    INNER JOIN descendants d ON f.parent_id = d.id
  )
  DELETE FROM files WHERE id IN (SELECT id FROM descendants)
`)
const stmtDeleteFilesByRoom = db.prepare('DELETE FROM files WHERE room_id = ?')

const deleteFilesByIdsCache = new Map<number, Database.Statement>()
function getDeleteFilesByIdsStmt(count: number) {
  let stmt = deleteFilesByIdsCache.get(count)
  if (!stmt) {
    const placeholders = Array(count).fill('?').join(', ')
    stmt = db.prepare(`DELETE FROM files WHERE id IN (${placeholders}) AND room_id = ?`)
    deleteFilesByIdsCache.set(count, stmt)
  }
  return stmt
}

// Users
const stmtInsertUser = db.prepare(`
  INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)
`)
const stmtSelectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?')
const stmtSelectUserById = db.prepare('SELECT id, name, email, avatar, created_at FROM users WHERE id = ?')
const stmtSetUserAvatar = db.prepare('UPDATE users SET avatar = ? WHERE id = ?')
const stmtClearUserAvatar = db.prepare('UPDATE users SET avatar = NULL WHERE id = ?')
const stmtUpdateUserName = db.prepare('UPDATE users SET name = ? WHERE id = ?')
const stmtUpdateUserEmail = db.prepare('UPDATE users SET email = ? WHERE id = ?')
const stmtUpdateUserPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
const stmtDeleteUserById = db.prepare('DELETE FROM users WHERE id = ?')
const stmtSelectOwnedRooms = db.prepare(
  `SELECT room_id FROM room_members WHERE user_id = ? AND role = 'owner'`
)
const stmtDeleteNonOwnerMemberships = db.prepare(
  `DELETE FROM room_members WHERE user_id = ? AND role != 'owner'`
)

// Sessions
const stmtInsertSession = db.prepare(`
  INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
`)
const stmtSelectSession = db.prepare('SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?')
const stmtDeleteSessionById = db.prepare('DELETE FROM sessions WHERE id = ?')
const stmtDeleteSessionsByUser = db.prepare('DELETE FROM sessions WHERE user_id = ?')
const stmtDeleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
const stmtDeleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
const stmtPruneUserSessions = db.prepare(`
  DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
    SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  )
`)

// Login attempts
const stmtGetLoginAttempt = db.prepare('SELECT count, first_attempt_at, locked_until FROM login_attempts WHERE email = ?')
const stmtUpsertLoginAttempt = db.prepare(`
  INSERT INTO login_attempts (email, count, first_attempt_at, locked_until)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET count = ?, first_attempt_at = ?, locked_until = ?
`)
const stmtDeleteLoginAttempt = db.prepare('DELETE FROM login_attempts WHERE email = ?')
const stmtDeleteExpiredLoginAttempts = db.prepare(
  'DELETE FROM login_attempts WHERE locked_until IS NULL AND first_attempt_at < ?'
)

// Invites
const stmtInsertInvite = db.prepare(
  'INSERT INTO invites (token, room_id, created_by, expires_at) VALUES (?, ?, ?, ?)'
)
const stmtGetInvite = db.prepare(`
  SELECT i.token, i.room_id, i.created_by, i.expires_at, r.name AS room_name, r.password_hash
  FROM invites i
  JOIN rooms r ON r.id = i.room_id
  WHERE i.token = ? AND i.expires_at > unixepoch()
`)
const stmtDeleteInvite = db.prepare('DELETE FROM invites WHERE token = ?')
const stmtDeleteExpiredInvites = db.prepare('DELETE FROM invites WHERE expires_at <= unixepoch()')
const stmtDeleteRoomInvites = db.prepare('DELETE FROM invites WHERE room_id = ?')

// Room members
const stmtUpsertRoomMember = db.prepare(`
  INSERT INTO room_members (user_id, room_id, role, last_seen)
  VALUES (?, ?, ?, unixepoch())
  ON CONFLICT(user_id, room_id) DO UPDATE SET last_seen = unixepoch()
`)
const stmtSelectIsRoomMember = db.prepare('SELECT 1 FROM room_members WHERE user_id = ? AND room_id = ?')
const stmtDeleteMembersByRoom = db.prepare('DELETE FROM room_members WHERE room_id = ?')
const stmtSelectMemberRole = db.prepare('SELECT role FROM room_members WHERE user_id = ? AND room_id = ?')
const stmtUpdateMemberRole = db.prepare('UPDATE room_members SET role = ? WHERE user_id = ? AND room_id = ?')
const stmtSelectRoomMembers = db.prepare(`
  SELECT u.id, u.name, rm.role, rm.last_seen
  FROM room_members rm
  JOIN users u ON u.id = rm.user_id
  WHERE rm.room_id = ?
  ORDER BY CASE rm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, rm.last_seen DESC
`)
const stmtDeleteMember = db.prepare('DELETE FROM room_members WHERE user_id = ? AND room_id = ?')

const ROOMS_PAGE_SIZE = 20

const stmtSelectUserRooms = db.prepare(`
  SELECT r.id, r.name, r.created_at, rm.last_seen, rm.role
  FROM room_members rm
  JOIN rooms r ON r.id = rm.room_id
  WHERE rm.user_id = ?
  ORDER BY rm.last_seen DESC
  LIMIT ${ROOMS_PAGE_SIZE + 1}
`)
const stmtSelectUserRoomsWithCursor = db.prepare(`
  SELECT r.id, r.name, r.created_at, rm.last_seen, rm.role
  FROM room_members rm
  JOIN rooms r ON r.id = rm.room_id
  WHERE rm.user_id = ? AND rm.last_seen < ?
  ORDER BY rm.last_seen DESC
  LIMIT ${ROOMS_PAGE_SIZE + 1}
`)

/* ------------------------------------------------------------------ */
/* Room queries                                                        */
/* ------------------------------------------------------------------ */

export function dbGetOrCreateRoom(roomId: string) {
  const existing = stmtSelectRoomId.get(roomId)
  if (!existing) {
    stmtInsertRoomIdOnly.run(roomId)
  }
}

export function dbDeleteRoom(roomId: string) {
  const tx = db.transaction((id: string) => {
    stmtDeleteFilesByRoom.run(id)
    stmtDeleteMembersByRoom.run(id)
    stmtDeleteRoomById.run(id)
  })
  tx(roomId)
}

export function dbSetRoomName(roomId: string, name: string) {
  const trimmed = name.trim().slice(0, 60)
  stmtUpdateRoomName.run(trimmed || null, roomId)
  return trimmed || null
}

export function dbGetRoom(roomId: string) {
  return stmtSelectRoom.get(roomId) as {
    id: string; name: string | null; created_by: string | null; created_at: number; password_hash: string | null
  } | undefined
}

export function dbSetRoomPassword(roomId: string, hash: string) {
  stmtSetRoomPassword.run(hash, roomId)
}

export function dbClearRoomPassword(roomId: string) {
  stmtClearRoomPassword.run(roomId)
}

/* ------------------------------------------------------------------ */
/* File queries                                                        */
/* ------------------------------------------------------------------ */

export function dbGetFiles(roomId: string) {
  return stmtSelectFilesByRoom.all(roomId) as {
    id: string
    room_id: string
    name: string
    kind: 'file' | 'folder'
    parent_id: string
    content: string
    is_open: number
  }[]
}

export function dbCreateFile(roomId: string, file: {
  id: string
  name: string
  kind: 'file' | 'folder'
  parentId: string
  content?: string
}) {
  stmtInsertFile.run(file.id, roomId, file.name, file.kind, file.parentId, file.content ?? '')
}

export function dbUpdateFileContent(fileId: string, roomId: string, content: string): boolean {
  const info = stmtUpdateFileContent.run(content, fileId, roomId)
  return info.changes > 0
}

export function dbRenameFile(fileId: string, roomId: string, name: string): boolean {
  const info = stmtRenameFile.run(name.trim().slice(0, 255), fileId, roomId)
  return info.changes > 0
}


export function dbMoveFile(fileId: string, roomId: string, parentId: string): boolean {
  // Spostare in 'root' non può mai creare un ciclo — skip del check.
  if (parentId !== 'root') {
    const descendants = stmtGetDescendants.all(fileId, roomId) as { id: string }[]
    const isDescendant = descendants.some((row) => row.id === parentId)
    if (isDescendant) return false
  }
  const info = stmtMoveFile.run(parentId, fileId, roomId, parentId, parentId, roomId)
  return info.changes > 0
}

export function dbDeleteFile(fileId: string, roomId: string): boolean
export function dbDeleteFile(fileIds: string[], roomId: string): void
export function dbDeleteFile(fileIdOrIds: string | string[], roomId: string) {
  if (Array.isArray(fileIdOrIds)) {
    if (fileIdOrIds.length === 0) return
    getDeleteFilesByIdsStmt(fileIdOrIds.length).run(...fileIdOrIds, roomId)
    return
  }
  const info = stmtDeleteFileTree.run(fileIdOrIds, roomId)
  return info.changes > 0
}

export const dbDeleteFileTreeTx = db.transaction((fileId: string, roomId: string): string[] => {
  const rows = stmtGetDescendants.all(fileId, roomId) as { id: string }[]
  if (rows.length === 0) return []
  stmtDeleteFileTree.run(fileId, roomId)
  return rows.map(r => r.id)
})

export function dbRoomExists(roomId: string): boolean {
  const row = stmtSelectRoomId.get(roomId)
  return !!row
}

/* ------------------------------------------------------------------ */
/* User queries                                                        */
/* ------------------------------------------------------------------ */

export function dbCreateUser(id: string, name: string, email: string, passwordHash: string) {
  return stmtInsertUser.run(id, name, email, passwordHash)
}

export function dbGetUserByEmail(email: string) {
  return stmtSelectUserByEmail.get(email) as {
    id: string; name: string; email: string; password_hash: string
  } | undefined
}

export function dbGetUserById(id: string) {
  return stmtSelectUserById.get(id) as {
    id: string; name: string; email: string; avatar: string | null; created_at: number
  } | undefined
}

export function dbSetUserAvatar(id: string, avatar: string) {
  stmtSetUserAvatar.run(avatar, id)
}

export function dbClearUserAvatar(id: string) {
  stmtClearUserAvatar.run(id)
}

export function dbUpdateUserName(id: string, name: string) {
  stmtUpdateUserName.run(name.trim().slice(0, 60), id)
}

export function dbUpdateUserEmail(id: string, email: string) {
  stmtUpdateUserEmail.run(email.toLowerCase().trim(), id)
}

export function dbUpdateUserPassword(id: string, passwordHash: string) {
  stmtUpdateUserPassword.run(passwordHash, id)
}

export function dbGetOwnedRooms(userId: string): string[] {
  return (stmtSelectOwnedRooms.all(userId) as { room_id: string }[]).map(r => r.room_id)
}

export function dbDeleteUser(id: string) {
  const tx = db.transaction((userId: string) => {
    
    const ownedRooms = stmtSelectOwnedRooms.all(userId) as { room_id: string }[]

    for (const { room_id } of ownedRooms) {
      stmtDeleteFilesByRoom.run(room_id)
      stmtDeleteMembersByRoom.run(room_id)
      stmtDeleteRoomById.run(room_id)
    }

    stmtDeleteNonOwnerMemberships.run(userId)

    stmtDeleteSessionsByUser.run(userId)

    stmtDeleteUserById.run(userId)
  })
  tx(id)
}

/* ------------------------------------------------------------------ */
/* Room member queries                                                 */
/* ------------------------------------------------------------------ */

export function dbAddRoomMember(userId: string, roomId: string, role: 'owner' | 'editor' | 'viewer' = 'viewer') {
  stmtUpsertRoomMember.run(userId, roomId, role)
}

export function dbGetUserRooms(userId: string, cursor?: number) {
  const rows = (
    cursor != null
      ? stmtSelectUserRoomsWithCursor.all(userId, cursor)
      : stmtSelectUserRooms.all(userId)
  ) as { id: string; name: string | null; created_at: number; last_seen: number; role: string }[]

  const hasMore = rows.length > ROOMS_PAGE_SIZE
  return {
    rooms: rows.slice(0, ROOMS_PAGE_SIZE),
    nextCursor: hasMore ? rows[ROOMS_PAGE_SIZE - 1].last_seen : null,
  }
}

export function dbIsRoomMember(userId: string, roomId: string): boolean {
  const row = stmtSelectIsRoomMember.get(userId, roomId)
  return !!row
}

export function dbCreateRoom(roomId: string, userId?: string, name?: string) {
  stmtInsertRoom.run(roomId, userId ?? null, name?.trim().slice(0, 60) || null)
}

export const dbCreateRoomWithOwner = db.transaction((roomId: string, userId: string, name?: string) => {
  stmtInsertRoom.run(roomId, userId, name?.trim().slice(0, 60) || null)
  stmtUpsertRoomMember.run(userId, roomId, 'owner')
})

/* ------------------------------------------------------------------ */
/* Role management queries                                            */
/* ------------------------------------------------------------------ */

export type RoomRole = 'owner' | 'editor' | 'viewer'

export function dbGetMemberRole(userId: string, roomId: string): RoomRole | null {
  const row = stmtSelectMemberRole.get(userId, roomId) as { role: RoomRole } | undefined
  return row?.role ?? null
}

export function dbSetMemberRole(userId: string, roomId: string, role: RoomRole) {
  stmtUpdateMemberRole.run(role, userId, roomId)
}

export function dbGetRoomMembers(roomId: string) {
  return stmtSelectRoomMembers.all(roomId) as { id: string; name: string; email: string; role: RoomRole; last_seen: number }[]
}

export function dbRemoveMember(userId: string, roomId: string) {
  stmtDeleteMember.run(userId, roomId)
}

/* ------------------------------------------------------------------ */
/* Session queries                                                     */
/* ------------------------------------------------------------------ */

export function dbCreateSession(token: string, userId: string, expiresAt: number) {
  stmtInsertSession.run(token, userId, expiresAt)
  stmtPruneUserSessions.run(userId, userId)
}

export function dbGetSession(token: string) {
  return stmtSelectSession.get(token) as {
    id: string; user_id: string; created_at: number; expires_at: number
  } | undefined
}

export function dbDeleteSession(token: string) {
  stmtDeleteSessionById.run(token)
}

export function dbDeleteOtherSessions(userId: string, keepToken: string) {
  stmtDeleteOtherSessions.run(userId, keepToken)
}

export function dbDeleteSessionsByUser(userId: string) {
  stmtDeleteSessionsByUser.run(userId)
}

export function dbDeleteExpiredSessions(): number {
  const info = stmtDeleteExpiredSessions.run(Math.floor(Date.now() / 1000))
  return info.changes
}

/* ------------------------------------------------------------------ */
/* Login attempt queries                                               */
/* ------------------------------------------------------------------ */

export function dbGetLoginAttempt(email: string) {
  return stmtGetLoginAttempt.get(email) as {
    count: number; first_attempt_at: number; locked_until: number | null
  } | undefined
}

export function dbUpsertLoginAttempt(email: string, count: number, firstAttemptAt: number, lockedUntil: number | null) {
  stmtUpsertLoginAttempt.run(email, count, firstAttemptAt, lockedUntil, count, firstAttemptAt, lockedUntil)
}

export function dbDeleteLoginAttempt(email: string) {
  stmtDeleteLoginAttempt.run(email)
}

export function dbDeleteExpiredLoginAttempts() {
  const windowAgo = Math.floor(Date.now() / 1000) - 5 * 60
  stmtDeleteExpiredLoginAttempts.run(windowAgo)
}

// Invites
export function dbCreateInvite(token: string, roomId: string, createdBy: string, expiresAt: number) {
  stmtInsertInvite.run(token, roomId, createdBy, expiresAt)
}

export function dbGetInvite(token: string) {
  return stmtGetInvite.get(token) as {
    token: string; room_id: string; created_by: string; expires_at: number; room_name: string | null; password_hash: string | null
  } | undefined
}

export function dbDeleteInvite(token: string) {
  stmtDeleteInvite.run(token)
}

export function dbDeleteExpiredInvites() {
  return (stmtDeleteExpiredInvites.run() as { changes: number }).changes
}

export function dbDeleteRoomInvites(roomId: string) {
  stmtDeleteRoomInvites.run(roomId)
}

/* ------------------------------------------------------------------ */
/* Chat queries                                                        */
/* ------------------------------------------------------------------ */

const stmtInsertChatMessage = db.prepare(`
  INSERT INTO chat_messages (room_id, user_id, user_name, avatar, content)
  VALUES (?, ?, ?, ?, ?)
`)
const stmtSelectChatMessages = db.prepare(`
  SELECT id, room_id, user_id, user_name, avatar, content, created_at
  FROM chat_messages
  WHERE room_id = ?
  ORDER BY created_at DESC
  LIMIT 50
`)
const stmtDeleteChatByRoom = db.prepare('DELETE FROM chat_messages WHERE room_id = ?')

export type ChatMessage = {
  id: number
  room_id: string
  user_id: string | null
  user_name: string
  avatar: string | null
  content: string
  created_at: number
}

export function dbSaveChatMessage(roomId: string, userId: string | null, userName: string, avatar: string | null, content: string): ChatMessage {
  const info = stmtInsertChatMessage.run(roomId, userId, userName, avatar, content)
  return { id: info.lastInsertRowid as number, room_id: roomId, user_id: userId, user_name: userName, avatar, content, created_at: Math.floor(Date.now() / 1000) }
}

export function dbGetChatMessages(roomId: string): ChatMessage[] {
  const rows = stmtSelectChatMessages.all(roomId) as ChatMessage[]
  return rows.reverse()
}

export function dbDeleteChatByRoom(roomId: string) {
  stmtDeleteChatByRoom.run(roomId)
}

export default db