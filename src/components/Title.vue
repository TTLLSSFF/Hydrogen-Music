<script setup>
  import { onBeforeUnmount } from 'vue'
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
  const removeHidePlayerListener = (typeof windowApi !== 'undefined' && windowApi?.hidePlayer)
    ? windowApi.hidePlayer(() => {
        if(!widgetState.value) backHome()
      })
    : null

  onBeforeUnmount(() => {
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
