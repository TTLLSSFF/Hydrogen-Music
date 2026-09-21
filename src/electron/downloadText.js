// 下载相关的纯逻辑（文件命名 / 歌词文本构建），从旧 download.js 抽出，便于单独测试。
const path = require('path')

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i
const MAX_BASE_NAME_LENGTH = 120

function sanitizeBaseName(value, fallback = 'Hydrogen Music') {
  const normalized = String(value ?? '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, MAX_BASE_NAME_LENGTH)

  if (!normalized) return fallback
  if (RESERVED_WINDOWS_NAMES.test(normalized)) return `_${normalized}`
  return normalized
}

function normalizeDownloadExtension(value, fallback = 'mp3') {
  const normalized = String(value || '')
    .trim()
    .replace(/^\./, '')
    .toLowerCase()
  return /^[a-z0-9]{1,8}$/.test(normalized) ? normalized : fallback
}

function buildDownloadFileName(payload = {}, extension) {
  const rawName = String(payload.name || '').trim()
  const fallbackName = rawName || path.parse(String(payload.filename || '')).name
  const title = sanitizeBaseName(fallbackName)
  const artists = Array.isArray(payload.artists)
    ? payload.artists.map(artist => sanitizeBaseName(artist, '')).filter(Boolean)
    : []
  const artistPart = artists.length ? ` - ${sanitizeBaseName(artists.join(', '), '')}` : ''
  return `${title}${artistPart}.${normalizeDownloadExtension(extension)}`
}

function hasTimedLyricText(text) {
  return typeof text === 'string' && /\[\d{1,3}[:：.\uFF0E\u3002,，;；/\-_\s]\s*\d{1,2}/.test(text)
}

function buildCombinedLrcText(lyricPayload, meta, options = {}) {
  try {
    const includeTranslation = options.includeTranslation !== false
    const includeRomaji = options.includeRomaji !== false
    const includeByTag = options.includeByTag !== false
    const timeTag = /\[(\d{1,3})\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,2})(?:\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,3}))?\]/g
    const timeTagSingle = /\[(\d{1,3})\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,2})(?:\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,3}))?\]/
    const lrcMetadataTagLine = /^\s*\[(?:ar|ti|al|by|offset|re|ve|au|length|language|lang)\s*:[^\]]*\]\s*$/i

    const extractUntimedPreludeLines = (text) => {
      const out = []
      if (!text || typeof text !== 'string') return out
      const lines = text.split(/\r?\n/)
      for (const raw of lines) {
        if (typeof raw !== 'string') continue
        if (timeTagSingle.test(raw)) break
        const line = raw.trim()
        if (!line) continue
        if (lrcMetadataTagLine.test(line)) continue
        out.push(line)
      }
      return out
    }

    const parseLines = (text) => {
      const map = new Map()
      if (!text || typeof text !== 'string') return map
      const lines = text.split(/\r?\n/)
      for (const raw of lines) {
        if (!raw) continue
        const tags = Array.from(raw.matchAll(timeTag))
        if (!tags || tags.length === 0) continue
        const lyricText = raw.replace(timeTag, '').trim()
        if (!lyricText) continue
        for (const m of tags) {
          const mm = parseInt(m[1] || '0', 10)
          const ss = parseInt(m[2] || '0', 10)
          const ms = m[3] ? parseInt((m[3] + '00').slice(0, 3), 10) : 0
          const t = mm * 60 + ss + ms / 1000
          const key = t.toFixed(3)
          const arr = map.get(key) || []
          arr.push(lyricText)
          map.set(key, arr)
        }
      }
      return map
    }

    const preludeLines = extractUntimedPreludeLines(lyricPayload && lyricPayload.lrc)
    const oMap = parseLines(lyricPayload.lrc)
    const tMap = parseLines(lyricPayload.tlyric)
    const rMap = parseLines(lyricPayload.romalrc)

    const allKeysSet = new Set([...oMap.keys(), ...tMap.keys(), ...rMap.keys()])
    const allTimes = Array.from(allKeysSet).map(k => Number(k)).sort((a, b) => a - b)

    const formatTag = (sec) => {
      const m = Math.floor(sec / 60)
      const s = Math.floor(sec % 60)
      const ms = Math.round((sec - Math.floor(sec)) * 1000)
      const mm = String(m).padStart(2, '0')
      const ss = String(s).padStart(2, '0')
      const mmm = String(ms).padStart(3, '0')
      return `[${mm}:${ss}.${mmm}]`
    }

    let out = ''
    if (includeByTag) out += '[by:Hydrogen Music]\n'
    if (meta && (meta.name || (meta.artists && meta.artists.length) || meta.album)) {
      if (meta.name) out += `[ti:${meta.name}]\n`
      if (Array.isArray(meta.artists) && meta.artists.length) out += `[ar:${meta.artists.join(' / ')}]\n`
      if (meta.album) out += `[al:${meta.album}]\n`
    }
    for (const line of preludeLines) {
      out += `${line}\n`
    }
    for (const t of allTimes) {
      const key = t.toFixed(3)
      const oList = oMap.get(key) || []
      const trList = tMap.get(key) || []
      const rList = rMap.get(key) || []
      for (const o of oList) out += `${formatTag(t)}${o}\n`
      if (includeTranslation) {
        for (const tr of trList) out += `${formatTag(t)}${tr}\n`
      }
      if (includeRomaji) {
        for (const r of rList) out += `${formatTag(t)}${r}\n`
      }
    }
    return out
  } catch (_) {
    return ''
  }
}

// 生成无时间戳的纯文本歌词（用于内嵌到 MP3/FLAC 标签中）
function buildUnsyncedLyricText(lyricPayload) {
  try {
    const combined = buildCombinedLrcText(lyricPayload, null) || ''
    return combined
      .replace(/\[[^\]]+\]/g, '')
      .replace(/[\t ]+/g, ' ')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter((line) => !!line)
      .join('\n')
  } catch (_) {
    return ''
  }
}

module.exports = {
  sanitizeBaseName,
  normalizeDownloadExtension,
  buildDownloadFileName,
  hasTimedLyricText,
  buildCombinedLrcText,
  buildUnsyncedLyricText,
}