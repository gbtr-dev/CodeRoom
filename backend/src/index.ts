import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { Server } from 'socket.io'
import { registerSocketHandlers } from './socket'
import { registerAuthRoutes } from './auth'
import { csrfOriginCheck } from './csrf'
import { flushAllRoomContent } from './rooms'
import { dbDeleteExpiredSessions, dbDeleteExpiredLoginAttempts, dbDeleteExpiredInvites } from './db'
import { createLogger } from './logger'


const log = createLogger('SERVER')
const app = Fastify({ logger: false })

const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000'

app.register(cors, {
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})

// Necessario per leggere/scrivere il cookie httpOnly di sessione
// (req.cookies, reply.setCookie, reply.clearCookie) usato da auth.ts.
app.register(cookie)

// Difesa in profondità contro CSRF, oltre a SameSite=lax sul cookie di
// sessione: rifiuta le richieste mutanti (POST/PUT/PATCH/DELETE) la cui
// Origin (o, in fallback, Referer) non corrisponde al frontend configurato.
// Vedi csrf.ts per i dettagli del perché GET/HEAD/OPTIONS non sono toccate
// e perché l'assenza di entrambi gli header non blocca la richiesta.
app.addHook('preHandler', csrfOriginCheck(CORS_ORIGIN))

// Rate limiting globale: il default è volutamente permissivo (non vogliamo
// throttlare le rotte autenticate, già protette da sessione). Le rotte
// sensibili a brute force (/auth/login, /auth/signup) impostano un limite
// più stretto via `config.rateLimit` direttamente sulla route — vedi auth.ts.
app.register(rateLimit, {
  global: false,
  max: 1000,
  timeWindow: '1 minute',
})

// Pulizia delle sessioni scadute: una passata subito all'avvio (utile se il
// server resta fermo a lungo tra un riavvio e l'altro) più una periodica ogni
// 6 ore per i processi long-running, altrimenti la tabella `sessions`
// crescerebbe senza limiti man mano che i token scadono senza mai essere
// rimossi. `.unref()` evita che questo timer da solo mantenga il processo
// vivo e blocchi lo shutdown pulito gestito da SIGINT/SIGTERM più sotto.
const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 ore

dbDeleteExpiredSessions()
dbDeleteExpiredLoginAttempts()
dbDeleteExpiredInvites()

setInterval(() => {
  const deleted = dbDeleteExpiredSessions()
  if (deleted > 0) {
    log.info('Pulizia periodica sessioni scadute', { deleted })
  }
}, SESSION_CLEANUP_INTERVAL_MS).unref()

app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try { done(null, JSON.parse(body as string)) }
  catch (e) { done(e as Error, undefined) }
})

app.register(async (instance) => {
  await registerAuthRoutes(instance)
})

app.get('/health', async () => ({ status: 'ok' }))

let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true

  // Safety net: force-exit after 5 s if something hangs
  const timer = setTimeout(() => {
    log.error('Shutdown timeout — uscita forzata')
    process.exit(1)
  }, 5_000).unref()

  log.info(`Ricevuto ${signal}, chiusura server…`)
  try {
    // Stop accepting new connections and wait for in-flight requests to finish
    await app.close()
  } catch (err) {
    log.error('Errore durante la chiusura del server', { error: String(err) })
  }

  // better-sqlite3 is synchronous: flushAllRoomContent() writes every dirty
  // file to SQLite before returning, so no further awaiting is needed.
  log.info('Flush contenuti su DB…')
  flushAllRoomContent()
  log.info('Flush completato, uscita.')

  clearTimeout(timer)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))


app.listen({ port: 3001, host: '127.0.0.1' }, (err) => {
  if (err) { log.error('Errore avvio server', { error: String(err) }); process.exit(1) }

  const io = new Server(app.server, {
    cors: {
      origin: CORS_ORIGIN,
      methods: ['GET', 'POST'],

      credentials: true,
    },
  })

  registerSocketHandlers(io)
  log.info('Backend avviato', { url: 'http://localhost:3001' })
})