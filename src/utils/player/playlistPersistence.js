// 播放队列与播放进度的本地持久化。
// 桌面端由 preload 暴露 windowApi，读写交给 Electron 主进程的 electron-store；
// 网页端没有主进程，退化成 localStorage 兜底。两边语义保持一致：
// 队列与进度分开存放、进度单独更新，避免每隔几秒就重写整份队列。
const WEB_PLAYLIST_STORAGE_KEY = 'hydrogen:last-playlist'
const WEB_PROGRESS_STORAGE_KEY = 'hydrogen:last-playback-progress'
// localStorage 容量约 5MB 且写入是同步的：超大队列（上万首）既不落盘，
// 也避免每次切歌都序列化数 MB JSON 造成卡顿。超限时顺手清掉旧记录，
// 否则下次会恢复出一份过期队列。
const WEB_PLAYLIST_MAX_SONGS = 2000
const WEB_PLAYLIST_MAX_BYTES = 4 * 1024 * 1024

function hasDesktopPlaylistApi() {
    return typeof windowApi !== 'undefined' && !!windowApi && typeof windowApi.getLastPlaylist === 'function'
}

function readWebJson(key) {
    try {
        const raw = localStorage.getItem(key)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch (_) {
        return null
    }
}

function writeWebJson(key, value) {
    const json = typeof value === 'string' ? value : JSON.stringify(value)
    if (!json) return false

    try {
        localStorage.setItem(key, json)
        return true
    } catch (_) {
        // 容量超限或存储不可用：清掉旧记录，避免下次恢复到过期数据
        try { localStorage.removeItem(key) } catch (_) {}
        return false
    }
}

function clearWebPlaybackStorage() {
    try {
        localStorage.removeItem(WEB_PLAYLIST_STORAGE_KEY)
        localStorage.removeItem(WEB_PROGRESS_STORAGE_KEY)
    } catch (_) {}
}

function parsePlaylistPayload(playlist) {
    if (playlist && typeof playlist === 'object') return playlist
    if (typeof playlist !== 'string') return null

    try {
        const parsed = JSON.parse(playlist)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch (_) {
        return null
    }
}

// 与主进程的 normalizeStoredProgress 保持一致
function normalizeWebProgress(progressState) {
    if (!progressState || typeof progressState !== 'object') return null

    const progress = Number(progressState.progress)
    const currentIndex = Number(progressState.currentIndex)
    return {
        progress: Number.isFinite(progress) && progress >= 0 ? progress : 0,
        songId: progressState.songId ?? null,
        currentIndex: Number.isFinite(currentIndex) && currentIndex >= 0 ? Math.floor(currentIndex) : 0,
        updatedAt: Date.now(),
    }
}

// 与主进程的 mergeStoredPlaybackProgress 保持一致
function mergeWebProgress(playlist) {
    const progressState = readWebJson(WEB_PROGRESS_STORAGE_KEY)
    if (!playlist || !progressState) return playlist

    return {
        ...playlist,
        progress: progressState.progress,
        songId: progressState.songId,
        currentIndex: progressState.currentIndex,
        updatedAt: progressState.updatedAt,
    }
}

export async function loadStoredPlaylist() {
    if (!hasDesktopPlaylistApi()) {
        return mergeWebProgress(readWebJson(WEB_PLAYLIST_STORAGE_KEY))
    }

    try {
        const playlist = await windowApi.getLastPlaylist()
        if (!playlist || typeof playlist !== 'object') return null
        return playlist
    } catch (_) {
        return null
    }
}

export function saveStoredPlaylist(playlist) {
    if (!hasDesktopPlaylistApi()) {
        const parsedPlaylist = parsePlaylistPayload(playlist)
        if (!parsedPlaylist) return

        const songCount = Array.isArray(parsedPlaylist.songList) ? parsedPlaylist.songList.length : 0
        if (songCount > WEB_PLAYLIST_MAX_SONGS) {
            clearWebPlaybackStorage()
            return
        }

        const json = JSON.stringify(parsedPlaylist)
        if (!json || json.length > WEB_PLAYLIST_MAX_BYTES) {
            clearWebPlaybackStorage()
            return
        }

        writeWebJson(WEB_PLAYLIST_STORAGE_KEY, json)
        writeWebJson(WEB_PROGRESS_STORAGE_KEY, JSON.stringify(normalizeWebProgress(parsedPlaylist)))
        return
    }

    try {
        windowApi.saveLastPlaylist(JSON.stringify(playlist))
    } catch (_) {}
}

export function saveStoredPlaybackProgress(progressState) {
    if (!hasDesktopPlaylistApi()) {
        writeWebJson(WEB_PROGRESS_STORAGE_KEY, JSON.stringify(normalizeWebProgress(progressState)))
        return
    }

    try {
        windowApi.saveLastPlaybackProgress?.(progressState)
    } catch (_) {}
}

export function persistPlaylistBeforeExit(playlist) {
    if (!hasDesktopPlaylistApi()) {
        // 网页端没有「退出应用」，只把当前队列落盘
        saveStoredPlaylist(playlist)
        return
    }

    try {
        windowApi.exitApp(JSON.stringify(playlist))
    } catch (_) {}
}