const { randomBytes } = require('node:crypto')
const { AsyncLocalStorage } = require('node:async_hooks')
const path = require('node:path')

// The package resolves its disk-backed cookie store as it loads. Set a
// project-owned, gitignored server directory before requiring either entry so
// credentials never fall back to node_modules. An explicit deployment path is
// preserved.
if (!process.env.QQ_MUSIC_API_CONFIG_DIR) {
  process.env.QQ_MUSIC_API_CONFIG_DIR = path.resolve(__dirname, '..', '.qq-music-session')
}

const qqLogContext = new AsyncLocalStorage()
const originalConsoleMethods = Object.fromEntries(
  ['log', 'info', 'warn', 'error', 'debug'].map(method => [method, console[method].bind(console)]),
)

function sanitizeQQLogValue(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(SENSITIVE_TEXT_REPLACEMENT_PATTERN, (match) => {
    if (/^bearer\s/i.test(match)) return 'Bearer [REDACTED]'
    const separatorIndex = match.search(/[:=]/)
    return `${match.slice(0, separatorIndex + 1)} [REDACTED]`
  })
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  const output = {}
  if (value instanceof Error) {
    output.name = value.name
    output.message = sanitizeQQLogValue(value.message, seen)
  }
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'stack' || key === 'request' || key === 'response') continue
    output[key] = isSensitiveQQKey(key)
      ? '[REDACTED]'
      : sanitizeQQLogValue(nested, seen)
  }
  seen.delete(value)
  return output
}

for (const method of Object.keys(originalConsoleMethods)) {
  console[method] = function scopedQQConsole(...args) {
    const current = qqLogContext.getStore()
    const target = current?.sink?.[method] || originalConsoleMethods[method]
    if (current) return target(...args.map(value => sanitizeQQLogValue(value)))
    return target(...args)
  }
}

function normalizeQQLogSink(sink) {
  if (!sink) return originalConsoleMethods
  return Object.fromEntries(Object.keys(originalConsoleMethods).map(method => [
    method,
    typeof sink[method] === 'function' ? sink[method] : originalConsoleMethods[method],
  ]))
}

function runWithQQSafeLogging(callback, sink) {
  return qqLogContext.run({ sink: normalizeQQLogSink(sink) }, callback)
}

// The public HTTP app exposes cookie pass-through/debug endpoints. Hydrogen
// places this middleware in front of that app so credentials never cross the
// browser boundary. The services entry is used for QR login because its raw
// response contains credentials that must be consumed server-side.
const app = require('@sansenjian/qq-music-api')
const qqServices = require('@sansenjian/qq-music-api/services')

const QQ_API_PORT = Number(process.env.QQ_API_PORT || 3200)
const QR_SESSION_TTL_MS = 5 * 60 * 1000
const FORBIDDEN_CREDENTIAL_PATHS = new Set(['/user/getcookie', '/user/setcookie'])

// QQ is intentionally exposed as a private My Music/playback bridge. Keep a
// positive route allowlist here so adding a new upstream endpoint cannot
// accidentally make public search, recommendation, album, MV, comment, or
// download APIs reachable through `/api/qq`.
const QQ_ALLOWED_EXACT_PATHS = new Set([
  '/getmusicplay',
  '/getlyric',
  '/getsonglistdetail',
  '/user/getuserdetail',
  '/user/getuseravatar',
  '/user/getuserlikedsongs',
  '/user/getuserplaylists',
  '/user/getusercollectedsonglists',
])
const QQ_ALLOWED_PATH_PATTERNS = Object.freeze([
  /^\/getmusicplay\/[^/]+$/i,
  /^\/getlyric\/[^/]+$/i,
  /^\/getsonglistdetail\/[^/]+$/i,
])
const QQ_PRIVATE_PATHS = new Set([
  '/getqqloginqr',
  '/checkqqloginqr',
  '/session/status',
  '/session/logout',
])

function normalizeQQPath(pathname) {
  return String(pathname || '').toLowerCase().replace(/\/$/, '') || '/'
}

function isQQPathAllowed(pathname) {
  const normalizedPath = normalizeQQPath(pathname)
  if (QQ_PRIVATE_PATHS.has(normalizedPath) || QQ_ALLOWED_EXACT_PATHS.has(normalizedPath)) return true
  return QQ_ALLOWED_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath))
}
const SENSITIVE_CANONICAL_KEYS = new Set([
  'cookie', 'cookies', 'cookielist', 'cookieobject', 'cookiestring', 'cookiemap', 'cookieheader',
  'authorization', 'proxyauthorization', 'xauthorization', 'xcustomcookie',
  'token', 'accesstoken', 'refreshtoken', 'idtoken', 'authtoken', 'sessiontoken', 'logintoken',
  'qrsig', 'ptqrtoken', 'gtk', 'loginsig',
  'skey', 'pskey', 'qqmusickey', 'qqmusicuin', 'pt4token', 'qmkeyst', 'qmcookie', 'ptcz', 'puin',
  'euin', 'hosteuin', 'encryptuin', 'encrypteduin', 'cookievalue', 'rawcookie', 'cookiedata', 'ticket',
])
const SENSITIVE_REQUEST_HEADERS = new Set(['cookie', 'authorization', 'proxy-authorization', 'x-custom-cookie'])
const SENSITIVE_RESPONSE_HEADERS = new Set(['set-cookie', 'server-authorization', 'www-authenticate'])
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH'])
const MAX_REQUEST_BODY_BYTES = 1024 * 1024
const SENSITIVE_TEXT_PATTERN = /(?:^|[\s;,&?])(?:cookie(?:s|string|list|object|map|header|value|data)?|raw[_-]?cookie|(?:proxy|x)?[_-]?authorization|(?:access|refresh|id|auth|session|login)[_-]?token|token|qrsig|ptqrtoken|pt4[_-]?token|g[_-]?tk|login[_-]?sig|skey|p[_-]?skey|p[_-]?uin|qqmusic[_-]?(?:key|uin)|qm[_-]?keyst|qmcookie|ptcz|(?:host|encrypt(?:ed)?)[_-]?euin|euin|ticket)\s*[:=]|\bbearer\s+[a-z0-9._~+\/-]+/i
const SENSITIVE_TEXT_REPLACEMENT_PATTERN = /\b(?:cookie(?:s|string|list|object|map|header|value|data)?|raw[_-]?cookie|(?:proxy|x)?[_-]?authorization|(?:access|refresh|id|auth|session|login)[_-]?token|token|qrsig|ptqrtoken|pt4[_-]?token|g[_-]?tk|login[_-]?sig|skey|p[_-]?skey|p[_-]?uin|qqmusic[_-]?(?:key|uin)|qm[_-]?keyst|qmcookie|ptcz|(?:host|encrypt(?:ed)?)[_-]?euin|euin|ticket)\s*[:=]\s*[^\r\n]+|\bbearer\s+[a-z0-9._~+\/-]+/gi
const qrSessions = new Map()
let server = null

function canonicalizeQQKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSensitiveQQKey(key) {
  return SENSITIVE_CANONICAL_KEYS.has(canonicalizeQQKey(key))
}

function createOpaqueSessionId() {
  return randomBytes(24).toString('base64url')
}

function getSingleValue(value) {
  if (Array.isArray(value)) return getSingleValue(value[0])
  if (value === undefined || value === null) return ''
  return String(value)
}

// QQ login cookies commonly store the account number as `uin=o012345`.
// The upstream user services parse their explicit `uin` parameter with
// Number.parseInt, so passing that cookie representation produces NaN and
// silently returns empty profile/playlist data. Keep the cookie untouched,
// but normalize the public/query identifier used by those services.
function normalizeQQUin(value) {
  const normalized = getSingleValue(value).trim()
  if (!normalized) return ''
  const digits = normalized.replace(/^o(?=\d)/i, '')
  if (!/^\d+$/.test(digits)) return normalized
  return digits.replace(/^0+(?=\d)/, '') || '0'
}

function hasSensitiveQQQuery(url) {
  let parsed
  try {
    parsed = new URL(String(url || ''), 'http://localhost')
  } catch (_) {
    return true
  }
  return Array.from(parsed.searchParams.entries()).some(([key, value]) => (
    isSensitiveQQKey(key) || SENSITIVE_TEXT_PATTERN.test(value)
  ))
}

function sanitizeQQProxyRequestHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).filter(([key]) => {
    const normalized = key.toLowerCase()
    return !SENSITIVE_REQUEST_HEADERS.has(normalized) && !isSensitiveQQKey(normalized) && !normalized.startsWith('x-forwarded-')
  }))
}

function sanitizeQQProxyResponseHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).filter(([key, value]) => (
    !SENSITIVE_RESPONSE_HEADERS.has(key.toLowerCase())
    && !isSensitiveQQKey(key)
    && !containsQQCredential(value)
  )))
}

function sanitizeQQResponseBody(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(SENSITIVE_TEXT_REPLACEMENT_PATTERN, (match) => {
    if (/^bearer\s/i.test(match)) return 'Bearer [REDACTED]'
    const separatorIndex = match.search(/[:=]/)
    return `${match.slice(0, separatorIndex + 1)} [REDACTED]`
  })
  if (Array.isArray(value)) return value.map(item => sanitizeQQResponseBody(item, seen))
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return undefined
  seen.add(value)
  const output = {}
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveQQKey(key)) continue
    const sanitized = sanitizeQQResponseBody(nested, seen)
    if (sanitized !== undefined) output[key] = sanitized
  }
  seen.delete(value)
  return output
}

// QR image URLs are allowed to cross the browser boundary only when they are
// ordinary image URLs. qrsig/ptqrtoken and cookie-like query values are
// authentication material; dropping the whole URL is safer than returning a
// partially redacted URL that can still be replayed.
function sanitizeQQQrImage(value) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  if (!normalized || SENSITIVE_TEXT_PATTERN.test(normalized)) return ''
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) return normalized

  let parsed
  try {
    parsed = new URL(normalized)
  } catch (_) {
    return ''
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
  for (const key of parsed.searchParams.keys()) {
    if (isSensitiveQQKey(key)) return ''
  }
  if (SENSITIVE_TEXT_PATTERN.test(parsed.hash)) return ''
  return parsed.toString()
}

function sanitizeQQLoginQrBody(body) {
  const safe = sanitizeQQResponseBody(body)
  if (!safe || typeof safe !== 'object' || Array.isArray(safe)) return safe
  for (const key of ['img', 'url', 'qrUrl', 'qrimg']) {
    if (Object.prototype.hasOwnProperty.call(safe, key)) safe[key] = sanitizeQQQrImage(safe[key])
  }
  return safe
}

function containsQQCredential(value, seen = new WeakSet()) {
  if (typeof value === 'string') return SENSITIVE_TEXT_PATTERN.test(value)
  if (!value || typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const contains = Object.entries(value).some(([key, nested]) => (
    isSensitiveQQKey(key) || containsQQCredential(nested, seen)
  ))
  seen.delete(value)
  return contains
}

async function parseRequestBody(ctx) {
  if (ctx.request?.body !== undefined) return ctx.request.body
  if (!BODY_METHODS.has(ctx.method) || !ctx.req) return undefined
  const buffers = []
  let size = 0
  for await (const chunk of ctx.req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_REQUEST_BODY_BYTES) {
      const error = new Error('Request body too large')
      error.status = 413
      throw error
    }
    buffers.push(buffer)
  }
  if (!buffers.length) {
    ctx.request.body = {}
    return ctx.request.body
  }
  const raw = Buffer.concat(buffers).toString('utf8')
  const contentType = String(ctx.get?.('content-type') || ctx.headers?.['content-type'] || '').toLowerCase()
  try {
    if (contentType.includes('application/x-www-form-urlencoded')) {
      ctx.request.body = Object.fromEntries(new URLSearchParams(raw))
    } else {
      ctx.request.body = JSON.parse(raw)
    }
  } catch (_) {
    const error = new Error('Invalid request body')
    error.status = 400
    throw error
  }
  return ctx.request.body
}

function getQQLoginSession(scope = global) {
  const value = scope.userInfo
  if (!value || typeof value !== 'object' || !getSingleValue(value.cookie)) return null
  return value
}

function persistQQLoginSession(session, scope = global) {
  const cookie = getSingleValue(session?.cookie)
  if (!cookie) throw new Error('QQ login response did not contain a cookie')
  const current = scope.userInfo
  if (!current || typeof current.refreshData !== 'function') throw new Error('QQ Music session store is unavailable')
  const refreshData = current.refreshData
  const refreshed = refreshData(cookie)
  scope.userInfo = {
    ...current,
    ...refreshed,
    ...getSingleValue(session?.euin) ? { euin: getSingleValue(session.euin) } : {},
    refreshData,
  }
  return scope.userInfo
}

function clearQQLoginSession(scope = global) {
  const current = scope.userInfo
  if (!current || typeof current.refreshData !== 'function') {
    scope.userInfo = null
    return
  }
  const refreshData = current.refreshData
  const refreshed = refreshData('')
  const next = {
    ...refreshed,
    loginUin: '',
    uin: '',
    cookie: '',
    cookieList: [],
    cookieObject: {},
    refreshData,
  }
  delete next.euin
  scope.userInfo = next
}

// Keep the upstream resolver's in-memory store aligned with the private
// session on every request. Authenticated RPCs read euin from that store when
// the browser is deliberately prevented from sending it.
function syncQQUpstreamUserInfo(session, scope = global) {
  if (!session || typeof session !== 'object' || !getSingleValue(session.cookie)) return
  const current = scope.userInfo
  if (!current || typeof current !== 'object') return
  scope.userInfo = {
    ...current,
    cookie: getSingleValue(session.cookie),
    ...(session.euin ? { euin: getSingleValue(session.euin) } : {}),
    ...(session.loginUin ? { loginUin: getSingleValue(session.loginUin) } : {}),
    ...(session.uin ? { uin: getSingleValue(session.uin) } : {}),
  }
}

function publicQQSession(session) {
  if (!session || typeof session !== 'object') return null
  const loginUin = normalizeQQUin(session.loginUin || session.uin)
  const uin = normalizeQQUin(session.uin || session.loginUin)
  return {
    ...(loginUin ? { loginUin } : {}),
    ...(uin ? { uin } : {}),
  }
}

function unwrapServiceResponse(response) {
  if (!response || typeof response !== 'object') return { status: 500, body: { error: 'QQ Music service unavailable' } }
  return {
    status: Number(response.status) || 500,
    body: response.body && typeof response.body === 'object' ? response.body : {},
  }
}

function writeJson(ctx, status, body) {
  ctx.status = status
  ctx.type = 'application/json'
  ctx.body = body
}

function pruneExpiredQrSessions(store, now) {
  for (const [id, session] of store) {
    if (!session || session.expiresAt <= now) store.delete(id)
  }
}

function createQQSecurityMiddleware(options = {}) {
  const getLoginQr = options.getLoginQr || (async () => qqServices.getQQLoginQr({}))
  const checkLoginQr = options.checkLoginQr || (async ({ ptqrtoken, qrsig }) => qqServices.checkQQLoginQr({
    method: 'get',
    option: {},
    params: { ptqrtoken, qrsig },
  }))
  const persistSession = options.persistSession || persistQQLoginSession
  const clearSession = options.clearSession || clearQQLoginSession
  const getSession = options.getSession || getQQLoginSession
  const sessionStore = options.sessionStore || qrSessions
  const sessionIdFactory = options.sessionIdFactory || createOpaqueSessionId
  const now = options.now || Date.now
  const logSink = options.logSink

  return async function qqSecurityMiddleware(ctx, next) {
    return runWithQQSafeLogging(async () => {
    const normalizedPath = normalizeQQPath(ctx.path)
    ctx.remove('Set-Cookie')
    ctx.remove('Server-Authorization')
    ctx.remove('WWW-Authenticate')

    if (FORBIDDEN_CREDENTIAL_PATHS.has(normalizedPath)) {
      writeJson(ctx, 404, { error: 'Not found' })
      return
    }

    if (hasSensitiveQQQuery(ctx.url)) {
      writeJson(ctx, 400, { error: 'QQ credentials are server-managed and cannot be supplied in the URL' })
      return
    }

    if (Object.keys(ctx.headers || {}).some(key => SENSITIVE_REQUEST_HEADERS.has(key.toLowerCase()))) {
      writeJson(ctx, 400, { error: 'QQ credentials are server-managed' })
      return
    }

    if (BODY_METHODS.has(ctx.method)) {
      try {
        const requestBody = await parseRequestBody(ctx)
        if (containsQQCredential(requestBody)) {
          writeJson(ctx, 400, { error: 'QQ credentials are server-managed' })
          return
        }
      } catch (error) {
        writeJson(ctx, Number(error?.status) || 400, { error: Number(error?.status) === 413 ? 'Request body too large' : 'Invalid request body' })
        return
      }
    }

    if (normalizedPath === '/getqqloginqr') {
      if (ctx.method !== 'GET') {
        writeJson(ctx, 405, { error: 'Method not allowed' })
        return
      }
      pruneExpiredQrSessions(sessionStore, now())
      const { status, body } = unwrapServiceResponse(await getLoginQr())
      if (status < 200 || status >= 300 || !body.qrsig || !body.ptqrtoken) {
        writeJson(ctx, status, sanitizeQQLoginQrBody(body))
        return
      }
      const sessionId = sessionIdFactory()
      sessionStore.set(sessionId, {
        qrsig: getSingleValue(body.qrsig),
        ptqrtoken: getSingleValue(body.ptqrtoken),
        expiresAt: now() + QR_SESSION_TTL_MS,
      })
      writeJson(ctx, status, { ...sanitizeQQLoginQrBody(body), sessionId })
      return
    }

    if (normalizedPath === '/checkqqloginqr') {
      if (ctx.method !== 'POST') {
        writeJson(ctx, 405, { error: 'Method not allowed' })
        return
      }
      const sessionId = getSingleValue(ctx.request?.body?.sessionId)
      const pending = sessionStore.get(sessionId)
      if (!sessionId || !pending || pending.expiresAt <= now()) {
        if (sessionId) sessionStore.delete(sessionId)
        writeJson(ctx, 400, { error: 'QQ login session is invalid or expired' })
        return
      }
      const { status, body } = unwrapServiceResponse(await checkLoginQr(pending))
      if (body.refresh === true || status < 200 || status >= 300) sessionStore.delete(sessionId)
      if (body.isOk === true && body.session) {
        persistSession(body.session)
        sessionStore.delete(sessionId)
      }
      writeJson(ctx, status, sanitizeQQResponseBody(body))
      return
    }

    if (normalizedPath === '/session/status') {
      if (ctx.method !== 'GET') {
        writeJson(ctx, 405, { error: 'Method not allowed' })
        return
      }
      const session = getSession()
      writeJson(ctx, 200, { loggedIn: Boolean(session), session: publicQQSession(session) })
      return
    }

    if (normalizedPath === '/session/logout') {
      if (ctx.method !== 'POST') {
        writeJson(ctx, 405, { error: 'Method not allowed' })
        return
      }
      clearSession()
      sessionStore.clear()
      writeJson(ctx, 200, { ok: true })
      return
    }

    // All non-private traffic must be explicitly listed above. This check is
    // deliberately before session injection and `next()` so public QQ APIs
    // cannot be reached even when a user has a valid login session.
    if (!isQQPathAllowed(normalizedPath)) {
      writeJson(ctx, 404, { error: 'Not found' })
      return
    }

    // The retained QQ surface is read-only. Reject non-GET methods even when
    // an upstream package later adds a handler under an existing path.
    if (String(ctx.method || 'GET').toUpperCase() !== 'GET') {
      writeJson(ctx, 404, { error: 'Not found' })
      return
    }

    const serverSession = getSession()
    if (serverSession?.cookie) {
      syncQQUpstreamUserInfo(serverSession)
      ctx.request.cookie = serverSession.cookie
      ctx.state = ctx.state || {}
      ctx.state.requestCookie = serverSession.cookie
      const needsUin = /^\/user\/(?:getuseravatar|getuserplaylists|getuserdetail|getusercollectedsonglists|getusercollectedalbums|getuserfollowsingers|getuserfollowusers|getuserfans|getuserlikedsongs)$/i.test(normalizedPath)
      if (needsUin) {
        const uin = normalizeQQUin(serverSession.uin || serverSession.loginUin)
        if (uin) ctx.query.uin = uin
      }
    }

    await next()
    ctx.remove('Set-Cookie')
    ctx.remove('Server-Authorization')
    ctx.remove('WWW-Authenticate')
    ctx.body = sanitizeQQResponseBody(ctx.body)
    }, logSink)
  }
}

// Insert before upstream access logging, cookie parsing, static explorer, and
// routes. This also prevents the upstream logger from ever seeing secrets in
// the URL because those requests return here.
app.middleware.unshift(createQQSecurityMiddleware())

function startQQMusicApi(port = QQ_API_PORT) {
  if (server) return Promise.resolve(server)
  return new Promise((resolve, reject) => {
    server = app.listen(port, '127.0.0.1', () => resolve(server))
    server.once('error', reject)
  })
}

function stopQQMusicApi() {
  if (!server) return Promise.resolve()
  const active = server
  server = null
  return new Promise((resolve, reject) => active.close(error => error ? reject(error) : resolve()))
}

module.exports = {
  app,
  QQ_API_PORT,
  startQQMusicApi,
  stopQQMusicApi,
  createQQSecurityMiddleware,
  hasSensitiveQQQuery,
  persistQQLoginSession,
  clearQQLoginSession,
  syncQQUpstreamUserInfo,
  sanitizeQQProxyRequestHeaders,
  sanitizeQQProxyResponseHeaders,
  sanitizeQQResponseBody,
  sanitizeQQLoginQrBody,
  normalizeQQUin,
  normalizeQQPath,
  isQQPathAllowed,
  runWithQQSafeLogging,
}
