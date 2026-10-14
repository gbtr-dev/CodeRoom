const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')

function load(relativePath, hooks, fetch, extraSource = '') {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8') + extraSource
  const code = ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, fetch, process: { env: {} },
    require(name) {
      if (name === 'react') return { ...React, ...hooks }
      if (name === 'next/navigation') return {}
      if (name === 'next/link') return { __esModule: true, default: 'a' }
      if (name === '@/components/auth-provider') return {}
      return require(name)
    },
  })
  return exports
}

test('signup keeps the resend capability and the provider sends it with the matching email', async () => {
  const email = 'owner@example.com'
  const resendToken = 'browser-specific-signup-capability'
  const requests = []
  const provider = load('components/auth-provider.tsx', {
    useState: initial => [initial, () => {}], useEffect() {},
  }, async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return { ok: true, status: 200, json: async () => url.endsWith('/signup')
      ? { status: 'verification_required', email, resendToken } : { status: 'ok' } }
  })
  const auth = provider.AuthProvider({ children: null }).props.value
  const result = await auth.signup('Owner', email, 'owner-password')
  assert.equal(result.pending.resendToken, resendToken)
  await auth.resendVerification(result.pending.email, result.pending.resendToken)
  assert.deepEqual(requests[1].body, { email, resendToken })
  assert.ok(requests[1].url.endsWith('/auth/resend-verification'))
})

test('the check-inbox resend button forwards the capability from its pending registration', async () => {
  let firstState = true
  const page = load('app/login/page.tsx', {
    useState(initial) {
      // Render the button after its initial cooldown has elapsed.
      const value = firstState ? 0 : initial
      firstState = false
      return [value, () => {}]
    },
    useEffect() {},
  }, undefined, '\nexport { CheckInbox };')
  const pending = { email: 'owner@example.com', resendToken: 'this-registration', from: 'signup' }
  let args
  const tree = page.CheckInbox({ pending, onResend: async (...values) => { args = values; return {} }, onBack() {}, onSignIn() {} })
  const button = React.Children.toArray(tree.props.children).find(child =>
    child.type === 'button' && child.props.onClick?.name === 'resend')
  assert.ok(button)
  await button.props.onClick()
  assert.deepEqual(args, [pending.email, pending.resendToken])
})
