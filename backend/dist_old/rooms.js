"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flushRoomContent = flushRoomContent;
exports.flushAllRoomContent = flushAllRoomContent;
exports.getOrCreateRoom = getOrCreateRoom;
exports.getRoomFiles = getRoomFiles;
exports.getFileContent = getFileContent;
exports.addParticipant = addParticipant;
exports.removeParticipant = removeParticipant;
exports.updateFileContent = updateFileContent;
exports.applyFilePatch = applyFilePatch;
exports.createFile = createFile;
exports.deleteFile = deleteFile;
exports.removeRoom = removeRoom;
exports.hasOnlineOwner = hasOnlineOwner;
const crypto_1 = require("crypto");
const validation_1 = require("./validation");
const db_1 = require("./db");
const rooms = new Map();
const COLORS = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];
function pickColor(room) {
    const used = new Set(Array.from(room.participants.values()).map((p) => p.color));
    const free = COLORS.find((c) => !used.has(c));
    if (free)
        return free;
    // Palette exhausted: generate a unique HSL color spread evenly around the wheel
    const index = room.participants.size;
    const hue = Math.round((index * 137.508) % 360); // golden-angle distribution
    return `hsl(${hue},70%,55%)`;
}
const DB_FLUSH_MS = 750;
const dirtyFiles = new Set();
const flushTimers = new Map();
const fileRoomIndex = new Map();
function getLangFromName(name) {
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const map = {
        js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
        py: 'python', go: 'go', md: 'markdown', json: 'json',
    };
    return map[ext] ?? 'plaintext';
}
function ensureCacheLoaded(room, rows) {
    if (room.cacheLoaded)
        return;
    const data = rows ?? (0, db_1.dbGetFiles)(room.id);
    for (const row of data) {
        if (row.kind === 'file') {
            room.fileContent.set(row.id, row.content ?? '');
            fileRoomIndex.set(row.id, room.id);
        }
    }
    room.cacheLoaded = true;
}
function cancelPendingFlush(fileId) {
    const timer = flushTimers.get(fileId);
    if (timer) {
        clearTimeout(timer);
        flushTimers.delete(fileId);
    }
    dirtyFiles.delete(fileId);
}
function flushFileToDb(fileId) {
    cancelPendingFlush(fileId);
    const roomId = fileRoomIndex.get(fileId);
    if (!roomId)
        return;
    const room = rooms.get(roomId);
    const content = room?.fileContent.get(fileId);
    if (content === undefined)
        return;
    (0, db_1.dbUpdateFileContent)(fileId, roomId, content);
}
function scheduleDbFlush(fileId, roomId) {
    dirtyFiles.add(fileId);
    fileRoomIndex.set(fileId, roomId);
    const existing = flushTimers.get(fileId);
    if (existing)
        clearTimeout(existing);
    flushTimers.set(fileId, setTimeout(() => {
        flushTimers.delete(fileId);
        if (!dirtyFiles.has(fileId))
            return;
        dirtyFiles.delete(fileId);
        const room = rooms.get(roomId);
        const content = room?.fileContent.get(fileId);
        if (content === undefined)
            return;
        (0, db_1.dbUpdateFileContent)(fileId, roomId, content);
    }, DB_FLUSH_MS));
}
function flushRoomContent(roomId) {
    const room = rooms.get(roomId);
    if (!room)
        return;
    for (const fileId of room.fileContent.keys()) {
        if (dirtyFiles.has(fileId))
            flushFileToDb(fileId);
    }
}
function flushAllRoomContent() {
    for (const fileId of [...dirtyFiles])
        flushFileToDb(fileId);
}
function getOrCreateRoom(roomId) {
    if (!rooms.has(roomId)) {
        rooms.set(roomId, {
            id: roomId,
            participants: new Map(),
            fileContent: new Map(),
            cacheLoaded: false,
        });
    }
    return rooms.get(roomId);
}
function getRoomFiles(roomId) {
    const room = getOrCreateRoom(roomId);
    const rows = (0, db_1.dbGetFiles)(roomId);
    ensureCacheLoaded(room, rows);
    const validIds = new Set(rows.map(r => r.id));
    return rows.map((row) => {
        const parentId = row.parent_id && row.parent_id !== 'root' && !validIds.has(row.parent_id)
            ? 'root'
            : row.parent_id;
        return {
            id: row.id,
            name: row.name,
            type: row.kind,
            content: row.kind === 'file' ? (room.fileContent.get(row.id) ?? row.content) : undefined,
            language: getLangFromName(row.name),
            parentId,
        };
    });
}
function getFileContent(roomId, fileId) {
    const room = getOrCreateRoom(roomId);
    ensureCacheLoaded(room);
    return room.fileContent.get(fileId) ?? '';
}
function addParticipant(roomId, socketId, name, userId, role, avatar) {
    const room = getOrCreateRoom(roomId);
    const color = pickColor(room);
    room.participants.set(socketId, { name, color, userId, role, avatar });
    return { name, color, userId, role, avatar };
}
function removeParticipant(roomId, socketId) {
    const room = rooms.get(roomId);
    if (!room)
        return;
    room.participants.delete(socketId);
    if (room.participants.size === 0) {
        flushRoomContent(roomId);
        rooms.delete(roomId);
    }
}
function updateFileContent(roomId, fileId, content) {
    const room = getOrCreateRoom(roomId);
    ensureCacheLoaded(room);
    if (!room.fileContent.has(fileId))
        return false;
    room.fileContent.set(fileId, content);
    fileRoomIndex.set(fileId, roomId);
    scheduleDbFlush(fileId, roomId);
    return true;
}
/** Restituisce il nuovo contenuto, o null se il file non appartiene a roomId. */
function applyFilePatch(roomId, fileId, start, deleteCount, insert) {
    const room = getOrCreateRoom(roomId);
    ensureCacheLoaded(room);
    if (!room.fileContent.has(fileId))
        return null;
    const current = room.fileContent.get(fileId) ?? '';
    if (start > current.length || start + deleteCount > current.length)
        return null;
    const updated = current.slice(0, start) + insert + current.slice(start + deleteCount);
    if (updated.length > validation_1.LIMITS.FILE_CONTENT)
        return null;
    updateFileContent(roomId, fileId, updated);
    return updated;
}
function createFile(roomId, parentId, name, type, content) {
    const id = (0, crypto_1.randomUUID)();
    const node = {
        id,
        name,
        kind: type,
        parentId: parentId ?? 'root',
        content: type === 'file' ? (content ?? '') : undefined,
    };
    (0, db_1.dbCreateFile)(roomId, node);
    const room = getOrCreateRoom(roomId);
    if (type === 'file') {
        room.fileContent.set(id, content ?? '');
        fileRoomIndex.set(id, roomId);
    }
    return {
        id,
        name,
        type,
        content: node.content,
        language: getLangFromName(name),
        parentId: node.parentId,
    };
}
function removeFileFromCache(fileId, room) {
    cancelPendingFlush(fileId);
    room?.fileContent.delete(fileId);
    fileRoomIndex.delete(fileId);
}
/** Restituisce true se il file apparteneva a roomId ed è stato cancellato. */
function deleteFile(roomId, fileId) {
    const room = getOrCreateRoom(roomId);
    ensureCacheLoaded(room);
    // dbDeleteFileTreeTx reads the descendant IDs and deletes the whole subtree
    // in a single SQLite transaction, removing the TOCTOU gap between the
    // "collect descendants" read and the actual DELETE.
    const deletedIds = (0, db_1.dbDeleteFileTreeTx)(fileId, roomId);
    if (deletedIds.length === 0)
        return false;
    for (const id of deletedIds)
        removeFileFromCache(id, room);
    return true;
}
function removeRoom(roomId) {
    flushRoomContent(roomId);
    rooms.delete(roomId);
}
function hasOnlineOwner(roomId) {
    const room = rooms.get(roomId);
    if (!room)
        return false;
    return Array.from(room.participants.values()).some(p => p.role === 'owner');
}
