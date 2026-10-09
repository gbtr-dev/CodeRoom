"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.notifyRoomDeleted = notifyRoomDeleted;
exports.notifyUserLeftRoom = notifyUserLeftRoom;
exports.disconnectAllUserSockets = disconnectAllUserSockets;
exports.registerSocketHandlers = registerSocketHandlers;
const cookie_1 = require("cookie");
const rooms_1 = require("./rooms");
const executor_1 = require("./executor");
const db_1 = require("./db");
const auth_1 = require("./auth");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const logger_1 = require("./logger");
const rateLimiter_1 = require("./rateLimiter");
const safeHandler_1 = require("./safeHandler");
const validation_1 = require("./validation");
const log = (0, logger_1.createLogger)('SOCKET');
let ioInstance = null;
const userRoomSockets = new Map();
function userRoomKey(roomId, userId) {
    return `${roomId}:${userId}`;
}
function trackUserSocket(roomId, userId, socket) {
    const key = userRoomKey(roomId, userId);
    if (!userRoomSockets.has(key))
        userRoomSockets.set(key, new Set());
    userRoomSockets.get(key).add(socket);
}
function untrackUserSocket(roomId, userId, socket) {
    const key = userRoomKey(roomId, userId);
    const set = userRoomSockets.get(key);
    if (!set)
        return;
    set.delete(socket);
    if (set.size === 0)
        userRoomSockets.delete(key);
}
function getUserSockets(roomId, userId) {
    return Array.from(userRoomSockets.get(userRoomKey(roomId, userId)) ?? []);
}
function getRole(socket) {
    return socket.data?.role ?? 'viewer';
}
function setRole(socket, role) {
    socket.data.role = role;
}
function notifyRoomDeleted(roomId) {
    ioInstance?.to(roomId).emit('room-deleted', { roomId });
    ioInstance?.in(roomId).socketsLeave(roomId);
    (0, rooms_1.removeRoom)(roomId);
}
function notifyUserLeftRoom(roomId, userId) {
    for (const targetSocket of getUserSockets(roomId, userId)) {
        targetSocket.disconnect(true);
    }
}
function disconnectAllUserSockets(userId) {
    const suffix = `:${userId}`;
    for (const [key, sockets] of userRoomSockets.entries()) {
        if (!key.endsWith(suffix))
            continue;
        for (const s of sockets) {
            s.emit('session-expired');
            s.disconnect(true);
        }
    }
}
const pendingKnocks = new Map();
const MAX_PENDING_KNOCKS_PER_ROOM = 20;
function registerSocketHandlers(io) {
    ioInstance = io;
    io.on('connection', (socket) => {
        let currentRoom = null;
        let currentUser = 'Anonymous';
        let currentUserEmail = 'unknown';
        let currentUserId = null;
        let currentAvatar = null;
        function admitUser(roomId, admittedSocket, admittedUserId, admittedName, admittedEmail, admittedAvatar, preloadedRow) {
            admittedSocket.join(roomId);
            admittedSocket.data.admitted = true;
            let role = 'viewer';
            if (admittedUserId) {
                const existingRole = (0, db_1.dbGetMemberRole)(admittedUserId, roomId);
                if (!existingRole) {
                    (0, db_1.dbAddRoomMember)(admittedUserId, roomId, 'viewer');
                }
                else {
                    (0, db_1.dbAddRoomMember)(admittedUserId, roomId, existingRole);
                }
                role = existingRole ?? 'viewer';
                setRole(admittedSocket, role);
                trackUserSocket(roomId, admittedUserId, admittedSocket);
            }
            const participant = (0, rooms_1.addParticipant)(roomId, admittedSocket.id, admittedName, admittedUserId ?? undefined, role, admittedAvatar);
            const room = (0, rooms_1.getOrCreateRoom)(roomId);
            const roomRow = preloadedRow ?? (0, db_1.dbGetRoom)(roomId);
            const otherParticipants = Array.from(room.participants.entries())
                .filter(([id]) => id !== admittedSocket.id)
                .map(([id, p]) => ({ id, name: p.name, color: p.color, dbUserId: p.userId, dbRole: p.role, avatar: p.avatar ?? null }));
            admittedSocket.emit('room-state', {
                files: (0, rooms_1.getRoomFiles)(roomId),
                participants: otherParticipants,
                roomName: roomRow?.name ?? null,
                role,
                chatHistory: (0, db_1.dbGetChatMessages)(roomId),
                hasPassword: !!roomRow?.password_hash,
            });
            admittedSocket.to(roomId).emit('participant-joined', {
                id: admittedSocket.id,
                name: participant.name,
                color: participant.color,
                dbUserId: participant.userId,
                dbRole: participant.role,
                avatar: participant.avatar ?? null,
            });
            log.info(`[ROOM] User admitted — user = ${admittedName} | email = ${(0, logger_1.maskEmail)(admittedEmail)} | role = ${role} | room = ${roomId}`);
        }
        const cookieHeader = socket.handshake.headers.cookie;
        let handshakeToken;
        if (cookieHeader) {
            try {
                handshakeToken = (0, cookie_1.parse)(cookieHeader)[auth_1.SESSION_COOKIE_NAME];
            }
            catch {
                handshakeToken = undefined;
            }
        }
        (0, safeHandler_1.safeOn)(socket, 'join-room', async ({ roomId, userName, isNew, roomName, password, }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'join-room'))
                return;
            if (!(0, validation_1.isValidId)(roomId))
                return;
            currentRoom = roomId;
            currentUser = (0, validation_1.isNonEmptyString)(userName, validation_1.LIMITS.USER_NAME) ? userName : 'Anonymous';
            // Verify session token read from the httpOnly cookie
            if (handshakeToken) {
                const payload = (0, auth_1.verifySessionToken)(handshakeToken);
                if (payload) {
                    currentUserId = payload.userId;
                    const dbUser = (0, db_1.dbGetUserById)(payload.userId);
                    if (dbUser) {
                        currentUser = dbUser.name;
                        currentUserEmail = dbUser.email;
                        currentAvatar = dbUser.avatar ?? null;
                    }
                }
            }
            if (!isNew && !(0, db_1.dbRoomExists)(roomId)) {
                socket.emit('room-not-found', { roomId });
                return;
            }
            if (isNew) {
                if (!currentUserId) {
                    socket.emit('error', { message: 'Login required to create a room' });
                    return;
                }
                // Creator: create room and add owner atomically (prevents race on concurrent join)
                (0, db_1.dbCreateRoomWithOwner)(roomId, currentUserId, (0, validation_1.isString)(roomName) ? roomName : undefined);
                socket.join(roomId);
                socket.data.admitted = true;
                let role = 'viewer';
                if (currentUserId) {
                    role = 'owner';
                    setRole(socket, role);
                    trackUserSocket(roomId, currentUserId, socket);
                }
                const participant = (0, rooms_1.addParticipant)(roomId, socket.id, currentUser, currentUserId ?? undefined, role, currentAvatar);
                const room = (0, rooms_1.getOrCreateRoom)(roomId);
                const roomRow = (0, db_1.dbGetRoom)(roomId);
                socket.emit('room-state', {
                    files: (0, rooms_1.getRoomFiles)(roomId),
                    participants: [],
                    roomName: roomRow?.name ?? null,
                    role,
                    chatHistory: (0, db_1.dbGetChatMessages)(roomId),
                    hasPassword: false,
                });
                log.info(`[ROOM] Room created — user = ${currentUser} | email = ${(0, logger_1.maskEmail)(currentUserEmail)} | role = ${role} | room = ${roomId}`);
                return;
            }
            const roomRow = (0, db_1.dbGetRoom)(roomId);
            if (currentUserId) {
                const existingRole = (0, db_1.dbGetMemberRole)(currentUserId, roomId);
                if (existingRole) {
                    if (existingRole === 'owner') {
                        // Owner always gets in — they set the password
                        admitUser(roomId, socket, currentUserId, currentUser, currentUserEmail, currentAvatar, roomRow);
                        return;
                    }
                    // Editor / viewer: must enter password if room is locked
                    if (roomRow?.password_hash) {
                        if (!password) {
                            socket.emit('room-password-required');
                            return;
                        }
                        const valid = await bcryptjs_1.default.compare(password, roomRow.password_hash);
                        if (!valid) {
                            socket.emit('room-wrong-password');
                            return;
                        }
                    }
                    admitUser(roomId, socket, currentUserId, currentUser, currentUserEmail, currentAvatar, roomRow);
                    return;
                }
            }
            // Unknown visitor — check if room is password-protected
            if (roomRow?.password_hash) {
                // Anonymous users cannot enter password-protected rooms: require authentication
                if (!currentUserId) {
                    socket.emit('login-required');
                    return;
                }
                if (!password) {
                    socket.emit('room-password-required');
                    return;
                }
                const valid = await bcryptjs_1.default.compare(password, roomRow.password_hash);
                if (!valid) {
                    socket.emit('room-wrong-password');
                    return;
                }
                // Correct password — admit authenticated user as viewer
                log.info(`[ROOM] Password correct — user = ${currentUser} | room = ${roomId}`);
                admitUser(roomId, socket, currentUserId, currentUser, currentUserEmail, currentAvatar, roomRow);
                return;
            }
            // No password — send knock to all owners currently in the room
            // Cap pending knocks per room to prevent memory DoS
            const roomPendingCount = Array.from(pendingKnocks.values()).filter(k => k.roomId === roomId).length;
            if (roomPendingCount >= MAX_PENDING_KNOCKS_PER_ROOM) {
                socket.emit('knock-denied');
                log.warn(`[ROOM] Knock denied — too many pending (${roomPendingCount}) | room = ${roomId}`);
                return;
            }
            const knockTimeoutId = setTimeout(() => {
                if (pendingKnocks.has(socket.id)) {
                    pendingKnocks.delete(socket.id);
                    socket.emit('knock-denied');
                    log.info(`[ROOM] Knock expired — user = ${currentUser} | room = ${roomId}`);
                }
            }, 60000);
            pendingKnocks.set(socket.id, { userId: currentUserId, userName: currentUser, roomId, timeoutId: knockTimeoutId });
            log.info(`[ROOM] Knock received — user = ${currentUser} | email = ${(0, logger_1.maskEmail)(currentUserEmail)} | room = ${roomId}`);
            const room = (0, rooms_1.getOrCreateRoom)(roomId);
            let notified = false;
            for (const [sid, p] of room.participants.entries()) {
                if (p.role === 'owner') {
                    const ownerSocket = getUserSockets(roomId, p.userId ?? '')[0];
                    if (ownerSocket) {
                        ownerSocket.emit('knock', { knockId: socket.id, userName: currentUser, avatar: currentAvatar });
                        notified = true;
                    }
                }
            }
            if (!notified) {
                // Random delay to prevent timing-based detection of owner presence.
                const delay = 1000 + Math.random() * 2000;
                setTimeout(() => {
                    clearTimeout(knockTimeoutId);
                    pendingKnocks.delete(socket.id);
                    socket.emit('knock-denied');
                }, delay);
                log.info(`[ROOM] Knock auto-denied (no owner online) — user = ${currentUser} | room = ${roomId}`);
            }
            else {
                socket.emit('knock-pending');
            }
        });
        // Owner approves a knock
        (0, safeHandler_1.safeOn)(socket, 'approve-knock', ({ knockId }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'approve-knock'))
                return;
            if (!(0, validation_1.isValidId)(knockId))
                return;
            if (!currentRoom)
                return;
            if (getRole(socket) !== 'owner')
                return;
            const knock = pendingKnocks.get(knockId);
            if (!knock || knock.roomId !== currentRoom)
                return;
            clearTimeout(knock.timeoutId);
            pendingKnocks.delete(knockId);
            const knockerSocket = io.sockets.sockets.get(knockId);
            if (!knockerSocket)
                return;
            log.info(`[ROOM] Knock approved — user = ${knock.userName} | by = ${currentUser} | room = ${currentRoom}`);
            const knockerAvatar = knock.userId ? ((0, db_1.dbGetUserById)(knock.userId)?.avatar ?? null) : null;
            admitUser(currentRoom, knockerSocket, knock.userId, knock.userName, '(approved)', knockerAvatar);
        });
        // Owner denies a knock
        (0, safeHandler_1.safeOn)(socket, 'deny-knock', ({ knockId }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'deny-knock'))
                return;
            if (!(0, validation_1.isValidId)(knockId))
                return;
            if (!currentRoom)
                return;
            if (getRole(socket) !== 'owner')
                return;
            const knock = pendingKnocks.get(knockId);
            if (!knock || knock.roomId !== currentRoom)
                return;
            clearTimeout(knock.timeoutId);
            pendingKnocks.delete(knockId);
            const knockerSocket = io.sockets.sockets.get(knockId);
            if (knockerSocket) {
                knockerSocket.emit('knock-denied');
            }
            log.info(`[ROOM] Knock denied — user = ${knock.userName} | by = ${currentUser} | room = ${currentRoom}`);
        });
        (0, safeHandler_1.safeOn)(socket, 'code-change', ({ fileId, content }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'code-change'))
                return;
            if (!(0, validation_1.isValidId)(fileId))
                return;
            if (!(0, validation_1.isBoundedString)(content, validation_1.LIMITS.FILE_CONTENT))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            if (!(0, rooms_1.updateFileContent)(currentRoom, fileId, content)) {
                log.warn(`[ROOM] code-change su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`);
                return;
            }
            io.to(currentRoom).emit('code-update', { fileId, content, fromSocketId: socket.id });
        });
        (0, safeHandler_1.safeOn)(socket, 'code-patch', ({ fileId, start, deleteCount, insert }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'code-patch'))
                return;
            if (!(0, validation_1.isValidId)(fileId))
                return;
            if (!(0, validation_1.isNonNegativeInt)(start, validation_1.LIMITS.FILE_CONTENT))
                return;
            if (!(0, validation_1.isNonNegativeInt)(deleteCount, validation_1.LIMITS.FILE_CONTENT))
                return;
            if (!(0, validation_1.isBoundedString)(insert, validation_1.LIMITS.PATCH_INSERT))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            const updated = (0, rooms_1.applyFilePatch)(currentRoom, fileId, start, deleteCount, insert);
            if (updated === null) {
                log.warn(`[ROOM] code-patch su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`);
                return;
            }
            io.to(currentRoom).emit('code-update', { fileId, content: updated, fromSocketId: socket.id });
        });
        (0, safeHandler_1.safeOn)(socket, 'cursor-move', ({ fileId, line, column }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'cursor-move'))
                return;
            if (!(0, validation_1.isValidId)(fileId))
                return;
            if (!(0, validation_1.isNonNegativeInt)(line, validation_1.LIMITS.CURSOR_POS))
                return;
            if (!(0, validation_1.isNonNegativeInt)(column, validation_1.LIMITS.CURSOR_POS))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            socket.to(currentRoom).emit('cursor-update', {
                userId: socket.id,
                fileId,
                line,
                column,
            });
        });
        (0, safeHandler_1.safeOn)(socket, 'create-file', ({ parentId, name, type, content }, callback) => {
            const reject = () => { if (typeof callback === 'function')
                callback(undefined); };
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'create-file')) {
                reject();
                return;
            }
            if (parentId !== null && !(0, validation_1.isValidId)(parentId)) {
                reject();
                return;
            }
            if (!(0, validation_1.isValidFileName)(name)) {
                reject();
                return;
            }
            if (!(0, validation_1.isFileKind)(type)) {
                reject();
                return;
            }
            if (content !== undefined && !(0, validation_1.isBoundedString)(content, validation_1.LIMITS.FILE_CONTENT)) {
                reject();
                return;
            }
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            const node = (0, rooms_1.createFile)(currentRoom, parentId, name, type, content);
            log.info(`[ROOM] File created — file = ${name} | user = ${currentUser} | email = ${(0, logger_1.maskEmail)(currentUserEmail)} | room = ${currentRoom}`);
            if (typeof callback === 'function')
                callback(node);
            io.to(currentRoom).emit('file-created', { node, parentId: node.parentId });
        });
        (0, safeHandler_1.safeOn)(socket, 'import-zip', ({ entries }, callback) => {
            const reject = () => { if (typeof callback === 'function')
                callback({ __rejected: '1' }); };
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'import-zip')) {
                reject();
                return;
            }
            if (!Array.isArray(entries) || entries.length === 0 || entries.length > validation_1.LIMITS.IMPORT_ENTRIES) {
                reject();
                return;
            }
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            const idMap = {};
            const createdNodes = [];
            let totalContentSize = 0;
            for (const entry of entries) {
                if (typeof entry !== 'object' || entry === null)
                    continue;
                const { tempId, parentTempId, name, type, content } = entry;
                if (!(0, validation_1.isValidId)(tempId))
                    continue;
                if (parentTempId !== null && parentTempId !== undefined && !(0, validation_1.isValidId)(parentTempId))
                    continue;
                if (!(0, validation_1.isValidFileName)(name))
                    continue;
                if (!(0, validation_1.isFileKind)(type))
                    continue;
                if (content !== undefined && !(0, validation_1.isBoundedString)(content, validation_1.LIMITS.FILE_CONTENT))
                    continue;
                if ((0, validation_1.isString)(content)) {
                    totalContentSize += content.length;
                    if (totalContentSize > validation_1.LIMITS.IMPORT_TOTAL_CONTENT)
                        break;
                }
                const realParentId = parentTempId ? (idMap[parentTempId] ?? null) : null;
                const node = (0, rooms_1.createFile)(currentRoom, realParentId, name, type, content);
                idMap[tempId] = node.id;
                createdNodes.push(node);
            }
            io.to(currentRoom).emit('files-imported', { nodes: createdNodes });
            log.info(`[ROOM] ZIP imported — ${createdNodes.length} entries | user = ${currentUser} | room = ${currentRoom}`);
            if (typeof callback === 'function')
                callback(idMap);
        });
        (0, safeHandler_1.safeOn)(socket, 'rename-room', ({ name }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'rename-room'))
                return;
            if (!(0, validation_1.isString)(name))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) !== 'owner')
                return;
            const savedName = (0, db_1.dbSetRoomName)(currentRoom, name.slice(0, validation_1.LIMITS.ROOM_NAME));
            io.to(currentRoom).emit('room-renamed', { name: savedName });
            log.info(`[ROOM] Room renamed — name = ${savedName} | user = ${currentUser} | email = ${(0, logger_1.maskEmail)(currentUserEmail)} | room = ${currentRoom}`);
        });
        (0, safeHandler_1.safeOn)(socket, 'delete-file', ({ fileId }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'delete-file'))
                return;
            if (!(0, validation_1.isValidId)(fileId))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            if (!(0, rooms_1.deleteFile)(currentRoom, fileId)) {
                log.warn(`[ROOM] delete-file su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`);
                return;
            }
            io.to(currentRoom).emit('file-deleted', { fileId });
            log.info(`[ROOM] File deleted — file = ${fileId} | user = ${currentUser} | email = ${(0, logger_1.maskEmail)(currentUserEmail)} | room = ${currentRoom}`);
        });
        (0, safeHandler_1.safeOn)(socket, 'run-code', async ({ language, code, stdin }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'run-code'))
                return;
            if (!(0, validation_1.isString)(language))
                return;
            if (!(0, validation_1.isBoundedString)(code, validation_1.LIMITS.RUN_CODE))
                return;
            if (stdin !== undefined && !(0, validation_1.isBoundedString)(stdin, 10000))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            socket.emit('run-started', { language });
            const result = await (0, executor_1.executeCode)(language, code, stdin);
            socket.emit('run-result', {
                output: result.output,
                error: result.error,
                exitCode: result.exitCode,
                duration: result.duration,
                language,
            });
        });
        (0, safeHandler_1.safeOn)(socket, 'format-code', async ({ language, code }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'format-code'))
                return;
            if (!(0, validation_1.isString)(language))
                return;
            if (!(0, validation_1.isBoundedString)(code, validation_1.LIMITS.RUN_CODE))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            const result = await (0, executor_1.formatCode)(language, code);
            socket.emit('format-result', result);
        });
        // Owner-only: change a member's role
        (0, safeHandler_1.safeOn)(socket, 'set-member-role', ({ userId, role }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'set-member-role'))
                return;
            if (!(0, validation_1.isValidId)(userId))
                return;
            if (!currentRoom || !currentUserId || !socket.data.admitted)
                return;
            if (getRole(socket) !== 'owner') {
                socket.emit('role-error', { message: 'Only the owner can change roles' });
                return;
            }
            if (!['editor', 'viewer'].includes(role)) {
                socket.emit('role-error', { message: 'Invalid role' });
                return;
            }
            const memberRole = (0, db_1.dbGetMemberRole)(userId, currentRoom);
            if (!memberRole) {
                socket.emit('role-error', { message: 'Member not found' });
                return;
            }
            if (memberRole === 'owner') {
                socket.emit('role-error', { message: 'Cannot change another owner\'s role' });
                return;
            }
            (0, db_1.dbSetMemberRole)(userId, currentRoom, role);
            log.info(`[ROOM] Role changed — target = ${userId} | role = ${role} | by = ${currentUser} | room = ${currentRoom}`);
            io.to(currentRoom).emit('member-role-changed', { userId, role });
            for (const targetSocket of getUserSockets(currentRoom, userId)) {
                setRole(targetSocket, role);
                targetSocket.emit('role-refreshed', { role });
            }
        });
        // Owner-only: kick a member from the room
        (0, safeHandler_1.safeOn)(socket, 'kick-member', ({ userId }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'kick-member'))
                return;
            if (!(0, validation_1.isValidId)(userId))
                return;
            if (!currentRoom || !currentUserId || !socket.data.admitted)
                return;
            if (getRole(socket) !== 'owner') {
                socket.emit('role-error', { message: 'Only the owner can kick members' });
                return;
            }
            if (userId === currentUserId) {
                socket.emit('role-error', { message: 'Cannot kick yourself' });
                return;
            }
            const memberRole = (0, db_1.dbGetMemberRole)(userId, currentRoom);
            if (memberRole === 'owner') {
                socket.emit('role-error', { message: 'Cannot kick another owner' });
                return;
            }
            (0, db_1.dbRemoveMember)(userId, currentRoom);
            log.info(`[ROOM] Member kicked — target = ${userId} | by = ${currentUser} | room = ${currentRoom}`);
            io.to(currentRoom).emit('member-kicked', { userId });
            for (const targetSocket of getUserSockets(currentRoom, userId)) {
                targetSocket.disconnect(true);
            }
        });
        (0, safeHandler_1.safeOn)(socket, 'rename-file', ({ fileId, name }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'rename-file'))
                return;
            if (!(0, validation_1.isValidId)(fileId))
                return;
            if (!(0, validation_1.isValidFileName)(name))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            const trimmed = name.trim().slice(0, validation_1.LIMITS.FILE_NAME);
            if (!trimmed)
                return;
            if (!(0, db_1.dbRenameFile)(fileId, currentRoom, trimmed)) {
                log.warn(`[ROOM] rename-file su file non appartenente alla room — file = ${fileId} | user = ${currentUser} | room = ${currentRoom}`);
                return;
            }
            log.info(`[ROOM] File renamed — file = ${fileId} | name = ${trimmed} | user = ${currentUser} | room = ${currentRoom}`);
            io.to(currentRoom).emit('file-renamed', { fileId, name: trimmed });
        });
        (0, safeHandler_1.safeOn)(socket, 'move-file', ({ fileId, parentId }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'move-file'))
                return;
            if (!(0, validation_1.isValidId)(fileId))
                return;
            if (!(0, validation_1.isValidId)(parentId))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (getRole(socket) === 'viewer')
                return;
            if (!(0, db_1.dbMoveFile)(fileId, currentRoom, parentId)) {
                log.warn(`[ROOM] move-file su file/parent non appartenente alla room — file = ${fileId} | parent = ${parentId} | user = ${currentUser} | room = ${currentRoom}`);
                return;
            }
            log.info(`[ROOM] File moved — file = ${fileId} | parent = ${parentId} | user = ${currentUser} | room = ${currentRoom}`);
            io.to(currentRoom).emit('file-moved', { fileId, parentId });
        });
        (0, safeHandler_1.safeOn)(socket, 'chat-send', ({ content }) => {
            if (!(0, rateLimiter_1.checkRateLimit)(socket, 'chat-send'))
                return;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (typeof content !== 'string')
                return;
            const trimmed = content.trim().slice(0, 2000);
            if (!trimmed)
                return;
            const msg = (0, db_1.dbSaveChatMessage)(currentRoom, currentUserId ?? null, currentUser, currentAvatar, trimmed);
            io.to(currentRoom).emit('chat-message', msg);
        });
        (0, safeHandler_1.safeOn)(socket, 'disconnect', () => {
            const ownKnock = pendingKnocks.get(socket.id);
            if (ownKnock) {
                clearTimeout(ownKnock.timeoutId);
                pendingKnocks.delete(socket.id);
            }
            delete socket.data.__rateBuckets;
            delete socket.data.__abuseBudget;
            if (!currentRoom || !socket.data.admitted)
                return;
            if (currentUserId)
                untrackUserSocket(currentRoom, currentUserId, socket);
            const wasOwner = getRole(socket) === 'owner';
            (0, rooms_1.removeParticipant)(currentRoom, socket.id);
            if (wasOwner && !(0, rooms_1.hasOnlineOwner)(currentRoom)) {
                for (const [knockId, knock] of pendingKnocks.entries()) {
                    if (knock.roomId === currentRoom) {
                        clearTimeout(knock.timeoutId);
                        io.sockets.sockets.get(knockId)?.emit('knock-denied');
                        pendingKnocks.delete(knockId);
                    }
                }
            }
            socket.to(currentRoom).emit('participant-left', { id: socket.id });
            log.info(`[ROOM] User left — user = ${currentUser} | email = ${(0, logger_1.maskEmail)(currentUserEmail)} | room = ${currentRoom}`);
        });
    });
}
