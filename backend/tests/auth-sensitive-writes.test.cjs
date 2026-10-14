const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { before, after, test } = require('node:test')
const bcrypt = require('bcryptjs')
const Fastify = require('fastify')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const originalCwd = process.cwd()
const dir = mkdtempSync(path.join(tmpdir(), 'coderoom-sensitive-writes-'))
process.chdir(dir)
process.env.LOG_LEVEL = 'error'
process.env.NODE_ENV = 'development'
const db = require('../src/db')
const { registerAuthRoutes, createSession, SESSION_COOKIE_NAME } = require('../src/auth')
const app = Fastify()

before(async () => {
  await app.register(require('@fastify/cookie'))
  await registerAuthRoutes(app)
  await app.ready()
})
after(async () => {
  await app.close()
  db.default.close()
  process.chdir(originalCwd)
  rmSync(dir, { recursive: true, force: true })
})

function fixture() {
  const id = randomUUID(), email = `${id}@example.com`, room = randomUUID()
  const hash = bcrypt.hashSync('old-password', 4)
  db.dbCreateUser(id, 'Owner', email, hash, Math.floor(Date.now() / 1000))
  db.dbCreateRoomWithOwner(room, id)
  return { id, email, hash, room, token: createSession(id).token, otherToken: createSession(id).token }
}
function request(token, method, url, payload) {
  return app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } })
}
function change(token, newPassword) {
  return request(token, 'PUT', '/auth/me/password', { currentPassword: 'old-password', newPassword })
}

// Pause after the original password was verified; for password updates, pause
// while computing the new hash to cover the final await before the write too.
function pauseSensitiveWrite(t, operation) {
  let release, entered, first = true
  const gate = new Promise(resolve => { release = resolve })
  const waiting = new Promise(resolve => { entered = resolve })
  const method = operation === 'password' ? 'hash' : 'compare'
  const original = bcrypt[method]
  t.mock.method(bcrypt, method, async (...args) => {
    const result = await original(...args)
    if (first) {
      first = false
      entered()
      await gate
    }
    return result
  })
  t.after(release)
  return { waiting, release }
}

for (const operation of ['password', 'delete']) {
  for (const invalidation of ['other session changes password', 'same session changes password', 'logout', 'expiry']) {
    test(`${operation}: rejects a pending write after ${invalidation}`, { timeout: 5000 }, async t => {
      const f = fixture()
      const paused = pauseSensitiveWrite(t, operation)
      const pending = (operation === 'password'
        ? change(f.token, 'stale-replacement')
        : request(f.token, 'DELETE', '/auth/me', { password: 'old-password' })
      ).then(result => result)
      await paused.waiting

      let expectedHash = f.hash
      if (invalidation.includes('changes password')) {
        const current = invalidation.startsWith('same') ? f.token : f.otherToken
        assert.equal((await change(current, 'owner-replacement')).statusCode, 200)
        expectedHash = db.dbGetUserByEmail(f.email).password_hash
      } else if (invalidation === 'logout') {
        assert.equal((await request(f.token, 'POST', '/auth/logout', {})).statusCode, 200)
      } else {
        db.default.prepare('UPDATE sessions SET expires_at = unixepoch() WHERE token_hash = ?')
          .run(db.dbGetSession(f.token).token_hash)
      }
      const sessionsBefore = db.default.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY token_hash').all(f.id)
      paused.release()
      assert.equal((await pending).statusCode, 401)
      assert.equal(db.dbGetUserByEmail(f.email).password_hash, expectedHash)
      assert.ok(db.dbRoomExists(f.room))
      assert.deepEqual(db.default.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY token_hash').all(f.id), sessionsBefore)
      if (invalidation.startsWith('same')) {
        assert.equal((await request(f.token, 'GET', '/auth/me')).statusCode, 200)
      }
    })
  }
}

test('password change rolls back credentials and pending email links if session revocation fails', async t => {
  const f = fixture()
  db.dbCreateEmailVerification('pending-email-change', f.id, 'new@example.com', 'change', Math.floor(Date.now() / 1000) + 3600)
  db.default.exec(`CREATE TEMP TRIGGER fail_session_revocation BEFORE DELETE ON sessions
    BEGIN SELECT RAISE(ABORT, 'simulated revocation failure'); END`)
  t.after(() => db.default.exec('DROP TRIGGER fail_session_revocation'))
  assert.equal((await change(f.token, 'replacement-password')).statusCode, 500)
  assert.equal(db.dbGetUserByEmail(f.email).password_hash, f.hash)
  assert.ok(db.dbGetSession(f.token))
  assert.ok(db.dbGetSession(f.otherToken))
  assert.equal(db.default.prepare('SELECT used_at FROM email_verifications WHERE token_hash = ?').get('pending-email-change').used_at, null)
})

test('account deletion rolls back rooms, sessions and user when the final delete fails', async t => {
  const f = fixture()
  db.default.exec(`CREATE TEMP TRIGGER fail_user_delete BEFORE DELETE ON users
    BEGIN SELECT RAISE(ABORT, 'simulated account deletion failure'); END`)
  t.after(() => db.default.exec('DROP TRIGGER fail_user_delete'))
  assert.equal((await request(f.token, 'DELETE', '/auth/me', { password: 'old-password' })).statusCode, 500)
  assert.ok(db.dbGetUserById(f.id))
  assert.ok(db.dbRoomExists(f.room))
  assert.equal(db.dbGetMemberRole(f.id, f.room), 'owner')
  assert.ok(db.dbGetSession(f.token))
  assert.ok(db.dbGetSession(f.otherToken))
})

test('guarded writes reject a valid session belonging to another user', () => {
  const owner = fixture(), other = fixture()
  assert.equal(db.dbChangePasswordForSession(owner.id, other.token, owner.hash, 'replacement'), false)
  assert.equal(db.dbDeleteUserForSession(owner.id, other.token, owner.hash), null)
  assert.equal(db.dbGetUserByEmail(owner.email).password_hash, owner.hash)
  assert.ok(db.dbRoomExists(owner.room))
})
