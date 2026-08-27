import {
  extractQQPlaylists,
  normalizeQQPlaylist,
  normalizeQQPlaylistDetail,
  normalizeQQSong,
  unwrapQQResponse,
} from '../api/qqMusic.js'

const hasValue = value => value !== undefined && value !== null && value !== ''

export function readQQPlaylistPageMeta(response) {
  const body = response?.data && typeof response.data === 'object' ? response.data : response
  const totalRaw = body?.totaldiss ?? body?.totalDiss ?? body?.total ?? body?.totalCount ?? body?.count
  const total = Number(totalRaw)
  const hasMoreRaw = body?.has_more ?? body?.hasMore ?? body?.hasnext ?? body?.hasNext
  let hasMore = null
  if (hasMoreRaw !== undefined && hasMoreRaw !== null && hasMoreRaw !== '') {
    hasMore = hasMoreRaw === true
      || hasMoreRaw === 1
      || hasMoreRaw === '1'
      || String(hasMoreRaw).toLowerCase() === 'true'
  }
  return {
    total: Number.isFinite(total) && total >= 0 ? total : null,
    hasMore,
  }
}

/**
 * Load a private QQ playlist collection while tolerating the two pagination
 * contracts exposed by qq-music-api: collected lists use page numbers, while
 * created lists slice the upstream array with `offset % limit`.
 */
export async function loadQQPlaylistPages(fetchPage, options = {}) {
  if (typeof fetchPage !== 'function') throw new TypeError('QQ playlist page loader is required')

  const subscribed = options.subscribed === true
  const pageSize = Number(options.limit) > 0 ? Math.floor(Number(options.limit)) : (subscribed ? 20 : 500)
  const maxPages = Number(options.maxPages) > 0 ? Math.floor(Number(options.maxPages)) : 20
  const isActive = typeof options.isActive === 'function' ? options.isActive : () => true
  const playlists = []
  const seenIds = new Set()
  let page = 1
  let offset = 0
  let total = null
  let hasMore = null

  for (let iteration = 0; iteration < maxPages; iteration += 1) {
    if (!isActive()) return false

    // The package computes pageOffset as offset % limit. Increasing the limit
    // with the cursor makes offset 500 address the next slice instead of the
    // first page again.
    const limit = subscribed ? pageSize : Math.max(pageSize, offset + pageSize)
    const request = subscribed
      ? { page, limit }
      : { offset, limit }
    const rawResponse = await fetchPage(request)
    if (!isActive()) return false

    const response = unwrapQQResponse(rawResponse)
    const raw = extractQQPlaylists(response)
    const pageItems = Array.isArray(raw)
      ? raw.map(item => normalizeQQPlaylist(item)).filter(item => item.id)
      : []
    const previousLength = playlists.length
    pageItems.forEach(item => {
      const key = String(item.id)
      if (seenIds.has(key)) return
      seenIds.add(key)
      playlists.push(item)
    })

    const meta = readQQPlaylistPageMeta(response)
    if (meta.total !== null) total = meta.total
    if (meta.hasMore !== null) hasMore = meta.hasMore

    if (pageItems.length === 0 || playlists.length === previousLength) break
    if (hasMore === false || (total !== null && playlists.length >= total)) break

    if (subscribed) {
      page += 1
    } else {
      offset += pageItems.length
    }
  }

  return playlists
}

export async function loadQQPlaylistDetail(fetchDetail, ids, options = {}) {
  if (typeof fetchDetail !== 'function') throw new TypeError('QQ playlist detail loader is required')
  const candidates = []
  for (const value of Array.isArray(ids) ? ids : [ids]) {
    if (!hasValue(value)) continue
    const normalized = String(value)
    if (!candidates.includes(normalized)) candidates.push(normalized)
  }
  const isActive = typeof options.isActive === 'function' ? options.isActive : () => true
  const createFallbackResult = requestedId => {
    const summary = options.fallbackSummary
    if (!summary || typeof summary !== 'object') return null
    const embeddedSongs = summary.songs || summary.songlist || summary.songList
    if (!Array.isArray(embeddedSongs) || embeddedSongs.length === 0) return null
    const songs = embeddedSongs.map(normalizeQQSong).filter(song => song?.sourceId || song?.id)
    if (songs.length === 0) return null
    const playlist = normalizeQQPlaylist(summary, { id: requestedId })
    if (!playlist.id && hasValue(requestedId)) playlist.id = String(requestedId)
    if (playlist.trackCount <= 0) playlist.trackCount = songs.length
    if (playlist.size <= 0) playlist.size = songs.length
    return { playlist, songs, requestedId: String(requestedId || playlist.id || '') }
  }
  let lastResult = null
  let lastError = null

  for (let index = 0; index < candidates.length; index += 1) {
    if (!isActive()) return false
    const requestedId = candidates[index]
    try {
      const payload = await fetchDetail(requestedId)
      if (!isActive()) return false
      const normalized = normalizeQQPlaylistDetail(payload, requestedId)
      lastResult = { ...normalized, requestedId }
      if (normalized.songs.length > 0) return lastResult
      if (index === candidates.length - 1) {
        const fallback = createFallbackResult(requestedId)
        return fallback || lastResult
      }
    } catch (error) {
      lastError = error
      if (lastResult?.songs?.length > 0) return lastResult
      if (index === candidates.length - 1) {
        const fallback = createFallbackResult(requestedId)
        if (fallback) return fallback
        throw error
      }
    }
  }

  if (lastResult) {
    if (lastResult.songs.length === 0) {
      const fallback = createFallbackResult(lastResult.requestedId)
      if (fallback) return fallback
    }
    return lastResult
  }
  const fallback = createFallbackResult(candidates[0] || options.fallbackSummary?.id || '')
  if (fallback) return fallback
  if (lastError) throw lastError
  return {
    playlist: normalizeQQPlaylist({}, { id: '' }),
    songs: [],
    requestedId: '',
  }
}

export function mergeQQPlaylistSummary(summary, detail) {
  const base = summary && typeof summary === 'object'
    ? normalizeQQPlaylist(summary)
    : normalizeQQPlaylist(detail || {})
  const fallbackOptions = {
    id: base.id,
    name: base.name,
    coverImgUrl: base.coverImgUrl,
  }
  const normalizedDetail = normalizeQQPlaylist(detail || {}, fallbackOptions)
  const detailName = String(normalizedDetail.name || '')
  const hasUsableDetailName = hasValue(detailName) && detailName !== 'QQ 歌单'
  const trackCount = Number(normalizedDetail.trackCount) > 0
    ? normalizedDetail.trackCount
    : base.trackCount

  return {
    ...base,
    ...normalizedDetail,
    id: hasValue(normalizedDetail.id) ? normalizedDetail.id : base.id,
    source: 'qq',
    name: hasUsableDetailName ? normalizedDetail.name : base.name,
    coverImgUrl: hasValue(normalizedDetail.coverImgUrl) ? normalizedDetail.coverImgUrl : base.coverImgUrl,
    picUrl: hasValue(normalizedDetail.picUrl) ? normalizedDetail.picUrl : base.picUrl,
    trackCount,
    ...(Number(trackCount) > 0 ? { size: Number(trackCount) } : {}),
  }
}

export function mergeQQPlaylistLists(created = [], subscribed = [], liked = null) {
  const normalizeList = list => Array.isArray(list) ? list.filter(item => item && item.id) : []
  const result = {
    created: normalizeList(created),
    subscribed: normalizeList(subscribed),
    liked: liked && liked.id ? [liked] : [],
  }
  if (liked?.id && !result.created.some(item => String(item.id) === String(liked.id))) {
    result.created = [liked, ...result.created]
  }
  return result
}
