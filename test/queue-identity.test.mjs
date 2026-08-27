import test from 'node:test'
import assert from 'node:assert/strict'
import { createShuffledList } from '../src/utils/player/queue.js'
import { getSongIdentity } from '../src/utils/musicSource.mjs'
import { createPlaybackTarget, isPlaybackTargetCurrent } from '../src/utils/player/targetIdentity.mjs'

test('shuffle keeps QQ and NetEase songs with equal raw IDs distinct', () => {
  const neteaseSong = { id: 'same-id', source: 'netease', name: 'NetEase' }
  const qqSong = { id: 'same-id', source: 'qq', sourceId: 'qq-mid', name: 'QQ' }
  const otherSong = { id: 'other-id', source: 'netease', name: 'Other' }

  const shuffled = createShuffledList([neteaseSong, qqSong, otherSong], {
    currentSong: qqSong,
    randomInt: () => 0,
  })

  assert.equal(getSongIdentity(shuffled[0]), 'qq:qq-mid')
  assert.equal(shuffled.filter(song => getSongIdentity(song) === 'netease:same-id').length, 1)
  assert.equal(shuffled.filter(song => getSongIdentity(song) === 'qq:qq-mid').length, 1)
})

test('playback target guard rejects an older provider with the same raw ID', () => {
  const neteaseSong = { id: 'same-id', source: 'netease' }
  const qqSong = { id: 'same-id', source: 'qq', sourceId: 'qq-mid' }
  const request = createPlaybackTarget(neteaseSong, neteaseSong.id)

  assert.equal(isPlaybackTargetCurrent(request, qqSong, qqSong.id), false)
  assert.equal(isPlaybackTargetCurrent(request, neteaseSong, neteaseSong.id), true)
})

test('shuffle accepts a provider-qualified currentSongId when no song object is available', () => {
  const neteaseSong = { id: 'same-id', source: 'netease' }
  const qqSong = { id: 'same-id', source: 'qq', sourceId: 'qq-mid' }

  const shuffled = createShuffledList([neteaseSong, qqSong], {
    currentSongId: 'qq:qq-mid',
    randomInt: (_min, max) => max,
  })

  assert.equal(getSongIdentity(shuffled[0]), 'qq:qq-mid')
})
