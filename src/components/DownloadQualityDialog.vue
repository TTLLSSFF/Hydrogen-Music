<script setup>
import { computed, ref } from 'vue'
import { MUSIC_LEVEL_OPTIONS } from '../shared/settingsSchema'
import { useOtherStore } from '../store/otherStore'
import { noticeOpen } from '../utils/dialog'
import { pushSongsToBrowserDownloads } from '../utils/download'

const otherStore = useOtherStore()
const downloading = ref(false)
const progressText = ref('')

const downloadItems = computed(() => Array.isArray(otherStore.downloadItems) ? otherStore.downloadItems.filter(Boolean) : [])
const itemCount = computed(() => downloadItems.value.length)
const dialogTitle = computed(() => otherStore.downloadTitle || (itemCount.value > 1 ? `下载 ${itemCount.value} 首歌曲` : '选择下载音质'))

const closeDialog = () => {
    if (downloading.value) return
    otherStore.downloadQualityShow = false
    otherStore.downloadItems = []
    otherStore.downloadTitle = ''
    progressText.value = ''
}

const startDownload = async level => {
    if (downloading.value) return
    if (!itemCount.value) {
        closeDialog()
        return
    }

    downloading.value = true
    progressText.value = `准备下载 0/${itemCount.value}`
    const songs = [...downloadItems.value]

    try {
        const result = await pushSongsToBrowserDownloads(songs, level, {
            onProgress: progress => {
                const done = progress.success + progress.failed + progress.skipped
                progressText.value = `正在推送 ${done}/${progress.total}`
            },
        })

        if (result.success > 0) {
            noticeOpen(`已推送 ${result.success} 个下载链接`, 2)
        }
        if (result.failed > 0 || result.skipped > 0) {
            noticeOpen(`下载完成，${result.failed + result.skipped} 首未推送`, 2)
        }
    } finally {
        downloading.value = false
        closeDialog()
    }
}
</script>

<template>
    <Transition name="add-fade">
        <div class="download-quality-dialog" v-if="otherStore.downloadQualityShow" @click="closeDialog">
            <div class="download-container" @click.stop>
                <span class="download-title">{{ dialogTitle }}</span>
                <div class="download-quality-list">
                    <button
                        class="quality-item"
                        v-for="item in MUSIC_LEVEL_OPTIONS"
                        :key="item.value"
                        :disabled="downloading"
                        @click="startDownload(item.value)"
                    >
                        <span class="quality-name">{{ item.label }}</span>
                        <span class="quality-code">{{ item.value }}</span>
                    </button>
                </div>
                <span class="download-progress" v-if="progressText">{{ progressText }}</span>
                <span class="download-style download-style1"></span>
                <span class="download-style download-style2"></span>
                <span class="download-style download-style3"></span>
                <span class="download-style download-style4"></span>
                <span class="download-style5">DOWNLOAD</span>
            </div>
        </div>
    </Transition>
</template>

<style scoped lang="scss">
.download-quality-dialog {
    width: 100%;
    height: 100%;
    position: fixed;
    top: 0;
    left: 0;
    background-color: rgba(0, 0, 0, 0.05);
    overflow: hidden;
    z-index: 9999;
    .download-container {
        width: 0;
        height: 0;
        background-color: rgb(15, 15, 15);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        animation: download-container-in 0.6s 0.3s forwards;
        @keyframes download-container-in {
            0% {
                width: 0;
                height: 0;
            }
            50% {
                width: 300px;
                height: 0;
            }
            100% {
                width: 300px;
                height: 430px;
            }
        }
        .download-title {
            display: inline-block;
            padding: 10px 0;
            font: 16px SourceHanSansCN-Bold;
            color: white;
            opacity: 0;
            animation: download-title-in 0.3s 0.5s forwards;
            @keyframes download-title-in {
                0% {
                    opacity: 0;
                }
                100% {
                    opacity: 1;
                }
            }
        }
        .download-quality-list {
            width: 100%;
            height: calc(100% - 72px);
            overflow: auto;
            &::-webkit-scrollbar {
                display: none;
            }
            .quality-item {
                padding: 11px 22px;
                width: 100%;
                min-height: 42px;
                border: 0;
                outline: none;
                background: transparent;
                display: flex;
                flex-direction: row;
                justify-content: space-between;
                align-items: center;
                transition: 0.2s;
                color: white;
                &:hover:not(:disabled) {
                    cursor: pointer;
                    background-color: rgba(53, 53, 53, 0.7);
                }
                &:active:not(:disabled) {
                    transform: scale(0.98);
                }
                &:disabled {
                    opacity: 0.45;
                    cursor: wait;
                }
                .quality-name {
                    font: 14px SourceHanSansCN-Bold;
                }
                .quality-code {
                    font: 10px Bender-Bold;
                    color: rgb(165, 165, 165);
                    text-transform: uppercase;
                }
            }
        }
        .download-progress {
            position: absolute;
            bottom: 14px;
            left: 0;
            width: 100%;
            font: 11px SourceHanSansCN-Bold;
            color: rgb(190, 190, 190);
            text-align: center;
        }
        .download-style {
            width: 9px;
            height: 9px;
            background-color: rgb(247, 247, 247);
            position: absolute;
            opacity: 0;
            animation: download-style-in 0.4s forwards;
            @keyframes download-style-in {
                0% {
                    opacity: 0;
                }
                10% {
                    opacity: 1;
                }
                20% {
                    opacity: 0;
                }
                30% {
                    opacity: 1;
                }
                40% {
                    opacity: 0;
                }
                50% {
                    opacity: 1;
                }
                60% {
                    opacity: 0;
                }
                70% {
                    opacity: 1;
                }
                80% {
                    opacity: 0;
                }
                90% {
                    opacity: 0;
                }
                100% {
                    opacity: 1;
                }
            }
        }
        $position: -4px;
        .download-style1 {
            top: $position;
            left: $position;
        }
        .download-style2 {
            top: $position;
            right: $position;
        }
        .download-style3 {
            bottom: $position;
            right: $position;
        }
        .download-style4 {
            bottom: $position;
            left: $position;
        }
        .download-style5 {
            font: 42px Gilroy-ExtraBold;
            color: rgb(37, 37, 37);
            position: absolute;
            top: 10px;
            left: 20px;
            z-index: -1;
            opacity: 0;
            animation: download-style5-in 0.3s 0.6s forwards;
            @keyframes download-style5-in {
                0% {
                    opacity: 0;
                }
                100% {
                    opacity: 1;
                }
            }
        }
    }
}
</style>
