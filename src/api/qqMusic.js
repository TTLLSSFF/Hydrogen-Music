import qqRequest from '../utils/qqRequest.mjs'

export const QQ_PUBLIC_API_DISABLED_CODE = 'QQ_PUBLIC_API_DISABLED'

function createQQPublicApiDisabledError(capability) {
  const error = new Error(`QQ Music ${capability} is disabled; use authenticated My Music instead`)
  error.code = QQ_PUBLIC_API_DISABLED_CODE
  return error
}

// The server boundary rejects these routes as well. Keep the legacy exports
// as explicit failures so stale callers cannot bypass the product policy by
// importing this module directly.
export function searchQQ() {
  return Promise.reject(createQQPublicApiDisabledError('search'))
}

export function unwrapQQResponse(payload) {
  let current = payload
  for (let i = 0; i < 4; i++) {
    if (!current || typeof current !== 'object') return current || {}
    if (current.response && typeof current.response === 'object') {
      current = current.response
      continue
    }
    if (current.body && typeof current.body === 'object') {
      current = current.body
      continue
    }
    return current
  }
  return current || {}
}

const isPresentQQValue = value => value !== undefined && value !== null && value !== ''
const firstQQValue = (...values) => values.find(isPresentQQValue)
const firstPositiveQQValue = (...values) => values.find(value => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0
})
const normalizeQQId = value => isPresentQQValue(value) ? String(value) : ''
const normalizeQQBooleanFlag = value => {
  if (value === true) return true
  if (typeof value === 'number') return Number.isFinite(value) && value > 0
  if (typeof value === 'string') {
    const normalized = value.trim()
    if (/^(?:true|yes)$/i.test(normalized)) return true
    const numeric = Number(normalized)
    return Number.isFinite(numeric) && numeric > 0
  }
  return false
}

const QQ_PLAYBACK_QUALITY_MAP = Object.freeze({
  standard: '128',
  higher: '320',
  exhigh: '320',
  lossless: 'flac',
  hires: 'flac',
  jyeffect: 'flac',
  sky: 'flac',
  dolby: 'flac',
  jymaster: 'flac',
})

export function normalizeQQPlaybackQuality(value) {
  const normalized = String(value || '').trim().toLowerCase()
  if (QQ_PLAYBACK_QUALITY_MAP[normalized]) return QQ_PLAYBACK_QUALITY_MAP[normalized]
  if (['m4a', '128', '320', 'ape', 'flac'].includes(normalized)) return normalized
  return '128'
}

function getQQPlaybackQualityCandidates(value) {
  const preferred = normalizeQQPlaybackQuality(value)
  if (preferred === 'flac' || preferred === 'ape') return [preferred, '320', '128']
  if (preferred === '320') return ['320', '128']
  return [preferred]
}

function readQQVipOnly(value) {
  if (!value || typeof value !== 'object') return false
  if (normalizeQQBooleanFlag(value.vipOnly) || normalizeQQBooleanFlag(value.vip)) return true
  if (normalizeQQBooleanFlag(value.pay_play) || normalizeQQBooleanFlag(value.payPlay)) return true
  if (value.vip && typeof value.vip === 'object' && (
    normalizeQQBooleanFlag(value.vip.isVip)
    || normalizeQQBooleanFlag(value.vip.is_vip)
    || normalizeQQBooleanFlag(value.vip.level)
  )) return true
  const pay = [
    value.pay,
    value.payInfo,
    value.payinfo,
    value.payment,
    value.songInfo?.pay,
    value.song_info?.pay,
  ]
    .find(item => item && typeof item === 'object')
  if (!pay) return false
  // QQ song payloads use pay_play/payPlay to indicate that a member
  // entitlement is required for full playback.
  return [
    pay.pay_play,
    pay.payPlay,
    pay.play,
  ].some(normalizeQQBooleanFlag)
}

function readQQMediaId(value) {
  const file = value?.file && typeof value.file === 'object' ? value.file : {}
  const nestedFile = value?.songInfo?.file || value?.song_info?.file
  const fallbackFile = nestedFile && typeof nestedFile === 'object' ? nestedFile : {}
  return firstQQValue(
    value?.mediaId,
    value?.media_id,
    value?.mediaMid,
    value?.media_mid,
    value?.strMediaMid,
    value?.str_media_mid,
    file.mediaId,
    file.media_id,
    file.mediaMid,
    file.media_mid,
    file.strMediaMid,
    file.str_media_mid,
    fallbackFile.mediaId,
    fallbackFile.media_id,
    fallbackFile.mediaMid,
    fallbackFile.media_mid,
    fallbackFile.strMediaMid,
    fallbackFile.str_media_mid,
  )
}
const parseQQTrackCount = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const match = value.match(/\d+/)
    if (match) return Number(match[0])
  }
  return 0
}

/**
 * Normalize the playlist summary shapes returned by QQ's profile and
 * collection endpoints. Those endpoints intentionally use different field
 * names (`title`/`picurl` vs `dissname`/`logo`).
 */
export function normalizeQQPlaylist(item = {}, options = {}) {
  const value = item && typeof item === 'object' ? item : {}
  const id = firstQQValue(value.disstid, value.dissid, value.tid, value.id, value.dirid, options.id)
  const name = firstQQValue(value.dissname, value.title, value.name, value.songlistName, options.name, 'QQ 歌单')
  const coverImgUrl = firstQQValue(
    value.logo,
    value.picurl,
    value.picUrl,
    value.coverImgUrl,
    value.cover,
    value.coverUrl,
    value.pic,
    options.coverImgUrl,
    '',
  )
  const trackCount = parseQQTrackCount(firstPositiveQQValue(
    value.songnum,
    value.songCount,
    value.trackCount,
    value.size,
    value.num0,
    value.subtitle,
  ) ?? firstQQValue(value.songnum, value.songCount, value.trackCount, value.size, value.num0, value.subtitle))
  return {
    ...value,
    id: normalizeQQId(id),
    source: 'qq',
    name: String(name),
    coverImgUrl: String(coverImgUrl || ''),
    // LibraryList accepts both fields; retaining picUrl also helps consumers
    // that use the common album/playlist image contract.
    picUrl: String(firstQQValue(value.picUrl, coverImgUrl, '') || ''),
    trackCount,
  }
}

/** Find playlist summaries in all known QQ profile/collection envelopes. */
export function extractQQPlaylists(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value == null) return []
  if (Array.isArray(value)) return value
  if (typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)

  const keys = [
    'cdlist', 'playlists', 'playlist', 'disslist', 'dissList', 'diss',
    'createdDissList', 'createdList', 'mydiss', 'mymusic', 'list', 'data',
    'result', 'body',
  ]
  for (const key of keys) {
    const candidate = value[key]
    if (Array.isArray(candidate)) {
      seen.delete(value)
      return candidate
    }
    const nested = extractQQPlaylists(candidate, depth + 1, seen)
    if (nested.length) {
      seen.delete(value)
      return nested
    }
  }
  seen.delete(value)
  return []
}

/**
 * The liked-playlist endpoint returns metadata in `data.info`, while its
 * cover and title live in the first `data.songs` entry. Merge both records so
 * the library item keeps a usable ID, name, cover and count.
 */
export function normalizeQQLikedPlaylist(payload) {
  const body = unwrapQQResponse(payload)
  const data = body?.data && typeof body.data === 'object' ? body.data : body
  const info = data?.info && typeof data.info === 'object' ? data.info : {}
  const summary = Array.isArray(data?.songs) ? (data.songs[0] || {}) : {}
  const detailIds = []
  ;[
    info.id,
    info.dissid,
    info.disstid,
    summary.dissid,
    summary.disstid,
    info.dirid,
    summary.dirid,
    info.songlistId,
    summary.songlistId,
  ].forEach(value => {
    if (!isPresentQQValue(value)) return
    const normalized = String(value)
    if (!detailIds.includes(normalized)) detailIds.push(normalized)
  })
  const id = detailIds[0] || ''
  if (!isPresentQQValue(id)) return null
  const isQQSongLike = value => value && typeof value === 'object' && (
    isPresentQQValue(value.songmid)
    || isPresentQQValue(value.mid)
    || isPresentQQValue(value.songname)
    || isPresentQQValue(value.songName)
    || isPresentQQValue(value.songid)
  )
  const embeddedSongLists = [
    data?.songlist,
    data?.songList,
    data?.tracks,
    data?.tracklist,
    info?.songlist,
    summary?.songlist,
    data?.songs,
  ]
  const embeddedSongs = embeddedSongLists.find(list => Array.isArray(list) && list.some(isQQSongLike)) || []
  const playlist = normalizeQQPlaylist({
    ...summary,
    ...info,
    id,
    dissid: firstQQValue(summary.dissid, info.dissid),
    title: firstQQValue(info.title, summary.title, '我喜欢'),
    picurl: firstQQValue(summary.picurl, info.picurl, summary.logo, info.logo),
    songnum: firstPositiveQQValue(info.songCount, summary.songCount, summary.num0)
      ?? firstQQValue(info.songCount, summary.songCount, summary.num0),
  }, { name: '我喜欢' })
  return {
    ...playlist,
    detailIds,
    songs: embeddedSongs.map(normalizeQQSong),
  }
}

function findQQPlaylistDetail(value, depth = 0, seen = new Set()) {
  if (depth > 8 || value == null || typeof value !== 'object' || seen.has(value)) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findQQPlaylistDetail(item, depth + 1, seen)
      if (found) return found
    }
    return null
  }
  seen.add(value)
  if (Array.isArray(value.songlist) || Array.isArray(value.song) || Array.isArray(value.songList)) {
    seen.delete(value)
    return value
  }
  for (const key of ['cdlist', 'diss', 'playlist', 'playlists', 'data', 'result', 'body']) {
    const found = findQQPlaylistDetail(value[key], depth + 1, seen)
    if (found) {
      seen.delete(value)
      return found
    }
  }
  seen.delete(value)
  return null
}

/** Normalize a QQ song-list detail response into stable playlist/song data. */
export function normalizeQQPlaylistDetail(payload, fallbackId = '') {
  const playlist = findQQPlaylistDetail(unwrapQQResponse(payload))
  const rawSongs = playlist?.songlist || playlist?.song || playlist?.songList || []
  const normalizedPlaylist = normalizeQQPlaylist(playlist || {}, { id: fallbackId })
  if (!normalizedPlaylist.id && fallbackId) normalizedPlaylist.id = String(fallbackId)
  // Some detail responses omit songnum (or return a stale zero) even though
  // the page already contains its complete songlist. Keep the overview count
  // useful without replacing a positive upstream count.
  if (normalizedPlaylist.trackCount <= 0 && Array.isArray(rawSongs) && rawSongs.length > 0) {
    normalizedPlaylist.trackCount = rawSongs.length
    normalizedPlaylist.size = rawSongs.length
  }
  return {
    playlist: normalizedPlaylist,
    songs: Array.isArray(rawSongs) ? rawSongs.map(normalizeQQSong) : [],
  }
}

export async function getQQMusicPlay(songmid, params = {}) {
  const qualityCandidates = getQQPlaybackQualityCandidates(params.quality)
  let lastResponse = null

  for (const candidate of qualityCandidates) {
    lastResponse = await qqRequest({
      url: '/getMusicPlay',
      method: 'get',
      params: {
        songmid,
        ...params,
        quality: candidate,
      },
    })
    if (normalizeQQPlaybackPayload(lastResponse, songmid)?.url) return lastResponse
  }

  return lastResponse
}

export function getQQLyric(songmid, params = {}) {
  return qqRequest({ url: '/getLyric', method: 'get', params: { songmid, ...params } })
}

export function normalizeQQPlaybackPayload(payload, songmid = '') {
  const targetId = String(songmid || '')
  const queue = [payload]
  const seen = new Set()
  let firstTrackInfo = null
  let firstDuration = 0
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)

    if (!firstTrackInfo && current.trackInfo && typeof current.trackInfo === 'object') firstTrackInfo = current.trackInfo
    if (!firstTrackInfo && current.track_info && typeof current.track_info === 'object') firstTrackInfo = current.track_info
    const duration = Number(current.duration ?? current.interval ?? current.dt)
    if (!firstDuration && Number.isFinite(duration) && duration > 0) firstDuration = duration < 1000 ? duration * 1000 : duration

    const playMap = current.playUrl || current.playurl
    if (playMap && typeof playMap === 'object') {
      const entry = playMap[targetId] || playMap[songmid] || (targetId ? null : Object.values(playMap)[0])
      if (entry && typeof entry === 'object') {
        const url = entry.url || entry.purl || entry.playUrl
        if (url) return { url: String(url), trackInfo: firstTrackInfo, duration: firstDuration }
      } else if (typeof entry === 'string' && entry) {
        return { url: entry, trackInfo: firstTrackInfo, duration: firstDuration }
      }
    }

    const directUrl = current.url || current.purl || current.playUrl
    if (typeof directUrl === 'string' && directUrl) return { url: directUrl, trackInfo: firstTrackInfo, duration: firstDuration }

    for (const key of ['data', 'body', 'response', 'result', 'req_0']) {
      if (current[key] && typeof current[key] === 'object') queue.push(current[key])
    }
  }
  return null
}

/**
 * Convert the QQ lyric response into the shape consumed by the shared lyric
 * runtime. QQ wraps the payload in `response` and exposes the original lyric
 * text as `lyric` (with optional translation/romanisation fields), whereas
 * NetEase uses `{ lrc: { lyric } }`.
 */
export function normalizeQQLyricPayload(payload) {
  const body = unwrapQQResponse(payload)
  const source = body?.data && typeof body.data === 'object' ? body.data : body
  // The QQ endpoints have used a few different names for the translated and
  // romanised tracks over time.  The public package currently forwards the
  // upstream object as-is, so keep the adapter tolerant of both the legacy
  // `trans`/`roma` fields and newer aliases such as `transLyric`/`translrc`.
  // Values may also be wrapped as `{ lyric: ... }` (or nested under `data`).
  const readQQLyricField = (root, aliases) => {
    const roots = Array.isArray(root) ? root : [root]
    const queue = roots.map(value => ({ value, depth: 0 }))
    const seen = new Set()
    while (queue.length > 0) {
      const { value, depth } = queue.shift()
      if (!value || typeof value !== 'object' || seen.has(value) || depth > 6) continue
      seen.add(value)

      for (const alias of aliases) {
        const candidate = value[alias]
        if (typeof candidate === 'string' && candidate) return candidate
        if (candidate && typeof candidate === 'object') {
          for (const key of ['lyric', 'text', 'content', 'value']) {
            const text = candidate[key]
            if (typeof text === 'string' && text) return text
          }
        }
      }

      // Restrict traversal to response containers.  This still handles
      // `{ response: { data: ... } }` while avoiding accidental matches in
      // unrelated song metadata objects.
      for (const key of ['data', 'body', 'response', 'result', 'payload', 'req_0']) {
        const nested = value[key]
        if (nested && typeof nested === 'object') queue.push({ value: nested, depth: depth + 1 })
      }
    }
    return ''
  }

  const decode = value => {
    if (typeof value !== 'string' || !value) return value || ''
    const compact = value.replace(/\s+/g, '')
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length < 16) return value
    try {
      if (typeof atob === 'function') {
        const bytes = Uint8Array.from(atob(compact), char => char.charCodeAt(0))
        const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
        if (decoded && (decoded.includes('[') || decoded.includes('\n'))) return decoded
      }
    } catch (_) {}
    return value
  }
  // Prefer the normalized `data` object but retain the outer body as a
  // fallback: older package versions occasionally put translation beside
  // `data` while leaving the original lyric at the response root.
  const lyricRoots = source === body ? source : [source, body]
  const original = decode(readQQLyricField(lyricRoots, [
    'lyric', 'lrc', 'qrc', 'originalLyric', 'original', 'lyricText', 'lrcText',
  ]))
  const translated = decode(readQQLyricField(lyricRoots, [
    'trans', 'tlyric', 'trans_tlyric', 'transLyric', 'translrc', 'translation',
    'translatedLyric', 'translateLyric', 'transLyricText', 'translationLyric',
    'translrcText',
  ]))
  const romanized = decode(readQQLyricField(lyricRoots, [
    'roma', 'romalrc', 'romaLyric', 'romanizedLyric', 'romanLyric', 'romaLyricText',
  ]))
  const normalized = {
    ...source,
    lrc: { lyric: typeof original === 'string' ? original : '' },
    hmLyricSource: 'qq',
  }
  if (translated) {
    normalized.tlyric = { lyric: typeof translated === 'string' ? translated : '' }
    // Preserve a canonical `translrc` alias for callers that consume QQ's
    // native field name, while the shared lyric runtime continues to read
    // `tlyric`.
    normalized.translrc = { lyric: normalized.tlyric.lyric }
  }
  if (romanized) {
    normalized.romalrc = { lyric: typeof romanized === 'string' ? romanized : '' }
    normalized.roma = normalized.romalrc.lyric
  }
  return normalized
}

export function getQQSongListDetail(id, params = {}) {
  return qqRequest({ url: '/getSongListDetail', method: 'get', params: { disstid: id, ...params } })
}

export function getQQAlbumInfo() {
  return Promise.reject(createQQPublicApiDisabledError('album details'))
}

export function getQQMv() {
  return Promise.reject(createQQPublicApiDisabledError('MV details'))
}

export function getQQMvPlay() {
  return Promise.reject(createQQPublicApiDisabledError('MV playback'))
}

function parseQQDurationMilliseconds(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'string') {
      const text = value.trim()
      if (!text) continue
      const clock = text.match(/^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/)
      if (clock) {
        const hours = Number(clock[3] === undefined ? 0 : clock[1])
        const minutes = Number(clock[3] === undefined ? clock[1] : clock[2])
        const seconds = Number(clock[3] === undefined ? clock[2] : clock[3])
        const totalSeconds = hours * 3600 + minutes * 60 + seconds
        if (totalSeconds > 0) return totalSeconds * 1000
        continue
      }
    }
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) return numeric < 1000 ? numeric * 1000 : numeric
  }
  return 0
}

export function normalizeQQSong(song = {}) {
  const value = song && typeof song === 'object' ? song : {}
  const mid = firstQQValue(
    value.songmid,
    value.song_mid,
    value.songMid,
    value.mid,
    value.sourceId,
    value.songId,
    value.song_id,
    value.id,
  )
  const rawAlbum = value.album || value.al || {}
  const album = rawAlbum && typeof rawAlbum === 'object' ? rawAlbum : {}
  const albumMid = firstQQValue(
    album.mid,
    album.albummid,
    album.album_mid,
    album.albumMid,
    album.albumMID,
    album.pmid,
    value.albummid,
    value.album_mid,
    value.albumMid,
    value.albumMID,
    value.pmid,
  ) || ''
  const albumName = firstQQValue(
    album.name,
    album.albumname,
    album.album_name,
    album.albumName,
    album.title,
    value.albumname,
    value.album_name,
    value.albumName,
    value.albumTitle,
  )
  const albumCover = firstQQValue(
    album.picUrl,
    album.coverUrl,
    album.picurl,
    album.pic,
    album.album_pic,
    album.albumPic,
    album.cover,
    album.cover_url,
    value.album_pic,
    value.albumPic,
    value.albumpic,
    value.picurl,
    value.picUrl,
    value.coverUrl,
    value.cover_url,
    value.cover,
    value.album_cover,
    value.albumCover,
  ) || (albumMid
    ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg`
    : '')
  const albumData = {
    ...album,
    ...(albumMid ? { mid: albumMid, albummid: albumMid } : {}),
    ...(albumName ? { name: String(albumName) } : {}),
    ...(albumCover ? { picUrl: String(albumCover), blurPicUrl: String(albumCover) } : {}),
  }
  const duration = parseQQDurationMilliseconds(
    value.interval,
    value.duration,
    value.dt,
    value.songtime,
    value.songTime,
    value.intervalMs,
    value.durationMs,
    value.duration_ms,
  )
  const rawArtists = firstQQValue(value.singer, value.singers, value.ar, value.artists)
  const artistList = Array.isArray(rawArtists)
    ? rawArtists
    : (typeof rawArtists === 'string' && rawArtists.trim()
      ? [rawArtists]
      : (rawArtists && typeof rawArtists === 'object' ? [rawArtists] : []))
  const artists = artistList.map(artist => {
    const item = artist && typeof artist === 'object' ? artist : { name: artist }
    const artistMid = firstQQValue(item.mid, item.singer_mid, item.singerMid, item.singerMID)
    const artistId = firstQQValue(item.id, item.singer_id, item.singerId, item.singerID)
    const artistName = firstQQValue(item.name, item.singer_name, item.singerName, item.title)
    return {
      ...item,
      ...(artistId !== undefined ? { id: artistId } : {}),
      ...(artistMid !== undefined ? { mid: artistMid } : {}),
      name: String(artistName || ''),
    }
  }).filter(artist => artist.name || artist.mid || artist.id !== undefined)
  if (!artists.length) {
    const singerName = firstQQValue(value.singerName, value.singer_name)
    const singerMid = firstQQValue(value.singerMid, value.singer_mid, value.singermid)
    if (singerName || singerMid) artists.push({
      ...(singerMid ? { mid: singerMid } : {}),
      name: String(singerName || ''),
    })
  }
  const coverUrl = firstQQValue(
    value.coverUrl,
    value.cover_url,
    value.cover,
    value.picUrl,
    value.picurl,
    value.album_pic,
    value.albumPic,
    value.albumpic,
    value.album_cover,
    value.albumCover,
    albumCover,
  ) || ''
  const songName = firstQQValue(value.songname, value.songName, value.song_name, value.name, value.title) || ''
  const songId = firstQQValue(value.id, value.songId, value.song_id, mid)
  const mediaId = readQQMediaId(value)
  const vipOnly = readQQVipOnly(value)
  return {
    ...value,
    id: songId,
    source: 'qq',
    sourceId: String(mid || ''),
    sourceKey: mid ? `qq:${mid}` : '',
    name: String(songName),
    songmid: firstQQValue(value.songmid, value.song_mid, value.songMid, value.mid, mid),
    ar: artists,
    al: albumData,
    album: albumData,
    albumId: firstQQValue(album.id, album.albumid, album.album_id, value.albumid, value.albumId, value.album_id, ''),
    albumMid,
    coverUrl: String(coverUrl),
    vipOnly,
    ...(mediaId ? { mediaId: String(mediaId) } : {}),
    ...(duration > 0 ? { dt: duration, duration } : {}),
  }
}

function readQQSearchResult(payload) {
  const body = unwrapQQResponse(payload)
  return body?.data?.result || body?.result || body?.data || body
}

function normalizeQQSearchAlbum(album = {}) {
  const id = album.album_mid || album.albumMid || album.mid || album.id
  const cover = album.album_pic || album.albumPic || album.picUrl || album.cover || ''
  const artists = album.singer || album.artists || []
  return {
    ...album,
    id: id == null ? '' : String(id),
    source: 'qq',
    name: album.album_name || album.albumName || album.name || '',
    picUrl: cover,
    blurPicUrl: cover,
    artists,
    size: album.songnum || album.size || album.songCount || 0,
  }
}

function normalizeQQSearchPlaylist(playlist = {}) {
  const id = playlist.dissid || playlist.tid || playlist.id
  return {
    ...playlist,
    id: id == null ? '' : String(id),
    source: 'qq',
    name: playlist.dissname || playlist.name || playlist.title || '',
    coverImgUrl: playlist.logo || playlist.picurl || playlist.cover || playlist.coverImgUrl || '',
    trackCount: playlist.songnum || playlist.songCount || playlist.trackCount || 0,
  }
}

export function normalizeQQSearchPayload(payload) {
  const result = readQQSearchResult(payload)
  const songs = result?.song?.list || result?.songList || result?.list || []
  const zhidaSinger = result?.zhida?.zhida_singer || result?.zhidaSinger || {}
  const singers = result?.singer?.list || result?.singerList || (
    zhidaSinger.singerMID || zhidaSinger.singerID || zhidaSinger.singerName
      ? [{
          singer_mid: zhidaSinger.singerMID,
          singer_id: zhidaSinger.singerID,
          singer_name: zhidaSinger.singerName,
          name: zhidaSinger.singerName,
          pic: zhidaSinger.singerPic,
        }]
      : []
  )
  const albums = result?.album?.list || result?.albumList || (
    Array.isArray(zhidaSinger.hotalbum)
      ? zhidaSinger.hotalbum.map(album => ({
          album_mid: album.albumMID || album.albummid,
          album_id: album.albumID || album.albumid,
          album_name: album.albumName || album.albumname,
          singer: zhidaSinger.singerName ? [{ name: zhidaSinger.singerName, mid: zhidaSinger.singerMID }] : [],
        }))
      : []
  )
  const playlists = result?.playlist?.list || result?.playlistList || result?.dissList || result?.diss?.list || []
  return {
    searchSongs: Array.isArray(songs) ? songs.map(normalizeQQSong) : [],
    searchAlbums: Array.isArray(albums) ? albums.map(normalizeQQSearchAlbum) : [],
    searchArtists: Array.isArray(singers) ? singers.map(item => ({ ...item, id: item.singer_mid || item.mid || item.id, name: item.singer_name || item.name || '' })) : [],
    searchPlaylists: Array.isArray(playlists) ? playlists.map(normalizeQQSearchPlaylist) : [],
    searchMvs: [],
  }
}

export function searchQQAll() {
  return Promise.reject(createQQPublicApiDisabledError('search'))
}
