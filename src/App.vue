<script setup>
import { defineAsyncComponent, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import Home from './views/Home.vue';
import Title from './components/Title.vue';
import SearchInput from './components/SearchInput.vue';
import MusicWidget from './components/MusicWidget.vue';
import AudioVisualizer from './components/AudioVisualizer.vue';
import PlatformSourceSwitch from './components/PlatformSourceSwitch.vue';
import WindowControl from './components/WindowControl.vue';
import { destroyLyricRuntime, initLyricRuntime } from './composables/usePlayerRuntime';
import { usePlaylistSync } from './composables/usePlaylistSync';
import { destroyDesktopLyric, initDesktopLyric } from './utils/desktopLyric';
import { initKeyboardShortcuts, destroyKeyboardShortcuts } from './utils/keyboardShortcuts';
import { initAppUpdateCheck } from './utils/appUpdate';

import { usePlayerStore, initPlayerPersistence } from './store/playerStore';
import { useOtherStore } from './store/otherStore';
import { useUserStore } from './store/userStore';

const MusicPlayer = defineAsyncComponent(() => import('./views/MusicPlayer.vue'));
const VideoPlayer = defineAsyncComponent(() => import('./components/VideoPlayer.vue'));
const ContextMenu = defineAsyncComponent(() => import('./components/ContextMenu.vue'));
const GlobalDialog = defineAsyncComponent(() => import('./components/GlobalDialog.vue'));
const GlobalNotice = defineAsyncComponent(() => import('./components/GlobalNotice.vue'));
const DownloadQualityDialog = defineAsyncComponent(() => import('./components/DownloadQualityDialog.vue'));
const Update = defineAsyncComponent(() => import('./components/Update.vue'));

const playerStore = usePlayerStore();
const otherStore = useOtherStore();
const userStore = useUserStore();
// 桌面端（Electron）由 preload 注入 windowApi，网页端不存在该全局
const isDesktopEnv = typeof windowApi !== 'undefined';
usePlaylistSync();

// 平台来源开关跟随全局搜索框，只在首页与搜索页出现
const router = useRouter();
const showPlatformSwitch = computed(() => {
    const name = String(router.currentRoute.value.name || '');
    return name === 'homepage' || name === 'search';
});

const removeCheckUpdateListener = isDesktopEnv && typeof windowApi.checkUpdate === 'function'
    ? windowApi.checkUpdate((version) => {
        otherStore.toUpdate = true;
        otherStore.newVersion = version;
    })
    : null;

// 音频可视化只在播放页（非挂件态）且有播放实例时显示
const visualizerActive = computed(() => {
    return playerStore.audioVisualizer && playerStore.playerShow && !playerStore.widgetState && !!playerStore.currentMusic
});

const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
    } else {
        await document.exitFullscreen();
    }
};

const preventBrowserContextMenu = e => {
    const target = e.target;
    const tagName = String(target?.tagName || '').toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'a' || target?.isContentEditable) {
        return;
    }
    e.preventDefault();
};

onMounted(() => {
    initLyricRuntime();
    initDesktopLyric();
    initPlayerPersistence();
    document.addEventListener('contextmenu', preventBrowserContextMenu);
    // 网页端自建快捷键与更新提示；桌面端由 Electron 菜单加速键/全局快捷键与更新通道负责
    if (!isDesktopEnv) {
        initKeyboardShortcuts();
        initAppUpdateCheck();
    }
});

onUnmounted(() => {
    destroyDesktopLyric();
    destroyLyricRuntime();
    document.removeEventListener('contextmenu', preventBrowserContextMenu);
    if (!isDesktopEnv) destroyKeyboardShortcuts();
    removeCheckUpdateListener?.();
});

// 双击标题栏最大化窗口的处理函数
const handleTitleBarDoubleClick = () => {
    windowApi.windowMax('window-max');
};
</script>

<template>
    <div class="mainWindow">
        <Transition name="home">
            <Home class="home" v-show="playerStore.widgetState"></Home>
        </Transition>
    </div>
    <div class="globalWidget" :class="{ 'visualizer-active': visualizerActive, 'is-desktop': isDesktopEnv }">
        <Title class="widget-title"></Title>
        <AudioVisualizer class="widget-visualizer"></AudioVisualizer>
        <div class="widget-search" v-if="!userStore.localOnlyMode">
            <SearchInput></SearchInput>
        </div>
        <PlatformSourceSwitch v-if="showPlatformSwitch" variant="menu" class="widget-source-switch"></PlatformSourceSwitch>
    </div>
    <div class="web-fullscreen" v-if="!isDesktopEnv" @click="toggleFullscreen()">
        <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="200">
            <path d="M128.576377 895.420553 128.576377 128.578424l766.846222 0 0 766.842129L128.576377 895.420553zM799.567461 224.434585 224.432539 224.434585l0 575.134923 575.134923 0L799.567461 224.434585z" p-id="1188"></path>
        </svg>
    </div>
    <div class="dragBar" v-if="isDesktopEnv" @dblclick="handleTitleBarDoubleClick">
        <WindowControl></WindowControl>
    </div>
    <Transition name="widget">
        <div class="musicWidget" v-if="playerStore.songList" v-show="playerStore.widgetState">
            <MusicWidget></MusicWidget>
        </div>
    </Transition>
    <Transition name="player">
        <div class="musicPlayer" v-if="playerStore.songList" v-show="!playerStore.widgetState">
            <MusicPlayer></MusicPlayer>
        </div>
    </Transition>
    <Transition name="video">
        <div class="videoPlayer" v-if="otherStore.videoPlayerShow">
            <VideoPlayer></VideoPlayer>
        </div>
    </Transition>
    <div class="contextMune">
        <ContextMenu></ContextMenu>
    </div>
    <DownloadQualityDialog></DownloadQualityDialog>
    <div class="globalDialog">
        <GlobalDialog v-if="otherStore.dialogShow"></GlobalDialog>
    </div>
    <div class="globalNotice">
        <GlobalNotice v-if="otherStore.noticeShow"></GlobalNotice>
    </div>
    <Transition name="fade">
        <div class="update" v-if="otherStore.toUpdate">
            <Update></Update>
        </div>
    </Transition>
</template>

<style lang="scss">
#app {
    user-select: none;
    margin: 0;
    padding: 0;
    max-width: 100%;
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}
.mainWindow {
    width: 100%;
    height: 100%;
    background: linear-gradient(rgba(176, 209, 217, 0.9) -20%, rgba(176, 209, 217, 0.4) 50%, rgba(176, 209, 217, 0.9) 120%);
    opacity: 0;
    animation: mainWindows-starting 0.8s cubic-bezier(0.14, 0.91, 0.58, 1) forwards;
    @keyframes mainWindows-starting {
        0% {
            background-color: rgba(222, 235, 239, 1);
            opacity: 0;
            transform: scale(1.3);
        }
        100% {
            background-color: rgb(255, 255, 255);
            opacity: 1;
            transform: scale(1);
        }
    }
    .home {
        height: calc(100% - 78px);
    }
}
.globalWidget {
    --visualizer-width: clamp(260px, 28vw, 340px);
    --visualizer-gap: 24px;
    --visualizer-shift: calc(var(--visualizer-width) + var(--visualizer-gap));

    // 桌面端右上角是 Electron 自带的窗口控制按钮（WindowControl.vue 的
    // .window-control.windows 宽 130px，在 .dragBar 中 right: 15px）。
    // 这里按它的实际宽度给顶部小部件行留出同样的右侧安全间距：
    // 行的右边界被限制在窗口控制按钮左侧，等宽或更宽窗口下布局与原来完全一致，
    // 窗口变窄时由可视化条收缩、再退化为行内元素压缩，不会钻到按钮下面。
    &.is-desktop {
        --window-controls-reserve: calc(15px + 130px + 24px);
        // 行内除可视化条外的固定宽度（标题 128 + 可视化条左间距 24 + 搜索框左间距 30 +
        // 搜索框聚焦 160 + 平台来源开关左间距 14 + 平台菜单展开 171，留少量余量），
        // 用于在窗口偏窄时反算可视化条可用宽度
        --widget-fixed-width: 532px;
        right: var(--window-controls-reserve);
        --visualizer-width: min(
            clamp(200px, 28vw, 340px),
            calc(100vw - 45px - var(--window-controls-reserve) - var(--widget-fixed-width))
        );
    }

    display: flex;
    flex-direction: row;
    align-items: center;
    position: absolute;
    top: 22px;
    z-index: 999;
    left: 45px;
    pointer-events: none;

    .widget-title {
        pointer-events: auto;

        &:hover {
            cursor: pointer;
        }
    }
    .widget-search {
        margin-left: 30px;
        // 可视化条出现时把搜索框推回原位
        transform: translate3d(calc(-1 * var(--visualizer-shift)), 0, 0);
        transition: transform 0.72s cubic-bezier(0.16, 1, 0.3, 1);
        will-change: transform;
        pointer-events: auto;
    }
    // 平台来源开关跟在搜索框右侧，与搜索框同步位移
    .widget-source-switch {
        margin-left: 14px;
        flex-shrink: 0;
        transform: translate3d(calc(-1 * var(--visualizer-shift)), 0, 0);
        transition: transform 0.72s cubic-bezier(0.16, 1, 0.3, 1);
        will-change: transform;
        pointer-events: auto;
    }
    .widget-visualizer {
        flex-shrink: 0;
    }
    &.visualizer-active {
        .widget-search,
        .widget-source-switch {
            transform: translate3d(0, 0, 0);
        }
    }
}
// 网页端专属的全屏按钮（桌面端由 WindowControl 的最大化按钮负责，模板中已 v-if 掉）
.web-fullscreen {
    position: fixed;
    top: 13px;
    right: 15px;
    z-index: 999;
    opacity: 0.5;
    transition: 0.3s;
    cursor: pointer;
    svg {
        width: 18px;
        height: 18px;
        fill: var(--text);
    }
    &:hover {
        opacity: 1;
    }
}
.musicWidget {
    width: 722px;
    height: 65px;
    position: fixed;
    left: 50%;
    bottom: 35px;
    transform: translateX(-50%);
    box-shadow: 0 0 15px 2px rgba(189, 189, 189, 0.1);
}
.musicPlayer {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
}
.dragBar {
    width: 100%;
    height: 35px;
    background: transparent;
    position: fixed;
    top: 0;
    z-index: 999;
    -webkit-app-region: drag;
    .window-control {
        position: fixed;
        top: 13px;
        -webkit-app-region: no-drag;
        z-index: 999;

        // macOS 按钮在左侧
        &.macos {
            left: 15px;
            top: 11px; // 稍微调整高度使其更居中
        }

        // Windows/Linux 按钮在右侧
        &.windows {
            right: 15px;
        }
    }
}
.videoPlayer {
    width: 100%;
    height: 100%;
    position: fixed;
    pointer-events: none;
    z-index: 999;
}
.globalNotice {
    bottom: 120px;
    position: fixed;
    z-index: 999;
}

.home-enter-active {
    transition: opacity 0.4s cubic-bezier(0.14, 0.91, 0.58, 1);
}

.home-enter-active .home-content {
    transition: transform 0.4s cubic-bezier(0.14, 0.91, 0.58, 1);
}

.home-enter-from {
    opacity: 0;
}

.home-enter-from .home-content {
    transform: scale(0.9);
}

.home-leave-active {
    transition: 0.4s cubic-bezier(0.14, 0.91, 0.58, 1);
}

.home-leave-to {
    transform: scale(0.9);
    opacity: 0;
}

.widget-enter-active,
.widget-leave-active {
    transition: 0.5s cubic-bezier(0.14, 0.91, 0.58, 1);
}

.widget-enter-from,
.widget-leave-to {
    bottom: -70px;
}

.player-enter-active,
.player-leave-active {
    transition: 0.5s cubic-bezier(0.14, 0.91, 0.58, 1);
}

.player-enter-from,
.player-leave-to {
    transform: translateY(100%);
}
.video-enter-active,
.video-leave-active {
    transition: 0.1s;
}

.video-enter-from,
.video-leave-to {
    transform: scale(0.8);
    opacity: 0;
}
.fade-enter-active {
    transition: 0.4s;
}
.fade-leave-active {
    transition: 0.3s;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}

// 新版本追加页：弹出时压暗背景
.update {
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.62);
    position: fixed;
    z-index: 999;
}
</style>
