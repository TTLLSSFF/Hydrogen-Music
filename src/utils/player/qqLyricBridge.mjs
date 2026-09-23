// QQ 歌曲的翻译/罗马音桥接。
//
// 背景：QQ 上游已经拿不到歌词翻译与罗马音（旧版 fcg_query_lyric_new.fcg 与 musicu.fcg 的
// PlayLyricInfo 实测 trans/roma 恒为空，翻译只在官方客户端的加密协议里）。设置项
// 「QQ 歌词翻译/罗马音匹配网易云」打开后，按「歌名 + 歌手」在网易云找同一首歌，
// **只有时间轴高度吻合**才借用它的翻译/罗马音，匹配不上就什么都不做（宁缺毋滥）。
//
// 纯逻辑（歌名归一化、候选打分、时间轴对齐回写）都在这里，网络请求由调用方注入，
// 单测可以直接喂假数据，不需要真机登录态。
// 显式带扩展名：本模块要能被 node --test 直接加载（省略扩展名是 Vite 专属写法）
import { getLyricText } from './lyricPayload.js'

// 网易云译文/罗马音的时间轴与原文基本对齐，但两端仍会有几十毫秒到几百毫秒的差异。
// 这里按容差把译文行贴到 QQ 原文行上，再用**原文的时间戳**重建译文轨道——
// 渲染层（lyricCore.buildOnlineTimeline）只认 0.12s 内的精确匹配，不重建就贴不上。
const BRIDGE_TOLERANCE_SEC = 0.45
const BRIDGE_MIN_COVERAGE = 0.7
const BRIDGE_MIN_MATCHED_LINES = 4
const BRIDGE_CANDIDATE_LIMIT = 3
const BRIDGE_TIMEOUT_MS = 8000
const TIME_TAG_PATTERN = /\[(\d{1,3})\s*[:：.]\s*(\d{1,2})(?:[.:：](\d{1,3}))?\]/g
const BRACKET_SEGMENT_PATTERN = /[（(\[【][^）)\]】]*[）)\]】]/g
const NAME_NOISE_PATTERN = /[\s\-_·・.,，。!！?？'"“”‘’:：;/／\\|]+/g
// 「 - From THE FIRST TAKE」「 | Single」这类附加说明
const SUBTITLE_SEPARATOR_PATTERN = /\s(?:[-–—]{1,2}|\||｜)\s/
const bridgeCache = new Map()

function normalizeBridgeText(value) {
    return String(value || '').trim().normalize('NFKC').toLowerCase()
}

// QQ 歌名常带「(《鬼灭之刃》TV动画片头曲)」这类后缀，网易云可能只写主标题；
// 这里去掉括号片段、分隔符后的附加说明与空白标点，只留主标题做比较。
export function normalizeBridgeSongName(value) {
    const withoutBrackets = normalizeBridgeText(value).replace(BRACKET_SEGMENT_PATTERN, ' ')
    const [head] = withoutBrackets.split(SUBTITLE_SEPARATOR_PATTERN)
    return head.replace(NAME_NOISE_PATTERN, '')
}

// 只接受主标题完全相同：包含匹配会把「Lemon」和「Lemonade」当成同一首。
export function bridgeNamesMatch(left, right) {
    const a = normalizeBridgeSongName(left)
    const b = normalizeBridgeSongName(right)
    return !!a && a === b
}

function parseBridgeTimeTag(tag) {
    const match = String(tag || '').match(/\[(\d{1,3})\s*[:：.]\s*(\d{1,2})(?:[.:：](\d{1,3}))?\]/)
    if (!match) return 0
    const minutes = parseInt(match[1] || '0', 10)
    const seconds = parseInt(match[2] || '0', 10)
    const milliseconds = match[3] ? parseInt(`${match[3]}00`.slice(0, 3), 10) : 0
    return minutes * 60 + seconds + milliseconds / 1000
}

function formatBridgeTimeTag(seconds) {
    const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
    const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, '0')
    const rest = String(Math.floor(safeSeconds % 60)).padStart(2, '0')
    const milliseconds = String(Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000)).padStart(3, '0')
    return `[${minutes}:${rest}.${milliseconds}]`
}

/** 解析带时间标签的歌词文本，同一条时间戳只保留一次（取第一条）。 */
export function parseBridgeTimedLines(text) {
    if (typeof text !== 'string' || !text) return []
    const lines = []
    const seen = new Set()
    for (const rawLine of text.split(/\r?\n/)) {
        const content = String(rawLine || '').replace(TIME_TAG_PATTERN, ' ').trim()
        if (!content) continue
        const tags = String(rawLine).match(TIME_TAG_PATTERN)
        if (!tags) continue
        for (const tag of tags) {
            const time = parseBridgeTimeTag(tag)
            const key = time.toFixed(3)
            if (seen.has(key)) continue
            seen.add(key)
            lines.push({ time, text: content })
        }
    }
    return lines.sort((left, right) => left.time - right.time)
}

/**
 * 把候选译文按「最近时间戳」贴到基准歌词上，用基准的时间戳重建轨道。
 * 覆盖率过低（不同版本/不同剪辑）或命中行太少时返回 null，调用方保持原样。
 */
export function buildAlignedLyricTrack(baseLyricText, candidateTrackText, options = {}) {
    const toleranceSec = Number(options.toleranceSec) > 0 ? Number(options.toleranceSec) : BRIDGE_TOLERANCE_SEC
    const minCoverage = Number(options.minCoverage) >= 0 ? Number(options.minCoverage) : BRIDGE_MIN_COVERAGE
    const minMatched = Number(options.minMatchedLines) > 0 ? Math.floor(options.minMatchedLines) : BRIDGE_MIN_MATCHED_LINES

    const baseLines = parseBridgeTimedLines(baseLyricText)
    const candidateLines = parseBridgeTimedLines(candidateTrackText)
    if (!baseLines.length || !candidateLines.length) return null

    const bestByBase = new Map()
    for (const candidate of candidateLines) {
        let bestIndex = -1
        let bestDelta = toleranceSec
        for (let index = 0; index < baseLines.length; index += 1) {
            const delta = Math.abs(baseLines[index].time - candidate.time)
            if (delta <= bestDelta) {
                bestDelta = delta
                bestIndex = index
            }
        }
        if (bestIndex < 0) continue
        const held = bestByBase.get(bestIndex)
        if (!held || bestDelta < held.delta) bestByBase.set(bestIndex, { delta: bestDelta, text: candidate.text })
    }

    const matched = bestByBase.size
    const coverage = matched / baseLines.length
    if (matched < minMatched || coverage < minCoverage) {
        return { lyric: '', matched, total: baseLines.length, coverage }
    }

    const lyric = baseLines
        .map((line, index) => {
            const held = bestByBase.get(index)
            return held ? `${formatBridgeTimeTag(line.time)}${held.text}` : ''
        })
        .filter(Boolean)
        .join('\n')

    return { lyric, matched, total: baseLines.length, coverage }
}

/** 从网易云歌曲列表里挑同名同歌手的候选，按歌名命中、歌手命中、时长接近排序。 */
export function pickNeteaseLyricCandidate(songs, { name, artist, durationSec = 0 } = {}) {
    const list = Array.isArray(songs) ? songs.filter(item => item && (item.id || item.songId)) : []
    if (!list.length) return null

    const targetArtist = normalizeBridgeText(artist)
    let best = null
    for (const item of list) {
        const candidateName = item.name || item.songName || ''
        if (!bridgeNamesMatch(name, candidateName)) continue

        const artists = Array.isArray(item.ar) ? item.ar : (Array.isArray(item.artists) ? item.artists : [])
        const candidateArtists = artists.map(entry => normalizeBridgeText(entry?.name || entry)).filter(Boolean)
        const artistHit = !!targetArtist && candidateArtists.some(value => (
            value === targetArtist || value.includes(targetArtist) || targetArtist.includes(value)
        ))
        const exactName = normalizeBridgeSongName(name) === normalizeBridgeSongName(candidateName)
        const candidateDuration = Number(item.dt || item.duration || 0)
        const durationDelta = durationSec > 0 && candidateDuration > 0
            ? Math.abs(candidateDuration / 1000 - durationSec)
            : Number.POSITIVE_INFINITY

        const score = [
            artistHit ? 4 : 0,
            exactName ? 2 : 0,
            durationDelta <= 3 ? 2 : (durationDelta <= 8 ? 1 : 0),
        ].reduce((total, value) => total + value, 0)

        if (!best || score > best.score || (score === best.score && durationDelta < best.durationDelta)) {
            best = { song: item, id: String(item.id || item.songId), score, artistHit, durationDelta }
        }
    }
    return best
}

function hasBridgeTracks(payload) {
    return !!(getLyricText(payload?.tlyric).trim() || getLyricText(payload?.romalrc).trim())
}

function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('qq-lyric-bridge-timeout')), timeoutMs)
        Promise.resolve(promise)
            .then(value => {
                clearTimeout(timer)
                resolve(value)
            })
            .catch(error => {
                clearTimeout(timer)
                reject(error)
            })
    })
}

export function getQQNeteaseLyricBridgeCacheKey(song) {
    const key = String(song?.sourceId || song?.songmid || song?.mid || song?.id || '').trim()
    return key ? `qq-bridge:${key}` : ''
}

export function clearQQNeteaseLyricBridgeCache() {
    bridgeCache.clear()
}

/**
 * 桥接主流程：找候选 → 拉候选歌词 → 时间轴对齐 → 合并到 QQ 歌词上。
 * 返回新的歌词对象（含 tlyric/romalrc）或 null（保持 QQ 原样）。
 * 请求函数注入，单测直接喂假数据；任何失败都安静退化为 null。
 */
export async function bridgeQQNeteaseLyricTracks({
    song,
    payload,
    searchCandidates,
    fetchCandidateLyric,
    isActive = () => true,
    force = false,
} = {}) {
    if (!payload || typeof payload !== 'object') return null
    if (hasBridgeTracks(payload)) return null
    const cacheKey = getQQNeteaseLyricBridgeCacheKey(song)
    // 缓存里只存「借来的两条轨道」，不存整份歌词：同一次会话里同一个 mid 的歌词应该一致，
    // 但这样即使外部换了 payload 也不会把旧歌词一起带出去。
    if (!force && cacheKey && bridgeCache.has(cacheKey)) {
        const cachedTracks = await bridgeCache.get(cacheKey)
        return cachedTracks ? { ...payload, ...cachedTracks } : null
    }
    if (typeof searchCandidates !== 'function' || typeof fetchCandidateLyric !== 'function') {
        throw new TypeError('QQ lyric bridge loaders are required')
    }

    const baseLyricText = getLyricText(payload.lrc)
    if (!baseLyricText.trim()) return null

    const songName = String(song?.name || song?.songName || '').trim()
    const songArtists = Array.isArray(song?.ar) ? song.ar : (Array.isArray(song?.artists) ? song.artists : [])
    const artistName = String(
        songArtists[0]?.name
        || song?.artist
        || song?.artistsName
        || '',
    ).trim()

    const run = async () => {
        let candidates = []
        try {
            candidates = await withTimeout(searchCandidates({ name: songName, artist: artistName }), BRIDGE_TIMEOUT_MS)
        } catch (_) {
            return null
        }
        if (!isActive()) return null

        const ranked = []
        let remaining = Array.isArray(candidates) ? candidates.slice() : []
        for (let attempt = 0; attempt < BRIDGE_CANDIDATE_LIMIT && remaining.length; attempt += 1) {
            const picked = pickNeteaseLyricCandidate(remaining, {
                name: songName,
                artist: artistName,
                durationSec: Number(song?.dt || song?.duration || 0) / 1000,
            })
            if (!picked) break
            ranked.push(picked)
            remaining = remaining.filter(item => String(item?.id || item?.songId) !== picked.id)
        }

        for (const candidate of ranked) {
            let candidateLyric = null
            try {
                candidateLyric = await withTimeout(fetchCandidateLyric(candidate.id), BRIDGE_TIMEOUT_MS)
            } catch (_) {
                continue
            }
            if (!isActive()) return null
            if (!candidateLyric || typeof candidateLyric !== 'object') continue
            if (!hasBridgeTracks(candidateLyric)) continue

            const merged = {}
            let applied = false
            for (const [field, source] of [['tlyric', candidateLyric.tlyric], ['romalrc', candidateLyric.romalrc]]) {
                const trackText = getLyricText(source)
                if (!trackText.trim()) continue
                const aligned = buildAlignedLyricTrack(baseLyricText, trackText)
                if (!aligned?.lyric) continue
                merged[field] = { lyric: aligned.lyric }
                applied = true
            }
            if (!applied) continue
            // 只回借来的两条轨道；调用方把它们并到自己的歌词对象上，下游 renderer 直接消费 tlyric/romalrc。
            return merged
        }
        return null
    }

    const promise = run().catch(() => null)
    if (cacheKey) bridgeCache.set(cacheKey, promise)
    const tracks = await promise
    return tracks ? { ...payload, ...tracks } : null
}