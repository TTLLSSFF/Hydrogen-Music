const SOURCES = new Set(['netease', 'qq'])

export function normalizeMusicSource(source) {
  const value = String(source || '').trim().toLowerCase()
  return SOURCES.has(value) ? value : 'netease'
}

export function getResourceId(resource) {
  const value = resource && typeof resource === 'object'
    ? (resource.sourceId ?? resource.songmid ?? resource.id ?? resource.mid)
    : resource
  return value === null || value === undefined || value === '' ? '' : String(value)
}

export function getResourceKey(resource, source) {
  const provider = normalizeMusicSource(source || resource?.source)
  const id = provider === 'qq'
    ? (resource && typeof resource === 'object'
      ? (resource.sourceId ?? resource.songmid ?? resource.mid ?? resource.id)
      : resource)
    : (resource && typeof resource === 'object' ? (resource.id ?? resource.sourceId) : resource)
  return id ? `${provider}:${id}` : ''
}

export function getSongIdentity(song) {
  return getResourceKey(song)
}

export function isSameResource(a, b) {
  const ka = getResourceKey(a)
  const kb = getResourceKey(b)
  return Boolean(ka && kb && ka === kb)
}

// NetEase-only side effects (for example recent-play telemetry) must never
// consume a QQ resource, even when legacy data stores the source in uppercase.
export function isNeteaseReportableSong(song) {
  return Boolean(song && typeof song === 'object' && normalizeMusicSource(song.source) === 'netease')
}

export function readRouteSource(input) {
  const raw = String(input || '')
  if (/\/api\/qq(?:\/|$)/i.test(raw) || /(?:\?|&)source=qq(?:&|$)/i.test(raw)) return 'qq'
  return 'netease'
}

export function supportsAccountAction(source, action) {
  return normalizeMusicSource(source) === 'qq' && new Set([
    'profile', 'likedSongs', 'playlists', 'collectedPlaylists', 'collectedAlbums',
    'followedSingers', 'favMvs', 'vip', 'friends', 'fans', 'medals',
    'listeningCalendar', 'musicGene', 'dislikeList',
  ]).has(action)
}
