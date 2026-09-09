import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getActivePlaylistSurface,
  getPlaylistItemKey,
} from '../src/utils/player/playlistRuntime.mjs'

test('only the visible player surface owns the queue scroller', () => {
  assert.equal(getActivePlaylistSurface(true), 'widget')
  assert.equal(getActivePlaylistSurface(false), 'player')
})

test('playlist item keys remain unique for repeated QQ and NetEase tracks', () => {
  const duplicateQQSong = { id: 'same-id', source: 'qq', sourceId: 'qq-mid' }
  const duplicateNeteaseSong = { id: 'same-id', source: 'netease' }

  assert.deepEqual([
    getPlaylistItemKey(duplicateQQSong, 0),
    getPlaylistItemKey(duplicateQQSong, 1),
    getPlaylistItemKey(duplicateNeteaseSong, 2),
  ], [
    'qq:qq-mid:0',
    'qq:qq-mid:1',
    'netease:same-id:2',
  ])
})
