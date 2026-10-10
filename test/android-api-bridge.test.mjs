import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { createApiBridge } = require('../apps/android/mobile-runtime/api-bridge.cjs')

function startServer(handler) {
  const server = http.createServer(handler)
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port })
    })
  })
}

function startBridge(ncmPort, qqPort) {
  const bridge = createApiBridge(ncmPort, qqPort)
  return new Promise(resolve => {
    bridge.listen(0, '127.0.0.1', () => resolve({ bridge, port: bridge.address().port }))
  })
}

function jsonUpstream(label, hits) {
  return (req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      hits.push({ url: req.url, method: req.method, body })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ from: label, url: req.url }))
    })
  }
}

test('安卓转发层：/qq 前缀分流到 QQ 上游并剥掉前缀，其余仍走网易云', async t => {
  const ncmHits = []
  const qqHits = []
  const ncm = await startServer(jsonUpstream('ncm', ncmHits))
  const qq = await startServer(jsonUpstream('qq', qqHits))
  const { bridge, port } = await startBridge(ncm.port, qq.port)
  t.after(() => {
    bridge.close()
    ncm.server.close()
    qq.server.close()
  })

  const qqResponse = await fetch(`http://127.0.0.1:${port}/qq/session/status`)
  assert.deepEqual(await qqResponse.json(), { from: 'qq', url: '/session/status' })

  const ncmResponse = await fetch(`http://127.0.0.1:${port}/song/url/v1?id=1`)
  assert.deepEqual(await ncmResponse.json(), { from: 'ncm', url: '/song/url/v1?id=1' })

  // POST 请求体（扫码状态查询是 POST JSON）必须原样透传
  await fetch(`http://127.0.0.1:${port}/qq/checkQQLoginQr`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'qr-1' }),
  })
  assert.deepEqual(qqHits.at(-1), {
    url: '/checkQQLoginQr',
    method: 'POST',
    body: JSON.stringify({ sessionId: 'qr-1' }),
  })

  // /qq 前缀只转发一次；网易云侧不应看到 QQ 请求
  assert.equal(ncmHits.some(hit => hit.url.startsWith('/qq')), false)
  assert.equal(qqHits.length, 2)
})

test('安卓转发层：OPTIONS 预检 204 且回显自定义头（QQ 会话头依赖这一点）', async t => {
  const ncm = await startServer(jsonUpstream('ncm', []))
  const qq = await startServer(jsonUpstream('qq', []))
  const { bridge, port } = await startBridge(ncm.port, qq.port)
  t.after(() => {
    bridge.close()
    ncm.server.close()
    qq.server.close()
  })

  const preflight = await fetch(`http://127.0.0.1:${port}/qq/session/status`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://localhost',
      'access-control-request-headers': 'x-qq-music-session',
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://localhost')
  assert.equal(preflight.headers.get('access-control-allow-headers'), 'x-qq-music-session')
})

test('安卓转发层：未配置 QQ 端口时 /qq 仍按旧行为落到网易云（向后兼容）', async t => {
  const ncmHits = []
  const ncm = await startServer(jsonUpstream('ncm', ncmHits))
  const { bridge, port } = await startBridge(ncm.port, 0)
  t.after(() => {
    bridge.close()
    ncm.server.close()
  })

  const response = await fetch(`http://127.0.0.1:${port}/qq/session/status`)
  assert.deepEqual(await response.json(), { from: 'ncm', url: '/qq/session/status' })
})

test('安卓转发层：上游不可达时返回 502 而不是挂起连接', async t => {
  // 指向一个必然没有监听的端口，模拟内嵌 QQ API 尚未起来
  const { bridge, port } = await startBridge(1, 1)
  t.after(() => bridge.close())

  const response = await fetch(`http://127.0.0.1:${port}/qq/__hm_ready`)
  assert.equal(response.status, 502)
  const payload = await response.json()
  assert.equal(payload.code, 502)
})