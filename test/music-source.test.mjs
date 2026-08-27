import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeMusicSource,
  getResourceId,
  getResourceKey,
  getSongIdentity,
  isSameResource,
  readRouteSource,
  supportsAccountAction,
} from '../src/utils/musicSource.mjs'
import { getMusicAccountId, isMusicAccountRequestCurrent } from '../src/utils/accountIdentity.mjs'

test('music source normalization and identity', () => {
  assert.equal(normalizeMusicSource('QQ'), 'qq')
  assert.equal(normalizeMusicSource('netease'), 'netease')
  assert.equal(normalizeMusicSource('unknown'), 'netease')
  assert.equal(getResourceId({ id: 123 }), '123')
  assert.equal(getResourceKey({ id: 123, source: 'qq' }), 'qq:123')
  assert.equal(getResourceKey({ id: 123, sourceId: 'qq-mid', source: 'qq' }), 'qq:qq-mid')
  assert.equal(getResourceKey({ id: 123, sourceId: 'qq-mid', source: 'qq' }), getSongIdentity({ id: 123, sourceId: 'qq-mid', source: 'qq' }))
  assert.equal(isSameResource({ id: 1, source: 'qq' }, { id: 1, source: 'netease' }), false)
  assert.equal(isSameResource({ id: 1, source: 'qq' }, { id: 1, source: 'qq' }), true)
})

test('provider-aware song identity keeps selection keys distinct', () => {
  const neteaseSong = { id: '42', source: 'netease' }
  const qqSong = { id: '42', source: 'qq', sourceId: 'qq-42' }

  assert.equal(getSongIdentity(neteaseSong), 'netease:42')
  assert.equal(getSongIdentity(qqSong), 'qq:qq-42')
  assert.notEqual(getSongIdentity(neteaseSong), getSongIdentity(qqSong))
})

test('route source only accepts explicit provider', () => {
  assert.equal(readRouteSource('/search?keywords=x'), 'netease')
  assert.equal(readRouteSource('/search?source=qq'), 'qq')
  assert.equal(readRouteSource('/api/qq/search'), 'qq')
  assert.equal(supportsAccountAction('qq', 'profile'), true)
  assert.equal(supportsAccountAction('netease', 'profile'), false)
})

test('composite music account keys resolve the provider-specific request id', () => {
  assert.equal(getMusicAccountId('netease-42:qq-99', 'netease'), 'netease-42')
  assert.equal(getMusicAccountId('netease-42:qq-99', 'qq'), 'qq-99')
  assert.equal(getMusicAccountId('netease-42', 'netease'), 'netease-42')
  assert.equal(getMusicAccountId('qq-99', 'qq'), 'qq-99')
})

test('composite music account request stays current for a QQ-only session', () => {
  const qqOnlyKey = ':qq-99'

  assert.equal(isMusicAccountRequestCurrent(qqOnlyKey, qqOnlyKey), true)
  assert.equal(isMusicAccountRequestCurrent(qqOnlyKey, ':qq-100'), false)
  assert.equal(isMusicAccountRequestCurrent(qqOnlyKey, qqOnlyKey, 'qq'), true)
})
