import { getPreferredQuality } from './quality'
import { resolveDownloadPlaybackInfo } from './player/lazy'
import { getSongDisplayName } from './songName'
import { isQQSong } from './providerPolicy.mjs'
import pinia from '../store/pinia'
import { useDownloadStore } from '../store/downloadStore'

const DOWNLOAD_PUSH_DELAY_MS = 650

const DOWNLOAD_ERROR_TEXT = {
    'missing-url': '下载地址缺失',
    'missing download url': '无法解析下载地址',
    // QQ 拿不到 purl：上游没有会员权限或该曲目无版权，与普通 HTTP 失败区分开
    qqDownloadUnavailable: '该歌曲暂无可用下载地址（付费或版权限制）',
    noSavePath: '未设置下载目录',
    invalidDownloadUrl: '下载地址无效',
    downloadWindowUnavailable: '下载窗口不可用',
    'download-stream-unavailable': '下载流不可用',
    timeout: '下载超时',
    cancelled: '已取消',
    downloadFailed: '下载失败',
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function sanitizeFileName(value, fallback = 'Hydrogen Music') {
    const text = String(value || fallback)
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return (text || fallback).slice(0, 120)
}

function inferAudioExtension(playbackInfo = {}) {
    const rawType = playbackInfo.trackInfo?.type || playbackInfo.trackInfo?.encodeType || ''
    const normalizedType = String(rawType || '').replace(/^\./, '').trim().toLowerCase()
    if (/^[a-z0-9]{1,8}$/.test(normalizedType)) return normalizedType

    try {
        const pathname = new URL(playbackInfo.url || '').pathname || ''
        const matched = pathname.match(/\.([a-z0-9]+)$/i)
        if (matched?.[1]) return matched[1].toLowerCase()
    } catch (_) {
        const matched = String(playbackInfo.url || '').match(/\.([a-z0-9]+)(?:\?|#|$)/i)
        if (matched?.[1]) return matched[1].toLowerCase()
    }

    // 地址没有后缀时退回请求档位（QQ 的 trackInfo 常为空，只靠 URL 猜不可靠）
    const quality = String(playbackInfo.quality || '').toLowerCase()
    if (quality === 'flac' || quality === 'ape') return 'flac'

    return playbackInfo.isSiren ? 'mp3' : 'mp3'
}

export function buildDownloadFileName(song, playbackInfo = {}) {
    const title = sanitizeFileName(getSongDisplayName(song, song?.name || 'Hydrogen Music', false))
    const artists = Array.isArray(song?.ar)
        ? song.ar.map(artist => artist?.name).filter(Boolean).join(', ')
        : ''
    const artistPart = artists ? ` - ${sanitizeFileName(artists, '')}` : ''
    return `${title}${artistPart}.${inferAudioExtension(playbackInfo)}`
}

function getSongArtists(song) {
    if (Array.isArray(song?.ar)) return song.ar.map(artist => artist?.name).filter(Boolean)
    if (Array.isArray(song?.artists)) return song.artists.map(artist => artist?.name || artist).filter(Boolean)
    return []
}

function getSongAlbum(song) {
    return song?.al?.name || song?.album?.name || song?.album?.title || ''
}

function describeDownloadError(error) {
    const code = error?.code || error?.message || ''
    if (DOWNLOAD_ERROR_TEXT[code]) return DOWNLOAD_ERROR_TEXT[code]
    if (typeof code === 'string' && code.trim()) return code
    return '下载失败'
}

function createDownloadTaskId(song, index) {
    const rawId = song?.id ?? song?.songId ?? ''
    if (rawId !== '' && rawId !== null && rawId !== undefined) return String(rawId)
    return `download-${Date.now()}-${index}`
}

// 桌面端（Electron）保存到设置里的下载目录；网页端交给 /download-proxy 流式代理。
export function isDesktopDownloadAvailable() {
    return typeof windowApi !== 'undefined'
        && !!windowApi
        && typeof windowApi.downloadToFolder === 'function'
}

let downloadStore = null
function getDownloadStore() {
    if (!downloadStore) downloadStore = useDownloadStore(pinia)
    return downloadStore
}

let progressListenerReady = false
function ensureDownloadProgressListener(store) {
    if (progressListenerReady) return
    if (typeof windowApi === 'undefined' || typeof windowApi.onDownloadProgress !== 'function') return
    progressListenerReady = true
    windowApi.onDownloadProgress(payload => {
        if (!payload || typeof payload !== 'object') return
        store.updateDownloadProgress(payload.id, payload.progress)
    })
}

async function buildLyricPayload(song) {
    try {
        const { getLyricWithCloudFallback } = await import('./player/lyricFallback')
        const lyric = await getLyricWithCloudFallback(song)
        const payload = {
            id: song?.id ?? null,
            lrc: lyric?.lrc?.lyric || null,
            tlyric: lyric?.tlyric?.lyric || null,
            romalrc: lyric?.romalrc?.lyric || null,
        }
        if (!payload.lrc && !payload.tlyric && !payload.romalrc) return null
        return payload
    } catch (error) {
        console.warn('获取下载歌词失败:', error?.message || error)
        return null
    }
}

// 网页端无法在浏览器本地写 ID3/FLAC 标签：先把元数据 POST 给服务端换成一次性 token，
// 下载时由 /download-proxy 落盘写标签后再回传文件。换 token 失败就退回无标签下载。
async function requestDownloadTagToken(metadata) {
    if (!metadata || typeof metadata !== 'object') return ''
    if (!metadata.name && !metadata.album && !metadata.coverUrl && !metadata.lyrics) return ''

    try {
        const response = await fetch('/download-tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(metadata),
        })
        if (!response.ok) return ''
        const data = await response.json()
        return typeof data?.token === 'string' ? data.token : ''
    } catch (error) {
        console.warn('注册下载标签失败:', error?.message || error)
        return ''
    }
}

export async function pushBrowserDownload(url, filename, metadata = null) {
    if (!url) return { ok: false, error: 'missing-url' }

    if (isDesktopDownloadAvailable()) {
        try {
            const payload = { url, filename, ...(metadata && typeof metadata === 'object' ? metadata : {}) }
            const result = await windowApi.downloadToFolder(payload)
            if (result && result.ok) return { ok: true, path: result.path }
            return { ok: false, error: result?.error || 'downloadFailed' }
        } catch (error) {
            return { ok: false, error: error?.message || 'downloadFailed' }
        }
    }

    const tagToken = await requestDownloadTagToken(metadata)

    const link = document.createElement('a')
    const downloadUrl = new URL('/download-proxy', window.location.origin)
    downloadUrl.searchParams.set('url', url)
    if (filename) downloadUrl.searchParams.set('filename', filename)
    if (tagToken) downloadUrl.searchParams.set('tags', tagToken)

    link.href = downloadUrl.toString()
    link.download = filename || ''
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return { ok: true }
}

export async function pushSongsToBrowserDownloads(songs, requestedQuality, options = {}) {
    const list = Array.isArray(songs) ? songs.filter(Boolean) : []
    const quality = getPreferredQuality(requestedQuality)
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const desktopMode = isDesktopDownloadAvailable()
    const store = desktopMode ? getDownloadStore() : null
    if (store) {
        store.resetCancelAll()
        ensureDownloadProgressListener(store)
    }
    const result = {
        total: list.length,
        success: 0,
        failed: 0,
        skipped: 0,
        failures: [],
        mode: desktopMode ? 'desktop' : 'web',
    }

    for (let index = 0; index < list.length; index += 1) {
        if (store?.cancelAllRequested) break

        const song = list[index]
        if (song?.type === 'local') {
            result.skipped += 1
            result.failures.push({ song, reason: 'local' })
            onProgress?.({ ...result, index, song, status: 'skipped' })
            continue
        }

        const taskId = createDownloadTaskId(song, index)
        if (store) {
            store.beginDownload({
                id: taskId,
                name: song?.name || '',
                tns: song?.tns || song?.transNames || null,
                artists: getSongArtists(song),
                album: getSongAlbum(song),
            })
        }

        try {
            const playbackInfo = await resolveDownloadPlaybackInfo(song, quality)
            if (!playbackInfo?.url) {
                // QQ 没有 purl 通常意味着付费/无版权，给一条可操作的提示而不是通用的解析失败
                throw new Error(isQQSong(song) ? 'qqDownloadUnavailable' : 'missing download url')
            }

            // 元数据两端都要用：桌面端交给主进程写标签，网页端换成 token 交给服务端写标签。
            const metadata = {
                id: taskId,
                name: song?.name || '',
                type: inferAudioExtension(playbackInfo),
                artists: getSongArtists(song),
                album: getSongAlbum(song),
                coverUrl: song?.coverUrl || song?.al?.picUrl || null,
                lyrics: await buildLyricPayload(song),
            }

            const outcome = await pushBrowserDownload(
                playbackInfo.url,
                buildDownloadFileName(song, playbackInfo),
                metadata,
            )
            if (!outcome?.ok) throw new Error(outcome?.error || 'download failed')
            result.success += 1
            if (store) store.finishDownload(taskId, { status: 'success', path: outcome.path })
            onProgress?.({ ...result, index, song, status: 'success', playbackInfo })
        } catch (error) {
            console.error('下载歌曲失败:', error)
            result.failed += 1
            result.failures.push({ song, reason: error })
            if (store) store.finishDownload(taskId, { status: 'failed', reason: describeDownloadError(error) })
            onProgress?.({ ...result, index, song, status: 'failed', error })
        }

        if (index < list.length - 1) await sleep(DOWNLOAD_PUSH_DELAY_MS)
    }

    return result
}