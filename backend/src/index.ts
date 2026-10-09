import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { Server } from 'socket.io'
import { registerSocketHandlers } from './socket'
import { registerAuthRoutes } from './auth'
import { csrfOriginCheck } from './csrf'
import { flushAllRoomContent } from './rooms'
import { dbDeleteExpiredSessions, dbDeleteExpiredLoginAttempts, dbDeleteExpiredInvites } from './db'
import { createLogger } from './logger'
import { initContainerPool, shutdownPool } from './executor'


const log = createLogger('SERVER')
const app = Fastify({ logger: false, trustProxy: 1 })

const NODE_ENV = process.env.NODE_ENV ?? 'development'

if (NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.error('[SERVER] CORS_ORIGIN non impostata in produzione — avvio bloccato')
  process.exit(1)
}

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:45031'

app.register(cors, {
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})


app.register(cookie)

// Sicurezza HTTP: X-Frame-Options, X-Content-Type-Options, HSTS, ecc.
// CSP disabilitato perché questo server espone solo API JSON, non pagine HTML.
app.register(helmet, { contentSecurityPolicy: false })

app.addHook('preHandler', csrfOriginCheck(CORS_ORIGIN))

app.register(rateLimit, {
  global: true,
  max: 1000,
  timeWindow: '1 minute',
})


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

setInterval(() => {
  const deleted = dbDeleteExpiredInvites()
  if (deleted > 0) {
    log.info('Pulizia periodica inviti scaduti', { deleted })
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

let io: Server | undefined
let isShuttingDown = false

async function shutdown(signal: string) {
  if (isShuttingDown) return
  isShuttingDown = true

  log.info(`Ricevuto ${signal}, chiusura server…`)

  // 1. Salva SUBITO il contenuto in RAM: da qui in poi, anche se qualcosa si blocca,
  //    i dati sono già sul DB.
  try {
    flushAllRoomContent()
    log.info('Flush contenuti su DB completato')
  } catch (err) {
    log.error('Errore durante il flush iniziale', { error: String(err) })
  }

  // Safety net: se la chiusura si blocca, fai un ultimo flush ed esci.
  const timer = setTimeout(() => {
    log.error('Shutdown timeout — uscita forzata')
    try { flushAllRoomContent() } catch { /* ignora */ }
    process.exit(1)
  }, 8_000).unref()

  try {
    // 2. Chiude Socket.IO: disconnette i WebSocket (che altrimenti tengono vivo
    //    l'http server per sempre) e smette di accettare nuove connessioni.
    //    Gli handler di 'disconnect' fanno a loro volta flush delle stanze.
    if (io) await io.close()
  } catch (err) {
    log.error('Errore durante la chiusura di Socket.IO', { error: String(err) })
  }

  try {
    // 3. Chiude Fastify (richieste HTTP in corso, hook onClose, ecc.)
    await app.close()
  } catch (err) {
    log.error('Errore durante la chiusura del server', { error: String(err) })
  }

  // 4. Ultimo flush: cattura eventuali modifiche arrivate durante la chiusura.
  try {
    flushAllRoomContent()
    await shutdownPool()
  } catch (err) {
    log.error('Errore nel flush finale', { error: String(err) })
  }

  log.info('Chiusura completata, uscita.')
  clearTimeout(timer)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))


app.listen({ port: 45032, host: '0.0.0.0' }, (err) => {
  if (err) { log.error('Errore avvio server', { error: String(err) }); process.exit(1) }

  io = new Server(app.server, {
    cors: {
      origin: CORS_ORIGIN,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    perMessageDeflate: { threshold: 1024 },
  })

  registerSocketHandlers(io)
  log.info('Backend avviato', { url: 'http://localhost:45032' })
  initContainerPool().catch((err) => log.error('Errore init container pool', { error: String(err) }))
})