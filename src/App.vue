<script setup>
import { defineAsyncComponent, onMounted, onUnmounted } from 'vue';
import Home from './views/Home.vue';
import Title from './components/Title.vue';
import SearchInput from './components/SearchInput.vue';
import MusicWidget from './components/MusicWidget.vue';
import { destroyLyricRuntime, initLyricRuntime } from './composables/usePlayerRuntime';

import { usePlayerStore } from './store/playerStore';
import { useOtherStore } from './store/otherStore';

const MusicPlayer = defineAsyncComponent(() => import('./views/MusicPlayer.vue'));
const ContextMenu = defineAsyncComponent(() => import('./components/ContextMenu.vue'));
const GlobalDialog = defineAsyncComponent(() => import('./components/GlobalDialog.vue'));
const GlobalNotice = defineAsyncComponent(() => import('./components/GlobalNotice.vue'));

const playerStore = usePlayerStore();
const otherStore = useOtherStore();

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
    document.addEventListener('contextmenu', preventBrowserContextMenu);
});

onUnmounted(() => {
    destroyLyricRuntime();
    document.removeEventListener('contextmenu', preventBrowserContextMenu);
});
</script>

<template>
    <div class="mainWindow">
        <Transition name="home">
            <Home class="home" v-show="playerStore.widgetState"></Home>
        </Transition>
    </div>
    <div class="globalWidget">
        <Title class="widget-title"></Title>
        <div class="widget-search">
            <SearchInput></SearchInput>
        </div>
    </div>
    <div class="web-fullscreen" @click="toggleFullscreen()">
        <svg viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="200">
            <path d="M128.576377 895.420553 128.576377 128.578424l766.846222 0 0 766.842129L128.576377 895.420553zM799.567461 224.434585 224.432539 224.434585l0 575.134923 575.134923 0L799.567461 224.434585z" p-id="1188"></path>
        </svg>
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
    <div class="contextMune">
        <ContextMenu v-if="otherStore.contextMenuShow || otherStore.addPlaylistShow"></ContextMenu>
    </div>
    <div class="globalDialog">
        <GlobalDialog v-if="otherStore.dialogShow"></GlobalDialog>
    </div>
    <div class="globalNotice">
        <GlobalNotice v-if="otherStore.noticeShow"></GlobalNotice>
    </div>
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
        pointer-events: auto;
    }
}
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
.globalNotice {
    bottom: 120px;
    position: fixed;
    z-index: 999;
}

.home-enter-active,
.home-leave-active {
    transition: 0.4s cubic-bezier(0.14, 0.91, 0.58, 1);
}

.home-enter-from,
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
</style>
