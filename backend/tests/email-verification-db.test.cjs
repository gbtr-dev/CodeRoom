// DB layer for email verification: migration of existing accounts, one-time tokens,
// sending limits and cleanup. Uses a throw-away database in a temp directory.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { after, test } = require('node:test')
const Database = require('better-sqlite3')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const originalCwd = process.cwd()
const dir = mkdtempSync(path.join(tmpdir(), 'coderoom-email-verification-'))
process.chdir(dir)
process.env.LOG_LEVEL = 'error'

// A database created by the OLD version of the app (no email_verified_at column)
const legacy = new Database(path.join(dir, 'coderoom.db'))
legacy.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
`)
legacy.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)')
  .run('old-1', 'Old One', 'old1@example.com', 'x', 1700000000)
legacy.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?,?,?,?,?)')
  .run('old-2', 'Old Two', 'old2@example.com', 'x', 1710000000)
legacy.close()

const dbPath = require.resolve('../src/db')
let db = require('../src/db')

const now = () => Math.floor(Date.now() / 1000)
const newUser = (email, verified = null) => {
  const id = randomUUID()
  db.dbCreateUser(id, 'Test', email, 'hash', verified)
  return id
}

after(() => {
  process.chdir(originalCwd)
  // On Windows SQLite keeps its files open until the process exits, so deleting the temp folder
  // can fail with EPERM/EBUSY. That is only cleanup: ignore it (the OS clears the temp folder).
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

test('migration: existing accounts are marked verified, with their creation date', () => {
  const a = db.dbGetUserById('old-1')
  const b = db.dbGetUserById('old-2')
  assert.equal(a.email_verified_at, 1700000000)
  assert.equal(b.email_verified_at, 1710000000)
})

test('migration runs only once: a restart does not verify new accounts', () => {
  const id = newUser('fresh@example.com')
  assert.equal(db.dbGetUserById(id).email_verified_at, null)

  // simulate a server restart: load the module again on the same database file
  delete require.cache[dbPath]
  db = require('../src/db')

  assert.equal(db.dbGetUserById(id).email_verified_at, null)
  assert.equal(db.dbGetUserById('old-1').email_verified_at, 1700000000)
})

test('new accounts are unverified by default', () => {
  const id = newUser('unverified@example.com')
  assert.equal(db.dbGetUserByEmail('unverified@example.com').email_verified_at, null)
  assert.equal(db.dbGetUserById(id).email_verified_at, null)
})

test('signup token: verifies the account once, then it is invalid', () => {
  const id = newUser('signup@example.com')
  db.dbCreateEmailVerification('hash-signup-1', id, 'signup@example.com', 'signup', now() + 3600)

  const first = db.dbConsumeEmailVerification('hash-signup-1')
  assert.deepEqual(first, { status: 'ok', userId: id, email: 'signup@example.com', purpose: 'signup' })
  assert.ok(db.dbGetUserById(id).email_verified_at >= now() - 2)

  assert.equal(db.dbConsumeEmailVerification('hash-signup-1').status, 'invalid')
})

test('unknown token is invalid', () => {
  assert.equal(db.dbConsumeEmailVerification('does-not-exist').status, 'invalid')
})

test('expired token is rejected and leaves the account unverified', () => {
  const id = newUser('expired@example.com')
  db.dbCreateEmailVerification('hash-expired', id, 'expired@example.com', 'signup', now() - 10)
  assert.equal(db.dbConsumeEmailVerification('hash-expired').status, 'expired')
  assert.equal(db.dbGetUserById(id).email_verified_at, null)
})

test('signup token no longer matches if the account email is different', () => {
  const id = newUser('mismatch@example.com')
  db.dbCreateEmailVerification('hash-mismatch', id, 'someone-else@example.com', 'signup', now() + 3600)
  assert.equal(db.dbConsumeEmailVerification('hash-mismatch').status, 'invalid')
  assert.equal(db.dbGetUserById(id).email_verified_at, null)
})

test('consuming a token closes the other pending tokens of the same user', () => {
  const id = newUser('twice@example.com')
  db.dbCreateEmailVerification('hash-twice-a', id, 'twice@example.com', 'signup', now() + 3600)
  db.dbCreateEmailVerification('hash-twice-b', id, 'twice@example.com', 'signup', now() + 3600)
  assert.equal(db.dbConsumeEmailVerification('hash-twice-a').status, 'ok')
  assert.equal(db.dbConsumeEmailVerification('hash-twice-b').status, 'invalid')
})

test('email change: applied only after confirming, then the new address is verified', () => {
  const id = newUser('before@example.com', now())
  db.dbCreateEmailVerification('hash-change-1', id, 'after@example.com', 'change', now() + 3600)
  assert.equal(db.dbGetUserById(id).email, 'before@example.com')   // not applied yet

  const res = db.dbConsumeEmailVerification('hash-change-1')
  assert.equal(res.status, 'ok')
  assert.equal(res.purpose, 'change')
  assert.equal(db.dbGetUserById(id).email, 'after@example.com')
})

test('email change: a newer request supersedes the older one', () => {
  const id = newUser('s1@example.com', now())
  db.dbCreateEmailVerification('hash-sup-1', id, 's2@example.com', 'change', now() + 3600)
  db.dbCreateEmailVerification('hash-sup-2', id, 's3@example.com', 'change', now() + 3600)
  assert.equal(db.dbConsumeEmailVerification('hash-sup-1').status, 'invalid')
  assert.equal(db.dbConsumeEmailVerification('hash-sup-2').status, 'ok')
  assert.equal(db.dbGetUserById(id).email, 's3@example.com')
})

test('email change: conflict if the address was taken meanwhile, email unchanged', () => {
  const id = newUser('mine@example.com', now())
  newUser('taken@example.com', now())
  db.dbCreateEmailVerification('hash-conflict', id, 'taken@example.com', 'change', now() + 3600)
  assert.equal(db.dbConsumeEmailVerification('hash-conflict').status, 'conflict')
  assert.equal(db.dbGetUserById(id).email, 'mine@example.com')
})

test('sending stats: per-address count and last send, plus the global count', () => {
  const id = newUser('stats@example.com')
  const t = now()
  db.dbCreateEmailVerification('hash-stats-1', id, 'stats@example.com', 'signup', t + 3600, t - 7200)
  db.dbCreateEmailVerification('hash-stats-2', id, 'stats@example.com', 'signup', t + 3600, t - 30)
  db.dbCreateEmailVerification('hash-stats-3', id, 'stats@example.com', 'signup', t + 3600, t - 10)

  const lastHour = db.dbGetEmailVerificationStats('stats@example.com', t - 3600)
  assert.equal(lastHour.count, 2)
  assert.equal(lastHour.lastAt, t - 10)
  assert.equal(db.dbGetEmailVerificationStats('nobody@example.com', t - 3600).count, 0)
  assert.equal(db.dbGetEmailVerificationStats('nobody@example.com', t - 3600).lastAt, null)

  assert.ok(db.dbCountEmailVerificationsSince(t - 3600) >= 2)

  // used tokens still count towards the limits
  db.dbConsumeEmailVerification('hash-stats-3')
  assert.equal(db.dbGetEmailVerificationStats('stats@example.com', t - 3600).count, 2)
})

test('signup snapshots preserve earlier links and sending limits; first confirmation wins', () => {
  const email = 'snapshots@example.com'
  const id = newUser(email)
  db.dbCreateEmailVerification('snapshot-a', id, email, 'signup', now() + 3600)
  db.dbCreateEmailVerification('snapshot-b', id, email, 'signup', now() + 3600, now(), undefined, { name: 'New', passwordHash: 'new-hash' })
  assert.equal(db.dbGetUserByEmail(email).password_hash, 'hash')
  assert.equal(db.dbGetEmailVerificationStats(email, now() - 3600).count, 2)
  assert.equal(db.dbConsumeEmailVerification('snapshot-a').status, 'ok')
  assert.equal(db.dbConsumeEmailVerification('snapshot-b').status, 'invalid')
  assert.equal(db.dbGetUserByEmail(email).password_hash, 'hash')
  assert.equal(db.dbCreateEmailVerification('snapshot-late', id, email, 'signup', now() + 3600), false)
})

test('confirming a newer snapshot applies it atomically', () => {
  const email = 'snapshot-rollback@example.com'
  const id = newUser(email)
  db.dbCreateEmailVerification('snapshot-new', id, email, 'signup', now() + 3600, now(), undefined, { name: 'Owner', passwordHash: 'owner-hash' })
  db.default.exec(`CREATE TEMP TRIGGER fail_verification_invalidation
    BEFORE UPDATE OF used_at ON email_verifications
    BEGIN SELECT RAISE(ABORT, 'invalidation failed'); END`)
  try {
    assert.throws(() => db.dbConsumeEmailVerification('snapshot-new'), /invalidation failed/)
    assert.equal(db.dbGetUserByEmail(email).password_hash, 'hash')
    assert.equal(db.dbGetUserById(id).email_verified_at, null)
  } finally {
    db.default.exec('DROP TRIGGER fail_verification_invalidation')
  }
  assert.equal(db.dbConsumeEmailVerification('snapshot-new').status, 'ok')
  assert.equal(db.dbGetUserByEmail(email).password_hash, 'owner-hash')
  assert.equal(db.dbGetUserById(id).name, 'Owner')
})

test('password update rolls back when pending email change revocation fails', () => {
  const id = newUser('password-rollback@example.com', now())
  db.dbCreateEmailVerification('password-rollback-link', id, 'password-target@example.com', 'change', now() + 3600)
  db.default.exec(`CREATE TEMP TRIGGER fail_password_revocation
    BEFORE UPDATE OF used_at ON email_verifications
    BEGIN SELECT RAISE(ABORT, 'revocation failed'); END`)
  try {
    assert.throws(() => db.dbUpdateUserPassword(id, 'new-hash'), /revocation failed/)
    assert.equal(db.dbGetUserByEmail('password-rollback@example.com').password_hash, 'hash')
  } finally {
    db.default.exec('DROP TRIGGER fail_password_revocation')
  }
  assert.equal(db.dbConsumeEmailVerification('password-rollback-link').status, 'ok')
})

test('cleanup: stale unverified accounts are deleted, verified and recent ones are kept', () => {
  const raw = new Database(path.join(dir, 'coderoom.db'))
  const old = now() - 3 * 24 * 3600
  const stale = newUser('stale@example.com')
  const staleVerified = newUser('stale-verified@example.com', now() - 100)
  const recent = newUser('recent@example.com')
  raw.prepare('UPDATE users SET created_at = ? WHERE id IN (?, ?)').run(old, stale, staleVerified)
  db.dbCreateEmailVerification('hash-stale', stale, 'stale@example.com', 'signup', old + 3600, old)

  const deleted = db.dbDeleteStaleUnverifiedUsers(now() - 2 * 24 * 3600)
  assert.ok(deleted >= 1)
  assert.equal(db.dbGetUserById(stale), undefined)
  assert.ok(db.dbGetUserById(staleVerified))
  assert.ok(db.dbGetUserById(recent))
  // the token of the deleted account is gone too (cascade)
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM email_verifications WHERE token_hash = ?').get('hash-stale').n, 0)
  raw.close()
})

test('cleanup: old verification rows are purged by creation date', () => {
  const id = newUser('purge@example.com')
  const t = now()
  db.dbCreateEmailVerification('hash-purge-old', id, 'purge@example.com', 'signup', t + 3600, t - 3 * 24 * 3600)
  db.dbCreateEmailVerification('hash-purge-new', id, 'purge@example.com', 'signup', t + 3600, t)
  assert.ok(db.dbDeleteOldEmailVerifications(t - 2 * 24 * 3600) >= 1)
  assert.equal(db.dbConsumeEmailVerification('hash-purge-old').status, 'invalid')
  assert.equal(db.dbConsumeEmailVerification('hash-purge-new').status, 'ok')
})

test('a newly issued signup link refreshes the pending account lifetime', () => {
  const id = newUser('refresh@example.com')
  db.default.prepare('UPDATE users SET created_at = ? WHERE id = ?').run(now() - 3 * 86400, id)
  db.dbCreateEmailVerification('refresh-link', id, 'refresh@example.com', 'signup', now() + 86400)
  db.dbDeleteStaleUnverifiedUsers(now() - 2 * 86400)
  assert.equal(db.dbConsumeEmailVerification('refresh-link').status, 'ok')
})

test('migration preserves existing signup links and snapshots across restarts', () => {
  const migrationDir = mkdtempSync(path.join(tmpdir(), 'coderoom-snapshot-migration-'))
  const legacyDb = new Database(path.join(migrationDir, 'coderoom.db'))
  legacyDb.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), email_verified_at INTEGER);
    INSERT INTO users (id, name, email, password_hash) VALUES ('pending', 'Original', 'migration@example.com', 'original-hash');
    CREATE TABLE email_verifications (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      email TEXT NOT NULL, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()));
    INSERT INTO email_verifications (token_hash, user_id, email, purpose, expires_at)
      VALUES ('old-link', 'pending', 'migration@example.com', 'signup', unixepoch() + 3600);
  `)
  legacyDb.close()
  const script = `
    require('ts-node/register/transpile-only');
    const assert = require('node:assert/strict');
    process.chdir(process.argv[1]);
    const modulePath = process.argv[2];
    let db = require(modulePath);
    db.dbCreateEmailVerification('new-link', 'pending', 'migration@example.com', 'signup', Math.floor(Date.now()/1000)+3600,
      undefined, undefined, {name:'Later', passwordHash:'later-hash'});
    delete require.cache[require.resolve(modulePath)];
    db = require(modulePath);
    assert.equal(db.dbConsumeEmailVerification('old-link').status, 'ok');
    assert.equal(db.dbGetUserByEmail('migration@example.com').password_hash, 'original-hash');
    assert.equal(db.dbConsumeEmailVerification('new-link').status, 'invalid');
  `
  const result = require('node:child_process').spawnSync(process.execPath, ['-e', script, migrationDir, dbPath], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: process.env,
  })
  assert.equal(result.status, 0, result.stderr)
  rmSync(migrationDir, { recursive: true, force: true })
})
