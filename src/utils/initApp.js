import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { storeToRefs } from 'pinia'
import { getPreferredQuality } from './quality'
import { initializeCurrentAccountSession } from './accountSession'
import { hasStoredBiliSession, migrateLegacyBiliSession } from './biliSession'
import { migrateLegacyAuthSession } from './authority'
import { getSettingsSnapshot, setCachedSettingsSnapshot, setSettingsSnapshot } from './settingsSnapshot'
import { initPlayerExternalBridge, loadLastSong } from './player/lazy'
import { applyCustomFontStyle } from './setFont'
import settingsSchema from '../shared/settingsSchema.js'

const { normalizeSettings } = settingsSchema

const playerStore = usePlayerStore()
const { quality, lyricSize, tlyricSize, rlyricSize, lyricInterludeTime, searchAssistLimit, showSongTranslation, gaplessPlayback } = storeToRefs(playerStore)
const userStore = useUserStore()

let baseInitPromise = null
let deferredInitPromise = null
let deferredInitScheduled = false
let mediaSessionInitialized = false
let sirenDurationPreloadScheduled = false
let lastSongRestoreScheduled = false
let customFontResolveToken = 0

const idle = typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
    ? callback => window.requestIdleCallback(callback, { timeout: 1000 })
    : callback => setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 500)

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
    gaplessPlayback.value = normalizedSettings?.music?.gaplessPlayback === true
    applyCustomFontSetting(normalizedSettings)

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

    setSettingsSnapshot(nextSettings)
}

function applyCustomFontSetting(settings) {
    const customFont = settings?.other?.customFont
    const customFontLabel = settings?.other?.customFontLabel || ''
    applyCustomFontStyle(customFont, customFontLabel)
    const token = ++customFontResolveToken

    if (!customFont) return

    const resolvedFont = customFont.trim()
    const resolvedFontLabel = (customFontLabel || resolvedFont).trim()
    if (token !== customFontResolveToken) return
    if (!resolvedFont) return

    applyCustomFontStyle(resolvedFont, resolvedFontLabel)
    persistResolvedCustomFont(settings, resolvedFont, resolvedFontLabel)
}

export async function initSettings(options = {}) {
    const settings = options.settings || await getSettingsSnapshot({ forceReload: options.forceReload === true })
    return applySettingsSnapshot(settings)
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
    await initSettings({})
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
    const settings = await initSettings({})
    const mediaSessionReadyPromise = ensureMediaSessionReady()

    try {
        await initializeCurrentAccountSession()
    } catch (error) {
        console.error('用户信息加载失败:', error)
    } finally {
        restoreLastSongOnce()
    }

    scheduleSirenDurationPreload()
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
