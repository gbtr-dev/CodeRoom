import type { Socket } from 'socket.io'
import { createLogger } from './logger'

const log = createLogger('SOCKET')

/**
 * Registra un handler per un evento Socket.IO racchiudendolo in un try/catch.
 *
 * Senza questo, qualunque eccezione sincrona lanciata dentro un handler — per
 * esempio una destrutturazione che fallisce perché il payload è `undefined`,
 * oppure un campo del tipo sbagliato che fa esplodere una chiamata come
 * `name.trim()` quando `name` non è una stringa — si propaga fuori da
 * `emit()` e fa crashare l'INTERO processo Node, perché in questo progetto
 * non c'è un handler globale per le eccezioni non gestite. Risultato: tutte
 * le stanze e tutti gli utenti collegati vengono buttati giù da un singolo
 * messaggio malformato mandato da un client qualsiasi.
 *
 * La validazione dei singoli campi (vedi validation.ts) resta la prima
 * linea di difesa, ma questo wrapper è la rete di sicurezza: anche se un
 * controllo viene scordato o un caso limite non previsto, il resto del
 * server resta in piedi e l'errore viene solo loggato.
 */
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