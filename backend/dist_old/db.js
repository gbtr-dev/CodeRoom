"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbCreateRoomWithOwner = exports.dbDeleteFileTreeTx = void 0;
exports.dbGetOrCreateRoom = dbGetOrCreateRoom;
exports.dbDeleteRoom = dbDeleteRoom;
exports.dbSetRoomName = dbSetRoomName;
exports.dbGetRoom = dbGetRoom;
exports.dbSetRoomPassword = dbSetRoomPassword;
exports.dbClearRoomPassword = dbClearRoomPassword;
exports.dbGetFiles = dbGetFiles;
exports.dbCreateFile = dbCreateFile;
exports.dbUpdateFileContent = dbUpdateFileContent;
exports.dbRenameFile = dbRenameFile;
exports.dbMoveFile = dbMoveFile;
exports.dbDeleteFile = dbDeleteFile;
exports.dbRoomExists = dbRoomExists;
exports.dbCreateUser = dbCreateUser;
exports.dbGetUserByEmail = dbGetUserByEmail;
exports.dbGetUserById = dbGetUserById;
exports.dbSetUserAvatar = dbSetUserAvatar;
exports.dbClearUserAvatar = dbClearUserAvatar;
exports.dbUpdateUserName = dbUpdateUserName;
exports.dbUpdateUserEmail = dbUpdateUserEmail;
exports.dbUpdateUserPassword = dbUpdateUserPassword;
exports.dbGetOwnedRooms = dbGetOwnedRooms;
exports.dbDeleteUser = dbDeleteUser;
exports.dbAddRoomMember = dbAddRoomMember;
exports.dbGetUserRooms = dbGetUserRooms;
exports.dbIsRoomMember = dbIsRoomMember;
exports.dbCreateRoom = dbCreateRoom;
exports.dbGetMemberRole = dbGetMemberRole;
exports.dbSetMemberRole = dbSetMemberRole;
exports.dbGetRoomMembers = dbGetRoomMembers;
exports.dbRemoveMember = dbRemoveMember;
exports.dbCreateSession = dbCreateSession;
exports.dbGetSession = dbGetSession;
exports.dbDeleteSession = dbDeleteSession;
exports.dbDeleteOtherSessions = dbDeleteOtherSessions;
exports.dbDeleteSessionsByUser = dbDeleteSessionsByUser;
exports.dbDeleteExpiredSessions = dbDeleteExpiredSessions;
exports.dbGetLoginAttempt = dbGetLoginAttempt;
exports.dbUpsertLoginAttempt = dbUpsertLoginAttempt;
exports.dbDeleteLoginAttempt = dbDeleteLoginAttempt;
exports.dbDeleteExpiredLoginAttempts = dbDeleteExpiredLoginAttempts;
exports.dbCreateInvite = dbCreateInvite;
exports.dbGetInvite = dbGetInvite;
exports.dbDeleteInvite = dbDeleteInvite;
exports.dbDeleteExpiredInvites = dbDeleteExpiredInvites;
exports.dbDeleteRoomInvites = dbDeleteRoomInvites;
exports.dbSaveChatMessage = dbSaveChatMessage;
exports.dbGetChatMessages = dbGetChatMessages;
exports.dbDeleteChatByRoom = dbDeleteChatByRoom;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const DB_PATH = path_1.default.join(process.cwd(), 'coderoom.db');
const db = new better_sqlite3_1.default(DB_PATH);
// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
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
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages(room_id);
`);
// Migration: add `avatar` column to users table if it doesn't exist yet
const userColumns = db.prepare(`PRAGMA table_info(users)`).all();
if (!userColumns.some((c) => c.name === 'avatar')) {
    db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
}
// Migration: add `name` and `password_hash` columns to rooms table if they don't exist yet
const roomColumns = db.prepare(`PRAGMA table_info(rooms)`).all();
if (!roomColumns.some((c) => c.name === 'name')) {
    db.exec(`ALTER TABLE rooms ADD COLUMN name TEXT`);
}
if (!roomColumns.some((c) => c.name === 'password_hash')) {
    db.exec(`ALTER TABLE rooms ADD COLUMN password_hash TEXT`);
}
// Migration: add `role` column to room_members if it doesn't exist yet
const memberColumns = db.prepare(`PRAGMA table_info(room_members)`).all();
if (!memberColumns.some((c) => c.name === 'role')) {
    db.exec(`ALTER TABLE room_members ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('owner', 'editor', 'viewer'))`);
    // Promote existing members of rooms they created to owner
    db.exec(`
    UPDATE room_members SET role = 'owner'
    WHERE (user_id, room_id) IN (
      SELECT created_by, id FROM rooms WHERE created_by IS NOT NULL
    )
  `);
}
// Migration: drop redundant avatar column from chat_messages (avatar now joined from users)
const chatColumns = db.prepare(`PRAGMA table_info(chat_messages)`).all();
if (chatColumns.some((c) => c.name === 'avatar')) {
    db.exec(`ALTER TABLE chat_messages DROP COLUMN avatar`);
}
/* ------------------------------------------------------------------ */
/* Prepared statements                                                 */
/* ------------------------------------------------------------------ */
// Rooms
const stmtSelectRoomId = db.prepare('SELECT id FROM rooms WHERE id = ?');
const stmtInsertRoomIdOnly = db.prepare('INSERT INTO rooms (id) VALUES (?)');
const stmtUpdateRoomName = db.prepare('UPDATE rooms SET name = ? WHERE id = ?');
const stmtSelectRoom = db.prepare('SELECT id, name, created_by, created_at, password_hash FROM rooms WHERE id = ?');
const stmtSetRoomPassword = db.prepare('UPDATE rooms SET password_hash = ? WHERE id = ?');
const stmtClearRoomPassword = db.prepare('UPDATE rooms SET password_hash = NULL WHERE id = ?');
const stmtInsertRoom = db.prepare('INSERT OR IGNORE INTO rooms (id, created_by, name) VALUES (?, ?, ?)');
const stmtDeleteRoomById = db.prepare('DELETE FROM rooms WHERE id = ?');
// Files
const stmtSelectFilesByRoom = db.prepare('SELECT * FROM files WHERE room_id = ? ORDER BY created_at ASC');
const stmtInsertFile = db.prepare(`
  INSERT OR IGNORE INTO files (id, room_id, name, kind, parent_id, content)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtUpdateFileContent = db.prepare('UPDATE files SET content = ? WHERE id = ? AND room_id = ?');
const stmtRenameFile = db.prepare('UPDATE files SET name = ? WHERE id = ? AND room_id = ?');
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
`);
const stmtGetDescendants = db.prepare(`
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM files WHERE id = ? AND room_id = ?
    UNION ALL
    SELECT f.id FROM files f
    INNER JOIN descendants d ON f.parent_id = d.id
  )
  SELECT id FROM descendants
`);
const stmtDeleteFileTree = db.prepare(`
  WITH RECURSIVE descendants(id) AS (
    SELECT id FROM files WHERE id = ? AND room_id = ?
    UNION ALL
    SELECT f.id FROM files f
    INNER JOIN descendants d ON f.parent_id = d.id
  )
  DELETE FROM files WHERE id IN (SELECT id FROM descendants)
`);
const stmtDeleteFilesByRoom = db.prepare('DELETE FROM files WHERE room_id = ?');
const deleteFilesByIdsCache = new Map();
function getDeleteFilesByIdsStmt(count) {
    let stmt = deleteFilesByIdsCache.get(count);
    if (!stmt) {
        const placeholders = Array(count).fill('?').join(', ');
        stmt = db.prepare(`DELETE FROM files WHERE id IN (${placeholders}) AND room_id = ?`);
        deleteFilesByIdsCache.set(count, stmt);
    }
    return stmt;
}
// Users
const stmtInsertUser = db.prepare(`
  INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)
`);
const stmtSelectUserByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
const stmtSelectUserById = db.prepare('SELECT id, name, email, avatar, created_at FROM users WHERE id = ?');
const stmtSetUserAvatar = db.prepare('UPDATE users SET avatar = ? WHERE id = ?');
const stmtClearUserAvatar = db.prepare('UPDATE users SET avatar = NULL WHERE id = ?');
const stmtUpdateUserName = db.prepare('UPDATE users SET name = ? WHERE id = ?');
const stmtUpdateUserEmail = db.prepare('UPDATE users SET email = ? WHERE id = ?');
const stmtUpdateUserPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const stmtDeleteUserById = db.prepare('DELETE FROM users WHERE id = ?');
const stmtSelectOwnedRooms = db.prepare(`SELECT room_id FROM room_members WHERE user_id = ? AND role = 'owner'`);
const stmtDeleteNonOwnerMemberships = db.prepare(`DELETE FROM room_members WHERE user_id = ? AND role != 'owner'`);
// Sessions
const stmtInsertSession = db.prepare(`
  INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)
`);
const stmtSelectSession = db.prepare('SELECT id, user_id, created_at, expires_at FROM sessions WHERE id = ?');
const stmtDeleteSessionById = db.prepare('DELETE FROM sessions WHERE id = ?');
const stmtDeleteSessionsByUser = db.prepare('DELETE FROM sessions WHERE user_id = ?');
const stmtDeleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?');
const stmtDeleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');
const stmtPruneUserSessions = db.prepare(`
  DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
    SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10
  )
`);
// Login attempts
const stmtGetLoginAttempt = db.prepare('SELECT count, first_attempt_at, locked_until FROM login_attempts WHERE email = ?');
const stmtUpsertLoginAttempt = db.prepare(`
  INSERT INTO login_attempts (email, count, first_attempt_at, locked_until)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(email) DO UPDATE SET count = ?, first_attempt_at = ?, locked_until = ?
`);
const stmtDeleteLoginAttempt = db.prepare('DELETE FROM login_attempts WHERE email = ?');
const stmtDeleteExpiredLoginAttempts = db.prepare('DELETE FROM login_attempts WHERE locked_until IS NULL AND first_attempt_at < ?');
// Invites
const stmtInsertInvite = db.prepare('INSERT INTO invites (token, room_id, created_by, expires_at) VALUES (?, ?, ?, ?)');
const stmtGetInvite = db.prepare(`
  SELECT i.token, i.room_id, i.created_by, i.expires_at, r.name AS room_name, r.password_hash
  FROM invites i
  JOIN rooms r ON r.id = i.room_id
  WHERE i.token = ? AND i.expires_at > unixepoch()
`);
const stmtDeleteInvite = db.prepare('DELETE FROM invites WHERE token = ?');
const stmtDeleteExpiredInvites = db.prepare('DELETE FROM invites WHERE expires_at <= unixepoch()');
const stmtDeleteRoomInvites = db.prepare('DELETE FROM invites WHERE room_id = ?');
// Room members
const stmtUpsertRoomMember = db.prepare(`
  INSERT INTO room_members (user_id, room_id, role, last_seen)
  VALUES (?, ?, ?, unixepoch())
  ON CONFLICT(user_id, room_id) DO UPDATE SET last_seen = unixepoch()
`);
const stmtSelectIsRoomMember = db.prepare('SELECT 1 FROM room_members WHERE user_id = ? AND room_id = ?');
const stmtDeleteMembersByRoom = db.prepare('DELETE FROM room_members WHERE room_id = ?');
const stmtSelectMemberRole = db.prepare('SELECT role FROM room_members WHERE user_id = ? AND room_id = ?');
const stmtUpdateMemberRole = db.prepare('UPDATE room_members SET role = ? WHERE user_id = ? AND room_id = ?');
const stmtSelectRoomMembers = db.prepare(`
  SELECT u.id, u.name, rm.role, rm.last_seen
  FROM room_members rm
  JOIN users u ON u.id = rm.user_id
  WHERE rm.room_id = ?
  ORDER BY CASE rm.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, rm.last_seen DESC
`);
const stmtDeleteMember = db.prepare('DELETE FROM room_members WHERE user_id = ? AND room_id = ?');
const ROOMS_PAGE_SIZE = 20;
const stmtSelectUserRooms = db.prepare(`
  SELECT r.id, r.name, r.created_at, rm.last_seen, rm.role
  FROM room_members rm
  JOIN rooms r ON r.id = rm.room_id
  WHERE rm.user_id = ?
  ORDER BY rm.last_seen DESC
  LIMIT ${ROOMS_PAGE_SIZE + 1}
`);
const stmtSelectUserRoomsWithCursor = db.prepare(`
  SELECT r.id, r.name, r.created_at, rm.last_seen, rm.role
  FROM room_members rm
  JOIN rooms r ON r.id = rm.room_id
  WHERE rm.user_id = ? AND rm.last_seen < ?
  ORDER BY rm.last_seen DESC
  LIMIT ${ROOMS_PAGE_SIZE + 1}
`);
/* ------------------------------------------------------------------ */
/* Room queries                                                        */
/* ------------------------------------------------------------------ */
function dbGetOrCreateRoom(roomId) {
    const existing = stmtSelectRoomId.get(roomId);
    if (!existing) {
        stmtInsertRoomIdOnly.run(roomId);
    }
}
function dbDeleteRoom(roomId) {
    const tx = db.transaction((id) => {
        stmtDeleteFilesByRoom.run(id);
        stmtDeleteMembersByRoom.run(id);
        stmtDeleteRoomById.run(id);
    });
    tx(roomId);
}
function dbSetRoomName(roomId, name) {
    const trimmed = name.trim().slice(0, 60);
    stmtUpdateRoomName.run(trimmed || null, roomId);
    return trimmed || null;
}
function dbGetRoom(roomId) {
    return stmtSelectRoom.get(roomId);
}
function dbSetRoomPassword(roomId, hash) {
    stmtSetRoomPassword.run(hash, roomId);
}
function dbClearRoomPassword(roomId) {
    stmtClearRoomPassword.run(roomId);
}
/* ------------------------------------------------------------------ */
/* File queries                                                        */
/* ------------------------------------------------------------------ */
function dbGetFiles(roomId) {
    return stmtSelectFilesByRoom.all(roomId);
}
function dbCreateFile(roomId, file) {
    stmtInsertFile.run(file.id, roomId, file.name, file.kind, file.parentId, file.content ?? '');
}
function dbUpdateFileContent(fileId, roomId, content) {
    const info = stmtUpdateFileContent.run(content, fileId, roomId);
    return info.changes > 0;
}
function dbRenameFile(fileId, roomId, name) {
    const info = stmtRenameFile.run(name.trim().slice(0, 255), fileId, roomId);
    return info.changes > 0;
}
function dbMoveFile(fileId, roomId, parentId) {
    if (fileId === 'root')
        return false;
    // Moving to 'root' can never create a cycle — skip the check.
    if (parentId !== 'root') {
        const descendants = stmtGetDescendants.all(fileId, roomId);
        const isDescendant = descendants.some((row) => row.id === parentId);
        if (isDescendant)
            return false;
    }
    const info = stmtMoveFile.run(parentId, fileId, roomId, parentId, parentId, roomId);
    return info.changes > 0;
}
function dbDeleteFile(fileIdOrIds, roomId) {
    if (Array.isArray(fileIdOrIds)) {
        if (fileIdOrIds.length === 0)
            return;
        getDeleteFilesByIdsStmt(fileIdOrIds.length).run(...fileIdOrIds, roomId);
        return;
    }
    const info = stmtDeleteFileTree.run(fileIdOrIds, roomId);
    return info.changes > 0;
}
exports.dbDeleteFileTreeTx = db.transaction((fileId, roomId) => {
    const rows = stmtGetDescendants.all(fileId, roomId);
    if (rows.length === 0)
        return [];
    stmtDeleteFileTree.run(fileId, roomId);
    return rows.map(r => r.id);
});
function dbRoomExists(roomId) {
    const row = stmtSelectRoomId.get(roomId);
    return !!row;
}
/* ------------------------------------------------------------------ */
/* User queries                                                        */
/* ------------------------------------------------------------------ */
function dbCreateUser(id, name, email, passwordHash) {
    return stmtInsertUser.run(id, name, email, passwordHash);
}
function dbGetUserByEmail(email) {
    return stmtSelectUserByEmail.get(email);
}
function dbGetUserById(id) {
    return stmtSelectUserById.get(id);
}
function dbSetUserAvatar(id, avatar) {
    stmtSetUserAvatar.run(avatar, id);
}
function dbClearUserAvatar(id) {
    stmtClearUserAvatar.run(id);
}
function dbUpdateUserName(id, name) {
    stmtUpdateUserName.run(name.trim().slice(0, 60), id);
}
function dbUpdateUserEmail(id, email) {
    stmtUpdateUserEmail.run(email.toLowerCase().trim(), id);
}
function dbUpdateUserPassword(id, passwordHash) {
    stmtUpdateUserPassword.run(passwordHash, id);
}
function dbGetOwnedRooms(userId) {
    return stmtSelectOwnedRooms.all(userId).map(r => r.room_id);
}
function dbDeleteUser(id) {
    const tx = db.transaction((userId) => {
        const ownedRooms = stmtSelectOwnedRooms.all(userId);
        for (const { room_id } of ownedRooms) {
            stmtDeleteFilesByRoom.run(room_id);
            stmtDeleteMembersByRoom.run(room_id);
            stmtDeleteRoomById.run(room_id);
        }
        stmtDeleteNonOwnerMemberships.run(userId);
        stmtDeleteSessionsByUser.run(userId);
        stmtDeleteUserById.run(userId);
    });
    tx(id);
}
/* ------------------------------------------------------------------ */
/* Room member queries                                                 */
/* ------------------------------------------------------------------ */
function dbAddRoomMember(userId, roomId, role = 'viewer') {
    stmtUpsertRoomMember.run(userId, roomId, role);
}
function dbGetUserRooms(userId, cursor) {
    const rows = (cursor != null
        ? stmtSelectUserRoomsWithCursor.all(userId, cursor)
        : stmtSelectUserRooms.all(userId));
    const hasMore = rows.length > ROOMS_PAGE_SIZE;
    return {
        rooms: rows.slice(0, ROOMS_PAGE_SIZE),
        nextCursor: hasMore ? rows[ROOMS_PAGE_SIZE - 1].last_seen : null,
    };
}
function dbIsRoomMember(userId, roomId) {
    const row = stmtSelectIsRoomMember.get(userId, roomId);
    return !!row;
}
function dbCreateRoom(roomId, userId, name) {
    stmtInsertRoom.run(roomId, userId ?? null, name?.trim().slice(0, 60) || null);
}
exports.dbCreateRoomWithOwner = db.transaction((roomId, userId, name) => {
    stmtInsertRoom.run(roomId, userId, name?.trim().slice(0, 60) || null);
    stmtUpsertRoomMember.run(userId, roomId, 'owner');
});
function dbGetMemberRole(userId, roomId) {
    const row = stmtSelectMemberRole.get(userId, roomId);
    return row?.role ?? null;
}
function dbSetMemberRole(userId, roomId, role) {
    stmtUpdateMemberRole.run(role, userId, roomId);
}
function dbGetRoomMembers(roomId) {
    return stmtSelectRoomMembers.all(roomId);
}
function dbRemoveMember(userId, roomId) {
    stmtDeleteMember.run(userId, roomId);
}
/* ------------------------------------------------------------------ */
/* Session queries                                                     */
/* ------------------------------------------------------------------ */
function dbCreateSession(token, userId, expiresAt) {
    stmtInsertSession.run(token, userId, expiresAt);
    stmtPruneUserSessions.run(userId, userId);
}
function dbGetSession(token) {
    return stmtSelectSession.get(token);
}
function dbDeleteSession(token) {
    stmtDeleteSessionById.run(token);
}
function dbDeleteOtherSessions(userId, keepToken) {
    stmtDeleteOtherSessions.run(userId, keepToken);
}
function dbDeleteSessionsByUser(userId) {
    stmtDeleteSessionsByUser.run(userId);
}
function dbDeleteExpiredSessions() {
    const info = stmtDeleteExpiredSessions.run(Math.floor(Date.now() / 1000));
    return info.changes;
}
/* ------------------------------------------------------------------ */
/* Login attempt queries                                               */
/* ------------------------------------------------------------------ */
function dbGetLoginAttempt(email) {
    return stmtGetLoginAttempt.get(email);
}
function dbUpsertLoginAttempt(email, count, firstAttemptAt, lockedUntil) {
    stmtUpsertLoginAttempt.run(email, count, firstAttemptAt, lockedUntil, count, firstAttemptAt, lockedUntil);
}
function dbDeleteLoginAttempt(email) {
    stmtDeleteLoginAttempt.run(email);
}
function dbDeleteExpiredLoginAttempts() {
    const windowAgo = Math.floor(Date.now() / 1000) - 5 * 60;
    stmtDeleteExpiredLoginAttempts.run(windowAgo);
}
// Invites
function dbCreateInvite(token, roomId, createdBy, expiresAt) {
    stmtInsertInvite.run(token, roomId, createdBy, expiresAt);
}
function dbGetInvite(token) {
    return stmtGetInvite.get(token);
}
function dbDeleteInvite(token) {
    stmtDeleteInvite.run(token);
}
function dbDeleteExpiredInvites() {
    return stmtDeleteExpiredInvites.run().changes;
}
function dbDeleteRoomInvites(roomId) {
    stmtDeleteRoomInvites.run(roomId);
}
/* ------------------------------------------------------------------ */
/* Chat queries                                                        */
/* ------------------------------------------------------------------ */
const stmtInsertChatMessage = db.prepare(`
  INSERT INTO chat_messages (room_id, user_id, user_name, content)
  VALUES (?, ?, ?, ?)
`);
const stmtSelectChatMessages = db.prepare(`
  SELECT cm.id, cm.room_id, cm.user_id, cm.user_name, u.avatar, cm.content, cm.created_at
  FROM chat_messages cm
  LEFT JOIN users u ON cm.user_id = u.id
  WHERE cm.room_id = ?
  ORDER BY cm.created_at DESC
  LIMIT 50
`);
const stmtDeleteChatByRoom = db.prepare('DELETE FROM chat_messages WHERE room_id = ?');
function dbSaveChatMessage(roomId, userId, userName, avatar, content) {
    const info = stmtInsertChatMessage.run(roomId, userId, userName, content);
    return { id: info.lastInsertRowid, room_id: roomId, user_id: userId, user_name: userName, avatar, content, created_at: Math.floor(Date.now() / 1000) };
}
function dbGetChatMessages(roomId) {
    const rows = stmtSelectChatMessages.all(roomId);
    return rows.reverse();
}
function dbDeleteChatByRoom(roomId) {
    stmtDeleteChatByRoom.run(roomId);
}
exports.default = db;
