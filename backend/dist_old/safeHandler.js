"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeOn = safeOn;
const logger_1 = require("./logger");
const log = (0, logger_1.createLogger)('SOCKET');
function safeOn(socket, event, handler) {
    socket.on(event, (...args) => {
        try {
            const result = handler(...args);
            if (result instanceof Promise) {
                result.catch((err) => {
                    log.error(`Eccezione non gestita (async) in "${event}"`, { socketId: socket.id, error: String(err) });
                    socket.emit('server-error', { event });
                }).catch(() => { });
            }
        }
        catch (err) {
            log.error(`Eccezione non gestita in "${event}"`, { socketId: socket.id, error: String(err) });
            socket.emit('server-error', { event });
        }
    });
}
