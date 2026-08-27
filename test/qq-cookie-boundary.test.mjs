import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeQQPayload, containsQQSecret } from '../src/utils/qqSecurity.mjs'

test('QQ API payload sanitizer removes secrets recursively', () => {
  const raw = {
    code: 200,
    data: {
      nickname: 'safe',
      cookie: 'uin=123; p_skey=secret',
      session: {
        uin: '123',
        qrsig: 'temporary-secret',
        cookieList: ['uin=123'],
        cookieObject: { p_skey: 'secret' },
        profile: { name: 'safe' },
      },
    },
  }

  const safe = sanitizeQQPayload(raw)
  assert.equal(containsQQSecret(safe), false)
  assert.deepEqual(safe, {
    code: 200,
    data: {
      nickname: 'safe',
      session: { uin: '123', profile: { name: 'safe' } },
    },
  })
})

test('QQ payload secret detector rejects authorization material', () => {
  assert.equal(containsQQSecret({ nested: { qqmusic_key: 'secret' } }), true)
  assert.equal(containsQQSecret({ nested: { name: 'safe' } }), false)
})

test('QQ payload sanitizer redacts credentials embedded in response text', () => {
  const safe = sanitizeQQPayload({
    message: 'cookie: uin=1; p_skey=secret qrsig=temporary-secret Bearer access-token',
  })

  assert.deepEqual(safe, {
    message: 'cookie: [REDACTED]; p_skey=[REDACTED] qrsig=[REDACTED] Bearer [REDACTED]',
  })
  assert.equal(JSON.stringify(safe).includes('secret'), false)
  assert.equal(JSON.stringify(safe).includes('access-token'), false)
})

test('QQ payload secret detector catches credentials embedded in text', () => {
  assert.equal(containsQQSecret({ message: 'request failed qrsig=temporary-secret' }), true)
  assert.equal(containsQQSecret({ message: 'request failed safely' }), false)
})

test('QQ security canonicalizes credential key aliases', () => {
  const aliases = {
    euin: 'encrypted-uin',
    accessToken: 'access-secret',
    'refresh-token': 'refresh-secret',
    g_tk: 'gtk-secret',
    qqmusicKey: 'music-key-secret',
    cookieString: 'cookie-secret',
    cookieMap: { uin: 'cookie-map-secret' },
    cookieHeader: 'cookie-header-secret',
    idToken: 'id-token-secret',
    authToken: 'auth-token-secret',
    proxyAuthorization: 'proxy-auth-secret',
    login_sig: 'login-signature-secret',
    p_uin: 'plain-uin-secret',
    qm_keyst: 'qm-key-secret',
    pt4_token: 'pt4-token-secret',
  }

  assert.equal(containsQQSecret(aliases), true)
  assert.deepEqual(sanitizeQQPayload({ safe: 'visible', ...aliases }), { safe: 'visible' })
})

test('QQ security redacts credential aliases embedded in text', () => {
  const safe = sanitizeQQPayload({
    message: 'euin=one accessToken=two refresh-token=three g_tk=four qqmusicKey=five cookieString=six cookieMap=seven login_sig=eight',
  })

  assert.equal(containsQQSecret(safe), false)
  assert.equal(JSON.stringify(safe).includes('one'), false)
  assert.equal(JSON.stringify(safe).includes('eight'), false)
})

test('QQ security redacts newer cookie aliases embedded in text', () => {
  const safe = sanitizeQQPayload({
    message: 'p_uin=one qm_keyst=two pt4_token=three qqmusic_uin=four',
  })
  assert.equal(containsQQSecret(safe), false)
  assert.doesNotMatch(safe.message, /one|two|three|four/)
})

test('QQ security redacts header and token aliases embedded in text', () => {
  const safe = sanitizeQQPayload({
    message: 'cookieHeader=one idToken=two authToken=three proxyAuthorization=four',
  })
  assert.equal(containsQQSecret(safe), false)
  assert.doesNotMatch(safe.message, /one|two|three|four/)
})

test('QQ persistent state is projected to non-sensitive profile fields', async () => {
  const { createQQPersistedState } = await import('../src/utils/qqSession.mjs')
  const state = createQQPersistedState({
    loggedIn: true,
    user: { uin: '123', nickname: 'safe', avatar: 'https://img', cookie: 'secret', nested: { qrsig: 'secret' } },
    vip: { level: 2, cookieObject: { p_skey: 'secret' } },
  })
  assert.deepEqual(state, {
    loggedIn: true,
    user: { uin: '123', nickname: 'safe', avatar: 'https://img' },
    vip: { level: 2 },
  })
  assert.equal(containsQQSecret(state), false)
})

test('QQ persistent state accepts only scalar account fields and safe URL strings', async () => {
  const { createQQPersistedState } = await import('../src/utils/qqSession.mjs')
  const state = createQQPersistedState({
    loggedIn: true,
    user: {
      uin: 123,
      id: { accessToken: 'nested-secret' },
      nickname: ['not-a-scalar'],
      nick: 'safe nick',
      name: true,
      avatar: { accessToken: 'persist-secret' },
      avatarUrl: 'https://img.example/avatar.png?accessToken=secret',
    },
    vip: {
      level: 3,
      vipLevel: '4',
      isVip: true,
      icon: 'data:text/plain,accessToken=secret',
      expireTime: { refreshToken: 'nested-secret' },
    },
  })

  assert.deepEqual(state, {
    loggedIn: true,
    user: { uin: '123', nick: 'safe nick' },
    vip: { level: 3, vipLevel: 4, isVip: true },
  })
  assert.equal(containsQQSecret(state), false)
})

test('QQ login polling parameters are opaque outside the server', async () => {
  const { createPublicQQLoginSession } = await import('../src/utils/qqSession.mjs')
  const publicSession = createPublicQQLoginSession({
    sessionId: 'server-session-id',
    ptqrtoken: 'secret-token',
    qrsig: 'secret-signature',
    img: 'data:image/png;base64,AAAA',
  })
  assert.deepEqual(publicSession, {
    sessionId: 'server-session-id',
    img: 'data:image/png;base64,AAAA',
  })
  assert.equal(containsQQSecret(publicSession), false)
})
