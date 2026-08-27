import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createQQQrCheckRequestConfig,
  createQQRequest,
  createQQRequestConfig,
} from '../src/utils/qqRequest.mjs'
import { checkQQLoginQr } from '../src/api/qq.js'

test('QQ request rejects secret material before it can enter a URL', () => {
  assert.throws(
    () => createQQRequestConfig({
      url: '/checkQQLoginQr',
      method: 'get',
      params: { qrsig: 'temporary-secret', ptqrtoken: 123 },
    }),
    /QQ request contains forbidden secret material/,
  )
})

test('QQ QR check sends only the opaque session id in a POST body', () => {
  assert.deepEqual(createQQQrCheckRequestConfig('qr-session-42'), {
    baseURL: '/api/qq',
    url: '/checkQQLoginQr',
    method: 'post',
    data: { sessionId: 'qr-session-42' },
    timeout: 10000,
    withCredentials: false,
    credentials: 'omit',
  })
})

test('QQ account API never puts the QR session id in the URL or browser credentials', async () => {
  const originalFetch = globalThis.fetch
  let captured
  globalThis.fetch = async (url, init) => {
    captured = { url, init }
    return new Response(JSON.stringify({ isOk: false, message: 'waiting' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    await checkQQLoginQr('qr-session-42')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(captured.url, '/api/qq/checkQQLoginQr')
  assert.equal(captured.init.method, 'POST')
  assert.equal(captured.init.credentials, 'omit')
  assert.deepEqual(JSON.parse(captured.init.body), { sessionId: 'qr-session-42' })
  assert.equal(captured.url.includes('qr-session-42'), false)
})

test('QQ request returns recursively sanitized data to consumers', async () => {
  let capturedConfig
  const request = createQQRequest(async (config) => {
    capturedConfig = config
    return {
      data: {
        code: 200,
        data: {
          nickname: 'safe',
          cookie: 'uin=1; p_skey=top-secret',
          message: 'upstream echoed qrsig=temporary-secret',
        },
      },
    }
  })

  const response = await request({ url: '/user/getUserDetail' })

  assert.equal(capturedConfig.withCredentials, false)
  assert.deepEqual(response, {
    code: 200,
    data: {
      nickname: 'safe',
      message: 'upstream echoed qrsig=[REDACTED]',
    },
  })
})

test('QQ request rejects credentials in headers and request bodies', () => {
  assert.throws(
    () => createQQRequestConfig({ url: '/x', headers: { Authorization: 'Bearer secret' } }),
    /QQ request contains forbidden secret material/,
  )
  assert.throws(
    () => createQQRequestConfig({ url: '/x', method: 'post', data: { cookie: 'uin=1' } }),
    /QQ request contains forbidden secret material/,
  )
})
