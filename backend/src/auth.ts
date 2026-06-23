import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import bcrypt from 'bcryptjs'
import { randomUUID, randomBytes } from 'crypto'
import { nanoid } from 'nanoid'
import {
  dbCreateUser,
  dbGetUserByEmail,
  dbGetUserById,
  dbGetUserRooms,
  dbSetRoomName,
  dbGetRoom,
  dbIsRoomMember,
  dbDeleteRoom,
  dbUpdateUserName,
  dbUpdateUserEmail,
  dbUpdateUserPassword,
  dbDeleteUser,
  dbAddRoomMember,
  dbGetMemberRole,
  dbSetRoomPassword,
  dbClearRoomPassword,
  dbSetMemberRole,
  dbGetRoomMembers,
  dbRemoveMember,
  dbCreateSession,
  dbGetSession,
  dbDeleteSession,
  dbDeleteOtherSessions,
  dbSetUserAvatar,
  dbClearUserAvatar,
  dbCreateInvite,
  dbGetInvite,
  dbDeleteInvite,
  type RoomRole,
} from './db'
import { notifyRoomDeleted, notifyUserLeftRoom, disconnectAllUserSockets } from './socket'
import { createLogger, maskEmail } from './logger'
import { checkLoginLock, recordLoginFailure, recordLoginSuccess } from './authRateLimiter'
import { isValidEmail } from './validation'

const log = createLogger('AUTH')

export const SESSION_COOKIE_NAME = 'coderoom_session'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 giorni, come la scadenza del vecchio JWT

function generateSessionToken(): string {

  return randomBytes(32).toString('hex')
}

function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,

    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

/** Crea una nuova sessione su DB e restituisce il token opaco da mettere nel cookie. */
export function createSession(userId: string): { token: string; expiresAt: number } {
  const token = generateSessionToken()
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
  dbCreateSession(token, userId, expiresAt)
  return { token, expiresAt }
}

/** Verifica un token di sessione contro il DB. Ritorna null se assente, scaduto o invalido. */
export function verifySessionToken(token: string): { userId: string } | null {
  const session = dbGetSession(token)
  if (!session) return null

  if (session.expires_at <= Math.floor(Date.now() / 1000)) {

    dbDeleteSession(token)
    return null
  }

  return { userId: session.user_id }
}

/** Cancella la sessione corrente dal DB (logout). */
export function destroySession(token: string) {
  dbDeleteSession(token)
}

/** Cancella tutte le altre sessioni dell'utente, mantenendo quella corrente (cambio password). */
export function destroyOtherSessions(userId: string, keepToken: string) {
  dbDeleteOtherSessions(userId, keepToken)
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    sessionToken: string
  }
}

async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies?.[SESSION_COOKIE_NAME]
  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized' })
  }

  const payload = verifySessionToken(token)
  if (!payload) {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
    return reply.status(401).send({ error: 'Invalid session' })
  }

  req.userId = payload.userId
  req.sessionToken = token
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // Signup
  app.post('/auth/signup', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const { name, email, password } = req.body as { name: string; email: string; password: string }

    if (!name || !email || !password) {
      return reply.status(400).send({ error: 'Name, email and password are required' })
    }
    if (name.trim().length > 60) {
      return reply.status(400).send({ error: 'Name must be 60 characters or less' })
    }
    if (!isValidEmail(email)) {
      return reply.status(400).send({ error: 'Please enter a valid email address' })
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' })
    }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = dbGetUserByEmail(normalizedEmail)
    if (existing) {
      log.warn('Signup failed — email already in use', { name: name.trim(), email: normalizedEmail })
      return reply.status(409).send({ error: 'Email already in use' })
    }

    const id = randomUUID()
    const passwordHash = await bcrypt.hash(password, 10)
    dbCreateUser(id, name.trim(), normalizedEmail, passwordHash)

    log.info('Signup successful', { userId: id, name: name.trim(), email: normalizedEmail })
    const { token } = createSession(id)
    reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS))
    return reply.send({ user: { id, name: name.trim(), email: normalizedEmail } })
  })

  // Login
  app.post('/auth/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string }

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' })
    }

    const normalizedEmail = email.toLowerCase().trim()

    const lockedForSeconds = checkLoginLock(normalizedEmail)
    if (lockedForSeconds !== null) {
      log.warn('Login bloccato — troppi tentativi falliti', { email: maskEmail(normalizedEmail), retryAfter: lockedForSeconds })
      reply.header('Retry-After', String(lockedForSeconds))
      return reply.status(429).send({ error: 'Too many failed login attempts. Please try again later.' })
    }

    const user = dbGetUserByEmail(normalizedEmail)
    if (!user) {
      recordLoginFailure(normalizedEmail)
      log.warn('Login failed — user not found', { email: maskEmail(normalizedEmail) })
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    const valid = await bcrypt.compare(password, user.password_hash)
    if (!valid) {
      recordLoginFailure(normalizedEmail)
      log.warn('Login failed — wrong password', { userId: user.id, email: maskEmail(user.email) })
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    recordLoginSuccess(normalizedEmail)
    log.info('Login successful', { userId: user.id, name: user.name, email: user.email })
    const { token } = createSession(user.id)
    reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS))
    return reply.send({ user: { id: user.id, name: user.name, email: user.email } })
  })

  // ── Route pubblica: info su un invite ────────────────────────────────
  app.get('/invite/:token', async (req, reply) => {
    const { token } = req.params as { token: string }
    const invite = dbGetInvite(token)
    if (!invite) return reply.status(404).send({ error: 'Invite link not found or expired' })
    return reply.send({
      token: invite.token,
      roomId: invite.room_id,
      roomName: invite.room_name ?? null,
      expiresAt: invite.expires_at,
      hasPassword: !!invite.password_hash,
    })
  })

  // ── Da qui in giù: solo rotte protette ───────────────────────────────
  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook('preHandler', requireAuth)

    // Get current user
    protectedRoutes.get('/auth/me', async (req, reply) => {
      const user = dbGetUserById(req.userId)
      if (!user) return reply.status(404).send({ error: 'User not found' })

      return reply.send({ user })
    })

    // Get user's rooms (cursor-based pagination)
    protectedRoutes.get('/auth/rooms', async (req, reply) => {
      const query = req.query as { cursor?: string }
      const cursor = query.cursor ? Number(query.cursor) : undefined
      const result = dbGetUserRooms(req.userId, cursor)
      return reply.send(result)
    })

    // Rename a room
    protectedRoutes.put('/auth/rooms/:id/name', async (req, reply) => {
      const { id } = req.params as { id: string }
      const { name } = req.body as { name: string }

      if (typeof name !== 'string') {
        return reply.status(400).send({ error: 'Name is required' })
      }

      const room = dbGetRoom(id)
      if (!room) return reply.status(404).send({ error: 'Room not found' })

      if (dbGetMemberRole(req.userId, id) !== 'owner') {
        return reply.status(403).send({ error: 'Only the owner can rename this room' })
      }

      const savedName = dbSetRoomName(id, name)
      log.info('Room renamed via REST', { userId: req.userId, roomId: id, name: savedName ?? '—' })
      return reply.send({ id, name: savedName })
    })

    protectedRoutes.post('/auth/rooms/:id/leave', async (req, reply) => {
      const { id } = req.params as { id: string }

      const role = dbGetMemberRole(req.userId, id)
      if (!role) return reply.status(404).send({ error: 'You are not a member of this room' })
      if (role === 'owner') {
        return reply.status(403).send({ error: 'Owners cannot leave their own room. Delete it instead.' })
      }

      dbRemoveMember(req.userId, id)
      log.info('User left room', { userId: req.userId, roomId: id })
      notifyUserLeftRoom(id, req.userId)
      return reply.send({ success: true })
    })

    // Delete a room
    protectedRoutes.delete('/auth/rooms/:id', async (req, reply) => {
      const { id } = req.params as { id: string }

      const room = dbGetRoom(id)
      if (!room) return reply.status(404).send({ error: 'Room not found' })

      if (dbGetMemberRole(req.userId, id) !== 'owner') {
        return reply.status(403).send({ error: 'Only the owner can delete this room' })
      }

      dbDeleteRoom(id)
      log.info('Room deleted', { userId: req.userId, roomId: id })

      notifyRoomDeleted(id)

      return reply.send({ success: true })
    })

    // ── Room member management ─────────────────────────────────────────

    // List members of a room
    protectedRoutes.get('/auth/rooms/:id/members', async (req, reply) => {
      const { id } = req.params as { id: string }

      if (!dbIsRoomMember(req.userId, id)) {
        return reply.status(403).send({ error: 'You are not a member of this room' })
      }

      const members = dbGetRoomMembers(id)
      return reply.send({ members })
    })

    // Change a member's role (owner only)
    protectedRoutes.put('/auth/rooms/:id/members/:userId/role', async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string }
      const { role } = req.body as { role: RoomRole }

      if (!['editor', 'viewer'].includes(role)) {
        return reply.status(400).send({ error: 'Role must be editor or viewer' })
      }

      const callerRole = dbGetMemberRole(req.userId, id)
      if (callerRole !== 'owner') {
        return reply.status(403).send({ error: 'Only the owner can change roles' })
      }

      const targetRole = dbGetMemberRole(userId, id)
      if (!targetRole) return reply.status(404).send({ error: 'Member not found' })
      if (targetRole === 'owner') return reply.status(403).send({ error: 'Cannot change another owner\'s role' })

      dbSetMemberRole(userId, id, role)
      log.info('Member role changed', { by: req.userId, target: userId, roomId: id, role })
      return reply.send({ userId, role })
    })

    // Remove a member from a room (owner only, cannot remove self)
    protectedRoutes.delete('/auth/rooms/:id/members/:userId', async (req, reply) => {
      const { id, userId } = req.params as { id: string; userId: string }

      if (userId === req.userId) {
        return reply.status(400).send({ error: 'Cannot remove yourself. Leave the room instead.' })
      }

      const callerRole = dbGetMemberRole(req.userId, id)
      if (callerRole !== 'owner') {
        return reply.status(403).send({ error: 'Only the owner can remove members' })
      }

      const targetRole = dbGetMemberRole(userId, id)
      if (!targetRole) return reply.status(404).send({ error: 'Member not found' })
      if (targetRole === 'owner') return reply.status(403).send({ error: 'Cannot remove another owner' })

      dbRemoveMember(userId, id)
      log.info('Member removed', { by: req.userId, target: userId, roomId: id })
      return reply.send({ success: true })
    })

    // ── Settings routes ────────────────────────────────────────────────

    // Upload / replace avatar
    protectedRoutes.put('/auth/me/avatar', async (req, reply) => {
      const { avatar } = req.body as { avatar?: string }
      if (!avatar || typeof avatar !== 'string') return reply.status(400).send({ error: 'avatar is required' })
      // Whitelist raster-only MIME types. data:image/svg+xml is excluded because
      // SVGs can contain <script> tags that execute in some browser contexts.
      const ALLOWED_AVATAR_MIME = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      const mimeMatch = avatar.match(/^data:([^;,]+)/)
      if (!mimeMatch || !ALLOWED_AVATAR_MIME.includes(mimeMatch[1])) {
        return reply.status(400).send({ error: 'Invalid image format. Allowed: JPEG, PNG, GIF, WebP' })
      }
      // Base64 payload only (strip the data URL prefix for size check)
      const base64 = avatar.split(',')[1] ?? ''
      const bytes = Math.ceil(base64.length * 0.75)
      if (bytes > 300_000) return reply.status(413).send({ error: 'Image too large (max 300 KB)' })
      dbSetUserAvatar(req.userId, avatar)
      const user = dbGetUserById(req.userId)
      log.info('User avatar updated', { userId: req.userId })
      return reply.send({ user })
    })

    // Remove avatar
    protectedRoutes.delete('/auth/me/avatar', async (req, reply) => {
      dbClearUserAvatar(req.userId)
      const user = dbGetUserById(req.userId)
      log.info('User avatar removed', { userId: req.userId })
      return reply.send({ user })
    })

    // Update display name
    protectedRoutes.put('/auth/me/name', async (req, reply) => {
      const { name } = req.body as { name: string }
      if (!name?.trim()) return reply.status(400).send({ error: 'Name is required' })

      dbUpdateUserName(req.userId, name)
      const user = dbGetUserById(req.userId)
      log.info('User name updated', { userId: req.userId })
      return reply.send({ user })
    })

    // Update email
    protectedRoutes.put('/auth/me/email', async (req, reply) => {
      const { email, currentPassword } = req.body as { email: string; currentPassword: string }
      if (!email?.trim()) return reply.status(400).send({ error: 'Email is required' })
      if (!isValidEmail(email)) return reply.status(400).send({ error: 'Please enter a valid email address' })
      if (!currentPassword) return reply.status(400).send({ error: 'Current password is required' })

      // Verify password before sensitive change
      const userFull = dbGetUserByEmail((dbGetUserById(req.userId)?.email ?? ''))
      if (!userFull) return reply.status(404).send({ error: 'User not found' })
      const valid = await bcrypt.compare(currentPassword, userFull.password_hash)
      if (!valid) return reply.status(401).send({ error: 'Incorrect password' })

      // Check email not already taken
      const existing = dbGetUserByEmail(email.toLowerCase().trim())
      if (existing && existing.id !== req.userId) {
        return reply.status(409).send({ error: 'Email already in use' })
      }

      dbUpdateUserEmail(req.userId, email)
      destroyOtherSessions(req.userId, req.sessionToken)
      const user = dbGetUserById(req.userId)
      log.info('User email updated', { userId: req.userId })
      return reply.send({ user })
    })

    // Update password
    protectedRoutes.put('/auth/me/password', async (req, reply) => {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string }
      if (!currentPassword || !newPassword) return reply.status(400).send({ error: 'Both passwords are required' })
      if (newPassword.length < 6) return reply.status(400).send({ error: 'Password must be at least 6 characters' })

      const user = dbGetUserById(req.userId)
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const userFull = dbGetUserByEmail(user.email)
      if (!userFull) return reply.status(404).send({ error: 'User not found' })

      const valid = await bcrypt.compare(currentPassword, userFull.password_hash)
      if (!valid) return reply.status(401).send({ error: 'Incorrect current password' })

      const hash = await bcrypt.hash(newPassword, 10)
      dbUpdateUserPassword(req.userId, hash)

      destroyOtherSessions(req.userId, req.sessionToken)
      log.info('User password updated', { userId: req.userId })
      return reply.send({ success: true })
    })

    // Delete account
    protectedRoutes.delete('/auth/me', async (req, reply) => {
      const { password } = req.body as { password: string }
      if (!password) return reply.status(400).send({ error: 'Password is required' })

      const user = dbGetUserById(req.userId)
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const userFull = dbGetUserByEmail(user.email)
      if (!userFull) return reply.status(404).send({ error: 'User not found' })

      const valid = await bcrypt.compare(password, userFull.password_hash)
      if (!valid) return reply.status(401).send({ error: 'Incorrect password' })

      disconnectAllUserSockets(req.userId)
      dbDeleteUser(req.userId)
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      log.info('User account deleted', { userId: req.userId })
      return reply.send({ success: true })
    })

    protectedRoutes.post('/auth/logout', async (req, reply) => {
      destroySession(req.sessionToken)
      disconnectAllUserSockets(req.userId)
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      log.info('User logged out', { userId: req.userId })
      return reply.send({ success: true })
    })

    // ── Room password ─────────────────────────────────────────────────

    // Set or remove room password (owner only)
    protectedRoutes.put('/auth/rooms/:roomId/password', async (req, reply) => {
      const { roomId } = req.params as { roomId: string }
      const { password } = req.body as { password: string | null }

      const role = dbGetMemberRole(req.userId, roomId)
      if (role !== 'owner') return reply.status(403).send({ error: 'Only the room owner can set a password' })

      if (!password) {
        dbClearRoomPassword(roomId)
        log.info('Room password removed', { roomId, userId: req.userId })
        return reply.send({ hasPassword: false })
      }

      if (typeof password !== 'string' || password.length < 4) {
        return reply.status(400).send({ error: 'Password must be at least 4 characters' })
      }

      const hash = await bcrypt.hash(password, 10)
      dbSetRoomPassword(roomId, hash)
      log.info('Room password set', { roomId, userId: req.userId })
      return reply.send({ hasPassword: true })
    })

    // ── Invite links ──────────────────────────────────────────────────

    // Create an invite link (owner only)
    protectedRoutes.post('/auth/rooms/:roomId/invite', async (req, reply) => {
      const { roomId } = req.params as { roomId: string }
      const { expiresIn } = req.body as { expiresIn?: number }

      const role = dbGetMemberRole(req.userId, roomId)
      if (role !== 'owner') return reply.status(403).send({ error: 'Only the room owner can create invite links' })

      const VALID_DURATIONS = [3600, 86400, 604800] // 1h, 24h, 7d
      const duration = VALID_DURATIONS.includes(expiresIn!) ? expiresIn! : 86400
      const expiresAt = Math.floor(Date.now() / 1000) + duration

      const token = nanoid(20)
      dbCreateInvite(token, roomId, req.userId, expiresAt)
      log.info('Invite created', { roomId, userId: req.userId, expiresAt })
      return reply.send({ token, expiresAt })
    })

    // Accept an invite link (any logged-in user)
    protectedRoutes.post('/invite/:token/accept', async (req, reply) => {
      const { token } = req.params as { token: string }
      const invite = dbGetInvite(token)
      if (!invite) return reply.status(404).send({ error: 'Invite link not found or expired' })

      // If the room has a password, verify it before granting membership
      if (invite.password_hash) {
        const { password } = (req.body ?? {}) as { password?: string }
        if (!password) {
          return reply.status(403).send({ error: 'This room requires a password', requiresPassword: true })
        }
        const valid = await bcrypt.compare(password, invite.password_hash)
        if (!valid) {
          return reply.status(403).send({ error: 'Incorrect password', wrongPassword: true })
        }
      }

      const existingRole = dbGetMemberRole(req.userId, invite.room_id)
      if (!existingRole) {
        dbAddRoomMember(req.userId, invite.room_id, 'viewer')
        log.info('User joined via invite', { userId: req.userId, roomId: invite.room_id })
      }

      return reply.send({ roomId: invite.room_id, roomName: invite.room_name ?? null })
    })
  })
}