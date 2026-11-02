import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve, join, basename } from 'path'
import { execSync } from 'child_process'
import fs from 'fs'
import http from 'http'
import https from 'https'
import os from 'os'
import { pipeline } from 'stream'

// 开发环境复用与 web-server.js 完全相同的下载标签逻辑（纯 Node 模块，无 Electron 依赖）
const {
  registerDownloadTag,
  takeDownloadTag,
  resolveDownloadExtension,
  writeAudioTags,
} = require('./server/downloadTags.cjs')

// 下载标签元数据（含歌词）体积上限，与 web-server.js 保持一致
const DOWNLOAD_TAGS_MAX_BYTES = 256 * 1024

// 构建标识：优先取当前提交的短 SHA；没有 git 信息（例如打包机未装 git）时退回构建时间戳，
// 保证每次构建仍有唯一标识。项目已弃用语义化版本号，统一用构建标识区分版本。
function resolveAppBuildId() {
  try {
    const commit = execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
    if (commit) return commit
  } catch (_) {}
  return `t${Date.now().toString(36)}`
}

// 可选 GitHub Token：与 web-server.js 用同一组环境变量，用于提高「检查更新」接口限额
// 部署基路径。默认 './' 用于桌面端与根路径部署；子路径部署（例如 nginx 下 /hydro/）
// 用 VITE_BASE=/hydro/ 构建，或直接改这里的默认值。dev 代理的关键字必须与 base 前缀一致，
// 否则浏览器请求的 '/hydro/api/...' 匹配不上 '/api' 规则。
function normalizeViteBase(raw) {
  const value = String(raw ?? '').trim()
  if (!value || value === '.' || value === './') return './'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value.endsWith('/') ? value : value + '/'
  const absolute = value.startsWith('/') ? value : '/' + value
  return absolute.endsWith('/') ? absolute : absolute + '/'
}

const APP_BASE = normalizeViteBase(process.env.VITE_BASE)
const BASE_PREFIX = APP_BASE === './' ? '' : APP_BASE.replace(/\/+$/, '')

function withBase(key) {
  return BASE_PREFIX ? BASE_PREFIX + key : key
}

function stripBasePrefix(path) {
  if (!BASE_PREFIX) return path
  if (path === BASE_PREFIX) return '/'
  return path.startsWith(BASE_PREFIX + '/') ? path.slice(BASE_PREFIX.length) : path
}

function resolveGithubToken() {
  return process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN || ''
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

// 与 web-server.js 一致：QQ 播放地址的回源来源应为 y.qq.com，而不是流域名。
function resolveDownloadReferer(parsedTarget) {
  const host = String(parsedTarget?.hostname || '').toLowerCase()
  if (host === 'qq.com' || host.endsWith('.qq.com')) return 'https://y.qq.com/'
  return parsedTarget.origin
}

// 把远端音频完整落到本地文件，返回上游 Content-Type 供回传时复用。
function fetchUrlToFile(targetUrl, filePath, req, res, redirectCount = 0) {
  return new Promise((resolvePromise, reject) => {
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
        // 重定向目标同样来自上游，畸形 Location（如 http://[）会在 new URL 处抛异常；
        // 这个回调不在任何 try/catch 里，抛出去就是未捕获异常，直接带走整个 dev server。
        let nextTarget = null
        try {
          nextTarget = new URL(redirectLocation, parsedTarget)
        } catch (error) {
          proxyRes.resume()
          reject(error)
          return
        }
        if (nextTarget.protocol !== 'http:' && nextTarget.protocol !== 'https:') {
          proxyRes.resume()
          reject(new Error('unsupported redirect protocol'))
          return
        }
        fetchUrlToFile(nextTarget.toString(), filePath, req, res, redirectCount + 1)
          .then(resolvePromise, reject)
        return
      }

      if (proxyRes.statusCode && (proxyRes.statusCode < 200 || proxyRes.statusCode >= 300)) {
        proxyRes.resume()
        reject(new Error(`download status ${proxyRes.statusCode}`))
        return
      }

      pipeline(proxyRes, fs.createWriteStream(filePath), (error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise(proxyRes.headers['content-type'] || 'application/octet-stream')
      })
    })

    res.on('close', () => proxyReq.destroy())
    proxyReq.on('error', reject)
    proxyReq.end()
  })
}

// 带标签的下载：先落临时文件 → 写 ID3/FLAC 标签 → 回传 → 清理临时目录。
// 写标签失败不影响下载本身，仍回传原始音频。
async function writeTaggedDownload(targetUrl, filename, metadata, req, res) {
  let tempDir = ''

  try {
    const parsedTarget = new URL(targetUrl)
    tempDir = await fs.promises.mkdtemp(join(os.tmpdir(), 'hydrogen-download-'))
    const format = resolveDownloadExtension(metadata, filename)
    const tempFile = join(tempDir, format ? `audio.${format}` : 'audio')

    const contentType = await fetchUrlToFile(targetUrl, tempFile, req, res)

    try {
      await writeAudioTags(tempFile, metadata)
    } catch (error) {
      console.warn('写入下载标签失败:', error && error.message ? error.message : error)
    }

    if (res.destroyed || res.writableEnded) return

    const stat = await fs.promises.stat(tempFile)
    res.writeHead(200, {
      'Content-Type': format === 'mp3' ? 'audio/mpeg' : contentType,
      'Content-Length': String(stat.size),
      'Content-Disposition': getContentDispositionFileName(filename || basename(parsedTarget.pathname) || 'Hydrogen Music'),
      'Cache-Control': 'no-store',
    })

    await new Promise((resolvePromise) => {
      pipeline(fs.createReadStream(tempFile), res, () => resolvePromise())
    })
  } catch (error) {
    if (error && error.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error('Download proxy (tags) error:', error)
    }
    if (!res.headersSent && !res.destroyed && !res.writableEnded) {
      res.writeHead(502)
      res.end('Download unavailable')
    }
  } finally {
    if (tempDir) fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Vite 的 configureServer 中间件排在内部 baseMiddleware 之前，所以 base 为 '/hydro/' 时，
// 前端请求的 /hydro/download-tags 到达插件中间件时前缀仍然完整，与 use('/download-tags', ...)
// 的路由对不上，请求会一路落到静态资源兜底并返回 404。这里只把这两个下载端点的 base 剥掉，
// 其余请求原样放行给 Vite 自己处理。
function createBaseStripper(base) {
  const prefix = base && base !== '/' ? base.replace(/\/+$/, '') : ''
  if (!prefix) return null
  return (value) => {
    if (value === prefix) return '/'
    if (value.startsWith(prefix + '/')) return value.slice(prefix.length)
    if (value.startsWith(prefix + '?')) return '/' + value.slice(prefix.length)
    return value
  }
}

const DOWNLOAD_DEV_ENDPOINTS = ['/download-tags', '/download-proxy']

function downloadProxyPlugin() {
  return {
    name: 'hydrogen-download-proxy',
    configureServer(server) {
      const stripBase = createBaseStripper(server.config.base || '/')

      if (stripBase) {
        server.middlewares.use((req, _res, next) => {
          const url = req.url || ''
          const queryIndex = url.indexOf('?')
          const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex)
          if (!DOWNLOAD_DEV_ENDPOINTS.includes(stripBase(pathname))) {
            next()
            return
          }
          req.url = stripBase(url)
          next()
        })
      }

      // 与 web-server.js 的 POST /download-tags 一致：把下载元数据换成一次性 token
      server.middlewares.use('/download-tags', (req, res) => {
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
            res.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            res.end(JSON.stringify({ error: 'metadata too large' }))
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
      })

      server.middlewares.use('/download-proxy', async (req, res) => {
        let targetUrl = ''
        let filename = ''
        let tagToken = ''
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost/download-proxy')
          targetUrl = requestUrl.searchParams.get('url') || ''
          filename = requestUrl.searchParams.get('filename') || ''
          tagToken = requestUrl.searchParams.get('tags') || ''
          const parsedTarget = new URL(targetUrl)
          if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
            throw new Error('unsupported protocol')
          }
        } catch (_) {
          res.writeHead(400)
          res.end('Invalid download url')
          return
        }

        // token 一次性消费：拿到元数据就走落盘写标签流程，否则保持零拷贝流式转发。
        const tagMetadata = tagToken ? takeDownloadTag(tagToken) : null
        if (tagMetadata) {
          await writeTaggedDownload(targetUrl, filename, tagMetadata, req, res)
          return
        }

        const pipeDownload = (nextUrl, redirectCount = 0) => {
          if (redirectCount > 5) {
            if (!res.headersSent) res.writeHead(502)
            res.end('Too many download redirects')
            return
          }

          const parsedTarget = new URL(nextUrl)
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
            // 同上：畸形或非 http(s) 的 Location 必须在这里挡掉，否则异常逃出回调会杀掉进程
            let nextTarget = null
            try {
              nextTarget = new URL(redirectLocation, parsedTarget)
            } catch (_) {
              if (!res.headersSent) res.writeHead(502)
              res.end('Bad download redirect')
              return
            }
            if (nextTarget.protocol !== 'http:' && nextTarget.protocol !== 'https:') {
              if (!res.headersSent) res.writeHead(502)
              res.end('Bad download redirect')
              return
            }
            pipeDownload(nextTarget.toString(), redirectCount + 1)
            return
          }

          const headers = {
            'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
            'Content-Disposition': getContentDispositionFileName(filename || parsedTarget.pathname.split('/').pop() || 'Hydrogen Music'),
            'Cache-Control': 'no-store',
          }
          if (proxyRes.headers['content-length']) headers['Content-Length'] = proxyRes.headers['content-length']
          res.writeHead(proxyRes.statusCode || 200, headers)
          pipeline(proxyRes, res, (err) => {
            if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
              console.error('Download proxy stream error:', err)
            }
          })
        })

          req.on('close', () => proxyReq.destroy())
          proxyReq.on('error', (err) => {
            if (err.code !== 'ECONNRESET') console.error('Download proxy error:', err)
            if (!res.headersSent) res.writeHead(502)
            res.end('Download unavailable')
          })
          proxyReq.end()
        }

        pipeDownload(targetUrl)
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), downloadProxyPlugin()],
  base: APP_BASE,
  define: {
    __APP_BUILD_ID__: JSON.stringify(resolveAppBuildId()),
  },
  build: {
    target: 'es2018',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        // 桌面歌词是 Electron 的独立窗口，background.js 会加载 dist/desktop-lyric.html，
        // 少了这个入口打包后该窗口会 404，所以必须一起构建
        'desktop-lyric': resolve(__dirname, 'desktop-lyric.html')
      }
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.warn']
      },
      mangle: {
        eval: false
      },
      format: {
        comments: false
      }
    },
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1000
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    include: [
      'vue',
      'vue-router',
      'pinia',
      'axios',
      'howler'
    ],
    exclude: []
  },
  css: {
    modules: false,
    postcss: {},
    preprocessorOptions: {
      scss: {
        quietDeps: true
      }
    }
  },
  server: {
    open: false,
    cors: true,
    // 键名必须带 base 前缀（Vite 文档：non-relative base 时每个键都要加前缀），
    // 转发前再把前缀与自有路由前缀一起去掉，上游只看到业务路径。
    proxy: {
      [withBase('/api/qq')]: {
        target: 'http://127.0.0.1:3200',
        changeOrigin: true,
        rewrite: (path) => stripBasePrefix(path).replace(/^\/api\/qq/, '')
      },
      [withBase('/api')]: {
        target: 'http://127.0.0.1:36530',
        changeOrigin: true,
        rewrite: (path) => stripBasePrefix(path).replace(/^\/api/, '')
      },
      [withBase('/siren-api')]: {
        target: 'https://monster-siren.hypergryph.com/api',
        changeOrigin: true,
        rewrite: (path) => stripBasePrefix(path).replace(/^\/siren-api/, '')
      },
      // 开发环境与 web-server.js 保持一致的 GitHub 只读代理（可选携带 Token）
      [withBase('/github-api')]: {
        target: 'https://api.github.com',
        changeOrigin: true,
        rewrite: (path) => stripBasePrefix(path).replace(/^\/github-api/, ''),
        headers: resolveGithubToken() ? { Authorization: `Bearer ${resolveGithubToken()}` } : {}
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: true
  }
})
