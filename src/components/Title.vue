<script setup>
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import VueSlider from 'vue-slider-component'
  import { songTime2 } from '../utils/time';
  import { changeProgress } from '../utils/player/lazy';
  import { usePlayerStore } from '../store/playerStore';
  import { useOtherStore } from '../store/otherStore';
  import { storeToRefs } from 'pinia';
  import { getSongDisplayName } from '../utils/songName';
  import { getIndexedSong } from '../utils/songList';
  import { getSongCoverUrl, withCoverParam } from '../utils/coverBackdrop';
  import { useStableImageSource } from '../composables/useStableImageSource';
  import defaultLocalCover from '../assets/icon/icon.png';
  const router = useRouter()
  const playerStore = usePlayerStore()
  const {
    widgetState,
    lyricShow,
    playerShow,
    musicVideo,
    videoIsPlaying,
    songList,
    currentIndex,
    songId,
    localBase64Img,
    progress,
    time,
    showSongTranslation,
  } = storeToRefs(playerStore)

  const sliderDuration = computed(() => {
    const currentTime = Number(time.value)
    return Number.isFinite(currentTime) && currentTime > 0 ? currentTime : 0
  })

  const safeSliderMax = computed(() => {
    const currentDuration = sliderDuration.value
    if (currentDuration > 0) return Math.max(1, Math.ceil(currentDuration))

    const currentProgress = Number(progress.value)
    return Number.isFinite(currentProgress) && currentProgress > 0 ? Math.ceil(currentProgress) : 1
  })

  const sliderProgress = computed({
    get: () => {
      const currentProgress = Number(progress.value)
      if (!Number.isFinite(currentProgress) || currentProgress <= 0) return 0
      return Math.min(currentProgress, safeSliderMax.value)
    },
    set: value => {
      const nextValue = Number(value)
      progress.value = Number.isFinite(nextValue) && nextValue > 0 ? Math.min(nextValue, safeSliderMax.value) : 0
    }
  })

  const currentSong = computed(() => getIndexedSong(songList.value, currentIndex.value))
  const currentSongCoverUrl = computed(() => withCoverParam(getSongCoverUrl(currentSong.value), 100))
  const displayedCurrentSongCoverUrl = useStableImageSource(currentSongCoverUrl)

  const backHome = () => {
    if(widgetState.value) router.push('/')
    if(videoIsPlaying?.value) videoIsPlaying.value = false
    widgetState.value = true
    lyricShow.value = false
  }
  const hidePlayer = () => {
    if(!widgetState.value) {
      backHome()
      return
    }
    if(router.currentRoute.value.name === 'sirenAlbum') router.push('/siren')
  }
  const removeHidePlayerListener = (typeof windowApi !== 'undefined' && windowApi?.hidePlayer)
    ? windowApi.hidePlayer(hidePlayer)
    : null

  // —— 左上角 LOGO 的平台来源右键菜单 ——
  // 首页/搜索页顶部原来的悬停展开开关已移除，平台来源切换收进这里；
  // 菜单与桌面歌词右键菜单共用 assets/css/contextMenu.scss 同一份样式（网页端与桌面端一致）。
  const otherStore = useOtherStore()
  const sourceMenuVisible = ref(false)
  const sourceMenuX = ref(0)
  const sourceMenuY = ref(0)
  const sourceMenuRef = ref(null)

  const isQQSource = computed(() => otherStore.searchSource === 'qq')
  const SOURCE_MENU_VIEWPORT_MARGIN = 8

  const hideSourceMenu = () => {
    sourceMenuVisible.value = false
  }

  const openSourceMenu = async event => {
    // 先按鼠标坐标落点，写出 DOM 后再量真实尺寸，贴着视口右/下边缘时向内收敛
    sourceMenuX.value = event.clientX
    sourceMenuY.value = event.clientY
    sourceMenuVisible.value = true
    await nextTick()
    const menu = sourceMenuRef.value
    if (!menu) return
    // 贴着视口右/下边缘时向内收敛；窗口比菜单还小时以「绝不越界」优先，宁可放弃边距
    const maxX = Math.max(0, window.innerWidth - menu.offsetWidth - SOURCE_MENU_VIEWPORT_MARGIN)
    const maxY = Math.max(0, window.innerHeight - menu.offsetHeight - SOURCE_MENU_VIEWPORT_MARGIN)
    const minX = Math.min(SOURCE_MENU_VIEWPORT_MARGIN, maxX)
    const minY = Math.min(SOURCE_MENU_VIEWPORT_MARGIN, maxY)
    sourceMenuX.value = Math.min(Math.max(minX, sourceMenuX.value), maxX)
    sourceMenuY.value = Math.min(Math.max(minY, sourceMenuY.value), maxY)
  }

  const selectSearchSource = source => {
    otherStore.setSearchSource(source)
    hideSourceMenu()
  }

  // 菜单打开时按 Esc 只关菜单，不再触发外层「收起播放页」的 Esc 行为
  const handleSourceMenuKeydown = event => {
    if (!sourceMenuVisible.value || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    hideSourceMenu()
  }

  const handleSourceMenuScroll = () => {
    if (sourceMenuVisible.value) hideSourceMenu()
  }

  // 路由变化（含点击 LOGO 回首页）时菜单不该留在原地
  watch(() => router.currentRoute.value.fullPath, hideSourceMenu)

  // 桌面端由 Electron 的 Esc 全局加速键触发 hide-player 事件，网页端没有这条通道，
  // 因此用页面内 Esc 键补齐同样的行为：收起播放页；停留在塞壬专辑页时返回塞壬列表。
  const handleEscapeKey = event => {
    if(event.key !== 'Escape' || event.defaultPrevented) return
    const target = event.target
    const tagName = String(target?.tagName || '').toLowerCase()
    if(['input', 'textarea', 'select'].includes(tagName) || target?.isContentEditable) return
    hidePlayer()
  }

  onMounted(() => {
    window.addEventListener('keydown', handleEscapeKey)
    // 菜单打开期间的关闭时机：Esc（capture，抢在收起播放页之前）与任意滚动容器滚动
    window.addEventListener('keydown', handleSourceMenuKeydown, true)
    window.addEventListener('scroll', handleSourceMenuScroll, true)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleEscapeKey)
    window.removeEventListener('keydown', handleSourceMenuKeydown, true)
    window.removeEventListener('scroll', handleSourceMenuScroll, true)
    removeHidePlayerListener?.()
  })
</script>

<template>
  <div class="title-container">
    <Transition name=fade>
      <div
        class="title-logo"
        @click="backHome()"
        @contextmenu.prevent.stop="openSourceMenu"
        v-show="playerShow"
      >Hydrogen</div>
    </Transition>
    <div class="title-player" :class="{'title-player-in': videoIsPlaying && !playerShow}" v-if="musicVideo && currentSong" @click="playerShow = true">
      <div class="player-content" :class="{'player-content-in': videoIsPlaying && !playerShow}">
        <div class="cover">
          <img v-if="currentSong.type != 'local' && displayedCurrentSongCoverUrl" :src="displayedCurrentSongCoverUrl" alt="">
          <img v-else-if="localBase64Img" :src="localBase64Img" alt="">
          <img v-else :src="defaultLocalCover" alt="">
        </div>
        <div class="music-info">
          <span class="music-name">{{getSongDisplayName(currentSong, '', showSongTranslation)}}</span>
          <div class="music-time">
            <vue-slider :key="'title-progress-' + (songId || currentIndex)" id='widget-progress' class="music-progress" @click.stop="changeProgress(sliderProgress)"  v-model="sliderProgress" :min="0" :max="safeSliderMax" :interval="1" :duration="0.5" :silent="true" tooltip="none"></vue-slider>
            <span class="remaining-time">{{songTime2(Math.max(0, sliderDuration - sliderProgress))}}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 平台来源右键菜单：与桌面歌词菜单同一套类名与样式（assets/css/contextMenu.scss）。
         Teleport 到 body，避免落在 .globalWidget 的 pointer-events:none / 层叠上下文里。 -->
    <Teleport to="body">
      <div
        v-if="sourceMenuVisible"
        class="arknights-context-menu-backdrop"
        @mousedown.stop="hideSourceMenu"
        @click.stop="hideSourceMenu"
      ></div>
      <div
        v-if="sourceMenuVisible"
        ref="sourceMenuRef"
        class="arknights-context-menu"
        :style="{ left: sourceMenuX + 'px', top: sourceMenuY + 'px' }"
        @click.stop
      >
        <div class="menu-header">
          <span class="menu-title">SEARCH SOURCE</span>
          <div class="title-underline"></div>
        </div>
        <div class="menu-content">
          <div class="menu-item" @click="selectSearchSource('netease')">
            <div class="item-icon" aria-hidden="true">
              <span class="selection-mark" :class="{ selected: !isQQSource }"></span>
            </div>
            <span class="item-text">
              <span class="text-zh">网易云音乐</span>
              <span class="text-en">NETEASE MUSIC</span>
            </span>
            <div class="item-indicator"></div>
          </div>
          <div class="menu-item" @click="selectSearchSource('qq')">
            <div class="item-icon" aria-hidden="true">
              <span class="selection-mark" :class="{ selected: isQQSource }"></span>
            </div>
            <span class="item-text">
              <span class="text-zh">QQ音乐</span>
              <span class="text-en">QQ MUSIC</span>
            </span>
            <div class="item-indicator"></div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
  .title-container{
    position: relative;
    .title-logo{
      font: 28Px Gilroy-ExtraBold;
      color: rgb(26, 26, 26);
    }
    .title-player{
      width: 0;
      height: 8vh;
      background-color: rgba(255, 255, 255, 0.2);
      box-shadow: 0 0 12px 2px rgba(0, 0, 0, 0.02);
      backdrop-filter: blur(4px);
      position: absolute;
      top: 0;
      left: 0;
      z-index: 999;
      transition: 0.5s cubic-bezier(.3,.79,.55,.99);
      visibility: hidden;
      overflow: hidden;
      transform: translateX(-21px);
      .player-content{
        height: 100%;
        padding: 4px 1.2vh;
        display: flex;
        flex-direction: row;
        align-items: center;
        transform: translateX(-4px);
        transition: 0.2s 1s cubic-bezier(.06,.52,.29,1);
        opacity: 0;
        .cover{
          margin-right: 8px;
          img{
            width: 5.8vh;
            vertical-align: bottom;
          }
        }
        .music-info{
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          overflow: hidden;
          white-space: nowrap;
          .music-name{
            margin-bottom: 0.5vh;
            font: 1.8vh SourceHanSansCN-Bold;
            color: black;
          }
          .music-time{
            width: 100%;
            display: flex;
            flex-direction: row;
            align-items: center;
            .music-progress{
              margin-left: 1px;
              width: 100% !important;
              height: 0.6vh !important;
              box-shadow: 0 0 0 0.5Px black;
              transition: 0.2s;
            }
            .remaining-time{
              width: 8vh;
              font: 1.5vh Bender-Bold;
              color: black;
              line-height: 1.5vh;
            }
          }
        }
      }
      .player-content-in{
        opacity: 1;
        visibility: visible;
        transform: translateX(0px);
        transition: 0.8s 1.2s cubic-bezier(.06,.52,.29,1);
      }
    }
    .title-player-in{
      width: 32vh;
      visibility: visible;
      transition: 0.4s 0.8s cubic-bezier(.06,.52,.29,1);
    }
  }
  .fade-enter-active,
  .fade-leave-active {
    transition: 0.2s;
  }

  .fade-enter-from,
  .fade-leave-to {
    transform: scale(0.9);
    opacity: 0;
  }
</style>