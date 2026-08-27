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
