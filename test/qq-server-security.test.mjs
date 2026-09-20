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
  parsePtqloginStatus,
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

test('QQ QR login returns a browser-owned opaque session while sanitizing upstream credentials', async () => {
  const persisted = []
  const middleware = createQQSecurityMiddleware({
    exposeClientSession: true,
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
  assert.equal(checkContext.body.isOk, true)
  assert.equal(checkContext.body.message, 'ok')
  assert.deepEqual(checkContext.body.session, { loginUin: '12345', uin: '12345' })
  assert.equal(typeof checkContext.body.clientSession, 'string')
  const decoded = JSON.parse(Buffer.from(checkContext.body.clientSession, 'base64url').toString('utf8'))
  assert.deepEqual(decoded, {
    cookie: 'uin=12345; qqmusic_key=server-secret',
    uin: '12345',
    euin: 'encrypted-user-id',
  })
  assert.equal(JSON.stringify(checkContext.body).includes('server-secret'), false)
})

test('ptqrlogin poll body maps to the public 8xx QR status', () => {
  assert.equal(parsePtqloginStatus("ptuiCB('0', '', '', '');"), 801)
  assert.equal(parsePtqloginStatus("ptuiCB('65', '', '', 'expired');"), 800)
  assert.equal(parsePtqloginStatus("ptuiCB('66', '', '', '二维码未失效。');"), 801)
  assert.equal(parsePtqloginStatus("ptuiCB('67', '0', '', '0', '二维码认证中。', '');"), 802)
  assert.equal(parsePtqloginStatus("ptuiCB('85', '', '', '');"), 800)
  assert.equal(parsePtqloginStatus("ptuiCB('80', '', '', '');"), 800)
  assert.equal(parsePtqloginStatus('login_jump 登录成功'), 803)
  assert.equal(parsePtqloginStatus('ptqrlogin 已失效'), 800)
  assert.equal(parsePtqloginStatus(''), 801)
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
    '/getRecommend',
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

  for (const path of ['/getMusicPlay', '/getLyric', '/user/getUserPlaylists']) {
    const context = createContext(path, { method: 'POST', body: {} })
    let reached = false
    await middleware(context, async () => { reached = true })
    assert.equal(reached, false, `${path} must reject mutating methods`)
    assert.equal(context.status, 404)
  }

  // 歌单详情已改为公共只读端点，非 GET 由公共处理器直接拒绝。
  const publicDetailContext = createContext('/getSongListDetail', { method: 'POST', body: {} })
  let publicDetailReached = false
  await middleware(publicDetailContext, async () => { publicDetailReached = true })
  assert.equal(publicDetailReached, false, 'public playlist detail must reject mutating methods')
  assert.equal(publicDetailContext.status, 405)
})

test('QQ public playlist detail is served without a login session', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    songListDetailService: async params => {
      calls.push(params)
      return {
        status: 200,
        body: {
          response: {
            code: 0,
            data: { cdlist: [{ disstid: params.disstid, title: '公共歌单', songnum: 1, songlist: [{ mid: 'mid-1', name: '晴天' }] }] },
          },
        },
      }
    },
  })

  const context = createContext('/getSongListDetail?disstid=7707261125')
  let reached = false
  await middleware(context, async () => { reached = true })

  assert.equal(reached, false, 'playlist detail must be handled before the session-required boundary')
  assert.deepEqual(calls, [{ disstid: '7707261125' }])
  assert.equal(context.status, 200)
  assert.equal(context.body.response.data.cdlist[0].title, '公共歌单')
  assert.equal(context.body.response.data.cdlist[0].songlist.length, 1)

  const invalidContext = createContext('/getSongListDetail?disstid=not-a-number')
  await middleware(invalidContext, async () => {})
  assert.equal(invalidContext.status, 400)
})

test('QQ public search forwards sanitized category params without a login session', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    searchService: async params => {
      calls.push(params)
      return { status: 200, body: { code: 0, data: { song: { list: [{ songmid: 'mid-1', songname: '晴天' }] } } } }
    },
  })

  const context = createContext('/getSearchByKey?key=%E5%91%A8%E6%9D%B0%E4%BC%A6&t=8&n=5&p=2&catZhida=0')
  let reached = false
  await middleware(context, async () => { reached = true })

  assert.equal(reached, false, 'search must be handled before the session-required boundary')
  assert.equal(context.status, 200)
  assert.deepEqual(calls, [{ keyword: '周杰伦', category: 8, limit: 5, page: 2, catZhida: 0 }])
  assert.equal(context.body.code, 0)
  assert.equal(context.body.data.song.list[0].songmid, 'mid-1')
})

test('QQ public search rejects missing keys, unsupported categories and non-GET methods', async () => {
  const middleware = createQQSecurityMiddleware({ getSession: () => null })

  const missingKey = createContext('/getSearchByKey?t=0')
  await middleware(missingKey, async () => {})
  assert.equal(missingKey.status, 400)

  const badCategory = createContext('/getSearchByKey?key=song&t=7')
  await middleware(badCategory, async () => {})
  assert.equal(badCategory.status, 400)

  const unsupported = createContext('/getSearchByKey?key=song&t=15')
  await middleware(unsupported, async () => {})
  assert.equal(unsupported.status, 400)

  const post = createContext('/getSearchByKey?key=song&t=0', { method: 'POST', body: {} })
  await middleware(post, async () => {})
  assert.equal(post.status, 405)
})

test('QQ public search clamps page size and defaults pagination', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    searchService: async params => {
      calls.push(params)
      return { status: 200, body: {} }
    },
  })
  const context = createContext('/getSearchByKey?key=song&t=0&n=999&p=0')
  await middleware(context, async () => {})
  assert.equal(context.status, 200)
  assert.deepEqual(calls[0], { keyword: 'song', category: 0, limit: 50, page: 1, catZhida: 1 })
})

test('QQ public album info forwards albummid without a login session', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    albumInfoService: async params => {
      calls.push(params)
      return { status: 200, body: { response: { code: '0', data: { mid: 'album-mid', name: '七里香' } } } }
    },
  })

  const context = createContext('/getAlbumInfo?albummid=album-mid')
  let reached = false
  await middleware(context, async () => { reached = true })

  assert.equal(reached, false, 'album detail must be handled before the session-required boundary')
  assert.equal(context.status, 200)
  assert.deepEqual(calls, [{ albummid: 'album-mid' }])
  assert.equal(context.body.response.data.mid, 'album-mid')
})

test('QQ public album info rejects missing albummid and non-GET methods', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    albumInfoService: async () => ({ status: 200, body: {} }),
  })

  const missing = createContext('/getAlbumInfo')
  await middleware(missing, async () => {})
  assert.equal(missing.status, 400)

  const post = createContext('/getAlbumInfo?albummid=album-mid', { method: 'POST', body: {} })
  await middleware(post, async () => {})
  assert.equal(post.status, 405)
})

test('QQ public singer info forwards sanitized params without a login session', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    singerService: async params => {
      calls.push(params)
      return { status: 200, body: { desc: '简介', starNum: 100, hotSongs: [{ songMID: 'm1' }], mvs: [{ vid: 'v1' }] } }
    },
  })

  const context = createContext('/getSingerInfo?singermid=s-mid&name=%E5%91%A8%E6%9D%B0%E4%BC%A6&singerid=4558')
  let reached = false
  await middleware(context, async () => { reached = true })

  assert.equal(reached, false, 'singer detail must be handled before the session-required boundary')
  assert.equal(context.status, 200)
  assert.deepEqual(calls, [{ singermid: 's-mid', name: '周杰伦', singerid: '4558' }])
  assert.equal(context.body.desc, '简介')
  assert.equal(context.body.hotSongs[0].songMID, 'm1')
  assert.equal(context.body.mvs[0].vid, 'v1')
})

test('QQ public singer info rejects missing singermid, trims identity params and blocks POST', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    singerService: async params => {
      calls.push(params)
      return { status: 200, body: {} }
    },
  })

  const missing = createContext('/getSingerInfo')
  await middleware(missing, async () => {})
  assert.equal(missing.status, 400)

  const dirty = createContext('/getSingerInfo?singermid=s-mid&name=%20abc%20&singerid=45a8b8c')
  await middleware(dirty, async () => {})
  assert.equal(dirty.status, 200)
  assert.deepEqual(calls[0], { singermid: 's-mid', name: 'abc', singerid: '4588' })

  const post = createContext('/getSingerInfo?singermid=s-mid', { method: 'POST', body: {} })
  await middleware(post, async () => {})
  assert.equal(post.status, 405)
})

test('QQ public singer songs forwards page/limit without a login session', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    singerSongsService: async params => {
      calls.push(params)
      return {
        status: 200,
        body: { songlist: [{ songmid: 'm1', token: 'stale-token' }], total_song: 1012, cookie: 'uin=must-not-leak' },
      }
    },
  })

  const context = createContext('/getSingerSongs?singermid=s-mid&page=2&limit=30')
  let reached = false
  await middleware(context, async () => { reached = true })

  assert.equal(reached, false, 'singer songs must be handled before the session-required boundary')
  assert.equal(context.status, 200)
  assert.deepEqual(calls, [{ singermid: 's-mid', page: 2, limit: 30 }])
  assert.equal(context.body.songs.length, 1)
  assert.equal(context.body.totalSong, 1012)
  assert.equal(JSON.stringify(context.body).includes('must-not-leak'), false)
  assert.equal(JSON.stringify(context.body).includes('stale-token'), false)
})

test('QQ public singer songs clamps paging params and rejects missing singermid or POST', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    singerSongsService: async params => {
      calls.push(params)
      return { status: 200, body: {} }
    },
  })

  const missing = createContext('/getSingerSongs')
  await middleware(missing, async () => {})
  assert.equal(missing.status, 400)

  const defaults = createContext('/getSingerSongs?singermid=s-mid')
  await middleware(defaults, async () => {})
  assert.equal(defaults.status, 200)
  assert.deepEqual(calls[0], { singermid: 's-mid', page: 0, limit: 60 })

  // 上游单次上限 60：超限与非法值都收敛到 60，负数 page 收敛到 0
  const clamped = createContext('/getSingerSongs?singermid=s-mid&page=-3&limit=999')
  await middleware(clamped, async () => {})
  assert.equal(clamped.status, 200)
  assert.deepEqual(calls[1], { singermid: 's-mid', page: 0, limit: 60 })

  const post = createContext('/getSingerSongs?singermid=s-mid', { method: 'POST', body: {} })
  await middleware(post, async () => {})
  assert.equal(post.status, 405)
})

test('QQ public singer albums forwards page/limit without a login session', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    singerAlbumsService: async params => {
      calls.push(params)
      return {
        status: 200,
        body: { albumList: [{ albumMid: 'a-mid', token: 'stale-token' }], total: 43, cookie: 'uin=must-not-leak' },
      }
    },
  })

  const context = createContext('/getSingerAlbums?singermid=s-mid&page=1&limit=20')
  let reached = false
  await middleware(context, async () => { reached = true })

  assert.equal(reached, false, 'singer albums must be handled before the session-required boundary')
  assert.equal(context.status, 200)
  assert.deepEqual(calls, [{ singermid: 's-mid', page: 1, limit: 20 }])
  assert.equal(context.body.albums.length, 1)
  assert.equal(context.body.totalAlbum, 43)
  assert.equal(JSON.stringify(context.body).includes('must-not-leak'), false)
  assert.equal(JSON.stringify(context.body).includes('stale-token'), false)
})

test('QQ public singer albums clamps paging params and rejects missing singermid or POST', async () => {
  const calls = []
  const middleware = createQQSecurityMiddleware({
    getSession: () => null,
    singerAlbumsService: async params => {
      calls.push(params)
      return { status: 200, body: {} }
    },
  })

  const missing = createContext('/getSingerAlbums')
  await middleware(missing, async () => {})
  assert.equal(missing.status, 400)

  const defaults = createContext('/getSingerAlbums?singermid=s-mid')
  await middleware(defaults, async () => {})
  assert.equal(defaults.status, 200)
  assert.deepEqual(calls[0], { singermid: 's-mid', page: 0, limit: 30 })

  // limit 上限 100：超限与非法值都收敛，负数 page 收敛到 0
  const clamped = createContext('/getSingerAlbums?singermid=s-mid&page=-3&limit=999')
  await middleware(clamped, async () => {})
  assert.equal(clamped.status, 200)
  assert.deepEqual(calls[1], { singermid: 's-mid', page: 0, limit: 100 })

  const post = createContext('/getSingerAlbums?singermid=s-mid', { method: 'POST', body: {} })
  await middleware(post, async () => {})
  assert.equal(post.status, 405)
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

test('QQ client session header authenticates status and private requests without server persistence', async () => {
  const clientSession = Buffer.from(JSON.stringify({
    cookie: 'uin=24680; qqmusic_key=client-secret',
    uin: '24680',
  }), 'utf8').toString('base64url')
  const middleware = createQQSecurityMiddleware({
    allowServerSession: false,
    getSession: () => null,
  })
  const statusContext = createContext('/session/status', {
    headers: { 'X-QQ-Music-Session': clientSession },
  })
  await middleware(statusContext, async () => assert.fail('session status must be handled privately'))
  assert.deepEqual(statusContext.body, { loggedIn: true, session: { loginUin: '24680', uin: '24680' } })

  const profileContext = createContext('/user/getUserDetail', {
    headers: { 'X-QQ-Music-Session': clientSession },
  })
  await middleware(profileContext, async () => {
    assert.equal(profileContext.request.cookie, 'uin=24680; qqmusic_key=client-secret')
    assert.equal(profileContext.query.uin, '24680')
    profileContext.body = { ok: true }
  })
  assert.deepEqual(profileContext.body, { ok: true })
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

test('QQ playback aliases the QR login qm_keyst credential for the upstream VIP vkey service', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=12345; qm_keyst=vip-secret' }),
  })
  const context = createContext('/getMusicPlay?songmid=vip-mid')

  await middleware(context, async () => {
    assert.match(context.request.cookie, /(?:^|;\s*)qm_keyst=vip-secret(?:;|$)/)
    assert.match(context.request.cookie, /(?:^|;\s*)qqmusic_key=vip-secret(?:;|$)/)
    context.body = { data: { playUrl: { 'vip-mid': { url: 'https://example.test/vip.mp3' } } } }
  })

  assert.equal(JSON.stringify(context.body).includes('vip-secret'), false)
})

test('QQ playback hands the upstream vkey service a numeric uin instead of the cookie representation', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=o0012345; qm_keyst=vip-secret', uin: 'o0012345', loginUin: 'o0012345' }),
  })
  const context = createContext('/getMusicPlay?songmid=vip-mid')

  await middleware(context, async () => {
    assert.match(context.request.cookie, /(?:^|;\s*)uin=12345(?:;|$)/)
    assert.equal(context.request.cookie.includes('uin=o0012345'), false)
    assert.match(context.request.cookie, /(?:^|;\s*)qqmusic_key=vip-secret(?:;|$)/)
    context.body = { data: { playUrl: { 'vip-mid': { url: 'https://example.test/vip.mp3' } } } }
  })
})

test('QQ playback keeps a plain numeric uin untouched while aliasing the member credential', async () => {
  const middleware = createQQSecurityMiddleware({
    getSession: () => ({ cookie: 'uin=24680; qm_keyst=vip-secret' }),
  })
  const context = createContext('/getMusicPlay?songmid=vip-mid')

  await middleware(context, async () => {
    assert.match(context.request.cookie, /(?:^|;\s*)uin=24680(?:;|$)/)
    assert.match(context.request.cookie, /(?:^|;\s*)qqmusic_key=vip-secret(?:;|$)/)
    context.body = { ok: true }
  })
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
