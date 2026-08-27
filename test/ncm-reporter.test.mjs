import test from 'node:test'
import assert from 'node:assert/strict'
import { isNeteaseReportableSong } from '../src/utils/musicSource.mjs'

test('QQ songs are excluded from NetEase recent-play reporting', () => {
  assert.equal(isNeteaseReportableSong({ id: '123', source: 'qq' }), false)
  assert.equal(isNeteaseReportableSong({ id: '123', source: 'QQ' }), false)
  assert.equal(isNeteaseReportableSong({ id: '123', source: 'netease' }), true)
})
