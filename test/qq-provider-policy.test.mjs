import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isQQSong,
  containsQQSongs,
  canUseSongAction,
  canAccessQQMyMusic,
  getSearchSource,
  getHeartModeBlockReason,
  isProviderPlaylist,
  filterProviderPlaylists,
  findProviderPlaylist,
} from '../src/utils/providerPolicy.mjs'
import { resolveFavoritePlaylistMeta } from '../src/utils/favoritePlaylist.js'

test('QQ songs are identified by provider and block NetEase-only mutations', () => {
  const qqSong = { id: 123, source: 'qq' }
  assert.equal(isQQSong(qqSong), true)
  assert.equal(canUseSongAction(qqSong, 'play'), true)
  assert.equal(canUseSongAction(qqSong, 'download'), false)
  assert.equal(canUseSongAction(qqSong, 'like'), false)
  assert.equal(canUseSongAction(qqSong, 'comment'), false)
  assert.equal(canUseSongAction(qqSong, 'album'), false)
  assert.equal(canUseSongAction(qqSong, 'artist'), false)
  assert.equal(canUseSongAction(qqSong, 'playlistMutation'), false)
})

test('QQ detection handles mixed queues without changing NetEase behavior', () => {
  assert.equal(containsQQSongs([{ id: 1, source: 'netease' }, { id: 2, source: 'qq' }]), true)
  assert.equal(containsQQSongs([{ id: 1, source: 'netease' }]), false)
  assert.equal(canUseSongAction({ id: 1, source: 'netease' }, 'like'), true)
  assert.equal(getSearchSource('qq'), 'netease')
})

test('QQ My Music details require an authenticated QQ account', () => {
  assert.equal(canAccessQQMyMusic('qq', false), false)
  assert.equal(canAccessQQMyMusic('QQ', true), true)
  assert.equal(canAccessQQMyMusic('netease', false), true)
})

test('heart mode is unavailable for any queue containing QQ music', () => {
  const message = '播放列表里存在QQ音乐来源的曲目，心动模式无效'
  assert.equal(getHeartModeBlockReason([{ id: 1, source: 'netease' }]), '')
  assert.equal(getHeartModeBlockReason([{ id: 1, source: 'qq' }]), message)
  assert.equal(getHeartModeBlockReason([{ id: 1, source: 'netease' }, { id: 2, source: 'qq' }]), message)
})

test('provider playlist checks keep NetEase favorite refreshes away from QQ lists', () => {
  assert.equal(isProviderPlaylist({ id: 'same-id', source: 'qq' }, 'netease'), false)
  assert.equal(isProviderPlaylist({ id: 'same-id', source: 'QQ' }, 'qq'), true)
  assert.equal(isProviderPlaylist({ id: 'same-id' }, 'netease'), true)
})

test('provider playlist filtering keeps same-id QQ entries out of NetEase writes', () => {
  const playlists = [
    { id: 'same-id', source: 'qq', name: 'QQ 歌单' },
    { id: 'same-id', name: 'NetEase 歌单' },
    { id: 'qq-only', source: 'qq', name: 'QQ only' },
  ]

  assert.deepEqual(filterProviderPlaylists(playlists, 'netease'), [playlists[1]])
  assert.equal(findProviderPlaylist(playlists, 'same-id', 'netease'), playlists[1])
  assert.equal(findProviderPlaylist(playlists, 'qq-only', 'netease'), null)
})

test('favorite playlist resolution ignores QQ entries in a merged list', () => {
  const favorite = resolveFavoritePlaylistMeta([
    { id: 'qq-favorite', source: 'qq', specialType: 5, name: 'QQ 我喜欢' },
    { id: 'netease-favorite', source: 'netease', specialType: 5, name: '我喜欢的音乐' },
  ])

  assert.deepEqual(favorite, { id: 'netease-favorite', name: '我喜欢的音乐' })
})
