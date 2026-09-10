import qqRequest from '../utils/qqRequest.mjs'

export const QQ_PUBLIC_API_DISABLED_CODE = 'QQ_PUBLIC_API_DISABLED'

function createQQPublicApiDisabledError(capability) {
  const error = new Error(`QQ Music ${capability} is disabled; use authenticated My Music instead`)
  error.code = QQ_PUBLIC_API_DISABLED_CODE
  return error
}

// QQ 公共搜索由服务端 `/getSearchByKey` 支撑；分类以 t 参数选择：
// 0=歌曲 8=专辑 9=歌手 12=MV。歌单分类上游不提供，返回空列表。
const QQ_SEARCH_CATEGORY_PARAMS = Object.freeze({
  songs: 0,
  albums: 8,
  artists: 9,
  mvs: 12,
})
const QQ_SEARCH_DEFAULT_LIMIT = 10
const QQ_SEARCH_MAX_LIMIT = 50

export function searchQQCategory(keywords, category, options = {}) {
  const t = QQ_SEARCH_CATEGORY_PARAMS[category]
  if (t === undefined) throw new TypeError('unsupported QQ search category')
  const requestedLimit = Number(options.limit)
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.trunc(requestedLimit) : QQ_SEARCH_DEFAULT_LIMIT, 1),
    QQ_SEARCH_MAX_LIMIT,
  )
  return qqRequest({ url: '/getSearchByKey', method: 'get', params: { key: keywords, t, n: limit } })
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

export function getQQAlbumInfo(albummid, params = {}) {
  if (!albummid) throw new TypeError('QQ album mid is required')
  return qqRequest({ url: '/getAlbumInfo', method: 'get', params: { albummid, ...params } })
}

// 专辑封面使用 QQ 固定图床模板，与搜索专辑 pic/歌曲专辑曲绘一致。
const buildQQAlbumCoverUrl = (mid, size = 'T002R500x500M000') => (
  mid ? `https://y.gtimg.cn/music/photo_new/${size}${mid}.jpg` : ''
)

/**
 * 归一化 QQ 专辑详情（实测 getAlbumInfo 返回 `response.data`）：
 * 元数据字段 mid/name/singername/singermid/aDate/company/desc/genre/lan/cur_song_num，
 * 并自带完整歌曲列表 `list`（复用 normalizeQQSong）。
 */
export function normalizeQQAlbumDetail(payload, fallbackMid = '') {
  const body = unwrapQQResponse(payload)
  const data = body?.data && typeof body.data === 'object' ? body.data : body
  const mid = String(firstQQValue(data?.mid, data?.albummid, data?.albumMid, fallbackMid) || '')
  const name = firstQQValue(data?.name, data?.albumname, data?.albumName) || ''
  const singerName = firstQQValue(data?.singername, data?.singerName) || ''
  const singerMid = firstQQValue(data?.singermid, data?.singerMid, data?.singerMID)
  const trackCount = parseQQTrackCount(firstQQValue(
    data?.cur_song_num,
    data?.total_song_num,
    data?.total,
    data?.song_num,
  ))
  const coverUrl = String(firstQQValue(data?.pic, data?.picUrl, buildQQAlbumCoverUrl(mid)) || '')
  const artists = (singerName || singerMid)
    ? [{ name: String(singerName), ...(singerMid ? { mid: String(singerMid) } : {}) }]
    : []
  const album = {
    ...data,
    id: String(firstQQValue(data?.id, mid) || ''),
    mid: String(mid),
    source: 'qq',
    name: String(name),
    artists,
    singers: artists,
    // LibraryDetail 的封面读取 coverImgUrl/blurPicUrl/img1v1Url 三选一
    coverImgUrl: coverUrl,
    blurPicUrl: coverUrl,
    img1v1Url: coverUrl,
    picUrl: coverUrl,
    company: firstQQValue(data?.company, ''),
    description: firstQQValue(data?.desc, data?.description, ''),
    briefDesc: firstQQValue(data?.desc, data?.description, ''),
    publishTime: firstQQValue(data?.aDate, data?.publishTime, ''),
    genre: firstQQValue(data?.genre, ''),
    lan: firstQQValue(data?.lan, ''),
    trackCount,
    size: trackCount,
    followed: false,
  }
  const rawSongs = Array.isArray(data?.list) ? data.list : []
  return {
    album,
    songs: rawSongs.map(normalizeQQSong),
  }
}

export function getQQMv() {
  return Promise.reject(createQQPublicApiDisabledError('MV details'))
}

// —— 公共首页数据（2026-09 实测形状）——

export function getQQRecommendBanner() {
  return qqRequest({ url: '/getRecommendBanner', method: 'get' })
}

export function getQQNewSongs() {
  return qqRequest({ url: '/getNewSongs', method: 'get' })
}

export function getQQTopLists() {
  return qqRequest({ url: '/getTopLists', method: 'get' })
}

function readQQField(payload, key) {
  const body = unwrapQQResponse(payload)
  return body?.[key] || null
}

/** 焦点图：focus.data.content[] → Banner 使用的 { pic, title, subTitle, jump } 形状。 */
export function normalizeQQRecommendBanner(payload) {
  const focus = readQQField(payload, 'focus')
  const data = focus?.data && typeof focus.data === 'object' ? focus.data : focus
  const items = Array.isArray(data?.content) ? data.content : []
  return items.map(item => ({
    ...item,
    pic: String((item?.pic_info && item.pic_info.url) || item?.pic || item?.cover || ''),
    title: String(item?.title || ''),
    subTitle: String(item?.sub_title || ''),
    jumpUrl: String((item?.jump_info && item.jump_info.url) || ''),
    jumpType: Number(item?.type || 0),
  }))
}

/** 新歌：new_song.data.songlist[] → normalizeQQSong。 */
export function normalizeQQNewSongs(payload) {
  const newSong = readQQField(payload, 'new_song')
  const data = newSong?.data && typeof newSong.data === 'object' ? newSong.data : newSong
  return Array.isArray(data?.songlist) ? data.songlist.map(normalizeQQSong) : []
}

/** 榜单：data.topList[] → { id, name, picUrl, listenCount, tracks[] }。 */
export function normalizeQQTopLists(payload) {
  const body = unwrapQQResponse(payload)
  const data = body?.data && typeof body.data === 'object' ? body.data : body
  const topList = Array.isArray(data?.topList) ? data.topList : []
  return topList.map(list => ({
    id: String(list?.id ?? ''),
    source: 'qq',
    name: String(list?.topTitle || ''),
    picUrl: String(list?.picUrl || ''),
    coverImgUrl: String(list?.picUrl || ''),
    listenCount: Number(list?.listenCount ?? 0),
    tracks: Array.isArray(list?.songList) ? list.songList : [],
  }))
}

export function getQQMvPlay() {
  return Promise.reject(createQQPublicApiDisabledError('MV playback'))
}

// —— 歌手详情（2026-09 实测：描述/关注走 fcg 接口，热歌走 zhida hotsong，MV 走 fcg_singer_mv）——

// zhida hotsong.f 为管道分隔：0歌id|1歌名|2歌手id|3歌手名|4专辑id|5专辑名|6?|7时长秒|...|20 songmid|21 singermid|22 albummid
function parseQQHotSongF(f, fallback = {}) {
  if (typeof f !== 'string' || !f) return {
    ...fallback,
    songmid: fallback.songMID || fallback.songmid || '',
    songname: fallback.songName || fallback.songname || '',
  }
  const parts = f.split('|')
  const durationSec = Number(parts[7])
  return {
    id: parts[20] || fallback.songMID || '',
    songmid: parts[20] || fallback.songMID || '',
    name: parts[1] || fallback.songName || '',
    singer: parts[3]
      ? [{ name: parts[3], mid: parts[21] || '' }]
      : fallback.singer && Array.isArray(fallback.singer) ? fallback.singer : [],
    albummid: parts[22] || '',
    albumname: parts[5] || '',
    ...(Number.isFinite(durationSec) && durationSec > 0 ? { interval: String(durationSec) } : {}),
  }
}

/**
 * 归并 QQ 歌手详情聚合响应：{ desc, starNum, hotSongs, mvs }。
 * hotSongs 优先解析 f 字段，缺失时退回 songMID/songName 最小结构。
 */
export function normalizeQQSingerDetail(payload, options = {}) {
  const body = unwrapQQResponse(payload)
  const hotSongsRaw = Array.isArray(body?.hotSongs) ? body.hotSongs : []
  const hotSongs = hotSongsRaw.map(entry => normalizeQQSong(parseQQHotSongF(entry?.f, entry)))
  const mvsRaw = Array.isArray(body?.mvs) ? body.mvs : []
  const mvs = mvsRaw.map(mv => ({
    id: String(mv?.vid || mv?.id || ''),
    source: 'qq',
    name: String(mv?.title || ''),
    picUrl: String(mv?.pic || ''),
    cover: String(mv?.pic || ''),
    briefDesc: String(mv?.desc || ''),
    playCount: Number(mv?.listenCount ?? 0),
    artist: { id: mv?.singer_id, name: String(mv?.singer_name || ''), mid: mv?.singer_mid },
  }))
  const singerPic = options.pic || (options.mid
    ? `https://y.gtimg.cn/music/photo_new/T001R300x300M000${options.mid}.jpg`
    : '')
  const singer = {
    id: String(options.mid || ''),
    source: 'qq',
    name: String(options.name || ''),
    picUrl: singerPic,
    coverImgUrl: singerPic,
    img1v1Url: singerPic,
    description: String(body?.desc || ''),
    briefDesc: String(body?.desc || ''),
    musicSize: hotSongs.length,
    albumSize: 0, // 歌手专辑接口上游未提供
    mvSize: mvs.length,
    followed: false,
    starNum: Number(body?.starNum ?? 0),
  }
  return { singer, hotSongs, mvs }
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

// —— 真实 client_search_cp 分类响应的归一化（2026-09 实测形状）——

function readQQSearchCategoryList(payload, categoryKey) {
  const body = unwrapQQResponse(payload)
  const data = body?.data && typeof body.data === 'object' ? body.data : body
  const category = data?.[categoryKey]
  return Array.isArray(category?.list) ? category.list : []
}

/** 歌手分类：singerID/singerMID/singerName/singerPic。 */
export function normalizeQQSearchArtists(payload) {
  return readQQSearchCategoryList(payload, 'singer').map(singer => {
    const mid = firstQQValue(singer.singerMID, singer.singer_mid, singer.mid)
    const name = firstQQValue(singer.singerName, singer.singer_name, singer.name) || ''
    const pic = firstQQValue(singer.singerPic, singer.singer_pic, singer.picUrl, singer.pic) || ''
    return {
      ...singer,
      id: String(firstQQValue(mid, singer.singerID, singer.id) || ''),
      mid: String(mid || ''),
      source: 'qq',
      name: String(name),
      picUrl: String(pic),
      coverImgUrl: String(pic),
      img1v1Url: String(pic),
    }
  })
}

/** 专辑分类：albumID/albumMID/albumName/albumPic/singer_list/song_count/publicTime。 */
export function normalizeQQSearchAlbums(payload) {
  return readQQSearchCategoryList(payload, 'album').map(album => {
    const mid = firstQQValue(album.albumMID, album.album_mid, album.mid)
    const name = firstQQValue(album.albumName, album.album_name, album.albumname, album.name) || ''
    const pic = firstQQValue(album.albumPic, album.album_pic, album.picUrl, album.pic) || ''
    const rawArtists = firstQQValue(album.singer_list, album.singerList, album.singers)
    const artists = Array.isArray(rawArtists)
      ? rawArtists.map(artist => ({
          ...(artist && typeof artist === 'object' ? artist : {}),
          ...(artist?.name ? {} : { name: String(firstQQValue(album.singerName, album.singer_name) || '') }),
        }))
      : (album.singerName || album.singer_name
        ? [{ name: String(album.singerName || album.singer_name), mid: String(firstQQValue(album.singerMID, album.singer_mid) || ''), id: album.singerID }]
        : [])
    return {
      ...album,
      id: String(firstQQValue(mid, album.albumID, album.id) || ''),
      mid: String(mid || ''),
      source: 'qq',
      name: String(name),
      picUrl: String(pic),
      blurPicUrl: String(pic),
      artists,
      size: parseQQTrackCount(firstQQValue(album.song_count, album.songCount, album.songnum, album.size)),
      publishTime: album.publicTime ?? album.publishTime ?? '',
    }
  })
}

/** MV 分类：v_id/mv_id/mv_name/mv_pic_url/duration/play_count/singer_list。 */
export function normalizeQQSearchMvs(payload) {
  return readQQSearchCategoryList(payload, 'mv').map(mv => {
    const id = firstQQValue(mv.v_id, mv.vid, mv.mv_id, mv.mvId, mv.id)
    const name = firstQQValue(mv.mv_name, mv.mvname, mv.name, mv.title) || ''
    const pic = firstQQValue(mv.mv_pic_url, mv.mvPicUrl, mv.pic, mv.picUrl, mv.cover) || ''
    const rawArtists = firstQQValue(mv.singer_list, mv.singerList, mv.singers)
    const artists = Array.isArray(rawArtists)
      ? rawArtists.map(artist => ({
          ...(artist && typeof artist === 'object' ? artist : { name: artist }),
          name: String((artist && typeof artist === 'object' ? artist.name : artist) || firstQQValue(mv.singer_name, mv.singerName) || ''),
        }))
      : (mv.singer_name || mv.singerName
        ? [{ name: String(mv.singer_name || mv.singerName) }]
        : [])
    return {
      ...mv,
      id: String(id || ''),
      source: 'qq',
      name: String(name),
      picUrl: String(pic),
      coverImgUrl: String(pic),
      artists,
      duration: parseQQDurationMilliseconds(mv.duration),
      playCount: parseQQTrackCount(firstQQValue(mv.play_count, mv.playCount, mv.play_cnt)),
    }
  })
}

/** 歌曲分类复用 song.list + normalizeQQSong。 */
export function normalizeQQSearchSongs(payload) {
  return readQQSearchCategoryList(payload, 'song').map(normalizeQQSong)
}

/**
 * 聚合搜索：并行请求歌曲/专辑/歌手/MV 四个分类，返回搜索页统一使用的
 * `searchResult` 形状。歌单上游不提供，固定为空数组，界面不冒充数据。
 */
export async function searchQQAll(keywords, options = {}) {
  const [songs, albums, artists, mvs] = await Promise.allSettled([
    searchQQCategory(keywords, 'songs', options),
    searchQQCategory(keywords, 'albums', options),
    searchQQCategory(keywords, 'artists', options),
    searchQQCategory(keywords, 'mvs', options),
  ])
  const read = (settled, fallback = {}) => settled.status === 'fulfilled' ? settled.value : fallback
  return {
    searchSongs: normalizeQQSearchSongs(read(songs)),
    searchAlbums: normalizeQQSearchAlbums(read(albums)),
    searchArtists: normalizeQQSearchArtists(read(artists)),
    searchPlaylists: [], // client_search_cp 不提供歌单分类
    searchMvs: normalizeQQSearchMvs(read(mvs)),
  }
}
