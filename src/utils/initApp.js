import { usePlayerStore } from '../store/playerStore'
import { useLocalStore } from '../store/localStore'
import { useUserStore } from '../store/userStore'
import { storeToRefs } from 'pinia'
import { getPreferredQuality } from './quality'
import { initializeCurrentAccountSession } from './accountSession'
import { hasStoredBiliSession, migrateLegacyBiliSession } from './biliSession'
import { migrateLegacyAuthSession } from './authority'
import { getSettingsSnapshot, setCachedSettingsSnapshot, setSettingsSnapshot } from './settingsSnapshot'
import { initPlayerExternalBridge, loadLastSong } from './player/lazy'
import { applyCustomFontStyle, syncDesktopLyricCustomFont } from './setFont'
import { resolveSystemFontOptionAsync, resolveSystemFontValueAsync } from './fontResolver'
import { resolveInitialHifiOutputMode } from './hifiOutputModeMigration'
import settingsSchema from '../shared/settingsSchema.js'
import { qqAccountStore } from '../store/qqAccountStore'

const { normalizeSettings } = settingsSchema

const playerStore = usePlayerStore()
const { quality, lyricSize, tlyricSize, rlyricSize, lyricInterludeTime, searchAssistLimit, showSongTranslation, qqNeteaseLyricBridge, gaplessPlayback, audioVisualizer, localHifiOutput, localHifiOutputMode, localHifiMpvPath, localHifiAudioDevice } = storeToRefs(playerStore)
const localStore = useLocalStore()
const userStore = useUserStore()

let baseInitPromise = null
let deferredInitPromise = null
let deferredInitScheduled = false
let mediaSessionInitialized = false
let sirenDurationPreloadScheduled = false
let lastSongRestoreScheduled = false
let localMusicModulePromise = null
let customFontResolveToken = 0

// 桌面端能力检测：网页端没有 preload 暴露的 windowApi，所有桌面调用都必须先判断，
// 否则网页构建在运行时（而非构建时）会因 windowApi 未定义而报错。
function hasDesktopApi(name) {
    return typeof windowApi !== 'undefined' && !!windowApi && (typeof name !== 'string' || typeof windowApi[name] === 'function')
}

function loadLocalMusicModule() {
    if (!localMusicModulePromise) localMusicModulePromise = import('./locaMusic')
    return localMusicModulePromise
}

function scanMusicDeferred(options) {
    if (!hasDesktopApi('scanLocalMusic')) return
    void loadLocalMusicModule()
        .then(({ scanMusic }) => scanMusic(options))
        .catch(error => {
            console.error('本地音乐扫描模块加载失败:', error)
        })
}

const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? callback => window.requestIdleCallback(callback, { timeout: 1000 })
    : callback => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 500)

function applyLocalSettings(settings, { hydrateLocalMusic = false } = {}) {
    const nextDownloadFolder = settings?.local?.downloadFolder || null
    const nextLocalFolders = Array.isArray(settings?.local?.localFolder) ? settings.local.localFolder : []

    localStore.downloadedFolderSettings = nextDownloadFolder
    localStore.localFolderSettings = nextLocalFolders
    localStore.quitApp = settings?.other?.quitApp

    if (nextLocalFolders.length === 0 && localStore.localMusicFolder) {
        localStore.localMusicFolder = null
        localStore.localMusicList = null
        localStore.localMusicClassify = null
        localStore.lookupIndex = {
            ...localStore.lookupIndex,
            localFoldersByName: {},
            albumsById: {},
            artistsById: {},
            songSearchByScope: {
                ...localStore.lookupIndex.songSearchByScope,
                local: {},
            },
        }
        if (hasDesktopApi('clearLocalMusicData')) windowApi.clearLocalMusicData('local')
    } else if (hydrateLocalMusic && nextLocalFolders.length !== 0 && !localStore.localMusicFolder) {
        scanMusicDeferred({ type: 'local', refresh: false })
    }
}

export function applySettingsSnapshot(settings, options = {}) {
    if (!settings) return null

    const normalizedSettings = setCachedSettingsSnapshot(normalizeSettings(settings))
    quality.value = getPreferredQuality(normalizedSettings?.music?.level)
    lyricSize.value = normalizedSettings?.music?.lyricSize
    tlyricSize.value = normalizedSettings?.music?.tlyricSize
    rlyricSize.value = normalizedSettings?.music?.rlyricSize
    lyricInterludeTime.value = normalizedSettings?.music?.lyricInterlude
    searchAssistLimit.value = normalizedSettings?.music?.searchAssistLimit
    showSongTranslation.value = normalizedSettings?.music?.showSongTranslation !== false
    qqNeteaseLyricBridge.value = normalizedSettings?.music?.qqNeteaseLyricBridge === true
    gaplessPlayback.value = normalizedSettings?.music?.gaplessPlayback === true
    audioVisualizer.value = normalizedSettings?.music?.audioVisualizer === true
    localHifiOutput.value = normalizedSettings?.music?.localHifiOutput === true
    localHifiOutputMode.value = resolveInitialHifiOutputMode(normalizedSettings?.music?.localHifiOutputMode)
    localHifiMpvPath.value = normalizedSettings?.music?.localHifiMpvPath || ''
    localHifiAudioDevice.value = normalizedSettings?.music?.localHifiAudioDevice || 'auto'
    applyCustomFontSetting(normalizedSettings)

    applyLocalSettings(normalizedSettings, options)
    return normalizedSettings
}

function persistResolvedCustomFont(settings, resolvedCustomFont, resolvedCustomFontLabel = '') {
    if (!settings || !resolvedCustomFont) return

    const previousOther = settings.other || {}
    const previousCustomFont = previousOther.customFont || ''
    const previousCustomFontLabel = previousOther.customFontLabel || ''
    const customFontLabel = resolvedCustomFontLabel || previousCustomFontLabel || previousCustomFont
    if (
        previousCustomFont === resolvedCustomFont
        && previousCustomFontLabel === customFontLabel
    ) return

    const nextSettings = normalizeSettings({
        ...settings,
        other: {
            ...previousOther,
            customFont: resolvedCustomFont,
            customFontLabel,
        },
    })

    // setSettingsSnapshot 内部会按平台选择写入方式（桌面走 windowApi、网页走 localStorage）。
    setSettingsSnapshot(nextSettings)
}

function applyCustomFontSetting(settings) {
    const customFont = settings?.other?.customFont
    const customFontLabel = settings?.other?.customFontLabel || ''
    const insertedFont = applyCustomFontStyle(customFont, customFontLabel)
    const token = ++customFontResolveToken

    if (!insertedFont) {
        syncDesktopLyricCustomFont('', '')
        return
    }

    const needsDisplayLabelResolve = !customFontLabel || customFontLabel === insertedFont
    const resolveFont = needsDisplayLabelResolve
        ? resolveSystemFontOptionAsync(insertedFont, customFontLabel || insertedFont)
        : resolveSystemFontValueAsync(insertedFont).then(value => ({ value, label: customFontLabel }))

    void resolveFont
        .then(({ value: resolvedFont, label: resolvedFontLabel }) => {
            if (token !== customFontResolveToken) return
            if (!resolvedFont) return

            applyCustomFontStyle(resolvedFont, resolvedFontLabel)
            syncDesktopLyricCustomFont(resolvedFont, resolvedFontLabel)
            persistResolvedCustomFont(settings, resolvedFont, resolvedFontLabel)
        })
        .catch(() => {})
}

export async function initSettings(options = {}) {
    const settings = options.settings || await getSettingsSnapshot({ forceReload: options.forceReload === true })
    const shouldHydrateLocalMusic = options.hydrateLocalMusic !== false
    return applySettingsSnapshot(settings, { hydrateLocalMusic: shouldHydrateLocalMusic })
}

function restoreLastSongOnce() {
    if (lastSongRestoreScheduled) return
    lastSongRestoreScheduled = true
    void loadLastSong().catch(error => {
        lastSongRestoreScheduled = false
        console.error('恢复上次播放失败:', error)
    })
}

function resetStartupPlayerState() {
    if (playerStore.listInfo && playerStore.listInfo.type === 'personalfm') {
        playerStore.listInfo = null
        playerStore.songList = null
        playerStore.currentIndex = 0
        playerStore.songId = null
    }
}

async function ensureMediaSessionReady() {
    if (mediaSessionInitialized) return

    try {
        const { initMediaSession } = await import('./mediaSession')
        initMediaSession()
        mediaSessionInitialized = true
    } catch (_) {}
}

function scheduleSirenDurationPreload() {
    if (sirenDurationPreloadScheduled || !userStore.sirenPage) return
    sirenDurationPreloadScheduled = true

    idle(async () => {
        try {
            const { useSirenStore } = await import('../store/sirenStore')
            const sirenStore = useSirenStore()
            await sirenStore.preloadAllDurations()
        } catch (_) {}
    })
}

async function runBaseAppInit() {
    migrateLegacyAuthSession()
    migrateLegacyBiliSession()
    if (!hasStoredBiliSession() && userStore.biliUser) {
        userStore.clearBiliAccountState()
    }

    await initPlayerExternalBridge()
    await initSettings({ hydrateLocalMusic: false })
    resetStartupPlayerState()
}

function ensureBaseAppInit() {
    if (!baseInitPromise) {
        baseInitPromise = runBaseAppInit().catch(error => {
            baseInitPromise = null
            throw error
        })
    }

    return baseInitPromise
}

async function runDeferredAppInit() {
    await ensureBaseAppInit()
    const settings = await initSettings({ hydrateLocalMusic: true })
    const mediaSessionReadyPromise = ensureMediaSessionReady()

    if (!userStore.localOnlyMode) {
        try {
            await initializeCurrentAccountSession()
        } catch (error) {
            console.error('用户信息加载失败:', error)
        }
    }

    try {
        await qqAccountStore.restoreSession()
    } catch (_) {}

    restoreLastSongOnce()

    if (!userStore.localOnlyMode) scheduleSirenDurationPreload()
    await mediaSessionReadyPromise
    return settings
}

export function ensureDeferredAppInit() {
    if (!deferredInitPromise) {
        deferredInitPromise = runDeferredAppInit().catch(error => {
            deferredInitPromise = null
            throw error
        })
    }

    return deferredInitPromise
}

export function scheduleDeferredAppInit() {
    if (deferredInitScheduled) return
    deferredInitScheduled = true

    idle(() => {
        void ensureDeferredAppInit()
    })
}

export const init = async () => {
    await ensureBaseAppInit()
    scheduleDeferredAppInit()
}