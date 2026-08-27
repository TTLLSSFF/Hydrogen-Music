import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import http from 'node:http'
import { spawnSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const {
  createQQSecurityMiddleware,
  hasSensitiveQQQuery,
  persistQQLoginSession,
  clearQQLoginSession,
  syncQQUpstreamUserInfo,
  sanitizeQQProxyRequestHeaders,
  sanitizeQQProxyResponseHeaders,
  sanitizeQQLoginQrBody,
  normalizeQQUin,
  isQQPathAllowed,
  startQQMusicApi,
  stopQQMusicApi,
} = require('../server/qqMusicApi.cjs')

function createContext(path, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(path, 'http://localhost')
  const responseHeaders = new Map()
  return {
    method,
    path: url.pathname,
    url: `${url.pathname}${url.search}`,
    query: Object.fromEntries(url.searchParams),
    headers: { ...headers },
    request: { body, headers: { ...headers } },
    response: { headers: responseHeaders },
    set(name, value) {
      responseHeaders.set(name.toLowerCase(), value)
    },
    remove(name) {
      responseHeaders.delete(name.toLowerCase())
    },
  }
}

test('QQ QR login keeps upstream credentials server-side and returns an opaque session id', async () => {
  const persisted = []
  const middleware = createQQSecurityMiddleware({
    getLoginQr: async () => ({
      status: 200,
      body: { img: 'data:image/png;base64,AA==', ptqrtoken: 'qr-token', qrsig: 'qr-secret' },
    }),
    checkLoginQr: async ({ ptqrtoken, qrsig }) => {
      assert.equal(ptqrtoken, 'qr-token')
      assert.equal(qrsig, 'qr-secret')
      return {
        status: 200,
        body: {
          isOk: true,
          message: 'ok',
          session: {
            loginUin: '12345',
            uin: '12345',
            euin: 'encrypted-user-id',
            cookie: 'uin=12345; qqmusic_key=server-secret',
            cookieList: ['uin=12345', 'qqmusic_key=server-secret'],
            cookieObject: { uin: '12345', qqmusic_key: 'server-secret' },
          },
        },
      }
    },
    persistSession: (session) => persisted.push(session),
    sessionIdFactory: () => 'opaque-session-id',
  })

  const qrContext = createContext('/getQQLoginQr')
  await middleware(qrContext, async () => assert.fail('QQ QR route must not reach the upstream HTTP router'))
  assert.deepEqual(qrContext.body, {
    img: 'data:image/png;base64,AA==',
    sessionId: 'opaque-session-id',
  })
  assert.equal(JSON.stringify(qrContext.body).includes('qr-secret'), false)
  assert.equal(JSON.stringify(qrContext.body).includes('qr-token'), false)

  const checkContext = createContext('/checkQQLoginQr', {
    method: 'POST',
    body: { sessionId: 'opaque-session-id' },
  })
  await middleware(checkContext, async () => assert.fail('QQ QR check must not reach the upstream HTTP router'))

  assert.equal(persisted.length, 1)
  assert.equal(persisted[0].cookie, 'uin=12345; qqmusic_key=server-secret')
  assert.deepEqual(checkContext.body, {
    isOk: true,
    message: 'ok',
    session: { loginUin: '12345', uin: '12345' },
  })
  assert.equal(JSON.stringify(checkContext.body).includes('server-secret'), false)
})

test('QQ QR responses drop credential-bearing image URLs', () => {
  const safe = sanitizeQQLoginQrBody({
    img: 'https://example.test/qr.png?safe=1&qrsig=temporary-secret',
    url: 'https://example.test/qr.png?safe=1',
  })
  assert.equal(safe.img, '')
  assert.equal(safe.url, 'https://example.test/qr.png?safe=1')
})

test('QQ security middleware blocks credential endpoints and credential-bearing URLs', async () => {
  const middleware = createQQSecurityMiddleware()

  for (const path of ['/user/getCookie', '/user/setCookie']) {
    const context = createContext(path)
    await middleware(context, async () => assert.fail(`${path} must be handled by the security boundary`))
    assert.equal(context.status, 404)
  }

  const context = createContext('/getMusicPlay?songmid=abc&cookie=uin%3Dsecret')
  await middleware(context, async () => assert.fail('credential-bearing URL must not reach upstream logging'))
  assert.equal(context.status, 400)
  assert.equal(JSON.stringify(context.body).includes('secret'), false)

  for (const path of [
    '/user/getUserMedal?euin=encrypted-user-id',
    '/getMusicPlay?accessToken=secret',
    '/getMusicPlay?g_tk=secret',
    '/getMusicPlay?cookieString=uin%3D123',
  ]) {
    const aliasContext = createContext(path)
    await middleware(aliasContext, async () => assert.fail(`${path} must not reach upstream`))
    assert.equal(aliasContext.status, 400)
  }
})

test('QQ security middleware forwards only private My Music and playback routes', async () => {
  assert.equal(isQQPathAllowed('/GETMUSICPLAY/song-mid/'), true)
  assert.equal(isQQPathAllowed('/getLyric/song-mid'), true)
  assert.equal(isQQPathAllowed('/getSongListDetail/list-id/'), true)
  assert.equal(isQQPathAllowed('/getSearchByKey/song'), false)

  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=24680', uin: '24680' }),
  })

  for (const path of [
    '/getSearchByKey?key=test',
    '/getRecommend',
    '/getAlbumInfo?albummid=album',
    '/getMv?vid=mv',
    '/user/getVipInfo',
    '/user/getUserMedal',
  ]) {
    const context = createContext(path)
    let reached = false
    await middleware(context, async () => {
      reached = true
      context.body = { ok: true }
    })
    assert.equal(reached, false, `${path} must be blocked by the QQ capability boundary`)
    assert.equal(context.status, 404)
    assert.deepEqual(context.body, { error: 'Not found' })
  }

  for (const path of [
    '/getMusicPlay?songmid=song-mid',
    '/getLyric?songmid=song-mid',
    '/getSongListDetail?disstid=playlist-id',
    '/user/getUserDetail',
    '/user/getUserAvatar',
    '/user/getUserLikedSongs',
    '/user/getUserPlaylists',
    '/user/getUserCollectedSongLists',
  ]) {
    const context = createContext(path)
    let reached = false
    await middleware(context, async () => {
      reached = true
      context.body = { ok: true }
    })
    assert.equal(reached, true, `${path} must remain available to the QQ My Music/playback client`)
    assert.deepEqual(context.body, { ok: true })
  }
})

test('QQ capability boundary keeps read-only routes GET-only', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=24680', uin: '24680' }),
  })

  for (const path of ['/getMusicPlay', '/getLyric', '/getSongListDetail', '/user/getUserPlaylists']) {
    const context = createContext(path, { method: 'POST', body: {} })
    let reached = false
    await middleware(context, async () => { reached = true })
    assert.equal(reached, false, `${path} must reject mutating methods`)
    assert.equal(context.status, 404)
  }
})

test('QQ public session status exposes only a non-secret account identifier', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({
      cookie: 'uin=12345; qqmusic_key=server-secret',
      loginUin: '12345',
      uin: '12345',
      euin: 'encrypted-user-id',
    }),
  })
  const context = createContext('/session/status')

  await middleware(context, async () => assert.fail('session status must be handled privately'))

  assert.deepEqual(context.body, { loggedIn: true, session: { loginUin: '12345', uin: '12345' } })
  assert.equal(JSON.stringify(context.body).includes('encrypted-user-id'), false)
})

test('QQ account identifiers normalize the login cookie uin representation', async () => {
  assert.equal(normalizeQQUin('o0012345'), '12345')
  assert.equal(normalizeQQUin('12345'), '12345')
  assert.equal(normalizeQQUin('oabc'), 'oabc')

  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=o0012345; qqmusic_key=server-secret', uin: 'o0012345', loginUin: 'o0012345' }),
  })

  const statusContext = createContext('/session/status')
  await middleware(statusContext, async () => assert.fail('session status must be handled privately'))
  assert.deepEqual(statusContext.body, { loggedIn: true, session: { loginUin: '12345', uin: '12345' } })

  const playlistContext = createContext('/user/getUserPlaylists')
  await middleware(playlistContext, async () => {
    assert.equal(playlistContext.query.uin, '12345')
    playlistContext.body = { ok: true }
  })
  assert.deepEqual(playlistContext.body, { ok: true })
})

test('QQ security middleware injects the server cookie and strips credentials from every response', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=12345; qqmusic_key=server-secret' }),
  })
  const context = createContext('/user/getUserDetail')
  context.set('set-cookie', 'qqmusic_key=server-secret')

  await middleware(context, async () => {
    assert.equal(context.request.cookie, 'uin=12345; qqmusic_key=server-secret')
    context.body = {
      data: {
        nickname: 'safe-name',
        cookie: 'uin=12345; qqmusic_key=server-secret',
        nested: { p_skey: 'server-secret' },
        message: 'upstream failed cookie: uin=12345; ptcz=embedded-secret',
      },
    }
  })

  assert.deepEqual(context.body, {
    data: {
      nickname: 'safe-name',
      nested: {},
      message: 'upstream failed cookie: [REDACTED]',
    },
  })
  assert.equal(context.response.headers.has('set-cookie'), false)
  assert.equal(JSON.stringify(context.body).includes('server-secret'), false)
})

test('QQ profile, avatar, liked songs and playlists receive the server-side uin', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=24680', uin: '24680' }),
  })
  for (const path of ['/user/getUserDetail', '/user/getUserAvatar', '/user/getUserLikedSongs', '/user/getUserPlaylists', '/user/getUserCollectedSongLists']) {
    const context = createContext(path)
    await middleware(context, async () => {
      assert.equal(context.query.uin, '24680')
      context.body = { ok: true }
    })
    assert.deepEqual(context.body, { ok: true })
  }
})

test('QQ logout clears the persisted server session without accepting a cookie payload', async () => {
  let clearCount = 0
  const middleware = createQQSecurityMiddleware({
    clearSession: () => { clearCount += 1 },
  })
  const context = createContext('/session/logout', { method: 'POST', body: {} })

  await middleware(context, async () => assert.fail('logout must be handled by the security boundary'))

  assert.equal(clearCount, 1)
  assert.deepEqual(context.body, { ok: true })
})

test('QQ persisted login state is updated through the package server-side user store', () => {
  const writes = []
  const scope = {
    userInfo: {
      refreshData(cookie) {
        writes.push(cookie)
        return {
          cookie,
          loginUin: cookie ? '12345' : '',
          // The upstream package returns a normalized placeholder here. The
          // bridge must retain the original disk-backed function instead.
          refreshData: () => { writes.push('placeholder-called') },
        }
      },
    },
  }

  persistQQLoginSession({ cookie: 'uin=12345; qqmusic_key=server-secret', euin: 'encrypted-id' }, scope)
  assert.deepEqual(writes, ['uin=12345; qqmusic_key=server-secret'])
  assert.equal(scope.userInfo.euin, 'encrypted-id')

  clearQQLoginSession(scope)
  assert.deepEqual(writes, ['uin=12345; qqmusic_key=server-secret', ''])
  assert.equal(scope.userInfo.cookie, '')
  assert.equal('euin' in scope.userInfo, false)
})

test('QQ authenticated requests keep euin available to upstream without exposing it', async () => {
  const scope = {
    userInfo: {
      cookie: '',
      refreshData: () => ({}),
    },
  }
  syncQQUpstreamUserInfo({ cookie: 'uin=12345', euin: 'encrypted-id', uin: '12345' }, scope)
  assert.equal(scope.userInfo.cookie, 'uin=12345')
  assert.equal(scope.userInfo.euin, 'encrypted-id')
  const middleware = createQQSecurityMiddleware({
    getSession: () => scope.userInfo,
  })
  const context = createContext('/user/getUserDetail')
  await middleware(context, async () => {
    assert.equal(context.request.cookie, 'uin=12345')
    context.body = { euin: scope.userInfo.euin, ok: true }
  })
  assert.deepEqual(context.body, { ok: true })
})

test('QQ proxy helpers reject sensitive query keys and remove credential headers', () => {
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?songmid=abc'), false)
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?Cookie=uin%3Dsecret'), true)
  assert.equal(hasSensitiveQQQuery('/checkQQLoginQr?qrsig=secret'), true)
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?debug=cookie%3Duin%3Dsecret'), true)
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?accessToken=secret'), true)
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?proxyAuthorization=secret'), true)
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?cookieHeader=secret'), true)
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?euin=encrypted-user-id'), true)
  assert.equal(hasSensitiveQQQuery('/getMusicPlay?cookie-map=secret'), true)

  const requestHeaders = sanitizeQQProxyRequestHeaders({
    accept: 'application/json',
    cookie: 'MUSIC_U=netease-secret',
    authorization: 'Bearer secret',
    'x-custom-cookie': 'uin=qq-secret',
  })
  assert.deepEqual(requestHeaders, { accept: 'application/json' })

  const responseHeaders = sanitizeQQProxyResponseHeaders({
    'content-type': 'application/json',
    'set-cookie': ['qqmusic_key=secret; HttpOnly'],
    'server-authorization': 'secret',
    location: '/callback?qqmusicKey=secret',
    'x-upstream-debug': 'Cookie: uin=12345; qqmusic_key=secret',
  })
  assert.deepEqual(responseHeaders, { 'content-type': 'application/json' })
})

test('QQ security middleware parses its private POST body before upstream body parser', async () => {
  const sessionStore = new Map([['opaque', { ptqrtoken: 'token', qrsig: 'signature', expiresAt: Date.now() + 10000 }]])
  const middleware = createQQSecurityMiddleware({
    sessionStore,
    checkLoginQr: async () => ({ status: 200, body: { isOk: false } }),
  })
  const chunks = [Buffer.from('{"sessionId":"opaque"}')]
  const context = createContext('/checkQQLoginQr', { method: 'POST' })
  context.req = { async *[Symbol.asyncIterator]() { yield* chunks } }

  await middleware(context, async () => assert.fail('private route must be handled'))
  assert.equal(context.status, 200)
  assert.deepEqual(context.body, { isOk: false })
})

test('QQ direct HTTP boundary parses private JSON and rejects credential injection', async (t) => {
  const listeningServer = await startQQMusicApi(0)
  t.after(() => stopQQMusicApi())
  const address = listeningServer.address()
  assert.equal(address.address, '127.0.0.1')

  const request = ({ path, headers = {}, body = '' }) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
    })
    req.on('error', reject)
    req.end(body)
  })

  const logout = await request({ path: '/session/logout', body: '{}' })
  assert.deepEqual(logout, { status: 200, body: { ok: true } })

  const headerInjection = await request({
    path: '/session/logout',
    headers: { cookie: 'qqmusic_key=must-not-enter' },
    body: '{}',
  })
  assert.equal(headerInjection.status, 400)
  assert.equal(JSON.stringify(headerInjection.body).includes('must-not-enter'), false)

  const bodyInjection = await request({
    path: '/session/logout',
    body: JSON.stringify({ cookie: 'qqmusic_key=must-not-enter' }),
  })
  assert.equal(bodyInjection.status, 400)
  assert.equal(JSON.stringify(bodyInjection.body).includes('must-not-enter'), false)
})

test('QQ request logging redacts Axios errors only inside its async request context', async () => {
  const captured = []
  const logSink = {
    log: (...args) => captured.push(['log', ...args]),
    error: (...args) => captured.push(['error', ...args]),
  }
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=12345; qqmusic_key=server-secret' }),
    logSink,
  })
  const context = createContext('/user/getUserDetail')
  await middleware(context, async () => {
    await Promise.resolve()
    const error = new Error('upstream request failed')
      error.config = {
        url: '/user/profile',
        token: 'plain-token-secret',
        params: { qrsig: 'query-qr-secret', page: 1 },
        headers: {
        Cookie: 'uin=12345; qqmusic_key=log-secret',
        Authorization: 'Bearer log-token',
      },
    }
    error.request = { _header: 'Cookie: qrsig=qr-log-secret' }
    console.error('QQ upstream failure:', error)
    context.body = { ok: false }
  })
  logSink.log('ordinary application log', { cookie: 'not-a-qq-request' })

  const qqLog = captured[0]
  assert.equal(qqLog[0], 'error')
  assert.equal(qqLog[1], 'QQ upstream failure:')
  assert.equal(qqLog[2].name, 'Error')
  assert.equal(qqLog[2].message, 'upstream request failed')
  assert.deepEqual(qqLog[2].config, {
    url: '/user/profile',
    token: '[REDACTED]',
    params: { qrsig: '[REDACTED]', page: 1 },
    headers: { Cookie: '[REDACTED]', Authorization: '[REDACTED]' },
  })
  assert.equal(JSON.stringify(qqLog).includes('log-secret'), false)
  assert.equal(JSON.stringify(qqLog).includes('log-token'), false)
  assert.equal(JSON.stringify(qqLog).includes('qr-log-secret'), false)
  assert.equal(JSON.stringify(qqLog).includes('plain-token-secret'), false)
  assert.equal(JSON.stringify(qqLog).includes('query-qr-secret'), false)

  assert.deepEqual(captured[1], ['log', 'ordinary application log', { cookie: 'not-a-qq-request' }])
})

test('QQ safe logging context uses the real console without recursion', () => {
  const script = `
    const { runWithQQSafeLogging } = require('./server/qqMusicApi.cjs')
    runWithQQSafeLogging(async () => {
      await Promise.resolve()
      console.log('QQ scoped diagnostic')
    }).then(() => console.log('after QQ context'))
  `
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 5000,
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /QQ scoped diagnostic/)
  assert.match(result.stdout, /after QQ context/)
})
