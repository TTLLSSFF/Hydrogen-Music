import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { execSync } from 'child_process'
import http from 'http'
import https from 'https'
import { pipeline } from 'stream'

// 构建标识：优先取当前提交的短 SHA，供「新版本追加」判断网页是否已更新；
// 没有 git 信息（例如打包机未装 git）时退回空串，运行时再退化为版本号。
function resolveAppCommit() {
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim()
  } catch (_) {
    return ''
  }
}

// 可选 GitHub Token：与 web-server.js 用同一组环境变量，用于提高「检查更新」接口限额
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

function downloadProxyPlugin() {
  return {
    name: 'hydrogen-download-proxy',
    configureServer(server) {
      server.middlewares.use('/download-proxy', (req, res) => {
        let targetUrl = ''
        let filename = ''
        try {
          const requestUrl = new URL(req.url || '', 'http://localhost/download-proxy')
          targetUrl = requestUrl.searchParams.get('url') || ''
          filename = requestUrl.searchParams.get('filename') || ''
          const parsedTarget = new URL(targetUrl)
          if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
            throw new Error('unsupported protocol')
          }
        } catch (_) {
          res.writeHead(400)
          res.end('Invalid download url')
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
            Referer: parsedTarget.origin,
          },
        }, (proxyRes) => {
          const redirectLocation = proxyRes.headers.location
          if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && redirectLocation) {
            proxyRes.resume()
            pipeDownload(new URL(redirectLocation, parsedTarget).toString(), redirectCount + 1)
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
  base: './',
  define: {
    __APP_COMMIT__: JSON.stringify(resolveAppCommit()),
  },
  build: {
    target: 'es2018',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
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
  proxy: {
    '/api/qq': {
      target: 'http://127.0.0.1:3200',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/qq/, '')
    },
    '/api': {
        target: 'http://127.0.0.1:36530',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/siren-api': {
        target: 'https://monster-siren.hypergryph.com/api',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/siren-api/, '')
      },
      // 开发环境与 web-server.js 保持一致的 GitHub 只读代理（可选携带 Token）
      '/github-api': {
        target: 'https://api.github.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/github-api/, ''),
        headers: resolveGithubToken() ? { Authorization: `Bearer ${resolveGithubToken()}` } : {}
      }
    }
  },
  preview: {
    port: 4173,
    strictPort: true
  }
})
