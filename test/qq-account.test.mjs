import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeQrState, isQrLoginComplete, isQrLoginExpired } from '../src/utils/qqLoginState.mjs'

test('QQ QR login state machine', () => {
  assert.equal(normalizeQrState(800), 'expired')
  assert.equal(normalizeQrState(801), 'waiting')
  assert.equal(normalizeQrState(802), 'scanned')
  assert.equal(normalizeQrState(803), 'confirmed')
  assert.equal(isQrLoginComplete(803), true)
  assert.equal(isQrLoginExpired(800), true)
  assert.equal(isQrLoginComplete(801), false)
})
