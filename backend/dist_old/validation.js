"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LIMITS = void 0;
exports.isString = isString;
exports.isFiniteNumber = isFiniteNumber;
exports.isNonEmptyString = isNonEmptyString;
exports.isBoundedString = isBoundedString;
exports.isValidId = isValidId;
exports.isNonNegativeInt = isNonNegativeInt;
exports.isFileKind = isFileKind;
exports.isValidEmail = isValidEmail;
exports.isValidFileName = isValidFileName;
exports.LIMITS = {
    ID: 128, // roomId, fileId, parentId, userId, knockId, tempId
    FILE_NAME: 255,
    ROOM_NAME: 60,
    USER_NAME: 60,
    EMAIL: 254, // limite RFC 5321 per un indirizzo email
    FILE_CONTENT: 2000000, // ~2MB per file: ampio per del codice, blocca payload abnormi
    PATCH_INSERT: 2000000, // testo inserito da un singolo code-patch
    RUN_CODE: 200000, // 200KB di codice da eseguire è già molto generoso
    IMPORT_ENTRIES: 500, // max file+cartelle per singola import-zip
    IMPORT_TOTAL_CONTENT: 10000000, // 10MB totali di contenuto in un solo import
    CURSOR_POS: 1000000, // riga/colonna: limite di sanità, non un vincolo "reale"
};
function isString(v) {
    return typeof v === 'string';
}
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}
function isNonEmptyString(v, maxLen) {
    return isString(v) && v.length > 0 && v.length <= maxLen;
}
function isBoundedString(v, maxLen) {
    return isString(v) && v.length <= maxLen;
}
function isValidId(v) {
    return isNonEmptyString(v, exports.LIMITS.ID);
}
function isNonNegativeInt(v, max) {
    return isFiniteNumber(v) && Number.isInteger(v) && v >= 0 && v <= max;
}
function isFileKind(v) {
    return v === 'file' || v === 'folder';
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function isValidEmail(v) {
    return isNonEmptyString(v, exports.LIMITS.EMAIL) && EMAIL_RE.test(v);
}
// Rejects path traversal chars, null bytes, and control characters in file names
const INVALID_FILENAME_RE = /[/\\<>:"|?*\x00-\x1f]/;
function isValidFileName(v) {
    if (!isNonEmptyString(v, exports.LIMITS.FILE_NAME))
        return false;
    const trimmed = v.trim();
    if (!trimmed || trimmed === '.' || trimmed === '..')
        return false;
    return !INVALID_FILENAME_RE.test(trimmed);
}
