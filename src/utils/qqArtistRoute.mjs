import { normalizeMusicSource } from './musicSource.mjs'

function firstPresentValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    return value
  }
  return ''
}

export function isQQArtistSource(source) {
  return normalizeMusicSource(source) === 'qq'
}

export function looksLikeQQSingerMid(value) {
  const text = String(value || '').trim()
  return Boolean(text) && /[A-Za-z]/.test(text)
}

export function getQQArtistRouteId(artist) {
  if (artist === undefined || artist === null || artist === '') return ''
  if (typeof artist !== 'object') {
    const text = String(artist).trim()
    return looksLikeQQSingerMid(text) ? text : ''
  }
  return String(firstPresentValue(
    artist.mid,
    artist.singer_mid,
    artist.singerMid,
    artist.singerMID,
    looksLikeQQSingerMid(artist.id) ? artist.id : '',
  )).trim()
}

export function getQQArtistSingerId(artist) {
  if (!artist || typeof artist !== 'object') return ''
  return String(firstPresentValue(
    artist.singerid,
    artist.singer_id,
    artist.singerId,
    artist.singerID,
    typeof artist.id === 'number' ? artist.id : '',
    typeof artist.id === 'string' && /^\d+$/.test(artist.id) ? artist.id : '',
  )).replace(/[^0-9]/g, '')
}

export function buildQQArtistRoute(artist, extra = {}) {
  const source = extra.source || extra.song?.source || (typeof artist === 'object' ? artist?.source : '')
  if (!isQQArtistSource(source) && extra.forceQQ !== true) return null
  const extraId = String(extra.id || extra.artistId || '').trim()
  const id = getQQArtistRouteId(artist) || (looksLikeQQSingerMid(extraId) ? extraId : '')
  if (!id) return null
  const query = { source: 'qq' }
  const name = String(extra.name || extra.songName || (typeof artist === 'object' ? artist?.name : '') || '').slice(0, 80)
  const singerid = getQQArtistSingerId(artist) || String(extra.singerid || extra.singerID || '').replace(/[^0-9]/g, '')
  if (name) query.name = name
  if (singerid) query.singerid = singerid
  return { path: '/mymusic/artist/' + id, query }
}

export function pushQQArtistRoute(router, artist, extra = {}) {
  const route = buildQQArtistRoute(artist, extra)
  if (!route || !router) return false
  extra.playerStore && (extra.playerStore.forbidLastRouter = true)
  router.push(route)
  return true
}

export function openArtistRoute(router, artist, extra = {}) {
  const source = extra.source || extra.song?.source || (typeof artist === 'object' ? artist?.source : '')
  if (isQQArtistSource(source) || extra.forceQQ === true) {
    return pushQQArtistRoute(router, artist, extra)
  }
  const id = extra.id || extra.artistId || (typeof artist === 'object' ? artist?.id : artist)
  if (!id || !router) return false
  extra.playerStore && (extra.playerStore.forbidLastRouter = true)
  router.push('/mymusic/artist/' + id)
  return true
}
