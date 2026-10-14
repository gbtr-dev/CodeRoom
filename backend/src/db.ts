import Database from 'better-sqlite3'
import { createHash } from 'crypto'
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

  -- Only SHA-256 digests of random session tokens are persisted.
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
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

  -- sessions is looked up by its PK (token_hash) on every
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
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);

  -- One-time tokens sent by email (signup confirmation / email change confirmation).
  -- Only the SHA-256 hash of the token is stored. Rows are kept after use (used_at) so that
  -- the per-email and daily sending limits keep counting; they are purged by created_at.
  CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'change')),
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id);
  CREATE INDEX IF NOT EXISTS idx_email_verifications_email ON email_verifications(email, created_at);
  CREATE INDEX IF NOT EXISTS idx_email_verifications_created ON email_verifications(created_at);
`)

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

// The column name is the migration marker: never rehash digests on restart.
// Preserve existing cookies while removing bearer tokens from the live table.
db.transaction(() => {
  const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!columns.some(c => c.name === 'id')) return
  db.pragma('secure_delete = ON')
  const sessions = db.prepare('SELECT id FROM sessions').all() as { id: string }[]
  db.exec('ALTER TABLE sessions RENAME COLUMN id TO token_hash')
  const update = db.prepare('UPDATE sessions SET token_hash = ? WHERE token_hash = ?')
  for (const session of sessions) update.run(hashSessionToken(session.id), session.id)
}).immediate()

// Migration: add `avatar` column to users table if it doesn't exist yet
const userColumns = db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]
if (!userColumns.some((c) => c.name === 'avatar')) {
  db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`)
}

// Migration: add `email_verified_at` to users. Accounts that already exist were created before
// email verification existed, so they are marked as verified. The ALTER and the UPDATE run in a
// single transaction and only when the column is being created: this must never run again, or
// every restart would mark new, unverified accounts as verified.
if (!userColumns.some((c) => c.name === 'email_verified_at')) {
  db.transaction(() => {
    db.exec(`ALTER TABLE users ADD COLUMN email_verified_at INTEGER`)
    db.exec(`UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL`)
  })()
}

// Bind existing and future signup links to their own credential snapshot.
const verificationColumns = db.prepare('PRAGMA table_info(email_verifications)').all() as { name: string }[]
if (!verificationColumns.some(c => c.name === 'signup_name')) {
  db.transaction(() => {
    db.exec(`ALTER TABLE email_verifications ADD COLUMN signup_name TEXT`)
    db.exec(`ALTER TABLE email_verifications ADD COLUMN signup_password_hash TEXT`)
    db.exec(`UPDATE email_verifications SET
      signup_name = (SELECT name FROM users WHERE id = user_id),
      signup_password_hash = (SELECT password_hash FROM users WHERE id = user_id)
      WHERE purpose = 'signup' AND used_at IS NULL`)
  }).immediate()
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

// Migration: drop redundant avatar column from chat_messages (avatar now joined from users)
const chatColumns = db.prepare(`PRAGMA table_info(chat_messages)`).all() as { name: string }[]
if (chatColumns.some((c) => c.name === 'avatar')) {
  db.exec(`ALTER TABLE chat_messages DROP COLUMN avatar`)
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
  INSERT INTO users (id, name, email, password_hash, email_verified_at) VALUES (?, ?, ?, ?, ?)
`)
const stmtSelectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?')
const stmtSelectUserById = db.prepare('SELECT id, name, email, avatar, created_at, email_verified_at FROM users WHERE id = ?')
const stmtSetUserAvatar = db.prepare('UPDATE users SET avatar = ? WHERE id = ?')
const stmtClearUserAvatar = db.prepare('UPDATE users SET avatar = NULL WHERE id = ?')
const stmtUpdateUserName = db.prepare('UPDATE users SET name = ? WHERE id = ?')
const stmtUpdateUserEmail = db.prepare('UPDATE users SET email = ? WHERE id = ?')
const stmtUpdateUserPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
const stmtPasswordMatches = db.prepare('SELECT 1 FROM users WHERE id = ? AND password_hash = ?')
const stmtDeleteUserById = db.prepare('DELETE FROM users WHERE id = ?')
const stmtMarkUserVerified = db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?')
const stmtApplySignupCredentials = db.prepare(`
  UPDATE users SET name = ?, password_hash = ?
  WHERE id = ? AND email_verified_at IS NULL
`)
const stmtSelectStaleUnverifiedUsers = db.prepare(
  'SELECT id FROM users WHERE email_verified_at IS NULL AND created_at < ?'
)

const stmtInsertEmailVerification = db.prepare(`
  INSERT INTO email_verifications (token_hash, user_id, email, purpose, expires_at, created_at, signup_name, signup_password_hash)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`)
const stmtGetEmailVerification = db.prepare(`
  SELECT token_hash, user_id, email, purpose, expires_at, used_at, signup_name, signup_password_hash
  FROM email_verifications WHERE token_hash = ?
`)
const stmtMarkEmailVerificationUsed = db.prepare(
  'UPDATE email_verifications SET used_at = ? WHERE token_hash = ?'
)
const stmtSupersedePendingChanges = db.prepare(`
  UPDATE email_verifications SET used_at = ?
  WHERE user_id = ? AND purpose = 'change' AND used_at IS NULL
`)
const stmtClosePendingVerifications = db.prepare(`
  UPDATE email_verifications SET used_at = ? WHERE user_id = ? AND used_at IS NULL
`)
const stmtCountVerificationsForEmail = db.prepare(
  'SELECT COUNT(*) AS n, MAX(created_at) AS last_at FROM email_verifications WHERE email = ? AND created_at >= ?'
)
const stmtCountVerificationsSince = db.prepare(
  'SELECT COUNT(*) AS n FROM email_verifications WHERE created_at >= ?'
)
const stmtDeleteOldEmailVerifications = db.prepare(
  'DELETE FROM email_verifications WHERE created_at < ?'
)
const stmtSelectOwnedRooms = db.prepare(
  `SELECT room_id FROM room_members WHERE user_id = ? AND role = 'owner'`
)
const stmtDeleteNonOwnerMemberships = db.prepare(
  `DELETE FROM room_members WHERE user_id = ? AND role != 'owner'`
)

// Sessions
const stmtInsertSession = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)
`)
const stmtInsertSessionForCredentials = db.prepare(`
  INSERT INTO sessions (token_hash, user_id, expires_at)
  SELECT ?, id, ? FROM users
  WHERE id = ? AND email = ? AND password_hash = ? AND email_verified_at IS NOT NULL
`)
const stmtSelectSession = db.prepare('SELECT token_hash, user_id, created_at, expires_at FROM sessions WHERE token_hash = ?')
const stmtDeleteSessionById = db.prepare('DELETE FROM sessions WHERE token_hash = ?')
const stmtDeleteSessionsByUser = db.prepare('DELETE FROM sessions WHERE user_id = ?')
const stmtDeleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
const stmtDeleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
const stmtPruneUserSessions = db.prepare(`
  DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (
    SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
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
  'DELETE FROM login_attempts WHERE (locked_until IS NULL AND first_attempt_at < ?) OR locked_until <= ?'
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
  if (fileId === 'root') return false
  // Moving to 'root' can never create a cycle — skip the check.
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

export function dbCreateUser(
  id: string,
  name: string,
  email: string,
  passwordHash: string,
  emailVerifiedAt: number | null = null,
) {
  return stmtInsertUser.run(id, name, email, passwordHash, emailVerifiedAt)
}

export function dbGetUserByEmail(email: string) {
  return stmtSelectUserByEmail.get(email) as {
    id: string; name: string; email: string; password_hash: string; email_verified_at: number | null
  } | undefined
}

export function dbGetUserById(id: string) {
  return stmtSelectUserById.get(id) as {
    id: string; name: string; email: string; avatar: string | null; created_at: number; email_verified_at: number | null
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
  db.transaction(() => {
    stmtUpdateUserPassword.run(passwordHash, id)
    stmtSupersedePendingChanges.run(Math.floor(Date.now() / 1000), id)
  })()
}

/* ------------------------------------------------------------------ */
/* Email verification                                                  */
/* ------------------------------------------------------------------ */

export type EmailVerificationPurpose = 'signup' | 'change'

export type EmailVerificationResult =
  | { status: 'ok'; userId: string; email: string; purpose: EmailVerificationPurpose }
  | { status: 'invalid' | 'expired' | 'conflict' }

/** Stores the hash of a one-time token. A new 'change' request supersedes the user's older pending ones. */
export function dbCreateEmailVerification(
  tokenHash: string,
  userId: string,
  email: string,
  purpose: EmailVerificationPurpose,
  expiresAt: number,
  createdAt: number = Math.floor(Date.now() / 1000),
  expectedPasswordHash?: string,
  signupCredentials?: { name: string; passwordHash: string },
) {
  return db.transaction(() => {
    // Serialize this check with password updates, including other DB connections.
    if (expectedPasswordHash !== undefined && !stmtPasswordMatches.get(userId, expectedPasswordHash)) return false
    let snapshot = null
    if (purpose === 'signup') {
      const user = stmtSelectUserByEmail.get(email) as { id: string; name: string; password_hash: string; email_verified_at: number | null } | undefined
      if (!user || user.id !== userId || user.email_verified_at !== null) return false
      snapshot = signupCredentials ?? { name: user.name, passwordHash: user.password_hash }
    }
    if (purpose === 'change') stmtSupersedePendingChanges.run(createdAt, userId)
    stmtInsertEmailVerification.run(tokenHash, userId, email, purpose, expiresAt, createdAt, snapshot?.name ?? null, snapshot?.passwordHash ?? null)
    // Keep the placeholder alive for the full lifetime of newly issued signup links.
    if (purpose === 'signup') db.prepare('UPDATE users SET created_at = MAX(created_at, ?) WHERE id = ?').run(createdAt, userId)
    return true
  }).immediate()
}

/**
 * Consumes a token atomically. On success the email is marked as verified (and, for a 'change'
 * token, the user's email is updated) and every other pending token of that user is closed.
 *  - invalid:  unknown token, already used, or no longer matching the account
 *  - expired:  token past its expiry
 *  - conflict: the new email was taken by another account in the meantime
 */
export function dbConsumeEmailVerification(tokenHash: string): EmailVerificationResult {
  const tx = db.transaction((hash: string): EmailVerificationResult => {
    const now = Math.floor(Date.now() / 1000)
    const row = stmtGetEmailVerification.get(hash) as {
      user_id: string; email: string; purpose: EmailVerificationPurpose; expires_at: number; used_at: number | null; signup_name: string | null; signup_password_hash: string | null
    } | undefined
    if (!row || row.used_at !== null) return { status: 'invalid' }
    if (row.expires_at <= now) return { status: 'expired' }

    const user = stmtSelectUserById.get(row.user_id) as { email: string; email_verified_at: number | null } | undefined
    if (!user) return { status: 'invalid' }

    if (row.purpose === 'signup') {
      if (user.email !== row.email || user.email_verified_at !== null || row.signup_name === null || row.signup_password_hash === null) return { status: 'invalid' }
      stmtApplySignupCredentials.run(row.signup_name, row.signup_password_hash, row.user_id)
    } else {
      const owner = stmtSelectUserByEmail.get(row.email) as { id: string } | undefined
      if (owner && owner.id !== row.user_id) return { status: 'conflict' }
      stmtUpdateUserEmail.run(row.email, row.user_id)
    }

    stmtMarkUserVerified.run(now, row.user_id)
    stmtMarkEmailVerificationUsed.run(now, hash)
    stmtClosePendingVerifications.run(now, row.user_id)
    return { status: 'ok', userId: row.user_id, email: row.email, purpose: row.purpose }
  })
  return tx.immediate(tokenHash)
}

/** How many verification emails were created for this address since `sinceSec`, and when the last one was. */
export function dbGetEmailVerificationStats(email: string, sinceSec: number): { count: number; lastAt: number | null } {
  const row = stmtCountVerificationsForEmail.get(email, sinceSec) as { n: number; last_at: number | null }
  return { count: row.n, lastAt: row.last_at }
}

/** How many verification emails were created by anyone since `sinceSec` (daily sending cap). */
export function dbCountEmailVerificationsSince(sinceSec: number): number {
  return (stmtCountVerificationsSince.get(sinceSec) as { n: number }).n
}

/** Deletes accounts that were never verified and are older than `olderThanSec`. Returns how many. */
export function dbDeleteStaleUnverifiedUsers(olderThanSec: number): number {
  const ids = stmtSelectStaleUnverifiedUsers.all(olderThanSec) as { id: string }[]
  for (const { id } of ids) dbDeleteUser(id)
  return ids.length
}

/** Removes verification rows created before `createdBeforeSec`. Returns how many. */
export function dbDeleteOldEmailVerifications(createdBeforeSec: number): number {
  return stmtDeleteOldEmailVerifications.run(createdBeforeSec).changes
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
  const inserted = stmtInsertRoom.run(roomId, userId, name?.trim().slice(0, 60) || null)
  // A conflicting ID belongs to an existing room. Never add an owner unless
  // this transaction actually inserted the room, even on concurrent requests.
  if (inserted.changes === 0) return false
  stmtUpsertRoomMember.run(userId, roomId, 'owner')
  return true
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
  stmtInsertSession.run(hashSessionToken(token), userId, expiresAt)
  stmtPruneUserSessions.run(userId, userId)
}

/** Insert only if the credentials checked asynchronously still belong to this verified account. */
export function dbCreateSessionForCredentials(
  token: string, userId: string, expiresAt: number, email: string, passwordHash: string,
): boolean {
  return db.transaction(() => {
    // The check is part of the write, so another DB connection cannot replace credentials
    // between validating them and creating the session.
    const inserted = stmtInsertSessionForCredentials.run(hashSessionToken(token), expiresAt, userId, email, passwordHash)
    if (inserted.changes === 0) return false
    stmtPruneUserSessions.run(userId, userId)
    return true
  })()
}

export function dbGetSession(token: string) {
  return stmtSelectSession.get(hashSessionToken(token)) as {
    token_hash: string; user_id: string; created_at: number; expires_at: number
  } | undefined
}

export function dbDeleteSession(token: string) {
  stmtDeleteSessionById.run(hashSessionToken(token))
}

export function dbDeleteOtherSessions(userId: string, keepToken: string) {
  stmtDeleteOtherSessions.run(userId, hashSessionToken(keepToken))
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
  stmtDeleteExpiredLoginAttempts.run(windowAgo, Math.floor(Date.now() / 1000))
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

/** Revalidate and consume the invitation together with membership creation. */
export function dbAcceptInvite(
  token: string, userId: string, sessionToken: string, expectedPasswordHash: string | null,
): { status: 'ok'; roomId: string; roomName: string | null }
  | { status: 'invalid' } | { status: 'unauthorized' } | { status: 'password_changed' } {
  return db.transaction(() => {
    // Reserve the write lock before reading, also serializing other DB connections.
    const session = dbGetSession(sessionToken)
    if (!session || session.user_id !== userId || session.expires_at <= Math.floor(Date.now() / 1000)) {
      return { status: 'unauthorized' as const }
    }
    const invite = dbGetInvite(token)
    if (!invite) return { status: 'invalid' as const }
    if (invite.password_hash !== expectedPasswordHash) return { status: 'password_changed' as const }

    stmtDeleteInvite.run(token)
    // The upsert refreshes last_seen but preserves any existing owner/editor role.
    stmtUpsertRoomMember.run(userId, invite.room_id, 'viewer')
    return { status: 'ok' as const, roomId: invite.room_id, roomName: invite.room_name }
  }).immediate()
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
  INSERT INTO chat_messages (room_id, user_id, user_name, content)
  VALUES (?, ?, ?, ?)
`)
const stmtSelectChatMessages = db.prepare(`
  SELECT cm.id, cm.room_id, cm.user_id, cm.user_name, u.avatar, cm.content, cm.created_at
  FROM chat_messages cm
  LEFT JOIN users u ON cm.user_id = u.id
  WHERE cm.room_id = ?
  ORDER BY cm.created_at DESC
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
  const info = stmtInsertChatMessage.run(roomId, userId, userName, content)
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
