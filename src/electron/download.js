const { ipcMain } = require('electron')
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const axios = require('axios')
const Store = require('electron-store').default

// 桌面端远程下载：把远程音频地址流式写入「设置里的下载目录」。
// 仅保留最小能力（目录创建 / 重名避让 / 超时 / 错误返回），不再有队列、进度条与持久化。
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000
const MAX_TIMEOUT_MS = 10 * 60 * 1000
const MAX_FILENAME_LENGTH = 150
const MAX_REDIRECTS = 5

const moduleState = {
  initialized: false,
  win: null,
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

function sanitizeFileName(value) {
  const text = String(value || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, MAX_FILENAME_LENGTH)
  return text || 'Hydrogen Music'
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

async function findAvailableFilePath(destDir, fileName) {
  const parsed = path.parse(fileName)
  let candidateName = fileName
  let suffix = 1
  while (await pathExists(path.join(destDir, candidateName))) {
    candidateName = `${parsed.name} (${suffix++})${parsed.ext}`
  }
  return path.join(destDir, candidateName)
}

// 流式写盘：不把整个文件读进内存，出错时清理半成品文件。
function streamUrlToFile(url, targetPath, timeout) {
  return axios({
    url,
    method: 'get',
    responseType: 'stream',
    timeout,
    maxRedirects: MAX_REDIRECTS,
    validateStatus: status => status >= 200 && status < 300,
  }).then(response => new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(targetPath)
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

    if (response.data && typeof response.data.on === 'function') {
      response.data.on('error', finish)
      response.data.pipe(writer)
    } else {
      finish(new Error('download-stream-unavailable'))
      return
    }

    writer.on('error', finish)
    writer.on('finish', () => finish())
  }))
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
    const fileName = sanitizeFileName(payload.filename)

    try {
      await ensureDirectory(targetDir)
      const targetPath = await findAvailableFilePath(targetDir, fileName)
      await streamUrlToFile(parsedUrl.toString(), targetPath, normalizeTimeout(payload.timeout))
      return { ok: true, path: targetPath }
    } catch (error) {
      const code = error?.code
      const timedOut = code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT'
      return {
        ok: false,
        error: timedOut ? 'timeout' : (error?.message || 'downloadFailed'),
      }
    }
  })

  return {
    setWindow(nextWin) {
      moduleState.win = nextWin
    },
  }
}