const { ipcMain } = require('electron')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const axios = require('axios')
const Store = require('electron-store').default
const { spawn } = require('child_process')
const {
  sanitizeBaseName,
  normalizeDownloadExtension,
  buildDownloadFileName,
  buildCombinedLrcText,
  buildUnsyncedLyricText,
  hasTimedLyricText,
} = require('./downloadText')

let NodeID3 = null
let Metaflac = null
let ffmpegPath = null
try { NodeID3 = require('node-id3') } catch (_) { NodeID3 = null }
try { Metaflac = require('metaflac-js') } catch (_) { Metaflac = null }
try { ffmpegPath = require('ffmpeg-static') } catch (_) { ffmpegPath = null }

// 桌面端远程下载：把远程音频地址流式写入「设置里的下载目录」。
// 仍然没有队列：渲染层逐首调用 download-to-folder，主进程只负责单次落盘、进度上报、
// 取消（AbortController）与基础标签/封面/歌词写入。
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000
const MAX_REDIRECTS = 5
const COVER_TRANSCODE_TIMEOUT_MS = 10000

const moduleState = {
  initialized: false,
  win: null,
}

// 下载 id -> AbortController，用于渲染层按下载 id 取消
const activeDownloads = new Map()

function getActiveWindow() {
  return moduleState.win
}

function sendToRenderer(channel, payload) {
  const win = getActiveWindow()
  if (!win || win.isDestroyed?.()) return
  if (!win.webContents || win.webContents.isDestroyed?.()) return
  if (typeof payload === 'undefined') win.webContents.send(channel)
  else win.webContents.send(channel, payload)
}

function normalizeTimeout(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(Math.round(parsed), MAX_TIMEOUT_MS)
}

function parseHttpUrl(value) {
  try {
    const parsedUrl = new URL(String(value || '').trim())
    if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') return parsedUrl
  } catch (_) {}
  return null
}

function isPrivateNetworkHost(hostname) {
  const normalizedHost = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '')

  if (!normalizedHost) return true
  if (normalizedHost === 'localhost' || normalizedHost.endsWith('.localhost') || normalizedHost.endsWith('.local')) return true
  if (normalizedHost.includes(':')) return true
  if (!normalizedHost.includes('.')) return true

  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedHost)) return false

  const octets = normalizedHost.split('.').map(part => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return true

  const [first, second] = octets
  if (first === 0 || first === 10 || first === 127) return true
  if (first === 169 && second === 254) return true
  if (first === 172 && second >= 16 && second <= 31) return true
  if (first === 192 && second === 168) return true
  if (first === 100 && second >= 64 && second <= 127) return true
  if (first === 198 && (second === 18 || second === 19)) return true
  if (first >= 224) return true
  return false
}

function parseSafeRemoteUrl(value) {
  const parsedUrl = parseHttpUrl(value)
  if (!parsedUrl) return null
  return isPrivateNetworkHost(parsedUrl.hostname) ? null : parsedUrl
}

async function pathExists(targetPath) {
  try {
    await fsp.access(targetPath)
    return true
  } catch (_) {
    return false
  }
}

async function ensureDirectory(targetPath) {
  await fsp.mkdir(targetPath, { recursive: true })
}

async function isDirectory(targetPath) {
  try {
    const stat = await fsp.stat(targetPath)
    return stat.isDirectory()
  } catch (_) {
    return false
  }
}

async function findAvailableDirectoryPath(basePath) {
  let candidatePath = basePath
  let suffix = 1
  while (await pathExists(candidatePath)) {
    if (await isDirectory(candidatePath)) return candidatePath
    candidatePath = `${basePath} (${suffix++})`
  }
  return candidatePath
}

async function findAvailableFilePath(destDir, fileName) {
  const parsed = path.parse(fileName)
  let candidateName = fileName
  let suffix = 1
  while (await pathExists(path.join(destDir, candidateName))) {
    candidateName = `${parsed.name} (${suffix++})${parsed.ext}`
  }
  return path.join(destDir, candidateName)
}

// 流式写盘：不把整个文件读进内存，出错/取消时清理半成品文件。
function streamUrlToFile(url, targetPath, timeout, signal, onProgress) {
  return axios({
    url,
    method: 'get',
    responseType: 'stream',
    timeout,
    maxRedirects: MAX_REDIRECTS,
    signal,
    validateStatus: status => status >= 200 && status < 300,
  }).then(response => new Promise((resolve, reject) => {
    const totalBytes = Number(response.headers && response.headers['content-length']) || 0
    const writer = fs.createWriteStream(targetPath)
    let receivedBytes = 0
    let lastPercent = -1
    let settled = false

    const finish = error => {
      if (settled) return
      settled = true
      if (!error) {
        resolve()
        return
      }
      try { writer.destroy() } catch (_) {}
      fsp.unlink(targetPath).catch(() => {})
      reject(error)
    }

    if (!response.data || typeof response.data.on !== 'function') {
      finish(new Error('download-stream-unavailable'))
      return
    }

    response.data.on('data', chunk => {
      receivedBytes += (chunk && chunk.length) || 0
      if (totalBytes <= 0 || typeof onProgress !== 'function') return
      const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
      if (percent === lastPercent) return
      lastPercent = percent
      onProgress(percent)
    })
    response.data.on('error', finish)
    response.data.pipe(writer)
    writer.on('error', finish)
    writer.on('finish', () => finish())
  }))
}

function inferCoverImageMime(buffer, contentType = '', sourceUrl = '') {
  const headerMime = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (headerMime === 'image/png' || headerMime === 'image/jpeg' || headerMime === 'image/jpg' || headerMime === 'image/webp') {
    return headerMime === 'image/jpg' ? 'image/jpeg' : headerMime
  }

  const buf = Buffer.from(buffer || [])
  if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png'
  if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'

  const lowerUrl = String(sourceUrl || '').split('?')[0].toLowerCase()
  if (lowerUrl.endsWith('.png')) return 'image/png'
  if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerUrl.endsWith('.webp')) return 'image/webp'

  return ''
}

function convertCoverWithFfmpeg(buffer) {
  if (!ffmpegPath) return Promise.resolve(null)

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-frames:v', '1',
      '-f', 'image2pipe',
      '-vcodec', 'png',
      'pipe:1',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdoutChunks = []
    const stderrChunks = []
    let settled = false

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(value)
    }

    const timeout = setTimeout(() => {
      try { child.kill() } catch (_) {}
      finish(new Error('cover transcode timed out'))
    }, COVER_TRANSCODE_TIMEOUT_MS)

    child.stdout.on('data', chunk => stdoutChunks.push(chunk))
    child.stderr.on('data', chunk => stderrChunks.push(chunk))
    child.stdin.on('error', () => {})
    child.on('error', error => finish(error))
    child.on('close', code => {
      if (settled) return

      const output = Buffer.concat(stdoutChunks)
      if (code === 0 && output.length > 0) {
        finish(null, { buffer: output, mime: 'image/png' })
        return
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      finish(new Error(stderr || `ffmpeg exited with code ${code}`))
    })

    child.stdin.end(buffer)
  })
}

async function prepareCoverForEmbedding(buffer, contentType, sourceUrl) {
  const mime = inferCoverImageMime(buffer, contentType, sourceUrl)
  if (mime === 'image/png' || mime === 'image/jpeg') {
    return { buffer, mime }
  }

  try {
    const converted = await convertCoverWithFfmpeg(buffer)
    if (converted) return converted
  } catch (error) {
    console.warn('封面转码失败，将尝试原图内嵌:', error && error.message ? error.message : error)
  }

  return { buffer, mime }
}

async function writeLyricFileIfNeeded(lrcPath, lrcText) {
  if (!lrcText || !lrcText.trim()) return
  if (await pathExists(lrcPath)) return
  try {
    await fsp.writeFile(lrcPath, lrcText, 'utf8')
  } catch (error) {
    console.warn('写入歌词文件失败:', error && error.message ? error.message : error)
  }
}

// 下载完成后写入基础标签、内嵌封面与歌词（MP3 走 node-id3，FLAC 走 metaflac-js，其余格式跳过并记录原因）。
async function finalizeDownloadMetadata(audioPath, payload, settings) {
  const parsed = path.parse(audioPath)
  const extension = (parsed.ext || '').toLowerCase()
  const artists = Array.isArray(payload?.artists) ? payload.artists.filter(Boolean) : []
  const album = typeof payload?.album === 'string' ? payload.album : ''
  const title = String(payload?.name || parsed.name)
  const lyrics = payload?.lyrics || null
  const coverUrl = parseSafeRemoteUrl(payload?.coverUrl)?.toString() || null
  const saveLyricFile = settings?.local?.downloadSaveLyricFile === true

  if (lyrics && (lyrics.lrc || lyrics.tlyric || lyrics.romalrc)) {
    const lyricMeta = { name: title, artists, album }
    const lrcText = buildCombinedLrcText(lyrics, lyricMeta)
    if (saveLyricFile) {
      await writeLyricFileIfNeeded(path.join(parsed.dir, parsed.name + '.lrc'), lrcText)
    }

    try {
      const timedLrcText = buildCombinedLrcText(lyrics, lyricMeta, { includeByTag: false })
      const fallbackPlainText = buildUnsyncedLyricText(lyrics)
      const lyricTextForEmbed = (hasTimedLyricText(timedLrcText) ? timedLrcText : fallbackPlainText) || ''
      if (lyricTextForEmbed && lyricTextForEmbed.trim().length > 0) {
        if (NodeID3 && extension === '.mp3') {
          NodeID3.update({ userDefinedText: [{ description: 'LYRICS', value: lyricTextForEmbed }] }, audioPath)
        } else if (Metaflac && extension === '.flac') {
          const flac = new Metaflac(audioPath)
          try { flac.setTag(`LYRICS=${lyricTextForEmbed}`) } catch (_) {}
          try { flac.save() } catch (_) {}
        } else {
          console.warn(`跳过歌词标签写入：暂不支持 ${extension || 'unknown'} 格式`)
        }
      }
    } catch (error) {
      console.warn('写入歌词到标签失败:', error && error.message ? error.message : error)
    }
  }

  if (coverUrl) {
    try {
      const response = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 15000 })
      const coverBuffer = Buffer.from(response.data)
      const contentType = (response.headers && response.headers['content-type']) || ''
      const preparedCover = await prepareCoverForEmbedding(coverBuffer, contentType, coverUrl)
      const embedBuffer = preparedCover.buffer
      const embedMime = preparedCover.mime || 'image/jpeg'
      const isPngEmbed = (embedMime || '').includes('png')
      const isJpegEmbed = (embedMime || '').includes('jpeg') || (embedMime || '').includes('jpg')

      if (NodeID3 && extension === '.mp3') {
        NodeID3.update({ image: { mime: embedMime, type: { id: 3, name: 'front cover' }, description: 'Cover', imageBuffer: embedBuffer } }, audioPath)
      } else if (Metaflac && extension === '.flac') {
        if (isPngEmbed || isJpegEmbed) {
          try {
            const flac = new Metaflac(audioPath)
            flac.importPictureFromBuffer(embedBuffer)
            flac.save()
          } catch (error) {
            console.warn('写入FLAC封面失败:', error && error.message ? error.message : error)
          }
        } else {
          console.warn('FLAC 封面未写入：需要 PNG/JPEG，但当前类型为', embedMime || 'unknown')
        }
      } else {
        console.warn(`跳过封面写入：暂不支持 ${extension || 'unknown'} 格式`)
      }
    } catch (error) {
      console.warn('下载封面失败:', error && error.message ? error.message : error)
    }
  }

  try {
    if (NodeID3 && extension === '.mp3') {
      NodeID3.update({
        title,
        artist: artists.join(' / '),
        album,
        comment: { language: 'XXX', text: 'Hydrogen Music' },
      }, audioPath)
    } else if (Metaflac && extension === '.flac') {
      const flac = new Metaflac(audioPath)
      if (title) flac.setTag(`TITLE=${title}`)
      if (album) flac.setTag(`ALBUM=${album}`)
      artists.forEach(artist => { try { if (artist) flac.setTag(`ARTIST=${artist}`) } catch (_) {} })
      try { flac.save() } catch (error) {
        console.warn('写入FLAC基础标签失败:', error && error.message ? error.message : error)
      }
    } else {
      console.warn(`跳过基础标签写入：暂不支持 ${extension || 'unknown'} 格式`)
    }
  } catch (error) {
    console.warn('写入基础标签失败:', error && error.message ? error.message : error)
  }
}

module.exports = MusicDownload = (win) => {
  moduleState.win = win

  if (moduleState.initialized) {
    return {
      setWindow(nextWin) {
        moduleState.win = nextWin
      },
    }
  }

  moduleState.initialized = true
  const settingsStore = new Store({ name: 'settings' })

  ipcMain.removeHandler('download-to-folder')
  ipcMain.handle('download-to-folder', async (_event, payload = {}) => {
    const downloadId = String(payload?.id || '')
    const parsedUrl = parseSafeRemoteUrl(payload.url)
    if (!parsedUrl) return { ok: false, error: 'invalidDownloadUrl' }

    let settings = null
    try {
      settings = await settingsStore.get('settings')
    } catch (_) {
      settings = null
    }

    const downloadFolder = settings?.local?.downloadFolder
    if (typeof downloadFolder !== 'string' || !downloadFolder.trim()) {
      return { ok: false, error: 'noSavePath' }
    }

    const targetDir = path.resolve(downloadFolder.trim())
    const rawExtension = payload.type || path.extname(String(payload.filename || '')).replace(/^\./, '')
    const extension = normalizeDownloadExtension(rawExtension)
    const fileName = buildDownloadFileName(payload, extension)

    const controller = new AbortController()
    if (downloadId) activeDownloads.set(downloadId, controller)

    let lastSentPercent = -1
    const reportProgress = percent => {
      const value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)))
      if (value === lastSentPercent) return
      lastSentPercent = value
      sendToRenderer('download-progress', { id: downloadId, progress: value })
    }

    try {
      const createSongFolder = settings?.local?.downloadCreateSongFolder === true
      let targetPath

      if (createSongFolder) {
        const folderPath = await findAvailableDirectoryPath(path.join(targetDir, sanitizeBaseName(payload.name || path.parse(fileName).name)))
        await ensureDirectory(folderPath)
        targetPath = await findAvailableFilePath(folderPath, fileName)
      } else {
        await ensureDirectory(targetDir)
        targetPath = await findAvailableFilePath(targetDir, fileName)
      }

      reportProgress(0)
      await streamUrlToFile(parsedUrl.toString(), targetPath, normalizeTimeout(payload.timeout), controller.signal, reportProgress)

      try {
        await finalizeDownloadMetadata(targetPath, payload, settings)
      } catch (error) {
        console.warn('处理下载元数据失败:', error && error.message ? error.message : error)
      }

      reportProgress(100)
      return { ok: true, path: targetPath }
    } catch (error) {
      const code = error?.code
      const cancelled = code === 'ERR_CANCELED' || controller.signal.aborted
      const timedOut = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT'
      return {
        ok: false,
        error: cancelled ? 'cancelled' : (timedOut ? 'timeout' : (error?.message || 'downloadFailed')),
      }
    } finally {
      if (downloadId) activeDownloads.delete(downloadId)
    }
  })

  // 渲染层按下载 id 中止当前下载
  ipcMain.on('download-cancel', (_event, downloadId) => {
    const controller = activeDownloads.get(String(downloadId || ''))
    if (!controller) return
    try { controller.abort() } catch (_) {}
  })

  return {
    setWindow(nextWin) {
      moduleState.win = nextWin
    },
  }
}