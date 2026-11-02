import test from 'node:test'
import assert from 'node:assert/strict'
import {
  APP_BASE,
  normalizeBase,
  resolveApiBaseUrl,
  resolveAppUrl,
} from '../src/utils/appBase.mjs'

test('node 与桌面端没有 import.meta.env 时 base 归一成根路径', () => {
  assert.equal(APP_BASE, '/')
  assert.equal(normalizeBase(undefined), '/')
  assert.equal(normalizeBase(''), '/')
  assert.equal(normalizeBase('./'), '/')
  assert.equal(normalizeBase('.'), '/')
})

test('子路径 base 补齐前导与尾部斜杠', () => {
  assert.equal(normalizeBase('/hydro'), '/hydro/')
  assert.equal(normalizeBase('/hydro/'), '/hydro/')
  assert.equal(normalizeBase('hydro'), '/hydro/')
  assert.equal(normalizeBase('https://cdn.example.com/hydro'), 'https://cdn.example.com/hydro/')
})

test('同源路径跟随注入的 base', () => {
  assert.equal(resolveAppUrl('', '/hydro/'), '/hydro/')
  assert.equal(resolveAppUrl('/api', '/hydro/'), '/hydro/api')
  assert.equal(resolveAppUrl('api/qq', '/hydro/'), '/hydro/api/qq')
  assert.equal(resolveAppUrl('./download-tags', '/hydro/'), '/hydro/download-tags')
  assert.equal(resolveAppUrl('/download-proxy', '/'), '/download-proxy')
})

test('外部地址与协议相对地址保持原样', () => {
  assert.equal(resolveAppUrl('https://api.github.com/repos/x', '/hydro/'), 'https://api.github.com/repos/x')
  assert.equal(resolveAppUrl('//cdn.example.com/a.js', '/hydro/'), '//cdn.example.com/a.js')
})

test('axios 的 baseURL 不带尾斜杠，根路径时为空串', () => {
  assert.equal(resolveApiBaseUrl('/api', '/'), '/api')
  assert.equal(resolveApiBaseUrl('/api', '/hydro/'), '/hydro/api')
  assert.equal(resolveApiBaseUrl('/api/qq', '/hydro/'), '/hydro/api/qq')
  assert.equal(resolveApiBaseUrl('', '/'), '')
  assert.equal(resolveApiBaseUrl('', '/hydro/'), '/hydro')
})
