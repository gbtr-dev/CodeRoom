const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(name) {
  const source = fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8')
  const exports = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: name => load(name.replace('./', '')) })
  return exports
}
const { FileSync } = load('fileSync')
const snapshot = (content, revision = 'v1', fileId = 'f') => ({ fileId, content, revision })
function fixture(content = 'abcd') {
  const writes = [], views = []
  const sync = new FileSync((fileId, revision, patch, done) => writes.push({ fileId, revision, patch, done }),
    (id, view) => views.push({ id, ...view }))
  sync.connect([snapshot(content)])
  return { sync, writes, views }
}
const ok = (write, content, revision) => write.done({ status: 'ok', ...snapshot(content, revision, write.fileId) })

test('concurrent disjoint edits rebase on the rejected revision and converge', () => {
  const { sync, writes } = fixture()
  sync.edit('f', 'abCd'); sync.flush()
  sync.receive(snapshot('Xabcd', 'v2')) // remote arrives while our write is in flight
  writes[0].done({ status: 'conflict', ...snapshot('Xabcd', 'v2') })
  assert.equal(sync.view('f').text, 'XabCd')
  assert.equal(writes[1].revision, 'v2')
  assert.equal(writes[1].patch.start, 3)
  ok(writes[1], 'XabCd', 'v3')
  assert.equal(sync.view('f').pending, false)
})

test('only one write per file is in flight and typing after send is preserved', () => {
  const { sync, writes } = fixture()
  sync.edit('f', 'abcde'); sync.flush()
  sync.edit('f', 'abcdef'); sync.flush()
  assert.equal(writes.length, 1)
  ok(writes[0], 'abcde', 'v2')
  assert.equal(writes.length, 2)
  assert.equal(writes[1].patch.start, 5)
  assert.equal(writes[1].patch.insert, 'f')
  ok(writes[1], 'abcdef', 'v3')
  assert.equal(sync.view('f').text, 'abcdef')
  assert.equal(sync.hasPending(), false)
})

test('overlapping edits retain the local draft and block automatic overwrite', () => {
  const { sync, writes } = fixture()
  sync.edit('f', 'aXd'); sync.flush()
  writes[0].done({ status: 'conflict', ...snapshot('aYd', 'v2') })
  assert.equal(sync.view('f').text, 'aXd')
  assert.equal(sync.view('f').conflict, true)
  sync.flush()
  assert.equal(writes.length, 1)
  sync.receive(snapshot('aZd', 'v3'))
  assert.equal(sync.view('f').text, 'aXd')
  sync.useShared('f')
  assert.equal(sync.view('f').text, 'aZd')
  assert.equal(sync.hasPending(), false)
})

test('a lost acknowledgement followed by reconnect does not duplicate an insertion', () => {
  const { sync, writes } = fixture()
  sync.edit('f', 'Xabcd'); sync.flush()
  sync.disconnect()
  sync.connect([snapshot('Xabcd', 'new-epoch')])
  ok(writes[0], 'Xabcd', 'obsolete-revision')
  assert.equal(writes.length, 1)
  assert.equal(sync.view('f').text, 'Xabcd')
  assert.equal(sync.hasPending(), false)
  sync.edit('f', 'XYabcd'); sync.flush()
  assert.equal(writes[1].revision, 'new-epoch')
})

test('offline edits rebase against fresh content before reconnect sends them', () => {
  const { sync, writes } = fixture()
  sync.disconnect(); sync.edit('f', 'abCd'); sync.flush()
  assert.equal(writes.length, 0)
  sync.connect([snapshot('Xabcd', 'v2')])
  assert.equal(writes.length, 1)
  assert.equal(writes[0].revision, 'v2')
  assert.equal(sync.view('f').text, 'XabCd')
})

for (const interruption of ['disconnect', 'timeout']) {
  test(`typing after an unacknowledged write is not duplicated after ${interruption}`, () => {
    const { sync, writes } = fixture()
    sync.edit('f', 'Xabcd'); sync.flush()
    sync.edit('f', 'XYabcd')
    if (interruption === 'disconnect') {
      sync.disconnect(); sync.connect([snapshot('Xabcd', 'v2')])
    } else {
      writes[0].done({ status: 'error', uncertain: true, error: 'Timeout' })
      sync.receive(snapshot('Xabcd', 'v2')); sync.flush()
    }
    assert.equal(sync.view('f').text, 'XYabcd')
    assert.equal(writes[1].patch.insert, 'Y')
    assert.equal(writes[1].patch.start, 1)
    ok(writes[1], 'XYabcd', 'v3')
    assert.equal(sync.hasPending(), false)
  })
}

test('an ambiguous lost write followed by further remote changes preserves a conflict draft', () => {
  const { sync, writes } = fixture()
  sync.edit('f', 'Xabcd'); sync.flush(); sync.edit('f', 'XYabcd')
  sync.disconnect(); sync.connect([snapshot('Xabcd!', 'v3')])
  assert.equal(sync.view('f').text, 'XYabcd')
  assert.equal(sync.view('f').conflict, true)
  assert.equal(writes.length, 1)
})

test('errors preserve drafts without retry loops; a fresh snapshot enables retry', () => {
  const { sync, writes } = fixture()
  sync.edit('f', 'Xabcd'); sync.flush()
  writes[0].done({ status: 'error', error: 'Timeout' })
  sync.flush()
  assert.equal(writes.length, 1)
  assert.equal(sync.view('f').text, 'Xabcd')
  sync.receive(snapshot('abcd', 'v1')); sync.flush()
  assert.equal(writes.length, 2)
})

test('independent files retain their drafts and acknowledgements do not cross tabs', () => {
  const { sync, writes } = fixture()
  sync.receive(snapshot('second', 'b1', 'b'))
  sync.edit('f', 'Xabcd'); sync.edit('b', 'second!'); sync.flush()
  assert.equal(writes.length, 2)
  ok(writes[1], 'second!', 'b2'); ok(writes[0], 'Xabcd', 'v2')
  assert.equal(sync.view('f').text, 'Xabcd')
  assert.equal(sync.view('b').text, 'second!')
  assert.equal(sync.hasPending(), false)
})

test('deleted files keep unshared drafts available for recovery', () => {
  const { sync } = fixture()
  sync.edit('f', 'draft'); sync.remove('f')
  assert.equal(sync.view('f').text, 'draft')
  assert.ok(sync.view('f').error)
  sync.disconnect(); sync.connect([])
  assert.equal(sync.view('f').text, 'draft')
})
