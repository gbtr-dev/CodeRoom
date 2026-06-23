
export const LIMITS = {
  ID: 128,                          // roomId, fileId, parentId, userId, knockId, tempId
  FILE_NAME: 255,
  ROOM_NAME: 60,
  USER_NAME: 60,
  EMAIL: 254,                       // limite RFC 5321 per un indirizzo email
  FILE_CONTENT: 2_000_000,          // ~2MB per file: ampio per del codice, blocca payload abnormi
  PATCH_INSERT: 2_000_000,          // testo inserito da un singolo code-patch
  RUN_CODE: 200_000,                // 200KB di codice da eseguire è già molto generoso
  IMPORT_ENTRIES: 500,              // max file+cartelle per singola import-zip
  IMPORT_TOTAL_CONTENT: 10_000_000, // 10MB totali di contenuto in un solo import
  CURSOR_POS: 1_000_000,            // riga/colonna: limite di sanità, non un vincolo "reale"
} as const

export function isString(v: unknown): v is string {
  return typeof v === 'string'
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return isString(v) && v.length > 0 && v.length <= maxLen
}

export function isBoundedString(v: unknown, maxLen: number): v is string {
  return isString(v) && v.length <= maxLen
}

export function isValidId(v: unknown): v is string {
  return isNonEmptyString(v, LIMITS.ID)
}
export function isNonNegativeInt(v: unknown, max: number): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= max
}

export function isFileKind(v: unknown): v is 'file' | 'folder' {
  return v === 'file' || v === 'folder'
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(v: unknown): v is string {
  return isNonEmptyString(v, LIMITS.EMAIL) && EMAIL_RE.test(v)
}