const assert = require('node:assert/strict')
const { test, after } = require('node:test')
const { randomUUID } = require('node:crypto')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const cwd = process.cwd()
const dir = mkdtempSync(path.join(tmpdir(), 'coderoom-persistence-'))
process.chdir(dir)
process.env.LOG_LEVEL = 'error'
const db = require('../src/db')
const rooms = require('../src/rooms')
after(() => {
  rooms.flushAllRoomContent()
  db.default.close()
  process.chdir(cwd)
  rmSync(dir, { recursive: true, force: true })
})
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const room = randomUUID()
  db.dbCreateRoom(room)
  const file = rooms.createFile(room, null, 'main.js', 'file', 'initial').id
  t.after(() => rooms.removeRoom(room))
  return { room, file, content: () => db.dbGetFiles(room).find(row => row.id === file)?.content }
}

test('continuous edits persist by five seconds and start a fresh bounded window', t => {
  const f = fixture(t)
  for (let window = 0; window < 2; window++) {
    for (let i = 0; i < 50; i++) {
      rooms.updateFileContent(f.room, f.file, `${window}:${i}`)
      t.mock.timers.tick(100)
    }
    assert.equal(f.content(), `${window}:49`)
  }
})

test('idle save writes the latest content after 750 ms', t => {
  const f = fixture(t)
  rooms.updateFileContent(f.room, f.file, 'first')
  t.mock.timers.tick(500)
  rooms.applyFilePatch(f.room, f.file, 0, 5, 'latest')
  t.mock.timers.tick(749)
  assert.equal(f.content(), 'initial')
  t.mock.timers.tick(1)
  assert.equal(f.content(), 'latest')
})

test('leaving the room and shutdown flush pending changes immediately', t => {
  const f = fixture(t)
  rooms.addParticipant(f.room, 'socket', 'User')
  rooms.updateFileContent(f.room, f.file, 'on-leave')
  rooms.removeParticipant(f.room, 'socket')
  assert.equal(f.content(), 'on-leave')
  rooms.updateFileContent(f.room, f.file, 'shutdown')
  rooms.flushAllRoomContent()
  assert.equal(f.content(), 'shutdown')
  t.mock.timers.tick(5000)
  assert.equal(f.content(), 'shutdown')
})

test('failed scheduled save retains latest content and retries without crashing', t => {
  const f = fixture(t)
  db.default.exec(`CREATE TEMP TRIGGER fail_save BEFORE UPDATE OF content ON files
    BEGIN SELECT RAISE(ABORT, 'test storage failure'); END`)
  try {
    rooms.updateFileContent(f.room, f.file, 'unsaved')
    assert.doesNotThrow(() => t.mock.timers.tick(750))
    assert.equal(f.content(), 'initial')
  } finally {
    db.default.exec('DROP TRIGGER fail_save')
  }
  rooms.updateFileContent(f.room, f.file, 'latest-after-failure')
  t.mock.timers.tick(750)
  assert.equal(f.content(), 'latest-after-failure')
})

test('failed explicit flush retains data for a later retry', t => {
  const f = fixture(t)
  rooms.updateFileContent(f.room, f.file, 'recoverable')
  db.default.exec(`CREATE TEMP TRIGGER fail_explicit_save BEFORE UPDATE OF content ON files
    BEGIN SELECT RAISE(ABORT, 'test explicit failure'); END`)
  try {
    assert.throws(() => rooms.flushAllRoomContent(), /test explicit failure/)
  } finally {
    db.default.exec('DROP TRIGGER fail_explicit_save')
  }
  t.mock.timers.tick(750)
  assert.equal(f.content(), 'recoverable')
})

test('deleting a dirty file cancels both scheduled saves', t => {
  const f = fixture(t)
  rooms.updateFileContent(f.room, f.file, 'deleted')
  assert.equal(rooms.deleteFile(f.room, f.file), true)
  db.default.exec(`CREATE TEMP TRIGGER detect_stale_save BEFORE UPDATE ON files
    BEGIN SELECT RAISE(ABORT, 'unexpected write'); END`)
  try { t.mock.timers.tick(5000); rooms.flushAllRoomContent() }
  finally { db.default.exec('DROP TRIGGER detect_stale_save') }
  assert.equal(f.content(), undefined)
})
