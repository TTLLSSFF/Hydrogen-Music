import test from 'node:test'
import assert from 'node:assert/strict'
import { getSearchSource, resolvePlatformSource } from '../src/utils/providerPolicy.mjs'

test('platform source normalizes unknown values back to NetEase', () => {
  assert.equal(getSearchSource('qq'), 'qq')
  assert.equal(getSearchSource('netease'), 'netease')
  assert.equal(getSearchSource('QQ'), 'qq')
  assert.equal(getSearchSource('kugou'), 'netease')
  assert.equal(getSearchSource(undefined), 'netease')
  assert.equal(getSearchSource(null), 'netease')
  assert.equal(getSearchSource(''), 'netease')
})

test('an explicit route source always wins over the current preference', () => {
  assert.equal(resolvePlatformSource('qq', 'netease'), 'qq')
  assert.equal(resolvePlatformSource('netease', 'qq'), 'netease')
  // 非法 query 值等价于「显式要求网易云」，而不是保留偏好
  assert.equal(resolvePlatformSource('kugou', 'qq'), 'netease')
})

test('a missing route source preserves the persisted preference', () => {
  // 这是持久化偏好的关键回归点：刷新 / 前进后退时 query 没有 source，
  // 不能把用户已经选好的 QQ 来源冲回网易云。
  assert.equal(resolvePlatformSource(undefined, 'qq'), 'qq')
  assert.equal(resolvePlatformSource(null, 'qq'), 'qq')
  assert.equal(resolvePlatformSource('', 'qq'), 'qq')
  assert.equal(resolvePlatformSource('   ', 'qq'), 'qq')
  assert.equal(resolvePlatformSource(undefined, 'netease'), 'netease')
})

test('a missing route source with an invalid preference falls back to NetEase', () => {
  assert.equal(resolvePlatformSource(undefined, undefined), 'netease')
  assert.equal(resolvePlatformSource(undefined, 'kugou'), 'netease')
})
