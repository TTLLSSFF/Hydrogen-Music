const neteasePaths = new Set(['/banner', '/personalized', '/toplist', '/playlist/detail', '/playlist/track/all', '/cloudsearch', '/search/hot/detail', '/search/suggest', '/search/suggest/pc', '/song/detail', '/song/url', '/song/url/v1', '/lyric', '/lyric/new', '/album', '/artist', '/artist/songs', '/artist/album', '/comment/music'])
const qqPaths = new Set(['/getRecommendBanner', '/getNewSongs', '/getTopLists', '/getTopListDetail', '/getSearchByKey', '/getSearchPlaylists', '/getMusicPlay', '/getLyric', '/getSongListDetail', '/getAlbumInfo', '/getPlaylistTags', '/getPlaylistsByTag', '/getDigitalAlbums', '/getComments'])

export const androidAnonymousValidation = import.meta.env?.MODE === 'android'

export function shouldUseAnonymousValidation(config, provider = 'netease', env = import.meta.env) {
  if (env?.MODE !== 'android') return false
  const configuredBase = provider === 'qq' ? env.VITE_QQ_API_BASE_URL : env.VITE_API_BASE_URL
  try {
    const base = new URL(configuredBase)
    const path = String(config.url || '')
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash
      || config.baseURL !== configuredBase || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return true
    const prefix = base.pathname.replace(/\/$/, '') + '/'
    const target = new URL(base.href.replace(/\/$/, '') + path)
    return target.origin !== base.origin || !target.pathname.startsWith(prefix)
  } catch (_) {
    return true
  }
}

export function assertAnonymousValidationRequest(config, provider = 'netease') {
  const paths = provider === 'qq' ? qqPaths : neteasePaths
  if (String(config.method || 'get').toLowerCase() !== 'get' || !paths.has(config.url) || config.data != null) {
    throw new Error('Android HTTP validation supports anonymous read-only requests only; login is disabled.')
  }
  const keys = Object.keys(config.params || {}).concat(Object.keys(config.headers || {}))
  if (keys.some(key => /cookie|authorization|session|token|password|phone|email|csrf/i.test(key))) {
    throw new Error('Credentials are forbidden in Android HTTP validation.')
  }
  config.withCredentials = false
  config.credentials = 'omit'
  return config
}
