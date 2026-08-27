import test from 'node:test'
import assert from 'node:assert/strict'
import {
  loadQQPlaylistPages,
  loadQQPlaylistDetail,
  mergeQQPlaylistSummary,
  mergeQQPlaylistLists,
} from '../src/utils/qqLibrary.mjs'

test('QQ playlist pagination keeps fetching short collected pages until the source is exhausted', async () => {
  const calls = []
  const pages = [
    { data: { totaldiss: 3, cdlist: [{ dissid: '1', dissname: 'one' }, { dissid: '2', dissname: 'two' }] } },
    { data: { totaldiss: 3, cdlist: [{ dissid: '3', dissname: 'three' }] } },
    { data: { totaldiss: 3, cdlist: [] } },
  ]

  const playlists = await loadQQPlaylistPages(async params => {
    calls.push(params)
    return pages[calls.length - 1]
  }, { subscribed: true, limit: 20 })

  assert.deepEqual(playlists.map(item => item.id), ['1', '2', '3'])
  assert.deepEqual(calls.map(call => call.page), [1, 2])
  assert.deepEqual(calls.map(call => call.limit), [20, 20])
})

test('QQ created-playlist pagination advances past the package offset modulo bug', async () => {
  const calls = []
  const pages = new Map([
    [0, Array.from({ length: 500 }, (_, index) => ({ dissid: String(index + 1) }))],
    [500, Array.from({ length: 2 }, (_, index) => ({ dissid: String(index + 501) }))],
    [502, []],
  ])

  const playlists = await loadQQPlaylistPages(async params => {
    calls.push(params)
    return { data: { playlists: pages.get(params.offset) || [] } }
  }, { subscribed: false, limit: 500 })

  assert.equal(playlists.length, 502)
  assert.deepEqual(calls.map(call => ({ offset: call.offset, limit: call.limit })), [
    { offset: 0, limit: 500 },
    { offset: 500, limit: 1000 },
    { offset: 502, limit: 1002 },
  ])
})

test('QQ playlist detail keeps list summary metadata when detail omits it', () => {
  const merged = mergeQQPlaylistSummary(
    {
      id: 'liked-1',
      source: 'qq',
      name: '我喜欢',
      coverImgUrl: 'https://example.test/liked.jpg',
      trackCount: 12,
    },
    { id: 'liked-1', source: 'qq', songlist: [] },
  )

  assert.deepEqual(
    { id: merged.id, name: merged.name, cover: merged.coverImgUrl, trackCount: merged.trackCount },
    { id: 'liked-1', name: '我喜欢', cover: 'https://example.test/liked.jpg', trackCount: 12 },
  )
})

test('QQ playlist detail retries alternate liked-playlist ids only after an empty result', async () => {
  const calls = []
  const result = await loadQQPlaylistDetail(async id => {
    calls.push(id)
    return id === 'virtual-id'
      ? { data: { cdlist: [{ disstid: id, songlist: [] }] } }
      : { data: { cdlist: [{ disstid: id, songlist: [{ songmid: 'mid-1', songname: 'Song 1' }] }] } }
  }, ['virtual-id', 'real-dissid'])

  assert.deepEqual(calls, ['virtual-id', 'real-dissid'])
  assert.equal(result.requestedId, 'real-dissid')
  assert.equal(result.songs[0].sourceId, 'mid-1')
})

test('QQ playlist detail does not retry after a populated first response', async () => {
  const calls = []
  const result = await loadQQPlaylistDetail(async id => {
    calls.push(id)
    return { data: { cdlist: [{ disstid: id, songlist: [{ songmid: 'mid-1' }] }] } }
  }, ['primary-id', 'alternate-id'])

  assert.deepEqual(calls, ['primary-id'])
  assert.equal(result.requestedId, 'primary-id')
})

test('QQ playlist detail falls back to embedded summary songs when every detail request fails', async () => {
  const summary = {
    id: 'liked-1',
    source: 'qq',
    name: '我喜欢',
    coverImgUrl: 'https://example.test/liked.jpg',
    trackCount: 1,
    songs: [{ source: 'qq', sourceId: 'mid-embedded', songmid: 'mid-embedded', songname: 'Embedded song' }],
  }

  await assert.rejects(
    loadQQPlaylistDetail(async () => {
      throw new Error('detail unavailable')
    }, ['liked-1']),
    /detail unavailable/,
  )

  const fallback = await loadQQPlaylistDetail(async () => {
    throw new Error('detail unavailable')
  }, ['liked-1'], { fallbackSummary: summary })

  assert.equal(fallback.requestedId, 'liked-1')
  assert.equal(fallback.songs[0].sourceId, 'mid-embedded')
  assert.equal(fallback.playlist.coverImgUrl, 'https://example.test/liked.jpg')
})

test('QQ playlist detail prefers embedded summary songs over an empty final detail response', async () => {
  const fallback = await loadQQPlaylistDetail(async id => ({
    data: { cdlist: [{ disstid: id, songlist: [] }] },
  }), ['liked-1'], {
    fallbackSummary: {
      id: 'liked-1',
      source: 'qq',
      name: '我喜欢',
      songs: [{ songmid: 'mid-embedded', songname: 'Embedded song' }],
    },
  })

  assert.equal(fallback.songs.length, 1)
  assert.equal(fallback.songs[0].sourceId, 'mid-embedded')
})

test('QQ liked playlist is merged independently from created playlists', () => {
  const merged = mergeQQPlaylistLists([], [], { id: 'liked-1', source: 'qq', name: '我喜欢' })
  assert.deepEqual(merged.created.map(item => item.id), ['liked-1'])
  assert.deepEqual(merged.subscribed, [])
  assert.deepEqual(merged.liked.map(item => item.id), ['liked-1'])
})
