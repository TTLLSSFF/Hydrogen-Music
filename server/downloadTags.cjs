// 网页端下载标签：浏览器无法在本地写 ID3/FLAC 标签，所以由服务端在下载落盘后写入。
// 浏览器先把元数据 POST 到 /download-tags 换成一次性 token，下载时由 /download-proxy
// 消费 token 写标签，再回传文件。
const http = require('http')
const https = require('https')
const path = require('path')
const crypto = require('crypto')
const {
  buildCombinedLrcText,
  buildUnsyncedLyricText,
  hasTimedLyricText,
  normalizeDownloadExtension,
} = require('../src/electron/downloadText')

let NodeID3 = null
let Metaflac = null
try { NodeID3 = require('node-id3') } catch (_) { NodeID3 = null }
try { Metaflac = require('metaflac-js') } catch (_) { Metaflac = null }

const TAG_TTL_MS = 10 * 60 * 1000
const TAG_MAX_ENTRIES = 200
const COVER_TIMEOUT_MS = 10000
const COVER_MAX_BYTES = 8 * 1024 * 1024

// token -> { metadata, expiresAt }
const pendingTags = new Map()

function prunePendingTags(now = Date.now()) {
  for (const [token, entry] of pendingTags) {
    if (entry.expiresAt <= now) pendingTags.delete(token)
  }
  while (pendingTags.size > TAG_MAX_ENTRIES) {
    const oldest = pendingTags.keys().next().value
    if (oldest === undefined) break
    pendingTags.delete(oldest)
  }
}

function registerDownloadTag(metadata) {
  prunePendingTags()
  const token = crypto.randomBytes(18).toString('hex')
  pendingTags.set(token, { metadata, expiresAt: Date.now() + TAG_TTL_MS })
  return token
}

// 一次性消费：无论后续下载成功与否，token 都作废，避免被反复复用。
function takeDownloadTag(token) {
  const key = typeof token === 'string' ? token.trim() : ''
  if (!key) return null
  const entry = pendingTags.get(key)
  if (!entry) return null
  pendingTags.delete(key)
  return entry.expiresAt > Date.now() ? entry.metadata : null
}

function resolveDownloadExtension(metadata = {}, filename = '') {
  return normalizeDownloadExtension(metadata?.type || path.extname(String(filename || '')))
}

function sanitizeTagText(value, maxLength = 200) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
}

// 歌词要保留换行，只清掉控制字符
function sanitizeLyricText(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
}

function normalizeArtists(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : [])
  return list.map(item => sanitizeTagText(item, 120)).filter(Boolean).slice(0, 20)
}

function parseCoverUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim())
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed
  } catch (_) {}
  return null
}

function inferCoverMime(buffer, contentType = '', sourceUrl = '') {
  const headerMime = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (headerMime === 'image/png' || headerMime === 'image/jpeg' || headerMime === 'image/jpg') {
    return headerMime === 'image/jpg' ? 'image/jpeg' : headerMime
  }

  const buf = Buffer.from(buffer || [])
  if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'

  const lowerUrl = String(sourceUrl || '').split('?')[0].toLowerCase()
  if (lowerUrl.endsWith('.png')) return 'image/png'
  if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) return 'image/jpeg'

  return ''
}

function fetchCoverBuffer(parsedUrl) {
  return new Promise((resolve, reject) => {
    const transport = parsedUrl.protocol === 'https:' ? https : http
    const request = transport.get(parsedUrl, {
      headers: {
        Accept: 'image/*,*/*',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: COVER_TIMEOUT_MS,
    }, (response) => {
      if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
        response.resume()
        reject(new Error(`cover status ${response.statusCode}`))
        return
      }

      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > COVER_MAX_BYTES) {
          response.destroy()
          reject(new Error('cover too large'))
          return
        }
        chunks.push(chunk)
      })
      response.on('error', reject)
      response.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: response.headers['content-type'] || '',
      }))
    })

    request.on('timeout', () => request.destroy(new Error('cover timeout')))
    request.on('error', reject)
  })
}

function buildLyricTextForEmbed(lyrics, meta) {
  if (!lyrics || (!lyrics.lrc && !lyrics.tlyric && !lyrics.romalrc)) return ''
  const timedText = buildCombinedLrcText(lyrics, meta, { includeByTag: false })
  const text = hasTimedLyricText(timedText) ? timedText : buildUnsyncedLyricText(lyrics)
  return sanitizeLyricText(text)
}

// 与桌面端 src/electron/download.js 的 finalizeDownloadMetadata 字段语义一致：
// 标题/歌手/专辑/备注写入基础标签，封面内嵌，歌词写入 LYRICS。
// 不支持的格式只跳过写标签，文件本身照常返回。
async function writeAudioTags(filePath, metadata = {}) {
  const format = resolveDownloadExtension(metadata, filePath)
  const title = sanitizeTagText(metadata?.name)
  const artists = normalizeArtists(metadata?.artists)
  const album = sanitizeTagText(metadata?.album)
  const lyricText = buildLyricTextForEmbed(metadata?.lyrics, { name: title, artists, album })
  const result = { format, tagsWritten: false, coverEmbedded: false, lyricsEmbedded: false }

  let coverBuffer = null
  let coverMime = ''
  const coverUrl = parseCoverUrl(metadata?.coverUrl)
  if (coverUrl) {
    try {
      const cover = await fetchCoverBuffer(coverUrl)
      const mime = inferCoverMime(cover.buffer, cover.contentType, coverUrl.toString())
      if (mime) {
        coverBuffer = cover.buffer
        coverMime = mime
      } else {
        console.warn(`跳过封面写入：封面类型不支持（${cover.contentType || 'unknown'}）`)
      }
    } catch (error) {
      console.warn('下载封面失败:', error && error.message ? error.message : error)
    }
  }

  if (format === 'mp3') {
    if (!NodeID3) {
      console.warn('跳过标签写入：node-id3 不可用')
      return result
    }
    const tags = { comment: { language: 'XXX', text: 'Hydrogen Music' } }
    if (title) tags.title = title
    if (artists.length) tags.artist = artists.join(' / ')
    if (album) tags.album = album
    if (lyricText) tags.userDefinedText = [{ description: 'LYRICS', value: lyricText }]
    if (coverBuffer) {
      tags.image = {
        mime: coverMime,
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: coverBuffer,
      }
    }
    NodeID3.update(tags, filePath)
    result.tagsWritten = true
    result.coverEmbedded = !!coverBuffer
    result.lyricsEmbedded = !!lyricText
    return result
  }

  if (format === 'flac') {
    if (!Metaflac) {
      console.warn('跳过标签写入：metaflac-js 不可用')
      return result
    }
    const flac = new Metaflac(filePath)
    if (title) flac.setTag(`TITLE=${title}`)
    if (album) flac.setTag(`ALBUM=${album}`)
    artists.forEach(artist => { try { flac.setTag(`ARTIST=${artist}`) } catch (_) {} })
    if (lyricText) {
      try { flac.setTag(`LYRICS=${lyricText}`) } catch (_) {}
    }
    if (coverBuffer) {
      try {
        flac.importPictureFromBuffer(coverBuffer)
        result.coverEmbedded = true
      } catch (error) {
        console.warn('写入FLAC封面失败:', error && error.message ? error.message : error)
      }
    }
    try {
      flac.save()
      result.tagsWritten = true
      result.lyricsEmbedded = !!lyricText
    } catch (error) {
      console.warn('写入FLAC标签失败:', error && error.message ? error.message : error)
    }
    return result
  }

  console.warn(`跳过标签写入：暂不支持 ${format || 'unknown'} 格式`)
  return result
}

module.exports = {
  registerDownloadTag,
  takeDownloadTag,
  resolveDownloadExtension,
  writeAudioTags,
  clearPendingDownloadTags() { pendingTags.clear() },
}
