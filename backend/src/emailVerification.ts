import { createHash, randomBytes } from 'crypto'
import {
  dbCountEmailVerificationsSince,
  dbCreateEmailVerification,
  dbDeleteOldEmailVerifications,
  dbDeleteStaleUnverifiedUsers,
  dbDeleteExpiredSignupRequests,
  dbGetEmailVerificationStats,
  type EmailVerificationPurpose,
} from './db'
import { createLogger, maskEmail } from './logger'
import { buildVerificationEmail, getMailConfig, sendMail } from './mail'

const log = createLogger('EMAIL-VERIFY')

/** How long a confirmation link stays valid. */
export const VERIFICATION_TTL_SECONDS = 24 * 60 * 60
/** Accounts that never confirmed their email are deleted after this time. */
export const UNVERIFIED_ACCOUNT_TTL_SECONDS = 48 * 60 * 60
/** Minimum time between two emails to the same address. */
export const RESEND_COOLDOWN_SECONDS = 60
/** Maximum emails to the same address in one hour. */
export const MAX_EMAILS_PER_HOUR = 5

/* ------------------------------------------------------------------ */
/* Tokens                                                              */
/* ------------------------------------------------------------------ */

/** The raw token only travels by email; the database stores its SHA-256 hash. */
export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function generateVerificationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url')
  return { token, hash: hashVerificationToken(token) }
}

/* ------------------------------------------------------------------ */
/* Sending policy                                                      */
/* ------------------------------------------------------------------ */

export type SendCheck =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'hourly' | 'daily'; retryAfterSeconds?: number }

/**
 * Per-address limits (cooldown + hourly) and a global daily cap that protects the sending
 * quota and the reputation of the sender domain. Counts come from the database, so they
 * survive restarts.
 */
export function checkSendAllowed(email: string, nowSec: number = Math.floor(Date.now() / 1000)): SendCheck {
  const { dailyLimit } = getMailConfig()
  if (dbCountEmailVerificationsSince(nowSec - 24 * 60 * 60) >= dailyLimit) {
    return { ok: false, reason: 'daily' }
  }

  const lastHour = dbGetEmailVerificationStats(email, nowSec - 60 * 60)
  if (lastHour.lastAt !== null && nowSec - lastHour.lastAt < RESEND_COOLDOWN_SECONDS) {
    return { ok: false, reason: 'cooldown', retryAfterSeconds: RESEND_COOLDOWN_SECONDS - (nowSec - lastHour.lastAt) }
  }
  if (lastHour.count >= MAX_EMAILS_PER_HOUR) {
    return { ok: false, reason: 'hourly' }
  }
  return { ok: true }
}

export type SendVerificationResult =
  | { status: 'sent' }
  | { status: 'stale_credentials' }
  | { status: 'throttled'; reason: 'cooldown' | 'hourly' | 'daily'; retryAfterSeconds?: number }
  | { status: 'failed' }

/**
 * Creates a one-time token and emails the confirmation link.
 * The limit check and the insert of the token are synchronous (no await between them), so two
 * concurrent requests cannot both slip under the limit.
 */
export async function sendVerificationEmail(params: {
  userId: string
  name: string
  email: string
  purpose: EmailVerificationPurpose
  expectedPasswordHash?: string
  signupCredentials?: { name: string; passwordHash: string }
}): Promise<SendVerificationResult> {
  const { userId, name, email, purpose } = params
  const nowSec = Math.floor(Date.now() / 1000)

  const check = checkSendAllowed(email, nowSec)
  if (!check.ok) {
    log.warn('Invio email di verifica limitato', { email: maskEmail(email), reason: check.reason })
    return { status: 'throttled', reason: check.reason, retryAfterSeconds: check.retryAfterSeconds }
  }

  const { token, hash } = generateVerificationToken()
  const created = dbCreateEmailVerification(hash, userId, email, purpose, nowSec + VERIFICATION_TTL_SECONDS, nowSec, params.expectedPasswordHash, params.signupCredentials)
  if (!created) return { status: 'stale_credentials' }

  const link = `${getMailConfig().appUrl}/verify-email?token=${token}`
  const message = buildVerificationEmail({
    name,
    link,
    purpose,
    expiresInHours: VERIFICATION_TTL_SECONDS / 3600,
  })

  try {
    await sendMail({ to: email, ...message, idempotencyKey: `verify-${hash.slice(0, 32)}` })
    log.info('Email di verifica inviata', { userId, email: maskEmail(email), purpose })
    return { status: 'sent' }
  } catch (err) {
    // The token stays in the table on purpose: a failed send still counts towards the limits
    log.error('Invio email di verifica fallito', { userId, email: maskEmail(email), error: String(err) })
    return { status: 'failed' }
  }
}

/* ------------------------------------------------------------------ */
/* Cleanup (to be run periodically)                                    */
/* ------------------------------------------------------------------ */

export function runEmailVerificationCleanup(nowSec: number = Math.floor(Date.now() / 1000)): { users: number; tokens: number } {
  dbDeleteExpiredSignupRequests(nowSec)
  const users = dbDeleteStaleUnverifiedUsers(nowSec - UNVERIFIED_ACCOUNT_TTL_SECONDS)
  const tokens = dbDeleteOldEmailVerifications(nowSec - 2 * 24 * 60 * 60)
  if (users > 0 || tokens > 0) {
    log.info('Pulizia verifiche email', { unverifiedUsersDeleted: users, tokensDeleted: tokens })
  }
  return { users, tokens }
}
