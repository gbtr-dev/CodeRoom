const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, readdirSync, unlinkSync, rmdirSync } = require('node:fs')
const { createServer } = require('node:http')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { before, after, test } = require('node:test')
const bcrypt = require('bcryptjs')
const { Server } = require('socket.io')
const { io: connectClient } = require('socket.io-client')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')

// db.ts resolves SQLite relative to cwd. Set an isolated directory before
// importing application modules; the real database and .env are never loaded.
const originalCwd = process.cwd()
const testDirectory = mkdtempSync(path.join(tmpdir(), 'coderoom-room-access-'))
process.chdir(testDirectory)
process.env.LOG_LEVEL = 'error'
delete process.env.DOCKER_HOST

const db = require('../src/db')
const { createSession, SESSION_COOKIE_NAME } = require('../src/auth')
const { registerSocketHandlers, notifyUserLeftRoom } = require('../src/socket')
const { flushAllRoomContent, getOrCreateRoom } = require('../src/rooms')

const httpServer = createServer()
const io = new Server(httpServer)
const clients = new Set()
let address

before(async () => {
  registerSocketHandlers(io)
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
  address = `http://127.0.0.1:${httpServer.address().port}`
})

after(async () => {
  for (const client of clients) client.disconnect()
  await new Promise((resolve) => io.close(resolve))
  flushAllRoomContent()
  db.default.close()
  process.chdir(originalCwd)
  // Only remove the database files created inside this suite's fresh directory.
  for (const file of readdirSync(testDirectory)) unlinkSync(path.join(testDirectory, file))
  rmdirSync(testDirectory)
})

function user() {
  const id = randomUUID()
  db.dbCreateUser(id, 'Test user', `${id}@example.invalid`, 'unused-in-session-tests')
  return id
}

function room(ownerId) {
  const id = randomUUID()
  db.dbCreateRoomWithOwner(id, ownerId, 'Original room')
  return id
}

function nextEvent(client, events) {
  return new Promise((resolve, reject) => {
    const handlers = new Map()
    const cleanup = () => {
      clearTimeout(timer)
      for (const [event, handler] of handlers) client.off(event, handler)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${events.join(', ')}`))
    }, 3000)
    for (const event of events) {
      const handler = (data) => { cleanup(); resolve({ event, data }) }
      handlers.set(event, handler)
      client.once(event, handler)
    }
  })
}

async function clientFor(t, userId) {
  const token = userId ? createSession(userId).token : null
  const client = connectClient(address, {
    autoConnect: false,
    reconnection: false,
    transports: ['websocket'],
    extraHeaders: token ? { Cookie: `${SESSION_COOKIE_NAME}=${token}` } : {},
  })
  clients.add(client)
  t.after(() => { client.disconnect(); clients.delete(client) })
  const connected = nextEvent(client, ['connect', 'connect_error'])
  client.connect()
  assert.equal((await connected).event, 'connect')
  return client
}

async function join(client, roomId, extra = {}) {
  const response = nextEvent(client, [
    'room-state', 'room-password-required', 'room-wrong-password',
    'knock-pending', 'knock-denied', 'error', 'server-error', 'room-not-found', 'login-required',
  ])
  client.emit('join-room', { roomId, userName: 'Test user', ...extra })
  return response
}

// An acknowledgement on the same connection is a barrier for preceding
// synchronous handlers, including handlers that deliberately return no reply.
async function drain(client) {
  io.sockets.sockets.get(client.id).once('test-barrier', (ack) => ack())
  await client.timeout(3000).emitWithAck('test-barrier')
}

function deferPasswordChecks(t) {
  const pending = []
  t.mock.method(bcrypt, 'compare', () => new Promise((resolve) => pending.push(resolve)))
  return pending
}

function captureKnockTimers(t) {
  const timers = []
  const original = global.setTimeout
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 60_000 || (delay >= 1000 && delay < 3000)) timers.push(callback)
    return original(callback, delay, ...args)
  })
  return timers
}

test('creating a new room atomically creates its owner', () => {
  const creator = user()
  const roomId = randomUUID()
  assert.equal(db.dbCreateRoomWithOwner(roomId, creator, 'New room'), true)
  assert.equal(db.dbGetRoom(roomId).created_by, creator)
  assert.equal(db.dbGetMemberRole(creator, roomId), 'owner')
})

test('a duplicate creation cannot add an owner or alter the existing room', () => {
  const owner = user()
  const outsider = user()
  const roomId = room(owner)
  db.dbSetRoomPassword(roomId, 'existing-password-hash')
  const before = db.dbGetRoom(roomId)
  assert.equal(db.dbCreateRoomWithOwner(roomId, outsider, 'Replacement name'), false)
  assert.equal(db.dbGetMemberRole(outsider, roomId), null)
  assert.deepEqual(db.dbGetRoom(roomId), before)
  assert.deepEqual(db.dbGetRoomMembers(roomId).map((member) => member.id), [owner])
})

test('a duplicate creation preserves an existing member role', () => {
  const roomId = room(user())
  for (const role of ['viewer', 'editor', 'owner']) {
    const member = user()
    db.dbAddRoomMember(member, roomId, role)
    assert.equal(db.dbCreateRoomWithOwner(roomId, member), false)
    assert.equal(db.dbGetMemberRole(member, roomId), role)
  }
})

test('a failed owner insertion rolls back the room creation', () => {
  const roomId = randomUUID()
  assert.throws(() => db.dbCreateRoomWithOwner(roomId, 'missing-user'), /FOREIGN KEY/)
  assert.equal(db.dbRoomExists(roomId), false)
})

test('an authenticated creator receives ownership over a new socket room', async (t) => {
  const creator = user()
  const client = await clientFor(t, creator)
  const roomId = randomUUID()
  const { event, data } = await join(client, roomId, { isNew: true, roomName: 'New room' })
  assert.equal(event, 'room-state')
  assert.equal(data.role, 'owner')
  assert.equal(data.roomName, 'New room')
  assert.equal(data.hasPassword, false)
  assert.equal(db.dbGetMemberRole(creator, roomId), 'owner')
})

test('an anonymous connection cannot create a room', async (t) => {
  const client = await clientFor(t)
  const roomId = randomUUID()
  const { event } = await join(client, roomId, { isNew: true })
  assert.equal(event, 'error')
  assert.equal(db.dbRoomExists(roomId), false)
})

test('isNew cannot bypass the password or expose the existing room', async (t) => {
  const owner = user()
  const outsider = user()
  const roomId = room(owner)
  db.dbSetRoomPassword(roomId, bcrypt.hashSync('room-password', 4))
  const client = await clientFor(t, outsider)
  const { event } = await join(client, roomId, { isNew: true, roomName: 'Replacement name' })
  assert.equal(event, 'room-password-required')
  assert.equal(db.dbGetMemberRole(outsider, roomId), null)
  assert.equal(db.dbGetRoom(roomId).name, 'Original room')
  assert.equal(io.sockets.sockets.get(client.id).rooms.has(roomId), false)
  assert.equal(getOrCreateRoom(roomId).participants.has(client.id), false)
  assert.equal((await join(client, roomId, { isNew: true, password: 'wrong' })).event, 'room-wrong-password')
  assert.equal(db.dbGetMemberRole(outsider, roomId), null)
  const admitted = await join(client, roomId, { isNew: true, password: 'room-password' })
  assert.equal(admitted.event, 'room-state')
  assert.equal(admitted.data.role, 'viewer')
  assert.equal(db.dbGetMemberRole(outsider, roomId), 'viewer')
})

test('isNew still requires owner approval for an unknown visitor', async (t) => {
  const owner = user()
  const visitor = user()
  const roomId = room(owner)
  const ownerClient = await clientFor(t, owner)
  assert.equal((await join(ownerClient, roomId)).event, 'room-state')
  const visitorClient = await clientFor(t, visitor)
  const knock = nextEvent(ownerClient, ['knock'])
  const [response, { data }] = await Promise.all([
    join(visitorClient, roomId, { isNew: true }),
    knock,
  ])
  assert.equal(response.event, 'knock-pending')
  assert.equal(db.dbGetMemberRole(visitor, roomId), null)
  const admitted = nextEvent(visitorClient, ['room-state'])
  ownerClient.emit('approve-knock', { knockId: data.knockId })
  assert.equal((await admitted).data.role, 'viewer')
  assert.equal(db.dbGetMemberRole(visitor, roomId), 'viewer')
})

test('isNew cannot upgrade an existing viewer or editor on their socket', async (t) => {
  for (const role of ['viewer', 'editor']) {
    const roomId = room(user())
    const member = user()
    db.dbAddRoomMember(member, roomId, role)
    const client = await clientFor(t, member)
    const { event, data } = await join(client, roomId, { isNew: true })
    assert.equal(event, 'room-state')
    assert.equal(data.role, role)
    assert.equal(io.sockets.sockets.get(client.id).data.role, role)
    assert.equal(db.dbGetMemberRole(member, roomId), role)
  }
})

test('the actual owner can retry creation as a normal rejoin', async (t) => {
  const owner = user()
  const roomId = room(owner)
  db.dbSetRoomPassword(roomId, bcrypt.hashSync('room-password', 4))
  const first = await clientFor(t, owner)
  await join(first, roomId)
  const second = await clientFor(t, owner)
  const { event, data } = await join(second, roomId, { isNew: true, roomName: 'Replacement name' })
  assert.equal(event, 'room-state')
  assert.equal(data.role, 'owner')
  assert.equal(data.hasPassword, true)
  assert.equal(data.roomName, 'Original room')
  assert.ok(data.participants.some((participant) => participant.id === first.id))
})

test('two concurrent creation requests can produce only one owner', async (t) => {
  const firstUser = user()
  const secondUser = user()
  const first = await clientFor(t, firstUser)
  const second = await clientFor(t, secondUser)
  const roomId = randomUUID()
  const results = await Promise.all([
    join(first, roomId, { isNew: true }),
    join(second, roomId, { isNew: true }),
  ])
  assert.deepEqual(results.map((result) => result.event).sort(), ['knock-pending', 'room-state'])
  const members = db.dbGetRoomMembers(roomId)
  assert.equal(members.length, 1)
  assert.equal(members[0].role, 'owner')
  assert.equal(db.dbGetRoom(roomId).created_by, members[0].id)
})

test('a rejected room switch cannot reuse ownership to rename the destination', async (t) => {
  const member = user()
  const source = room(member)
  const destination = room(user())
  db.dbSetRoomPassword(destination, bcrypt.hashSync('secret', 4))
  const client = await clientFor(t, member)
  await join(client, source)
  assert.equal((await join(client, destination)).event, 'room-password-required')

  client.emit('rename-room', { name: 'Unauthorized rename' })
  client.emit('chat-send', { content: 'Unauthorized message' })
  await drain(client)
  assert.equal(db.dbGetRoom(destination).name, 'Original room')
  assert.deepEqual(db.dbGetChatMessages(destination), [])
  assert.equal(db.dbGetMemberRole(member, destination), null)
  const serverSocket = io.sockets.sockets.get(client.id)
  assert.equal(serverSocket.data.admitted, false)
  assert.equal(serverSocket.data.role, 'viewer')
  assert.deepEqual([...serverSocket.rooms], [client.id])
  assert.equal(getOrCreateRoom(source).participants.has(client.id), false)
})

test('a successful room switch leaves old broadcasts and user socket tracking', async (t) => {
  const member = user()
  const source = room(member)
  const destination = room(user())
  db.dbAddRoomMember(member, destination, 'viewer')
  const client = await clientFor(t, member)
  const observer = await clientFor(t, member)
  await join(client, source)
  await join(observer, source)
  const left = []
  observer.on('participant-left', (data) => left.push(data.id))

  const response = await join(client, destination)
  assert.equal(response.event, 'room-state')
  assert.equal(response.data.role, 'viewer')
  await drain(observer)
  assert.deepEqual(left, [client.id])
  const serverSocket = io.sockets.sockets.get(client.id)
  assert.equal(serverSocket.rooms.has(source), false)
  assert.equal(serverSocket.rooms.has(destination), true)
  assert.equal(getOrCreateRoom(source).participants.has(client.id), false)
  assert.equal(getOrCreateRoom(destination).participants.has(client.id), true)

  notifyUserLeftRoom(source, member)
  assert.equal(serverSocket.connected, true)
  client.emit('rename-room', { name: 'Still owner?' })
  await drain(client)
  assert.equal(db.dbGetRoom(destination).name, 'Original room')
  const socketId = client.id
  const disconnected = new Promise((resolve) => serverSocket.once('disconnect', resolve))
  client.disconnect()
  await disconnected
  assert.equal(getOrCreateRoom(destination).participants.has(socketId), false)
})

test('wrong passwords and missing rooms also revoke the previous admission', async (t) => {
  for (const rejection of ['room-wrong-password', 'room-not-found']) {
    const member = user()
    const source = room(member)
    const destination = rejection === 'room-not-found' ? randomUUID() : room(user())
    if (rejection === 'room-wrong-password') {
      db.dbSetRoomPassword(destination, bcrypt.hashSync('secret', 4))
      db.dbAddRoomMember(member, destination, 'editor')
    }
    const client = await clientFor(t, member)
    await join(client, source)
    assert.equal((await join(client, destination, { password: 'wrong' })).event, rejection)
    client.emit('chat-send', { content: 'Cannot write without admission' })
    await drain(client)
    assert.equal(io.sockets.sockets.get(client.id).data.admitted, false)
    assert.deepEqual([...io.sockets.sockets.get(client.id).rooms], [client.id])
    assert.deepEqual(db.dbGetChatMessages(source), [])
    assert.deepEqual(db.dbGetChatMessages(destination), [])
  }
})

test('a pending visitor cannot approve or deny others with ownership from another room', async (t) => {
  const member = user()
  const source = room(member)
  const owner = user()
  const destination = room(owner)
  const ownerClient = await clientFor(t, owner)
  await join(ownerClient, destination)
  const visitor = user()
  const visitorClient = await clientFor(t, visitor)
  assert.equal((await join(visitorClient, destination)).event, 'knock-pending')
  const client = await clientFor(t, member)
  await join(client, source)
  assert.equal((await join(client, destination)).event, 'knock-pending')
  const responses = []
  visitorClient.on('room-state', () => responses.push('admitted'))
  visitorClient.on('knock-denied', () => responses.push('denied'))
  client.emit('approve-knock', { knockId: visitorClient.id })
  client.emit('deny-knock', { knockId: visitorClient.id })
  await drain(client)
  await drain(visitorClient)
  assert.deepEqual(responses, [])
  assert.equal(db.dbGetMemberRole(visitor, destination), null)

  const admitted = nextEvent(visitorClient, ['room-state'])
  ownerClient.emit('approve-knock', { knockId: visitorClient.id })
  assert.equal((await admitted).data.role, 'viewer')
})

test('switching rooms cancels a pending knock and ignores late owner approval', async (t) => {
  const owner = user()
  const source = room(owner)
  const ownerClient = await clientFor(t, owner)
  await join(ownerClient, source)
  const member = user()
  const destination = room(member)
  const client = await clientFor(t, member)
  assert.equal((await join(client, source)).event, 'knock-pending')
  assert.equal((await join(client, destination)).data.role, 'owner')
  ownerClient.emit('approve-knock', { knockId: client.id })
  await drain(ownerClient)
  assert.equal(db.dbGetMemberRole(member, source), null)
  assert.equal(getOrCreateRoom(source).participants.has(client.id), false)
  assert.deepEqual([...io.sockets.sockets.get(client.id).rooms], [client.id, destination])

  const message = nextEvent(client, ['chat-message'])
  client.emit('chat-send', { content: 'Only the destination' })
  await message
  assert.deepEqual(db.dbGetChatMessages(source), [])
  assert.equal(db.dbGetChatMessages(destination)[0].content, 'Only the destination')
})

test('anonymous knock approval commits the requesting socket to the correct room', async (t) => {
  const owner = user()
  const destination = room(owner)
  const ownerClient = await clientFor(t, owner)
  await join(ownerClient, destination)
  const client = await clientFor(t)
  assert.equal((await join(client, destination)).event, 'knock-pending')
  const admitted = nextEvent(client, ['room-state'])
  ownerClient.emit('approve-knock', { knockId: client.id })
  assert.equal((await admitted).data.role, 'viewer')
  assert.equal(io.sockets.sockets.get(client.id).data.role, 'viewer')
  const message = nextEvent(ownerClient, ['chat-message'])
  client.emit('chat-send', { content: 'Approved guest' })
  const { data } = await message
  assert.equal(data.room_id, destination)
  assert.equal(data.user_id, null)
  assert.equal(data.content, 'Approved guest')
})

test('a stale knock timer cannot cancel a newer request', async (t) => {
  for (const previousOwnerOnline of [false, true]) {
    const owner = user()
    const source = room(owner)
    const destination = room(owner)
    const ownerClient = await clientFor(t, owner)
    await join(ownerClient, destination)
    if (previousOwnerOnline) {
      const sourceOwner = await clientFor(t, owner)
      await join(sourceOwner, source)
    }
    const client = await clientFor(t, user())
    const timers = captureKnockTimers(t)
    client.emit('join-room', { roomId: source, userName: 'Visitor' })
    await drain(client)
    assert.equal(timers.length, previousOwnerOnline ? 1 : 2)
    const staleTimers = [...timers]
    const denied = []
    client.on('knock-denied', () => denied.push(true))
    assert.equal((await join(client, destination)).event, 'knock-pending')
    for (const expire of staleTimers) expire()
    await drain(client)
    assert.deepEqual(denied, [])
    const admitted = nextEvent(client, ['room-state'])
    ownerClient.emit('approve-knock', { knockId: client.id })
    assert.equal((await admitted).data.role, 'viewer')
    global.setTimeout.mock.restore()
  }
})

test('a valid password result cannot admit a superseded room request', async (t) => {
  // Cover both password paths: an existing member and an unknown visitor.
  for (const existingMember of [false, true]) {
    const member = user()
    const source = room(user())
    db.dbSetRoomPassword(source, bcrypt.hashSync('secret', 4))
    if (existingMember) db.dbAddRoomMember(member, source, 'editor')
    const destination = room(member)
    const client = await clientFor(t, member)
    const checks = deferPasswordChecks(t)
    client.emit('join-room', { roomId: source, password: 'secret' })
    await drain(client)
    assert.equal(checks.length, 1)
    assert.equal((await join(client, destination)).data.role, 'owner')
    const lateStates = []
    client.on('room-state', (data) => lateStates.push(data))
    checks[0](true)
    await drain(client)
    assert.deepEqual(lateStates, [])
    assert.deepEqual([...io.sockets.sockets.get(client.id).rooms], [client.id, destination])
    assert.equal(getOrCreateRoom(source).participants.has(client.id), false)
    assert.equal(db.dbGetMemberRole(member, source), existingMember ? 'editor' : null)
    const renamed = nextEvent(client, ['room-renamed'])
    client.emit('rename-room', { name: 'Destination only' })
    await renamed
    assert.equal(db.dbGetRoom(source).name, 'Original room')
    assert.equal(db.dbGetRoom(destination).name, 'Destination only')
    bcrypt.compare.mock.restore()
  }
})

test('only the latest password attempt can complete, even for the same room', async (t) => {
  const member = user()
  const destination = room(user())
  db.dbSetRoomPassword(destination, bcrypt.hashSync('secret', 4))
  const client = await clientFor(t, member)
  const checks = deferPasswordChecks(t)
  client.emit('join-room', { roomId: destination, password: 'wrong' })
  client.emit('join-room', { roomId: destination, password: 'secret' })
  await drain(client)
  assert.equal(checks.length, 2)
  const admitted = nextEvent(client, ['room-state'])
  checks[1](true)
  assert.equal((await admitted).data.role, 'viewer')
  const errors = []
  client.on('room-wrong-password', () => errors.push(true))
  checks[0](false)
  await drain(client)
  assert.deepEqual(errors, [])
  assert.equal(io.sockets.sockets.get(client.id).data.admitted, true)
})

test('disconnecting during a password check cannot recreate a participant or membership', async (t) => {
  const member = user()
  const destination = room(user())
  db.dbSetRoomPassword(destination, bcrypt.hashSync('secret', 4))
  const client = await clientFor(t, member)
  const serverSocket = io.sockets.sockets.get(client.id)
  const socketId = client.id
  const checks = deferPasswordChecks(t)
  client.emit('join-room', { roomId: destination, password: 'secret' })
  await drain(client)
  assert.equal(checks.length, 1)
  const disconnected = new Promise((resolve) => serverSocket.once('disconnect', resolve))
  client.disconnect()
  await disconnected
  checks[0](true)
  await new Promise(setImmediate)
  assert.equal(db.dbGetMemberRole(member, destination), null)
  assert.equal(getOrCreateRoom(destination).participants.has(socketId), false)
  assert.equal(serverSocket.data.admitted, false)
})

test('the last owner leaving a room denies its pending knocks', async (t) => {
  const owner = user()
  const source = room(owner)
  const destination = room(owner)
  const ownerClient = await clientFor(t, owner)
  await join(ownerClient, source)
  const visitor = user()
  const visitorClient = await clientFor(t, visitor)
  assert.equal((await join(visitorClient, source)).event, 'knock-pending')
  const denied = nextEvent(visitorClient, ['knock-denied'])
  await join(ownerClient, destination)
  await denied
  await join(ownerClient, source)
  ownerClient.emit('approve-knock', { knockId: visitorClient.id })
  await drain(ownerClient)
  assert.equal(db.dbGetMemberRole(visitor, source), null)
  assert.equal(io.sockets.sockets.get(visitorClient.id).data.admitted, false)
})

test('a fresh join cannot inherit the identity of an expired session', async (t) => {
  const owner = user()
  const source = room(owner)
  const destination = room(owner)
  db.dbSetRoomPassword(destination, bcrypt.hashSync('secret', 4))
  const client = await clientFor(t, owner)
  await join(client, source)
  const serverSocket = io.sockets.sockets.get(client.id)
  db.dbDeleteSessionsByUser(owner)
  const expired = nextEvent(client, ['session-expired'])
  const disconnected = nextEvent(client, ['disconnect'])
  client.emit('join-room', { roomId: destination })
  await Promise.all([expired, disconnected])
  assert.equal(serverSocket.connected, false)
  assert.equal(serverSocket.data.admitted, false)
  assert.equal(serverSocket.rooms.size, 0)
})
