import { startMusic, pauseMusic, playLast, playNext, changeProgress } from './player/lazy'
import { usePlayerStore } from '../store/playerStore'
import { getSettingsSnapshot } from './settingsSnapshot'

const playerStore = usePlayerStore()

const SHORTCUT_ACTIONS = {
    play: async () => {
        if (playerStore.playing) {
            await pauseMusic()
        } else {
            await startMusic()
        }
    },
    last: async () => {
        await playLast()
    },
    next: async () => {
        await playNext()
    },
    volumeUp: () => {
        playerStore.volume = Math.min(1, playerStore.volume + 0.1)
    },
    volumeDown: () => {
        playerStore.volume = Math.max(0, playerStore.volume - 0.1)
    },
    processForward: async () => {
        await changeProgress(playerStore.progress + 3)
    },
    processBack: async () => {
        await changeProgress(playerStore.progress - 3)
    },
}

let shortcutsMap = new Map()
let isEnabled = true

function parseShortcut(shortcutStr) {
    if (!shortcutStr || typeof shortcutStr !== 'string') return null
    
    const parts = shortcutStr.split('+')
    const keyMap = new Map()
    
    for (const part of parts) {
        const normalized = part.trim()
        if (!normalized) continue
        
        if (normalized === 'CommandOrControl') {
            keyMap.set('ctrl', true)
        } else if (['Control', 'Ctrl'].includes(normalized)) {
            keyMap.set('ctrl', true)
        } else if (normalized === 'Shift') {
            keyMap.set('shift', true)
        } else if (normalized === 'Alt') {
            keyMap.set('alt', true)
        } else {
            keyMap.set('key', normalized)
        }
    }
    
    if (!keyMap.has('key')) return null
    
    return keyMap
}

function matchShortcut(event, keyMap) {
    if (!keyMap) return false
    
    const ctrl = keyMap.get('ctrl')
    const shift = keyMap.get('shift')
    const alt = keyMap.get('alt')
    const key = keyMap.get('key')
    
    if (ctrl && !event.ctrlKey && !event.metaKey) return false
    if (shift && !event.shiftKey) return false
    if (alt && !event.altKey) return false
    
    let eventKey = event.key
    let eventCode = event.code
    
    if (/^Key[A-Z]$/.test(eventCode)) {
        eventKey = eventCode.slice(4).toLowerCase()
    } else if (/^Digit[0-9]$/.test(eventCode)) {
        eventKey = eventCode.slice(5)
    } else if (/^Numpad[0-9]$/.test(eventCode)) {
        eventKey = 'num' + eventCode.slice(6)
    } else if (/^Arrow(Up|Down|Left|Right)$/.test(eventCode)) {
        eventKey = eventCode.slice(5)
    }
    
    if (key.length === 1) {
        return eventKey.toLowerCase() === key.toLowerCase()
    }
    
    return eventKey === key || eventCode === key || event.key === key
}

async function loadShortcuts() {
    try {
        const settings = await getSettingsSnapshot()
        const shortcuts = settings?.shortcuts || []
        
        shortcutsMap = new Map()
        
        for (const shortcut of shortcuts) {
            if (shortcut.id && shortcut.shortcut) {
                const keyMap = parseShortcut(shortcut.shortcut)
                if (keyMap) {
                    shortcutsMap.set(shortcut.id, keyMap)
                }
            }
        }
    } catch (error) {
        console.error('加载快捷键配置失败:', error)
    }
}

async function handleKeyDown(event) {
    if (!isEnabled) return
    
    const target = event.target
    const tagName = String(target?.tagName || '').toLowerCase()
    
    if (['input', 'textarea', 'select'].includes(tagName) || target?.isContentEditable) {
        return
    }
    
    for (const [actionId, keyMap] of shortcutsMap) {
        if (matchShortcut(event, keyMap)) {
            const action = SHORTCUT_ACTIONS[actionId]
            if (action) {
                event.preventDefault()
                await action()
                return
            }
        }
    }
}

export function initKeyboardShortcuts() {
    void loadShortcuts()
    window.addEventListener('keydown', handleKeyDown)
}

export function destroyKeyboardShortcuts() {
    window.removeEventListener('keydown', handleKeyDown)
}

export function reloadKeyboardShortcuts() {
    void loadShortcuts()
}

export function setKeyboardShortcutsEnabled(enabled) {
    isEnabled = enabled
}