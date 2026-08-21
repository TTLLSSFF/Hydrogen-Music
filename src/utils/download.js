import { getPreferredQuality } from './quality'
import { resolveDownloadPlaybackInfo } from './player/lazy'
import { getSongDisplayName } from './songName'

const DOWNLOAD_PUSH_DELAY_MS = 650

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

export function pushBrowserDownload(url, filename) {
    if (!url) return false

    const link = document.createElement('a')
    const downloadUrl = new URL('/download-proxy', window.location.origin)
    downloadUrl.searchParams.set('url', url)
    if (filename) downloadUrl.searchParams.set('filename', filename)

    link.href = downloadUrl.toString()
    link.download = filename || ''
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    return true
}

export async function pushSongsToBrowserDownloads(songs, requestedQuality, options = {}) {
    const list = Array.isArray(songs) ? songs.filter(Boolean) : []
    const quality = getPreferredQuality(requestedQuality)
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
    const result = {
        total: list.length,
        success: 0,
        failed: 0,
        skipped: 0,
        failures: [],
    }

    for (let index = 0; index < list.length; index += 1) {
        const song = list[index]
        if (song?.type === 'local') {
            result.skipped += 1
            result.failures.push({ song, reason: 'local' })
            onProgress?.({ ...result, index, song, status: 'skipped' })
            continue
        }

        try {
            const playbackInfo = await resolveDownloadPlaybackInfo(song, quality)
            if (!playbackInfo?.url) throw new Error('missing download url')

            pushBrowserDownload(playbackInfo.url, buildDownloadFileName(song, playbackInfo))
            result.success += 1
            onProgress?.({ ...result, index, song, status: 'success', playbackInfo })
        } catch (error) {
            console.error('下载歌曲失败:', error)
            result.failed += 1
            result.failures.push({ song, reason: error })
            onProgress?.({ ...result, index, song, status: 'failed', error })
        }

        if (index < list.length - 1) await sleep(DOWNLOAD_PUSH_DELAY_MS)
    }

    return result
}
