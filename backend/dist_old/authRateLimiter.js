"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkLoginLock = checkLoginLock;
exports.recordLoginFailure = recordLoginFailure;
exports.recordLoginSuccess = recordLoginSuccess;
const logger_1 = require("./logger");
const db_1 = require("./db");
const log = (0, logger_1.createLogger)('AUTH-RATE-LIMIT');
const MAX_ATTEMPTS = 5;
const WINDOW_S = 5 * 60; // 5 minuti
const LOCK_S = 10 * 60; // 10 minuti
setInterval(() => {
    (0, db_1.dbDeleteExpiredLoginAttempts)();
}, 10 * 60 * 1000).unref();
function normalizeKey(email) {
    return email.toLowerCase().trim();
}
function checkLoginLock(email) {
    const key = normalizeKey(email);
    const row = (0, db_1.dbGetLoginAttempt)(key);
    if (!row || row.locked_until === null)
        return null;
    const now = Math.floor(Date.now() / 1000);
    if (row.locked_until > now) {
        return row.locked_until - now;
    }
    (0, db_1.dbDeleteLoginAttempt)(key);
    return null;
}
function recordLoginFailure(email) {
    const key = normalizeKey(email);
    const now = Math.floor(Date.now() / 1000);
    const row = (0, db_1.dbGetLoginAttempt)(key);
    if (!row || now - row.first_attempt_at > WINDOW_S) {
        (0, db_1.dbUpsertLoginAttempt)(key, 1, now, null);
        return;
    }
    const count = row.count + 1;
    const lockedUntil = count >= MAX_ATTEMPTS ? now + LOCK_S : null;
    if (lockedUntil) {
        log.warn('Email bloccata temporaneamente per troppi fallimenti di login', {
            attempts: count,
            lockMinutes: LOCK_S / 60,
        });
    }
    (0, db_1.dbUpsertLoginAttempt)(key, count, row.first_attempt_at, lockedUntil);
}
function recordLoginSuccess(email) {
    (0, db_1.dbDeleteLoginAttempt)(normalizeKey(email));
}
