import { createApp, watch } from 'vue';
import { storeToRefs } from 'pinia';
import pinia from '../store/pinia';
import { usePlayerStore } from '../store/playerStore';
import { registerTraditionalTextRoot } from './traditionalText';
import { buildCoverBackdropCandidates } from './coverBackdrop';
import { getSongDisplayName } from './songName';
import { getIndexedSong } from './songList';
import { PLAYBACK_TICK_FAST_INTERVAL_MS, subscribePlaybackTick } from './player/playbackTicker';

// 桌面歌词支持两种宿主，共用同一份状态与同一套歌词界面：
// 1. 桌面端（Electron）：主窗口通过 window.electronAPI 控制独立的无边框置顶歌词窗口，
//    并用 IPC 把歌曲、歌词与播放进度推送给它，进度用带乱序防护的数据流驱动；
// 2. 网页端：改用 Document Picture-in-Picture（系统级置顶浮窗）承载，不支持该 API 的浏览器
//    降级为 window.open 弹窗（可拖动/缩放，但不置顶）。两种窗口都与主页面同源，且 PiP 与主页面
//    共享脚本上下文，直接把 Vue 组件挂载进歌词窗口即可复用主窗口的 Pinia 状态，无需数据推送协议。
const playerStore = usePlayerStore(pinia);

const {
    coverBlur,
    currentIndex,
    currentLyricIndex,
    isDesktopLyricOpen: isDesktopLyricOpenState,
    localBase64Img,
    lyricsObjArr,
    playing,
    progress,
    showSongTranslation,
    songId,
    songList,
    time,
    videoIsPlaying,
} = storeToRefs(playerStore);

/* ------------------------------------------------------------------ *
 * 桌面端（Electron）IPC 桥
 * ------------------------------------------------------------------ */

let stopLyricProgressTicker = null;
let songChangeTimer = null;
let progressTimer = null;
let seekSerial = 0;
let songSerial = 0;
let syncSequence = 0;
let songSyncKey = '';
let progressDragActive = false;
let bridgeInitialized = false;

const lastPayloadByType = new Map();
const DESKTOP_LYRIC_READY_PUSH_DELAY_MS = 200;

let unwatchPlaying = null;
let unwatchIsDesktopLyricOpen = null;
let unwatchSongSnapshot = null;
let unwatchProgress = null;
let unwatchCurrentLyricIndex = null;
let removeLyricDataRequestListener = null;
let removeDesktopLyricClosedListener = null;
let removePlaybackSeekedListener = null;
let removeSeekDragStartListener = null;

function normalizeDurationSeconds(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return parsed > 1000 ? parsed / 1000 : parsed;
}

function getCurrentDurationSeconds(song = getIndexedSong(songList.value, currentIndex.value)) {
    const playerDuration = normalizeDurationSeconds(time.value);
    if (playerDuration > 0) return playerDuration;

    return normalizeDurationSeconds(song?.dt || song?.duration);
}

function buildCoverBackdropPayload(song) {
    const shouldShowBackdrop = !!(song && coverBlur.value && !videoIsPlaying?.value);
    const urls = shouldShowBackdrop
        ? buildCoverBackdropCandidates(song, localBase64Img.value, { includeAlbumPicUrl: true })
        : [];

    return {
        urls,
        isSiren: shouldShowBackdrop && song?.source === 'siren',
    };
}

function clearSongChangeTimer() {
    if (!songChangeTimer) return;

    clearTimeout(songChangeTimer);
    songChangeTimer = null;
}

function clearProgressTimer() {
    if (!progressTimer) return;

    clearTimeout(progressTimer);
    progressTimer = null;
}

function stopDesktopLyricSync() {
    if (!stopLyricProgressTicker) return;
    stopLyricProgressTicker();
    stopLyricProgressTicker = null;
}

function startDesktopLyricSync() {
    stopDesktopLyricSync();
    if (!isDesktopLyricOpenState.value || !playing.value) return;

    stopLyricProgressTicker = subscribePlaybackTick(() => {
        sendLyricProgress();
    }, {
        id: 'desktop-lyric-progress',
        interval: PLAYBACK_TICK_FAST_INTERVAL_MS,
        immediate: true,
    });
}

function serializePayload(payload) {
    try {
        return JSON.stringify(payload);
    } catch (_) {
        return '';
    }
}

function pushPayload(payload, { force = false } = {}) {
    if (!window.electronAPI || !payload || !payload.type) return;

    const serialized = serializePayload(payload);
    const lastSnapshot = lastPayloadByType.get(payload.type) || null;

    if (!force && serialized && serialized === lastSnapshot) return;

    lastPayloadByType.set(payload.type, serialized);

    const synchronizedPayload = payload.type === 'settings-change'
        ? payload
        : { ...payload, syncSequence: ++syncSequence };
    window.electronAPI.updateLyricData(synchronizedPayload);
}

function getSongSyncIdentity() {
    const normalizedSongId = songId.value == null ? '' : String(songId.value);
    const normalizedCurrentIndex = Number.isInteger(currentIndex.value) ? currentIndex.value : -1;
    const nextKey = `${normalizedSongId}:${normalizedCurrentIndex}`;
    if (nextKey !== songSyncKey) {
        songSyncKey = nextKey;
        songSerial += 1;
    }

    return {
        songId: normalizedSongId,
        songSerial,
    };
}

function buildSongChangePayload() {
    const currentSong = getIndexedSong(songList.value, currentIndex.value);
    const duration = getCurrentDurationSeconds(currentSong);
    const syncIdentity = getSongSyncIdentity();
    const currentProgress = Number(progress.value || 0);

    return {
        type: 'song-change',
        ...syncIdentity,
        progress: currentProgress,
        currentLyricIndex: Number.isInteger(currentLyricIndex.value) ? currentLyricIndex.value : -1,
        playing: !!playing.value,
        song: currentSong
            ? {
                  name: String(getSongDisplayName(currentSong, '未知歌曲', showSongTranslation.value)),
                  ar: Array.isArray(currentSong.ar)
                      ? currentSong.ar.map(artist => ({ name: String(artist?.name || '未知艺术家') }))
                      : [{ name: '未知艺术家' }],
                  type: String(currentSong.type || 'online'),
                  duration,
              }
            : null,
        duration,
        lyrics: Array.isArray(lyricsObjArr.value)
            ? lyricsObjArr.value.map(row => ({
                  lyric: String(row?.lyric || ''),
                  tlyric: String(row?.tlyric || ''),
                  rlyric: String(row?.rlyric || ''),
                  time: Number(row?.time || 0),
              }))
            : [],
        coverBackdrop: buildCoverBackdropPayload(currentSong),
    };
}

function buildPlayStatePayload() {
    return {
        type: 'play-state',
        ...getSongSyncIdentity(),
        playing: !!playing.value,
    };
}

function buildLyricProgressPayload(options = {}) {
    const currentProgress = Number(progress.value || 0);
    const duration = getCurrentDurationSeconds();

    const payload = {
        type: 'lyric-progress',
        ...getSongSyncIdentity(),
        currentIndex: Number.isInteger(currentLyricIndex.value) ? currentLyricIndex.value : -1,
        progress: currentProgress,
        currentTime: currentProgress,
        duration,
    };

    if (options.syncReason) payload.syncReason = options.syncReason;
    if (Number.isInteger(options.seekSerial)) payload.seekSerial = options.seekSerial;

    return payload;
}

function sendCurrentLyricData(options = {}) {
    if (!isDesktopLyricOpenState.value || !window.electronAPI) return;
    pushPayload(buildSongChangePayload(), options);
}

function sendPlayState(options = {}) {
    if (!isDesktopLyricOpenState.value || !window.electronAPI) return;
    pushPayload(buildPlayStatePayload(), options);
}

function sendLyricProgress(options = {}) {
    if (!isDesktopLyricOpenState.value || !window.electronAPI) return;
    if (progressDragActive && options.syncReason !== 'seek') return;
    pushPayload(buildLyricProgressPayload(options), options);
}

function sendSeekProgress() {
    progressDragActive = false;
    seekSerial += 1;
    sendLyricProgress({
        force: true,
        syncReason: 'seek',
        seekSerial,
    });
}

function scheduleSongChangePush(delayMs = 0, options = {}) {
    if (!isDesktopLyricOpenState.value) return;

    clearSongChangeTimer();
    songChangeTimer = setTimeout(() => {
        songChangeTimer = null;
        sendCurrentLyricData(options);
    }, delayMs);
}

function scheduleProgressPush(delayMs = 0, options = {}) {
    if (!isDesktopLyricOpenState.value) return;

    clearProgressTimer();
    progressTimer = setTimeout(() => {
        progressTimer = null;
        sendLyricProgress(options);
    }, delayMs);
}

export const initDesktopLyric = () => {
    if (bridgeInitialized) return;
    bridgeInitialized = true;

    if (window.electronAPI) {
        window.electronAPI.isLyricWindowVisible().then(isVisible => {
            playerStore.isDesktopLyricOpen = isVisible;
        });

        removeLyricDataRequestListener = window.electronAPI.getCurrentLyricData(() => {
            sendCurrentLyricData({ force: true });
            sendPlayState({ force: true });
            sendLyricProgress({ force: true });
        });

        removeDesktopLyricClosedListener = window.electronAPI.onDesktopLyricClosed(() => {
            playerStore.isDesktopLyricOpen = false;
        });
    }

    if (typeof window !== 'undefined') {
        const handlePlaybackSeeked = () => {
            sendSeekProgress();
        };
        const handleSeekDragStart = () => {
            progressDragActive = true;
            clearProgressTimer();
        };

        window.addEventListener('mediaSession:seeked', handlePlaybackSeeked);
        window.addEventListener('playback:seek-drag-start', handleSeekDragStart);
        removePlaybackSeekedListener = () => window.removeEventListener('mediaSession:seeked', handlePlaybackSeeked);
        removeSeekDragStartListener = () => window.removeEventListener('playback:seek-drag-start', handleSeekDragStart);
    }

    unwatchPlaying = watch(
        () => playing.value,
        isPlaying => {
            sendPlayState({ force: true });

            if (isPlaying) {
                startDesktopLyricSync();
                sendLyricProgress({ force: true });
                return;
            }

            stopDesktopLyricSync();
            sendLyricProgress({ force: true });
        },
        { immediate: true }
    );

    unwatchIsDesktopLyricOpen = watch(
        () => isDesktopLyricOpenState.value,
        isOpen => {
            if (isOpen) {
                sendCurrentLyricData({ force: true });
                sendPlayState({ force: true });
                sendLyricProgress({ force: true });
                startDesktopLyricSync();
                return;
            }

            stopDesktopLyricSync();
            clearSongChangeTimer();
            clearProgressTimer();
        },
        { immediate: true }
    );

    unwatchSongSnapshot = watch(
        () => [
            songId.value,
            currentIndex.value,
            lyricsObjArr.value,
            showSongTranslation.value,
            coverBlur.value,
            localBase64Img.value,
            videoIsPlaying?.value,
        ],
        () => {
            scheduleSongChangePush(0);
        }
    );

    unwatchProgress = watch(
        () => progress.value,
        (nextProgress, previousProgress) => {
            if (!isDesktopLyricOpenState.value) return;
            if (progressDragActive) return;
            if (!playing.value) {
                scheduleProgressPush(0, { force: true });
                return;
            }

            if (typeof previousProgress !== 'number' || Math.abs(nextProgress - previousProgress) > 1.2) {
                scheduleProgressPush(0, { force: true });
            }
        }
    );

    unwatchCurrentLyricIndex = watch(
        () => currentLyricIndex.value,
        () => {
            if (!isDesktopLyricOpenState.value || playing.value) return;
            scheduleProgressPush(0, { force: true });
        }
    );
};

export const destroyDesktopLyric = () => {
    stopDesktopLyricSync();
    clearSongChangeTimer();
    clearProgressTimer();

    if (unwatchPlaying) {
        unwatchPlaying();
        unwatchPlaying = null;
    }
    if (unwatchIsDesktopLyricOpen) {
        unwatchIsDesktopLyricOpen();
        unwatchIsDesktopLyricOpen = null;
    }
    if (unwatchSongSnapshot) {
        unwatchSongSnapshot();
        unwatchSongSnapshot = null;
    }
    if (unwatchProgress) {
        unwatchProgress();
        unwatchProgress = null;
    }
    if (unwatchCurrentLyricIndex) {
        unwatchCurrentLyricIndex();
        unwatchCurrentLyricIndex = null;
    }
    removeLyricDataRequestListener?.();
    removeLyricDataRequestListener = null;
    removeDesktopLyricClosedListener?.();
    removeDesktopLyricClosedListener = null;
    removePlaybackSeekedListener?.();
    removePlaybackSeekedListener = null;
    removeSeekDragStartListener?.();
    removeSeekDragStartListener = null;

    lastPayloadByType.clear();
    progressDragActive = false;
    bridgeInitialized = false;
};

/* ------------------------------------------------------------------ *
 * 网页端（Document Picture-in-Picture）歌词窗口
 * ------------------------------------------------------------------ */

const LYRIC_WINDOW_NAME = 'hydrogen-desktop-lyric';
const LYRIC_WINDOW_WIDTH = 520;
const LYRIC_WINDOW_HEIGHT = 360;
const LYRIC_WINDOW_FEATURES = `popup=yes,width=${LYRIC_WINDOW_WIDTH},height=${LYRIC_WINDOW_HEIGHT},resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no`;
// 部分内嵌 Chromium（如 Electron 外壳）存在 documentPictureInPicture 但 requestWindow 永不返回，
// 超时后降级为普通弹窗，避免点击后毫无反应
const PIP_REQUEST_TIMEOUT_MS = 2000;
// 自定义字体样式 id，与 setFont.js 的 CUSTOM_FONT_STYLE_ID 对应
const CUSTOM_FONT_STYLE_ID = '__CUSTOM_FONT__';
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

let lyricWindow = null;
let lyricContainer = null;
let lyricApp = null;
let themeObserver = null;
let unregisterTraditionalTextRoot = null;
let windowListeners = [];

export function isDesktopLyricSupported() {
    return typeof window !== 'undefined' && !!window.documentPictureInPicture && window.isSecureContext !== false;
}

// 给永不返回的 requestWindow 兜底；若超时后窗口才姗姗来迟，直接关掉它
function requestPipWindowWithTimeout(options) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            settled = true;
            reject(new Error('pip-timeout'));
        }, PIP_REQUEST_TIMEOUT_MS);

        window.documentPictureInPicture.requestWindow(options).then(
            pipWindow => {
                if (settled) {
                    try {
                        pipWindow.close();
                    } catch (_) {}
                    return;
                }

                clearTimeout(timer);
                settled = true;
                resolve(pipWindow);
            },
            error => {
                clearTimeout(timer);
                if (settled) return;
                settled = true;
                reject(error);
            }
        );
    });
}

export function isDesktopLyricOpen() {
    return !!lyricWindow && !lyricWindow.closed;
}

// 复制过来的样式表可能带相对 url()（字体、图片），在歌词窗口里会按 about:blank 解析而失效
function toAbsoluteCssUrls(cssText) {
    return String(cssText || '').replace(CSS_URL_PATTERN, (match, quote, rawUrl) => {
        const url = String(rawUrl || '').trim();
        if (!url || url.startsWith('#') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
            return match;
        }

        try {
            return `url(${quote}${new URL(url, document.baseURI).href}${quote})`;
        } catch (_) {
            return match;
        }
    });
}

// PiP 窗口是全新文档，不会继承主页面的样式，需要显式复制
function copyStyleSheets(targetDocument) {
    for (const sheet of Array.from(document.styleSheets)) {
        let styleElement = null;
        try {
            const cssText = Array.from(sheet.cssRules || []).map(rule => rule.cssText).join('\n');
            if (!cssText) continue;

            styleElement = targetDocument.createElement('style');
            styleElement.textContent = toAbsoluteCssUrls(cssText);
        } catch (_) {
            // 跨域样式表读不到 cssRules，退化为按链接重新加载
            if (!sheet.href) continue;
            styleElement = targetDocument.createElement('link');
            styleElement.rel = 'stylesheet';
            styleElement.href = sheet.href;
        }

        if (styleElement) targetDocument.head.appendChild(styleElement);
    }
}

function injectBaseStyle(targetDocument) {
    const style = targetDocument.createElement('style');
    style.id = 'desktop-lyric-base';
    style.textContent = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; overscroll-behavior: none; }
    body { user-select: none; }
  `;
    targetDocument.head.appendChild(style);
}

function prepareDocument(targetDocument) {
    targetDocument.title = 'Hydrogen Music - Desktop Lyric';

    const charset = targetDocument.createElement('meta');
    charset.setAttribute('charset', 'utf-8');
    targetDocument.head.appendChild(charset);

    const referrer = targetDocument.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    targetDocument.head.appendChild(referrer);
}

// 歌词窗口跟随主窗口的深浅色与语言（主题切换时同步）
function syncDocumentTheme(targetDocument) {
    const applyTheme = () => {
        const source = document.documentElement;
        targetDocument.documentElement.className = source.className;
        const lang = source.getAttribute('lang');
        if (lang) targetDocument.documentElement.setAttribute('lang', lang);
        else targetDocument.documentElement.removeAttribute('lang');
    };

    applyTheme();
    themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] });
}

function addWindowListener(target, type, handler) {
    target.addEventListener(type, handler);
    windowListeners.push(() => target.removeEventListener(type, handler));
}

function forgetLyricWindow() {
    themeObserver?.disconnect();
    themeObserver = null;

    unregisterTraditionalTextRoot?.();
    unregisterTraditionalTextRoot = null;

    windowListeners.forEach(remove => remove());
    windowListeners = [];

    try {
        lyricApp?.unmount();
    } catch (_) {}
    lyricApp = null;
    lyricContainer?.remove();
    lyricContainer = null;
    lyricWindow = null;
    playerStore.isDesktopLyricOpen = false;
}

async function openDesktopLyricWindow() {
    let targetWindow = null;

    if (isDesktopLyricSupported()) {
        try {
            targetWindow = await requestPipWindowWithTimeout({
                width: LYRIC_WINDOW_WIDTH,
                height: LYRIC_WINDOW_HEIGHT,
            });
        } catch (_) {
            // 置顶浮窗不可用时降级为普通弹窗
        }
    }

    if (!targetWindow) {
        targetWindow = window.open('', LYRIC_WINDOW_NAME, LYRIC_WINDOW_FEATURES);
    }

    if (!targetWindow) throw new Error('popup-blocked');

    lyricWindow = targetWindow;
    const targetDocument = targetWindow.document;
    if (!targetDocument?.body) throw new Error('window-unavailable');

    // 动态引入的组件样式会在 import 时注入主文档 head，因此先引入再复制样式
    const { default: DesktopLyric } = await import('../components/DesktopLyric.vue');

    prepareDocument(targetDocument);
    copyStyleSheets(targetDocument);
    injectBaseStyle(targetDocument);
    syncDocumentTheme(targetDocument);

    // 直接挂载到歌词窗口的容器：PiP 与主页面共享脚本上下文，同源弹窗也能直接操作其
    // document，组件内的状态与响应式更新都和主窗口共用一套运行时。
    const container = targetDocument.createElement('div');
    container.style.cssText = 'position: relative; width: 100%; height: 100%;';
    targetDocument.body.appendChild(container);

    lyricContainer = container;
    lyricApp = createApp(DesktopLyric, { onClose: closeDesktopLyric });
    lyricApp.use(pinia);
    lyricApp.mount(container);

    // 歌词窗口是独立文档，注册为繁体转换的额外根，跟随主窗口的简繁设置
    unregisterTraditionalTextRoot = registerTraditionalTextRoot(targetDocument.body);

    const handleWindowClosed = () => forgetLyricWindow();
    addWindowListener(targetWindow, 'pagehide', handleWindowClosed);
    // 主页面刷新/关闭时不留孤儿窗口（PiP 会随主页面自动关闭）
    addWindowListener(window, 'beforeunload', () => {
        try {
            targetWindow.close();
        } catch (_) {}
    });

    playerStore.isDesktopLyricOpen = true;
}

/* ------------------------------------------------------------------ *
 * 对外接口
 * ------------------------------------------------------------------ */

// 桌面端走 Electron 独立歌词窗口；网页端走 Document Picture-in-Picture 置顶浮窗。
// 返回值保持网页端约定（{ ok, open, reason }），供播放器按钮提示失败原因。
export async function toggleDesktopLyric() {
    if (typeof window !== 'undefined' && window.electronAPI) {
        try {
            if (isDesktopLyricOpenState.value) {
                const result = await window.electronAPI.closeLyricWindow();
                if (result?.success) {
                    playerStore.isDesktopLyricOpen = false;
                }
                return { ok: true, open: false };
            }

            const result = await window.electronAPI.createLyricWindow();
            if (result?.success) {
                playerStore.isDesktopLyricOpen = true;
                setTimeout(() => {
                    sendCurrentLyricData({ force: true });
                    sendPlayState({ force: true });
                    sendLyricProgress({ force: true });
                }, DESKTOP_LYRIC_READY_PUSH_DELAY_MS);
                return { ok: true, open: true };
            }

            return { ok: false, open: false, reason: 'failed' };
        } catch (error) {
            return { ok: false, open: false, reason: error?.message || 'failed' };
        }
    }

    if (isDesktopLyricOpen()) {
        closeDesktopLyric();
        return { ok: true, open: false };
    }

    try {
        await openDesktopLyricWindow();
        return { ok: true, open: true };
    } catch (error) {
        closeDesktopLyric();
        return { ok: false, open: false, reason: error?.message || 'failed' };
    }
}

export function closeDesktopLyric() {
    if (typeof window !== 'undefined' && window.electronAPI && isDesktopLyricOpenState.value) {
        try {
            window.electronAPI.closeLyricWindow();
        } catch (_) {}
        playerStore.isDesktopLyricOpen = false;
    }

    if (!lyricWindow) return;

    const targetWindow = lyricWindow;
    forgetLyricWindow();
    try {
        targetWindow.close();
    } catch (_) {}
}

// 自定义字体变化时同步到歌词窗口：桌面端通过 IPC 推送给独立窗口，网页端直接写入 PiP 文档
export function syncDesktopLyricStyle(cssText) {
    if (typeof window !== 'undefined' && window.electronAPI?.updateLyricData) {
        window.electronAPI.updateLyricData({
            type: 'settings-change',
            customFontCss: String(cssText || ''),
        });
    }

    const targetDocument = lyricWindow?.document;
    if (!targetDocument?.head) return;

    const existingStyle = targetDocument.getElementById(CUSTOM_FONT_STYLE_ID);
    const style = existingStyle || targetDocument.createElement('style');
    style.id = CUSTOM_FONT_STYLE_ID;
    style.textContent = toAbsoluteCssUrls(cssText);

    if (!existingStyle) targetDocument.head.appendChild(style);
}