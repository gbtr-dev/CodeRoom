const assert = require('node:assert/strict')
const { test } = require('node:test')
const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')
const path = require('node:path')
const childProcess = require('node:child_process')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')

// Exercise the Docker lifecycle without executing untrusted code or requiring a daemon.
function setup(t, { start = 'ok', create = 'ok', cleanup = 'ok', warm = false } = {}) {
  const calls = []
  const containers = new Set()
  let warmId = 0
  const realTimeout = global.setTimeout
  t.mock.method(global, 'setTimeout', (fn, ms, ...args) => {
    const operation = calls.at(-1)?.args[0]
    const hangs = (operation === 'create' && create === 'timeout') ||
      (['start', 'exec'].includes(operation) && start === 'timeout') ||
      (operation === 'rm' && cleanup === 'timeout')
    // Accelerate only deliberately stalled operations: ordinary callbacks must not
    // time out just because other test processes are compiling TypeScript.
    return realTimeout(fn, hangs && ms >= 10_000 ? 20 : ms, ...args)
  })
  t.mock.method(childProcess, 'spawn', (cmd, args) => {
    assert.equal(cmd, 'docker')
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); return true }
    calls.push({ args, child })
    setImmediate(() => {
      const close = (code = 0) => child.emit('close', code)
      const fail = () => { child.stderr.write('simulated daemon failure'); close(1) }
      if (args[0] === 'create') {
        assert.equal(args[args.indexOf('--pids-limit') + 1], '128')
        const id = args[args.indexOf('--name') + 1]
        containers.add(id)
        if (create === 'timeout') return
        if (create === 'error') return fail()
        return close()
      }
      if (args[0] === 'run') {
        assert.equal(args[args.indexOf('--pids-limit') + 1], '128')
        if (!warm) return fail()
        const id = `warm-${++warmId}`
        containers.add(id)
        child.stdout.write(id)
        return close()
      }
      if (args[0] === 'start' || args[0] === 'exec') {
        if (start === 'timeout') return
        if (start === 'error') return child.emit('error', new Error('simulated CLI error'))
        if (start === 'stdin') return child.stdin.emit('error', new Error('EPIPE'))
        child.stdout.write('result')
        return close()
      }
      if (args[0] === 'rm') {
        if (cleanup === 'timeout') return
        if (cleanup === 'error') return fail()
        containers.delete(args[2])
        return close()
      }
      throw new Error(`Unexpected Docker operation: ${args[0]}`)
    })
    return child
  })
  delete require.cache[require.resolve('../src/executor')]
  return { executor: require('../src/executor'), calls, containers }
}

for (const start of ['ok', 'timeout', 'error', 'stdin']) {
  test(`cold execution removes its container after ${start}`, async t => {
    const { executor, calls, containers } = setup(t, { start })
    const result = await executor.executeCode('c', 'int main() {}')
    const creation = calls.find(c => c.args[0] === 'create')
    const id = creation.args[creation.args.indexOf('--name') + 1]
    assert.match(id, /^coderoom-run-/)
    assert.deepEqual(calls.find(c => c.args[0] === 'rm').args, ['rm', '-f', id])
    assert.equal(containers.size, 0, 'cleanup must finish before returning')
    assert.equal(result.exitCode, start === 'ok' ? 0 : 1)
    if (start === 'timeout') {
      assert.match(result.error, /Execution timed out/)
      assert.equal(calls.find(c => c.args[0] === 'start').child.killed, true)
    }
    if (start === 'ok') assert.equal(result.output, 'result')
  })
}

for (const create of ['error', 'timeout']) {
  test(`failed container creation (${create}) cannot start code and still attempts cleanup`, async t => {
    const { executor, calls, containers } = setup(t, { create })
    const result = await executor.executeCode('c', 'int main() {}')
    assert.equal(result.exitCode, 1)
    assert.equal(calls.some(c => c.args[0] === 'start'), false)
    assert.equal(containers.size, 0)
    assert.ok(calls.some(c => c.args[0] === 'rm'))
  })
}

for (const cleanup of ['error', 'timeout']) {
  test(`cleanup ${cleanup} is reported instead of claiming successful execution`, async t => {
    const { executor } = setup(t, { cleanup })
    const result = await executor.executeCode('c', 'int main() {}')
    assert.equal(result.exitCode, 1)
    assert.match(result.error, /Container cleanup failed/)
  })
}

test('Docker formatter also removes the container on timeout', async t => {
  const { executor, containers, calls } = setup(t, { start: 'timeout' })
  const result = await executor.formatCode('go', 'package main')
  assert.match(result.error, /Execution timed out/)
  assert.equal(containers.size, 0)
  assert.ok(calls.some(c => c.args[0] === 'rm'))
})

test('warm execution waits for removal of the exact borrowed container', async t => {
  const { executor, calls, containers } = setup(t, { warm: true })
  await executor.executeCode('js', '1') // cold fallback also fills the pool
  await executor.executeCode('js', '2')
  const execution = calls.find(c => c.args[0] === 'exec')
  assert.ok(execution)
  const id = execution.args[4]
  assert.equal(containers.has(id), false)
  assert.ok(calls.some(c => c.args[0] === 'rm' && c.args[2] === id))
})
