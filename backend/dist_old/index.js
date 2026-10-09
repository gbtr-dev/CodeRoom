"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const socket_io_1 = require("socket.io");
const socket_1 = require("./socket");
const auth_1 = require("./auth");
const csrf_1 = require("./csrf");
const rooms_1 = require("./rooms");
const db_1 = require("./db");
const logger_1 = require("./logger");
const executor_1 = require("./executor");
const log = (0, logger_1.createLogger)('SERVER');
const app = (0, fastify_1.default)({ logger: false, trustProxy: 1 });
const NODE_ENV = process.env.NODE_ENV ?? 'development';
if (NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    console.error('[SERVER] CORS_ORIGIN non impostata in produzione — avvio bloccato');
    process.exit(1);
}
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:45031';
app.register(cors_1.default, {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
});
app.register(cookie_1.default);
// Sicurezza HTTP: X-Frame-Options, X-Content-Type-Options, HSTS, ecc.
// CSP disabilitato perché questo server espone solo API JSON, non pagine HTML.
app.register(helmet_1.default, { contentSecurityPolicy: false });
app.addHook('preHandler', (0, csrf_1.csrfOriginCheck)(CORS_ORIGIN));
app.register(rate_limit_1.default, {
    global: true,
    max: 1000,
    timeWindow: '1 minute',
});
const SESSION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 ore
(0, db_1.dbDeleteExpiredSessions)();
(0, db_1.dbDeleteExpiredLoginAttempts)();
(0, db_1.dbDeleteExpiredInvites)();
setInterval(() => {
    const deleted = (0, db_1.dbDeleteExpiredSessions)();
    if (deleted > 0) {
        log.info('Pulizia periodica sessioni scadute', { deleted });
    }
}, SESSION_CLEANUP_INTERVAL_MS).unref();
setInterval(() => {
    const deleted = (0, db_1.dbDeleteExpiredInvites)();
    if (deleted > 0) {
        log.info('Pulizia periodica inviti scaduti', { deleted });
    }
}, SESSION_CLEANUP_INTERVAL_MS).unref();
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
        done(null, JSON.parse(body));
    }
    catch (e) {
        done(e, undefined);
    }
});
app.register(async (instance) => {
    await (0, auth_1.registerAuthRoutes)(instance);
});
app.get('/health', async () => ({ status: 'ok' }));
let isShuttingDown = false;
async function shutdown(signal) {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    // Safety net: force-exit after 5 s if something hangs
    const timer = setTimeout(() => {
        log.error('Shutdown timeout — uscita forzata');
        process.exit(1);
    }, 5000).unref();
    log.info(`Ricevuto ${signal}, chiusura server…`);
    try {
        // Stop accepting new connections and wait for in-flight requests to finish
        await app.close();
    }
    catch (err) {
        log.error('Errore durante la chiusura del server', { error: String(err) });
    }
    log.info('Flush contenuti su DB…');
    (0, rooms_1.flushAllRoomContent)();
    await (0, executor_1.shutdownPool)();
    log.info('Flush completato, uscita.');
    clearTimeout(timer);
    process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
app.listen({ port: 45032, host: '0.0.0.0' }, (err) => {
    if (err) {
        log.error('Errore avvio server', { error: String(err) });
        process.exit(1);
    }
    const io = new socket_io_1.Server(app.server, {
        cors: {
            origin: CORS_ORIGIN,
            methods: ['GET', 'POST'],
            credentials: true,
        },
        perMessageDeflate: { threshold: 1024 },
    });
    (0, socket_1.registerSocketHandlers)(io);
    log.info('Backend avviato', { url: 'http://localhost:45032' });
    (0, executor_1.initContainerPool)().catch((err) => log.error('Errore init container pool', { error: String(err) }));
});
