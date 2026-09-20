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

test('github proxy only forwards the read-only commits endpoint', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrogen-github-proxy-'))
  const distDir = path.join(root, 'dist')
  await fs.mkdir(distDir, { recursive: true })
  await fs.writeFile(path.join(distDir, 'index.html'), '<!-- safe spa shell -->')

  const server = createWebServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })
  const port = server.address().port

  // 白名单外一律拒绝，且不能回落到静态资源（否则会泄露 SPA 首页）
  const deniedPaths = [
    '/github-api',
    '/github-api/user',
    '/github-api/graphql',
    '/github-api/repos/TTLLSSFF/Hydrogen-Music/releases',
    '/github-api/repos/TTLLSSFF/Hydrogen-Music/pulls',
    '/github-api/repos/TTLLSSFF/Hydrogen-Music/commits/cafe111',
    '/github-api/orgs/TTLLSSFF/repos',
    '/github-api/repos/TTLLSSFF/Hydrogen-Music/commits%2F..%2F..%2Fuser',
  ]

  for (const requestPath of deniedPaths) {
    const response = await request(port, requestPath)
    assert.equal(response.status, 403, requestPath)
    assert.equal(response.body.includes('safe spa shell'), false, requestPath)
    assert.match(response.body, /github proxy path not allowed/, requestPath)
  }
})
