import { defineStore } from "pinia";
import { watch } from "vue";
import pinia from "./pinia";

function readInitialProgress() {
    try {
        if (typeof localStorage === 'undefined') return 0
        const raw = localStorage.getItem('playerStore')
        if (!raw) return 0
        const parsed = JSON.parse(raw)
        const progress = Number(parsed?.progress)
        return Number.isFinite(progress) && progress > 0 ? progress : 0
    } catch (_) {
        return 0
    }
}

function normalizePersistedVolume(value) {
    const volume = Number(value)
    if (!Number.isFinite(volume)) return 0.3
    if (volume > 1 && volume <= 100) return volume / 100
    return Math.max(0, Math.min(1, volume))
}

function normalizePlayerStorePayload(key, value) {
    if (key !== 'playerStore' || typeof value !== 'string' || !value) return value

    try {
        const parsed = JSON.parse(value)
        if (!parsed || typeof parsed !== 'object' || parsed.volume === undefined) return value

        const normalizedVolume = normalizePersistedVolume(parsed.volume)
        if (normalizedVolume === parsed.volume) return value

        return JSON.stringify({
            ...parsed,
            volume: normalizedVolume,
        })
    } catch (_) {
        return value
    }
}

function createDedupedLocalStorage() {
    const lastValues = new Map()
    const getStorage = () => typeof localStorage === 'undefined' ? null : localStorage

    return {
        getItem(key) {
            const storage = getStorage()
            if (!storage) return null

            const value = normalizePlayerStorePayload(key, storage.getItem(key))
            lastValues.set(key, value)
            return value
        },
        setItem(key, value) {
            const storage = getStorage()
            if (!storage) return

            const nextValue = String(value)
            const previousValue = lastValues.has(key)
                ? lastValues.get(key)
                : storage.getItem(key)

            if (previousValue === nextValue) return

            storage.setItem(key, nextValue)
            lastValues.set(key, nextValue)
        },
        removeItem(key) {
            const storage = getStorage()
            if (!storage) return

            storage.removeItem(key)
            lastValues.delete(key)
        },
    }
}

const playerPersistStorage = createDedupedLocalStorage()

// 播放器持久化字段（对应旧 pinia-plugin-persistedstate 的 pick 清单，结构保持不变：
// 同一 key「playerStore」下只存这些字段，不含巨大队列以免拖垮序列化性能）。
const PERSISTED_PLAYER_FIELDS = ['volume','playMode','shuffleIndex','listInfo','songId','currentIndex','time','quality','lyricType','lyricLineOffsets','musicVideo','lyricBlur','showSongTranslation','qqNeteaseLyricBridge','gaplessPlayback','coverBlur','audioVisualizer','localHifiOutput','localHifiOutputMode','localHifiMpvPath','localHifiAudioDevice']

function readPersistedPlayerState() {
    try {
        if (typeof localStorage === 'undefined') return {}
        const raw = playerPersistStorage.getItem('playerStore')
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (_) {
        return {}
    }
}

function toPositiveInteger(value, fallback = 0) {
    return Number.isInteger(value) && value >= 0 ? value : fallback
}

function toBoolean(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback
}

export const usePlayerStore = defineStore('playerStore', {
    state: () => {
        const persisted = readPersistedPlayerState()
        return {
            widgetState: true,//是否开启widget
            currentMusic: null,//播放列表的索引
            playing: false,//是否正在播放
            progress: readInitialProgress(),//进度条
            volume: normalizePersistedVolume(persisted.volume),//音量
            // volumeBeforeMuted: 0,//静音前音量
            playMode: [0,1,2,3].includes(Number(persisted.playMode)) ? Number(persisted.playMode) : 0,//0为顺序播放，1为列表循环，2为单曲循环，3为随机播放
            listInfo: persisted.listInfo && typeof persisted.listInfo === 'object' && !Array.isArray(persisted.listInfo) ? persisted.listInfo : null,
            songList: null,//播放列表
            shuffledList: null,//随机播放列表
            shuffleIndex: toPositiveInteger(persisted.shuffleIndex),//随机播放列表的索引
            songId: typeof persisted.songId === 'string' && persisted.songId ? persisted.songId : null,
            currentIndex: toPositiveInteger(persisted.currentIndex),
            time: Number.isFinite(Number(persisted.time)) && Number(persisted.time) > 0 ? Number(persisted.time) : 0, //歌曲总时长
            quality: typeof persisted.quality === 'string' && persisted.quality ? persisted.quality : null,
            playlistWidgetShow: false,
            playerChangeSong: false, //player页面切换歌曲更换歌名动画,
            lyric: null,
            lyricsObjArr: null,
            currentLyricIndex: -1, // 当前歌词索引，用于桌面歌词同步
            lyricLineOffsets: persisted.lyricLineOffsets && typeof persisted.lyricLineOffsets === 'object' && !Array.isArray(persisted.lyricLineOffsets) ? persisted.lyricLineOffsets : {}, // 按歌曲保存的逐行歌词时间偏移
            lyricSize: null,
            tlyricSize: null,
            rlyricSize: null,
            lyricType: Array.isArray(persisted.lyricType) ? persisted.lyricType : ['original'],
            lyricInterludeTime: null, //歌词间奏等待时间
            searchAssistLimit: 8, //搜索下拉面板显示数量
            lyricShow: false, //歌词是否显示
            lyricEle: null,//歌词DOM
            isLyricDelay: true, //调整进度的时候禁止赋予delay属性
            localBase64Img: null, //如果是本地歌曲，获取封面
            forbidLastRouter: false, //在主动跳转router时禁用回到上次离开的路由的地址功能
            musicVideo: toBoolean(persisted.musicVideo, false), // 是否开启音乐视频功能
            addMusicVideo: false,
            currentMusicVideo: null,
            musicVideoDOM: null,
            videoIsPlaying: false,
            playerShow: true,
            lyricBlur: toBoolean(persisted.lyricBlur, false),
            showSongTranslation: toBoolean(persisted.showSongTranslation, true), // 歌曲名是否显示翻译（原名 (翻译)）
            qqNeteaseLyricBridge: toBoolean(persisted.qqNeteaseLyricBridge, false), // QQ 歌曲缺翻译/罗马音时是否借用网易云同曲目（时间轴对不上则不采用）
            gaplessPlayback: toBoolean(persisted.gaplessPlayback, false), // 是否预缓冲下一首以减少切歌空隙
            isDesktopLyricOpen: false, // 桌面歌词是否打开
            coverBlur: toBoolean(persisted.coverBlur, false), // 播放页使用封面模糊背景
            audioVisualizer: toBoolean(persisted.audioVisualizer, false), // 顶部音频可视化
            localHifiOutput: toBoolean(persisted.localHifiOutput, false), // 本地音乐是否使用 HiFi 输出后端
            localHifiOutputMode: typeof persisted.localHifiOutputMode === 'string' && persisted.localHifiOutputMode ? persisted.localHifiOutputMode : 'shared', // 本地 HiFi 输出模式
            localHifiMpvPath: typeof persisted.localHifiMpvPath === 'string' ? persisted.localHifiMpvPath : '', // 自定义 MPV 可执行文件路径
            localHifiAudioDevice: typeof persisted.localHifiAudioDevice === 'string' && persisted.localHifiAudioDevice ? persisted.localHifiAudioDevice : 'auto', // MPV 音频输出设备
        }
    },
    actions: {
    },
})

let playerPersistenceStarted = false
let playerPersistenceRaf = 0

// 播放器队列（songList/shuffledList/lyricsObjArr 等）体积可能非常大，不能对整个
// playerStore 深度订阅：打开播放页切换 widgetState 会触发一次深度遍历，队列越大
// 阻塞越明显（实测 15000 首时单次深遍历约 130ms，抢走开场动画的首帧）。
// 这里改为只浅 watch 少量持久化字段：状态恢复在校验 state 初值时同步完成，
// 写入仅在这些字段变化时执行，与旧的 pinia-plugin-persistedstate 行为等价。
export function initPlayerPersistence() {
    if (playerPersistenceStarted) return
    playerPersistenceStarted = true

    const store = usePlayerStore(pinia)
    const scheduleWrite = () => {
        if (typeof requestAnimationFrame === 'function') {
            cancelAnimationFrame(playerPersistenceRaf)
            playerPersistenceRaf = requestAnimationFrame(() => writePersistedPlayerState())
        } else {
            setTimeout(() => writePersistedPlayerState(), 0)
        }
    }
    const writePersistedPlayerState = () => {
        playerPersistStorage.setItem('playerStore', JSON.stringify({
            volume: store.volume,
            playMode: store.playMode,
            shuffleIndex: store.shuffleIndex,
            listInfo: store.listInfo,
            songId: store.songId,
            currentIndex: store.currentIndex,
            time: store.time,
            quality: store.quality,
            lyricType: store.lyricType,
            lyricLineOffsets: store.lyricLineOffsets,
            musicVideo: store.musicVideo,
            lyricBlur: store.lyricBlur,
            showSongTranslation: store.showSongTranslation,
            qqNeteaseLyricBridge: store.qqNeteaseLyricBridge,
            gaplessPlayback: store.gaplessPlayback,
            coverBlur: store.coverBlur,
            audioVisualizer: store.audioVisualizer,
            localHifiOutput: store.localHifiOutput,
            localHifiOutputMode: store.localHifiOutputMode,
            localHifiMpvPath: store.localHifiMpvPath,
            localHifiAudioDevice: store.localHifiAudioDevice,
        }))
    }
    watch(
        () => PERSISTED_PLAYER_FIELDS.map(field => store[field]),
        scheduleWrite,
        { flush: 'post' }
    )
    // listInfo 是歌单元数据（体积小但内部会更新），单独深 watch 保持与旧行为一致
    watch(
        () => store.listInfo,
        scheduleWrite,
        { deep: true, flush: 'post' }
    )
}
