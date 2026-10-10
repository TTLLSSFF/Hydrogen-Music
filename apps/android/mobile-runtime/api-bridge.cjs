const http = require('node:http')

const QQ_PREFIX = '/qq'

/**
 * 带 CORS 的转发层，按前缀分流：
 *   /qq/*  → QQ 音乐 API（QQ_API_PORT，默认 36532），转发前剥掉 /qq 前缀
 *   其余    → 网易云 API（NCM_PORT，默认 36530）
 *
 * 只做一次前缀判断，不动原有的头处理与 set-cookie 清洗逻辑。
 */
function createApiBridge(ncmPort, qqPort = 0) {
  const resolveTarget = url => {
    const raw = String(url || '/')
    if (qqPort > 0 && (raw === QQ_PREFIX || raw.startsWith(`${QQ_PREFIX}/`) || raw.startsWith(`${QQ_PREFIX}?`))) {
      return { port: qqPort, path: raw.slice(QQ_PREFIX.length) || '/' }
    }
    return { port: ncmPort, path: raw }
  }

  return http.createServer((req, res) => {
    const origin = req.headers.origin || '*'
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    // Credentialed requests require explicit headers; '*' does not allow JSON POSTs.
    res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type')
    res.setHeader('Vary', 'Origin, Access-Control-Request-Headers')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS')
    res.setHeader('Access-Control-Expose-Headers', '*')

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const target = resolveTarget(req.url)
    const headers = { ...req.headers, host: `127.0.0.1:${target.port}` }
    const proxyReq = http.request(
      { hostname: '127.0.0.1', port: target.port, path: target.path, method: req.method, headers },
      proxyRes => {
        const responseHeaders = { ...proxyRes.headers }
        if (responseHeaders['set-cookie']) {
          const list = Array.isArray(responseHeaders['set-cookie'])
            ? responseHeaders['set-cookie']
            : [responseHeaders['set-cookie']]
          responseHeaders['set-cookie'] = list.map(cookie => String(cookie)
            .replace(/;\s*domain=[^;]*/gi, '')
            .replace(/;\s*secure/gi, ''))
        }
        res.writeHead(proxyRes.statusCode || 502, responseHeaders)
        proxyRes.pipe(res)
      }
    )

    proxyReq.on('error', error => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      }
      res.end(JSON.stringify({ code: 502, message: `API 不可达: ${error.message}` }))
    })

    req.pipe(proxyReq)
  })
}

module.exports = { createApiBridge }
