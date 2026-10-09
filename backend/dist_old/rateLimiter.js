"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkRateLimit = checkRateLimit;
const logger_1 = require("./logger");
const log = (0, logger_1.createLogger)('RATE-LIMIT');
class TokenBucket {
    constructor(capacity, refillPerSec) {
        this.capacity = capacity;
        this.refillPerSec = refillPerSec;
        this.tokens = capacity;
        this.last = Date.now();
    }
    tryRemove(cost = 1) {
        const now = Date.now();
        const elapsedSec = (now - this.last) / 1000;
        this.last = now;
        this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSec);
        if (this.tokens < cost)
            return false;
        this.tokens -= cost;
        return true;
    }
}
const RATE_LIMITS = {
    'code-change': { capacity: 25, refillPerSec: 15 },
    'code-patch': { capacity: 25, refillPerSec: 15 },
    'cursor-move': { capacity: 20, refillPerSec: 15 },
    'create-file': { capacity: 10, refillPerSec: 2 },
    'import-zip': { capacity: 2, refillPerSec: 0.1 },
    'delete-file': { capacity: 10, refillPerSec: 2 },
    'rename-file': { capacity: 10, refillPerSec: 2 },
    'move-file': { capacity: 10, refillPerSec: 2 },
    'rename-room': { capacity: 5, refillPerSec: 0.5 },
    'run-code': { capacity: 3, refillPerSec: 0.2 },
    'set-member-role': { capacity: 10, refillPerSec: 1 },
    'kick-member': { capacity: 10, refillPerSec: 1 },
    'join-room': { capacity: 5, refillPerSec: 0.5 },
    'approve-knock': { capacity: 20, refillPerSec: 2 },
    'deny-knock': { capacity: 20, refillPerSec: 2 },
    'chat-send': { capacity: 10, refillPerSec: 1 },
    'format-code': { capacity: 3, refillPerSec: 0.2 },
};
const ABUSE_BUDGET = { capacity: 60, refillPerSec: 1 };
function getBuckets(socket) {
    if (!socket.data.__rateBuckets) {
        socket.data.__rateBuckets = new Map();
    }
    return socket.data.__rateBuckets;
}
function getAbuseBudget(socket) {
    if (!socket.data.__abuseBudget) {
        socket.data.__abuseBudget = new TokenBucket(ABUSE_BUDGET.capacity, ABUSE_BUDGET.refillPerSec);
    }
    return socket.data.__abuseBudget;
}
function checkRateLimit(socket, event) {
    const cfg = RATE_LIMITS[event];
    if (!cfg)
        return true; // nessun limite configurato per questo evento
    const buckets = getBuckets(socket);
    let bucket = buckets.get(event);
    if (!bucket) {
        bucket = new TokenBucket(cfg.capacity, cfg.refillPerSec);
        buckets.set(event, bucket);
    }
    if (bucket.tryRemove())
        return true;
    const violations = (socket.data.__violations ?? 0) + 1;
    socket.data.__violations = violations;
    if (violations === 1 || violations % 20 === 0) {
        socket.emit('rate-limited', { event });
    }
    const abuseBudget = getAbuseBudget(socket);
    if (!abuseBudget.tryRemove()) {
        log.warn(`[RATE-LIMIT] Socket disconnesso per abuso — id = ${socket.id} | evento = ${event} | violazioni = ${violations}`);
        socket.disconnect(true);
    }
    return false;
}
