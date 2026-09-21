<template>
    <div
        ref="rootRef"
        class="arknights-desktop-lyric"
        :class="{
            draggable: ipcMode && !locked,
            'native-drag': ipcMode && isMac && !locked,
            'cover-blur-active': showCoverBackdrop,
        }"
        @contextmenu.prevent.stop="showContextMenu"
        @click="hideContextMenu"
        @mousedown="onDragStart"
    >
        <!-- 背景层 -->
        <div class="background-layers">
            <Transition name="desktop-cover-fade">
                <div
                    v-if="showCoverBackdrop"
                    class="cover-backdrop"
                    :class="{ 'cover-backdrop-siren': coverBackdrop.isSiren }"
                >
                    <img
                        class="cover-backdrop-image"
                        :src="displayedCoverBackdropUrl"
                        alt=""
                        aria-hidden="true"
                        referrerpolicy="no-referrer"
                        @error="handleCoverBackdropError"
                    />
                </div>
            </Transition>
            <div class="bg-layer bg-primary"></div>
            <div class="bg-layer bg-secondary"></div>
        </div>

        <!-- 内容区域 -->
        <div class="lyric-content">
            <!-- 顶部状态栏（桌面端：未锁定时整条可拖拽 / 网页端：兼作置顶浮窗的拖拽手柄） -->
            <div
                class="status-bar"
                :class="{
                    'native-drag': ipcMode && !locked && isMac,
                    'drag-handle': ipcMode && !locked && !isMac,
                    dragging: ipcMode && isDragging && isWinOrLinux,
                }"
            >
                <div class="status-indicator" :class="{ active: playing }">
                    <div class="indicator-dot"></div>
                    <span class="status-text">{{ playing ? 'PLAYING' : 'PAUSED' }}</span>
                </div>
                <div class="lyric-controls">
                    <span class="font-size-label">{{ lyricFontSize }}PX</span>
                </div>
            </div>

            <!-- 歌曲信息区 -->
            <div class="song-info-section" v-if="currentSong">
                <div class="song-meta">
                    <div class="meta-row">
                        <span class="meta-label">TRACK</span>
                        <span class="meta-content">{{ getSongDisplayName(currentSong, 'UNKNOWN', showSongTranslation) }}</span>
                    </div>
                    <div class="meta-row">
                        <span class="meta-label">ARTIST</span>
                        <span class="meta-content">{{ getArtistNames(currentSong) || 'UNKNOWN' }}</span>
                    </div>
                </div>
            </div>

            <!-- 主歌词显示区 -->
            <div class="main-lyric-section">
                <div class="lyric-container">
                    <div class="lyric-prefix">></div>
                    <div
                        class="current-lyric"
                        ref="lyricElementRef"
                        :class="{ 'line-scan-active': lineScanActive }"
                        :style="{
                            fontSize: lyricFontSize + 'px',
                            opacity: currentLyricOpacity,
                            height: currentLyricBoxHeight > 0 ? (currentLyricBoxHeight + 'px') : undefined,
                        }"
                    >
                        <span class="current-lyric-text">{{ currentLyricText }}</span>
                        <!-- 扫光层：用真实元素承载，简繁转换时与主文字保持同一份文本 -->
                        <span class="current-lyric-scan-text" aria-hidden="true">{{ currentLyricText }}</span>
                    </div>
                </div>

                <!-- 下一句歌词预览 -->
                <div class="next-lyric-preview" v-if="nextLyricText"
                     :style="{ height: nextLyricRowHeight > 0 ? (nextLyricRowHeight + 'px') : undefined }">
                    <div class="preview-indicator">NEXT</div>
                    <div
                        class="next-lyric"
                        ref="nextLyricElementRef"
                        :style="{
                            fontSize: lyricFontSize * 0.75 + 'px',
                            opacity: nextLyricOpacity,
                        }"
                    >
                        {{ nextLyricText }}
                    </div>
                </div>
            </div>

            <!-- 进度指示器 -->
            <div class="progress-section" v-if="lyricsArray.length > 0">
                <div class="progress-label">LYRIC PROGRESS</div>
                <div class="progress-bar">
                    <div class="progress-fill" :style="{ width: progressPercentage + '%' }"></div>
                    <div class="progress-indicator"></div>
                </div>
                <div class="progress-info">
                    <span>{{ lyricIndex + 1 }}</span>
                    <span>/</span>
                    <span>{{ lyricsArray.length }}</span>
                </div>
            </div>
        </div>

        <!-- 明日方舟风格右键菜单 -->
        <div
            v-if="contextMenuVisible"
            class="arknights-context-menu-backdrop"
            @mousedown.stop="hideContextMenu"
            @click.stop="hideContextMenu"
        ></div>
        <div class="arknights-context-menu" v-if="contextMenuVisible" :style="{ left: contextMenuX + 'px', top: contextMenuY + 'px' }" @click.stop>
            <div class="menu-header">
                <span class="menu-title">DESKTOP LYRIC</span>
                <div class="title-underline"></div>
            </div>

            <div class="menu-content">
                <!-- 自动选择选项 -->
                <div class="menu-item" @click="selectLyricType('auto')">
                    <div class="item-icon" aria-hidden="true">
                        <span class="selection-mark" :class="{ selected: selectedLyricType === 'auto' }"></span>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">自动选择</span>
                        <span class="text-en">AUTO SELECT</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>

                <!-- 原歌词选项 -->
                <div class="menu-item" v-if="hasLyricType('original')" @click="selectLyricType('original')">
                    <div class="item-icon" aria-hidden="true">
                        <span class="selection-mark" :class="{ selected: selectedLyricType === 'original' }"></span>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">原文</span>
                        <span class="text-en">ORIGINAL</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>

                <!-- 翻译歌词选项 -->
                <div class="menu-item" v-if="hasLyricType('trans')" @click="selectLyricType('trans')">
                    <div class="item-icon" aria-hidden="true">
                        <span class="selection-mark" :class="{ selected: selectedLyricType === 'trans' }"></span>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">翻译</span>
                        <span class="text-en">TRANSLATION</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>

                <!-- 罗马音选项 -->
                <div class="menu-item" v-if="hasLyricType('roma')" @click="selectLyricType('roma')">
                    <div class="item-icon" aria-hidden="true">
                        <span class="selection-mark" :class="{ selected: selectedLyricType === 'roma' }"></span>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">罗马音</span>
                        <span class="text-en">ROMANIZATION</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>

                <div class="menu-separator">
                    <div class="separator-line"></div>
                </div>

                <!-- 桌面端专属：锁定/解锁歌词窗口位置（网页端 PiP 由宿主浏览器接管，不显示） -->
                <div class="menu-item" v-if="ipcMode" @click="toggleLock">
                    <div class="item-icon" aria-hidden="true">
                        <svg v-if="locked" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4.5 7V5.4C4.5 3.6 5.7 2.4 7.5 2.4C8.9 2.4 10 3.2 10.4 4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
                            <path d="M3.5 7H12.5V13H3.5V7Z" stroke="currentColor" stroke-width="1.4"/>
                            <path d="M8 9.2V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
                        </svg>
                        <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4.5 7V5.4C4.5 3.6 5.7 2.4 7.5 2.4H8.5C10.3 2.4 11.5 3.6 11.5 5.4V7" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
                            <path d="M3.5 7H12.5V13H3.5V7Z" stroke="currentColor" stroke-width="1.4"/>
                            <path d="M8 9.2V11" stroke="currentColor" stroke-width="1.4" stroke-linecap="square"/>
                        </svg>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">{{ zhLockText }}</span>
                        <span class="text-en">{{ enLockText }}</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>

                <div class="menu-item" @click="adjustFontSize(2)">
                    <div class="item-icon" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 6h6M6 3v6" stroke="currentColor" stroke-width="2" stroke-linecap="square"/>
                        </svg>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">增大字体</span>
                        <span class="text-en">INCREASE FONT</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>

                <div class="menu-item" @click="adjustFontSize(-2)">
                    <div class="item-icon" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 6h6" stroke="currentColor" stroke-width="2" stroke-linecap="square"/>
                        </svg>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">减小字体</span>
                        <span class="text-en">DECREASE FONT</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>

                <div class="menu-separator">
                    <div class="separator-line"></div>
                </div>

                <div class="menu-item danger" @click="closeLyric">
                    <div class="item-icon" aria-hidden="true">
                        <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"/>
                        </svg>
                    </div>
                    <span class="item-text">
                        <span class="text-zh">关闭歌词</span>
                        <span class="text-en">CLOSE LYRIC</span>
                    </span>
                    <div class="item-indicator"></div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch, watchEffect } from 'vue';
import { storeToRefs } from 'pinia';
import pinia from '../store/pinia';
import { usePlayerStore } from '../store/playerStore';
import { buildCoverBackdropCandidates } from '../utils/coverBackdrop';
import { findLyricIndexAtTime } from '../utils/lyricCore';
import { getPlaybackSnapshot } from '../utils/player/playbackTicker';
import { useStableImageSource } from '../composables/useStableImageSource';
import { getIndexedSong } from '../utils/songList';
import { getSongDisplayName } from '../utils/songName';
import { LYRIC_INDEX_SYNC_BIAS_SEC } from '../composables/usePlayerRuntime';
import { applyCustomFontStyle } from '../utils/setFont';
import {
    resolveDesktopSongChangeState,
    shouldIgnoreDesktopLyricMessage,
    shouldIgnoreDesktopLyricProgress,
} from '../utils/desktopLyricSync.mjs';

// 歌词窗口有两条数据来源，渲染与扫描动画完全共用：
// - 桌面端（Electron 独立歌词窗口）：主窗口通过 IPC 推送歌曲、歌词与进度，
//   进度由本地时钟平滑推进，并用 desktopLyricSync 的序号做乱序防护；
// - 网页端（Document PiP）：与主页面共享同一套 Pinia 状态，进度直接读播放器快照。
const ipcMode = typeof window !== 'undefined' && !!window.electronAPI;

const emit = defineEmits(['close']);

const playerStore = usePlayerStore(pinia);
const {
    coverBlur,
    currentIndex,
    currentLyricIndex: storeCurrentLyricIndex,
    localBase64Img,
    lyricsObjArr,
    playing: storePlaying,
    showSongTranslation: storeShowSongTranslation,
    songId,
    songList,
    time,
} = storeToRefs(playerStore);

// —— 桌面端 IPC 状态（由主窗口推送驱动） ——
const ipcSong = ref(null);
const ipcLyrics = ref([]);
const ipcCurrentLyricIndex = ref(-1);
const ipcProgress = ref(0);
const ipcDuration = ref(0);
const ipcPlaying = ref(false);
const ipcCoverBackdrop = ref({ urls: [], isSiren: false });

// —— 两种来源归一后的只读视图 ——
const currentSong = computed(() => (ipcMode ? ipcSong.value : getIndexedSong(songList.value, currentIndex.value)));
const lyricsArray = computed(() => (ipcMode ? ipcLyrics.value : (Array.isArray(lyricsObjArr.value) ? lyricsObjArr.value : [])));
const playing = computed(() => (ipcMode ? ipcPlaying.value : storePlaying.value));
const currentLyricIndex = computed(() => (ipcMode ? ipcCurrentLyricIndex.value : storeCurrentLyricIndex.value));
// 桌面端推送过来的歌名已按主窗口偏好解析完毕，这里直接显示即可
const showSongTranslation = computed(() => (ipcMode ? false : storeShowSongTranslation.value));

const rootRef = ref(null);

// 当前位置由歌词窗口自己的动画帧直接读取音频进度，主页面被遮挡/后台节流时仍能逐帧对齐
const lyricIndex = ref(-1);
let visualProgressSec = 0;
let scanRaf = 0;

const MIN_LINE_SCAN_DURATION_SEC = 0.8;
const MAX_LINE_SCAN_DURATION_SEC = 4.8;
const SCAN_COMPLETE_HOLD_SEC = 0.18;
// 桌面端进度时钟：把 IPC 推送的离散进度平滑成连续进度，并抑制拖动进度条后的回退跳变
const CLOCK_SMALL_DRIFT_SEC = 0.025;
const CLOCK_SNAP_THRESHOLD_SEC = 0.45;
const CLOCK_CORRECTION_FACTOR = 0.18;
const SEEK_SETTLE_GRACE_MS = 700;
const SEEK_SETTLE_ACCEPT_RANGE_SEC = 0.75;
const SEEK_SETTLE_BACKWARD_TOLERANCE_SEC = 0.08;
const SEEK_SETTLE_FORWARD_TOLERANCE_SEC = 0.25;
// 自定义字体样式 id，与 setFont.js 的 CUSTOM_FONT_STYLE_ID 对应
const CUSTOM_FONT_STYLE_ID = '__CUSTOM_FONT__';

// 歌词显示类型配置 - 单选模式
const selectedLyricType = ref('auto'); // 'auto' | 'original' | 'trans' | 'roma'
const lyricFontSize = ref(22);

// 桌面端歌词窗口位置锁定（网页端 PiP 由宿主浏览器接管拖拽，locked 不参与渲染）
const locked = ref(false);
const enLockText = computed(() => (locked.value ? 'UNLOCK POSITION' : 'LOCK POSITION'));
const zhLockText = computed(() => (locked.value ? '解锁位置' : '锁定位置'));

// 封面模糊背景
const coverBackdropCandidateIndex = ref(0);
const coverBackdrop = computed(() => {
    if (ipcMode) return ipcCoverBackdrop.value;

    const song = currentSong.value;
    const shouldShowBackdrop = !!(song && coverBlur.value);

    return {
        urls: shouldShowBackdrop
            ? buildCoverBackdropCandidates(song, localBase64Img.value, { includeAlbumPicUrl: true })
            : [],
        isSiren: shouldShowBackdrop && song?.source === 'siren',
    };
});
const coverBackdropUrl = computed(() => coverBackdrop.value.urls[coverBackdropCandidateIndex.value] || '');
const displayedCoverBackdropUrl = useStableImageSource(coverBackdropUrl);
const showCoverBackdrop = computed(() => !!displayedCoverBackdropUrl.value);

watch(coverBackdrop, () => {
    coverBackdropCandidateIndex.value = 0;
});

const handleCoverBackdropError = () => {
    coverBackdropCandidateIndex.value = Math.min(
        coverBackdropCandidateIndex.value + 1,
        coverBackdrop.value.urls.length
    );
};

const lyricElementRef = ref(null);
const nextLyricElementRef = ref(null);
// 动态两行扩展：当前歌词盒子目标高度（px）
const currentLyricBoxHeight = ref(0);
// 下一句预览行（含上下内边距）的目标高度（px）
const nextLyricRowHeight = ref(0);
const lineScanActive = ref(false);
let lyricResizeObserver = null;
let rafAdjust = 0;
let measureEl = null;
let lyricDocument = null;
let removeLyricUpdateListener = null;
let playbackClockProgressSec = 0;
let playbackClockUpdatedAtMs = 0;
let seekSettlingUntilMs = 0;
let seekSettlingTargetSec = 0;
let lastSeekSerial = 0;
let activeSongSerial = null;
let activeSongId = '';
let lastLyricSyncSequence = 0;
let baselineWindowWidth = 0;
let baselineWindowHeightOneLine = 0; // 以“单行歌词高度”为基准的窗口外部高度
let lastAppliedHeight = 0;

const lineHeightPx = () => Math.round(lyricFontSize.value * 1.4);
const singleLineBoxHeight = () => Math.max(60, 24 + lineHeightPx()); // 12px 顶/底 padding 合计 24
const doubleLineBoxHeight = () => 24 + lineHeightPx() * 2;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const normalizeDurationSeconds = value => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return parsed > 1000 ? parsed / 1000 : parsed;
};

const songDuration = computed(() => {
    if (ipcMode) return normalizeDurationSeconds(ipcDuration.value);

    const fromSong = normalizeDurationSeconds(currentSong.value?.dt ?? currentSong.value?.duration);
    return fromSong || normalizeDurationSeconds(time.value);
});

// 获取歌词文本（单选模式）
const formatLyricText = lyricObj => {
    if (!lyricObj) return '♪';

    switch (selectedLyricType.value) {
        case 'original':
            return lyricObj.lyric || '♪';
        case 'trans':
            return lyricObj.tlyric || '♪';
        case 'roma':
            return lyricObj.rlyric || '♪';
        case 'auto':
        default:
            // 自动选择：翻译优先，没有翻译则显示原歌词
            return lyricObj.tlyric || lyricObj.lyric || '♪';
    }
};

const currentLyricText = computed(() => {
    if (!currentSong.value) {
        return '♪ 等待歌曲数据 ♪';
    }

    if (!lyricsArray.value.length) {
        return '♪ 暂无歌词 ♪';
    }

    if (lyricIndex.value < 0 || lyricIndex.value >= lyricsArray.value.length) {
        return formatLyricText(lyricsArray.value[0]);
    }

    return formatLyricText(lyricsArray.value[lyricIndex.value]);
});

const nextLyricText = computed(() => {
    if (!lyricsArray.value.length || lyricIndex.value < 0 || lyricIndex.value >= lyricsArray.value.length - 1) {
        return '';
    }

    return formatLyricText(lyricsArray.value[lyricIndex.value + 1]);
});

// 检查当前歌曲是否有特定类型的歌词
const hasLyricType = type => {
    const checkField = type === 'original' ? 'lyric'
        : type === 'trans' ? 'tlyric'
            : 'rlyric';

    return lyricsArray.value.some(item => item[checkField] && String(item[checkField]).trim() !== '');
};

// 辅助函数
const getArtistNames = song => {
    if (!song) return '';
    const ar = song.ar;
    // 统一处理：ar 可能是字符串数组、对象数组({name})或字符串
    if (Array.isArray(ar)) {
        const names = ar
            .map(a => (typeof a === 'string' ? a : (a && a.name) || ''))
            .filter(Boolean);
        return names.length ? names.join(' / ') : '未知艺术家';
    }
    if (typeof ar === 'string') return ar || '未知艺术家';
    return '未知艺术家';
};

const currentLyricOpacity = computed(() => (playing.value ? 1 : 0.6));
const nextLyricOpacity = computed(() => (playing.value ? 0.7 : 0.4));

// 歌词进度百分比
const progressPercentage = computed(() => {
    if (!lyricsArray.value.length || lyricIndex.value < 0) {
        return 0;
    }

    return ((lyricIndex.value + 1) / lyricsArray.value.length) * 100;
});

const readPlaybackProgress = () => {
    if (ipcMode) {
        // 桌面端窗口内没有音频，进度用主窗口推送值 + 本地时钟外推
        visualProgressSec = Math.max(0, getVisualPlaybackProgress());
        return visualProgressSec;
    }

    const seek = Number(getPlaybackSnapshot().seek);
    if (Number.isFinite(seek)) visualProgressSec = Math.max(0, seek);
    return visualProgressSec;
};

const syncLyricIndex = progressSeconds => {
    const nextIndex = findLyricIndexAtTime(lyricsArray.value, progressSeconds, LYRIC_INDEX_SYNC_BIAS_SEC);
    if (nextIndex !== lyricIndex.value) lyricIndex.value = nextIndex;
};

const getLyricLineTime = index => {
    const time = Number(lyricsArray.value?.[index]?.time);
    return Number.isFinite(time) ? time : null;
};

const findNextTimedLineTime = index => {
    const startTime = getLyricLineTime(index);
    if (startTime === null) return null;

    for (let i = index + 1; i < lyricsArray.value.length; i++) {
        const nextTime = getLyricLineTime(i);
        if (nextTime !== null && nextTime > startTime) return nextTime;
    }

    return null;
};

const getFinalLineFallbackEndTime = (startTime, estimatedDuration) => {
    const duration = normalizeDurationSeconds(songDuration.value);
    if (duration > startTime + MIN_LINE_SCAN_DURATION_SEC) return duration;

    const fallbackDuration = clamp(
        Math.max(estimatedDuration, MIN_LINE_SCAN_DURATION_SEC),
        MIN_LINE_SCAN_DURATION_SEC,
        MAX_LINE_SCAN_DURATION_SEC
    );
    return startTime + fallbackDuration;
};

const countMatches = (text, pattern) => {
    const matches = text.match(pattern);
    return matches ? matches.length : 0;
};

const estimateLyricVocalDurationSec = text => {
    const normalizedText = String(text || '').trim();
    if (!normalizedText) return 0;

    const cjkCount = countMatches(normalizedText, /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g);
    const latinWords = countMatches(normalizedText, /[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g);
    const punctuationCount = countMatches(normalizedText, /[，。！？、,.!?;；:：]/g);
    const denseTextLength = normalizedText.replace(/\s+/g, '').length;
    const latinChars = (normalizedText.match(/[A-Za-z0-9]/g) || []).length;
    const otherUnits = Math.max(0, denseTextLength - cjkCount - latinChars - punctuationCount);

    return 0.18 + cjkCount * 0.16 + latinWords * 0.28 + otherUnits * 0.14 + punctuationCount * 0.12;
};

const getLineScanTiming = () => {
    const index = lyricIndex.value;
    if (!lyricsArray.value.length || index < 0 || index >= lyricsArray.value.length) return null;

    const currentText = String(currentLyricText.value || '').trim();
    if (!currentText || currentText === '♪') return null;

    const startTime = getLyricLineTime(index);
    if (startTime === null) return null;

    const estimatedDuration = estimateLyricVocalDurationSec(currentText);
    const nextTimedLineTime = findNextTimedLineTime(index);
    const endTime = nextTimedLineTime === null
        ? getFinalLineFallbackEndTime(startTime, estimatedDuration)
        : nextTimedLineTime;

    const rawDuration = endTime - startTime;
    if (!Number.isFinite(rawDuration) || rawDuration < MIN_LINE_SCAN_DURATION_SEC) return null;

    const maxDuration = Math.max(MIN_LINE_SCAN_DURATION_SEC, Math.min(rawDuration * 0.92, MAX_LINE_SCAN_DURATION_SEC));
    const scanDuration = clamp(
        Math.max(estimatedDuration, rawDuration * 0.55),
        MIN_LINE_SCAN_DURATION_SEC,
        maxDuration
    );

    return {
        startTime,
        endTime,
        scanDuration,
    };
};

// —— 桌面端进度时钟与乱序防护（网页端不需要，保持休眠） ——
const getVisualPlaybackProgress = (now = performance.now()) => {
    if (!playing.value) return playbackClockProgressSec;
    return playbackClockProgressSec + Math.max(0, now - playbackClockUpdatedAtMs) / 1000;
};

const markSeekSettling = (targetProgress, now = performance.now()) => {
    const normalizedProgress = Number(targetProgress);
    if (!Number.isFinite(normalizedProgress)) return;

    seekSettlingTargetSec = normalizedProgress;
    seekSettlingUntilMs = now + SEEK_SETTLE_GRACE_MS;
};

const isSeekSettlingProgressStale = (normalizedProgress, now) => {
    if (now > seekSettlingUntilMs) return false;
    if (playing.value) {
        const visualProgress = getVisualPlaybackProgress(now);
        if (normalizedProgress < visualProgress - SEEK_SETTLE_BACKWARD_TOLERANCE_SEC) return true;
        if (normalizedProgress > visualProgress + SEEK_SETTLE_FORWARD_TOLERANCE_SEC) return true;
    }
    return Math.abs(normalizedProgress - seekSettlingTargetSec) > SEEK_SETTLE_ACCEPT_RANGE_SEC;
};

const isBackwardProgressPayload = (normalizedProgress, now = performance.now()) => {
    if (!playing.value) return false;
    return normalizedProgress < getVisualPlaybackProgress(now) - SEEK_SETTLE_BACKWARD_TOLERANCE_SEC;
};

const shouldIgnoreLyricProgressPayload = (data, options = {}) => {
    const normalizedProgress = Number(data?.progress);
    const now = performance.now();
    return shouldIgnoreDesktopLyricProgress(data, {
        isSeekSync: options.isSeekSync,
        songSerial: activeSongSerial,
        songId: activeSongId,
        lastSyncSequence: lastLyricSyncSequence,
        isSettlingStale: Number.isFinite(normalizedProgress)
            ? isSeekSettlingProgressStale(normalizedProgress, now)
            : false,
        currentLyricIndex: currentLyricIndex.value,
        isBackwardProgress: Number.isFinite(normalizedProgress)
            ? isBackwardProgressPayload(normalizedProgress, now)
            : false,
    });
};

const syncPlaybackClock = (nextProgress, options = {}) => {
    const normalizedProgress = Number(nextProgress);
    if (!Number.isFinite(normalizedProgress)) return;

    const now = performance.now();
    if (!playing.value || options.snap || playbackClockUpdatedAtMs <= 0) {
        playbackClockProgressSec = normalizedProgress;
        playbackClockUpdatedAtMs = now;
        return;
    }

    const visualProgress = getVisualPlaybackProgress(now);
    if (isSeekSettlingProgressStale(normalizedProgress, now)) {
        playbackClockProgressSec = visualProgress;
        playbackClockUpdatedAtMs = now;
        return;
    }

    const drift = normalizedProgress - visualProgress;
    if (drift < -SEEK_SETTLE_BACKWARD_TOLERANCE_SEC) {
        playbackClockProgressSec = visualProgress;
        playbackClockUpdatedAtMs = now;
        return;
    }

    if (Math.abs(drift) >= CLOCK_SNAP_THRESHOLD_SEC) {
        playbackClockProgressSec = normalizedProgress;
    } else if (Math.abs(drift) > CLOCK_SMALL_DRIFT_SEC) {
        playbackClockProgressSec = visualProgress + drift * CLOCK_CORRECTION_FACTOR;
    } else {
        playbackClockProgressSec = visualProgress;
    }
    playbackClockUpdatedAtMs = now;
};

const applyLineScanStyle = percent => {
    const el = lyricElementRef.value;
    if (!el) return;
    el.style.setProperty('--scan-progress', `${Math.round(percent * 100) / 100}%`);
};

const renderLineScan = (visualProgress = visualProgressSec) => {
    const timing = getLineScanTiming();
    if (!timing) {
        lineScanActive.value = false;
        applyLineScanStyle(0);
        return false;
    }

    const { startTime, endTime, scanDuration } = timing;
    if (visualProgress < startTime - 0.05 || visualProgress > endTime + SCAN_COMPLETE_HOLD_SEC) {
        lineScanActive.value = false;
        applyLineScanStyle(0);
        return false;
    }

    const ratio = clamp((visualProgress - startTime) / scanDuration, 0, 1);
    lineScanActive.value = true;
    applyLineScanStyle(ratio * 100);
    return true;
};

const renderFrame = () => {
    const visualProgress = readPlaybackProgress();
    syncLyricIndex(visualProgress);
    renderLineScan(visualProgress);
};

const stopScanRaf = () => {
    if (!scanRaf) return;
    cancelAnimationFrame(scanRaf);
    scanRaf = 0;
};

const tickLyricFrame = () => {
    scanRaf = 0;
    renderFrame();
    if (playing.value) {
        scanRaf = requestAnimationFrame(tickLyricFrame);
    }
};

const startScanRaf = () => {
    if (scanRaf || !playing.value) return;
    scanRaf = requestAnimationFrame(tickLyricFrame);
};

watch(
    () => playing.value,
    isPlaying => {
        if (isPlaying) {
            renderFrame();
            startScanRaf();
            return;
        }

        stopScanRaf();
        renderFrame();
    },
    { immediate: true }
);

// 暂停时以主窗口维护的歌词索引为准（例如主窗口拖动进度条后）
watch(currentLyricIndex, index => {
    if (playing.value) return;

    lyricIndex.value = Number.isInteger(index) ? index : -1;
    renderLineScan(readPlaybackProgress());
});

watch(
    () => [songId.value, currentIndex.value],
    () => {
        // 桌面端由 IPC 推送重置，避免与 handleLyricUpdate 抢同一帧
        if (ipcMode) return;
        lyricIndex.value = -1;
    }
);

watch(lyricsArray, () => {
    renderFrame();
});

// 隐藏测量元素：用于计算自然高度（不受当前 height 影响），建在歌词窗口文档内以保证字体一致
const ensureMeasureEl = ownerDocument => {
    if (measureEl) return measureEl;

    const el = (ownerDocument || document).createElement('div');
    el.style.position = 'absolute';
    el.style.left = '-99999px';
    el.style.top = '-99999px';
    el.style.visibility = 'hidden';
    el.style.pointerEvents = 'none';
    el.style.whiteSpace = 'normal';
    el.style.wordWrap = 'break-word';
    el.style.overflowWrap = 'break-word';
    el.style.padding = '12px 16px';
    el.style.boxSizing = 'border-box';
    el.style.fontFamily = "SourceHanSansCN-Bold, 'Bender-Bold', monospace";
    (ownerDocument || document).body.appendChild(el);
    measureEl = el;
    return el;
};

const removeMeasureEl = () => {
    if (measureEl?.parentNode) {
        measureEl.parentNode.removeChild(measureEl);
    }
    measureEl = null;
};

const scheduleAdjustLyricLayout = () => {
    if (rafAdjust) cancelAnimationFrame(rafAdjust);
    rafAdjust = requestAnimationFrame(() => {
        rafAdjust = 0;
        applyLyricAutoExpand();
    });
};

const applyLyricAutoExpand = async () => {
    try {
        await nextTick();
        const el = lyricElementRef.value;
        if (!el) return;

        const ownerDocument = el.ownerDocument || document;

        // 计算单行/双行目标高度
        const oneLine = singleLineBoxHeight();
        const twoLines = doubleLineBoxHeight();

        // 使用隐藏测量元素按“当前可用宽度 + 当前字体”测自然高度
        const m = ensureMeasureEl(ownerDocument);
        const availableWidth = Math.max(120, Math.round(el.clientWidth || 400));
        m.style.width = availableWidth + 'px';
        m.style.fontSize = lyricFontSize.value + 'px';
        m.style.lineHeight = '1.4';
        m.textContent = currentLyricText.value || '';
        const natural = Math.max(0, Math.round(m.scrollHeight));

        // 判断是否需要显示两行（超过单行阈值则两行）
        const needTwo = natural > (oneLine + 2);
        const target = needTwo ? twoLines : oneLine;

        // 计算 NEXT 预览的目标高度（最多两行）
        const nextFontPx = Math.round(lyricFontSize.value * 0.75);
        const nextLinePx = Math.max(1, Math.round(nextFontPx * 1.3));
        const nextOneLine = 16 + nextLinePx; // 上下 padding: 6 + 10 = 16
        const nextTwoLines = 16 + nextLinePx * 2;
        let nextActiveTarget = 0;
        if ((nextLyricText.value || '').trim()) {
            // 用 next 宽度测量（优先使用元素宽度）
            const nextEl = nextLyricElementRef.value;
            const nextWidth = Math.max(120, Math.round(nextEl?.clientWidth || (el.clientWidth - 60) || 300));
            m.style.width = nextWidth + 'px';
            m.style.fontSize = nextFontPx + 'px';
            m.style.lineHeight = '1.3';
            m.textContent = nextLyricText.value;
            const nextNaturalTextHeight = Math.max(0, Math.round(m.scrollHeight));
            const needTwoNext = nextNaturalTextHeight > (nextLinePx + 2);
            nextActiveTarget = needTwoNext ? nextTwoLines : nextOneLine;
        }

        // 盒子高度平滑过渡
        if (currentLyricBoxHeight.value !== target) currentLyricBoxHeight.value = target;
        if (nextLyricRowHeight.value !== nextActiveTarget) nextLyricRowHeight.value = nextActiveTarget;

        // 桌面端：按 1-2 行的差值同步调整独立歌词窗口高度（网页端没有这条通道，自动跳过）
        const nextActiveOne = (nextLyricText.value || '').trim() ? nextOneLine : 0;
        if (!baselineWindowHeightOneLine || !baselineWindowWidth) {
            try {
                const bounds = await window.electronAPI?.getLyricWindowBounds?.();
                if (bounds && typeof bounds.width === 'number' && typeof bounds.height === 'number') {
                    baselineWindowWidth = bounds.width;
                    baselineWindowHeightOneLine = Math.max(
                        100,
                        Math.round(bounds.height - (target - oneLine) - (nextActiveTarget - nextActiveOne))
                    );
                }
            } catch (_) {}
        }

        if (baselineWindowHeightOneLine && baselineWindowWidth) {
            const desiredWindowHeight = Math.max(
                120,
                baselineWindowHeightOneLine + (target - oneLine) + (nextActiveTarget - nextActiveOne)
            );
            if (Math.abs(desiredWindowHeight - lastAppliedHeight) >= 2) {
                lastAppliedHeight = desiredWindowHeight;
                // 仅调整高度，宽度保持不变
                window.electronAPI?.resizeWindow?.(baselineWindowWidth, desiredWindowHeight);
            }
        }
    } catch (_) {}
};

// —— 桌面端歌词窗口拖拽 / 锁定（仅 Electron 歌词窗口；网页端 PiP 由宿主浏览器接管） ——
// 平台检测：Windows/Linux 走 JS 拖拽，macOS 保持原生 drag
const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const isMac = /Macintosh|Mac OS X|MacOS|Darwin/i.test(ua);
const isWinOrLinux = !isMac && /(Windows|Linux|X11|Wayland)/i.test(ua);

// 拖拽控制（仅 Windows/Linux 桌面端启用纯 JS 移动窗口）
const isDragging = ref(false);
const dragStartScreen = ref({ x: 0, y: 0 });
const dragStartSize = ref({ width: 0, height: 0 });
const dragCurrentPos = ref({ x: 0, y: 0 });
const originalMinMax = ref(null);
let dragMoveRaf = 0;
let dragConstraintToken = 0;
let pendingDragDelta = { x: 0, y: 0 };

const resetPendingDragDelta = () => {
    pendingDragDelta = { x: 0, y: 0 };
};

const setDragWindowBounds = bounds => {
    dragStartSize.value = { width: bounds.width, height: bounds.height };
    dragCurrentPos.value = { x: bounds.x, y: bounds.y };
};

const addDragDocumentListeners = () => {
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
};

const removeDragDocumentListeners = () => {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
};

const restoreDragWindowConstraints = () => {
    if (originalMinMax.value) {
        const { minWidth, minHeight, maxWidth, maxHeight } = originalMinMax.value;
        window.electronAPI?.setLyricWindowMinMax?.(minWidth, minHeight, maxWidth, maxHeight);
    }
    originalMinMax.value = null;
    window.electronAPI?.setLyricWindowResizable?.(true);
};

const resetDragInteractionState = ({ restoreConstraints = false } = {}) => {
    const wasDragging = isDragging.value;
    dragConstraintToken += 1;
    isDragging.value = false;
    if (restoreConstraints && (wasDragging || originalMinMax.value)) restoreDragWindowConstraints();
    else originalMinMax.value = null;
    document.body.style.userSelect = '';
    resetPendingDragDelta();
    releaseDragFrame();
    removeDragDocumentListeners();
};

const flushPendingDragMove = () => {
    if (!ipcMode || !isWinOrLinux || !isDragging.value) return;
    const dx = pendingDragDelta.x;
    const dy = pendingDragDelta.y;
    if (!dx && !dy) return;

    resetPendingDragDelta();

    const newX = Math.round(dragCurrentPos.value.x + dx);
    const newY = Math.round(dragCurrentPos.value.y + dy);
    if (newX === dragCurrentPos.value.x && newY === dragCurrentPos.value.y) return;

    dragCurrentPos.value = { x: newX, y: newY };
    window.electronAPI?.moveLyricWindowContentTo?.(newX, newY, dragStartSize.value.width, dragStartSize.value.height);
};

const schedulePendingDragMove = () => {
    if (dragMoveRaf) return;
    dragMoveRaf = requestAnimationFrame(() => {
        dragMoveRaf = 0;
        flushPendingDragMove();
    });
};

const releaseDragFrame = () => {
    if (!dragMoveRaf) return;
    cancelAnimationFrame(dragMoveRaf);
    dragMoveRaf = 0;
};

const primeDragWindowConstraints = async () => {
    if (!ipcMode || !isWinOrLinux || !isDragging.value) return;
    const token = ++dragConstraintToken;
    try {
        window.electronAPI?.setLyricWindowResizable?.(false);
        const minMax = await window.electronAPI?.getLyricWindowMinMax?.();
        if (token !== dragConstraintToken || !isDragging.value) return;
        originalMinMax.value = minMax || null;
        if (!originalMinMax.value) return;

        window.electronAPI?.setLyricWindowMinMax?.(
            dragStartSize.value.width,
            dragStartSize.value.height,
            dragStartSize.value.width,
            dragStartSize.value.height
        );
    } catch (_) {
        if (token === dragConstraintToken) originalMinMax.value = null;
    }
};

const onDragStart = async (e) => {
    if (!ipcMode || !isWinOrLinux || locked.value) return;
    // 仅响应左键
    if (e.button !== 0) return;
    try {
        e.preventDefault();
        e.stopPropagation();
        const contentBounds = await window.electronAPI?.getLyricWindowContentBounds?.();
        const useBounds = contentBounds || await window.electronAPI?.getLyricWindowBounds?.();
        if (!useBounds) return;

        setDragWindowBounds(useBounds);
        originalMinMax.value = null;
        isDragging.value = true;
        dragStartScreen.value = { x: e.screenX, y: e.screenY };
        resetPendingDragDelta();
        releaseDragFrame();
        // 防止选中文本
        document.body.style.userSelect = 'none';
        // 监听全局移动/松开，避免移出手柄就终止
        addDragDocumentListeners();
        primeDragWindowConstraints();
    } catch (_) {}
};

const onDragMove = (e) => {
    if (!ipcMode || !isWinOrLinux || !isDragging.value) return;
    // 使用 movementX/movementY 作为增量，保证平滑
    const dx = e.movementX ?? (e.screenX - dragStartScreen.value.x);
    const dy = e.movementY ?? (e.screenY - dragStartScreen.value.y);

    pendingDragDelta.x += dx;
    pendingDragDelta.y += dy;

    // 兼容无 movementX/Y 的场景，复位起点
    if (e.movementX == null || e.movementY == null) {
        dragStartScreen.value = { x: e.screenX, y: e.screenY };
    }

    schedulePendingDragMove();
};

const onDragEnd = () => {
    if (!ipcMode || !isWinOrLinux || !isDragging.value) return;
    releaseDragFrame();
    flushPendingDragMove();
    resetDragInteractionState({ restoreConstraints: true });
};

// 当歌词文本或字体大小变化后，重新评估是否需要两行（需放在布局函数定义之后）
watchEffect(() => {
    // 依赖当前与下一句歌词、字号
    const _ = currentLyricText.value + '|' + (nextLyricText.value || '') + '|' + lyricFontSize.value;
    scheduleAdjustLyricLayout();
    renderLineScan();
});

// —— 桌面端：接收主窗口通过 IPC 推送的歌词数据 ——
// 消息里的 songSerial / syncSequence / seekSerial 交给 desktopLyricSync 校验，晚到的旧消息直接丢弃
const applyIpcCoverBackdrop = backdrop => {
    const urls = Array.isArray(backdrop?.urls)
        ? backdrop.urls.map(url => String(url || '').trim()).filter(Boolean)
        : [];

    coverBackdropCandidateIndex.value = 0;
    ipcCoverBackdrop.value = {
        urls,
        isSiren: !!backdrop?.isSiren,
    };
};

const handleLyricUpdate = (event, data) => {
    try {
        if (data.type === 'song-change') {
            const nextSyncState = resolveDesktopSongChangeState(data, {
                songSerial: activeSongSerial,
                songId: activeSongId,
                lastSyncSequence: lastLyricSyncSequence,
                progress: ipcProgress.value,
                currentLyricIndex: ipcCurrentLyricIndex.value,
            });
            if (nextSyncState.ignored) return;
            activeSongSerial = nextSyncState.songSerial;
            activeSongId = nextSyncState.songId;
            const incomingSyncSequence = Number(data.syncSequence);
            if (Number.isInteger(incomingSyncSequence)) {
                lastLyricSyncSequence = incomingSyncSequence;
            }
            if (nextSyncState.songChanged) {
                seekSettlingUntilMs = 0;
                seekSettlingTargetSec = nextSyncState.progress;
                lastSeekSerial = -1;
            }
            ipcSong.value = data.song;
            ipcLyrics.value = Array.isArray(data.lyrics) ? data.lyrics : [];
            ipcCurrentLyricIndex.value = nextSyncState.currentLyricIndex;
            ipcProgress.value = nextSyncState.progress;
            if (typeof data.playing === 'boolean') {
                ipcPlaying.value = data.playing;
            }
            ipcDuration.value = normalizeDurationSeconds(data.duration || data.song?.duration);
            applyIpcCoverBackdrop(data.coverBackdrop);
            syncPlaybackClock(nextSyncState.progress, { snap: nextSyncState.songChanged });
            lyricIndex.value = Number.isInteger(nextSyncState.currentLyricIndex) ? nextSyncState.currentLyricIndex : -1;
            renderFrame();
            if (playing.value) startScanRaf();
            else stopScanRaf();
        } else if (data.type === 'lyric-progress') {
            const previousLyricIndex = ipcCurrentLyricIndex.value;
            const incomingSeekSerial = Number(data.seekSerial);
            const hasNewSeekSerial = Number.isInteger(incomingSeekSerial) && incomingSeekSerial !== lastSeekSerial;
            const isSeekSync = data.syncReason === 'seek' || hasNewSeekSerial;
            if (shouldIgnoreLyricProgressPayload(data, { isSeekSync })) return;
            if (hasNewSeekSerial) lastSeekSerial = incomingSeekSerial;
            if (isSeekSync) markSeekSettling(data.progress);
            const incomingSyncSequence = Number(data.syncSequence);
            if (Number.isInteger(incomingSyncSequence)) {
                lastLyricSyncSequence = incomingSyncSequence;
            }
            const incomingIndex = Number(data.currentIndex);
            ipcCurrentLyricIndex.value = Number.isInteger(incomingIndex) ? incomingIndex : -1;
            ipcProgress.value = Number(data.progress);
            ipcDuration.value = normalizeDurationSeconds(data.duration || ipcDuration.value);
            lyricIndex.value = ipcCurrentLyricIndex.value;
            syncPlaybackClock(data.progress, {
                snap: isSeekSync || previousLyricIndex !== ipcCurrentLyricIndex.value,
            });
            renderFrame();
            startScanRaf();
        } else if (data.type === 'play-state') {
            if (shouldIgnoreDesktopLyricMessage(data, {
                songSerial: activeSongSerial,
                songId: activeSongId,
                lastSyncSequence: lastLyricSyncSequence,
            })) return;
            const incomingSyncSequence = Number(data.syncSequence);
            if (Number.isInteger(incomingSyncSequence)) {
                lastLyricSyncSequence = incomingSyncSequence;
            }
            const nextPlaying = !!data.playing;
            if (!nextPlaying) {
                syncPlaybackClock(getVisualPlaybackProgress(), { snap: true });
                ipcPlaying.value = false;
                renderLineScan(playbackClockProgressSec);
                stopScanRaf();
            } else {
                ipcPlaying.value = true;
                syncPlaybackClock(ipcProgress.value, { snap: true });
                renderFrame();
                startScanRaf();
            }
        } else if (data.type === 'settings-change') {
            if (typeof data.customFontCss === 'string') {
                // 网页端 setFont 只同步 CSS 文本（桌面端则由主窗口推送字体名）
                const ownerDocument = rootRef.value?.ownerDocument || document;
                const existingStyle = ownerDocument.getElementById(CUSTOM_FONT_STYLE_ID);
                const style = existingStyle || ownerDocument.createElement('style');
                style.id = CUSTOM_FONT_STYLE_ID;
                style.textContent = data.customFontCss;
                if (!existingStyle && ownerDocument.head) ownerDocument.head.appendChild(style);
            } else {
                applyCustomFontStyle(data.customFont, data.customFontLabel);
            }
        }
    } catch (error) {
        // 静默处理错误
    }
};
// 右键菜单相关
const contextMenuVisible = ref(false);
const contextMenuX = ref(0);
const contextMenuY = ref(0);

const lyricWindow = () => rootRef.value?.ownerDocument?.defaultView || window;

const showContextMenu = event => {
    event.preventDefault();

    const view = lyricWindow();
    const windowWidth = view.innerWidth;
    const windowHeight = view.innerHeight;

    // 估算菜单尺寸（基于菜单项数量）
    const menuItemHeight = 40; // 每个菜单项的高度
    const menuHeader = 50; // 菜单头部高度
    const menuSeparators = 20; // 分隔符高度

    // 计算有多少个菜单项
    let menuItemCount = 1; // AUTO SELECT
    if (hasLyricType('original')) menuItemCount++;
    if (hasLyricType('trans')) menuItemCount++;
    if (hasLyricType('roma')) menuItemCount++;
    menuItemCount += ipcMode ? 3 : 2; // 锁定（仅桌面端）、增大字体、减小字体
    menuItemCount += 1; // 关闭歌词

    const estimatedMenuHeight = menuHeader + (menuItemCount * menuItemHeight) + (2 * menuSeparators);
    const menuWidth = 200; // 菜单宽度

    // 智能定位：避免菜单超出窗口
    let menuX = event.clientX;
    let menuY = event.clientY;

    if (menuX + menuWidth > windowWidth) {
        menuX = Math.max(0, event.clientX - menuWidth);
    }

    if (menuY + estimatedMenuHeight > windowHeight) {
        menuY = Math.max(0, event.clientY - estimatedMenuHeight);
    }

    contextMenuX.value = menuX;
    contextMenuY.value = menuY;
    contextMenuVisible.value = true;
};

const hideContextMenu = () => {
    contextMenuVisible.value = false;
};

const handleWindowBlur = () => {
    if (!contextMenuVisible.value) return;
    hideContextMenu();
};

// 菜单功能
// 桌面端：锁定/解锁歌词窗口位置（网页端 PiP 不显示该项，此处仅做防御性守卫）
const toggleLock = () => {
    locked.value = !locked.value;
    if (ipcMode) {
        window.electronAPI?.setLyricWindowMovable?.(!locked.value);
        resetDragInteractionState({ restoreConstraints: true });
    }
    hideContextMenu();
};

const adjustFontSize = delta => {
    lyricFontSize.value = Math.max(16, Math.min(48, lyricFontSize.value + delta));
    hideContextMenu();
};

const closeLyric = () => {
    hideContextMenu();

    // 桌面端由主窗口关闭独立歌词窗口；网页端由宿主关闭 PiP 浮窗
    if (ipcMode) {
        try {
            window.electronAPI.notifyLyricWindowClosed?.();
            window.electronAPI.closeLyricWindow?.();
        } catch (_) {}
        return;
    }

    emit('close');
};

// 歌词显示模式切换
const selectLyricType = type => {
    selectedLyricType.value = type;
    hideContextMenu();
};

onMounted(() => {
    const doc = rootRef.value?.ownerDocument || document;
    const view = doc.defaultView || window;
    lyricDocument = doc;

    // 桌面端：订阅主窗口推送的歌词数据，并主动请求一次当前快照
    if (ipcMode) {
        try {
            removeLyricUpdateListener = window.electronAPI.onLyricUpdate?.(handleLyricUpdate) || null;
            window.electronAPI.requestLyricData?.();
        } catch (_) {}
    }

    doc.addEventListener('click', hideContextMenu);
    view.addEventListener('blur', handleWindowBlur);

    // 监听当前歌词盒子尺寸变化，实时自适应 1-2 行
    try {
        if (view.ResizeObserver) {
            lyricResizeObserver = new view.ResizeObserver(() => scheduleAdjustLyricLayout());
            if (lyricElementRef.value) lyricResizeObserver.observe(lyricElementRef.value);
        } else {
            view.addEventListener('resize', scheduleAdjustLyricLayout);
        }
    } catch (_) {}

    scheduleAdjustLyricLayout();
});

onUnmounted(() => {
    stopScanRaf();

    removeLyricUpdateListener?.();
    removeLyricUpdateListener = null;

    const doc = lyricDocument || document;
    const view = doc.defaultView || window;
    doc.removeEventListener('click', hideContextMenu);
    view.removeEventListener('blur', handleWindowBlur);

    // 桌面端：卸载时释放拖拽态并还原窗口尺寸约束；网页端无该通道
    if (ipcMode) resetDragInteractionState({ restoreConstraints: true });

    if (rafAdjust) {
        cancelAnimationFrame(rafAdjust);
        rafAdjust = 0;
    }
    removeMeasureEl();

    if (lyricResizeObserver) {
        try { lyricResizeObserver.disconnect(); } catch (_) {}
        lyricResizeObserver = null;
    } else {
        view.removeEventListener('resize', scheduleAdjustLyricLayout);
    }

    lyricDocument = null;
});
</script>

<style scoped lang="scss">
// 明日方舟风格桌面歌词样式
.arknights-desktop-lyric {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;

    font-family: 'SourceHanSansCN-Bold', 'Bender-Bold', monospace;
    user-select: none;
    overflow: hidden;

    background: transparent !important;

    // 桌面端：macOS 根容器启用原生 drag；Win/Linux 禁用原生，走 JS 拖拽
    &.native-drag {
        -webkit-app-region: drag;
    }
    &:not(.native-drag) {
        -webkit-app-region: no-drag;
    }
    &.draggable {
        /* 由特定手柄控制拖拽，根容器不再强制拖拽与光标样式 */
    }

    // 进入动画 - 改进版本，更流畅
    animation: lyricWindowAppear 0.6s cubic-bezier(0.4, 0, 0.12, 1) forwards;

    @keyframes lyricWindowAppear {
        0% {
            opacity: 0;
            transform: scale(0.9) translateY(20px);
        }
        60% {
            opacity: 0.8;
            transform: scale(1.02) translateY(-2px);
        }
        100% {
            opacity: 1;
            transform: scale(1) translateY(0);
        }
    }
}

// 背景分层系统
.background-layers {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1;

    .cover-backdrop {
        position: absolute;
        inset: 0;
        z-index: 0;
        overflow: hidden;
        pointer-events: none;

        &::after {
            content: '';
            position: absolute;
            inset: 0;
            z-index: 1;
            background: var(--cover-backdrop-overlay, rgba(255, 255, 255, 0.28));
        }
    }

    .cover-backdrop-image {
        position: absolute;
        inset: -12%;
        display: block;
        width: 124%;
        height: 124%;
        object-fit: cover;
        filter: blur(38px) saturate(140%) brightness(1.08);
        transform: scale(1.08);
        transform-origin: center;
    }

    .cover-backdrop-siren .cover-backdrop-image {
        filter: blur(38px) saturate(150%) brightness(1.18);
    }

    .bg-layer {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 1;

        &.bg-primary {
            // 原浅色风格：蓝绿色渐变 + 模糊
            background: linear-gradient(rgba(176, 209, 217, 0.95) -20%, rgba(176, 209, 217, 0.7) 50%, rgba(176, 209, 217, 0.95) 120%);
            backdrop-filter: blur(20px);
        }

        &.bg-secondary {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(0, 0, 0, 0.1);
            margin: 8px;
        }
    }
}

.cover-blur-active {
    .background-layers {
        .bg-layer.bg-primary {
            background: rgba(255, 255, 255, 0.22);
            backdrop-filter: blur(14px);
        }

        .bg-layer.bg-secondary {
            background: rgba(255, 255, 255, 0.14);
            border-color: rgba(0, 0, 0, 0.16);
        }
    }

    .song-info-section {
        background: rgba(255, 255, 255, 0.24);
    }

    .main-lyric-section {
        background: rgba(255, 255, 255, 0.18);
    }

    .progress-section {
        background: rgba(255, 255, 255, 0.12);
    }
}

.desktop-cover-fade-enter-active,
.desktop-cover-fade-leave-active {
    transition: opacity 0.35s ease;
}

.desktop-cover-fade-enter-from,
.desktop-cover-fade-leave-to {
    opacity: 0;
}

// 主内容区域
.lyric-content {
    position: relative;
    width: 100%;
    height: 100%;
    padding: 16px;
    z-index: 5;

    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
}

// 顶部状态栏
.status-bar {
    position: relative;

    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 24px;

    // 置顶浮窗下可拖动窗口；普通弹窗中该属性无效果
    -webkit-app-region: drag;
    user-select: none;

    // 桌面端：macOS 使用原生拖拽；Win/Linux 关闭原生拖拽，走 JS 拖拽并允许右键
    &.drag-handle { /* Win/Linux 下用于禁止原生拖拽 */
        -webkit-app-region: no-drag;
        user-select: none;
    }
    &.dragging { /* 不强制光标，保持原版 */ }
    &.native-drag { -webkit-app-region: drag; user-select: none; }

    .status-indicator {
        display: flex;
        align-items: center;
        gap: 8px;

        .indicator-dot {
            width: 8px;
            height: 8px;
            border: 1px solid var(--border);
            background: var(--layer);
            transition: all 0.3s ease;
        }

        .status-text {
            font-family: 'Bender-Bold', monospace;
            font-size: 9px;
            font-weight: bold;
            color: var(--muted-text);
            letter-spacing: 1px;
        }

        &.active {
            .indicator-dot {
                background: var(--text);
                border-color: var(--text);
                box-shadow: 0 0 8px rgba(0, 0, 0, 0.35);
                animation: statusPulse 2s ease-in-out infinite;
            }

            .status-text { color: var(--text); }
        }
    }

    .lyric-controls {
        .font-size-label {
            font-family: 'Bender-Bold', monospace;
            font-size: 9px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.5);
            letter-spacing: 1px;
        }
    }

    @keyframes statusPulse {
        0%,
        100% {
            transform: scale(1);
        }
        50% {
            transform: scale(1.2);
        }
    }
}

// 歌曲信息区域
.song-info-section {
    position: relative;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(0, 0, 0, 0.1);
    padding: 8px 12px;
    flex-shrink: 0;

    .song-meta {
        position: relative;
        z-index: 2;

        .meta-row {
            display: flex;
            align-items: center;
            margin-bottom: 6px;
            gap: 12px;

            &:last-child {
                margin-bottom: 0;
            }

            .meta-label {
                font-family: 'Bender-Bold', monospace;
                font-size: 8px;
                font-weight: bold;
                color: rgba(0, 0, 0, 0.6);
                letter-spacing: 1px;
                min-width: 40px;
                text-align: right;
            }

            .meta-content {
                font-family: 'SourceHanSansCN-Bold';
                font-size: 12px;
                font-weight: bold;
                color: #000000;
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
        }
    }
}

// 主歌词显示区域
.main-lyric-section {
    position: relative;
    flex: 1;
    background: rgba(255, 255, 255, 0.15);
    border: 2px solid rgba(0, 0, 0, 0.2);
    min-height: 120px;

    display: flex;
    flex-direction: column;
    justify-content: center;

    .lyric-container {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        padding: 16px 20px;
        gap: 12px;

        .lyric-prefix {
            font-family: 'Bender-Bold', monospace;
            font-size: 16px;
            font-weight: bold;
            color: #666666; // 改为灰色
            text-shadow: 0 0 8px rgba(102, 102, 102, 0.6);
            animation: prefixGlow 3s ease-in-out infinite alternate;
        }

        .current-lyric {
            font-family: 'SourceHanSansCN-Bold';
            flex: 1;
            text-align: left;
            max-width: 400px; // 适配更短的窗口
            word-wrap: break-word;
            overflow-wrap: break-word;
            line-height: 1.4;
            min-height: 60px;
            position: relative;
            overflow: hidden;
            transition: height 0.22s cubic-bezier(0.3, 0, 0.12, 1);
            background: transparent !important;
            padding: 12px 16px;
            border-radius: 0; // 直角设计
            color: var(--lyric-scan-outside-text) !important;
            --scan-progress: 0%;

            &.line-scan-active::after {
                content: '';
                position: absolute;
                inset: 0;
                z-index: 1;
                pointer-events: none;
                background: var(--lyric-hilight-bg);
                transform: translate3d(calc(-100% + var(--scan-progress, 0%)), 0, 0);
                will-change: transform;
            }

            .current-lyric-scan-text {
                position: absolute;
                inset: 0;
                z-index: 2;
                pointer-events: none;
                box-sizing: border-box;
                padding: 12px 16px;
                color: var(--lyric-scan-inside-text) !important;
                line-height: 1.4;
                font-weight: bold;
                word-wrap: break-word;
                overflow-wrap: break-word;
                clip-path: inset(0 calc(100% - var(--scan-progress, 0%)) 0 0);
                will-change: clip-path;
            }
        }
    }

    .next-lyric-preview {
        position: relative;
        z-index: 2;
        display: flex;
        align-items: center;
        padding: 6px 20px 10px;
        gap: 10px;
        border-top: 1px solid rgba(0, 0, 0, 0.1);
        transition: height 0.22s cubic-bezier(0.3, 0, 0.12, 1);

        .preview-indicator {
            font-family: 'Bender-Bold', monospace;
            font-size: 8px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.5);
            letter-spacing: 1px;
            min-width: 30px;
        }

        .next-lyric {
            font-family: 'SourceHanSansCN-Bold';
            color: rgba(0, 0, 0, 0.6);
            line-height: 1.3;
            flex: 1;
            text-align: left;
            word-wrap: break-word;
        }
    }

    @keyframes prefixGlow {
        0% {
            text-shadow: 0 0 8px rgba(102, 102, 102, 0.6);
        }
        100% {
            text-shadow: 0 0 15px rgba(102, 102, 102, 0.9), 0 0 25px rgba(102, 102, 102, 0.4);
        }
    }
}

// 进度指示器
.progress-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.05);
    padding: 8px 12px;
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-radius: 0; // 直角设计

    .progress-label {
        font-family: 'Bender-Bold', monospace;
        font-size: 8px;
        font-weight: bold;
        color: rgba(0, 0, 0, 0.6);
        letter-spacing: 1px;
        text-align: center;
    }

    .progress-bar {
        position: relative;
        height: 4px;
        background: rgba(0, 0, 0, 0.2);
        border: 1px solid rgba(0, 0, 0, 0.3);
        border-radius: 0; // 直角设计
        overflow: hidden;

        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #000000, #333333);
            transition: width 0.5s ease;
            position: relative;

            &::after {
                content: '';
                position: absolute;
                top: 0;
                right: -8px;
                width: 8px;
                height: 100%;
                background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.8));
                animation: progressShine 2s ease-in-out infinite;
            }
        }

        .progress-indicator {
            position: absolute;
            top: -2px;
            right: 0;
            width: 8px;
            height: 8px;
            background: #000000;
            border: 1px solid #333333;
            border-radius: 0; // 直角设计
            opacity: 0.8;
        }
    }

    .progress-info {
        display: flex;
        justify-content: center;
        gap: 4px;

        span {
            font-family: 'Bender-Bold', monospace;
            font-size: 8px;
            font-weight: bold;
            color: rgba(0, 0, 0, 0.5);
            letter-spacing: 1px;
        }
    }

    @keyframes progressShine {
        0%,
        100% {
            opacity: 0;
        }
        50% {
            opacity: 1;
        }
    }
}

// 明日方舟风格右键菜单的样式已抽到 assets/css/contextMenu.scss（与 Title.vue 的来源菜单共用），
// 见本组件末尾的非 scoped 样式块。

// 响应式设计：置顶浮窗尺寸由用户拖动调整，内容按窗口大小自适应
@media (max-width: 520px) {
    .lyric-content {
        padding: 12px;
        gap: 8px;
    }

    .lyric-container {
        padding: 12px 16px;
        gap: 8px;

        .lyric-prefix {
            font-size: 14px;
            color: #666666;
        }

        .current-lyric {
            max-width: none;
            min-height: 50px;
        }
    }

    .next-lyric-preview {
        padding: 6px 16px 8px;
    }
}

@media (max-height: 320px) {
    .song-info-section {
        display: none;
    }

    .progress-section {
        display: none;
    }
}

// 深色模式覆盖：保留浅色模式原视觉，仅在 .dark 下替换为应用主题变量
.dark .arknights-desktop-lyric .background-layers .bg-primary { background: var(--panel) !important; backdrop-filter: blur(16px); }
.dark .arknights-desktop-lyric .background-layers .bg-secondary { background: var(--layer) !important; border: 1px solid var(--border) !important; }
.dark .arknights-desktop-lyric .song-info-section { background: var(--layer) !important; border-color: var(--border) !important; }
.dark .arknights-desktop-lyric .main-lyric-section { background: var(--layer) !important; border-color: var(--border) !important; }
.dark .arknights-desktop-lyric .next-lyric-preview { border-top-color: var(--border) !important; }
.dark .arknights-desktop-lyric .progress-section { background: var(--layer) !important; border-color: var(--border) !important; }
.dark .arknights-desktop-lyric .progress-section .progress-label { color: var(--muted-text) !important; }
.dark .arknights-desktop-lyric .progress-section .progress-bar { background: rgba(255,255,255,0.08) !important; border-color: var(--border) !important; }
.dark .arknights-desktop-lyric .progress-section .progress-bar .progress-fill { background: var(--text) !important; }
.dark .arknights-desktop-lyric .progress-section .progress-bar .progress-indicator { background: var(--text) !important; border-color: var(--border) !important; }
.dark .arknights-desktop-lyric .status-indicator .status-text { color: var(--muted-text) !important; }

.dark .arknights-desktop-lyric.cover-blur-active .background-layers .bg-primary { background: rgba(28,28,30,0.34) !important; backdrop-filter: blur(14px) !important; }
.dark .arknights-desktop-lyric.cover-blur-active .background-layers .bg-secondary { background: rgba(28,28,30,0.34) !important; border-color: rgba(255,255,255,0.16) !important; }
.dark .arknights-desktop-lyric.cover-blur-active .song-info-section,
.dark .arknights-desktop-lyric.cover-blur-active .main-lyric-section,
.dark .arknights-desktop-lyric.cover-blur-active .progress-section { background: rgba(28,28,30,0.46) !important; border-color: rgba(255,255,255,0.16) !important; }
.dark .arknights-desktop-lyric.cover-blur-active .next-lyric-preview { border-top-color: rgba(255,255,255,0.16) !important; }

/* 右键菜单深色主题已随菜单样式一起抽到 assets/css/contextMenu.scss */

/* macOS: 全窗口原生拖拽（覆盖内部 no-drag），保留菜单可交互 */
.arknights-desktop-lyric.native-drag,
.arknights-desktop-lyric.native-drag .lyric-content,
.arknights-desktop-lyric.native-drag .status-bar,
.arknights-desktop-lyric.native-drag .song-info-section,
.arknights-desktop-lyric.native-drag .main-lyric-section,
.arknights-desktop-lyric.native-drag .current-lyric,
.arknights-desktop-lyric.native-drag .progress-section {
  -webkit-app-region: drag;
}

/* 右键菜单保持可交互 */
.arknights-desktop-lyric.native-drag .arknights-context-menu,
.arknights-desktop-lyric.native-drag .arknights-context-menu * {
  -webkit-app-region: no-drag;
}
</style>

<style lang="scss">
// 明日方舟风格右键菜单样式：抽到公共文件，与左上角 LOGO 的平台来源菜单共用同一份。
// 这里用非 scoped 块引入，桌面歌词的独立窗口（desktop-lyric.html）与网页端 PiP 都能拿到同一套规则。
@use '@/assets/css/contextMenu.scss';
</style>