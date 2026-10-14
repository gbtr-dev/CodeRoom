const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const Fastify = require('fastify')
const rateLimit = require('@fastify/rate-limit')

process.env.TS_NODE_PROJECT = path.resolve(__dirname, '../tsconfig.json')
require('ts-node/register/transpile-only')
const { trustedProxies } = require('../src/trustedProxies')

test('untrusted clients cannot spoof forwarded metadata or evade the IP rate limit', async t => {
  const app = Fastify({ trustProxy: trustedProxies('127.0.0.1, ::1') })
  t.after(() => app.close())
  await app.register(rateLimit, { max: 1, timeWindow: '1 minute' })
  app.get('/', req => ({ ip: req.ip, host: req.host, protocol: req.protocol }))
  const request = ip => app.inject({
    method: 'GET', url: '/', remoteAddress: '198.51.100.20',
    headers: { host: 'api.example', 'x-forwarded-for': ip,
      'x-forwarded-host': 'forged.example', 'x-forwarded-proto': 'https' },
  })
  const first = await request('203.0.113.1')
  assert.equal(first.statusCode, 200)
  assert.deepEqual(first.json(), { ip: '198.51.100.20', host: 'api.example', protocol: 'http' })
  assert.equal((await request('203.0.113.2')).statusCode, 429)
})

test('configured proxies preserve client IP and protocol; an empty list trusts nobody', async t => {
  for (const [list, remoteAddress, expectedIp] of [
    ['127.0.0.1,::1', '127.0.0.1', '203.0.113.5'],
    ['127.0.0.1,::1', '::1', '203.0.113.5'],
    ['10.0.0.0/24', '10.0.0.10', '203.0.113.5'],
    ['', '127.0.0.1', '127.0.0.1'],
  ]) {
    const app = Fastify({ trustProxy: trustedProxies(list) })
    t.after(() => app.close())
    app.get('/', req => ({ ip: req.ip, protocol: req.protocol }))
    const res = await app.inject({ method: 'GET', url: '/', remoteAddress,
      headers: { 'x-forwarded-for': '203.0.113.5', 'x-forwarded-proto': 'https' } })
    assert.deepEqual(res.json(), { ip: expectedIp, protocol: list ? 'https' : 'http' })
  }
})
