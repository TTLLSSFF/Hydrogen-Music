import test from 'node:test'
import assert from 'node:assert/strict'
import { preparePlayAllSongs } from '../src/utils/player/playAllGuard.mjs'

test('play all treats an empty or missing playlist as having no songs', () => {
  assert.deepEqual(preparePlayAllSongs([]), [])
  assert.deepEqual(preparePlayAllSongs(null), [])
  assert.deepEqual(preparePlayAllSongs(undefined), [])
  assert.deepEqual(preparePlayAllSongs([{ id: 'raw-track' }], () => []), [])
})

test('play all keeps the normalized playlist supplied by the player', () => {
  const songs = [{ id: 'qq:track-1' }]
  const normalized = preparePlayAllSongs(songs, value => value)

  assert.deepEqual(normalized, songs)
})
