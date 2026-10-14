// Email sending: tokens, templates, Resend transport, limits, config check and cleanup.
// Uses a throw-away database and never talks to the network (fetch is replaced).
const assert = require('node:assert/strict')
const { randomUUID, createHash } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { after, beforeEach, test } = require('node:test')
const Database = require('better-sqlite3')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const originalCwd = process.cwd()
const dir = mkdtempSync(path.join(tmpdir(), 'coderoom-email-sending-'))
process.chdir(dir)
process.env.LOG_LEVEL = 'error'
process.env.NODE_ENV = 'development'
process.env.APP_URL = 'https://coderoom.example/'   // trailing slash on purpose
delete process.env.RESEND_API_KEY
delete process.env.MAIL_FROM
delete process.env.MAIL_DAILY_LIMIT

const db = require('../src/db')
const mail = require('../src/mail')
const ev = require('../src/emailVerification')

const realFetch = globalThis.fetch
const now = () => Math.floor(Date.now() / 1000)

after(() => {
  globalThis.fetch = realFetch
  process.chdir(originalCwd)
  try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows keeps SQLite files open */ }
})

let sent
beforeEach(() => {
  sent = []
  mail.setMailTransport(async (m) => { sent.push(m) })
  delete process.env.RESEND_API_KEY
  delete process.env.MAIL_DAILY_LIMIT
  delete process.env.MAIL_LANG
  process.env.NODE_ENV = 'development'
  globalThis.fetch = realFetch
})

const newUser = (email, name = 'Mario Rossi', verified = null) => {
  const id = randomUUID()
  db.dbCreateUser(id, name, email, 'hash', verified)
  return id
}
const tokenFrom = (message) => new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get('token')

test('token: random, url-safe, and the stored value is its SHA-256 hash', () => {
  const a = ev.generateVerificationToken()
  const b = ev.generateVerificationToken()
  assert.notEqual(a.token, b.token)
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(a.hash, createHash('sha256').update(a.token).digest('hex'))
  assert.equal(ev.hashVerificationToken(a.token), a.hash)
  assert.notEqual(a.hash, a.token)
})

test('signup email: goes to the address, link uses APP_URL, token verifies the account', async () => {
  const id = newUser('anna@example.com')
  const result = await ev.sendVerificationEmail({ userId: id, name: 'Anna', email: 'anna@example.com', purpose: 'signup' })

  assert.deepEqual(result, { status: 'sent' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'anna@example.com')
  assert.match(sent[0].subject, /Confirm your email address/)
  assert.match(sent[0].text, /^Hi Anna,/)
  assert.ok(sent[0].idempotencyKey.startsWith('verify-'))

  const link = sent[0].text.match(/https?:\/\/\S+/)[0]
  assert.ok(link.startsWith('https://coderoom.example/verify-email?token='), link)   // no double slash
  assert.ok(sent[0].html.includes(link))

  // the database never stores the raw token, only its hash
  const raw = new Database(path.join(dir, 'coderoom.db'), { readonly: true })
  const token = tokenFrom(sent[0])
  assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM email_verifications WHERE token_hash = ?').get(token).n, 0)
  raw.close()

  const consumed = db.dbConsumeEmailVerification(ev.hashVerificationToken(token))
  assert.equal(consumed.status, 'ok')
  assert.ok(db.dbGetUserById(id).email_verified_at)
})

test('email change: sent to the NEW address and worded for the change', async () => {
  const id = newUser('old@example.com', 'Old', now())
  await ev.sendVerificationEmail({ userId: id, name: 'Old', email: 'new@example.com', purpose: 'change' })
  assert.equal(sent[0].to, 'new@example.com')
  assert.match(sent[0].subject, /Confirm your new email address/)
  assert.match(sent[0].text, /stays the same/)
})

test('emails are in English by default and in Italian with MAIL_LANG=it', async () => {
  const id = newUser('lang@example.com', 'Giulia', now())
  assert.equal(mail.getMailConfig().lang, 'en')

  process.env.MAIL_LANG = 'it'
  assert.equal(mail.getMailConfig().lang, 'it')
  await ev.sendVerificationEmail({ userId: id, name: 'Giulia', email: 'lang-it@example.com', purpose: 'change' })
  assert.match(sent[0].subject, /Conferma il nuovo indirizzo email/)
  assert.match(sent[0].text, /^Ciao Giulia,/)
  assert.ok(sent[0].html.includes('<html lang="it">'))

  process.env.MAIL_LANG = 'fr'                      // unknown values fall back to English
  assert.equal(mail.getMailConfig().lang, 'en')
})

test('templates escape the user name in HTML (no markup injection)', async () => {
  const id = newUser('evil@example.com')
  await ev.sendVerificationEmail({ userId: id, name: '<script>alert(1)</script>"&', email: 'evil@example.com', purpose: 'signup' })
  assert.ok(!sent[0].html.includes('<script>'))
  assert.ok(sent[0].html.includes('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;'))
})

test('limit: cooldown between two emails to the same address', async () => {
  const id = newUser('cool@example.com')
  const p = { userId: id, name: 'C', email: 'cool@example.com', purpose: 'signup' }
  assert.equal((await ev.sendVerificationEmail(p)).status, 'sent')

  const second = await ev.sendVerificationEmail(p)
  assert.equal(second.status, 'throttled')
  assert.equal(second.reason, 'cooldown')
  assert.ok(second.retryAfterSeconds > 0 && second.retryAfterSeconds <= 60)
  assert.equal(sent.length, 1)   // nothing was sent the second time
})

test('limit: at most 5 emails per hour to the same address', async () => {
  const id = newUser('hourly@example.com')
  const t = now()
  for (let i = 0; i < 5; i++) {
    db.dbCreateEmailVerification(`hourly-${i}`, id, 'hourly@example.com', 'signup', t + 3600, t - 120 - i * 300)
  }
  const result = await ev.sendVerificationEmail({ userId: id, name: 'H', email: 'hourly@example.com', purpose: 'signup' })
  assert.deepEqual(result, { status: 'throttled', reason: 'hourly', retryAfterSeconds: undefined })
  assert.equal(sent.length, 0)

  // a different address is not affected
  const other = newUser('other-hourly@example.com')
  assert.equal((await ev.sendVerificationEmail({ userId: other, name: 'O', email: 'other-hourly@example.com', purpose: 'signup' })).status, 'sent')
})

test('limit: global daily cap (MAIL_DAILY_LIMIT)', async () => {
  const before = db.dbCountEmailVerificationsSince(now() - 86400)
  process.env.MAIL_DAILY_LIMIT = String(before + 1)

  const a = newUser('cap-a@example.com')
  assert.equal((await ev.sendVerificationEmail({ userId: a, name: 'A', email: 'cap-a@example.com', purpose: 'signup' })).status, 'sent')

  const b = newUser('cap-b@example.com')
  const blocked = await ev.sendVerificationEmail({ userId: b, name: 'B', email: 'cap-b@example.com', purpose: 'signup' })
  assert.equal(blocked.status, 'throttled')
  assert.equal(blocked.reason, 'daily')
  assert.equal(sent.length, 1)
})

test('a transport failure is reported as failed and still counts towards the limits', async () => {
  mail.setMailTransport(async () => { throw new Error('boom') })
  const id = newUser('fail@example.com')
  const p = { userId: id, name: 'F', email: 'fail@example.com', purpose: 'signup' }

  assert.deepEqual(await ev.sendVerificationEmail(p), { status: 'failed' })
  const retry = await ev.sendVerificationEmail(p)
  assert.equal(retry.status, 'throttled')
  assert.equal(retry.reason, 'cooldown')
})

test('Resend transport: correct request, no network, key never in the body', async () => {
  mail.setMailTransport(null)
  process.env.RESEND_API_KEY = 're_test_key_123'
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, text: async () => '{"id":"abc"}' }
  }

  const id = newUser('resend@example.com', 'Resend')
  const result = await ev.sendVerificationEmail({ userId: id, name: 'Resend', email: 'resend@example.com', purpose: 'signup' })
  assert.equal(result.status, 'sent')

  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.resend.com/emails')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer re_test_key_123')
  assert.ok(calls[0].init.headers['Idempotency-Key'].startsWith('verify-'))
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.from, 'Coderoom <noreply@rg-dev.lat>')
  assert.deepEqual(body.to, ['resend@example.com'])
  assert.match(body.subject, /Confirm your email address/)
  assert.ok(body.html && body.text)
  assert.ok(!calls[0].init.body.includes('re_test_key_123'))
})

test('Resend transport: an error response makes the send fail', async () => {
  mail.setMailTransport(null)
  process.env.RESEND_API_KEY = 're_test_key_123'
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => '{"message":"domain not verified"}' })

  const id = newUser('resend-fail@example.com')
  const result = await ev.sendVerificationEmail({ userId: id, name: 'R', email: 'resend-fail@example.com', purpose: 'signup' })
  assert.deepEqual(result, { status: 'failed' })
})

test('development without a provider: no network call, the link is only logged', async () => {
  mail.setMailTransport(null)
  let called = false
  globalThis.fetch = async () => { called = true; return { ok: true, status: 200, text: async () => '' } }

  const id = newUser('dev@example.com')
  const result = await ev.sendVerificationEmail({ userId: id, name: 'D', email: 'dev@example.com', purpose: 'signup' })
  assert.equal(result.status, 'sent')
  assert.equal(called, false)
})

test('production without a provider: sending fails instead of pretending', async () => {
  mail.setMailTransport(null)
  process.env.NODE_ENV = 'production'
  const id = newUser('prod@example.com')
  const result = await ev.sendVerificationEmail({ userId: id, name: 'P', email: 'prod@example.com', purpose: 'signup' })
  assert.deepEqual(result, { status: 'failed' })
})

test('startup config check', () => {
  process.env.NODE_ENV = 'development'
  assert.doesNotThrow(() => mail.assertMailConfig())          // only warns

  process.env.NODE_ENV = 'production'
  const savedUrl = process.env.APP_URL
  try {
    delete process.env.RESEND_API_KEY
    assert.throws(() => mail.assertMailConfig(), /RESEND_API_KEY/)

    process.env.RESEND_API_KEY = 're_x'
    process.env.APP_URL = 'http://coderoom.example'
    assert.throws(() => mail.assertMailConfig(), /https/)

    delete process.env.APP_URL
    assert.throws(() => mail.assertMailConfig(), /APP_URL is required/)

    process.env.APP_URL = 'https://coderoom.example'
    process.env.MAIL_FROM = 'not an address'
    assert.throws(() => mail.assertMailConfig(), /MAIL_FROM/)

    process.env.MAIL_FROM = 'Coderoom <noreply@rg-dev.lat>'
    assert.doesNotThrow(() => mail.assertMailConfig())
    process.env.MAIL_FROM = 'noreply@rg-dev.lat'
    assert.doesNotThrow(() => mail.assertMailConfig())
  } finally {
    process.env.APP_URL = savedUrl
    delete process.env.MAIL_FROM
  }
})

test('config: defaults and APP_URL without trailing slash', () => {
  const cfg = mail.getMailConfig()
  assert.equal(cfg.from, 'Coderoom <noreply@rg-dev.lat>')
  assert.equal(cfg.appUrl, 'https://coderoom.example')
  assert.equal(cfg.dailyLimit, 100)
  assert.equal(cfg.lang, 'en')
  process.env.MAIL_DAILY_LIMIT = 'abc'
  assert.equal(mail.getMailConfig().dailyLimit, 100)
  process.env.MAIL_DAILY_LIMIT = '25'
  assert.equal(mail.getMailConfig().dailyLimit, 25)
})

test('cleanup job: removes unverified accounts older than 48 h and old token rows', () => {
  const raw = new Database(path.join(dir, 'coderoom.db'))
  const t = now()
  const stale = newUser('cleanup-stale@example.com')
  const fresh = newUser('cleanup-fresh@example.com')
  const old = newUser('cleanup-old-verified@example.com', 'V', t - 10)
  raw.prepare('UPDATE users SET created_at = ? WHERE id IN (?, ?)').run(t - 3 * 86400, stale, old)
  db.dbCreateEmailVerification('cleanup-old-row', fresh, 'cleanup-fresh@example.com', 'signup', t + 3600, t - 3 * 86400)

  const result = ev.runEmailVerificationCleanup(t)
  assert.ok(result.users >= 1)
  assert.ok(result.tokens >= 1)
  assert.equal(db.dbGetUserById(stale), undefined)
  assert.ok(db.dbGetUserById(fresh))
  assert.ok(db.dbGetUserById(old))
  raw.close()
})
