const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { createServer } = require('node:http')
const { before, after, test } = require('node:test')
const { Server } = require('socket.io')
const { io: connectClient } = require('socket.io-client')
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const originalCwd = process.cwd()
const directory = mkdtempSync(path.join(tmpdir(), 'coderoom-collaboration-'))
process.chdir(directory)
process.env.LOG_LEVEL = 'error'
const db = require('../src/db')
const rooms = require('../src/rooms')
const { createSession, SESSION_COOKIE_NAME } = require('../src/auth')
const { registerSocketHandlers } = require('../src/socket')
const { FileSync } = require('../../frontend/lib/fileSync')
const server = createServer(), io = new Server(server)
let address
before(async () => {
  registerSocketHandlers(io)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  address = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise(resolve => io.close(resolve))
  rooms.flushAllRoomContent(); db.default.close()
  process.chdir(originalCwd)
  rmSync(directory, { recursive: true, force: true })
})
function event(client, name) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Missing ${name}`)), 3000)
    client.once(name, data => { clearTimeout(timer); resolve(data) })
  })
}
async function fixture(t) {
  const owner = randomUUID(), roomId = randomUUID()
  db.dbCreateUser(owner, 'Owner', `${owner}@example.com`, 'unused', 1)
  db.dbCreateRoomWithOwner(roomId, owner)
  const fileId = rooms.createFile(roomId, null, 'code.txt', 'file', 'abcd').id
  const clients = [], states = []
  for (let i = 0; i < 2; i++) {
    const client = connectClient(address, { autoConnect: false, reconnection: false, transports: ['websocket'],
      extraHeaders: { Cookie: `${SESSION_COOKIE_NAME}=${createSession(owner).token}` } })
    t.after(() => client.disconnect())
    const connected = event(client, 'connect'); client.connect(); await connected
    const joined = event(client, 'room-state')
    client.emit('join-room', { roomId, userName: 'Owner' })
    states.push((await joined).files.find(file => file.id === fileId))
    clients.push(client)
  }
  return { roomId, fileId, clients, states }
}
const edit = (client, event, payload) => client.timeout(3000).emitWithAck(event, payload)

test('real sockets reject stale patches and full replacements without altering content', async t => {
  const { roomId, fileId, clients: [a, b], states } = await fixture(t)
  const baseRevision = states[0].revision
  assert.equal(baseRevision, states[1].revision)
  const first = await edit(a, 'code-patch', { fileId, baseRevision, start: 0, deleteCount: 0, insert: 'X' })
  assert.equal(first.status, 'ok')
  const stale = await edit(b, 'code-patch', { fileId, baseRevision, start: 2, deleteCount: 1, insert: 'C' })
  assert.equal(stale.status, 'conflict')
  assert.equal(stale.content, 'Xabcd')
  assert.equal((await edit(b, 'code-change', { fileId, baseRevision, content: 'abCd' })).status, 'conflict')
  assert.equal(rooms.getFileContent(roomId, fileId), 'Xabcd')
  const merged = await edit(b, 'code-patch', { fileId, baseRevision: stale.revision, start: 3, deleteCount: 1, insert: 'C' })
  assert.equal(merged.content, 'XabCd')
  assert.notEqual(merged.revision, first.revision)
  // Replaying an accepted write cannot apply its positional edit twice.
  assert.equal((await edit(b, 'code-patch', { fileId, baseRevision: stale.revision, start: 3, deleteCount: 1, insert: 'C' })).status, 'conflict')
  rooms.flushAllRoomContent()
  assert.equal(db.dbGetFiles(roomId).find(file => file.id === fileId).content, 'XabCd')
})

test('missing revisions, invalid ranges, foreign files and deleted files cannot be edited', async t => {
  const { roomId, fileId, clients: [a], states } = await fixture(t)
  const baseRevision = states[0].revision
  assert.equal((await edit(a, 'code-change', { fileId, content: 'overwrite' })).status, 'error')
  assert.equal((await edit(a, 'code-patch', { fileId, baseRevision, start: 5, deleteCount: 0, insert: 'x' })).status, 'error')
  const otherRoom = randomUUID(); db.dbCreateRoom(otherRoom)
  const other = rooms.createFile(otherRoom, null, 'other.txt', 'file', 'private')
  assert.equal((await edit(a, 'code-change', { fileId: other.id, baseRevision: other.revision, content: 'overwrite' })).status, 'error')
  assert.equal((await edit(a, 'get-file-state', { fileId: other.id })).status, 'error')
  assert.equal(rooms.getFileSnapshot(roomId, fileId).revision, baseRevision)
  rooms.deleteFile(roomId, fileId)
  assert.equal((await edit(a, 'code-change', { fileId, baseRevision, content: 'resurrect' })).status, 'error')
})

test('the real frontend synchronizer converges two clients through the actual socket handlers', async t => {
  const { roomId, fileId, clients, states } = await fixture(t)
  const engines = clients.map((client, i) => {
    const sync = new FileSync((id, baseRevision, patch, done) => {
      edit(client, 'code-patch', { fileId: id, baseRevision, ...patch }).then(done)
    }, () => {})
    sync.connect([{ fileId, content: states[i].content, revision: states[i].revision }])
    client.on('code-update', value => { sync.receive(value); sync.flush() })
    return sync
  })
  engines[0].edit(fileId, 'Xabcd'); engines[1].edit(fileId, 'abCd')
  engines.forEach(engine => engine.flush())
  for (let tries = 0; tries < 100; tries++) {
    if (engines.every(engine => !engine.hasPending() && engine.view(fileId).text === 'XabCd')) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(rooms.getFileContent(roomId, fileId), 'XabCd')
  for (const engine of engines) {
    assert.equal(engine.view(fileId).text, 'XabCd')
    assert.equal(engine.hasPending(), false)
  }
})

test('room cache reload starts a new revision epoch so old edits cannot match by accident', () => {
  const roomId = randomUUID(); db.dbCreateRoom(roomId)
  const file = rooms.createFile(roomId, null, 'file.txt', 'file', 'same text')
  rooms.removeRoom(roomId)
  const current = rooms.getFileSnapshot(roomId, file.id)
  assert.notEqual(current.revision, file.revision)
  assert.equal(rooms.editFileAtRevision(roomId, file.id, file.revision, { content: 'old client' }).status, 'conflict')
})
