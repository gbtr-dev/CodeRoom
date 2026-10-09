"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_COOKIE_NAME = void 0;
exports.createSession = createSession;
exports.verifySessionToken = verifySessionToken;
exports.destroySession = destroySession;
exports.destroyOtherSessions = destroyOtherSessions;
exports.registerAuthRoutes = registerAuthRoutes;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = require("crypto");
const nanoid_1 = require("nanoid");
const db_1 = require("./db");
const socket_1 = require("./socket");
const logger_1 = require("./logger");
const authRateLimiter_1 = require("./authRateLimiter");
const validation_1 = require("./validation");
const log = (0, logger_1.createLogger)('AUTH');
exports.SESSION_COOKIE_NAME = 'coderoom_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 giorni, come la scadenza del vecchio JWT
function generateSessionToken() {
    return (0, crypto_1.randomBytes)(32).toString('hex');
}
function sessionCookieOptions(maxAgeSeconds) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV !== 'development',
        sameSite: 'lax',
        path: '/',
        maxAge: maxAgeSeconds,
    };
}
/** Crea una nuova sessione su DB e restituisce il token opaco da mettere nel cookie. */
function createSession(userId) {
    const token = generateSessionToken();
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
    (0, db_1.dbCreateSession)(token, userId, expiresAt);
    return { token, expiresAt };
}
/** Verifica un token di sessione contro il DB. Ritorna null se assente, scaduto o invalido. */
function verifySessionToken(token) {
    // Token = 32 random bytes in hex = exactly 64 lowercase hex chars
    if (token.length !== 64 || !/^[0-9a-f]+$/.test(token))
        return null;
    const session = (0, db_1.dbGetSession)(token);
    if (!session)
        return null;
    if (session.expires_at <= Math.floor(Date.now() / 1000)) {
        (0, db_1.dbDeleteSession)(token);
        return null;
    }
    return { userId: session.user_id };
}
/** Cancella la sessione corrente dal DB (logout). */
function destroySession(token) {
    (0, db_1.dbDeleteSession)(token);
}
/** Cancella tutte le altre sessioni dell'utente, mantenendo quella corrente (cambio password). */
function destroyOtherSessions(userId, keepToken) {
    (0, db_1.dbDeleteOtherSessions)(userId, keepToken);
}
async function requireAuth(req, reply) {
    const token = req.cookies?.[exports.SESSION_COOKIE_NAME];
    if (!token) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }
    const payload = verifySessionToken(token);
    if (!payload) {
        reply.clearCookie(exports.SESSION_COOKIE_NAME, { path: '/' });
        return reply.status(401).send({ error: 'Invalid session' });
    }
    req.userId = payload.userId;
    req.sessionToken = token;
}
async function registerAuthRoutes(app) {
    // Signup
    app.post('/auth/signup', {
        config: {
            rateLimit: {
                max: 5,
                timeWindow: '1 minute',
            },
        },
    }, async (req, reply) => {
        const { name, email, password } = req.body;
        if (!name || !email || !password) {
            return reply.status(400).send({ error: 'Name, email and password are required' });
        }
        if (!name.trim()) {
            return reply.status(400).send({ error: 'Name is required' });
        }
        if (name.trim().length > 60) {
            return reply.status(400).send({ error: 'Name must be 60 characters or less' });
        }
        if (!(0, validation_1.isValidEmail)(email)) {
            return reply.status(400).send({ error: 'Please enter a valid email address' });
        }
        if (password.length < 6) {
            return reply.status(400).send({ error: 'Password must be at least 6 characters' });
        }
        if (password.length > 72) {
            return reply.status(400).send({ error: 'Password must be 72 characters or less' });
        }
        const normalizedEmail = email.toLowerCase().trim();
        const existing = (0, db_1.dbGetUserByEmail)(normalizedEmail);
        if (existing) {
            log.warn('Signup failed — email already in use', { name: name.trim(), email: (0, logger_1.maskEmail)(normalizedEmail) });
            return reply.status(409).send({ error: 'Email already in use' });
        }
        const id = (0, crypto_1.randomUUID)();
        const passwordHash = await bcryptjs_1.default.hash(password, 10);
        (0, db_1.dbCreateUser)(id, name.trim(), normalizedEmail, passwordHash);
        log.info('Signup successful', { userId: id, name: name.trim(), email: (0, logger_1.maskEmail)(normalizedEmail) });
        const { token } = createSession(id);
        reply.setCookie(exports.SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS));
        return reply.send({ user: { id, name: name.trim(), email: normalizedEmail } });
    });
    // Login
    app.post('/auth/login', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
            },
        },
    }, async (req, reply) => {
        const { email, password } = req.body;
        if (!email || !password) {
            return reply.status(400).send({ error: 'Email and password are required' });
        }
        const normalizedEmail = email.toLowerCase().trim();
        const lockedForSeconds = (0, authRateLimiter_1.checkLoginLock)(normalizedEmail);
        if (lockedForSeconds !== null) {
            log.warn('Login bloccato — troppi tentativi falliti', { email: (0, logger_1.maskEmail)(normalizedEmail), retryAfter: lockedForSeconds });
            reply.header('Retry-After', String(lockedForSeconds));
            return reply.status(429).send({ error: 'Too many failed login attempts. Please try again later.' });
        }
        const user = (0, db_1.dbGetUserByEmail)(normalizedEmail);
        if (!user) {
            (0, authRateLimiter_1.recordLoginFailure)(normalizedEmail);
            log.warn('Login failed — user not found', { email: (0, logger_1.maskEmail)(normalizedEmail) });
            return reply.status(401).send({ error: 'Invalid email or password' });
        }
        const valid = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!valid) {
            (0, authRateLimiter_1.recordLoginFailure)(normalizedEmail);
            log.warn('Login failed — wrong password', { userId: user.id, email: (0, logger_1.maskEmail)(user.email) });
            return reply.status(401).send({ error: 'Invalid email or password' });
        }
        (0, authRateLimiter_1.recordLoginSuccess)(normalizedEmail);
        log.info('Login successful', { userId: user.id, name: user.name, email: (0, logger_1.maskEmail)(user.email) });
        const { token } = createSession(user.id);
        reply.setCookie(exports.SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS));
        return reply.send({ user: { id: user.id, name: user.name, email: user.email } });
    });
    // ── Route pubblica: info su un invite ────────────────────────────────
    app.get('/invite/:token', async (req, reply) => {
        const { token } = req.params;
        const invite = (0, db_1.dbGetInvite)(token);
        if (!invite)
            return reply.status(404).send({ error: 'Invite link not found or expired' });
        return reply.send({
            token: invite.token,
            roomId: invite.room_id,
            roomName: invite.room_name ?? null,
            expiresAt: invite.expires_at,
        });
    });
    // ── Da qui in giù: solo rotte protette ───────────────────────────────
    app.register(async (protectedRoutes) => {
        protectedRoutes.addHook('preHandler', requireAuth);
        // Get current user
        protectedRoutes.get('/auth/me', async (req, reply) => {
            const user = (0, db_1.dbGetUserById)(req.userId);
            if (!user)
                return reply.status(404).send({ error: 'User not found' });
            return reply.send({ user });
        });
        // Get user's rooms (cursor-based pagination)
        protectedRoutes.get('/auth/rooms', async (req, reply) => {
            const query = req.query;
            const cursorRaw = query.cursor ? Number(query.cursor) : undefined;
            if (cursorRaw !== undefined && (!Number.isInteger(cursorRaw) || cursorRaw < 0)) {
                return reply.status(400).send({ error: 'Invalid cursor' });
            }
            const cursor = cursorRaw;
            const result = (0, db_1.dbGetUserRooms)(req.userId, cursor);
            return reply.send(result);
        });
        // Rename a room
        protectedRoutes.put('/auth/rooms/:id/name', async (req, reply) => {
            const { id } = req.params;
            const { name } = req.body;
            if (typeof name !== 'string') {
                return reply.status(400).send({ error: 'Name is required' });
            }
            const room = (0, db_1.dbGetRoom)(id);
            if (!room)
                return reply.status(404).send({ error: 'Room not found' });
            if ((0, db_1.dbGetMemberRole)(req.userId, id) !== 'owner') {
                return reply.status(403).send({ error: 'Only the owner can rename this room' });
            }
            const savedName = (0, db_1.dbSetRoomName)(id, name);
            log.info('Room renamed via REST', { userId: req.userId, roomId: id, name: savedName ?? '—' });
            return reply.send({ id, name: savedName });
        });
        protectedRoutes.post('/auth/rooms/:id/leave', async (req, reply) => {
            const { id } = req.params;
            const role = (0, db_1.dbGetMemberRole)(req.userId, id);
            if (!role)
                return reply.status(404).send({ error: 'You are not a member of this room' });
            if (role === 'owner') {
                return reply.status(403).send({ error: 'Owners cannot leave their own room. Delete it instead.' });
            }
            (0, db_1.dbRemoveMember)(req.userId, id);
            log.info('User left room', { userId: req.userId, roomId: id });
            (0, socket_1.notifyUserLeftRoom)(id, req.userId);
            return reply.send({ success: true });
        });
        // Delete a room
        protectedRoutes.delete('/auth/rooms/:id', async (req, reply) => {
            const { id } = req.params;
            const room = (0, db_1.dbGetRoom)(id);
            if (!room)
                return reply.status(404).send({ error: 'Room not found' });
            if ((0, db_1.dbGetMemberRole)(req.userId, id) !== 'owner') {
                return reply.status(403).send({ error: 'Only the owner can delete this room' });
            }
            (0, db_1.dbDeleteRoom)(id);
            log.info('Room deleted', { userId: req.userId, roomId: id });
            (0, socket_1.notifyRoomDeleted)(id);
            return reply.send({ success: true });
        });
        // ── Room member management ─────────────────────────────────────────
        // List members of a room
        protectedRoutes.get('/auth/rooms/:id/members', async (req, reply) => {
            const { id } = req.params;
            if (!(0, db_1.dbIsRoomMember)(req.userId, id)) {
                return reply.status(403).send({ error: 'You are not a member of this room' });
            }
            const members = (0, db_1.dbGetRoomMembers)(id);
            return reply.send({ members });
        });
        // Change a member's role (owner only)
        protectedRoutes.put('/auth/rooms/:id/members/:userId/role', async (req, reply) => {
            const { id, userId } = req.params;
            const { role } = req.body;
            if (!['editor', 'viewer'].includes(role)) {
                return reply.status(400).send({ error: 'Role must be editor or viewer' });
            }
            const callerRole = (0, db_1.dbGetMemberRole)(req.userId, id);
            if (callerRole !== 'owner') {
                return reply.status(403).send({ error: 'Only the owner can change roles' });
            }
            const targetRole = (0, db_1.dbGetMemberRole)(userId, id);
            if (!targetRole)
                return reply.status(404).send({ error: 'Member not found' });
            if (targetRole === 'owner')
                return reply.status(403).send({ error: 'Cannot change another owner\'s role' });
            (0, db_1.dbSetMemberRole)(userId, id, role);
            log.info('Member role changed', { by: req.userId, target: userId, roomId: id, role });
            return reply.send({ userId, role });
        });
        // Remove a member from a room (owner only, cannot remove self)
        protectedRoutes.delete('/auth/rooms/:id/members/:userId', async (req, reply) => {
            const { id, userId } = req.params;
            if (userId === req.userId) {
                return reply.status(400).send({ error: 'Cannot remove yourself. Leave the room instead.' });
            }
            const callerRole = (0, db_1.dbGetMemberRole)(req.userId, id);
            if (callerRole !== 'owner') {
                return reply.status(403).send({ error: 'Only the owner can remove members' });
            }
            const targetRole = (0, db_1.dbGetMemberRole)(userId, id);
            if (!targetRole)
                return reply.status(404).send({ error: 'Member not found' });
            if (targetRole === 'owner')
                return reply.status(403).send({ error: 'Cannot remove another owner' });
            (0, db_1.dbRemoveMember)(userId, id);
            log.info('Member removed', { by: req.userId, target: userId, roomId: id });
            return reply.send({ success: true });
        });
        // ── Settings routes ────────────────────────────────────────────────
        // Upload / replace avatar
        protectedRoutes.put('/auth/me/avatar', {
            config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
        }, async (req, reply) => {
            const { avatar } = req.body;
            if (!avatar || typeof avatar !== 'string')
                return reply.status(400).send({ error: 'avatar is required' });
            // Whitelist raster-only MIME types. data:image/svg+xml is excluded because
            // SVGs can contain <script> tags that execute in some browser contexts.
            const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
            const mimeMatch = avatar.match(/^data:([^;,]+)/);
            if (!mimeMatch || !ALLOWED_AVATAR_MIME.includes(mimeMatch[1])) {
                return reply.status(400).send({ error: 'Invalid image format. Allowed: JPEG, PNG, GIF, WebP' });
            }
            // Base64 payload only (strip the data URL prefix for size check)
            const base64 = avatar.split(',')[1] ?? '';
            const bytes = Math.ceil(base64.length * 0.75);
            if (bytes > 300000)
                return reply.status(413).send({ error: 'Image too large (max 300 KB)' });
            (0, db_1.dbSetUserAvatar)(req.userId, avatar);
            const user = (0, db_1.dbGetUserById)(req.userId);
            log.info('User avatar updated', { userId: req.userId });
            return reply.send({ user });
        });
        // Remove avatar
        protectedRoutes.delete('/auth/me/avatar', async (req, reply) => {
            (0, db_1.dbClearUserAvatar)(req.userId);
            const user = (0, db_1.dbGetUserById)(req.userId);
            log.info('User avatar removed', { userId: req.userId });
            return reply.send({ user });
        });
        // Update display name
        protectedRoutes.put('/auth/me/name', async (req, reply) => {
            const { name } = req.body;
            const trimmedName = name?.trim();
            if (!trimmedName)
                return reply.status(400).send({ error: 'Name is required' });
            if (trimmedName.length > 60)
                return reply.status(400).send({ error: 'Name must be 60 characters or less' });
            (0, db_1.dbUpdateUserName)(req.userId, trimmedName);
            const user = (0, db_1.dbGetUserById)(req.userId);
            log.info('User name updated', { userId: req.userId });
            return reply.send({ user });
        });
        // Update email
        protectedRoutes.put('/auth/me/email', async (req, reply) => {
            const { email, currentPassword } = req.body;
            if (!email?.trim())
                return reply.status(400).send({ error: 'Email is required' });
            if (!(0, validation_1.isValidEmail)(email))
                return reply.status(400).send({ error: 'Please enter a valid email address' });
            if (!currentPassword)
                return reply.status(400).send({ error: 'Current password is required' });
            // Verify password before sensitive change
            const userFull = (0, db_1.dbGetUserByEmail)(((0, db_1.dbGetUserById)(req.userId)?.email ?? ''));
            if (!userFull)
                return reply.status(404).send({ error: 'User not found' });
            const valid = await bcryptjs_1.default.compare(currentPassword, userFull.password_hash);
            if (!valid)
                return reply.status(401).send({ error: 'Incorrect password' });
            // Check email not already taken
            const existing = (0, db_1.dbGetUserByEmail)(email.toLowerCase().trim());
            if (existing && existing.id !== req.userId) {
                return reply.status(409).send({ error: 'Email already in use' });
            }
            (0, db_1.dbUpdateUserEmail)(req.userId, email);
            destroyOtherSessions(req.userId, req.sessionToken);
            const user = (0, db_1.dbGetUserById)(req.userId);
            log.info('User email updated', { userId: req.userId });
            return reply.send({ user });
        });
        // Update password
        protectedRoutes.put('/auth/me/password', async (req, reply) => {
            const { currentPassword, newPassword } = req.body;
            if (!currentPassword || !newPassword)
                return reply.status(400).send({ error: 'Both passwords are required' });
            if (newPassword.length < 6)
                return reply.status(400).send({ error: 'Password must be at least 6 characters' });
            if (newPassword.length > 72)
                return reply.status(400).send({ error: 'Password must be 72 characters or less' });
            const user = (0, db_1.dbGetUserById)(req.userId);
            if (!user)
                return reply.status(404).send({ error: 'User not found' });
            const userFull = (0, db_1.dbGetUserByEmail)(user.email);
            if (!userFull)
                return reply.status(404).send({ error: 'User not found' });
            const valid = await bcryptjs_1.default.compare(currentPassword, userFull.password_hash);
            if (!valid)
                return reply.status(401).send({ error: 'Incorrect current password' });
            const hash = await bcryptjs_1.default.hash(newPassword, 10);
            (0, db_1.dbUpdateUserPassword)(req.userId, hash);
            destroyOtherSessions(req.userId, req.sessionToken);
            log.info('User password updated', { userId: req.userId });
            return reply.send({ success: true });
        });
        // Delete account
        protectedRoutes.delete('/auth/me', async (req, reply) => {
            const { password } = req.body;
            if (!password)
                return reply.status(400).send({ error: 'Password is required' });
            const user = (0, db_1.dbGetUserById)(req.userId);
            if (!user)
                return reply.status(404).send({ error: 'User not found' });
            const userFull = (0, db_1.dbGetUserByEmail)(user.email);
            if (!userFull)
                return reply.status(404).send({ error: 'User not found' });
            const valid = await bcryptjs_1.default.compare(password, userFull.password_hash);
            if (!valid)
                return reply.status(401).send({ error: 'Incorrect password' });
            // Notify users in owned rooms before deleting data
            const ownedRooms = (0, db_1.dbGetOwnedRooms)(req.userId);
            (0, socket_1.disconnectAllUserSockets)(req.userId);
            for (const roomId of ownedRooms)
                (0, socket_1.notifyRoomDeleted)(roomId);
            (0, db_1.dbDeleteUser)(req.userId);
            reply.clearCookie(exports.SESSION_COOKIE_NAME, { path: '/' });
            log.info('User account deleted', { userId: req.userId });
            return reply.send({ success: true });
        });
        protectedRoutes.post('/auth/logout', async (req, reply) => {
            destroySession(req.sessionToken);
            (0, socket_1.disconnectAllUserSockets)(req.userId);
            reply.clearCookie(exports.SESSION_COOKIE_NAME, { path: '/' });
            log.info('User logged out', { userId: req.userId });
            return reply.send({ success: true });
        });
        // ── Room password ─────────────────────────────────────────────────
        // Set or remove room password (owner only)
        protectedRoutes.put('/auth/rooms/:roomId/password', async (req, reply) => {
            const { roomId } = req.params;
            const { password } = req.body;
            const role = (0, db_1.dbGetMemberRole)(req.userId, roomId);
            if (role !== 'owner')
                return reply.status(403).send({ error: 'Only the room owner can set a password' });
            if (!password) {
                (0, db_1.dbClearRoomPassword)(roomId);
                log.info('Room password removed', { roomId, userId: req.userId });
                return reply.send({ hasPassword: false });
            }
            if (typeof password !== 'string' || password.length < 4) {
                return reply.status(400).send({ error: 'Password must be at least 4 characters' });
            }
            const hash = await bcryptjs_1.default.hash(password, 10);
            (0, db_1.dbSetRoomPassword)(roomId, hash);
            log.info('Room password set', { roomId, userId: req.userId });
            return reply.send({ hasPassword: true });
        });
        // ── Invite links ──────────────────────────────────────────────────
        // Create an invite link (owner only)
        protectedRoutes.post('/auth/rooms/:roomId/invite', async (req, reply) => {
            const { roomId } = req.params;
            const { expiresIn } = req.body;
            const role = (0, db_1.dbGetMemberRole)(req.userId, roomId);
            if (role !== 'owner')
                return reply.status(403).send({ error: 'Only the room owner can create invite links' });
            const VALID_DURATIONS = [3600, 86400, 604800]; // 1h, 24h, 7d
            const duration = VALID_DURATIONS.includes(expiresIn) ? expiresIn : 86400;
            const expiresAt = Math.floor(Date.now() / 1000) + duration;
            const token = (0, nanoid_1.nanoid)(20);
            (0, db_1.dbCreateInvite)(token, roomId, req.userId, expiresAt);
            log.info('Invite created', { roomId, userId: req.userId, expiresAt });
            return reply.send({ token, expiresAt });
        });
        // Accept an invite link (any logged-in user)
        protectedRoutes.post('/invite/:token/accept', async (req, reply) => {
            const { token } = req.params;
            const invite = (0, db_1.dbGetInvite)(token);
            if (!invite)
                return reply.status(404).send({ error: 'Invite link not found or expired' });
            // If the room has a password, verify it before granting membership
            if (invite.password_hash) {
                const { password } = (req.body ?? {});
                if (!password) {
                    return reply.status(403).send({ error: 'This room requires a password', requiresPassword: true });
                }
                const valid = await bcryptjs_1.default.compare(password, invite.password_hash);
                if (!valid) {
                    return reply.status(403).send({ error: 'Incorrect password', wrongPassword: true });
                }
            }
            const existingRole = (0, db_1.dbGetMemberRole)(req.userId, invite.room_id);
            if (!existingRole) {
                (0, db_1.dbAddRoomMember)(req.userId, invite.room_id, 'viewer');
                log.info('User joined via invite', { userId: req.userId, roomId: invite.room_id });
            }
            (0, db_1.dbDeleteInvite)(token);
            return reply.send({ roomId: invite.room_id, roomName: invite.room_name ?? null });
        });
    });
}
