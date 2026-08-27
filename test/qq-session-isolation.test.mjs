import test from 'node:test'
import assert from 'node:assert/strict'
import { createQQPersistedState, createQQSessionSnapshot, sanitizeQQQrImage } from '../src/utils/qqSession.mjs'
import { createQQPersistStorage } from '../src/utils/qqSession.mjs'

test('QQ session snapshot excludes cookies and remains provider scoped', () => {
  const snapshot = createQQSessionSnapshot({ id: 7, nickname: 'qq-user', nested: { p_skey: 'secret' } }, { cookie: 'uin=secret' })
  assert.deepEqual(snapshot, { source: 'qq', loggedIn: true, user: { id: 7, nickname: 'qq-user', nested: {} } })
  assert.equal(JSON.stringify(snapshot).includes('secret'), false)
})

test('QQ persisted state is an allowlisted sanitized account projection', () => {
  const persisted = createQQPersistedState({
    loggedIn: true,
    user: {
      uin: '10001',
      nickname: 'qq-user',
      qrsig: 'temporary-secret',
      profile: { cookie: 'uin=secret' },
    },
    vip: {
      isVip: true,
      level: 3,
      token: 'access-token',
      detail: { p_skey: 'secret' },
    },
    sessionId: 'qr-session-42',
  })

  assert.deepEqual(persisted, {
    loggedIn: true,
    user: { uin: '10001', nickname: 'qq-user' },
    vip: { level: 3, isVip: true },
  })
  assert.equal(JSON.stringify(persisted).includes('secret'), false)
  assert.equal(JSON.stringify(persisted).includes('session'), false)
})

function createMemoryStorage(entries = {}) {
  const data = new Map(Object.entries(entries))
  const writes = []
  const removes = []
  return {
    writes,
    removes,
    getItem: key => data.get(key) ?? null,
    setItem(key, value) {
      data.set(key, String(value))
      writes.push([key, String(value)])
    },
    removeItem(key) {
      data.delete(key)
      removes.push(key)
    },
  }
}

test('QQ legacy storage is sanitized and overwritten during its first read', () => {
  const raw = JSON.stringify({
    loggedIn: true,
    user: { uin: '10001', nickname: 'safe', euin: 'encrypted', accessToken: 'secret' },
    vip: { level: 2, cookieMap: { p_skey: 'secret' } },
    sessionId: 'old-session',
  })
  const backing = createMemoryStorage({ qqAccountStore: raw })
  const storage = createQQPersistStorage(backing)

  const firstRead = storage.getItem('qqAccountStore')

  assert.deepEqual(JSON.parse(firstRead), {
    loggedIn: true,
    user: { uin: '10001', nickname: 'safe' },
    vip: { level: 2 },
  })
  assert.deepEqual(backing.writes, [['qqAccountStore', firstRead]])
})

test('QQ legacy storage removes malformed state during its first read', () => {
  const backing = createMemoryStorage({ qqAccountStore: '{not-json' })
  const storage = createQQPersistStorage(backing)

  assert.equal(storage.getItem('qqAccountStore'), null)
  assert.deepEqual(backing.removes, ['qqAccountStore'])
})

test('QQ persistence storage sanitizes every value before writing', () => {
  const backing = createMemoryStorage()
  const storage = createQQPersistStorage(backing)

  storage.setItem('qqAccountStore', JSON.stringify({
    loggedIn: true,
    user: { uin: '1', nickname: 'safe', refreshToken: 'secret' },
    vip: null,
  }))

  assert.deepEqual(JSON.parse(backing.writes[0][1]), {
    loggedIn: true,
    user: { uin: '1', nickname: 'safe' },
    vip: null,
  })
})

test('QQ QR image URLs never expose credential query parameters', () => {
  assert.equal(
    sanitizeQQQrImage('https://example.test/qr.png?safe=1&qrsig=temporary-secret'),
    '',
  )
  assert.equal(
    sanitizeQQQrImage('https://example.test/qr.png?safe=1'),
    'https://example.test/qr.png?safe=1',
  )
  assert.equal(sanitizeQQQrImage('data:image/png;base64,AA=='), 'data:image/png;base64,AA==')
})
