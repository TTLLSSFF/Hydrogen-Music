import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createWebServer } from '../web-server.js'
import {
  registerDownloadTag,
  takeDownloadTag,
  resolveDownloadExtension,
  writeAudioTags,
  clearPendingDownloadTags,
} from '../server/downloadTags.cjs'

const require = createRequire(import.meta.url)
const NodeID3 = require('node-id3')

// node-id3 只是把 ID3 头拼到文件开头，不校验音频内容，所以用假 payload 即可验证写入。
const FAKE_MP3 = Buffer.from('FAKE-MP3-PAYLOAD-'.repeat(64), 'utf8')

function startOriginServer() {
  return http.createServer((req, res) => {
    if (req.url.startsWith('/song.mp3')) {
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': String(FAKE_MP3.length) })
      res.end(FAKE_MP3)
      return
    }
    if (req.url.startsWith('/redirect.mp3')) {
      res.writeHead(302, { Location: '/song.mp3' })
      res.end()
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
}

function httpRequest(port, requestPath, { method = 'GET', body = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: requestPath, method, headers }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }))
    })
    req.on('error', reject)
    if (body !== null) req.write(body)
    req.end()
  })
}

test('download tag token is single-use and rejects unknown tokens', () => {
  clearPendingDownloadTags()

  const token = registerDownloadTag({ name: 'A', album: 'B' })
  assert.equal(typeof token, 'string')
  assert.ok(token.length >= 16)

  assert.deepEqual(takeDownloadTag(token), { name: 'A', album: 'B' })
  // 一次性消费：同一个 token 不能复用，避免元数据被反复绑定到别的下载上
  assert.equal(takeDownloadTag(token), null)
  assert.equal(takeDownloadTag('not-a-real-token'), null)
  assert.equal(takeDownloadTag(''), null)
  assert.equal(takeDownloadTag(null), null)

  clearPendingDownloadTags()
})

test('resolveDownloadExtension prefers metadata type, then filename, then mp3', () => {
  assert.equal(resolveDownloadExtension({ type: 'flac' }, 'a.mp3'), 'flac')
  assert.equal(resolveDownloadExtension({ type: '.mp3' }, ''), 'mp3')
  assert.equal(resolveDownloadExtension({}, 'a.FLAC'), 'flac')
  assert.equal(resolveDownloadExtension({}, ''), 'mp3')
})

test('writeAudioTags embeds title/artist/album into mp3 files', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrogen-tags-unit-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'song.mp3')
  await fs.writeFile(file, FAKE_MP3)

  const result = await writeAudioTags(file, {
    name: '测试歌曲',
    type: 'mp3',
    artists: ['歌手A', '歌手B'],
    album: '测试专辑',
  })

  assert.equal(result.format, 'mp3')
  assert.equal(result.tagsWritten, true)

  const written = await fs.readFile(file)
  assert.equal(written.subarray(0, 3).toString('latin1'), 'ID3')
  assert.ok(written.length > FAKE_MP3.length)

  const read = NodeID3.read(file)
  assert.equal(read.title, '测试歌曲')
  assert.equal(read.artist, '歌手A / 歌手B')
  assert.equal(read.album, '测试专辑')
})

test('web download proxy writes tags when a tag token is supplied', async (t) => {
  clearPendingDownloadTags()

  const origin = startOriginServer()
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve))
  const originPort = origin.address().port

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrogen-tags-web-'))
  const distDir = path.join(root, 'dist')
  await fs.mkdir(distDir, { recursive: true })
  await fs.writeFile(path.join(distDir, 'index.html'), '<!-- spa shell -->')

  const server = createWebServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => origin.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
    clearPendingDownloadTags()
  })

  const port = server.address().port
  const audioUrl = encodeURIComponent(`http://127.0.0.1:${originPort}/redirect.mp3`)

  const tagResponse = await httpRequest(port, '/download-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({
      name: '网页端歌曲',
      type: 'mp3',
      artists: ['网页歌手'],
      album: '网页专辑',
    })),
  })
  assert.equal(tagResponse.status, 200)
  const { token } = JSON.parse(tagResponse.body.toString('utf8'))
  assert.equal(typeof token, 'string')

  const tagged = await httpRequest(
    port,
    `/download-proxy?url=${audioUrl}&filename=${encodeURIComponent('网页端歌曲 - 网页歌手.mp3')}&tags=${token}`,
  )
  assert.equal(tagged.status, 200)
  assert.equal(tagged.body.subarray(0, 3).toString('latin1'), 'ID3')
  assert.ok(tagged.body.length > FAKE_MP3.length)
  assert.equal(Number(tagged.headers['content-length']), tagged.body.length)
  assert.match(String(tagged.headers['content-disposition'] || ''), /attachment;/)

  // token 已被消费，同样的 URL 再下载一次会退回无标签的零拷贝转发
  const plain = await httpRequest(
    port,
    `/download-proxy?url=${audioUrl}&filename=${encodeURIComponent('网页端歌曲 - 网页歌手.mp3')}&tags=${token}`,
  )
  assert.equal(plain.status, 200)
  assert.deepEqual(plain.body, FAKE_MP3)
})

test('download proxy without a tag token keeps streaming the original bytes', async (t) => {
  const origin = startOriginServer()
  await new Promise(resolve => origin.listen(0, '127.0.0.1', resolve))
  const originPort = origin.address().port

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrogen-tags-plain-'))
  const distDir = path.join(root, 'dist')
  await fs.mkdir(distDir, { recursive: true })
  await fs.writeFile(path.join(distDir, 'index.html'), '<!-- spa shell -->')

  const server = createWebServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))

  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await new Promise(resolve => origin.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })

  const port = server.address().port
  const audioUrl = encodeURIComponent(`http://127.0.0.1:${originPort}/song.mp3`)
  const response = await httpRequest(port, `/download-proxy?url=${audioUrl}&filename=song.mp3`)

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, FAKE_MP3)
})

test('download tags endpoint rejects non-POST and malformed metadata', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hydrogen-tags-bad-'))
  const distDir = path.join(root, 'dist')
  await fs.mkdir(distDir, { recursive: true })
  await fs.writeFile(path.join(distDir, 'index.html'), '<!-- spa shell -->')

  const server = createWebServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  })

  const port = server.address().port

  const getResponse = await httpRequest(port, '/download-tags')
  assert.equal(getResponse.status, 405)

  const brokenJson = await httpRequest(port, '/download-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from('{not json'),
  })
  assert.equal(brokenJson.status, 400)

  const arrayBody = await httpRequest(port, '/download-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from('[1,2,3]'),
  })
  assert.equal(arrayBody.status, 400)

  const tooLarge = await httpRequest(port, '/download-tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify({ name: 'x'.repeat(300 * 1024) })),
  })
  assert.equal(tooLarge.status, 413)
})
