// 同时启动网易云音乐 API Enhanced 与静态文件服务，
// 让 Web 部署只需一个命令即可运行。
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pipeline } = require('stream')

const API_PORT = 36530
const QQ_API_PORT = Number(process.env.QQ_API_PORT || 3200)
const WEB_PORT = process.env.PORT || 30000
const DIST_DIR = path.join(__dirname, 'dist')
const {
  hasSensitiveQQQuery,
  sanitizeQQProxyRequestHeaders,
  sanitizeQQProxyResponseHeaders,
} = require('./server/qqMusicApi.cjs')
const {
  registerDownloadTag,
  takeDownloadTag,
  resolveDownloadExtension,
  writeAudioTags,
} = require('./server/downloadTags.cjs')

const fsp = fs.promises
// 下载标签元数据（含歌词）体积上限，防止超大请求体打爆内存
const DOWNLOAD_TAGS_MAX_BYTES = 256 * 1024

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
}

function resolveStaticPath(requestUrl, distDir = DIST_DIR) {
  const rawPath = String(requestUrl || '').split('?')[0]
  let decodedPath
  try {
    decodedPath = decodeURIComponent(rawPath)
    // Decode repeatedly so double-encoded traversal cannot evade containment.
    for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(decodedPath); i += 1) {
      const next = decodeURIComponent(decodedPath)
      if (next === decodedPath) break
      decodedPath = next
    }
  } catch (_) {
    return null
  }

  if (
    !decodedPath.startsWith('/') ||
    decodedPath.startsWith('//') ||
    /^\/[a-z]:[\\/]/i.test(decodedPath) ||
    decodedPath.includes('\\') ||
    decodedPath.split('/').includes('..') ||
    /[\u0000-\u001f\u007f]/.test(decodedPath)
  ) return null
  const rootPath = path.resolve(distDir)
  const safePath = decodedPath === '/' ? '/index.html' : decodedPath
  const candidate = path.resolve(rootPath, `.${safePath}`)
  const relative = path.relative(rootPath, candidate)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return candidate
}

function serveStatic(req, res, distDir = DIST_DIR) {
  const urlPath = req.url.split('?')[0]
  const filePath = resolveStaticPath(req.url, distDir)
  if (!filePath) {
    res.writeHead(404)
    res.end('Not found')
    return
  }
  const ext = path.extname(filePath).toLowerCase()
  const contentType = mimeTypes[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // 只有「导航请求」才回退到 index.html。构建后旧 index.html 会去请求已被
        // 删除的带 hash 分块，如果这里对 .js 请求也返回 HTML，浏览器会把 HTML
        // 当模块解析并抛出 SyntaxError，表现为某个路由整页空白且报错难懂。
        // 静态资源缺失必须如实回 404。
        const isAssetRequest = ext !== '' && ext !== '.html'
        if (isAssetRequest) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end('Not found')
          return
        }
        const fallbackPath = resolveStaticPath('/index.html', distDir)
        fs.readFile(fallbackPath, (err2, content2) => {
          if (err2) {
            res.writeHead(404)
            res.end('Not found')
          } else {
            // index.html 必须每次校验，否则重建后浏览器仍拿旧分块哈希。
            res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' })
            res.end(content2)
          }
        })
      } else {
        console.error('Static file error')
        res.writeHead(500)
        res.end('Server error')
      }
      return
    }
    // 带 hash 的静态资源可以长期缓存；index.html 永远不缓存（见上）。
    const isHashedAsset = /-[A-Za-z0-9_-]{8,}\.(?:js|css)$/.test(filePath)
    res.writeHead(200, {
      'Content-Type': contentType,
      ...(isHashedAsset ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : { 'Cache-Control': 'no-cache' }),
    })
    res.end(content)
  })
}

function pipeToResponse(readable, res) {
  if (res.destroyed || res.writableEnded) {
    readable.destroy()
    return
  }

  pipeline(readable, res, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ERR_STREAM_UNABLE_TO_PIPE') {
      console.error('Proxy response stream error:', err)
    }
  })
}

function sendProxyError(res, message) {
  if (res.destroyed || res.writableEnded || res.headersSent) return
  res.writeHead(502)
  res.end(message)
}

function sanitizeDownloadFileName(value) {
  return String(value || 'Hydrogen Music')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160) || 'Hydrogen Music'
}

function getContentDispositionFileName(filename) {
  const safeName = sanitizeDownloadFileName(filename)
  const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'")
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
}

// QQ 播放地址的回源来源应为 y.qq.com；直接用流域名（如 isure.stream.qqmusic.qq.com）
// 作为 Referer 属于错误来源，可能被上游拒绝。
function resolveDownloadReferer(parsedTarget) {
  const host = String(parsedTarget?.hostname || '').toLowerCase()
  if (host === 'qq.com' || host.endsWith('.qq.com')) return 'https://y.qq.com/'
  return parsedTarget.origin
}

// 浏览器先把下载元数据 POST 到这里换成一次性 token，再用 /download-proxy?tags=<token>
// 触发下载，服务端下载落盘后写入音频标签再回传文件。
function handleDownloadTags(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: 'method not allowed' }))
    return
  }

  const chunks = []
  let size = 0
  let tooLarge = false

  req.on('data', (chunk) => {
    if (tooLarge) return
    size += chunk.length
    if (size > DOWNLOAD_TAGS_MAX_BYTES) {
      // 超限后不再缓存多余数据，但继续消费完请求体，否则客户端只会看到连接被重置
      tooLarge = true
      chunks.length = 0
      return
    }
    chunks.push(chunk)
  })

  req.on('error', () => {
    tooLarge = true
  })

  req.on('end', () => {
    if (res.destroyed || res.writableEnded) return
    if (tooLarge) {
      const status = size > DOWNLOAD_TAGS_MAX_BYTES ? 413 : 400
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: status === 413 ? 'metadata too large' : 'invalid request' }))
      return
    }

    let metadata = null
    try {
      metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (_) {
      metadata = null
    }

    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ error: 'invalid metadata' }))
      return
    }

    const token = registerDownloadTag(metadata)
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ token }))
  })
}

// 把远端音频完整落到本地文件，返回上游的 Content-Type 供回传时复用。
function fetchUrlToFile(targetUrl, filePath, req, res, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('too many download redirects'))
      return
    }

    let parsedTarget = null
    try {
      parsedTarget = new URL(targetUrl)
      if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
        throw new Error('unsupported protocol')
      }
    } catch (error) {
      reject(error)
      return
    }

    const transport = parsedTarget.protocol === 'https:' ? https : http
    const proxyReq = transport.request(parsedTarget, {
      method: 'GET',
      headers: {
        'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
        Accept: 'audio/*,*/*',
        Referer: resolveDownloadReferer(parsedTarget),
      },
    }, (proxyRes) => {
      const redirectLocation = proxyRes.headers.location
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && redirectLocation) {
        proxyRes.resume()
        const nextUrl = new URL(redirectLocation, parsedTarget).toString()
        fetchUrlToFile(nextUrl, filePath, req, res, redirectCount + 1).then(resolve, reject)
        return
      }

      if (proxyRes.statusCode && (proxyRes.statusCode < 200 || proxyRes.statusCode >= 300)) {
        proxyRes.resume()
        reject(new Error(`download status ${proxyRes.statusCode}`))
        return
      }

      const writeStream = fs.createWriteStream(filePath)
      pipeline(proxyRes, writeStream, (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ contentType: proxyRes.headers['content-type'] || 'application/octet-stream' })
      })
    })

    res.on('close', () => proxyReq.destroy())
    proxyReq.on('error', reject)
    proxyReq.end()
  })
}

// 带标签的下载：先落临时文件 → 写 ID3/FLAC 标签 → 回传 → 清理临时目录。
// 写标签失败不影响下载本身，仍回传原始音频。
async function proxyDownloadWithTags(targetUrl, filename, metadata, req, res) {
  let tempDir = ''

  try {
    let parsedTarget = null
    try {
      parsedTarget = new URL(targetUrl)
      if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
        throw new Error('unsupported protocol')
      }
    } catch (_) {
      res.writeHead(400)
      res.end('Invalid download url')
      return
    }

    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hydrogen-download-'))
    const format = resolveDownloadExtension(metadata, filename)
    const tempFile = path.join(tempDir, format ? `audio.${format}` : 'audio')

    const { contentType } = await fetchUrlToFile(targetUrl, tempFile, req, res)

    try {
      await writeAudioTags(tempFile, metadata)
    } catch (error) {
      console.warn('写入下载标签失败:', error && error.message ? error.message : error)
    }

    if (res.destroyed || res.writableEnded) return

    const stat = await fsp.stat(tempFile)
    res.writeHead(200, {
      'Content-Type': format === 'mp3' ? 'audio/mpeg' : contentType,
      'Content-Length': String(stat.size),
      'Content-Disposition': getContentDispositionFileName(filename || path.basename(parsedTarget.pathname) || 'Hydrogen Music'),
      'Cache-Control': 'no-store',
    })

    await new Promise((resolve) => {
      pipeline(fs.createReadStream(tempFile), res, () => resolve())
    })
  } catch (error) {
    if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('Download proxy (tags) error:', error)
    }
    sendProxyError(res, 'Download unavailable')
  } finally {
    if (tempDir) {
      fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

function proxyDownloadUrl(targetUrl, filename, req, res, redirectCount = 0) {
  if (redirectCount > 5) {
    sendProxyError(res, 'Too many download redirects')
    return
  }

  let parsedTarget = null
  try {
    parsedTarget = new URL(targetUrl)
    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
  } catch (_) {
    res.writeHead(400)
    res.end('Invalid download url')
    return
  }

  const transport = parsedTarget.protocol === 'https:' ? https : http
  const proxyReq = transport.request(parsedTarget, {
    method: 'GET',
    headers: {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0',
      Accept: 'audio/*,*/*',
      Referer: resolveDownloadReferer(parsedTarget),
    },
  }, (proxyRes) => {
    if (res.destroyed || res.writableEnded) {
      proxyRes.destroy()
      return
    }

    const redirectLocation = proxyRes.headers.location
    if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && redirectLocation) {
      proxyRes.resume()
      const nextUrl = new URL(redirectLocation, parsedTarget).toString()
      proxyDownloadUrl(nextUrl, filename, req, res, redirectCount + 1)
      return
    }

    const headers = {
      'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
      'Content-Disposition': getContentDispositionFileName(filename || path.basename(parsedTarget.pathname) || 'Hydrogen Music'),
      'Cache-Control': 'no-store',
    }
    if (proxyRes.headers['content-length']) headers['Content-Length'] = proxyRes.headers['content-length']
    res.writeHead(proxyRes.statusCode || 200, headers)
    pipeToResponse(proxyRes, res)
  })

  res.on('close', () => proxyReq.destroy())
  proxyReq.on('error', (err) => {
    if (err.code !== 'ECONNRESET') console.error('Download proxy error:', err)
    sendProxyError(res, 'Download unavailable')
  })
  proxyReq.end()
}

function proxyDownload(req, res) {
  let targetUrl = ''
  let filename = ''
  let tagToken = ''
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    targetUrl = requestUrl.searchParams.get('url') || ''
    filename = requestUrl.searchParams.get('filename') || ''
    tagToken = requestUrl.searchParams.get('tags') || ''
  } catch (_) {
    res.writeHead(400)
    res.end('Invalid download url')
    return
  }

  // token 一次性消费：拿到元数据就走落盘写标签流程，否则保持零拷贝流式转发。
  const tagMetadata = tagToken ? takeDownloadTag(tagToken) : null
  if (tagMetadata) {
    proxyDownloadWithTags(targetUrl, filename, tagMetadata, req, res)
    return
  }

  proxyDownloadUrl(targetUrl, filename, req, res)
}

function proxyToApi(req, res) {
  const [rawPath, query] = req.url.split('?')
  const isQQ = /^\/api\/qq(?:\/|$)/i.test(rawPath)
  const targetPath = (isQQ ? rawPath.replace(/^\/api\/qq/i, '') : rawPath.replace(/^\/api/, '')) || '/'
  const targetPort = isQQ ? QQ_API_PORT : API_PORT
  if (isQQ && hasSensitiveQQQuery(req.url)) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify({ error: 'QQ credentials are server-managed and cannot be supplied in the URL' }))
    return
  }
  const forwardedHeaders = isQQ ? sanitizeQQProxyRequestHeaders(req.headers) : { ...req.headers }
  const options = {
    hostname: '127.0.0.1',
    port: targetPort,
    path: targetPath + (query ? '?' + query : ''),
    method: req.method,
    headers: { ...forwardedHeaders, host: `127.0.0.1:${targetPort}` },
  }

  const proxyReq = http.request(options, (proxyRes) => {
    if (res.destroyed || res.writableEnded) {
      proxyRes.destroy()
      return
    }
    const responseHeaders = isQQ ? sanitizeQQProxyResponseHeaders(proxyRes.headers) : proxyRes.headers
    res.writeHead(proxyRes.statusCode, responseHeaders)
    pipeToResponse(proxyRes, res)
  })

  res.on('close', () => proxyReq.destroy())
  proxyReq.on('error', (err) => {
    if (err.code !== 'ECONNRESET') console.error('API proxy error:', err)
    sendProxyError(res, 'API service unavailable')
  })

  pipeline(req, proxyReq, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ECONNRESET') {
      console.error('API request stream error:', err)
    }
  })
}

function proxyToSiren(req, res) {
  const [rawPath, query] = req.url.split('?')
  const targetPath = rawPath.replace(/^\/siren-api/, '') || '/'
  const options = {
    hostname: 'monster-siren.hypergryph.com',
    port: 443,
    path: '/api' + targetPath + (query ? '?' + query : ''),
    method: req.method,
    headers: { ...req.headers, host: 'monster-siren.hypergryph.com' },
  }

  const proxyReq = https.request(options, (proxyRes) => {
    if (res.destroyed || res.writableEnded) {
      proxyRes.destroy()
      return
    }
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    pipeToResponse(proxyRes, res)
  })

  res.on('close', () => proxyReq.destroy())
  proxyReq.on('error', (err) => {
    if (err.code !== 'ECONNRESET') console.error('Siren API proxy error:', err)
    sendProxyError(res, 'Siren API service unavailable')
  })

  pipeline(req, proxyReq, (err) => {
    if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ECONNRESET') {
      console.error('Siren request stream error:', err)
    }
  })
}

// 只读转发 GitHub 接口：Token 只留在服务端，避免暴露给浏览器并提高接口限额
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN || ''
const GITHUB_API_HOST = 'api.github.com'
const GITHUB_ALLOWED_PATHS = [
  /^\/repos\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/commits$/,
]
const GITHUB_PROXY_TIMEOUT_MS = 10000

function sendGithubProxyError(res, status, message) {
  if (res.destroyed || res.writableEnded || res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ message }))
}

function proxyToGithub(req, res) {
  let targetPath = ''
  try {
    const requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    targetPath = requestUrl.pathname.replace(/^\/github-api/, '')

    if (!GITHUB_ALLOWED_PATHS.some(pattern => pattern.test(targetPath))) {
      sendGithubProxyError(res, 403, 'github proxy path not allowed')
      return
    }

    const perPage = Math.min(Math.max(Number(requestUrl.searchParams.get('per_page')) || 20, 1), 100)
    targetPath = `${targetPath}?per_page=${perPage}`
  } catch (_) {
    sendGithubProxyError(res, 400, 'invalid github proxy request')
    return
  }

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'HydrogenMusic-Web',
  }
  // 未配置 Token 时按匿名请求转发（GitHub 限额较低，仍可正常工作）
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`

  const proxyReq = https.request({
    hostname: GITHUB_API_HOST,
    port: 443,
    path: targetPath,
    method: 'GET',
    headers,
    timeout: GITHUB_PROXY_TIMEOUT_MS,
  }, (proxyRes) => {
    if (res.destroyed || res.writableEnded) {
      proxyRes.destroy()
      return
    }

    res.writeHead(proxyRes.statusCode || 502, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    })
    pipeToResponse(proxyRes, res)
  })

  res.on('close', () => proxyReq.destroy())
  proxyReq.on('timeout', () => proxyReq.destroy())
  proxyReq.on('error', (err) => {
    if (err.code !== 'ECONNRESET') console.error('GitHub proxy error:', err)
    sendGithubProxyError(res, 502, 'github service unavailable')
  })
  proxyReq.end()
}

function createWebServer({ distDir = DIST_DIR, tls = null } = {}) {
  const handleRequest = (req, res) => {
    if (req.url.startsWith('/api/') || req.url === '/api') {
      proxyToApi(req, res)
    } else if (req.url.startsWith('/siren-api/') || req.url === '/siren-api') {
      proxyToSiren(req, res)
    } else if (req.url.startsWith('/github-api/') || req.url === '/github-api') {
      proxyToGithub(req, res)
    } else if (req.url === '/download-tags' || req.url.startsWith('/download-tags?')) {
      handleDownloadTags(req, res)
    } else if (req.url.startsWith('/download-proxy?')) {
      proxyDownload(req, res)
    } else {
      serveStatic(req, res, distDir)
    }
  }

  return tls ? https.createServer(tls, handleRequest) : http.createServer(handleRequest)
}

// 可选 HTTPS：设置 TLS_CERT_FILE / TLS_KEY_FILE，或直接把证书放到 certs/server.crt 与
// certs/server.key。浏览器只有在证书受信任时才会显示安全标志，本地自签证书需先被系统信任。
const TLS_CERT_FILE = process.env.TLS_CERT_FILE || path.join(__dirname, 'certs', 'server.crt')
const TLS_KEY_FILE = process.env.TLS_KEY_FILE || path.join(__dirname, 'certs', 'server.key')

function resolveTlsOptions() {
  const hasCertFile = fs.existsSync(TLS_CERT_FILE)
  const hasKeyFile = fs.existsSync(TLS_KEY_FILE)
  if (!hasCertFile && !hasKeyFile) return null

  if (!hasCertFile || !hasKeyFile) {
    console.error(`HTTPS 未启用：证书与私钥必须同时提供（${TLS_CERT_FILE} / ${TLS_KEY_FILE}），已回退到 HTTP`)
    return null
  }

  try {
    return {
      cert: fs.readFileSync(TLS_CERT_FILE),
      key: fs.readFileSync(TLS_KEY_FILE),
    }
  } catch (error) {
    console.error(`HTTPS 未启用：读取证书失败（${error.message}），已回退到 HTTP`)
    return null
  }
}

const tlsOptions = resolveTlsOptions()
const server = createWebServer({ tls: tlsOptions })

async function ensureXeapiPublicKey() {
  const keyPath = path.resolve(os.tmpdir(), 'xeapi_public_key')
  try {
    const content = fs.readFileSync(keyPath, 'utf-8')
    if (content && JSON.parse(content).sk) {
      return
    }
  } catch (_) {
    // 文件不存在或内容无效，继续生成
  }

  const { generateDeviceId } = require('@neteasecloudmusicapienhanced/api/util/index')
  const registerXeapiKey = require('@neteasecloudmusicapienhanced/api/module/register_xeapikey')

  const deviceId = generateDeviceId()
  global.deviceId = deviceId

  const result = await registerXeapiKey({ deviceId }, null)
  const publicKey = result.body
  if (!publicKey || !publicKey.sk) {
    throw new Error('failed to fetch xeapi public key')
  }

  fs.writeFileSync(keyPath, JSON.stringify(publicKey), 'utf-8')
}

async function startNeteaseMusicApi() {
  await ensureXeapiPublicKey()
  const generateConfig = require('@neteasecloudmusicapienhanced/api/generateConfig')
  await generateConfig()
  const server = require('@neteasecloudmusicapienhanced/api/server')
  await server.serveNcmApi({
    checkVersion: true,
    port: API_PORT,
  })
}

async function startQQMusicApi() {
  const { startQQMusicApi: start } = require('./server/qqMusicApi.cjs')
  await start(QQ_API_PORT)
}

async function startWebServer() {
  try {
    await startNeteaseMusicApi()
    console.log(`NetEase Cloud Music API Enhanced started on port ${API_PORT}`)
  } catch (error) {
    console.error('Failed to start NetEase Cloud Music API:', error)
    process.exit(1)
  }

  try {
    await startQQMusicApi()
    console.log(`QQ Music API started on port ${QQ_API_PORT}`)
  } catch (error) {
    console.error('Failed to start QQ Music API:', error)
    process.exit(1)
  }

  server.listen(WEB_PORT, () => {
    const scheme = tlsOptions ? 'https' : 'http'
    console.log(`Hydrogen Music web server listening on port ${WEB_PORT} (${scheme.toUpperCase()})`)
    console.log(`Open ${scheme}://localhost:${WEB_PORT} in your browser`)
    if (!tlsOptions) {
      console.log('提示：把证书放到 certs/server.crt 与 certs/server.key（或设置 TLS_CERT_FILE / TLS_KEY_FILE）即可启用 HTTPS')
    }
  })
}

if (require.main === module) {
  startWebServer()
}

module.exports = { createWebServer, serveStatic, startWebServer, resolveStaticPath, server }
