import type { ServerOptions } from 'socket.io'

export function socketOptions(allowedOrigin: string): Partial<ServerOptions> {
  const configured = new URL(allowedOrigin)
  if (!['http:', 'https:'].includes(configured.protocol) || configured.origin !== allowedOrigin) {
    throw new Error('CORS_ORIGIN must be an exact HTTP(S) origin without a path')
  }
  return {
    cors: { origin: allowedOrigin, methods: ['GET', 'POST'], credentials: true },
    allowRequest: (req, done) => {
      const origin = req.headers.origin
      if (origin !== undefined) {
        done(null, typeof origin === 'string' && origin === allowedOrigin)
        return
      }

      // Same-origin browser GETs may omit Origin during the initial polling handshake.
      // Only that transport can fall back to a validated Referer; WebSocket requires Origin.
      let allowed = false
      try {
        const transport = new URL(req.url ?? '', 'http://localhost').searchParams.get('transport')
        const referer = req.headers.referer
        allowed = transport === 'polling' && typeof referer === 'string' &&
          new URL(referer).origin === allowedOrigin
      } catch { /* Invalid or missing provenance is rejected. */ }
      done(null, allowed)
    },
    perMessageDeflate: { threshold: 1024 },
  }
}
