import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import bcrypt from 'bcryptjs'
import { fitsBcrypt, comparePassword, PASSWORD_SIZE_ERROR } from './passwords'
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
  dbChangePasswordForSession,
  dbDeleteUserForSession,
  dbGetMemberRole,
  dbSetRoomPassword,
  dbClearRoomPassword,
  dbSetMemberRole,
  dbGetRoomMembers,
  dbRemoveMember,
  dbCreateSession,
  dbCreateSessionForCredentials,
  dbGetSession,
  dbDeleteSession,
  dbDeleteOtherSessions,
  dbSetUserAvatar,
  dbClearUserAvatar,
  dbCreateInvite,
  dbGetInvite,
  dbAcceptInvite,
  dbConsumeEmailVerification,
  dbCreateSignupRequest,
  dbGetSignupRequest,
  dbDeleteSessionsByUser,
  type RoomRole,
} from './db'
import { notifyRoomDeleted, notifyUserLeftRoom, notifyMemberRoleChanged, notifyMemberRemoved, disconnectAllUserSockets, disconnectRevokedUserSockets } from './socket'
import { createLogger, maskEmail } from './logger'
import { checkLoginLock, recordLoginFailure, recordLoginSuccess } from './authRateLimiter'
import { isValidEmail } from './validation'
import { hashVerificationToken, sendVerificationEmail, VERIFICATION_TTL_SECONDS } from './emailVerification'

const log = createLogger('AUTH')
// Same bcrypt cost as signup; generated once, never used for an actual account.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(randomBytes(32).toString('hex'), 10)

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

// An email change sends a message to an arbitrary address: cap how many a single account can request
const EMAIL_CHANGE_MAX_PER_HOUR = 5
const emailChangeRequests = new Map<string, number[]>()

function takeEmailChangeSlot(userId: string): boolean {
  const now = Date.now()
  const recent = (emailChangeRequests.get(userId) ?? []).filter((t) => now - t < 60 * 60 * 1000)
  if (recent.length >= EMAIL_CHANGE_MAX_PER_HOUR) {
    emailChangeRequests.set(userId, recent)
    return false
  }
  recent.push(now)
  emailChangeRequests.set(userId, recent)
  return true
}

export const SESSION_COOKIE_NAME = 'coderoom_session'

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 giorni, come la scadenza del vecchio JWT

function generateSessionToken(): string {

  return randomBytes(32).toString('hex')
}

function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,

    secure: process.env.NODE_ENV !== 'development',
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
  // Creating a session may prune older sessions beyond the account limit.
  disconnectRevokedUserSockets(userId)
  return { token, expiresAt }
}

/** Verifica un token di sessione contro il DB. Ritorna null se assente, scaduto o invalido. */
export function verifySessionToken(token: string): { userId: string; expiresAt: number } | null {
  // Token = 32 random bytes in hex = exactly 64 lowercase hex chars
  if (token.length !== 64 || !/^[0-9a-f]+$/.test(token)) return null

  const session = dbGetSession(token)
  if (!session) return null

  if (session.expires_at <= Math.floor(Date.now() / 1000)) {

    dbDeleteSession(token)
    return null
  }

  return { userId: session.user_id, expiresAt: session.expires_at }
}

/** Cancella la sessione corrente dal DB (logout). */
export function destroySession(token: string) {
  const session = dbGetSession(token)
  dbDeleteSession(token)
  if (session) disconnectRevokedUserSockets(session.user_id)
}

/** Cancella tutte le altre sessioni dell'utente, mantenendo quella corrente (cambio password). */
export function destroyOtherSessions(userId: string, keepToken: string) {
  dbDeleteOtherSessions(userId, keepToken)
  disconnectRevokedUserSockets(userId)
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
  // Signup — creates an UNVERIFIED account and emails a confirmation link. No session is created:
  // the account can only be used after the address has been confirmed.
  app.post('/auth/signup', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const name = readString(body.name)
    const email = readString(body.email)
    const password = readString(body.password)

    if (!name || !email || !password) {
      return reply.status(400).send({ error: 'Name, email and password are required' })
    }
    if (!name.trim()) {
      return reply.status(400).send({ error: 'Name is required' })
    }
    if (name.trim().length > 60) {
      return reply.status(400).send({ error: 'Name must be 60 characters or less' })
    }
    if (!isValidEmail(email.trim())) {
      return reply.status(400).send({ error: 'Please enter a valid email address' })
    }
    if (password.length < 6) {
      return reply.status(400).send({ error: 'Password must be at least 6 characters' })
    }
    if (!fitsBcrypt(password)) {
      return reply.status(400).send({ error: PASSWORD_SIZE_ERROR })
    }

    const trimmedName = name.trim()
    const normalizedEmail = email.toLowerCase().trim()

    const passwordHash = await bcrypt.hash(password, 10)

    // Look the account up again right before writing (no await in between): the hash above takes
    // time, and another request could have created or confirmed this address meanwhile.
    const latest = dbGetUserByEmail(normalizedEmail)
    let userId: string
    if (latest) {
      if (latest.email_verified_at) {
        return reply.status(409).send({
          code: 'email_already_registered',
          error: 'This email is already registered. Sign in with your existing account.',
        })
      }
      // Preserve earlier links and credentials until the owner confirms a specific request.
      userId = latest.id
      log.info('Signup — additional confirmation requested', { userId, email: maskEmail(normalizedEmail) })
    } else {
      userId = randomUUID()
      dbCreateUser(userId, trimmedName, normalizedEmail, passwordHash)
      log.info('Signup successful — waiting for email confirmation', { userId, name: trimmedName, email: maskEmail(normalizedEmail) })
    }

    // This capability authorizes resending this credential snapshot, not confirming it.
    // Never use the account placeholder or another browser's latest request for resends.
    const resendToken = randomBytes(32).toString('base64url')
    dbCreateSignupRequest(hashVerificationToken(resendToken), userId, normalizedEmail, trimmedName, passwordHash,
      Math.floor(Date.now() / 1000) + VERIFICATION_TTL_SECONDS)
    reply.header('Cache-Control', 'no-store')

    // Provider latency and delivery status must not reveal account existence.
    void sendVerificationEmail({ userId, name: trimmedName, email: normalizedEmail, purpose: 'signup', signupCredentials: { name: trimmedName, passwordHash } })
      .catch((err) => log.error('Signup verification failed', { error: String(err) }))
    return reply.send({ status: 'verification_required', email: normalizedEmail, resendToken })
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
    const body = (req.body ?? {}) as Record<string, unknown>
    const email = readString(body.email)
    const password = readString(body.password)

    if (!email || !password) {
      return reply.status(400).send({ error: 'Email and password are required' })
    }

    const normalizedEmail = email.toLowerCase().trim()

    const lockedForSeconds = checkLoginLock(normalizedEmail, req.ip)
    if (lockedForSeconds !== null) {
      log.warn('Login bloccato — troppi tentativi falliti', { email: maskEmail(normalizedEmail), retryAfter: lockedForSeconds })
      reply.header('Retry-After', String(lockedForSeconds))
      return reply.status(429).send({ error: 'Too many failed login attempts. Please try again later.' })
    }

    const user = dbGetUserByEmail(normalizedEmail)
    const valid = await comparePassword(password, user?.password_hash ?? DUMMY_PASSWORD_HASH)
    // Pending accounts also use the generic response: signup followed by login with
    // a chosen password must not reveal whether signup created a new account.
    if (!user || !valid || !user.email_verified_at) {
      recordLoginFailure(normalizedEmail, req.ip)
      log.warn('Login failed', { email: maskEmail(normalizedEmail) })
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    const token = generateSessionToken()
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    if (!dbCreateSessionForCredentials(token, user.id, expiresAt, normalizedEmail, user.password_hash)) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }
    disconnectRevokedUserSockets(user.id)
    recordLoginSuccess(normalizedEmail, req.ip)
    log.info('Login successful', { userId: user.id, name: user.name, email: maskEmail(user.email) })
    reply.setCookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(SESSION_TTL_SECONDS))
    return reply.send({ user: { id: user.id, name: user.name, email: user.email } })
  })

  // Confirms an email address (signup or email change). It is a POST on purpose: the page opened from
  // the link sends it only after explicit confirmation; GET and page mounting never consume it.
  app.post('/auth/verify-email', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const token = readString(((req.body ?? {}) as Record<string, unknown>).token)
    if (!token || token.length < 20 || token.length > 128) {
      return reply.status(400).send({ error: 'This link is not valid', code: 'invalid_token' })
    }

    const result = dbConsumeEmailVerification(hashVerificationToken(token))
    switch (result.status) {
      case 'ok':
        if (result.purpose === 'change') {
          // The address used to sign in changed: every session has to sign in again
          dbDeleteSessionsByUser(result.userId)
          disconnectRevokedUserSockets(result.userId)
        }
        log.info('Email confirmed', { userId: result.userId, email: maskEmail(result.email), purpose: result.purpose })
        return reply.send({ status: 'verified', purpose: result.purpose, email: result.email })
      case 'expired':
        return reply.status(410).send({ error: 'This link has expired', code: 'token_expired' })
      case 'conflict':
        return reply.status(409).send({ error: 'This email address is already used by another account', code: 'email_taken' })
      default:
        return reply.status(400).send({ error: 'This link is not valid or was already used', code: 'invalid_token' })
    }
  })

  // Resend only the signup snapshot identified by the browser's capability.
  // Invalid capabilities receive the same error regardless of account existence.
  app.post('/auth/resend-verification', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
      },
    },
  }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const email = readString(body.email)
    if (!email || !isValidEmail(email)) {
      return reply.status(400).send({ error: 'Please enter a valid email address' })
    }

    const resendToken = readString(body.resendToken)
    const normalizedEmail = email.toLowerCase().trim()
    const pending = resendToken && /^[A-Za-z0-9_-]{43}$/.test(resendToken)
      ? dbGetSignupRequest(hashVerificationToken(resendToken), normalizedEmail)
      : undefined
    if (!pending) {
      return reply.status(400).send({ error: 'This registration request is missing or has expired. Please submit the signup form again, or sign in if you already confirmed your email.' })
    }
    // Sending still uses the normal cooldown and hourly/daily limits.
    void sendVerificationEmail({ userId: pending.user_id, name: pending.name, email: normalizedEmail,
      purpose: 'signup', signupCredentials: { name: pending.name, passwordHash: pending.password_hash } })
      .catch((err) => log.error('Reinvio verifica fallito', { error: String(err) }))
    return reply.send({ status: 'ok' })
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
      const cursorRaw = query.cursor ? Number(query.cursor) : undefined
      if (cursorRaw !== undefined && (!Number.isInteger(cursorRaw) || cursorRaw < 0)) {
        return reply.status(400).send({ error: 'Invalid cursor' })
      }
      const cursor = cursorRaw
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
      notifyMemberRoleChanged(id, userId, role)
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
      notifyMemberRemoved(id, userId)
      log.info('Member removed', { by: req.userId, target: userId, roomId: id })
      return reply.send({ success: true })
    })

    // ── Settings routes ────────────────────────────────────────────────

    // Upload / replace avatar
    protectedRoutes.put('/auth/me/avatar', {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    }, async (req, reply) => {
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
      const trimmedName = name?.trim()
      if (!trimmedName) return reply.status(400).send({ error: 'Name is required' })
      if (trimmedName.length > 60) return reply.status(400).send({ error: 'Name must be 60 characters or less' })

      dbUpdateUserName(req.userId, trimmedName)
      const user = dbGetUserById(req.userId)
      log.info('User name updated', { userId: req.userId })
      return reply.send({ user })
    })

    // Update email — the change is NOT applied here: a confirmation link goes to the new address
    // and the email only changes when it is opened (see /auth/verify-email).
    protectedRoutes.put('/auth/me/email', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const email = readString(body.email)
      const currentPassword = readString(body.currentPassword)
      if (!email?.trim()) return reply.status(400).send({ error: 'Email is required' })
      if (!isValidEmail(email)) return reply.status(400).send({ error: 'Please enter a valid email address' })
      if (!currentPassword) return reply.status(400).send({ error: 'Current password is required' })

      // Verify password before sensitive change
      const current = dbGetUserById(req.userId)
      const userFull = dbGetUserByEmail(current?.email ?? '')
      if (!current || !userFull) return reply.status(404).send({ error: 'User not found' })
      const valid = await comparePassword(currentPassword, userFull.password_hash)
      if (!valid) return reply.status(401).send({ error: 'Incorrect password' })

      const newEmail = email.toLowerCase().trim()
      if (newEmail === current.email) {
        return reply.status(400).send({ error: 'This is already your email address' })
      }

      // Check email not already taken
      const existing = dbGetUserByEmail(newEmail)
      if (existing && existing.id !== req.userId) {
        return reply.status(409).send({ error: 'Email already in use' })
      }

      if (!takeEmailChangeSlot(req.userId)) {
        return reply.status(429).send({ error: 'Too many email change requests. Please try again later.' })
      }

      const result = await sendVerificationEmail({
        userId: req.userId, name: current.name, email: newEmail, purpose: 'change',
        expectedPasswordHash: userFull.password_hash,
      })
      if (result.status === 'stale_credentials') {
        return reply.status(401).send({ error: 'Credentials changed. Please try again.' })
      }
      if (result.status === 'throttled') {
        if (result.retryAfterSeconds) reply.header('Retry-After', String(result.retryAfterSeconds))
        return reply.status(429).send({ error: 'A confirmation email was sent recently. Please wait a moment and try again.' })
      }
      if (result.status === 'failed') {
        return reply.status(502).send({ error: 'The confirmation email could not be sent. Please try again later.' })
      }

      log.info('Email change requested — waiting for confirmation', { userId: req.userId, email: maskEmail(newEmail) })
      // `user` is unchanged on purpose: the address changes only after the link is opened
      return reply.send({ status: 'confirmation_sent', pendingEmail: newEmail, user: current })
    })

    // Update password
    protectedRoutes.put('/auth/me/password', async (req, reply) => {
      const body = (req.body ?? {}) as Record<string, unknown>
      const currentPassword = readString(body.currentPassword)
      const newPassword = readString(body.newPassword)
      if (!currentPassword || !newPassword) return reply.status(400).send({ error: 'Both passwords are required' })
      if (newPassword.length < 6) return reply.status(400).send({ error: 'Password must be at least 6 characters' })
      if (!fitsBcrypt(newPassword)) return reply.status(400).send({ error: PASSWORD_SIZE_ERROR })

      const user = dbGetUserById(req.userId)
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const userFull = dbGetUserByEmail(user.email)
      if (!userFull) return reply.status(404).send({ error: 'User not found' })

      const valid = await comparePassword(currentPassword, userFull.password_hash)
      if (!valid) return reply.status(401).send({ error: 'Incorrect current password' })

      const hash = await bcrypt.hash(newPassword, 10)
      if (!dbChangePasswordForSession(req.userId, req.sessionToken, userFull.password_hash, hash)) {
        return reply.status(401).send({ error: 'Session or credentials changed. Please sign in again.' })
      }

      disconnectRevokedUserSockets(req.userId)
      log.info('User password updated', { userId: req.userId })
      return reply.send({ success: true })
    })

    // Delete account
    protectedRoutes.delete('/auth/me', async (req, reply) => {
      const password = readString(((req.body ?? {}) as Record<string, unknown>).password)
      if (!password) return reply.status(400).send({ error: 'Password is required' })

      const user = dbGetUserById(req.userId)
      if (!user) return reply.status(404).send({ error: 'User not found' })
      const userFull = dbGetUserByEmail(user.email)
      if (!userFull) return reply.status(404).send({ error: 'User not found' })

      const valid = await comparePassword(password, userFull.password_hash)
      if (!valid) return reply.status(401).send({ error: 'Incorrect password' })

      const ownedRooms = dbDeleteUserForSession(req.userId, req.sessionToken, userFull.password_hash)
      if (ownedRooms === null) {
        return reply.status(401).send({ error: 'Session or credentials changed. Please sign in again.' })
      }
      // Notify only after the guarded deletion commits successfully.
      disconnectAllUserSockets(req.userId)
      for (const roomId of ownedRooms) notifyRoomDeleted(roomId)
      reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' })
      log.info('User account deleted', { userId: req.userId })
      return reply.send({ success: true })
    })

    protectedRoutes.post('/auth/logout', async (req, reply) => {
      destroySession(req.sessionToken)
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

      if (!fitsBcrypt(password)) return reply.status(400).send({ error: PASSWORD_SIZE_ERROR })
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
        if (typeof password !== 'string' || !password) {
          return reply.status(403).send({ error: 'This room requires a password', requiresPassword: true })
        }
        const valid = await comparePassword(password, invite.password_hash)
        if (!valid) {
          return reply.status(403).send({ error: 'Incorrect password', wrongPassword: true })
        }
      }

      const result = dbAcceptInvite(token, req.userId, req.sessionToken, invite.password_hash)
      if (result.status === 'unauthorized') {
        return reply.status(401).send({ error: 'Invalid session' })
      }
      if (result.status === 'invalid') {
        return reply.status(404).send({ error: 'Invite link not found or expired' })
      }
      if (result.status === 'password_changed') {
        return reply.status(409).send({ error: 'Room password changed. Please try again.' })
      }
      log.info('Invite accepted', { userId: req.userId, roomId: result.roomId })
      return reply.send({ roomId: result.roomId, roomName: result.roomName ?? null })
    })
  })
}
