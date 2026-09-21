<script setup>
  import { onBeforeUnmount, onMounted } from 'vue'
  import { useRouter } from 'vue-router'
  import { usePlayerStore } from '../store/playerStore';
  import { storeToRefs } from 'pinia';
  const router = useRouter()
  const playerStore = usePlayerStore()
  const { widgetState, lyricShow, playerShow } = storeToRefs(playerStore)

  const backHome = () => {
    if(widgetState.value) router.push('/')
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
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleEscapeKey)
    removeHidePlayerListener?.()
  })
</script>

<template>
  <div class="title-container">
    <Transition name=fade>
      <div class="title-logo" @click="backHome()" v-show="playerShow">Hydrogen</div>
    </Transition>

  </div>
</template>

<style scoped lang="scss">
  .title-container{
    position: relative;
    .title-logo{
      font: 28Px Gilroy-ExtraBold;
      color: rgb(26, 26, 26);
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
