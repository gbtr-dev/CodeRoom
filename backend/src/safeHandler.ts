import type { Socket } from 'socket.io'
import { createLogger } from './logger'

const log = createLogger('SOCKET')

export function safeOn(
  socket: Socket,
  event: string,
  handler: (...args: any[]) => unknown,
) {
  socket.on(event, (...args: any[]) => {
    try {
      const result = handler(...args)
      if (result instanceof Promise) {
        result.catch((err) => {
          log.error(`Eccezione non gestita (async) in "${event}"`, { socketId: socket.id, error: String(err) })
        }).catch(() => {})
      }
    } catch (err) {
      log.error(`Eccezione non gestita in "${event}"`, { socketId: socket.id, error: String(err) })
    }
  })
}