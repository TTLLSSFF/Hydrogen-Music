import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isQQSong,
  containsQQSongs,
  canUseSongAction,
  canAccessQQMyMusic,
  isPublicQQPlaylistType,
  getSearchSource,
  getHeartModeBlockReason,
  isProviderPlaylist,
  filterProviderPlaylists,
  findProviderPlaylist,
  getQQCommentId,
} from '../src/utils/providerPolicy.mjs'
import { resolveFavoritePlaylistMeta } from '../src/utils/favoritePlaylist.js'

test('QQ songs are identified by provider and only block missing upstream write actions', () => {
  const qqSong = { id: 123, source: 'qq' }
  assert.equal(isQQSong(qqSong), true)
  assert.equal(canUseSongAction(qqSong, 'play'), true)
  // 下载复用 QQ 播放地址解析，歌单与收藏走 provider 自有写端点，均已放行
  assert.equal(canUseSongAction(qqSong, 'download'), true)
  assert.equal(canUseSongAction(qqSong, 'like'), true)
  assert.equal(canUseSongAction(qqSong, 'playlistMutation'), true)
  assert.equal(canUseSongAction(qqSong, 'commentRead'), true)
  // 评论写入类动作上游没有接口，继续阻止
  assert.equal(canUseSongAction(qqSong, 'commentWrite'), false)
  assert.equal(canUseSongAction(qqSong, 'commentLike'), false)
  assert.equal(canUseSongAction(qqSong, 'album'), true)
  assert.equal(canUseSongAction(qqSong, 'artist'), true)
})

test('QQ detection handles mixed queues without changing NetEase behavior', () => {
  assert.equal(containsQQSongs([{ id: 1, source: 'netease' }, { id: 2, source: 'qq' }]), true)
  assert.equal(containsQQSongs([{ id: 1, source: 'netease' }]), false)
  assert.equal(canUseSongAction({ id: 1, source: 'netease' }, 'like'), true)
})

test('search source normalizes explicit providers and defaults to netease', () => {
  assert.equal(getSearchSource('qq'), 'qq')
  assert.equal(getSearchSource('QQ'), 'qq')
  assert.equal(getSearchSource('netease'), 'netease')
  assert.equal(getSearchSource(undefined), 'netease')
  assert.equal(getSearchSource('local'), 'netease')
})

test('QQ My Music details require an authenticated QQ account', () => {
  assert.equal(canAccessQQMyMusic('qq', false), false)
  assert.equal(canAccessQQMyMusic('QQ', true), true)
  assert.equal(canAccessQQMyMusic('netease', false), true)
})

test('QQ public playlist details open without a QQ account while private ones stay blocked', () => {
  // 首页推荐歌单 / 个性化推荐歌单 / 榜单都是公共资源
  assert.equal(canAccessQQMyMusic('qq', false, 'rec'), true)
  assert.equal(canAccessQQMyMusic('qq', false, 'toplist'), true)
  assert.equal(canAccessQQMyMusic('QQ', false, 'REC'), true)
  assert.equal(isPublicQQPlaylistType('toplist'), true)
  assert.equal(isPublicQQPlaylistType(''), false)
  // 我的音乐歌单仍需登录
  assert.equal(canAccessQQMyMusic('qq', false, ''), false)
  assert.equal(canAccessQQMyMusic('qq', false, 'my'), false)
  assert.equal(canAccessQQMyMusic('netease', false, 'my'), true)
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

// QQ 旧版评论接口只接受数字 topid，songmid 会 400。取 id 必须收敛在一处，
// 否则评论面板与评论数会再次各走一套逻辑。
test('QQ comment id resolution only accepts numeric resource ids', () => {
  // 归一化产出的 numericId 优先
  assert.equal(getQQCommentId({ source: 'qq', sourceId: 'mid-1', numericId: '4936030' }), '4936030')
  // 上游原始字段名兼容
  assert.equal(getQQCommentId({ source: 'qq', songid: 1024 }), '1024')
  assert.equal(getQQCommentId({ source: 'qq', song_id: '2048' }), '2048')
  // 兜底候选
  assert.equal(getQQCommentId({ source: 'qq', mediaId: '4096' }), '4096')
  // songmid 是字符串 id，不能当评论资源 id
  assert.equal(getQQCommentId({ source: 'qq', id: '0039MnYb0qxYhV', sourceId: '0039MnYb0qxYhV' }), '')
  assert.equal(getQQCommentId({ source: 'qq', songmid: 'only-mid' }), '')
  // 非法输入一律空串，调用方据此隐藏入口
  assert.equal(getQQCommentId(null), '')
  assert.equal(getQQCommentId(undefined), '')
  assert.equal(getQQCommentId({}), '')
  assert.equal(getQQCommentId({ numericId: 'bearbeiten' }), '')
  assert.equal(getQQCommentId({ numericId: '1234567890123456789012' }), '')
})
