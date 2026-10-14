const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
function load(name) {
  const exports = {}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => load(name.replace('./', '')) })
  return exports
}
const { FileSync } = load('fileSync')
const { FileFormatter } = load('fileFormatter')
const snapshot = (fileId, content, revision = 'v1') => ({ fileId, content, revision })
function fixture() {
  const writes = [], requests = [], notices = []
  let activeId = 'a', editor = 'let a=1'
  const sync = new FileSync((fileId, revision, patch, done) => writes.push({ fileId, revision, patch, done }),
    (id, view) => { if (id === activeId) editor = view.text })
  sync.connect([snapshot('a', 'let a=1'), snapshot('b', 'let b=2')])
  const formatter = new FileFormatter(sync, (request, done) => requests.push({ ...request, done }),
    (fileId, busy, notice) => notices.push({ fileId, busy, notice }))
  const reply = (index = 0, formatted = 'let a = 1;', error = '') =>
    requests[index].done(null, { fileId: requests[index].fileId, formatted, error })
  return { sync, formatter, writes, requests, notices, reply,
    switchTab(id) { activeId = id; editor = sync.view(id).text }, editor: () => editor }
}

test('formatting follows the original file after a tab switch and uses acknowledged edits', () => {
  const f = fixture()
  f.formatter.start('a', 'js'); f.switchTab('b'); f.reply()
  assert.equal(f.editor(), 'let b=2')
  assert.equal(f.sync.view('a').text, 'let a = 1;')
  assert.equal(f.writes[0].fileId, 'a')
  assert.equal(f.writes[0].revision, 'v1')
  assert.equal(f.sync.view('a').pending, true)
  f.writes[0].done({ status: 'ok', ...snapshot('a', 'let a = 1;', 'v2') })
  assert.equal(f.sync.view('a').pending, false)
})

test('typing, including edit then undo, invalidates a delayed format result', () => {
  for (const undo of [false, true]) {
    const f = fixture(); f.formatter.start('a', 'js')
    f.sync.edit('a', 'let a=12')
    if (undo) f.sync.edit('a', 'let a=1')
    f.reply()
    assert.equal(f.sync.view('a').text, undo ? 'let a=1' : 'let a=12')
    assert.equal(f.writes.length, 0)
    assert.match(f.notices.at(-1).notice, /skipped/)
    assert.equal(f.notices.at(-1).busy, false)
  }
})

test('remote changes and deletion invalidate the original draft', () => {
  for (const remove of [false, true]) {
    const f = fixture(); f.formatter.start('a', 'js')
    if (remove) f.sync.remove('a')
    else f.sync.receive(snapshot('a', 'let a=99', 'v2'))
    f.reply()
    assert.equal(f.writes.length, 0)
    assert.equal(f.sync.view('a')?.text, remove ? undefined : 'let a=99')
    assert.match(f.notices.at(-1).notice, /skipped/)
  }
})

test('autosave acknowledgement of the captured draft does not discard formatting', () => {
  const f = fixture()
  f.sync.edit('a', 'let a=12'); f.sync.flush()
  f.formatter.start('a', 'js')
  assert.equal(f.requests[0].code, 'let a=12')
  f.writes[0].done({ status: 'ok', ...snapshot('a', 'let a=12', 'v2') })
  f.reply(0, 'let a = 12;')
  assert.equal(f.writes.length, 2)
  assert.equal(f.writes[1].revision, 'v2')
  assert.equal(f.sync.view('a').text, 'let a = 12;')
})

test('errors, timeouts and malformed acknowledgements preserve code and release busy state', () => {
  for (const kind of ['timeout', 'error', 'malformed', 'wrong-file']) {
    const f = fixture(); f.formatter.start('a', 'js')
    if (kind === 'timeout') f.requests[0].done(new Error('timeout'))
    if (kind === 'error') f.reply(0, '', 'Invalid syntax. Fix the code and try Format again.')
    if (kind === 'malformed') f.requests[0].done(null, {})
    if (kind === 'wrong-file') f.requests[0].done(null, { fileId: 'b', formatted: 'bad', error: '' })
    assert.equal(f.sync.view('a').text, 'let a=1')
    assert.equal(f.writes.length, 0)
    assert.equal(f.notices.at(-1).busy, false)
    assert.ok(f.notices.at(-1).notice)
    f.formatter.start('a', 'js')
    assert.equal(f.requests.length, 2)
  }
})

test('disconnect cancels formatting and late replies cannot finish a newer request', () => {
  const f = fixture(); f.formatter.start('a', 'js'); f.formatter.start('b', 'js')
  assert.equal(f.requests.length, 1)
  f.sync.disconnect(); f.formatter.cancel()
  assert.equal(f.notices.at(-1).busy, false)
  f.sync.connect([snapshot('a', 'let a=1'), snapshot('b', 'let b=2')])
  f.formatter.start('b', 'js'); f.reply(0)
  assert.equal(f.notices.at(-1).busy, true)
  assert.equal(f.writes.length, 0)
  f.reply(1, 'let b = 2;')
  assert.equal(f.writes[0].fileId, 'b')
})

test('empty formatted output is valid and disconnected drafts are not submitted', () => {
  const f = fixture(); f.formatter.start('a', 'js'); f.reply(0, '')
  assert.equal(f.sync.view('a').text, '')
  f.sync.disconnect(); f.formatter.start('b', 'js')
  assert.equal(f.requests.length, 1)
  assert.match(f.notices.at(-1).notice, /unavailable/)
})
