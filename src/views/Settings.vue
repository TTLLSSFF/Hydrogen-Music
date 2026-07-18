<script setup>
import { computed, ref, onActivated, onBeforeUnmount, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import { noticeOpen, dialogOpen } from '@/utils/dialog'
import { applySettingsSnapshot, initSettings } from '@/utils/initApp'
import { getVipInfo } from '@/api/user'
import { isLogin } from '@/utils/authority'
import { useUserStore } from '@/store/userStore'
import { usePlayerStore } from '@/store/playerStore'
import Selector from '../components/Selector.vue'
import FontSelector from '../components/FontSelector.vue'
import UpdateDialog from '../components/UpdateDialog.vue'
import { setTheme, getSavedTheme } from '@/utils/theme'
import { confirmAccountLogout } from '@/utils/accountSession'
import { getSettingsSnapshot, setCachedSettingsSnapshot, setSettingsSnapshot } from '@/utils/settingsSnapshot'
import { applyCustomFontStyle, syncDesktopLyricCustomFont } from '@/utils/setFont'
import { buildFontOptions, loadSystemFontOptions, resolveSystemFontLabel, resolveSystemFontValue } from '@/utils/fontResolver'
import settingsSchema from '@/shared/settingsSchema.js'
import { version } from '../../package.json'

const { MUSIC_LEVEL_OPTIONS, normalizeSettings } = settingsSchema

const router = useRouter()
const userStore = useUserStore()
const playerStore = usePlayerStore()

const vipInfo = ref(null)
const musicLevel = ref('lossless')
const musicLevelOptions = ref(MUSIC_LEVEL_OPTIONS.map(option => ({ ...option })))
const lyricSize = ref(20)
const tlyricSize = ref(13)
const rlyricSize = ref(12)
const lyricInterlude = ref(13)
const searchAssistLimit = ref(8)
const theme = ref('system')
const themeOptions = ref([
    { label: '跟随系统', value: 'system' },
    { label: '浅色', value: 'light' },
    { label: '深色', value: 'dark' },
])
const shortcutsList = ref(null)
const customFont = ref('')
const customFontLabel = ref('')
const systemFonts = ref([])
const systemFontsLoading = ref(false)
let systemFontsLoadPromise = null

const fontOptions = computed(() =>
    buildFontOptions({
        systemFonts: systemFonts.value,
        customFont: customFont.value,
        customFontLabel: customFontLabel.value,
    })
)

// 更新相关状态
const showUpdateDialog = ref(false)
const newVersion = ref('')
let updateListenersInitialized = false
let removeUpdateListeners = null
const PERFORMANCE_CONFIRM_MESSAGE = '开启后此功能会消耗一定性能且可能造成卡顿，确定开启吗？'
const GAPLESS_CONFIRM_MESSAGE = '开启后会提前预缓冲下一首音频，可能增加网络流量和内存占用，确定开启吗？'

const loadVipInfo = async () => {
    const requestUserId = userStore.user?.userId
    if (!requestUserId || !isLogin()) {
        vipInfo.value = null
        return
    }

    try {
        const result = await getVipInfo()
        if (userStore.user?.userId != requestUserId) return
        vipInfo.value = result?.data || null
    } catch (error) {
        if (userStore.user?.userId != requestUserId) return
        console.error('加载 VIP 信息失败:', error)
        vipInfo.value = null
    }
}

const applySettingsToForm = settings => {
    if (!settings) return
    const normalizedSettings = normalizeSettings(settings)
    musicLevel.value = normalizedSettings.music.level
    lyricSize.value = normalizedSettings.music.lyricSize
    tlyricSize.value = normalizedSettings.music.tlyricSize
    rlyricSize.value = normalizedSettings.music.rlyricSize
    lyricInterlude.value = normalizedSettings.music.lyricInterlude
    searchAssistLimit.value = normalizedSettings.music.searchAssistLimit
    playerStore.showSongTranslation = normalizedSettings.music.showSongTranslation !== false
    playerStore.gaplessPlayback = normalizedSettings.music.gaplessPlayback === true
    playerStore.audioVisualizer = normalizedSettings.music.audioVisualizer === true
    shortcutsList.value = normalizedSettings.shortcuts
    customFont.value = normalizedSettings.other.customFont
    customFontLabel.value = normalizedSettings.other.customFontLabel
}

onActivated(() => {
    void getSettingsSnapshot().then(applySettingsToForm)
    void loadSystemFonts()

    // Initialize theme selection
    try {
        theme.value = getSavedTheme()
    } catch (_) {
        theme.value = 'system'
    }

    void loadVipInfo()

    // 设置更新事件监听器
    setupUpdateListeners()
})

// 当从“首页/子页”切换到“主播放器界面”（widgetState: true -> false）时，
// 如果当前仍处于设置路由，则自动保存设置（避免未发生路由切换导致 onBeforeRouteLeave 不触发）。
watch(
    () => playerStore.widgetState,
    (now, prev) => {
        try {
            const isLeavingToPlayer = prev === true && now === false
            const inSettings = router.currentRoute.value?.name === 'settings'
            if (isLeavingToPlayer && inSettings) {
                saveSettings()
                noticeOpen('设置已保存', 2)
            }
        } catch (_) {
            // ignore
        }
    }
)

// 设置更新监听器
const setupUpdateListeners = () => {
    if (updateListenersInitialized) return
    updateListenersInitialized = true
    // 监听手动更新检查结果（不显示大窗弹出）
    if (typeof windowApi !== 'undefined' && windowApi?.manualUpdateAvailable) {
        removeUpdateListeners = windowApi.manualUpdateAvailable(version => {
            newVersion.value = version
            // 手动检查时直接在UpdateDialog中显示结果，不触发大窗弹出
        })
    }
}

onBeforeUnmount(() => {
    removeUpdateListeners?.()
    removeUpdateListeners = null
    updateListenersInitialized = false
})

watch(
    () => userStore.user?.userId ?? null,
    (nextUserId, previousUserId) => {
        if (nextUserId === previousUserId) return
        if (!nextUserId) {
            vipInfo.value = null
            return
        }
        void loadVipInfo()
    }
)

const setAppSettings = () => {
    const settings = {
        music: {
            level: musicLevel.value,
            lyricSize: lyricSize.value,
            tlyricSize: tlyricSize.value,
            rlyricSize: rlyricSize.value,
            lyricInterlude: lyricInterlude.value,
            searchAssistLimit: searchAssistLimit.value,
            showSongTranslation: playerStore.showSongTranslation,
            gaplessPlayback: playerStore.gaplessPlayback,
            audioVisualizer: playerStore.audioVisualizer,
        },
        shortcuts: shortcutsList.value,
        other: {
            customFont: customFont.value,
            customFontLabel: customFont.value ? customFontLabel.value : '',
        },
    }

    const normalizedSettings = normalizeSettings(settings)
    const snapshot = typeof windowApi !== 'undefined' && windowApi?.setSettings ? setCachedSettingsSnapshot(normalizedSettings) : setSettingsSnapshot(normalizedSettings)
    if (typeof windowApi !== 'undefined' && windowApi?.setSettings) {
        windowApi.setSettings(JSON.stringify(normalizedSettings))
    }
    applySettingsSnapshot(snapshot, { hydrateLocalMusic: false })
    return snapshot
}

const saveSettings = () => {
    initSettings({ settings: setAppSettings(), hydrateLocalMusic: true })
}

const setCustomFont = (font, option = null) => {
    const rawFont = typeof font === 'string' ? font : customFont.value
    const resolvedFont = resolveSystemFontValue(rawFont)
    const fallbackLabel = option?.label || customFontLabel.value || rawFont
    const resolvedLabel = resolvedFont ? String(resolveSystemFontLabel(resolvedFont, fallbackLabel, systemFonts.value)).trim() : ''
    const appliedFont = applyCustomFontStyle(resolvedFont, resolvedLabel)
    customFont.value = appliedFont
    customFontLabel.value = appliedFont ? resolvedLabel : ''
}

const refreshCustomFont = () => {
    if (customFont.value) setCustomFont(customFont.value)
    return systemFonts.value
}

const loadSystemFonts = async () => {
    if (systemFonts.value.length > 0) {
        return refreshCustomFont()
    }
    if (systemFontsLoadPromise) return systemFontsLoadPromise

    systemFontsLoading.value = true
    systemFontsLoadPromise = loadSystemFontOptions()
        .then(fonts => {
            systemFonts.value = Array.isArray(fonts) ? fonts : []
            return refreshCustomFont()
        })
        .finally(() => {
            systemFontsLoading.value = false
            systemFontsLoadPromise = null
        })

    return systemFontsLoadPromise
}

// apply theme immediately when user changes
watch(theme, val => setTheme(val))

onBeforeRouteLeave((to, from, next) => {
    saveSettings()
    next()
    noticeOpen('设置已保存', 2)
})

const routerChange = () => {
    router.back()
}



const formatShortcutName = name => {
    return name
        .replaceAll('+', ' + ')
        .replace('Up', '↑')
        .replace('Down', '↓')
        .replace('Right', '→')
        .replace('Left', '←')
        .replace('Space', '空格')
        .replace('Numpad', '')
        .replace('num', '')
        .replace('CommandOrControl', 'Ctrl')
        .replace('Control', 'Ctrl')
}
const togglePlayerFlag = key => {
    playerStore[key] = !playerStore[key]
}
const setConfirmedPlayerFlag = (key, message) => {
    if (playerStore[key]) {
        togglePlayerFlag(key)
        return
    }
    dialogOpen('确定开启', message, flag => {
        if (flag) togglePlayerFlag(key)
    })
}
const setLyricBlur = () => setConfirmedPlayerFlag('lyricBlur', PERFORMANCE_CONFIRM_MESSAGE)
const setCoverBlur = () => setConfirmedPlayerFlag('coverBlur', PERFORMANCE_CONFIRM_MESSAGE)
const setGaplessPlayback = () => setConfirmedPlayerFlag('gaplessPlayback', GAPLESS_CONFIRM_MESSAGE)
const setAudioVisualizer = () => setConfirmedPlayerFlag('audioVisualizer', PERFORMANCE_CONFIRM_MESSAGE)
const confirmLogout = () => {
    confirmAccountLogout(router)
}
const save = () => {
    setCustomFont()
    saveSettings()
    noticeOpen('设置已保存', 2)
}
const toGithub = () => {
    const url = 'https://github.com/ldx123000/Hydrogen-Music'
    if (typeof windowApi !== 'undefined' && windowApi?.toRegister) {
        windowApi.toRegister(url)
    } else {
        window.open(url, '_blank')
    }
}

// 检查更新功能
const checkForUpdates = () => {
    showUpdateDialog.value = true
    if (typeof windowApi !== 'undefined' && windowApi?.checkForUpdate) {
        windowApi.checkForUpdate()
    } else {
        noticeOpen('网页版暂不支持自动更新', 2)
    }
}

// 更新对话框事件处理
const handleUpdateDownload = () => {
    if (typeof windowApi !== 'undefined' && windowApi?.downloadUpdate) {
        windowApi.downloadUpdate()
    }
}

const handleUpdateInstall = () => {
    if (typeof windowApi !== 'undefined' && windowApi?.installUpdate) {
        windowApi.installUpdate()
    }
}

const handleUpdateCancel = () => {
    if (typeof windowApi !== 'undefined' && windowApi?.cancelUpdate) {
        windowApi.cancelUpdate()
    }
}

const handleUpdateRetry = () => {
    if (typeof windowApi !== 'undefined' && windowApi?.checkForUpdate) {
        windowApi.checkForUpdate()
    } else {
        noticeOpen('网页版暂不支持自动更新', 2)
    }
}

const closeUpdateDialog = () => {
    showUpdateDialog.value = false
}

// 清空当前账号的“私人漫游”近期去重队列
const getFmRecentKey = () => {
    const uid = userStore?.user?.userId || 'guest'
    return `hm.fm.recentPlayedQueue:${uid}`
}
const clearFmRecent = () => {
    try {
        localStorage.removeItem(getFmRecentKey())
        // 通知个人FM组件刷新其内存中的近期队列
        window.dispatchEvent(new CustomEvent('fmClearRecent', { detail: { userId: userStore?.user?.userId || 'guest' } }))
        noticeOpen('已清空当前账号的私人漫游缓存', 2)
    } catch (e) {
        console.error('清空私人漫游缓存失败:', e)
        noticeOpen('清空失败', 2)
    }
}
</script>

<template>
    <div class="settings-page">
        <div class="view-control">
            <svg t="1669039513804" @click="routerChange()" class="router-last" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1053" width="200" height="200">
                <path d="M716.608 1010.112L218.88 512.384 717.376 13.888l45.248 45.248-453.248 453.248 452.48 452.48z" p-id="1054"></path>
            </svg>
            <span class="setting-title">
                设置(离开页面以保存设置或
                <span class="save" @click="save()">点击</span>
                保存)
            </span>
        </div>
        <div class="settings-container">
            <h1 class="settings-title">设置</h1>
            <div class="settings-user-info" v-if="isLogin()">
                <div class="user">
                    <div class="user-head">
                        <img :src="userStore.user.avatarUrl + '?param=300y300'" alt="" />
                    </div>
                    <div class="user-info">
                        <div class="user-name">{{ userStore.user.nickname }}</div>
                        <div class="user-vip" v-if="vipInfo && userStore.user.vipType != 0">
                            <img :src="vipInfo.redVipDynamicIconUrl" alt="" />
                        </div>
                    </div>
                </div>
                <div class="logout" @click="confirmLogout()">
                    <span>退出</span>
                </div>
            </div>
            <div class="settings">
                <div class="settings-item">
                    <h2 class="item-title">音乐</h2>
                    <div class="line"></div>
                    <div class="item-options">
                        <div class="option">
                            <div class="option-name">音质选择</div>
                            <div class="option-operation">
                                <Selector v-model="musicLevel" :options="musicLevelOptions" :maxItems="9"></Selector>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启背景封面模糊</div>
                            <div class="option-operation">
                                <div class="toggle" @click="setCoverBlur()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.coverBlur }">{{ playerStore.coverBlur ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.coverBlur"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启歌词模糊</div>
                            <div class="option-operation">
                                <div class="toggle" @click="setLyricBlur()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.lyricBlur }">{{ playerStore.lyricBlur ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.lyricBlur"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">显示歌曲翻译</div>
                            <div class="option-operation">
                                <div class="toggle" @click="playerStore.showSongTranslation = !playerStore.showSongTranslation">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.showSongTranslation }">
                                        {{ playerStore.showSongTranslation ? '已开启' : '已关闭' }}
                                    </div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.showSongTranslation"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">歌曲无缝衔接</div>
                            <div class="option-operation">
                                <div class="toggle" @click="setGaplessPlayback()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.gaplessPlayback }">{{ playerStore.gaplessPlayback ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.gaplessPlayback"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">音频可视化</div>
                            <div class="option-operation">
                                <div class="toggle" @click="setAudioVisualizer()">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': playerStore.audioVisualizer }">{{ playerStore.audioVisualizer ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="playerStore.audioVisualizer"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">搜索下拉条目数量</div>
                            <div class="option-operation">
                                <input v-model="searchAssistLimit" name="searchAssistLimit" />
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">歌词字体大小</div>
                            <div class="option-operation">
                                <input v-model="lyricSize" name="lyricSize" />
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">歌词翻译字体大小</div>
                            <div class="option-operation">
                                <input v-model="tlyricSize" name="tlyricSize" />
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">罗马歌词字体大小</div>
                            <div class="option-operation">
                                <input v-model="rlyricSize" name="rlyricSize" />
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">歌词间奏等待时间(单位：秒)</div>
                            <div class="option-operation">
                                <input v-model="lyricInterlude" name="lyricInterlude" />
                            </div>
                        </div>
                    </div>
                </div>
                <div class="settings-item">
                    <h2 class="item-title">快捷键</h2>
                    <div class="line"></div>
                    <div class="item-options">
                        <div class="shortcuts-title">
                            <div class="title-function">功能说明</div>
                            <div class="title-shortcuts">快捷键</div>
                        </div>
                        <div class="shortcuts" v-for="(item, index) in shortcutsList">
                            <div class="shortcut-name">{{ item.name }}</div>
                            <div class="shortcut">
                                {{ formatShortcutName(item.shortcut) }}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="settings-item">
                    <h2 class="item-title">其他</h2>
                    <div class="line"></div>
                    <div class="item-options">
                        <div class="option">
                            <div class="option-name">主题</div>
                            <div class="option-operation">
                                <Selector v-model="theme" :options="themeOptions"></Selector>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">自定义字体</div>
                            <div class="option-operation">
                                <FontSelector v-model="customFont" :options="fontOptions" :loading="systemFontsLoading" @open="loadSystemFonts" @change="setCustomFont"></FontSelector>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启首页页面</div>
                            <div class="option-operation">
                                <div class="toggle" @click="userStore.homePage = !userStore.homePage">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': userStore.homePage }">{{ userStore.homePage ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="userStore.homePage"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启云盘页面</div>
                            <div class="option-operation">
                                <div class="toggle" @click="userStore.cloudDiskPage = !userStore.cloudDiskPage">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': userStore.cloudDiskPage }">{{ userStore.cloudDiskPage ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="userStore.cloudDiskPage"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启私人漫游页面</div>
                            <div class="option-operation">
                                <div class="toggle" @click="userStore.personalFMPage = !userStore.personalFMPage">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': userStore.personalFMPage }">{{ userStore.personalFMPage ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="userStore.personalFMPage"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option">
                            <div class="option-name">开启塞壬唱片页面</div>
                            <div class="option-operation">
                                <div class="toggle" @click="userStore.sirenPage = !userStore.sirenPage">
                                    <div class="toggle-off" :class="{ 'toggle-on-in': userStore.sirenPage }">{{ userStore.sirenPage ? '已开启' : '已关闭' }}</div>
                                    <Transition name="toggle">
                                        <div class="toggle-on" v-show="userStore.sirenPage"></div>
                                    </Transition>
                                </div>
                            </div>
                        </div>
                        <div class="option" v-if="userStore.personalFMPage">
                            <div class="option-name">清空漫游缓存</div>
                            <div class="option-operation">
                                <div class="button" @click="clearFmRecent">清空</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div class="app-version">
                <div class="app-icon">
                    <img src="../assets/icon/icon.ico" alt="" />
                </div>
                <div class="version">V{{ version }}</div>
                <div class="update-check">
                    <button class="check-update-btn" @click="checkForUpdates">检查更新</button>
                </div>
                <div class="app-author" @click="toGithub()">Made by ldx123000/TTLLSSFF | Modified from Hydrogen Music</div>
            </div>
        </div>

        <!-- 更新对话框 -->
        <UpdateDialog
            :visible="showUpdateDialog"
            :new-version="newVersion"
            @close="closeUpdateDialog"
            @download="handleUpdateDownload"
            @install="handleUpdateInstall"
            @cancel="handleUpdateCancel"
            @retry="handleUpdateRetry"
        />
    </div>
</template>

<style scoped lang="scss">
.settings-page {
    width: 100%;
    height: 100%;
    .view-control {
        margin-bottom: 15px;
        margin-left: -8px;
        height: 32px;
        display: flex;
        flex-direction: row;
        align-items: center;
        svg {
            padding: 8px;
            width: 32px;
            height: 32px;
            float: left;
            transition: 0.2s;
            &:hover {
                cursor: pointer;
                opacity: 0.7;
            }
            &:active {
                transform: scale(0.9);
            }
        }
        .router-last {
            margin-right: 5px;
        }
        .setting-title {
            font: 17px SourceHanSansCN-Bold;
            color: black;
            .save {
                font-size: 15px;
                padding: 6px;
                background-color: rgba(255, 255, 255, 0.35);
                transition: 0.1s;
                &:hover {
                    cursor: pointer;
                    opacity: 0.8;
                }
                &:active {
                    opacity: 0.5;
                }
            }
        }
    }
    .settings-container {
        margin: 0 auto;
        padding-bottom: 140px;
        width: 80%;
        height: calc(100% - 47px);
        overflow: auto;
        &::-webkit-scrollbar {
            display: none;
        }
        .settings-title {
            font-family: SourceHanSansCN-Bold;
            color: black;
            text-align: left;
        }
        .settings-user-info {
            padding: 10px 40px;
            width: 100%;
            height: 100px;
            background-color: rgba(255, 255, 255, 0.35);
            display: flex;
            flex-direction: row;
            align-items: center;
            justify-content: space-between;
            .user {
                display: flex;
                flex-direction: row;
                align-items: center;
                .user-head {
                    margin-right: 15px;
                    width: 70px;
                    height: 70px;
                    border-radius: 50%;
                    overflow: hidden;
                    img {
                        width: 100%;
                        height: 100%;
                    }
                }
                .user-info {
                    .user-name {
                        font: 20px Source Han Sans;
                        font-weight: bold;
                        color: black;
                    }
                    .user-vip {
                        width: 40px;
                        img {
                            width: 100%;
                        }
                    }
                }
            }
            .logout {
                font: 14px SourceHanSansCN-Bold;
                font-weight: bold;
                color: black;
                transition: 0.2s;
                &:hover {
                    cursor: pointer;
                }
                &:active {
                    transform: scale(0.95);
                }
            }
        }
        .settings {
            width: 100%;
            .settings-item {
                margin-top: 45px;
                width: 100%;
                .item-title {
                    margin: 0;
                    font: 20px SourceHanSansCN-Bold;
                    color: black;
                    font-family: SourceHanSansCN-Bold;
                    color: black;
                    text-align: left;
                }
                .line {
                    margin-top: 8px;
                    margin-bottom: 25px;
                    width: 100%;
                    height: 0.5px;
                    background-color: rgba(0, 0, 0, 0.2);
                }
                .item-options {
                    outline: none;
                    .option {
                        margin-bottom: 32px;
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        justify-content: space-between;
                        .option-name {
                            font-family: SourceHanSansCN-Bold;
                            font-size: 16px;
                            color: black;
                            text-align: left;
                        }
                        input,
                        .selector {
                            margin-right: 1px;
                            width: 200px;
                            height: 34px;
                            padding: 5px 1px;
                            background-color: transparent;
                            color: black;
                            border: none;
                            outline: none;
                            appearance: none;
                            font: 13px SourceHanSansCN-Bold;
                            text-align: center;
                            transition: 0.2s;
                            &:hover {
                                cursor: pointer;
                                opacity: 0.8;
                                box-shadow: none;
                            }
                        }
                        select {
                            padding: 8px 10px;
                        }
                        option {
                            background-color: rgba(255, 255, 255, 0.35);
                            border: none;
                            outline: none;
                        }
                        .toggle {
                            margin-right: 1px;
                            height: 34px;
                            width: 200px;
                            position: relative;
                            overflow: hidden;
                            &:hover {
                                cursor: pointer;
                            }
                            .toggle-on,
                            .toggle-off {
                                padding: 5px 10px;
                                width: 100%;
                                height: 100%;
                                font: 13px SourceHanSansCN-Bold;
                                transition: 0.2s;
                                line-height: 24px;
                            }
                            .toggle-off {
                                background-color: rgba(255, 255, 255, 0.35);
                            }
                            .toggle-on {
                                background-color: black;
                                position: absolute;
                                top: 0;
                                left: 0;
                                z-index: -1;
                            }
                            .toggle-on-in {
                                color: white;
                                background-color: transparent;
                            }
                        }
                        .button {
                            margin-right: 1px;
                            padding: 5px 10px;
                            width: 200px;
                            background-color: rgba(255, 255, 255, 0.35);
                            font: 13px SourceHanSansCN-Bold;
                            &:hover {
                                cursor: pointer;
                                opacity: 0.8;
                                box-shadow: 0 0 0 1px black;
                            }
                        }
                        .select-download-folder {
                            display: flex;
                            flex-direction: row;
                            align-items: center;
                            .selected-folder {
                                width: 50vw;
                                height: 30px;
                                background-color: rgba(255, 255, 255, 0.35);
                                font: 13px SourceHanSansCN-Bold;
                                color: black;
                                line-height: 30px;
                                overflow: hidden;
                            }
                            .select-option {
                                margin-right: 2px;
                                margin-left: 15px;
                                padding: 5px 15px;
                                font: 13px SourceHanSansCN-Bold;
                                color: black;
                                background-color: rgba(255, 255, 255, 0.35);
                                transition: 0.2s;
                                &:hover {
                                    cursor: pointer;
                                    opacity: 0.8;
                                    box-shadow: 0 0 0 1px black;
                                }
                            }
                        }
                        .local-folder {
                            display: flex;
                            flex-direction: row;
                            align-items: center;
                            .selected-local-folder-item {
                                display: flex;
                                flex-direction: column;
                                .selected-folder {
                                    margin-bottom: 10px;
                                    width: 50vw;
                                    height: 30px;
                                    background-color: rgba(255, 255, 255, 0.35);
                                    font: 13px SourceHanSansCN-Bold;
                                    color: black;
                                    line-height: 30px;
                                    overflow: hidden;
                                }
                                .tip {
                                    font: 10px SourceHanSansCN-Bold;
                                    color: black;
                                    text-align: left;
                                }
                            }
                            .add-option {
                                margin-right: 2px;
                                margin-left: 15px;
                                padding: 5px 15px;
                                font: 13px SourceHanSansCN-Bold;
                                color: black;
                                background-color: rgba(255, 255, 255, 0.35);
                                transition: 0.2s;
                                &:hover {
                                    cursor: pointer;
                                    opacity: 0.8;
                                    box-shadow: 0 0 0 1px black;
                                }
                            }
                        }
                    }
                    .forbid-shortcuts {
                        opacity: 0.5;
                        pointer-events: none;
                    }
                    .shortcuts-title {
                        font: 14px SourceHanSansCN-Bold;
                        color: black;
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        text-align: left;
                        div {
                            margin-right: 15px;
                            padding: 0 6px;
                        }
                        .title-function {
                            min-width: 130px;
                        }
                        .title-shortcuts,
                        .title-globalShortcuts {
                            min-width: 200px;
                        }
                    }
                    .shortcuts {
                        font: 14px SourceHanSansCN-Bold;
                        color: black;
                        display: flex;
                        flex-direction: row;
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        text-align: left;
                        div {
                            margin-top: 15px;
                            margin-right: 15px;
                            padding: 6px;
                            background-color: rgba(255, 255, 255, 0.35);
                        }
                        .shortcut-name {
                            min-width: 130px;
                            background-color: transparent;
                        }
                        .shortcut,
                        .globalShortcut {
                            min-width: 200px;
                            &:hover {
                                cursor: pointer;
                            }
                        }
                        .shortcut-selected {
                            box-shadow: 0 0 0 1px black;
                        }
                    }
                    .default-shortcuts {
                        margin-top: 15px;
                        margin-left: 1px;
                        width: 120px;
                        padding: 6px;
                        background-color: rgba(255, 255, 255, 0.35);
                        font: 14px SourceHanSansCN-Bold;
                        transition: 0.2s;
                        color: black;
                        &:hover {
                            cursor: pointer;
                            box-shadow: 0 0 0 1px black;
                        }
                    }
                }
            }
        }
        .app-version {
            display: flex;
            flex-direction: column;
            align-items: center;
            .app-icon {
                margin-bottom: 10px;
                width: 65px;
                height: 65px;
                img {
                    width: 100%;
                    height: 100%;
                }
            }
            .version {
                font: 14px Geometos;
                color: black;
            }
            .update-check {
                margin: 8px 0;

                .check-update-btn {
                    padding: 5px 15px;
                    background-color: rgba(255, 255, 255, 0.35);
                    color: black;
                    border: none;
                    border-radius: 0;
                    outline: none;
                    font: 13px SourceHanSansCN-Bold;
                    cursor: pointer;
                    transition: 0.2s;

                    &:hover {
                        opacity: 0.8;
                        box-shadow: 0 0 0 1px black;
                    }

                    &:focus {
                        outline: none;
                        border-radius: 0;
                        box-shadow: 0 0 0 1px black;
                    }

                    &:active {
                        outline: none;
                        border-radius: 0;
                        box-shadow: 0 0 0 1px black;
                    }
                }
            }
            .app-author {
                margin-top: 10px;
                font: 14px Bender-Bold;
                color: black;
                &:hover {
                    cursor: pointer;
                    text-decoration: underline;
                }
            }
        }
    }
}
.toggle-enter-active,
.toggle-leave-active {
    transition: 0.1s;
}
.toggle-enter-from,
.toggle-leave-to {
    transform: translateX(-100%);
}
</style>
