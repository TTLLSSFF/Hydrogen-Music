import { defineStore } from "pinia";
import { getPlaylistDetail, getPlaylistAll, getRecommendSongs, getHistoryRecommendSongsDetail, playlistDynamic } from '../api/playlist'
import { getAlbumDetail, albumDynamic } from '../api/album'
import { getArtistDetail, getArtistFansCount, getArtistTopSong, getArtistAlbum } from '../api/artist'
import { getArtistMV } from '../api/mv'
import { getSongDetail } from '../api/song'
import { getQQSongListDetail } from '../api/qqMusic'
import { loadQQPlaylistDetail, mergeQQPlaylistSummary } from '../utils/qqLibrary.mjs'
import { mapSongsPlayableStatus } from "../utils/songStatus";
import { buildAlbumSearchText, buildCloudSongSearchText, buildMVSearchText } from "../utils/songFilter";
import { getSongIdentity, normalizeMusicSource } from '../utils/musicSource.mjs'

const PLAYLIST_PAGE_SIZE = 100
const PLAYLIST_HYDRATION_CONCURRENCY = 4
const PLAYLIST_OVERVIEW_COUNT_FIELDS = ['trackCount', 'size']

const createPlaylistHydrationState = ({ id = null, total = 0, loaded = 0, status = 'idle', source = 'netease' } = {}) => ({
    id,
    total,
    loaded,
    status,
    source: normalizeMusicSource(source),
})
const createSearchIndexState = () => ({
    songs: {},
    albums: {},
    mvs: {},
})
const cloneSearchIndexState = index => ({
    songs: { ...(index?.songs || {}) },
    albums: { ...(index?.albums || {}) },
    mvs: { ...(index?.mvs || {}) },
})

const getSearchEntryKey = (entry, fallbackKey = '0') => String(getSongIdentity(entry) || entry?.id || fallbackKey)
const isBlankValue = value => value == null || value === ''
const normalizeOptionalId = id => isBlankValue(id) ? '' : String(id)
const getLibraryDetailCacheKey = (id, routerName, source = 'netease') => {
    const normalizedName = String(routerName || '')
    const normalizedId = normalizeOptionalId(id)
    if (!normalizedName || !normalizedId) return ''
    return `${normalizedName}:${normalizeMusicSource(source)}:${normalizedId}`
}
const trimRecordMap = (records, limit, fallbackLimit) => {
    if (!records || typeof records != 'object') return {}

    const parsedLimit = Number(limit)
    const safeLimit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.floor(parsedLimit) : fallbackLimit
    const entries = Object.entries(records)
    if (entries.length <= safeLimit) return records

    entries.sort((a, b) => Number(a?.[1]?.updatedAt || 0) - Number(b?.[1]?.updatedAt || 0))
    const nextRecords = { ...records }
    const deleteCount = entries.length - safeLimit
    for (let i = 0; i < deleteCount; i++) {
        delete nextRecords[entries[i][0]]
    }
    return nextRecords
}
const hasNeedTimestampUrl = (needTimestamp, url) => {
    return Array.isArray(needTimestamp) && needTimestamp.includes(url)
}
const createPlaylistHydrationToken = playlistId => `${playlistId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const useLibraryStore = defineStore('libraryStore', {
    state: () => {
        return {
            listType1: 0,
            listType2: 0,
            artistPageType: 0,
            libraryList: null,
            libraryListAlbum: null,
            libraryListAritist: null,
            playlistCount: null,
            playlistUserCreated: null,
            playlistUserSub: null,
            playlistOverviewVersion: 0,
            libraryInfo: null,
            lastLibraryRoute: null,
            lastLibraryScrollTop: 0,
            restoreLibraryScrollOnActivate: false,
            detailScrollMemory: {},
            detailScrollMemoryLimit: 100,
            detailCache: {},
            detailCacheLimit: 20,
            playlistHydration: createPlaylistHydrationState(),
            playlistHydrationToken: null,
            playlistHydrationPromise: null,
            librarySongs: null,
            libraryAlbum: null,
            libraryMV: null,
            searchIndexById: createSearchIndexState(),
            needTimestamp: [],
            libraryChangeAnimation: false,
        }
    },
    actions: {
        changeAnimation() {
            this.libraryChangeAnimation = true
        },
        changeLibraryList(type) {
            if (type == 0) this.libraryList = this.playlistUserCreated
            else if (type == 1) this.libraryList = this.playlistUserSub
        },
        updateLibrary(libraryData) {
            this.libraryData = libraryData
        },
        updateUserPlaylistCount(listCount) {
            this.playlistCount = listCount
        },
        updateUserPlaylist(playlist) {
            this.playlistUserCreated = playlist.splice(0, this.playlistCount.createdPlaylistCount)
            this.playlistUserSub = playlist.splice(0, this.playlistCount.subPlaylistCount)
        },
        markPlaylistOverviewStale() {
            this.playlistOverviewVersion += 1
        },
        updatePlaylistOverviewTrackCount(playlistId, delta, source = '') {
            const normalizedPlaylistId = String(playlistId ?? '')
            const parsedDelta = Number(delta)
            if (!normalizedPlaylistId || !Number.isFinite(parsedDelta) || parsedDelta == 0) return
            const normalizedSource = source ? normalizeMusicSource(source) : ''

            const updateItem = item => {
                if (String(item?.id ?? '') != normalizedPlaylistId) return item
                if (normalizedSource && normalizeMusicSource(item?.source) !== normalizedSource) return item

                const nextItem = { ...item }
                for (const key of PLAYLIST_OVERVIEW_COUNT_FIELDS) {
                    if (isBlankValue(nextItem[key])) continue
                    const count = Number(nextItem[key])
                    if (!Number.isFinite(count)) continue
                    nextItem[key] = Math.max(0, count + parsedDelta)
                }

                return nextItem
            }
            const updateList = list => Array.isArray(list) ? list.map(updateItem) : list

            this.playlistUserCreated = updateList(this.playlistUserCreated)
            this.playlistUserSub = updateList(this.playlistUserSub)
            this.libraryList = updateList(this.libraryList)
            if (this.libraryInfo
                && String(this.libraryInfo.id ?? '') == normalizedPlaylistId
                && (!normalizedSource || normalizeMusicSource(this.libraryInfo.source) === normalizedSource)) {
                this.libraryInfo = updateItem(this.libraryInfo)
            }
        },
        resetPlaylistHydration() {
            this.playlistHydration = createPlaylistHydrationState()
            this.playlistHydrationToken = null
            this.playlistHydrationPromise = null
        },
        resetAccountState() {
            this.libraryList = null
            this.libraryListAlbum = null
            this.libraryListAritist = null
            this.playlistCount = null
            this.playlistUserCreated = null
            this.playlistUserSub = null
            this.playlistOverviewVersion = 0
            this.libraryInfo = null
            this.lastLibraryRoute = null
            this.lastLibraryScrollTop = 0
            this.restoreLibraryScrollOnActivate = false
            this.detailScrollMemory = {}
            this.detailCache = {}
            this.librarySongs = null
            this.libraryAlbum = null
            this.libraryMV = null
            this.libraryChangeAnimation = false
            this.resetPlaylistHydration()
            this.resetSearchIndex()
        },
        clearQQScopedState() {
            const isQQ = item => normalizeMusicSource(item?.source) === 'qq'
            const filterQQ = list => Array.isArray(list) ? list.filter(item => !isQQ(item)) : list
            const previousCreated = this.playlistUserCreated
            const previousSubscribed = this.playlistUserSub
            const previousLibraryList = this.libraryList
            const qqWasInLibraryList = Array.isArray(previousLibraryList) && previousLibraryList.some(isQQ)

            this.playlistUserCreated = filterQQ(this.playlistUserCreated)
            this.playlistUserSub = filterQQ(this.playlistUserSub)
            if (previousLibraryList === previousCreated) this.libraryList = this.playlistUserCreated
            else if (previousLibraryList === previousSubscribed) this.libraryList = this.playlistUserSub
            else this.libraryList = filterQQ(previousLibraryList)
            this.playlistCount = this.playlistCount
                ? {
                    ...this.playlistCount,
                    createdPlaylistCount: Array.isArray(this.playlistUserCreated) ? this.playlistUserCreated.length : 0,
                    subPlaylistCount: Array.isArray(this.playlistUserSub) ? this.playlistUserSub.length : 0,
                }
                : this.playlistCount

            const qqDetailActive = normalizeMusicSource(this.libraryInfo?.source) === 'qq'
            const qqSongsRemoved = Array.isArray(this.librarySongs) && this.librarySongs.some(isQQ)
            if (qqDetailActive) {
                this.libraryInfo = null
                this.librarySongs = null
                this.libraryAlbum = null
                this.libraryMV = null
            } else if (Array.isArray(this.librarySongs)) {
                this.librarySongs = this.librarySongs.filter(song => !isQQ(song))
            }

            if (this.playlistHydration?.source === 'qq') this.resetPlaylistHydration()

            if (this.detailCache && typeof this.detailCache === 'object') {
                const nextCache = {}
                Object.entries(this.detailCache).forEach(([key, value]) => {
                    if (!String(key).includes(':qq:')) nextCache[key] = value
                })
                this.detailCache = nextCache
            }
            if (this.detailScrollMemory && typeof this.detailScrollMemory === 'object') {
                const nextScrollMemory = {}
                Object.entries(this.detailScrollMemory).forEach(([key, value]) => {
                    if (!/[?&]source=qq(?:&|$)/i.test(String(key))) nextScrollMemory[key] = value
                })
                this.detailScrollMemory = nextScrollMemory
            }

            if (qqDetailActive || qqWasInLibraryList || qqSongsRemoved) {
                this.resetSearchIndex()
            }
            if (this.lastLibraryRoute && /[?&]source=qq(?:&|$)/i.test(String(this.lastLibraryRoute.fullPath || ''))) {
                this.lastLibraryRoute = null
                this.restoreLibraryScrollOnActivate = false
            }
        },
        resetSearchIndex(section = null) {
            if (!section) {
                this.searchIndexById = createSearchIndexState()
                return
            }
            this.searchIndexById = {
                ...this.searchIndexById,
                [section]: {},
            }
        },
        indexLibrarySongs(songs, { append = false } = {}) {
            const nextSongsIndex = append ? { ...(this.searchIndexById?.songs || {}) } : {}
            const targetSongs = Array.isArray(songs) ? songs : []
            targetSongs.forEach((song, index) => {
                nextSongsIndex[getSearchEntryKey(song, `song-${index}`)] = buildCloudSongSearchText(song)
            })
            this.searchIndexById = {
                ...this.searchIndexById,
                songs: nextSongsIndex,
            }
        },
        indexLibraryAlbums(albums) {
            const nextAlbumsIndex = {}
            const targetAlbums = Array.isArray(albums) ? albums : []
            targetAlbums.forEach((album, index) => {
                nextAlbumsIndex[getSearchEntryKey(album, `album-${index}`)] = buildAlbumSearchText(album)
            })
            this.searchIndexById = {
                ...this.searchIndexById,
                albums: nextAlbumsIndex,
            }
        },
        indexLibraryMVs(mvs) {
            const nextMvsIndex = {}
            const targetMvs = Array.isArray(mvs) ? mvs : []
            targetMvs.forEach((mv, index) => {
                nextMvsIndex[getSearchEntryKey(mv, `mv-${index}`)] = buildMVSearchText(mv)
            })
            this.searchIndexById = {
                ...this.searchIndexById,
                mvs: nextMvsIndex,
            }
        },
        getSongSearchText(song, fallbackKey = '0') {
            return this.searchIndexById?.songs?.[getSearchEntryKey(song, fallbackKey)] || buildCloudSongSearchText(song)
        },
        getAlbumSearchText(album, fallbackKey = '0') {
            return this.searchIndexById?.albums?.[getSearchEntryKey(album, fallbackKey)] || buildAlbumSearchText(album)
        },
        getMVSearchText(mv, fallbackKey = '0') {
            return this.searchIndexById?.mvs?.[getSearchEntryKey(mv, fallbackKey)] || buildMVSearchText(mv)
        },
        trimDetailScrollMemory() {
            this.detailScrollMemory = trimRecordMap(this.detailScrollMemory, this.detailScrollMemoryLimit, 100)
        },
        saveDetailScroll(fullPath, top) {
            const targetPath = String(fullPath || '')
            if (!targetPath) return

            const parsedTop = Number(top)
            const normalizedTop = Number.isFinite(parsedTop) ? Math.max(0, parsedTop) : 0
            if (!this.detailScrollMemory || typeof this.detailScrollMemory != 'object') this.detailScrollMemory = {}

            this.detailScrollMemory[targetPath] = {
                top: normalizedTop,
                updatedAt: Date.now(),
            }
            this.trimDetailScrollMemory()
        },
        getDetailScroll(fullPath) {
            const targetPath = String(fullPath || '')
            if (!targetPath) return null
            const record = this.detailScrollMemory?.[targetPath]
            if (!record) return null

            const parsedTop = Number(record.top)
            if (!Number.isFinite(parsedTop)) return null
            return Math.max(0, parsedTop)
        },
        trimDetailCache() {
            this.detailCache = trimRecordMap(this.detailCache, this.detailCacheLimit, 20)
        },
        invalidateLibraryDetailCache(id = null, routerName = null, source = null) {
            if (!this.detailCache || typeof this.detailCache != 'object') {
                this.detailCache = {}
                return
            }

            const normalizedName = String(routerName || '')
            const normalizedId = normalizeOptionalId(id)
            const normalizedSource = source == null || source === '' ? '' : normalizeMusicSource(source)

            if (normalizedName && normalizedId) {
                if (normalizedSource) {
                    delete this.detailCache[getLibraryDetailCacheKey(normalizedId, normalizedName, normalizedSource)]
                } else {
                    Object.keys(this.detailCache).forEach(key => {
                        if (key.startsWith(`${normalizedName}:`) && key.endsWith(`:${normalizedId}`)) delete this.detailCache[key]
                    })
                }
            } else if (normalizedName) {
                const keyPrefix = normalizedSource
                    ? `${normalizedName}:${normalizedSource}:`
                    : `${normalizedName}:`
                Object.keys(this.detailCache).forEach(key => {
                    if (key.startsWith(keyPrefix)) delete this.detailCache[key]
                })
            } else if (normalizedId) {
                Object.keys(this.detailCache).forEach(key => {
                    if (key.endsWith(`:${normalizedId}`)) delete this.detailCache[key]
                })
            } else {
                this.detailCache = {}
                return
            }

            this.detailCache = { ...this.detailCache }
        },
        invalidatePlaylistDetailCache(id = null, source = null) {
            this.invalidateLibraryDetailCache(id, 'playlist', source)

            const normalizedId = normalizeOptionalId(id)
            const hydrationId = String(this.playlistHydration?.id || '')
            if (!normalizedId || hydrationId == normalizedId) this.resetPlaylistHydration()
        },
        cacheCurrentLibraryDetail(id, routerName, source = this.libraryInfo?.source || 'netease') {
            const normalizedSource = normalizeMusicSource(source)
            const key = getLibraryDetailCacheKey(id, routerName, normalizedSource)
            if (!key || !this.libraryInfo) return
            if (!this.detailCache || typeof this.detailCache != 'object') this.detailCache = {}

            this.detailCache[key] = {
                libraryInfo: this.libraryInfo,
                librarySongs: this.librarySongs,
                libraryAlbum: this.libraryAlbum,
                libraryMV: this.libraryMV,
                artistPageType: this.artistPageType,
                playlistHydration: { ...(this.playlistHydration || createPlaylistHydrationState()) },
                source: normalizedSource,
                searchIndexById: cloneSearchIndexState(this.searchIndexById),
                updatedAt: Date.now(),
            }
            this.trimDetailCache()
        },
        restoreLibraryDetailFromCache(id, routerName, source = 'netease') {
            const normalizedSource = normalizeMusicSource(source)
            const key = getLibraryDetailCacheKey(id, routerName, normalizedSource)
            const cached = key ? this.detailCache?.[key] : null
            if (!cached?.libraryInfo || (cached.source && normalizeMusicSource(cached.source) !== normalizedSource)) return false

            cached.updatedAt = Date.now()
            this.libraryInfo = cached.libraryInfo
            this.librarySongs = cached.librarySongs
            this.libraryAlbum = cached.libraryAlbum
            this.libraryMV = cached.libraryMV
            this.artistPageType = Number.isInteger(cached.artistPageType) ? cached.artistPageType : 0
            this.searchIndexById = cloneSearchIndexState(cached.searchIndexById)
            this.libraryChangeAnimation = false

            if (routerName == 'playlist') {
                this.playlistHydration = {
                    ...(cached.playlistHydration || createPlaylistHydrationState()),
                    source: normalizedSource,
                }
                this.resumePlaylistHydrationFromCache(id, normalizedSource)
            } else {
                this.resetPlaylistHydration()
            }

            return true
        },
        shouldBypassLibraryDetailCache(routerName) {
            return routerName == 'playlist' && (
                hasNeedTimestampUrl(this.needTimestamp, '/playlist/detail')
                || hasNeedTimestampUrl(this.needTimestamp, '/playlist/track/all')
            )
        },
        async waitForPlaylistHydration(id) {
            const targetId = String(id || '')
            if (!targetId) return

            const hydration = this.playlistHydration || createPlaylistHydrationState()
            if (String(hydration.id || '') != targetId || hydration.status != 'loading') return

            const task = this.playlistHydrationPromise
            if (task && typeof task.then == 'function') {
                await task.catch(() => null)
            }
        },
        async hydratePlaylistRemaining(id, totalTracks, token, initialLoaded = 0) {
            const offsets = []
            const parsedInitialLoaded = Number(initialLoaded)
            const safeInitialLoaded = Number.isFinite(parsedInitialLoaded) ? Math.max(0, parsedInitialLoaded) : 0
            const startOffset = Math.max(
                PLAYLIST_PAGE_SIZE,
                Math.floor(safeInitialLoaded / PLAYLIST_PAGE_SIZE) * PLAYLIST_PAGE_SIZE
            )
            for (let offset = startOffset; offset < totalTracks; offset += PLAYLIST_PAGE_SIZE) {
                offsets.push(offset)
            }
            if (offsets.length == 0) return []

            const queue = offsets.slice()
            const pages = []
            let loadedCount = Math.min(safeInitialLoaded, totalTracks)
            const worker = async () => {
                while (queue.length > 0) {
                    if (this.playlistHydrationToken != token) return
                    const offset = queue.shift()
                    const params = {
                        id,
                        limit: PLAYLIST_PAGE_SIZE,
                        offset,
                    }
                    const result = await getPlaylistAll(params)
                    if (this.playlistHydrationToken != token) return

                    const songs = mapSongsPlayableStatus(result?.songs || [], result?.privileges || []) || []
                    pages.push({ offset, songs })
                    loadedCount = Math.min(totalTracks, loadedCount + songs.length)
                    this.playlistHydration = createPlaylistHydrationState({
                        id,
                        total: totalTracks,
                        loaded: loadedCount,
                        status: 'loading',
                        source: this.playlistHydration?.source || 'netease',
                    })
                }
            }
            const workerCount = Math.min(PLAYLIST_HYDRATION_CONCURRENCY, queue.length)
            await Promise.all(Array.from({ length: workerCount }, () => worker()))
            if (this.playlistHydrationToken != token) return []

            pages.sort((a, b) => a.offset - b.offset)
            const mergedSongs = []
            pages.forEach(page => mergedSongs.push(...page.songs))
            return mergedSongs
        },
        appendHydratedPlaylistSongs(songs) {
            if (!Array.isArray(songs) || songs.length == 0) return

            const currentSongs = Array.isArray(this.librarySongs) ? this.librarySongs : []
            if (!Array.isArray(this.librarySongs)) this.librarySongs = currentSongs
            for (let i = 0; i < songs.length; i++) {
                currentSongs.push(songs[i])
            }
            this.indexLibrarySongs(songs, { append: true })
        },
        startPlaylistHydrationTask(playlistId, totalTracks, token, loadedTracks, source = this.playlistHydration?.source || 'netease') {
            const normalizedSource = normalizeMusicSource(source)
            const hydrationTask = this.hydratePlaylistRemaining(playlistId, totalTracks, token, loadedTracks)
                .then(remainingSongs => {
                    if (this.playlistHydrationToken != token) return
                    this.appendHydratedPlaylistSongs(remainingSongs)
                    this.playlistHydration = createPlaylistHydrationState({
                        id: playlistId,
                        total: totalTracks,
                        loaded: totalTracks,
                        status: 'completed',
                        source: normalizedSource,
                    })
                    this.cacheCurrentLibraryDetail(playlistId, 'playlist', normalizedSource)
                })
                .catch(() => {
                    if (this.playlistHydrationToken != token) return
                    const loadedNow = Array.isArray(this.librarySongs) ? Math.min(this.librarySongs.length, totalTracks) : loadedTracks
                    this.playlistHydration = createPlaylistHydrationState({
                        id: playlistId,
                        total: totalTracks,
                        loaded: loadedNow,
                        status: 'failed',
                        source: normalizedSource,
                    })
                    this.cacheCurrentLibraryDetail(playlistId, 'playlist', normalizedSource)
                })
                .finally(() => {
                    if (this.playlistHydrationToken == token) this.playlistHydrationPromise = null
                })

            this.playlistHydrationPromise = hydrationTask
            return hydrationTask
        },
        resumePlaylistHydrationFromCache(id, source = this.playlistHydration?.source || 'netease') {
            const playlistId = String(id || '')
            const normalizedSource = normalizeMusicSource(source)
            const totalTracks = Number(this.playlistHydration?.total || 0)
            const loadedTracks = Array.isArray(this.librarySongs) ? this.librarySongs.length : Number(this.playlistHydration?.loaded || 0)
            if (!playlistId || !Number.isFinite(totalTracks) || totalTracks <= 0 || loadedTracks >= totalTracks) {
                this.playlistHydration = createPlaylistHydrationState({
                    id: playlistId,
                    total: Math.max(totalTracks || 0, loadedTracks || 0),
                    loaded: Math.max(totalTracks || 0, loadedTracks || 0),
                    status: playlistId ? 'completed' : 'idle',
                    source: normalizedSource,
                })
                this.playlistHydrationToken = null
                this.playlistHydrationPromise = null
                if (playlistId) this.cacheCurrentLibraryDetail(playlistId, 'playlist', normalizedSource)
                return
            }

            const token = createPlaylistHydrationToken(playlistId)
            this.playlistHydrationToken = token
            this.playlistHydration = createPlaylistHydrationState({
                id: playlistId,
                total: totalTracks,
                loaded: loadedTracks,
                status: 'loading',
                source: normalizedSource,
            })

            this.startPlaylistHydrationTask(playlistId, totalTracks, token, loadedTracks, normalizedSource)
            this.cacheCurrentLibraryDetail(playlistId, 'playlist', normalizedSource)
        },
        async updateLibraryDetail(id, routerName, options = {}) {
            const { force = false } = options
            const source = normalizeMusicSource(options.source)
            if (routerName === 'album' && source === 'qq') return
            if (!force && !this.shouldBypassLibraryDetailCache(routerName) && this.restoreLibraryDetailFromCache(id, routerName, source)) return

            this.changeAnimation()
            this.resetSearchIndex()
            if (routerName != 'playlist') this.resetPlaylistHydration()
            if (routerName == 'playlist') {
                if (source === 'qq') await this.updateQQPlaylistDetail(id)
                else await this.updatePlaylistDetail(id, { ...options, source })
            }
            if (routerName == 'album') await this.updateAlbumDetail(id)
            if (routerName == 'artist') await this.updateArtistDetail(id)
            this.artistPageType = 0
            this.libraryAlbum = null
            this.libraryMV = null
            this.cacheCurrentLibraryDetail(id, routerName, source)
        },
        async updateQQPlaylistDetail(id) {
            const playlistId = String(id || '')
            const token = createPlaylistHydrationToken(playlistId)
            this.playlistHydrationToken = token
            this.playlistHydrationPromise = null
            this.playlistHydration = createPlaylistHydrationState({ id: playlistId, status: 'loading', source: 'qq' })
            const listSummary = [
                ...(Array.isArray(this.playlistUserCreated) ? this.playlistUserCreated : []),
                ...(Array.isArray(this.playlistUserSub) ? this.playlistUserSub : []),
            ].find(item => normalizeMusicSource(item?.source) === 'qq' && String(item?.id ?? '') === playlistId)
            const existingSummary = listSummary
                || (normalizeMusicSource(this.libraryInfo?.source) === 'qq' && String(this.libraryInfo?.id ?? '') === playlistId ? this.libraryInfo : null)
            // Never leave a previous NetEase (or another QQ) detail visible
            // while this private QQ request is in flight or after it fails.
            this.libraryInfo = existingSummary ? { ...existingSummary, source: 'qq', id: playlistId } : null
            this.librarySongs = []
            this.libraryAlbum = null
            this.libraryMV = null
            this.indexLibrarySongs([])
            try {
                const detailIds = [playlistId, ...(Array.isArray(existingSummary?.detailIds) ? existingSummary.detailIds : [])]
                const normalized = await loadQQPlaylistDetail(
                    detailId => getQQSongListDetail(detailId),
                    detailIds,
                    {
                        isActive: () => this.playlistHydrationToken === token,
                        fallbackSummary: existingSummary,
                    },
                )
                if (normalized === false) return
                if (this.playlistHydrationToken !== token) return
                this.libraryInfo = normalized.playlist?.id
                    ? normalized.playlist
                    : { id: playlistId, source: 'qq', name: 'QQ 歌单', coverImgUrl: '' }
                this.libraryInfo = mergeQQPlaylistSummary(existingSummary, this.libraryInfo)
                this.libraryInfo.id = playlistId
                this.librarySongs = normalized.songs.length > 0
                    ? normalized.songs
                    : (Array.isArray(existingSummary?.songs) ? existingSummary.songs : [])
                this.indexLibrarySongs(this.librarySongs)
                this.playlistHydration = createPlaylistHydrationState({ id: playlistId, total: this.librarySongs.length, loaded: this.librarySongs.length, status: 'completed', source: 'qq' })
                this.libraryChangeAnimation = false
                this.cacheCurrentLibraryDetail(id, 'playlist', 'qq')
            } catch (error) {
                if (this.playlistHydrationToken === token) {
                    this.librarySongs = []
                    this.libraryInfo = existingSummary
                        ? { ...existingSummary, source: 'qq', id: playlistId }
                        : { id: playlistId, source: 'qq', name: 'QQ 歌单', coverImgUrl: '' }
                    this.indexLibrarySongs([])
                    this.playlistHydration = createPlaylistHydrationState({
                        id: playlistId,
                        total: 0,
                        loaded: 0,
                        status: 'failed',
                        source: 'qq',
                    })
                    this.playlistHydrationPromise = null
                    this.playlistHydrationToken = null
                    this.libraryChangeAnimation = false
                }
                throw error
            }
        },
        async updatePlaylistDetail(id, options = {}) {
            const { deferRemaining = false } = options
            const source = normalizeMusicSource(options.source)
            const playlistId = String(id || '')
            const token = createPlaylistHydrationToken(playlistId)
            this.playlistHydrationToken = token
            this.playlistHydrationPromise = null
            this.playlistHydration = createPlaylistHydrationState({
                id: playlistId,
                total: 0,
                loaded: 0,
                status: 'loading',
                source,
            })

            const params = {
                id: playlistId,
                limit: PLAYLIST_PAGE_SIZE,
                offset: 0,
            }
            try {
                const [playlistDetailResult, playlistTrackResult, playlistDynamicResult] = await Promise.all([
                    getPlaylistDetail(params),
                    getPlaylistAll(params),
                    playlistDynamic(playlistId),
                ])
                if (this.playlistHydrationToken != token) return

                const playlist = playlistDetailResult?.playlist || null
                const firstBatchSongs = mapSongsPlayableStatus(playlistTrackResult?.songs || [], playlistTrackResult?.privileges || []) || []
                const totalTracks = Number(playlist?.trackIds?.length || firstBatchSongs.length || 0)
                const loadedTracks = Math.min(firstBatchSongs.length, totalTracks)

                this.libraryInfo = playlist
                this.librarySongs = firstBatchSongs
                this.indexLibrarySongs(firstBatchSongs)
                if (this.libraryInfo) this.libraryInfo.followed = !!playlistDynamicResult?.subscribed

                if (totalTracks <= loadedTracks) {
                    this.playlistHydration = createPlaylistHydrationState({
                        id: playlistId,
                        total: totalTracks,
                        loaded: loadedTracks,
                        status: 'completed',
                        source,
                    })
                    this.libraryChangeAnimation = false
                    this.cacheCurrentLibraryDetail(playlistId, 'playlist', source)
                    return
                }

                this.playlistHydration = createPlaylistHydrationState({
                    id: playlistId,
                    total: totalTracks,
                    loaded: loadedTracks,
                    status: 'loading',
                    source,
                })

                const hydrationTask = this.startPlaylistHydrationTask(playlistId, totalTracks, token, loadedTracks, source)
                this.libraryChangeAnimation = false
                if (!deferRemaining) await hydrationTask
            } catch (error) {
                if (this.playlistHydrationToken == token) {
                    this.playlistHydration = createPlaylistHydrationState({
                        id: playlistId,
                        total: 0,
                        loaded: 0,
                        status: 'failed',
                        source,
                    })
                    this.playlistHydrationPromise = null
                    this.libraryChangeAnimation = false
                }
                throw error
            }
        },
        async updateAlbumDetail(id) {
            let params = {
                id: id,
                // timestamp: new Date().getTime()
            }
            await Promise.all([getAlbumDetail(params), albumDynamic(id)]).then(results => {
                const albumDetail = results[0]
                this.libraryInfo = albumDetail.album

                const playableSongs = mapSongsPlayableStatus(albumDetail.songs) || []
                const albumCover = this.libraryInfo?.picUrl || this.libraryInfo?.blurPicUrl || null

                this.librarySongs = playableSongs.map((song = {}) => {
                    // 确保播放器在专辑场景下总能拿到封面
                    if (!song.al) song.al = {}
                    if (!song.al.picUrl && albumCover) song.al.picUrl = albumCover
                    return song
                })
                this.indexLibrarySongs(this.librarySongs)
                this.libraryInfo.followed = results[1].isSub
                this.libraryChangeAnimation = false
            })
        },
        async updateArtistDetail(id) {
            let params = {
                id: id,
                // timestamp: new Date().getTime()
            }
            await Promise.all([getArtistDetail(params), getArtistFansCount(id)]).then(async results => {
                results[0].artist.follow = results[1].data
                results[0].artist.followed = results[1].data.follow
                this.libraryInfo = results[0].artist
                
                // 获取热门歌曲的完整详情（包括封面）
                const songIds = results[0].hotSongs.map(song => song.id)
                const songDetailResult = await getSongDetail(songIds)
                
                // 使用详情API返回的完整歌曲数据
                this.librarySongs = mapSongsPlayableStatus(songDetailResult.songs)
                this.indexLibrarySongs(this.librarySongs)
                this.libraryChangeAnimation = false
            })
        },
        //获取歌手热门歌曲前50首，并更新Store数据
        async updateArtistTopSong(id) {
            let params = {
                id: id,
                // timestamp: new Date().getTime()
            }
            await getArtistTopSong(params).then(async result => {
                // 获取所有歌曲ID
                const songIds = result.songs.map(song => song.id)
                
                // 使用歌曲详情API获取完整信息（包括正确的封面）
                const songDetailResult = await getSongDetail(songIds)
                
                // 使用详情API返回的完整歌曲数据
                this.librarySongs = mapSongsPlayableStatus(songDetailResult.songs)
                this.indexLibrarySongs(this.librarySongs)
            })
        },
        //获取歌手专辑，并更新Store数据
        async updateArtistAlbum(id) {
            let params = {
                id: id,
                limit: 500,
                offset: 0
                // timestamp: new Date().getTime()
            }
            await getArtistAlbum(params).then(result => {
                this.libraryAlbum = result.hotAlbums
                this.indexLibraryAlbums(this.libraryAlbum)
            })
        },
        //获取歌手MV，并更新Store数据
        async updateArtistsMV(id) {
            let params = {
                id: id,
                limit: 500,
                offset: 0
                // timestamp: new Date().getTime()
            }
            await getArtistMV(params).then(result => {
                this.libraryMV = result.mvs
                this.indexLibraryMVs(this.libraryMV)
            })
        },
        async updateRecommendSongs(date) {
            const request = date ? getHistoryRecommendSongsDetail({ date }) : getRecommendSongs()
            await request.then(result => {
                const dailySongs = result?.data?.dailySongs || []
                const historySongs = result?.data?.songs || result?.data?.dailySongs || result?.songs || []
                const songs = date ? historySongs : dailySongs

                this.librarySongs = mapSongsPlayableStatus(songs) || []
                this.indexLibrarySongs(this.librarySongs)
            })
        },
    },
})
