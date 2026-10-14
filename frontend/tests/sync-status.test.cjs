const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const path = require('node:path')
const exportsForTest = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../components/room/SyncStatus.tsx'), 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsForTest, require: name => name === '@/components/ui/button' ? { Button: 'button' } : require(name) })
const { SyncStatus } = exportsForTest
function render(props) {
  return React.Children.toArray(SyncStatus({ onDownload() {}, onUseShared() {}, onRetry() {}, connected: true, ...props }).props.children)
}
test('sharing status distinguishes pending work from acknowledged content', () => {
  assert.equal(render({ view: { pending: true } })[0].props.children, 'Sharing changes…')
  assert.equal(render({ view: { pending: false } })[0].props.children, 'Changes shared')
  assert.equal(render({})[0].props.role, 'status')
})
test('conflict resolution downloads the local draft before loading shared content', () => {
  const calls = []
  const items = render({ view: { conflict: true, pending: true }, onDownload: () => calls.push('download'), onUseShared: () => calls.push('shared') })
  const resolve = items.find(item => item.props.children === 'Download draft and load shared version')
  resolve.props.onClick()
  assert.deepEqual(calls, ['download', 'shared'])
})
test('disconnected failures retain the draft download and disable retry', () => {
  const items = render({ connected: false, view: { pending: true, error: 'Timeout' } })
  assert.ok(items.find(item => item.props.children === 'Download my draft'))
  assert.equal(items.find(item => item.props.children === 'Retry sharing').props.disabled, true)
})
