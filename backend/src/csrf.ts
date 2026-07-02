import type { FastifyRequest, FastifyReply } from 'fastify'
import { createLogger } from './logger'

const log = createLogger('CSRF')

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function extractOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export function csrfOriginCheck(allowedOrigin: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) return

    const originHeader = req.headers.origin
    const refererHeader = req.headers.referer

    if (typeof originHeader === 'string') {
      if (originHeader !== allowedOrigin) {
        log.warn('Richiesta mutante bloccata — Origin non corrispondente', {
          method: req.method,
          path: req.url,
          origin: originHeader,
        })
        return reply.status(403).send({ error: 'Cross-origin request blocked' })
      }
      return
    }

    if (typeof refererHeader === 'string') {
      const refererOrigin = extractOrigin(refererHeader)
      if (refererOrigin !== null && refererOrigin !== allowedOrigin) {
        log.warn('Richiesta mutante bloccata — Referer non corrispondente', {
          method: req.method,
          path: req.url,
          referer: refererHeader,
        })
        return reply.status(403).send({ error: 'Cross-origin request blocked' })
      }
      return
    }

    // Nessun Origin né Referer: richiesta mutante senza intestazioni di provenienza — blocca
    log.warn('Richiesta mutante bloccata — Origin e Referer assenti', {
      method: req.method,
      path: req.url,
    })
    return reply.status(403).send({ error: 'Cross-origin request blocked' })
  }
}