import test from 'node:test'
import assert from 'node:assert/strict'
import { androidAnonymousValidation, assertAnonymousValidationRequest, shouldUseAnonymousValidation } from '../src/utils/androidValidation.mjs'

const env = { MODE: 'android', VITE_API_BASE_URL: 'https://wyy.os.tlssff.top/ncmapi', VITE_QQ_API_BASE_URL: 'https://wyy.os.tlssff.top/qqmapi' }

test('normal runtime does not enable Android anonymous mode', () => {
  assert.equal(androidAnonymousValidation, false)
  assert.equal(shouldUseAnonymousValidation({ url: '/login' }, 'netease', { MODE: 'production' }), false)
})
test('configured HTTPS requests permit the existing manual authentication flow', () => {
  assert.equal(shouldUseAnonymousValidation({ baseURL: env.VITE_API_BASE_URL, url: '/login/qr/key' }, 'netease', env), false)
  assert.equal(shouldUseAnonymousValidation({ baseURL: env.VITE_QQ_API_BASE_URL, url: '/checkQQLoginQr', method: 'post' }, 'qq', env), false)
})
test('HTTP, missing configuration and requests escaping the HTTPS prefix remain guarded', () => {
  for (const config of [
    { baseURL: 'http://wyy.os.tlssff.top/ncmapi', url: '/login' },
    { baseURL: 'https://other.example/ncmapi', url: '/login' },
    { baseURL: env.VITE_API_BASE_URL, url: 'https://other.example/login' },
    { baseURL: env.VITE_API_BASE_URL, url: '//other.example/login' },
    { baseURL: env.VITE_API_BASE_URL, url: '/../login' },
    { baseURL: env.VITE_API_BASE_URL, url: '/%2e%2e/login' },
    { baseURL: env.VITE_API_BASE_URL, url: '/\\other.example/login' },
    { url: '/login' },
  ]) assert.equal(shouldUseAnonymousValidation(config, 'netease', env), true)
  assert.equal(shouldUseAnonymousValidation({ baseURL: 'http://example.com', url: '/login' }, 'netease', { MODE: 'android', VITE_API_BASE_URL: 'http://example.com' }), true)
  assert.equal(shouldUseAnonymousValidation({ baseURL: 'https://user:pass@example.com', url: '/login' }, 'netease', { MODE: 'android', VITE_API_BASE_URL: 'https://user:pass@example.com' }), true)
})
test('anonymous reads omit credentials', () => {
  const config = assertAnonymousValidationRequest({ url: '/banner', withCredentials: true })
  assert.equal(config.withCredentials, false)
  assert.equal(config.credentials, 'omit')
  assert.doesNotThrow(() => assertAnonymousValidationRequest({ url: '/getMusicPlay' }, 'qq'))
})
test('validation rejects login, writes, absolute URLs and credentials', () => {
  for (const config of [
    { url: '/login/cellphone' },
    { url: '/banner', method: 'post' },
    { url: '/banner', data: { password: 'test' } },
    { url: 'http://example.com/banner' },
    { url: '/banner?cookie=test' },
    { url: '/banner', params: { cookie: 'test' } },
    { url: '/banner', headers: { Authorization: 'test' } },
    { url: '/banner', headers: { 'X-QQ-Music-Session': 'test' } },
  ]) assert.throws(() => assertAnonymousValidationRequest(config))
  assert.throws(() => assertAnonymousValidationRequest({ url: '/getQQLoginQr' }, 'qq'))
})
