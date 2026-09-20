import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createWebServer } from '../web-server.js'

async function request(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET' }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

test('static server never serves files outside dist for traversal and encoded variants', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrogen-static-security-'))
  const distDir = path.join(root, 'dist')
  const secretDir = path.join(root, '.qq-music-session')
  await fs.mkdir(distDir, { recursive: true })
  await fs.mkdir(secretDir, { recursive: true })
  await fs.writeFile(path.join(distDir, 'index.html'), '<!-- safe spa shell -->')
  await fs.writeFile(path.join(secretDir, 'user-info.json'), '{"cookie":"STATIC-COOKIE-MUST-NOT-LEAK"}')

  const server = createWebServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  const port = server.address().port

  const home = await request(port, '/')
  assert.equal(home.status, 200)
  assert.equal(home.body, '<!-- safe spa shell -->')
  const spaRoute = await request(port, '/library/playlist/42')
  assert.equal(spaRoute.status, 200)
  assert.equal(spaRoute.body, '<!-- safe spa shell -->')

  const traversalPaths = [
    '/../.qq-music-session/user-info.json',
    '/%2e%2e/.qq-music-session/user-info.json',
    '/%252e%252e/.qq-music-session/user-info.json',
    '/..%5c.qq-music-session%5cuser-info.json',
    '/%2e%2e%5c.qq-music-session%5cuser-info.json',
  ]

  for (const requestPath of traversalPaths) {
    const response = await request(port, requestPath)
    assert.notEqual(response.status, 200, requestPath)
    assert.equal(response.body.includes('STATIC-COOKIE-MUST-NOT-LEAK'), false, requestPath)
    assert.equal(response.body.includes('user-info.json'), false, requestPath)
  }
})

async function requestWithHeaders(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method: 'GET' }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }))
    })
    req.on('error', reject)
    req.end()
  })
}

// 回归：构建后旧 index.html 会去请求已被删除的带 hash 分块。如果静态服务对
// 缺失的 .js 也回退成 index.html，浏览器会把 HTML 当模块解析并抛 SyntaxError，
// 表现为「某个路由整页空白」且错误信息难以理解。
test('static server returns 404 for missing assets instead of the SPA shell', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrogen-static-assets-'))
  const distDir = path.join(root, 'dist')
  await fs.mkdir(path.join(distDir, 'assets'), { recursive: true })
  await fs.writeFile(path.join(distDir, 'index.html'), '<!-- spa shell -->')
  await fs.writeFile(path.join(distDir, 'assets', 'Settings-abc12345.js'), 'export default 1')

  const server = createWebServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  const port = server.address().port

  // 缺失的构建产物必须如实 404，绝不能返回 HTML
  const missingJs = await requestWithHeaders(port, '/assets/Settings-DELETED.js')
  assert.equal(missingJs.status, 404)
  assert.equal(missingJs.body.includes('spa shell'), false)

  const missingCss = await requestWithHeaders(port, '/assets/Settings-DELETED.css')
  assert.equal(missingCss.status, 404)

  // 导航请求仍然回退到 index.html
  const spaRoute = await requestWithHeaders(port, '/settings')
  assert.equal(spaRoute.status, 200)
  assert.match(String(spaRoute.headers['content-type'] || ''), /text\/html/)
  assert.equal(spaRoute.body, '<!-- spa shell -->')

  // index.html 不缓存，否则重建后浏览器会继续引用旧分块哈希
  assert.match(String(spaRoute.headers['cache-control'] || ''), /no-cache/)

  // 带 hash 的产物可以长期缓存
  const hashedAsset = await requestWithHeaders(port, '/assets/Settings-abc12345.js')
  assert.equal(hashedAsset.status, 200)
  assert.match(String(hashedAsset.headers['cache-control'] || ''), /immutable/)
})
