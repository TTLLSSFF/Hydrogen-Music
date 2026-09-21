import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveNcmBridgeUrl, DESKTOP_NCM_API_ORIGIN } from '../src/utils/ncmApiBridge.mjs'

test('桌面端把网页端的相对 API 路径换算成本机绝对地址', () => {
  assert.equal(
    resolveNcmBridgeUrl({ baseURL: '/api', url: '/login/cellphone' }),
    `${DESKTOP_NCM_API_ORIGIN}/login/cellphone`,
  )
  assert.equal(
    resolveNcmBridgeUrl({ baseURL: '/api', url: '/song/url/v1' }),
    `${DESKTOP_NCM_API_ORIGIN}/song/url/v1`,
  )
})

test('即使调用方把 /api 前缀带进 url 也要剥掉，避免打到不存在的路由', () => {
  assert.equal(
    resolveNcmBridgeUrl({ baseURL: '/api', url: '/api/personal/fm' }),
    `${DESKTOP_NCM_API_ORIGIN}/personal/fm`,
  )
})

test('缺少前导斜杠或空路径时仍然是合法的绝对地址', () => {
  assert.equal(resolveNcmBridgeUrl({ baseURL: '/api', url: 'search' }), `${DESKTOP_NCM_API_ORIGIN}/search`)
  assert.equal(resolveNcmBridgeUrl({ baseURL: '/api', url: '' }), `${DESKTOP_NCM_API_ORIGIN}/`)
  assert.equal(resolveNcmBridgeUrl({}), `${DESKTOP_NCM_API_ORIGIN}/`)
})

test('baseURL 是绝对地址（自建 API）时按它转发，不做本机改写', () => {
  assert.equal(
    resolveNcmBridgeUrl({ baseURL: 'https://api.example.com', url: '/login/cellphone' }),
    'https://api.example.com/login/cellphone',
  )
})

test('主进程只接受 localhost/127.0.0.1:36530，换算结果必须落在白名单内', () => {
  const parsed = new URL(resolveNcmBridgeUrl({ baseURL: '/api', url: '/login/cellphone' }))
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname))
  assert.equal(parsed.port, '36530')
})