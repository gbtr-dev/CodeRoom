import { createHash } from 'crypto'
import { createLogger } from './logger'
import {
  dbGetLoginAttempt,
  dbUpsertLoginAttempt,
  dbDeleteLoginAttempt,
  dbDeleteExpiredLoginAttempts,
} from './db'

const log = createLogger('AUTH-RATE-LIMIT')

const MAX_ATTEMPTS = 5
const WINDOW_S = 5 * 60   // 5 minuti
const LOCK_S   = 10 * 60  // 10 minuti

setInterval(() => {
  dbDeleteExpiredLoginAttempts()
}, 10 * 60 * 1000).unref()

// Versioned digest avoids collisions with legacy account-wide rows and keeps IPs out of storage.
function normalizeKey(email: string, clientIp: string): string {
  return 'login-v2:' + createHash('sha256')
    .update(JSON.stringify([email.toLowerCase().trim(), clientIp]))
    .digest('hex')
}

export function checkLoginLock(email: string, clientIp: string): number | null {
  const key = normalizeKey(email, clientIp)
  const row = dbGetLoginAttempt(key)
  if (!row || row.locked_until === null) return null

  const now = Math.floor(Date.now() / 1000)
  if (row.locked_until > now) {
    return row.locked_until - now
  }

  dbDeleteLoginAttempt(key)
  return null
}

export function recordLoginFailure(email: string, clientIp: string): void {
  const key = normalizeKey(email, clientIp)
  const now = Math.floor(Date.now() / 1000)
  const row = dbGetLoginAttempt(key)

  // Requests already comparing passwords must not extend or clear an active lock.
  if (row && row.locked_until !== null && row.locked_until > now) return

  if (!row || now - row.first_attempt_at > WINDOW_S) {
    dbUpsertLoginAttempt(key, 1, now, null)
    return
  }

  const count = row.count + 1
  const lockedUntil = count >= MAX_ATTEMPTS ? now + LOCK_S : null
  if (lockedUntil) {
    log.warn('Accesso da questo indirizzo IP limitato per troppi fallimenti di login', {
      attempts: count,
      lockMinutes: LOCK_S / 60,
    })
  }
  dbUpsertLoginAttempt(key, count, row.first_attempt_at, lockedUntil)
}

export function recordLoginSuccess(email: string, clientIp: string): void {
  dbDeleteLoginAttempt(normalizeKey(email, clientIp))
}
