// Full email-verification flow through the real routes (signup, login, confirm, resend, email change).
// The email transport is replaced by an in-memory collector; nothing is sent.
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { after, before, beforeEach, test } = require('node:test')
const bcrypt = require('bcryptjs')
const Fastify = require('fastify')
const cookie = require('@fastify/cookie')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const originalCwd = process.cwd()
const dir = mkdtempSync(path.join(tmpdir(), 'coderoom-email-auth-'))
process.chdir(dir)
process.env.LOG_LEVEL = 'error'
process.env.NODE_ENV = 'development'
process.env.APP_URL = 'https://coderoom.example'
delete process.env.RESEND_API_KEY
delete process.env.MAIL_DAILY_LIMIT

const db = require('../src/db')
const mail = require('../src/mail')
const ev = require('../src/emailVerification')
const { registerAuthRoutes, createSession, SESSION_COOKIE_NAME } = require('../src/auth')

const app = Fastify()
let sent

before(async () => {
  await app.register(cookie)
  await registerAuthRoutes(app)
  await app.ready()
})

after(async () => {
  await app.close()
  db.default.close()
  process.chdir(originalCwd)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows may keep the files for a moment */ }
})

beforeEach(() => {
  sent = []
  mail.setMailTransport(async (m) => { sent.push(m) })
  delete process.env.MAIL_DAILY_LIMIT
})

const uniqueEmail = (label) => `${label}-${randomUUID().slice(0, 8)}@example.com`
const post = (url, payload, cookieValue) =>
  app.inject({ method: 'POST', url, payload, headers: cookieValue ? { cookie: cookieValue } : {} })
const put = (url, payload, cookieValue) =>
  app.inject({ method: 'PUT', url, payload, headers: { cookie: cookieValue } })
const get = (url, cookieValue) => app.inject({ method: 'GET', url, headers: { cookie: cookieValue } })
const tokenFrom = (message) => new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token')
const sessionCookie = (res) => res.cookies.find((c) => c.name === SESSION_COOKIE_NAME)
function assertSignupResponse(res, email) {
  const { resendToken, ...body } = res.json()
  assert.deepEqual(body, { status: 'verification_required', email })
  assert.match(resendToken, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(res.headers['cache-control'], 'no-store')
  return resendToken
}
// lets the cooldown pass without waiting a real minute
const ageEmails = (seconds = 120) => db.default.prepare('UPDATE email_verifications SET created_at = created_at - ?').run(seconds)
const sessionCount = (userId) => db.default.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(userId).n
const waitFor = async (predicate) => {
  for (let i = 0; i < 50 && !predicate(); i++) await new Promise((r) => setTimeout(r, 20))
}

async function registerAndConfirm(email, password = 'secret123', name = 'Test User') {
  await post('/auth/signup', { name, email, password })
  const res = await post('/auth/verify-email', { token: tokenFrom(sent.at(-1)) })
  assert.equal(res.statusCode, 200)
  return db.dbGetUserByEmail(email)
}

test('login cannot create a session with stale credentials after a concurrent password change', async (t) => {
  const email = uniqueEmail('password-race')
  const oldPassword = 'original-password'
  const newPassword = 'replacement-password'
  const user = await registerAndConfirm(email, oldPassword)
  const ownerToken = createSession(user.id).token
  const ownerCookie = `${SESSION_COOKIE_NAME}=${ownerToken}`
  const originalCompare = bcrypt.compare
  let release
  let entered
  const gate = new Promise((resolve) => { release = resolve })
  const comparing = new Promise((resolve) => { entered = resolve })
  let pauseFirst = true
  t.after(() => { release(); bcrypt.compare = originalCompare })
  bcrypt.compare = async (password, hash) => {
    const valid = await originalCompare(password, hash)
    if (pauseFirst && password === oldPassword) {
      pauseFirst = false
      entered()
      await gate
    }
    return valid
  }

  const pendingLogin = post('/auth/login', { email, password: oldPassword }).then((res) => res)
  await comparing
  const changed = await put('/auth/me/password', {
    currentPassword: oldPassword, newPassword,
  }, ownerCookie)
  assert.equal(changed.statusCode, 200)
  release()
  const staleLogin = await pendingLogin
  bcrypt.compare = originalCompare

  assert.equal(staleLogin.statusCode, 401)
  assert.equal(staleLogin.headers['set-cookie'], undefined)
  assert.equal(sessionCount(user.id), 1)
  assert.equal((await get('/auth/me', ownerCookie)).statusCode, 200)
  const freshLogin = await post('/auth/login', { email, password: newPassword })
  assert.equal(freshLogin.statusCode, 200)
  assert.ok(sessionCookie(freshLogin))
})

function inviteFixture() {
  const users = Array.from({ length: 3 }, () => {
    const id = randomUUID()
    db.dbCreateUser(id, 'Invite user', uniqueEmail('invite'), 'unused', Math.floor(Date.now() / 1000))
    return id
  })
  const roomId = randomUUID(), token = randomUUID()
  db.dbCreateRoomWithOwner(roomId, users[0], 'Invited room')
  db.dbSetRoomPassword(roomId, bcrypt.hashSync('room-secret', 4))
  db.dbCreateInvite(token, roomId, users[0], Math.floor(Date.now() / 1000) + 3600)
  const sessions = users.map(id => createSession(id).token)
  const accept = (index) => post(`/invite/${token}/accept`, { password: 'room-secret' }, `${SESSION_COOKIE_NAME}=${sessions[index]}`)
  return { users, roomId, token, sessions, accept }
}

function pauseInviteChecks(t, count) {
  const original = bcrypt.compare
  let release, entered, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  t.after(() => { release(); bcrypt.compare = original })
  bcrypt.compare = async (password, hash) => {
    const valid = await original(password, hash)
    if (++calls === count) entered()
    await gate
    return valid
  }
  return { started, release }
}

test('single-use invite admits only one concurrent caller', async t => {
  const fixture = inviteFixture()
  const pause = pauseInviteChecks(t, 2)
  const requests = [fixture.accept(1).then(r => r), fixture.accept(2).then(r => r)]
  await pause.started
  pause.release()
  const responses = await Promise.all(requests)
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 404])
  assert.equal(fixture.users.slice(1).filter(id => db.dbGetMemberRole(id, fixture.roomId) === 'viewer').length, 1)
  assert.equal(db.dbGetInvite(fixture.token), undefined)
})

for (const scenario of ['expired', 'revoked', 'password changed', 'session revoked']) {
  test(`invite rechecks ${scenario} after password comparison`, async t => {
    const f = inviteFixture()
    const pause = pauseInviteChecks(t, 1)
    const pending = f.accept(1).then(r => r)
    await pause.started
    if (scenario === 'expired') db.default.prepare('UPDATE invites SET expires_at = 0 WHERE token = ?').run(f.token)
    if (scenario === 'revoked') db.dbDeleteInvite(f.token)
    if (scenario === 'password changed') db.dbSetRoomPassword(f.roomId, 'replacement-hash')
    if (scenario === 'session revoked') db.dbDeleteSession(f.sessions[1])
    pause.release()
    const response = await pending
    assert.equal(response.statusCode, scenario === 'password changed' ? 409 : scenario === 'session revoked' ? 401 : 404)
    assert.equal(db.dbGetMemberRole(f.users[1], f.roomId), null)
  })
}

test('invite transaction preserves the link when membership creation fails', async () => {
  const f = inviteFixture()
  db.default.exec(`CREATE TEMP TRIGGER fail_invite_membership BEFORE INSERT ON room_members
    BEGIN SELECT RAISE(ABORT, 'membership failed'); END`)
  try {
    assert.equal((await f.accept(1)).statusCode, 500)
    assert.ok(db.dbGetInvite(f.token))
    assert.equal(db.dbGetMemberRole(f.users[1], f.roomId), null)
  } finally {
    db.default.exec('DROP TRIGGER fail_invite_membership')
  }
  assert.equal((await f.accept(1)).statusCode, 200)
})

test('invite acceptance preserves an existing member role', async () => {
  const f = inviteFixture()
  db.dbAddRoomMember(f.users[1], f.roomId, 'editor')
  assert.equal((await f.accept(1)).statusCode, 200)
  assert.equal(db.dbGetMemberRole(f.users[1], f.roomId), 'editor')
  assert.equal((await f.accept(2)).statusCode, 404)
})

test('signup: creates an unverified account, sends one email and creates NO session', async () => {
  const email = uniqueEmail('signup')
  const res = await post('/auth/signup', { name: 'Anna', email, password: 'secret123' })

  assert.equal(res.statusCode, 200)
  assertSignupResponse(res, email)
  assert.equal(res.headers['set-cookie'], undefined)
  assert.equal(res.json().user, undefined)

  const user = db.dbGetUserByEmail(email)
  assert.equal(user.email_verified_at, null)
  assert.equal(sessionCount(user.id), 0)

  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, email)
})

test('login: refused until the email is confirmed, then it works', async () => {
  const email = uniqueEmail('login')
  await post('/auth/signup', { name: 'Luca', email, password: 'secret123' })

  const refused = await post('/auth/login', { email, password: 'secret123' })
  assert.equal(refused.statusCode, 401)
  assert.equal(refused.json().error, 'Invalid email or password')
  assert.equal(refused.headers['set-cookie'], undefined)

  // a wrong password is still a plain 401: the 403 cannot be used to discover registered addresses
  const wrong = await post('/auth/login', { email, password: 'not-the-password' })
  assert.equal(wrong.statusCode, 401)
  assert.equal(wrong.json().code, undefined)

  const confirmed = await post('/auth/verify-email', { token: tokenFrom(sent[0]) })
  assert.equal(confirmed.statusCode, 200)
  assert.deepEqual(confirmed.json(), { status: 'verified', purpose: 'signup', email })

  const ok = await post('/auth/login', { email, password: 'secret123' })
  assert.equal(ok.statusCode, 200)
  assert.ok(sessionCookie(ok))
  assert.equal(ok.json().user.email, email)
})

test('verify-email: a link works once, expired and garbage links are rejected', async () => {
  const email = uniqueEmail('verify')
  await post('/auth/signup', { name: 'V', email, password: 'secret123' })
  const token = tokenFrom(sent[0])

  assert.equal((await post('/auth/verify-email', { token })).statusCode, 200)
  const again = await post('/auth/verify-email', { token })
  assert.equal(again.statusCode, 400)
  assert.equal(again.json().code, 'invalid_token')

  const other = uniqueEmail('expired')
  await post('/auth/signup', { name: 'E', email: other, password: 'secret123' })
  const user = db.dbGetUserByEmail(other)
  const expired = ev.generateVerificationToken()
  db.dbCreateEmailVerification(expired.hash, user.id, other, 'signup', Math.floor(Date.now() / 1000) - 5)
  const res = await post('/auth/verify-email', { token: expired.token })
  assert.equal(res.statusCode, 410)
  assert.equal(res.json().code, 'token_expired')
  assert.equal(db.dbGetUserByEmail(other).email_verified_at, null)

  for (const payload of [{}, { token: '' }, { token: 'short' }, { token: 123 }, { token: 'x'.repeat(500) }, { token: 'A'.repeat(43) }]) {
    const bad = await post('/auth/verify-email', payload)
    assert.equal(bad.statusCode, 400, JSON.stringify(payload))
    assert.equal(bad.json().code, 'invalid_token')
  }
})

test('signup after preregistration activates only the credentials from the selected link', async () => {
  const email = uniqueEmail('replace')
  await post('/auth/signup', { name: 'Attacker', email, password: 'attacker-pass' })
  const id = db.dbGetUserByEmail(email).id
  ageEmails()

  const res = await post('/auth/signup', { name: 'Real Owner', email, password: 'owner-pass-1' })
  assert.equal(res.statusCode, 200)
  assert.equal(sent.length, 2)
  assert.equal(db.dbGetUserByEmail(email).id, id)           // same row, not a duplicate
  assert.equal(db.dbGetUserById(id).name, 'Attacker')

  assert.equal(db.dbGetUserById(id).email_verified_at, null)
  assert.equal((await post('/auth/verify-email', { token: tokenFrom(sent[1]) })).statusCode, 200)
  assert.equal(db.dbGetUserById(id).name, 'Real Owner')
  assert.equal((await post('/auth/verify-email', { token: tokenFrom(sent[0]) })).statusCode, 400)
  assert.equal((await post('/auth/login', { email, password: 'attacker-pass' })).statusCode, 401)
  assert.equal((await post('/auth/login', { email, password: 'owner-pass-1' })).statusCode, 200)
})

test('signup rejects an already confirmed address without changing the existing account', async () => {
  const email = uniqueEmail('taken')
  await registerAndConfirm(email, 'original-pass')
  const original = db.dbGetUserByEmail(email)
  const countBefore = db.default.prepare('SELECT COUNT(*) AS n FROM users').get().n
  sent.length = 0

  const res = await post('/auth/signup', { name: 'Intruder', email, password: 'intruder-pass' })
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().code, 'email_already_registered')
  const normalized = await post('/auth/signup', { name: 'Intruder', email: ` ${email.toUpperCase()} `, password: 'intruder-pass' })
  assert.equal(normalized.statusCode, 409)
  assert.equal(db.default.prepare('SELECT COUNT(*) AS n FROM users').get().n, countBefore)
  assert.deepEqual(db.dbGetUserByEmail(email), original)
  assert.equal(res.cookies.length, 0)
  assert.equal(sent.length, 0)
  assert.equal((await post('/auth/login', { email, password: 'intruder-pass' })).statusCode, 401)
  assert.equal((await post('/auth/login', { email, password: 'original-pass' })).statusCode, 200)
})

test('signup right after another one: account saved, email held back by the cooldown', async () => {
  const email = uniqueEmail('cooldown')
  await post('/auth/signup', { name: 'A', email, password: 'secret123' })
  const second = await post('/auth/signup', { name: 'Intruder', email, password: 'intruder-pass' })

  assert.equal(second.statusCode, 200)
  assertSignupResponse(second, email)
  assert.equal(sent.length, 1)
  const oldLink = await post('/auth/verify-email', { token: tokenFrom(sent[0]) })
  assert.equal(oldLink.statusCode, 200)
  assert.equal(db.dbGetUserByEmail(email).name, 'A')
  assert.equal((await post('/auth/login', { email, password: 'secret123' })).statusCode, 200)
  assert.equal((await post('/auth/login', { email, password: 'intruder-pass' })).statusCode, 401)
})

test('signup: provider failure keeps the account and returns a neutral response', async () => {
  mail.setMailTransport(async () => { throw new Error('provider down') })
  const email = uniqueEmail('provider')
  const res = await post('/auth/signup', { name: 'P', email, password: 'secret123' })
  assert.equal(res.statusCode, 200)
  assertSignupResponse(res, email)
  assert.ok(db.dbGetUserByEmail(email))
})

test('signup/login: malformed bodies are a 400, never a 500', async () => {
  const signupBodies = [undefined, {}, { name: 5, email: 'a@b.co', password: 'secret123' }, { name: 'x', email: ['a@b.co'], password: 'secret123' }, { name: 'x', email: 'a@b.co', password: { $ne: 1 } }]
  for (const payload of signupBodies) {
    assert.equal((await post('/auth/signup', payload)).statusCode, 400, JSON.stringify(payload))
  }
  const loginBodies = [undefined, {}, { email: ['a@b.co'], password: 'secret123' }, { email: 'a@b.co', password: { $ne: 1 } }, { email: 5, password: 'x' }]
  for (const payload of loginBodies) {
    assert.equal((await post('/auth/login', payload)).statusCode, 400, JSON.stringify(payload))
  }
})

test('resend: email alone never sends mail or reveals whether an account exists', async () => {
  const unconfirmed = uniqueEmail('resend-un')
  await post('/auth/signup', { name: 'U', email: unconfirmed, password: 'secret123' })
  const confirmed = uniqueEmail('resend-ok')
  await registerAndConfirm(confirmed)
  sent.length = 0
  ageEmails()

  const answers = []
  for (const email of [uniqueEmail('resend-unknown'), confirmed, unconfirmed]) {
    const res = await post('/auth/resend-verification', { email })
    assert.equal(res.statusCode, 400)
    answers.push(res.json())
  }
  assert.ok(answers[0].error)
  assert.deepEqual(answers[1], answers[0])
  assert.deepEqual(answers[2], answers[0])

  assert.equal(sent.length, 0)

  assert.equal((await post('/auth/resend-verification', { email: 'not-an-email' })).statusCode, 400)
  assert.equal((await post('/auth/resend-verification', {})).statusCode, 400)
})

test('resend: the sending limits still apply', async () => {
  const email = uniqueEmail('resend-limit')
  const signup = await post('/auth/signup', { name: 'L', email, password: 'secret123' })
  const resendToken = assertSignupResponse(signup, email)
  sent.length = 0
  // no time passed: cooldown blocks it, the answer is the same and nothing is sent
  const res = await post('/auth/resend-verification', { email, resendToken })
  assert.deepEqual(res.json(), { status: 'ok' })
  await new Promise((r) => setTimeout(r, 100))
  assert.equal(sent.length, 0)
})

for (const firstDelivery of ['sent', 'throttled', 'failed']) {
  test(`resend preserves the owner's signup snapshot despite earlier and later signups (${firstDelivery})`, async () => {
    const email = uniqueEmail('resend-snapshot')
    await post('/auth/signup', { name: 'Earlier request', email, password: 'earlier-pass' })
    if (firstDelivery !== 'throttled') ageEmails()
    if (firstDelivery === 'failed') mail.setMailTransport(async () => { throw new Error('provider unavailable') })
    const owner = await post('/auth/signup', { name: 'Owner', email, password: 'owner-pass' })
    const resendToken = assertSignupResponse(owner, email)
    mail.setMailTransport(async message => sent.push(message))
    ageEmails()
    await post('/auth/signup', { name: 'Later request', email, password: 'later-pass' })
    ageEmails()
    sent.length = 0
    const resend = await post('/auth/resend-verification', { email, resendToken })
    assert.equal(resend.statusCode, 200)
    assert.equal(sent.length, 1)
    assert.equal((await post('/auth/verify-email', { token: tokenFrom(sent[0]) })).statusCode, 200)
    assert.equal(db.dbGetUserByEmail(email).name, 'Owner')
    assert.equal((await post('/auth/login', { email, password: 'owner-pass' })).statusCode, 200)
    assert.equal((await post('/auth/login', { email, password: 'earlier-pass' })).statusCode, 401)
    assert.equal((await post('/auth/login', { email, password: 'later-pass' })).statusCode, 401)
    assert.equal(db.default.prepare('SELECT count(*) AS n FROM signup_requests WHERE user_id = ?').get(db.dbGetUserByEmail(email).id).n, 0)
    sent.length = 0
    assert.equal((await post('/auth/resend-verification', { email, resendToken })).statusCode, 400)
    assert.equal(sent.length, 0)
  })
}

test('resend capability is hashed, email-bound, expires, and cannot confirm an account', async () => {
  const email = uniqueEmail('resend-capability')
  const result = await post('/auth/signup', { name: 'Owner', email, password: 'owner-pass' })
  const resendToken = assertSignupResponse(result, email)
  const hash = ev.hashVerificationToken(resendToken)
  const row = db.default.prepare('SELECT * FROM signup_requests WHERE token_hash = ?').get(hash)
  assert.ok(row)
  assert.equal(db.default.prepare('SELECT * FROM signup_requests WHERE token_hash = ?').get(resendToken), undefined)
  assert.equal((await post('/auth/verify-email', { token: resendToken })).statusCode, 400)
  ageEmails()
  sent.length = 0
  for (const payload of [
    { email, resendToken: 'x'.repeat(43) },
    { email: uniqueEmail('other'), resendToken },
    { email, resendToken: {} },
    { email },
  ]) assert.equal((await post('/auth/resend-verification', payload)).statusCode, 400)
  db.default.prepare('UPDATE signup_requests SET expires_at = unixepoch() WHERE token_hash = ?').run(hash)
  assert.equal((await post('/auth/resend-verification', { email, resendToken })).statusCode, 400)
  assert.equal(sent.length, 0)
  ev.runEmailVerificationCleanup()
  assert.equal(db.default.prepare('SELECT * FROM signup_requests WHERE token_hash = ?').get(hash), undefined)
})

test('email change: needs the password, sends the link to the NEW address, applies it only when confirmed', async () => {
  const email = uniqueEmail('change-old')
  const user = await registerAndConfirm(email, 'secret123', 'Changer')
  const session = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  const otherSession = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  sent.length = 0
  const newEmail = uniqueEmail('change-new')

  assert.equal((await put('/auth/me/email', { email: newEmail, currentPassword: 'wrong' }, session)).statusCode, 401)
  assert.equal((await put('/auth/me/email', { email: email, currentPassword: 'secret123' }, session)).statusCode, 400)
  assert.equal(sent.length, 0)

  const res = await put('/auth/me/email', { email: newEmail, currentPassword: 'secret123' }, session)
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().status, 'confirmation_sent')
  assert.equal(res.json().pendingEmail, newEmail)
  assert.equal(res.json().user.email, email)               // unchanged for now
  assert.equal(db.dbGetUserById(user.id).email, email)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, newEmail)

  const confirm = await post('/auth/verify-email', { token: tokenFrom(sent[0]) })
  assert.deepEqual(confirm.json(), { status: 'verified', purpose: 'change', email: newEmail })
  assert.equal(db.dbGetUserById(user.id).email, newEmail)

  // every old session is gone, the account is reachable only with the new address
  assert.equal((await get('/auth/me', session)).statusCode, 401)
  assert.equal((await get('/auth/me', otherSession)).statusCode, 401)
  assert.equal((await post('/auth/login', { email, password: 'secret123' })).statusCode, 401)
  assert.equal((await post('/auth/login', { email: newEmail, password: 'secret123' })).statusCode, 200)
})

test('password change revokes pending email links and permits a fresh request', async () => {
  const email = uniqueEmail('revoke-change')
  const user = await registerAndConfirm(email)
  const session = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  const target = uniqueEmail('revoke-target')
  assert.equal((await put('/auth/me/email', { email: target, currentPassword: 'secret123' }, session)).statusCode, 200)
  const oldToken = tokenFrom(sent.at(-1))
  assert.equal((await put('/auth/me/password', { currentPassword: 'secret123', newPassword: 'updated-pass' }, session)).statusCode, 200)
  const rejected = await post('/auth/verify-email', { token: oldToken })
  assert.equal(rejected.statusCode, 400)
  assert.equal(rejected.json().code, 'invalid_token')
  assert.equal(db.dbGetUserById(user.id).email, email)
  assert.equal((await get('/auth/me', session)).statusCode, 200)
  ageEmails()
  assert.equal((await put('/auth/me/email', { email: target, currentPassword: 'updated-pass' }, session)).statusCode, 200)
  assert.equal((await post('/auth/verify-email', { token: tokenFrom(sent.at(-1)) })).statusCode, 200)
  assert.equal(db.dbGetUserById(user.id).email, target)
})

test('email change cannot issue a token after its password check becomes stale', async (t) => {
  const user = await registerAndConfirm(uniqueEmail('stale-change'))
  const session = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  const originalCompare = bcrypt.compare
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  let pause = true
  t.after(() => { release(); bcrypt.compare = originalCompare })
  bcrypt.compare = async (password, hash) => {
    const valid = await originalCompare(password, hash)
    if (pause) { pause = false; entered(); await gate }
    return valid
  }
  sent.length = 0
  const pending = put('/auth/me/email', { email: uniqueEmail('stale-target'), currentPassword: 'secret123' }, session).then(r => r)
  await started
  assert.equal((await put('/auth/me/password', { currentPassword: 'secret123', newPassword: 'updated-pass' }, session)).statusCode, 200)
  release()
  assert.equal((await pending).statusCode, 401)
  assert.equal(sent.length, 0)
  assert.equal(db.dbGetUserById(user.id).email, user.email)
})

test('email change: an address used by another account is refused', async () => {
  const takenEmail = uniqueEmail('change-taken')
  await registerAndConfirm(takenEmail)
  const user = await registerAndConfirm(uniqueEmail('change-me'), 'secret123')
  const session = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  sent.length = 0

  const res = await put('/auth/me/email', { email: takenEmail, currentPassword: 'secret123' }, session)
  assert.equal(res.statusCode, 409)
  assert.equal(sent.length, 0)
})

test('email change: if the address is taken before the link is opened, nothing changes', async () => {
  const user = await registerAndConfirm(uniqueEmail('race-me'), 'secret123')
  const session = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  const target = uniqueEmail('race-target')
  sent.length = 0
  await put('/auth/me/email', { email: target, currentPassword: 'secret123' }, session)
  const token = tokenFrom(sent[0])

  ageEmails()                                              // let the 60 s cooldown on that address pass
  await registerAndConfirm(target)                         // somebody else confirms that address first
  const res = await post('/auth/verify-email', { token })
  assert.equal(res.statusCode, 409)
  assert.equal(res.json().code, 'email_taken')
  assert.notEqual(db.dbGetUserById(user.id).email, target)
})

test('email change: a user can only request 5 changes per hour', async () => {
  const user = await registerAndConfirm(uniqueEmail('limit-me'), 'secret123')
  const session = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  sent.length = 0

  for (let i = 0; i < 5; i++) {
    const res = await put('/auth/me/email', { email: uniqueEmail(`limit-${i}`), currentPassword: 'secret123' }, session)
    assert.equal(res.statusCode, 200, `request ${i}`)
  }
  const sixth = await put('/auth/me/email', { email: uniqueEmail('limit-6'), currentPassword: 'secret123' }, session)
  assert.equal(sixth.statusCode, 429)
  assert.equal(sent.length, 5)
})

test('email change: provider failure gives 502 and the email stays as it was', async () => {
  const email = uniqueEmail('change-fail')
  const user = await registerAndConfirm(email, 'secret123')
  const session = `${SESSION_COOKIE_NAME}=${createSession(user.id).token}`
  mail.setMailTransport(async () => { throw new Error('provider down') })

  const res = await put('/auth/me/email', { email: uniqueEmail('change-fail-new'), currentPassword: 'secret123' }, session)
  assert.equal(res.statusCode, 502)
  assert.equal(db.dbGetUserById(user.id).email, email)
})

test('accounts that existed before email verification (grandfathered) can still sign in', async () => {
  const id = randomUUID()
  const email = uniqueEmail('legacy')
  db.dbCreateUser(id, 'Legacy', email, bcrypt.hashSync('old-password', 4), Math.floor(Date.now() / 1000) - 86400)
  const res = await post('/auth/login', { email, password: 'old-password' })
  assert.equal(res.statusCode, 200)
})

for (const failure of [false, true]) {
  test(`later signup cannot invalidate the original link (provider failure: ${failure})`, async () => {
    const email = uniqueEmail('preserve')
    await post('/auth/signup', { name: 'Owner', email, password: 'owner-pass' })
    const original = tokenFrom(sent[0])
    ageEmails()
    if (failure) mail.setMailTransport(async () => { throw new Error('provider down') })
    const res = await post('/auth/signup', { name: 'Intruder', email, password: 'intruder-pass' })
    assertSignupResponse(res, email)
    assert.equal((await post('/auth/verify-email', { token: original })).statusCode, 200)
    assert.equal(db.dbGetUserByEmail(email).name, 'Owner')
    assert.equal((await post('/auth/login', { email, password: 'owner-pass' })).statusCode, 200)
    assert.equal((await post('/auth/login', { email, password: 'intruder-pass' })).statusCode, 401)
    if (!failure) assert.equal((await post('/auth/verify-email', { token: tokenFrom(sent[1]) })).statusCode, 400)
  })
}


test('failed logins lock only the attacking IP, survive restart, and ignore forged forwarding headers', async () => {
  const email = uniqueEmail('ip-lock')
  await registerAndConfirm(email)
  const login = (ip, password, suppliedEmail = email, headers = {}) => app.inject({
    method: 'POST', url: '/auth/login', remoteAddress: ip, headers,
    payload: { email: suppliedEmail, password },
  })
  for (let i = 0; i < 5; i++) {
    assert.equal((await login('198.51.100.10', 'wrong-password')).statusCode, 401)
  }
  const blocked = await login('198.51.100.10', 'secret123', email.toUpperCase(), { 'x-forwarded-for': '203.0.113.20' })
  assert.equal(blocked.statusCode, 429)
  assert.ok(Number(blocked.headers['retry-after']) > 0)
  assert.equal(blocked.cookies.length, 0)
  assert.equal((await login('203.0.113.20', 'secret123')).statusCode, 200)
  assert.equal((await login('198.51.100.10', 'secret123')).statusCode, 429)
  const modulePath = require.resolve('../src/authRateLimiter')
  delete require.cache[modulePath]
  const restarted = require(modulePath)
  assert.ok(restarted.checkLoginLock(email, '198.51.100.10') > 0)
  assert.equal(restarted.checkLoginLock(email, '203.0.113.20'), null)
})

test('legacy account-wide locks do not block owners; expired locks are removed', async () => {
  const email = uniqueEmail('legacy-lock')
  await registerAndConfirm(email)
  const now = Math.floor(Date.now() / 1000)
  db.dbUpsertLoginAttempt(email, 5, now, now + 600)
  assert.equal((await post('/auth/login', { email, password: 'secret123' })).statusCode, 200)
  db.dbUpsertLoginAttempt('expired-lock', 5, now - 1000, now - 1)
  db.dbUpsertLoginAttempt('old-failures', 1, now - 1000, null)
  db.dbDeleteExpiredLoginAttempts()
  assert.equal(db.dbGetLoginAttempt('expired-lock'), undefined)
  assert.equal(db.dbGetLoginAttempt('old-failures'), undefined)
  assert.ok(db.dbGetLoginAttempt(email))
})

test('successful login resets only its own failure counter', async () => {
  const email = uniqueEmail('reset-lock')
  await registerAndConfirm(email)
  for (let i = 0; i < 4; i++) assert.equal((await post('/auth/login', { email, password: 'wrong' })).statusCode, 401)
  assert.equal((await post('/auth/login', { email, password: 'secret123' })).statusCode, 200)
  for (let i = 0; i < 4; i++) assert.equal((await post('/auth/login', { email, password: 'wrong' })).statusCode, 401)
  assert.equal((await post('/auth/login', { email, password: 'secret123' })).statusCode, 200)
})

test('the real login route retains its per-IP limit across different emails', async (t) => {
  const limited = Fastify()
  t.after(() => limited.close())
  await limited.register(cookie)
  await limited.register(require('@fastify/rate-limit'), { global: true, max: 1000, timeWindow: '1 minute' })
  await registerAuthRoutes(limited)
  for (let i = 0; i < 11; i++) {
    const res = await limited.inject({ method: 'POST', url: '/auth/login', remoteAddress: '198.51.100.30',
      payload: { email: uniqueEmail('unknown'), password: 'wrong' } })
    assert.equal(res.statusCode, i < 10 ? 401 : 429)
  }
  const other = await limited.inject({ method: 'POST', url: '/auth/login', remoteAddress: '203.0.113.30',
    payload: { email: uniqueEmail('unknown'), password: 'wrong' } })
  assert.equal(other.statusCode, 401)
})


test('login locks expire without being extended by in-flight failures', () => {
  const limiter = require('../src/authRateLimiter')
  const email = uniqueEmail('expiry-lock')
  const realNow = Date.now
  const start = realNow()
  try {
    Date.now = () => start
    for (let i = 0; i < 5; i++) limiter.recordLoginFailure(email, '198.51.100.40')
    assert.equal(limiter.checkLoginLock(email, '198.51.100.40'), 600)
    Date.now = () => start + 360000
    limiter.recordLoginFailure(email, '198.51.100.40')
    assert.equal(limiter.checkLoginLock(email, '198.51.100.40'), 240)
    Date.now = () => start + 600000
    assert.equal(limiter.checkLoginLock(email, '198.51.100.40'), null)
  } finally {
    Date.now = realNow
  }
})


for (const password of ['a'.repeat(72), '\u00e9'.repeat(36), '\u{1f600}'.repeat(18)]) {
  test(`72-byte password works without accepting a suffix (${password.length} code units)`, async () => {
    const email = uniqueEmail('byte-boundary')
    const user = await registerAndConfirm(email, password)
    const login = await post('/auth/login', { email, password })
    assert.equal(login.statusCode, 200)
    const session = `${SESSION_COOKIE_NAME}=${sessionCookie(login).value}`
    assert.equal((await post('/auth/login', { email, password: password + 'x' })).statusCode, 401)
    assert.equal((await put('/auth/me/email', { email: uniqueEmail('target'), currentPassword: password + 'x' }, session)).statusCode, 401)
    assert.equal((await put('/auth/me/password', { currentPassword: password + 'x', newPassword: 'replacement' }, session)).statusCode, 401)
    assert.equal((await app.inject({ method: 'DELETE', url: '/auth/me', headers: { cookie: session }, payload: { password: password + 'x' } })).statusCode, 401)
    assert.ok(db.dbGetUserById(user.id))
    assert.equal((await put('/auth/me/password', { currentPassword: password, newPassword: password + 'x' }, session)).statusCode, 400)
    assert.equal((await put('/auth/me/password', { currentPassword: password, newPassword: password }, session)).statusCode, 200)
  })
}

test('signup rejects passwords over 72 UTF-8 bytes before creating accounts or sending mail', async () => {
  for (const password of ['a'.repeat(73), '\u00e9'.repeat(37), '\u{1f600}'.repeat(19), 'a'.repeat(71) + '\u00e9']) {
    const email = uniqueEmail('too-many-bytes')
    const res = await post('/auth/signup', { name: 'Test', email, password })
    assert.equal(res.statusCode, 400)
    assert.match(res.json().error, /72 UTF-8 bytes/)
    assert.equal(db.dbGetUserByEmail(email), undefined)
  }
  assert.equal(sent.length, 0)
})

test('shared bcrypt comparison rejects overlong ASCII and Unicode inputs for room and account checks', async () => {
  const { comparePassword, fitsBcrypt } = require('../src/passwords')
  for (const prefix of ['a'.repeat(72), '\u00e9'.repeat(36), '\u{1f600}'.repeat(18)]) {
    const hash = await bcrypt.hash(prefix, 4)
    assert.equal(await bcrypt.compare(prefix + 'suffix', hash), true) // reproduce the original bug
    assert.equal(await comparePassword(prefix + 'suffix', hash), false)
    assert.equal(await comparePassword(prefix, hash), true)
    assert.equal(fitsBcrypt(prefix), true)
  }
  for (const invalid of [null, undefined, {}, 123]) assert.equal(await comparePassword(invalid, 'unused'), false)
})


test('signup keeps pending requests recoverable but explicitly rejects verified addresses', async t => {
  const verified = uniqueEmail('enum-verified')
  await registerAndConfirm(verified)
  const original = bcrypt.hash
  const costs = []
  bcrypt.hash = async (password, cost) => { costs.push(cost); return original(password, cost) }
  t.after(() => { bcrypt.hash = original })
  const fresh = uniqueEmail('enum-fresh')
  for (const email of [fresh, fresh, verified]) {
    const res = await post('/auth/signup', { name: 'Attempt', email, password: 'chosen-pass' })
    assert.equal(res.statusCode, email === verified ? 409 : 200)
    if (email === verified) assert.equal(res.json().code, 'email_already_registered')
    else assertSignupResponse(res, email)
    assert.equal(res.cookies.length, 0)
    const login = await post('/auth/login', { email, password: 'chosen-pass' })
    assert.equal(login.statusCode, 401)
    assert.deepEqual(login.json(), { error: 'Invalid email or password' })
  }
  assert.deepEqual(costs, [10, 10, 10])
})

test('unknown and known emails perform the same bcrypt cost before rejecting login', async t => {
  const email = uniqueEmail('enum-cost')
  await registerAndConfirm(email)
  const original = bcrypt.compare
  const costs = []
  bcrypt.compare = async (password, hash) => { costs.push(bcrypt.getRounds(hash)); return original(password, hash) }
  t.after(() => { bcrypt.compare = original })
  const known = await post('/auth/login', { email, password: 'wrong-password' })
  const unknown = await post('/auth/login', { email: uniqueEmail('unknown-cost'), password: 'wrong-password' })
  assert.equal(known.statusCode, unknown.statusCode)
  assert.deepEqual(known.json(), unknown.json())
  assert.deepEqual(costs, [10, 10])
})

test('signup response does not wait for email delivery or expose provider failure', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  let completed = false
  mail.setMailTransport(async () => { await gate; completed = true; throw new Error('delayed provider failure') })
  const email = uniqueEmail('enum-delayed')
  try {
    const result = await Promise.race([
      post('/auth/signup', { name: 'Test', email, password: 'secret123' }),
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('signup waited for mail')), 3000); timer.unref() }),
    ])
    assert.equal(completed, false)
    assert.equal(result.statusCode, 200)
    assertSignupResponse(result, email)
  } finally {
    release()
    await new Promise(resolve => setImmediate(resolve))
  }
})


test('GET preview of a verification link never consumes the token', async () => {
  const email = uniqueEmail('scanner-preview')
  await post('/auth/signup', { name: 'Preview', email, password: 'secret123' })
  const token = tokenFrom(sent.at(-1))
  const preview = await app.inject({ method: 'GET', url: `/auth/verify-email?token=${encodeURIComponent(token)}` })
  assert.equal(preview.statusCode, 404)
  assert.equal(db.dbGetUserByEmail(email).email_verified_at, null)
  assert.equal((await post('/auth/verify-email', { token })).statusCode, 200)
})
