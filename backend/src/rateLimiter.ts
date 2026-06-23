import type { Socket } from 'socket.io'
import { createLogger } from './logger'

const log = createLogger('RATE-LIMIT')

/**
 * Token bucket: `capacity` token disponibili da subito (assorbe i burst
 * legittimi, es. raffiche di digitazione), che si ricaricano nel tempo alla
 * velocità di `refillPerSec` token/secondo (limite "a regime").
 */
class TokenBucket {
  private tokens: number
  private last: number

  constructor(private capacity: number, private refillPerSec: number) {
    this.tokens = capacity
    this.last = Date.now()
  }

  /** Prova a consumare `cost` token. Ritorna false se non ce ne sono abbastanza. */
  tryRemove(cost = 1): boolean {
    const now = Date.now()
    const elapsedSec = (now - this.last) / 1000
    this.last = now
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec)

    if (this.tokens < cost) return false
    this.tokens -= cost
    return true
  }
}

type RateLimitConfig = { capacity: number; refillPerSec: number }

// Limiti calibrati sul comportamento di un client legittimo (vedi debounce/throttle
// nel frontend: code-change/code-patch ogni 120ms, cursor-move ogni 80ms) più un
// margine di sicurezza. run-code e import-zip sono molto più stretti perché
// generano lavoro pesante (spawn di processi, scrittura sincrona su SQLite).
const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'code-change':      { capacity: 25, refillPerSec: 15 },
  'code-patch':       { capacity: 25, refillPerSec: 15 },
  'cursor-move':      { capacity: 20, refillPerSec: 15 },
  'create-file':      { capacity: 10, refillPerSec: 2 },
  'import-zip':       { capacity: 2,  refillPerSec: 0.1 },
  'delete-file':      { capacity: 10, refillPerSec: 2 },
  'rename-file':      { capacity: 10, refillPerSec: 2 },
  'move-file':        { capacity: 10, refillPerSec: 2 },
  'rename-room':      { capacity: 5,  refillPerSec: 0.5 },
  'run-code':         { capacity: 3,  refillPerSec: 0.2 },
  'set-member-role':  { capacity: 10, refillPerSec: 1 },
  'kick-member':      { capacity: 10, refillPerSec: 1 },
  'join-room':        { capacity: 5,  refillPerSec: 0.5 },
  'approve-knock':    { capacity: 20, refillPerSec: 2 },
  'deny-knock':       { capacity: 20, refillPerSec: 2 },
}

// Budget "anti-abuso": ogni volta che un evento viene scartato per rate limit
// consumiamo 1 token da qui. Si ricarica lentamente (1/sec), quindi un client
// che sfora occasionalmente non viene mai disconnesso, ma un client che spamma
// di continuo lo esaurisce in pochi secondi e viene buttato fuori.
const ABUSE_BUDGET: RateLimitConfig = { capacity: 60, refillPerSec: 1 }

function getBuckets(socket: Socket): Map<string, TokenBucket> {
  if (!socket.data.__rateBuckets) {
    socket.data.__rateBuckets = new Map<string, TokenBucket>()
  }
  return socket.data.__rateBuckets
}

function getAbuseBudget(socket: Socket): TokenBucket {
  if (!socket.data.__abuseBudget) {
    socket.data.__abuseBudget = new TokenBucket(ABUSE_BUDGET.capacity, ABUSE_BUDGET.refillPerSec)
  }
  return socket.data.__abuseBudget
}

/**
 * Controlla se `event` è permesso per questo socket in questo momento.
 * Da chiamare come prima riga di ogni handler "spammabile":
 *
 *   socket.on('code-change', (data) => {
 *     if (!checkRateLimit(socket, 'code-change')) return
 *     ...
 *   })
 *
 * Ritorna true se l'evento può procedere, false se va scartato.
 * Se il socket continua a sforare i limiti, viene disconnesso.
 */
export function checkRateLimit(socket: Socket, event: string): boolean {
  const cfg = RATE_LIMITS[event]
  if (!cfg) return true // nessun limite configurato per questo evento

  const buckets = getBuckets(socket)
  let bucket = buckets.get(event)
  if (!bucket) {
    bucket = new TokenBucket(cfg.capacity, cfg.refillPerSec)
    buckets.set(event, bucket)
  }

  if (bucket.tryRemove()) return true

  // Limite superato: notifica il client (non troppo spesso, per non
  // aggiungere altro traffico) e consuma budget anti-abuso.
  const violations = (socket.data.__violations ?? 0) + 1
  socket.data.__violations = violations
  if (violations === 1 || violations % 20 === 0) {
    socket.emit('rate-limited', { event })
  }

  const abuseBudget = getAbuseBudget(socket)
  if (!abuseBudget.tryRemove()) {
    log.warn(`[RATE-LIMIT] Socket disconnesso per abuso — id = ${socket.id} | evento = ${event} | violazioni = ${violations}`)
    socket.disconnect(true)
  }

  return false
}