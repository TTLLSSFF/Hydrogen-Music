import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  sanitizeBaseName,
  normalizeDownloadExtension,
  buildDownloadFileName,
  hasTimedLyricText,
  buildCombinedLrcText,
  buildUnsyncedLyricText,
} = require('../src/electron/downloadText.js')

test('sanitizeBaseName strips path-illegal characters and guards reserved names', () => {
  assert.equal(sanitizeBaseName('a\\b/c:d*e?f"g<h>i|j'), 'a b c d e f g h i j')
  assert.equal(sanitizeBaseName('  夜曲  '), '夜曲')
  assert.equal(sanitizeBaseName('trailing.  '), 'trailing')
  assert.equal(sanitizeBaseName('CON'), '_CON')
  assert.equal(sanitizeBaseName(''), 'Hydrogen Music')
})

test('normalizeDownloadExtension keeps a valid extension and falls back for junk', () => {
  assert.equal(normalizeDownloadExtension('.FLAC'), 'flac')
  assert.equal(normalizeDownloadExtension('mp3'), 'mp3')
  assert.equal(normalizeDownloadExtension('weird?'), 'mp3')
})

test('buildDownloadFileName builds title - artist.ext and reuses filename when name is absent', () => {
  assert.equal(
    buildDownloadFileName({ name: '夜曲', artists: ['周杰伦', '方文山'] }, 'flac'),
    '夜曲 - 周杰伦, 方文山.flac',
  )
  assert.equal(
    buildDownloadFileName({ filename: '晴天 - 周杰伦.mp3' }, 'mp3'),
    '晴天 - 周杰伦.mp3',
  )
  assert.equal(buildDownloadFileName({ name: 'a/b' }, 'mp3'), 'a b.mp3')
})

test('buildCombinedLrcText normalizes time tags, merges translation and writes headers', () => {
  const payload = {
    lrc: '[00:01.50]第一句\n[00:03:200]第二句',
    tlyric: '[00:01.500]First line',
    romalrc: null,
  }
  const output = buildCombinedLrcText(payload, { name: '歌名', artists: ['歌手'], album: '专辑' })

  assert.match(output, /^\[by:Hydrogen Music\]\n/)
  assert.match(output, /\[ti:歌名\]/)
  assert.match(output, /\[ar:歌手\]/)
  assert.match(output, /\[al:专辑\]/)
  assert.match(output, /\[00:01\.500\]第一句/)
  assert.match(output, /\[00:01\.500\]First line/)
  assert.match(output, /\[00:03\.200\]第二句/)
  assert.ok(output.indexOf('第一句') < output.indexOf('第二句'))
})

test('buildUnsyncedLyricText removes all tags for tag embedding', () => {
  const payload = { lrc: '[00:01.50]第一句\n[00:03.20]第二句', tlyric: null, romalrc: null }
  const plain = buildUnsyncedLyricText(payload)
  assert.equal(plain.includes('['), false)
  assert.equal(plain, '第一句\n第二句')
  assert.equal(hasTimedLyricText(payload.lrc), true)
  assert.equal(hasTimedLyricText(plain), false)
})