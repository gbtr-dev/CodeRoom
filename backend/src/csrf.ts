import type { FastifyRequest, FastifyReply } from 'fastify'
import { createLogger } from './logger'

const log = createLogger('CSRF')

/**
 * Difesa in profondità contro CSRF, oltre a SameSite=lax sul cookie di
 * sessione (vedi auth.ts).
 *
 * SameSite=lax blocca già la maggior parte degli attacchi CSRF classici
 * (form/img/fetch cross-site con metodi mutanti lanciati da una pagina
 * di terzi), ma non è una garanzia assoluta in ogni configurazione di
 * browser/proxy, e non protegge eventuali future rotte GET con side-effect.
 * Per questo verifichiamo esplicitamente che le richieste mutanti
 * dichiarino di provenire dalla nostra origin.
 *
 * Verifichiamo solo i metodi che modificano stato: GET/HEAD/OPTIONS non
 * vengono toccati, sia perché sono (o dovrebbero essere) idempotenti, sia
 * perché molti client (link diretti, prefetch, estensioni) non mandano
 * Origin su una GET e bloccarle romperebbe casi legittimi senza motivo.
 */

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function extractOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

/**
 * Da registrare come preHandler globale su Fastify. allowedOrigin è la
 * singola origin del frontend (stessa usata per CORS, vedi CORS_ORIGIN
 * in index.ts).
 */
export function csrfOriginCheck(allowedOrigin: string) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(req.method.toUpperCase())) return

    const originHeader = req.headers.origin
    const refererHeader = req.headers.referer

    // Caso normale: i browser mandano sempre Origin su richieste mutanti
    // cross-origin-capable (fetch/XHR/form). Se c'è, deve combaciare.
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

    // Origin assente: capita con alcuni client legittimi più vecchi o
    // configurazioni di proxy. Come fallback meno preciso ma comunque
    // utile, controlliamo Referer prima di rinunciare al controllo.
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

    // Né Origin né Referer: non blocchiamo — SameSite=lax sul cookie resta
    // la difesa primaria, e qui non abbiamo nulla su cui basare un rifiuto
    // senza rischiare falsi positivi su client legittimi.
  }
}