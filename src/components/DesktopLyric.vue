<template>
    <div
        ref="rootRef"
        class="arknights-desktop-lyric"
        :class="{ 'cover-blur-active': showCoverBackdrop }"
        @contextmenu.prevent.stop="showContextMenu"
        @click="hideContextMenu"
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
            <!-- 顶部状态栏（兼作置顶浮窗的拖拽手柄） -->
            <div class="status-bar">
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
                        :data-lyric="currentLyricText"
                        :class="{ 'line-scan-active': lineScanActive }"
                        :style="{
                            fontSize: lyricFontSize + 'px',
                            opacity: currentLyricOpacity,
                            height: currentLyricBoxHeight > 0 ? (currentLyricBoxHeight + 'px') : undefined,
                        }"
                    >
                        {{ currentLyricText }}
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

// 歌词窗口与主窗口共享同一套 Pinia 状态：歌词、进度、播放状态直接取自 store，
// 不再需要桌面端的 IPC 数据推送协议。
const emit = defineEmits(['close']);

const playerStore = usePlayerStore(pinia);
const {
    coverBlur,
    currentIndex,
    currentLyricIndex,
    localBase64Img,
    lyricsObjArr,
    playing,
    showSongTranslation,
    songId,
    songList,
    time,
} = storeToRefs(playerStore);

const rootRef = ref(null);
const currentSong = computed(() => getIndexedSong(songList.value, currentIndex.value));
const lyricsArray = computed(() => (Array.isArray(lyricsObjArr.value) ? lyricsObjArr.value : []));

// 当前位置由歌词窗口自己的动画帧直接读取音频进度，主页面被遮挡/后台节流时仍能逐帧对齐
const lyricIndex = ref(-1);
let visualProgressSec = 0;
let scanRaf = 0;

const MIN_LINE_SCAN_DURATION_SEC = 0.8;
const MAX_LINE_SCAN_DURATION_SEC = 4.8;
const SCAN_COMPLETE_HOLD_SEC = 0.18;

// 歌词显示类型配置 - 单选模式
const selectedLyricType = ref('auto'); // 'auto' | 'original' | 'trans' | 'roma'
const lyricFontSize = ref(22);

// 封面模糊背景
const coverBackdropCandidateIndex = ref(0);
const coverBackdrop = computed(() => {
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
    } catch (_) {}
};

// 当歌词文本或字体大小变化后，重新评估是否需要两行（需放在布局函数定义之后）
watchEffect(() => {
    // 依赖当前与下一句歌词、字号
    const _ = currentLyricText.value + '|' + (nextLyricText.value || '') + '|' + lyricFontSize.value;
    scheduleAdjustLyricLayout();
    renderLineScan();
});

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
    menuItemCount += 2; // 增大/减小字体
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
const adjustFontSize = delta => {
    lyricFontSize.value = Math.max(16, Math.min(48, lyricFontSize.value + delta));
    hideContextMenu();
};

const closeLyric = () => {
    hideContextMenu();
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

    const doc = lyricDocument || document;
    const view = doc.defaultView || window;
    doc.removeEventListener('click', hideContextMenu);
    view.removeEventListener('blur', handleWindowBlur);

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

            &.line-scan-active::before {
                content: attr(data-lyric);
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

// 明日方舟风格右键菜单
.arknights-context-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999998;
    background: transparent;
}

.arknights-context-menu {
    position: fixed;
    min-width: 200px;
    max-width: 250px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(20px);
    border: 2px solid rgba(0, 0, 0, 0.2);
    border-radius: 0; // 直角设计
    z-index: 999999; // 极高层级确保显示在最顶层

    // 确保菜单可以超出父容器和窗口边界
    overflow-x: hidden; // 隐藏水平滚动条
    overflow-y: auto; // 保持垂直滚动

    // 最大高度限制，防止菜单过长
    max-height: 85vh;

    box-sizing: border-box;
    contain: none;

    animation: menuSlideIn 0.4s cubic-bezier(0.4, 0, 0.12, 1) forwards;

    @keyframes menuSlideIn {
        0% {
            opacity: 0;
            transform: scale(0.9) translateY(-15px);
        }
        60% {
            opacity: 0.9;
            transform: scale(1.02) translateY(2px);
        }
        100% {
            opacity: 1;
            transform: scale(1) translateY(0);
        }
    }

    .menu-header {
        padding: 12px 16px 8px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        background: linear-gradient(rgba(176, 209, 217, 0.75) -20%, rgba(176, 209, 217, 0.60) 50%, rgba(176, 209, 217, 0.75) 120%);
        backdrop-filter: blur(8px);
        flex-shrink: 0; // 防止头部被压缩
        position: sticky;
        top: 0;
        z-index: 10; // 提高z-index确保标题始终在最上层
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); // 添加阴影增强层次感

        .menu-title {
            font-family: 'Bender-Bold', monospace;
            font-size: 11px;
            font-weight: bold;
            color: #000000;
            letter-spacing: 1px;
        }

        .title-underline {
            width: 40px;
            height: 2px;
            background: #000000;
            margin-top: 4px;
        }
    }

    .menu-content {
        padding: 8px 0;
        display: flex;
        flex-direction: column;
        min-height: 0; // 允许内容收缩
    }

    .menu-item {
        display: flex;
        align-items: center;
        padding: 8px 20px 8px 16px; // 右边多留4px空间给偏移动画
        cursor: pointer;
        transition: all 0.2s ease;
        gap: 12px;
        position: relative;
        flex-shrink: 0; // 防止菜单项被压缩
        min-height: 36px; // 设置最小高度
        box-sizing: border-box; // 确保padding不会导致溢出

        &:hover {
            background: rgba(0, 0, 0, 0.1);
            transform: translateX(4px); // 恢复向右偏移动画
            padding-right: 16px; // hover时减少右padding保持总宽度不变

            .item-icon {
                transform: scale(1.1);
            }

            .item-indicator {
                opacity: 1;
                transform: scaleX(1);
            }
        }

        &.danger:hover {
            background: rgba(255, 69, 58, 0.2);
            color: #ff453a;

            .item-icon {
                filter: drop-shadow(0 0 5px rgba(255, 69, 58, 0.5));
            }
        }

        .item-icon {
            font-size: 12px;
            width: 16px;
            height: 16px;
            text-align: center;
            transition: all 0.2s ease;
            flex-shrink: 0; // 防止图标被压缩
            color: #000000; // 明亮模式下使用黑色，暗色在主题覆盖
            display: inline-flex;
            align-items: center;
            justify-content: center;

            svg { width: 12px; height: 12px; display: block; }

            .selection-mark {
                width: 9px;
                height: 9px;
                border: 1.5px solid currentColor;
                box-sizing: border-box;
                display: block;
                transform: rotate(45deg);
                transition: background-color 0.16s ease, box-shadow 0.16s ease;

                &.selected {
                    background: currentColor;
                    box-shadow: inset 0 0 0 2px var(--panel);
                }
            }
        }

        .item-text {
            font-family: 'Bender-Bold', monospace;
            font-size: 10px;
            font-weight: bold;
            color: #000000;
            letter-spacing: 0.5px;
            flex: 1;
            white-space: nowrap; // 防止文字换行
            overflow: hidden;
            text-overflow: ellipsis;
            position: relative; // 承载双语堆叠
            height: 1.2em; // 固定高度，避免切换时跳动
            line-height: 1.2em;

            .text-zh,
            .text-en {
                position: absolute;
                left: 0;
                right: 0;
                top: 0;
                bottom: 0;
                display: block;
                transition: transform 0.22s cubic-bezier(0.4, 0, 0.12, 1), opacity 0.22s ease;
            }

            /* 中文稍大、去字距并使用中文字体族 */
            .text-zh {
                opacity: 1;
                transform: translateY(0);
                font-size: 11px; /* 比英文略大一号 */
                letter-spacing: 0; /* 中文通常无需额外字距 */
                font-family: 'SourceHanSansCN-Bold', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Noto Sans CJK SC', sans-serif;
            }
            .text-en { opacity: 0; transform: translateY(6px); }
        }

        &:hover .item-text {
            .text-zh { opacity: 0; transform: translateY(-6px); }
            .text-en { opacity: 1; transform: translateY(0); }
        }

        .item-indicator {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 3px;
            background: #000000;
            opacity: 0;
            transform: scaleX(0);
            transform-origin: right;
            transition: all 0.2s ease;
        }
    }

    .menu-separator {
        margin: 4px 0;
        padding: 0 16px;
        flex-shrink: 0; // 防止分隔符被压缩

        .separator-line {
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.3), transparent);
        }
    }

    // 自定义滚动条样式
    &::-webkit-scrollbar {
        width: 6px;
    }

    &::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.1);
        border-radius: 0;
    }

    &::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.4);
        border-radius: 0;

        &:hover {
            background: rgba(0, 0, 0, 0.6);
        }

        &:active {
            background: rgba(0, 0, 0, 0.8);
        }
    }

    &::-webkit-scrollbar-corner {
        background: transparent;
    }
}

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

/* 右键菜单深色主题 */
.dark .arknights-desktop-lyric .arknights-context-menu { background: var(--panel) !important; border-color: var(--border) !important; color: var(--text) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-header { background: var(--layer) !important; border-bottom-color: var(--border) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-title { color: var(--text) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .title-underline { background: var(--text) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item { color: var(--text) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item .item-text { color: var(--text) !important; background: transparent !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item .item-icon { color: var(--text) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item .item-indicator { background: var(--text) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item:hover { background: rgba(255,255,255,0.08) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-separator .separator-line { background: linear-gradient(90deg, transparent, rgba(255,255,255,0.25), transparent) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu::-webkit-scrollbar-track { background: transparent !important; }
.dark .arknights-desktop-lyric .arknights-context-menu::-webkit-scrollbar-thumb { background: transparent !important; }
.dark .arknights-desktop-lyric .arknights-context-menu:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.35) !important; }
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item.danger:hover {
  background: rgba(255, 69, 58, 0.22) !important;
  color: #ff453a !important;
}
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item.danger:hover .item-text,
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item.danger:hover .item-icon {
  color: #ff453a !important;
}
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item.danger:hover .item-indicator {
  background: #ff453a !important;
}
.dark .arknights-desktop-lyric .arknights-context-menu .menu-item.danger:hover .item-icon {
  filter: drop-shadow(0 0 5px rgba(255, 69, 58, 0.55)) !important;
}
</style>