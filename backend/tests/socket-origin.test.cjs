const assert = require('node:assert/strict')
const { before, after, test } = require('node:test')
const { createServer } = require('node:http')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { Server } = require('socket.io')
const { io: connect } = require('socket.io-client')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const previousCwd = process.cwd()
process.chdir(mkdtempSync(path.join(tmpdir(), 'coderoom-origin-')))
process.env.LOG_LEVEL = 'error'
const db = require('../src/db')
const { createSession, verifySessionToken, SESSION_COOKIE_NAME } = require('../src/auth')
const { socketOptions } = require('../src/socketOptions')
const allowed = 'https://coderoom.example'
const server = createServer()
const io = new Server(server, socketOptions(allowed))
let address, cookie
let admitted = 0
io.on('connection', () => { admitted++ })
before(async () => {
  db.dbCreateUser('origin-user', 'Owner', 'origin@example.test', 'unused', Math.floor(Date.now() / 1000))
  const token = createSession('origin-user').token
  assert.ok(verifySessionToken(token))
  cookie = `${SESSION_COOKIE_NAME}=${token}`
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  address = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => io.close(resolve))
  db.default.close()
  process.chdir(previousCwd)
})

function handshake(transport, headers) {
  return new Promise((resolve, reject) => {
    const client = connect(address, {
      transports: [transport], reconnection: false, timeout: 1500,
      extraHeaders: { Cookie: cookie, ...headers },
    })
    const timer = setTimeout(() => { client.disconnect(); reject(new Error('Handshake stalled')) }, 3000)
    const finish = result => { clearTimeout(timer); client.disconnect(); resolve(result) }
    client.once('connect', () => finish(true))
    client.once('connect_error', () => finish(false))
  })
}
for (const transport of ['websocket', 'polling']) {
  test(`${transport}: authorized origin succeeds with a valid cookie`, async () => {
    assert.equal(await handshake(transport, { Origin: allowed }), true)
  })
  test(`${transport}: foreign and malformed origins are rejected despite a valid cookie`, async () => {
    const before = admitted
    for (const origin of ['https://foreign.example', 'https://coderoom.example.evil.test', 'http://coderoom.example', 'https://coderoom.example:8443', 'null', 'invalid', `${allowed}/path`]) {
      assert.equal(await handshake(transport, { Origin: origin, Referer: `${allowed}/room` }), false, origin)
    }
    assert.equal(admitted, before)
  })
  test(`${transport}: absent provenance is rejected`, async () => {
    assert.equal(await handshake(transport, {}), false)
  })
}
test('polling permits same-origin browser GETs using Referer when Origin is absent', async () => {
  assert.equal(await handshake('polling', { Referer: `${allowed}/room/123` }), true)
  assert.equal(await handshake('polling', { Referer: 'https://foreign.example/room' }), false)
  assert.equal(await handshake('polling', { Referer: 'invalid' }), false)
  assert.equal(await handshake('websocket', { Referer: `${allowed}/room/123` }), false)
})

test('authorized browser can upgrade from polling to WebSocket', async () => {
  await new Promise((resolve, reject) => {
    const client = connect(address, { autoConnect: false, reconnection: false,
      transports: ['polling', 'websocket'], extraHeaders: { Origin: allowed, Cookie: cookie } })
    const timer = setTimeout(() => finish(new Error('Upgrade stalled')), 3000)
    const finish = error => {
      clearTimeout(timer)
      client.disconnect()
      error ? reject(error) : resolve()
    }
    client.once('connect_error', finish)
    client.connect()
    client.io.engine.once('upgrade', transport => {
      try { assert.equal(transport.name, 'websocket'); finish() } catch (err) { finish(err) }
    })
  })
})

test('invalid allowed-origin configuration fails closed', () => {
  for (const value of ['*', 'null', '', 'https://coderoom.example/path', 'file:///tmp']) {
    assert.throws(() => socketOptions(value))
  }
})
