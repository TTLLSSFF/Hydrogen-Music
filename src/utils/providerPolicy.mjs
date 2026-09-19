import { normalizeMusicSource } from './musicSource.mjs'

const QQ_BLOCKED_SONG_ACTIONS = new Set([
  'like',
  'comment',
  'download',
  'collect',
  'playlistMutation',
])

export const QQ_HEART_MODE_MESSAGE = '播放列表里存在QQ音乐来源的曲目，心动模式无效'

export function isQQSong(song) {
  return normalizeMusicSource(song?.source) === 'qq'
}

export function containsQQSongs(songs) {
  return Array.isArray(songs) && songs.some(isQQSong)
}

export function canUseSongAction(song, action) {
  return !isQQSong(song) || !QQ_BLOCKED_SONG_ACTIONS.has(String(action || ''))
}

// QQ playlist details are private My Music data and must not be opened as a
// public fallback when only a NetEase account (or no account) is available.
export function canAccessQQMyMusic(source, qqLoggedIn) {
  return normalizeMusicSource(source) !== 'qq' || qqLoggedIn === true
}

export function isProviderPlaylist(playlist, provider = 'netease') {
  if (!playlist || typeof playlist !== 'object' || !playlist.id) return false
  return normalizeMusicSource(playlist.source) === normalizeMusicSource(provider)
}

export function filterProviderPlaylists(playlists, provider = 'netease') {
  if (!Array.isArray(playlists)) return []
  return playlists.filter(playlist => isProviderPlaylist(playlist, provider))
}

export function findProviderPlaylist(playlists, playlistId, provider = 'netease') {
  const normalizedId = String(playlistId ?? '')
  if (!normalizedId) return null
  return filterProviderPlaylists(playlists, provider)
    .find(playlist => String(playlist.id) === normalizedId) || null
}

// QQ 公共搜索开放后，搜索来源由搜索页/路由显式传入并归一化；
// 缺省仍为网易云。来源不持久化，也不强制跟随首页来源。
export function getSearchSource(value) {
  return normalizeMusicSource(value) === 'qq' ? 'qq' : 'netease'
}

export function getHeartModeBlockReason(songs) {
  return containsQQSongs(songs) ? QQ_HEART_MODE_MESSAGE : ''
}
