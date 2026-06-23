// Limiti e helper di validazione per i payload ricevuti dagli eventi
// Socket.IO. Ogni evento è input non fidato: un client può mandare
// qualunque tipo, lunghezza o valore (volutamente o per un bug), quindi
// ogni campo va controllato prima di usarlo per leggere/scrivere stato o
// per essere ribroadcastato agli altri client della stanza.

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

/** Stringa non vuota entro una lunghezza massima (id, nomi, ecc.) */
export function isNonEmptyString(v: unknown, maxLen: number): v is string {
  return isString(v) && v.length > 0 && v.length <= maxLen
}

/** Stringa entro una lunghezza massima, vuota compresa (es. contenuto file) */
export function isBoundedString(v: unknown, maxLen: number): v is string {
  return isString(v) && v.length <= maxLen
}

export function isValidId(v: unknown): v is string {
  return isNonEmptyString(v, LIMITS.ID)
}

/** Intero non negativo entro un massimo: esclude NaN, float, negativi, Infinity */
export function isNonNegativeInt(v: unknown, max: number): v is number {
  return isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= max
}

export function isFileKind(v: unknown): v is 'file' | 'folder' {
  return v === 'file' || v === 'folder'
}

// Regex minimale: non aderisce all'intero RFC 5322 (nessuna regex semplice
// lo fa davvero), ma basta a scartare i casi che contano qui — stringhe
// senza '@', senza dominio, con spazi — senza rifiutare indirizzi reali
// validi. Va abbinata a un limite di lunghezza, non usata da sola.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Email sintatticamente plausibile entro la lunghezza massima RFC. */
export function isValidEmail(v: unknown): v is string {
  return isNonEmptyString(v, LIMITS.EMAIL) && EMAIL_RE.test(v)
}