// 同时启动网易云音乐 API Enhanced 与静态文件服务，
// 让 Web 部署只需一个命令即可运行。
const http = require('http')
const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pipeline } = require('stream')

const API_PORT = 36530
const WEB_PORT = process.env.PORT || 30000
const DIST_DIR = path.join(__dirname, 'dist')

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

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0]
  let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath)
  const ext = path.extname(filePath).toLowerCase()
  const contentType = mimeTypes[ext] || 'application/octet-stream'

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // SPA 路由回退到 index.html
        fs.readFile(path.join(DIST_DIR, 'index.html'), (err2, content2) => {
          if (err2) {
            res.writeHead(404)
            res.end('Not found')
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(content2)
          }
        })
      } else {
        console.error('Static file error:', err)
        res.writeHead(500)
        res.end('Server error')
      }
      return
    }
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(content)
  })
}

function proxyToApi(req, res) {
  const [rawPath, query] = req.url.split('?')
  const targetPath = rawPath.replace(/^\/api/, '') || '/'
  const options = {
    hostname: '127.0.0.1',
    port: API_PORT,
    path: targetPath + (query ? '?' + query : ''),
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${API_PORT}` },
  }

  const proxyReq = http.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    pipeline(proxyRes, res, () => {})
  })

  proxyReq.on('error', (err) => {
    console.error('API proxy error:', err)
    res.writeHead(502)
    res.end('API service unavailable')
  })

  pipeline(req, proxyReq, () => {})
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
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    pipeline(proxyRes, res, () => {})
  })

  proxyReq.on('error', (err) => {
    console.error('Siren API proxy error:', err)
    res.writeHead(502)
    res.end('Siren API service unavailable')
  })

  pipeline(req, proxyReq, () => {})
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') {
    proxyToApi(req, res)
  } else if (req.url.startsWith('/siren-api/') || req.url === '/siren-api') {
    proxyToSiren(req, res)
  } else {
    serveStatic(req, res)
  }
})

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

;(async () => {
  try {
    await startNeteaseMusicApi()
    console.log(`NetEase Cloud Music API Enhanced started on port ${API_PORT}`)
  } catch (error) {
    console.error('Failed to start NetEase Cloud Music API:', error)
    process.exit(1)
  }

  server.listen(WEB_PORT, () => {
    console.log(`Hydrogen Music web server listening on port ${WEB_PORT}`)
    console.log(`Open http://localhost:${WEB_PORT} in your browser`)
  })
})()
