"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.maskEmail = maskEmail;
exports.createLogger = createLogger;
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const configured = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';
const minLevel = LEVELS[configured] ?? LEVELS.info;
function timestamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
function kv(fields) {
    if (!fields || Object.keys(fields).length === 0)
        return '';
    return ('  ' +
        Object.entries(fields)
            .map(([k, v]) => `${k}=${v ?? '—'}`)
            .join('  '));
}
function write(level, module, message, fields) {
    if (LEVELS[level] < minLevel)
        return;
    const line = `[${timestamp()}] [${level.toUpperCase().padEnd(5)}] [${module}] ${message}${kv(fields)}`;
    if (level === 'error' || level === 'warn') {
        process.stderr.write(line + '\n');
    }
    else {
        process.stdout.write(line + '\n');
    }
}
function maskEmail(email) {
    if (!email)
        return '—';
    const at = email.indexOf('@');
    if (at <= 0)
        return '***';
    return `${email[0]}***@${email.slice(at + 1)}`;
}
function createLogger(module) {
    return {
        debug: (msg, fields) => write('debug', module, msg, fields),
        info: (msg, fields) => write('info', module, msg, fields),
        warn: (msg, fields) => write('warn', module, msg, fields),
        error: (msg, fields) => write('error', module, msg, fields),
    };
}
