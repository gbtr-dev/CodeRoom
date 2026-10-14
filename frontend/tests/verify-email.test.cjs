const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')

// Execute the real page with controlled hooks, URL and transport; no backend or emails.
function mount(verifyEmail, token = 'test-token', logout = () => {}) {
  const slots = []
  const effects = []
  let cursor = 0
  let removed = 0
  const hooks = {
    ...React,
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial
      return [slots[i], value => { slots[i] = value }]
    },
    useRef(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = { current: initial }
      return slots[i]
    },
    useEffect(effect) { effects.push(effect) },
  }
  const source = fs.readFileSync(path.join(__dirname, '../app/verify-email/page.tsx'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports,
    require(name) {
      if (name === 'react') return hooks
      if (name === 'next/link') return { __esModule: true, default: 'a' }
      if (name === 'next/navigation') return { useSearchParams: () => new URLSearchParams(token ? { token } : {}) }
      if (name === '@/components/auth-provider') return { useAuth: () => ({ verifyEmail, logout }) }
      return require(name)
    },
    window: { history: { state: {}, replaceState() { removed++ } }, location: { pathname: '/verify-email' } },
  })
  const Inner = exports.default().props.children.type
  function render() { cursor = 0; return Inner() }
  function button(tree = render()) {
    if (!tree || typeof tree !== 'object') return null
    if (tree.type === 'button') return tree
    for (const child of React.Children.toArray(tree.props?.children)) {
      const found = button(child)
      if (found) return found
    }
    return null
  }
  render()
  // Replay mount effects as StrictMode does: neither invocation may consume a token.
  for (const effect of [...effects]) { effect(); effect() }
  return { render, button, removed: () => removed }
}

test('opening and rendering the page never verifies; only an explicit click sends one request', async () => {
  let calls = 0
  let release
  const page = mount(() => { calls++; return new Promise(resolve => { release = resolve }) })
  assert.equal(calls, 0)
  assert.equal(page.removed(), 0)
  const action = page.button()
  assert.equal(action.props.children, 'Confirm email')
  const pending = action.props.onClick()
  await action.props.onClick()
  assert.equal(calls, 1)
  assert.equal(page.button().props.disabled, true)
  release({ status: 'verified', purpose: 'signup', email: 'user@example.com' })
  await pending
  assert.equal(page.button(), null)
  assert.equal(page.removed(), 1)
  await action.props.onClick()
  assert.equal(calls, 1)
})

test('network failure allows an explicit retry and email change clears signed-in state once', async () => {
  let calls = 0
  let logouts = 0
  const page = mount(async () => {
    if (++calls === 1) throw new Error('offline')
    return { status: 'verified', purpose: 'change', email: 'new@example.com' }
  }, 'token', () => { logouts++ })
  await page.button().props.onClick()
  assert.equal(page.button().props.children, 'Try again')
  assert.equal(logouts, 0)
  await page.button().props.onClick()
  assert.equal(logouts, 1)
  assert.equal(calls, 2)
})

test('missing token cannot be submitted; invalid and expired responses cannot be retried', async () => {
  let calls = 0
  assert.equal(mount(async () => { calls++ }, null).button(), null)
  assert.equal(calls, 0)
  for (const status of ['invalid', 'expired', 'taken']) {
    const page = mount(async () => ({ status }))
    await page.button().props.onClick()
    assert.equal(page.button(), null)
  }
})


test('refresh before confirmation retains the link and network failure does not remove it', async () => {
  let calls = 0
  const verify = async () => { calls++; return { status: 'error' } }
  const first = mount(verify)
  assert.equal(first.removed(), 0)
  const refreshed = mount(verify)
  assert.equal(refreshed.button().props.children, 'Confirm email')
  assert.equal(calls, 0)
  await refreshed.button().props.onClick()
  assert.equal(refreshed.removed(), 0)
  assert.equal(refreshed.button().props.children, 'Try again')
})
