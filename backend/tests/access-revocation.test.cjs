const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { before, after, test } = require('node:test')
const bcrypt = require('bcryptjs')
const Fastify = require('fastify')
const cookie = require('@fastify/cookie')
const { Server } = require('socket.io')
const { io: connectClient } = require('socket.io-client')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const originalCwd = process.cwd()
const testDirectory = mkdtempSync(path.join(tmpdir(), 'coderoom-access-revocation-'))
process.chdir(testDirectory)
process.env.LOG_LEVEL = 'error'
delete process.env.DOCKER_HOST

const db = require('../src/db')
const { createSession, registerAuthRoutes, SESSION_COOKIE_NAME } = require('../src/auth')
const { registerSocketHandlers } = require('../src/socket')
const { flushAllRoomContent, getOrCreateRoom, getFileContent } = require('../src/rooms')
const app = Fastify()
const io = new Server(app.server)
const clients = new Set()
let address

before(async () => {
  await app.register(cookie)
  await registerAuthRoutes(app)
  registerSocketHandlers(io)
  address = await app.listen({ port: 0, host: '127.0.0.1' })
})

after(async () => {
  for (const client of clients) client.disconnect()
  await new Promise((resolve) => io.close(resolve))
  await app.close()
  flushAllRoomContent()
  db.default.close()
  process.chdir(originalCwd)
  for (const file of readdirSync(testDirectory)) unlinkSync(path.join(testDirectory, file))
  rmdirSync(testDirectory)
})

function user() {
  const id = randomUUID()
  db.dbCreateUser(id, 'Test user', `${id}@example.invalid`, bcrypt.hashSync('old-password', 4))
  return { id, token: createSession(id).token }
}

function room(owner) {
  const id = randomUUID()
  db.dbCreateRoomWithOwner(id, owner.id, 'Original room')
  return id
}

function file(roomId) {
  const id = randomUUID()
  db.dbCreateFile(roomId, { id, name: 'test.js', kind: 'file', parentId: 'root', content: 'original' })
  return id
}

function request(user, method, url, payload) {
  return app.inject({ method, url, payload, headers: { cookie: `${SESSION_COOKIE_NAME}=${user.token}` } })
}

function nextEvent(client, event) {
  return new Promise((resolve, reject) => {
    const handler = (data) => { clearTimeout(timer); resolve(data) }
    const timer = setTimeout(() => {
      client.off(event, handler)
      reject(new Error(`Timed out waiting for ${event}`))
    }, 3000)
    client.once(event, handler)
  })
}

async function clientFor(t, user) {
  const client = connectClient(address, {
    autoConnect: false, reconnection: false, transports: ['websocket'],
    extraHeaders: user ? { Cookie: `${SESSION_COOKIE_NAME}=${user.token}` } : {},
  })
  clients.add(client)
  t.after(() => { client.disconnect(); clients.delete(client) })
  const connected = nextEvent(client, 'connect')
  client.connect()
  await connected
  return client
}

async function join(client, roomId) {
  const joined = nextEvent(client, 'room-state')
  client.emit('join-room', { roomId, userName: 'Test user' })
  return joined
}

async function drain(client) {
  io.sockets.sockets.get(client.id).once('test-barrier', (ack) => ack())
  await client.timeout(3000).emitWithAck('test-barrier')
}

function deferPasswordChecks(t) {
  const pending = []
  t.mock.method(bcrypt, 'compare', () => new Promise((resolve) => pending.push(resolve)))
  return pending
}

test('REST demotion immediately prevents edits on every open socket', async (t) => {
  const owner = user()
  const member = user()
  const roomId = room(owner)
  const fileId = file(roomId)
  db.dbAddRoomMember(member.id, roomId, 'editor')
  const first = await clientFor(t, member)
  const second = await clientFor(t, member)
  await join(first, roomId)
  await join(second, roomId)
  const roleUpdates = [nextEvent(first, 'role-refreshed'), nextEvent(second, 'role-refreshed')]
  const response = await request(owner, 'PUT', `/auth/rooms/${roomId}/members/${member.id}/role`, { role: 'viewer' })
  assert.equal(response.statusCode, 200)
  assert.deepEqual(await Promise.all(roleUpdates), [{ role: 'viewer' }, { role: 'viewer' }])
  for (const client of [first, second]) {
    assert.equal(io.sockets.sockets.get(client.id).data.role, 'viewer')
    client.emit('code-change', { fileId, content: 'unauthorized' })
    await drain(client)
  }
  assert.equal(getFileContent(roomId, fileId), 'original')
  for (const client of [first, second]) {
    assert.equal(io.sockets.sockets.get(client.id).data.role, 'viewer')
    assert.equal(getOrCreateRoom(roomId).participants.get(client.id).role, 'viewer')
  }
})

test('REST removal disconnects a member before another room broadcast', async (t) => {
  const owner = user()
  const member = user()
  const roomId = room(owner)
  db.dbAddRoomMember(member.id, roomId, 'editor')
  const client = await clientFor(t, member)
  await join(client, roomId)
  const serverSocket = io.sockets.sockets.get(client.id)
  const response = await request(owner, 'DELETE', `/auth/rooms/${roomId}/members/${member.id}`)
  assert.equal(response.statusCode, 200)
  assert.equal(serverSocket.connected, false)
  assert.equal(serverSocket.rooms.has(roomId), false)
})

test('password change disconnects revoked sessions and preserves the current session', async (t) => {
  const member = user()
  const otherSession = { id: member.id, token: createSession(member.id).token }
  const roomId = room(member)
  const currentClient = await clientFor(t, member)
  const oldClient = await clientFor(t, otherSession)
  await join(currentClient, roomId)
  await join(oldClient, roomId)
  const oldSocket = io.sockets.sockets.get(oldClient.id)
  const response = await request(member, 'PUT', '/auth/me/password', {
    currentPassword: 'old-password', newPassword: 'new-password',
  })
  assert.equal(response.statusCode, 200)
  assert.equal(oldSocket.connected, false)
  assert.equal(io.sockets.sockets.get(currentClient.id).connected, true)
  assert.equal(db.dbGetSession(otherSession.token), undefined)
  assert.ok(db.dbGetSession(member.token))
})

test('REST promotion and socket demotion keep all participants and controls in sync', async (t) => {
  const owner = user()
  const member = user()
  const roomId = room(owner)
  const fileId = file(roomId)
  db.dbAddRoomMember(member.id, roomId, 'viewer')
  const ownerClient = await clientFor(t, owner)
  const client = await clientFor(t, member)
  await join(ownerClient, roomId)
  await join(client, roomId)
  const promotion = nextEvent(client, 'role-refreshed')
  const broadcast = nextEvent(ownerClient, 'member-role-changed')
  assert.equal((await request(owner, 'PUT', `/auth/rooms/${roomId}/members/${member.id}/role`, { role: 'editor' })).statusCode, 200)
  assert.deepEqual(await promotion, { role: 'editor' })
  assert.deepEqual(await broadcast, { userId: member.id, role: 'editor' })
  const update = nextEvent(client, 'code-update')
  client.emit('code-change', { fileId, content: 'allowed' })
  await update
  const demotion = nextEvent(client, 'role-refreshed')
  ownerClient.emit('set-member-role', { userId: member.id, role: 'viewer' })
  await demotion
  client.emit('code-patch', { fileId, start: 0, deleteCount: 7, insert: 'forbidden' })
  await drain(client)
  assert.equal(getFileContent(roomId, fileId), 'allowed')
  const observer = await clientFor(t, owner)
  const state = await join(observer, roomId)
  assert.equal(state.participants.find((p) => p.id === client.id).dbRole, 'viewer')
})

test('room revocation closes all affected tabs while preserving another room', async (t) => {
  for (const action of ['kick-rest', 'kick-socket', 'leave']) {
    const owner = user()
    const member = user()
    const roomId = room(owner)
    const otherRoom = room(member)
    db.dbAddRoomMember(member.id, roomId, 'editor')
    const ownerClient = await clientFor(t, owner)
    await join(ownerClient, roomId)
    const first = await clientFor(t, member)
    const second = await clientFor(t, member)
    const other = await clientFor(t, member)
    await join(first, roomId)
    await join(second, roomId)
    await join(other, otherRoom)
    const sockets = [first, second].map((client) => io.sockets.sockets.get(client.id))
    const disconnected = [nextEvent(first, 'disconnect'), nextEvent(second, 'disconnect')]
    if (action === 'kick-rest') {
      assert.equal((await request(owner, 'DELETE', `/auth/rooms/${roomId}/members/${member.id}`)).statusCode, 200)
    } else if (action === 'leave') {
      assert.equal((await request(member, 'POST', `/auth/rooms/${roomId}/leave`)).statusCode, 200)
    } else {
      ownerClient.emit('kick-member', { userId: member.id })
      await drain(ownerClient)
    }
    await Promise.all(disconnected)
    assert.equal(db.dbGetMemberRole(member.id, roomId), null)
    for (const socket of sockets) {
      assert.equal(socket.connected, false)
      assert.equal(getOrCreateRoom(roomId).participants.has(socket.id), false)
    }
    assert.equal(io.sockets.sockets.get(other.id).connected, true)
    const renamed = nextEvent(other, 'room-renamed')
    other.emit('rename-room', { name: 'Other room still accessible' })
    await renamed
  }
})

test('logout revokes every tab of that session, including pending and idle connections', async (t) => {
  const owner = user()
  const member = user()
  const destination = room(owner)
  const ownRoom = room(member)
  const otherSession = { id: member.id, token: createSession(member.id).token }
  const ownerClient = await clientFor(t, owner)
  await join(ownerClient, destination)
  const active = await clientFor(t, member)
  const pending = await clientFor(t, member)
  const idle = await clientFor(t, member)
  const kept = await clientFor(t, otherSession)
  await join(active, ownRoom)
  await join(kept, ownRoom)
  const knocked = nextEvent(pending, 'knock-pending')
  pending.emit('join-room', { roomId: destination })
  await knocked
  const knockId = pending.id
  const revoked = [active, pending, idle].map((client) => io.sockets.sockets.get(client.id))
  const expired = [active, pending, idle].map((client) => nextEvent(client, 'session-expired'))
  assert.equal((await request(member, 'POST', '/auth/logout')).statusCode, 200)
  await Promise.all(expired)
  for (const socket of revoked) assert.equal(socket.connected, false)
  assert.equal(io.sockets.sockets.get(kept.id).connected, true)
  ownerClient.emit('approve-knock', { knockId })
  await drain(ownerClient)
  assert.equal(db.dbGetMemberRole(member.id, destination), null)
  assert.ok(db.dbGetSession(otherSession.token))
})

test('email change revokes other sessions even before they enter a room', async (t) => {
  const member = user()
  const otherSession = { id: member.id, token: createSession(member.id).token }
  const kept = await clientFor(t, member)
  const idle = await clientFor(t, otherSession)
  const revoked = io.sockets.sockets.get(idle.id)
  const response = await request(member, 'PUT', '/auth/me/email', {
    email: `${randomUUID()}@example.invalid`, currentPassword: 'old-password',
  })
  assert.equal(response.statusCode, 200)
  assert.equal(revoked.connected, false)
  assert.equal(io.sockets.sockets.get(kept.id).connected, true)
})

test('revoked and expired sessions cannot send another event on an existing socket', async (t) => {
  for (const expired of [false, true]) {
    const member = user()
    const roomId = room(member)
    const client = await clientFor(t, member)
    await join(client, roomId)
    const socket = io.sockets.sockets.get(client.id)
    if (expired) {
      db.default.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000) - 1, member.token)
    } else {
      db.dbDeleteSession(member.token)
    }
    const rejected = nextEvent(client, 'session-expired')
    client.emit('rename-room', { name: 'Not authorized' })
    await rejected
    assert.equal(db.dbGetRoom(roomId).name, 'Original room')
    assert.equal(socket.connected, false)
  }
})

test('session expiry closes an idle socket without waiting for a client event', async (t) => {
  const member = user()
  const expiresAt = Math.floor(Date.now() / 1000) + 10
  db.default.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, member.token)
  const original = global.setTimeout
  let expire
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => {
    if (delay > 8000 && delay <= 10000) expire = callback
    return original(callback, delay, ...args)
  })
  const client = await clientFor(t, member)
  const socket = io.sockets.sockets.get(client.id)
  assert.equal(typeof expire, 'function')
  // Advance only the wall clock used by session validation, then invoke the
  // captured expiry callback; no real ten-second sleep is needed.
  t.mock.method(Date, 'now', () => expiresAt * 1000)
  const rejected = nextEvent(client, 'session-expired')
  expire()
  await rejected
  assert.equal(socket.connected, false)
})

test('pruning an old session on login also disconnects its idle socket', async (t) => {
  const member = user()
  const client = await clientFor(t, member)
  const socket = io.sockets.sockets.get(client.id)
  db.default.prepare('UPDATE sessions SET created_at = 1 WHERE id = ?').run(member.token)
  for (let i = 0; i < 10; i++) createSession(member.id)
  assert.equal(db.dbGetSession(member.token), undefined)
  assert.equal(socket.connected, false)
})

test('membership changes are rechecked before commands even without a notification', async (t) => {
  const owner = user()
  const member = user()
  const roomId = room(owner)
  const fileId = file(roomId)
  db.dbAddRoomMember(member.id, roomId, 'editor')
  const client = await clientFor(t, member)
  await join(client, roomId)
  db.dbSetMemberRole(member.id, roomId, 'viewer')
  client.emit('code-change', { fileId, content: 'no longer authorized' })
  await drain(client)
  assert.equal(getFileContent(roomId, fileId), 'original')
  const socket = io.sockets.sockets.get(client.id)
  db.dbRemoveMember(member.id, roomId)
  const disconnected = nextEvent(client, 'disconnect')
  client.emit('chat-send', { content: 'revoked' })
  await disconnected
  assert.deepEqual(db.dbGetChatMessages(roomId), [])
  assert.equal(socket.connected, false)
})

test('an approved knock revalidates the session before granting access', async (t) => {
  const owner = user()
  const member = user()
  const roomId = room(owner)
  const ownerClient = await clientFor(t, owner)
  await join(ownerClient, roomId)
  const client = await clientFor(t, member)
  const pending = nextEvent(client, 'knock-pending')
  client.emit('join-room', { roomId })
  await pending
  db.dbDeleteSession(member.token)
  const rejected = nextEvent(client, 'session-expired')
  ownerClient.emit('approve-knock', { knockId: client.id })
  await rejected
  assert.equal(db.dbGetMemberRole(member.id, roomId), null)
})

test('revocation during an async password check cannot restore access', async (t) => {
  for (const action of ['logout', 'kick', 'delete-room', 'expire']) {
    const owner = user()
    const member = user()
    const roomId = room(owner)
    db.dbSetRoomPassword(roomId, bcrypt.hashSync('secret', 4))
    if (action === 'kick') db.dbAddRoomMember(member.id, roomId, 'editor')
    const client = await clientFor(t, member)
    const socket = io.sockets.sockets.get(client.id)
    const checks = deferPasswordChecks(t)
    client.emit('join-room', { roomId, password: 'secret' })
    await drain(client)
    assert.equal(checks.length, 1)
    if (action === 'logout') {
      assert.equal((await request(member, 'POST', '/auth/logout')).statusCode, 200)
    } else if (action === 'kick') {
      assert.equal((await request(owner, 'DELETE', `/auth/rooms/${roomId}/members/${member.id}`)).statusCode, 200)
    } else if (action === 'delete-room') {
      assert.equal((await request(owner, 'DELETE', `/auth/rooms/${roomId}`)).statusCode, 200)
    } else {
      db.dbDeleteSession(member.token)
    }
    checks[0](true)
    await new Promise(setImmediate)
    assert.equal(socket.connected, false)
    assert.equal(db.dbGetMemberRole(member.id, roomId), null)
    assert.equal(getOrCreateRoom(roomId).participants.has(socket.id), false)
    bcrypt.compare.mock.restore()
  }
})

test('deleting a room closes admitted and pending connections, including guests', async (t) => {
  const owner = user()
  const member = user()
  const roomId = room(owner)
  db.dbAddRoomMember(member.id, roomId, 'viewer')
  const ownerClient = await clientFor(t, owner)
  const memberClient = await clientFor(t, member)
  const guest = await clientFor(t)
  await join(ownerClient, roomId)
  await join(memberClient, roomId)
  const pending = nextEvent(guest, 'knock-pending')
  guest.emit('join-room', { roomId })
  await pending
  const sockets = [ownerClient, memberClient, guest].map((client) => io.sockets.sockets.get(client.id))
  const deleted = [ownerClient, memberClient, guest].map((client) => nextEvent(client, 'room-deleted'))
  assert.equal((await request(owner, 'DELETE', `/auth/rooms/${roomId}`)).statusCode, 200)
  await Promise.all(deleted)
  for (const socket of sockets) {
    assert.equal(socket.connected, false)
    assert.equal(socket.data.admitted, false)
  }
  assert.equal(db.dbRoomExists(roomId), false)
})

test('account deletion revokes every session, including sockets not yet admitted', async (t) => {
  const member = user()
  const otherSession = { id: member.id, token: createSession(member.id).token }
  const roomId = room(member)
  const active = await clientFor(t, member)
  const idle = await clientFor(t, otherSession)
  await join(active, roomId)
  const sockets = [active, idle].map((client) => io.sockets.sockets.get(client.id))
  assert.equal((await request(member, 'DELETE', '/auth/me', { password: 'old-password' })).statusCode, 200)
  for (const socket of sockets) assert.equal(socket.connected, false)
  assert.equal(db.dbGetUserById(member.id), undefined)
  assert.equal(db.dbRoomExists(roomId), false)
})
