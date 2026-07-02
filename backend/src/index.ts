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
import { initContainerPool } from './executor'


const log = createLogger('SERVER')
const app = Fastify({ logger: false })

const NODE_ENV = process.env.NODE_ENV ?? 'development'

if (NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
  console.error('[SERVER] CORS_ORIGIN non impostata in produzione — avvio bloccato')
  process.exit(1)
}

const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000'

app.register(cors, {
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
})


app.register(cookie)


app.addHook('preHandler', csrfOriginCheck(CORS_ORIGIN))

app.register(rateLimit, {
  global: false,
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

  log.info('Flush contenuti su DB…')
  flushAllRoomContent()
  log.info('Flush completato, uscita.')

  clearTimeout(timer)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))


app.listen({ port: 45032, host: '0.0.0.0' }, (err) => {
  if (err) { log.error('Errore avvio server', { error: String(err) }); process.exit(1) }

  const io = new Server(app.server, {
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