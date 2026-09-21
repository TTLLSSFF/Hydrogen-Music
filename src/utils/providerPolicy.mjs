import { normalizeMusicSource } from './musicSource.mjs'

// QQ 评论读取（commentRead）已放行：服务端 `/getComments` 为公共只读端点。
// 写入类动作仍全部阻止——上游没有写接口，点赞/回复/发评论一律降级提示。
const QQ_BLOCKED_SONG_ACTIONS = new Set([
  'like',
  'commentWrite',
  'commentLike',
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

// QQ 歌单详情只有在「来自我的音乐」时才属于私有数据。首页推荐歌单（rec）、
// 个性化推荐歌单（rec）、搜索结果歌单（search）与榜单（toplist）都是上游公共资源，
// 未登录 QQ 也应可打开。
const QQ_PUBLIC_PLAYLIST_TYPES = new Set(['toplist', 'rec', 'search'])

export function isPublicQQPlaylistType(type) {
  return QQ_PUBLIC_PLAYLIST_TYPES.has(String(type || '').trim().toLowerCase())
}

// QQ playlist details are private My Music data and must not be opened as a
// public fallback when only a NetEase account (or no account) is available.
export function canAccessQQMyMusic(source, qqLoggedIn, type = '') {
  if (normalizeMusicSource(source) !== 'qq') return true
  if (isPublicQQPlaylistType(type)) return true
  return qqLoggedIn === true
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

// 平台来源（首页/搜索页/设置页共用同一份状态）统一经此归一化；
// 非法或缺省值一律回退网易云。持久化由 otherStore 的 persist 负责。
export function getSearchSource(value) {
  return normalizeMusicSource(value) === 'qq' ? 'qq' : 'netease'
}

// 平台来源解析：路由 query 显式带 source 时以其为准；未携带时保留当前来源
// （可能来自持久化偏好），避免刷新、前进后退或首页跳转把偏好冲回网易云。
export function resolvePlatformSource(querySource, current) {
  const hasExplicitSource = querySource !== undefined
    && querySource !== null
    && String(querySource).trim() !== ''
  return getSearchSource(hasExplicitSource ? querySource : current)
}

export function getHeartModeBlockReason(songs) {
  return containsQQSongs(songs) ? QQ_HEART_MODE_MESSAGE : ''
}
