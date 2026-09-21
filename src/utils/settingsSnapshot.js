import { getDefaultSettings, normalizeSettings } from '../shared/settingsSchema.js'

const SETTINGS_STORAGE_KEY = 'hydrogen-music-settings'

let cachedSettings = null
let inflightSettingsPromise = null

function cloneSettings(settings) {
    if (!settings || typeof settings !== 'object') return null

    try {
        if (typeof structuredClone === 'function') {
            return structuredClone(settings)
        }
    } catch (_) {}

    try {
        return JSON.parse(JSON.stringify(settings))
    } catch (_) {
        return settings
    }
}

export function getCachedSettingsSnapshot() {
    return cloneSettings(cachedSettings)
}

export function setCachedSettingsSnapshot(settings) {
    cachedSettings = cloneSettings(settings)
    return getCachedSettingsSnapshot()
}

export function clearCachedSettingsSnapshot() {
    cachedSettings = null
    inflightSettingsPromise = null
}

// 桌面端由 preload 暴露 windowApi，设置读写走主进程；网页端没有该 API，回退到 localStorage。
function hasDesktopSettingsApi() {
    return typeof windowApi !== 'undefined' && !!windowApi && typeof windowApi.getSettings === 'function'
}

function readStoredSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (parsed && typeof parsed === 'object') return parsed
        }
    } catch (error) {
        console.error('读取本地设置失败:', error)
    }
    return getDefaultSettings()
}

function readSettingsFromSource() {
    if (hasDesktopSettingsApi()) {
        return Promise.resolve(windowApi.getSettings())
    }
    return readStoredSettings()
}

function writeStoredSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    } catch (error) {
        console.error('保存本地设置失败:', error)
    }
}

export async function getSettingsSnapshot(options = {}) {
    const forceReload = options.forceReload === true

    if (!forceReload && cachedSettings) {
        return getCachedSettingsSnapshot()
    }

    if (!forceReload && inflightSettingsPromise) {
        return inflightSettingsPromise
    }

    inflightSettingsPromise = Promise.resolve()
        .then(() => readSettingsFromSource())
        // 与默认值合并（normalizeSettings 会补齐缺失字段并做清洗），保证各端拿到结构一致的设置。
        .then(settings => normalizeSettings(settings && typeof settings === 'object' ? settings : {}))
        .then(settings => {
            cachedSettings = cloneSettings(settings)
            return getCachedSettingsSnapshot()
        })
        .finally(() => {
            inflightSettingsPromise = null
        })

    return inflightSettingsPromise
}

export function setSettingsSnapshot(settings) {
    const normalized = normalizeSettings(settings)
    setCachedSettingsSnapshot(normalized)
    writeStoredSettings(normalized)
    if (typeof windowApi !== 'undefined' && !!windowApi && typeof windowApi.setSettings === 'function') {
        try {
            windowApi.setSettings(JSON.stringify(normalized))
        } catch (error) {
            console.error('保存桌面设置失败:', error)
        }
    }
    return getCachedSettingsSnapshot()
}
