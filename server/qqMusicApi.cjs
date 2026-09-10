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

function encodeQQClientSession(session) {
  const cookie = getSingleValue(session?.cookie).trim()
  if (!cookie) return ''
  return Buffer.from(JSON.stringify({
    cookie,
    uin: session?.uin || session?.loginUin || '',
    euin: getSingleValue(session?.euin),
  }), 'utf8').toString('base64url')
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

function parseCookieUin(cookie) {
  const match = String(cookie || '').match(/(?:^|;)\s*uin=([^;]+)/i)
  return match ? match[1].trim() : ''
}

function getQQCookieValue(cookie, name) {
  const escapedName = String(name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return String(cookie || '').match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]*)`, 'i'))?.[1]?.trim() || ''
}

// QR login currently returns qm_keyst on some accounts, while the installed
// upstream vkey service still reads qqmusic_key. Keep the credential entirely
// inside the server boundary and add the compatible alias only for upstream use.
function normalizeQQUpstreamCookie(cookie) {
  const normalized = getSingleValue(cookie).trim()
  if (!normalized || getQQCookieValue(normalized, 'qqmusic_key')) return normalized
  const qmKeyst = getQQCookieValue(normalized, 'qm_keyst')
  return qmKeyst ? `${normalized}; qqmusic_key=${qmKeyst}` : normalized
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
    if (normalized === 'x-qq-music-session') return true
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

// ptqrlogin is a stateless poll: it reports the current scan state and is safe
// to repeat. The upstream resolver only distinguishes "login success" from
// "not scanned" and collapses the "scanned, waiting for confirm" state, so the
// 802 waiting UI can never appear. Probe the endpoint directly to surface that
// intermediate state, and only delegate to the upstream resolver once a login is
// confirmed so its proven session-exchange flow is reused unchanged.
const QQ_PTQR_LOGIN_URL = 'https://ssl.ptlogin2.qq.com/ptqrlogin?u1=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump&ptqrtoken=___TOKEN___&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-1711022193435&js_ver=23111510&js_type=1&login_sig=du-YS1h8*0GqVqcrru0pXkpwVg2DYw-DtbFulJ62IgPf6vfiJe*4ONVrYc5hMUNE&pt_uistyle=40&aid=716027609&daid=383&pt_3rd_aid=100497308&&o1vId=3674fc47871e9c407d8838690b355408&pt_js_version=v1.48.1'

// Map a raw ptqrlogin body to the public 8xx status the UI understands.
// 实测（2026-09）：未扫码返回 66「二维码未失效。」；扫码后未确认返回
// 67「二维码认证中。」；确认成功后返回 0「登录成功！」。故 67 对应 802，
// 65/80/85 与「已失效」文本对应 800。
function parsePtqloginStatus(text) {
  const body = String(text || '')
  if (body.includes('登录成功')) return 803
  if (body.includes('已失效')) return 800
  const match = body.match(/ptuiCB\(\s*['"]?(\d+)/i)
  if (match && match[1] === '67') return 802 // scanned, waiting for phone confirm
  if (match && (match[1] === '65' || match[1] === '80' || match[1] === '85')) return 800 // expired / cancelled
  return 801
}

async function probeQQLoginQrStatus({ ptqrtoken, qrsig }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await fetch(
      QQ_PTQR_LOGIN_URL.replace('___TOKEN___', encodeURIComponent(ptqrtoken)),
      { headers: { Cookie: `qrsig=${qrsig}` }, signal: controller.signal },
    )
    return parsePtqloginStatus(await response.text())
  } catch (_) {
    return 801
  } finally {
    clearTimeout(timer)
  }
}

// Default QR check that surfaces the 802 "scanned, waiting for confirm" state.
// The 803 success path still delegates to the upstream resolver so the cookie /
// session exchange is reused untouched; everything else returns a lightweight,
// credential-free body that carries the 8xx code for the client.
async function checkQQLoginQrWithStatus({ ptqrtoken, qrsig }) {
  const code = await probeQQLoginQrStatus({ ptqrtoken, qrsig })
  if (code === 803) {
    const { status, body } = unwrapServiceResponse(await qqServices.checkQQLoginQr({
      method: 'get',
      option: {},
      params: { ptqrtoken, qrsig },
    }))
    if (body && typeof body === 'object') body.code = 803
    return { status, body }
  }
  return {
    status: 200,
    body: {
      isOk: false,
      refresh: code === 800,
      code,
      message: code === 800 ? '二维码已失效' : code === 802 ? '已扫码，等待确认' : '未扫描二维码',
    },
  }
}

// QQ 公共类型搜索（无登录要求）。client_search_cp 的分类由 t 参数选择：
// 0=歌曲 8=专辑 9=歌手 12=MV；歌单分类上游不提供。上游 package 的搜索服务
// 总会注入默认 remoteplace，导致非歌曲分类返回空列表，因此这里用与真实
// 客户端一致的固定参数模板直连上游，避免把任意 URL 控制权交给前端。
const QQ_SEARCH_URL_TEMPLATE = 'https://c.y.qq.com/soso/fcgi-bin/client_search_cp?format=json&t=___T___&n=___N___&p=___P___&w=___W___&catZhida=___CAT___&aggr=1&cr=1&lossless=0&flag_qc=0&platform=yqq.json'
const QQ_SEARCH_CATEGORIES = new Set([0, 8, 9, 12])
const QQ_SEARCH_MAX_PAGE_SIZE = 50

async function searchQQMusicPublic({ keyword, category, limit, page, catZhida }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const url = QQ_SEARCH_URL_TEMPLATE
      .replace('___T___', String(category))
      .replace('___N___', String(limit))
      .replace('___P___', String(page))
      .replace('___W___', encodeURIComponent(keyword))
      .replace('___CAT___', String(catZhida))
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Referer: 'https://y.qq.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: controller.signal,
    })
    const payload = await response.json()
    return {
      status: response.ok ? 200 : Number(response.status) || 502,
      body: payload && typeof payload === 'object' ? payload : {},
    }
  } finally {
    clearTimeout(timer)
  }
}

function createQQSecurityMiddleware(options = {}) {
  const getLoginQr = options.getLoginQr || (async () => qqServices.getQQLoginQr({}))
  const checkLoginQr = options.checkLoginQr || checkQQLoginQrWithStatus
  const persistSession = options.persistSession || persistQQLoginSession
  const clearSession = options.clearSession || clearQQLoginSession
  const getSession = options.getSession || getQQLoginSession
  const sessionStore = options.sessionStore || qrSessions
  const sessionIdFactory = options.sessionIdFactory || createOpaqueSessionId
  const now = options.now || Date.now
  const logSink = options.logSink
  const allowServerSession = options.allowServerSession !== false
  const searchService = options.searchService || searchQQMusicPublic

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
        if (options.exposeClientSession === true) body.clientSession = encodeQQClientSession(body.session)
        persistSession(body.session)
        sessionStore.delete(sessionId)
      }
      const safeBody = sanitizeQQResponseBody(body)
      if (options.exposeClientSession === true && body.isOk === true && body.session?.cookie && safeBody && typeof safeBody === 'object') {
        safeBody.clientSession = encodeQQClientSession(body.session)
      }
      writeJson(ctx, status, safeBody)
      return
    }

    if (normalizedPath === '/session/status') {
      if (ctx.method !== 'GET') {
        writeJson(ctx, 405, { error: 'Method not allowed' })
        return
      }
      const sessionHeader = getSingleValue(ctx.headers?.['x-qq-music-session'] || ctx.headers?.['X-QQ-Music-Session']).trim()
      let clientSession = null
      if (sessionHeader) {
        try { clientSession = JSON.parse(Buffer.from(sessionHeader, 'base64url').toString('utf8')) } catch (_) {}
      }
      const session = clientSession?.cookie ? clientSession : (allowServerSession ? getSession() : null)
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

    // 公共搜索：无需登录会话，只放行固定分类与安全参数。
    if (normalizedPath === '/getsearchbykey') {
      if (ctx.method !== 'GET') {
        writeJson(ctx, 405, { error: 'Method not allowed' })
        return
      }
      const keyword = getSingleValue(ctx.query?.key || ctx.query?.w).trim()
      if (!keyword) {
        writeJson(ctx, 400, { error: 'search key is required' })
        return
      }
      const category = Number(ctx.query?.t)
      if (!QQ_SEARCH_CATEGORIES.has(category)) {
        writeJson(ctx, 400, { error: 'unsupported search category' })
        return
      }
      const requestedLimit = Number(ctx.query?.n)
      const limit = Math.min(
        Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.trunc(requestedLimit) : 10, 1),
        QQ_SEARCH_MAX_PAGE_SIZE,
      )
      const requestedPage = Number(ctx.query?.p)
      const page = Math.max(Number.isFinite(requestedPage) && requestedPage > 0 ? Math.trunc(requestedPage) : 1, 1)
      const catZhida = Number(ctx.query?.catZhida) === 0 ? 0 : 1
      try {
        const { status, body } = unwrapServiceResponse(await searchService({ keyword, category, limit, page, catZhida }))
        writeJson(ctx, status, sanitizeQQResponseBody(body))
      } catch (_) {
        writeJson(ctx, 502, { error: 'QQ Music search unavailable' })
      }
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

    const clientHeader = getSingleValue(ctx.headers?.['x-qq-music-session'] || ctx.headers?.['X-QQ-Music-Session']).trim()
    let clientCookie = getSingleValue(ctx.headers?.['x-qq-music-cookie'] || ctx.headers?.['X-QQ-Music-Cookie']).trim()
    let clientUin = ''
    let clientEuin = ''
    if (!clientCookie && clientHeader) {
      try {
        const decoded = JSON.parse(Buffer.from(clientHeader, 'base64url').toString('utf8'))
        clientCookie = getSingleValue(decoded?.cookie).trim()
        clientUin = getSingleValue(decoded?.uin).trim()
        clientEuin = getSingleValue(decoded?.euin).trim()
      } catch (_) {}
    }
    const serverSession = allowServerSession ? getSession() : null
    if (ctx.headers) {
      delete ctx.headers['x-qq-music-session']
      delete ctx.headers['X-QQ-Music-Session']
      delete ctx.headers['x-qq-music-cookie']
      delete ctx.headers['X-QQ-Music-Cookie']
    }
    if (ctx.request?.headers) {
      delete ctx.request.headers['x-qq-music-session']
      delete ctx.request.headers['X-QQ-Music-Session']
      delete ctx.request.headers['x-qq-music-cookie']
      delete ctx.request.headers['X-QQ-Music-Cookie']
    }
    const sessionCookie = normalizeQQUpstreamCookie(clientCookie || getSingleValue(serverSession?.cookie).trim())
    if (!sessionCookie) {
      writeJson(ctx, 401, { error: 'QQ Music session required' })
      return
    }
    const activeSession = clientCookie
      ? {
          ...(serverSession || {}),
          cookie: sessionCookie,
          ...(clientUin ? { uin: clientUin } : {}),
          ...(clientEuin ? { euin: clientEuin } : {}),
        }
      : {
          ...(serverSession || {}),
          cookie: sessionCookie,
        }
    if (activeSession?.cookie) {
      syncQQUpstreamUserInfo(activeSession)
      ctx.request.cookie = activeSession.cookie
      ctx.state = ctx.state || {}
      ctx.state.requestCookie = activeSession.cookie
      const needsUin = /^\/user\/(?:getuseravatar|getuserplaylists|getuserdetail|getusercollectedsonglists|getusercollectedalbums|getuserfollowsingers|getuserfollowusers|getuserfans|getuserlikedsongs)$/i.test(normalizedPath)
      if (needsUin) {
        const uin = normalizeQQUin(activeSession.uin || activeSession.loginUin || clientUin || parseCookieUin(activeSession.cookie))
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
app.middleware.unshift(createQQSecurityMiddleware({
  exposeClientSession: true,
  persistSession: () => {},
  clearSession: () => {},
  allowServerSession: false,
}))

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
  parsePtqloginStatus,
  normalizeQQUin,
  normalizeQQPath,
  isQQPathAllowed,
  runWithQQSafeLogging,
}
