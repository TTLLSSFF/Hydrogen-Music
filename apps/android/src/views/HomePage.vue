<script setup>
  import { ref, watch } from 'vue'
  import Banner from '../components/Banner.vue'
  import BreakingNewsDetailModal from '../components/BreakingNewsDetailModal.vue'
  import Recommendation from '../components/Recommendation.vue';
  import NewestSong from '../components/NewestSong.vue';
  import RecList from '../components/RecList.vue';
  import { useUserStore } from '../store/userStore';
  import { useOtherStore } from '../store/otherStore';

  const userStore = useUserStore()
  const otherStore = useOtherStore()
  const breakingNewsVisible = ref(false)
  const activeBreakingNews = ref(null)

  // 切换平台来源时的渐入渐出：与搜索页同一套动画与时长。
  // 各区块在 store 变化后立即重新拉取，这里只负责淡出→淡入。
  const sourceChanging = ref(false)
  watch(() => otherStore.searchSource, async () => {
    sourceChanging.value = true
    await new Promise(resolve => setTimeout(resolve, 300))
    sourceChanging.value = false
  })

  const openBreakingNews = payload => {
    if (!payload) return
    activeBreakingNews.value = payload
    breakingNewsVisible.value = true
  }

  const closeBreakingNews = () => {
    breakingNewsVisible.value = false
    activeBreakingNews.value = null
  }
</script>

<template>
  <div class="home-page" :class="{ 'source-changing': sourceChanging }" v-if="userStore.homePage">
    <div class="page-header">
      <Banner class="banner" @open-breaking-news="openBreakingNews"></Banner>
      <!-- 每日推荐卡片：QQ 侧用个性化推荐歌单代替（上游没有可用的每日歌曲列表接口） -->
      <Recommendation class="recommendation"></Recommendation>
      <NewestSong class="newest-song"></NewestSong>
    </div>
    <div class="page-content">
      <RecList class="rec-list"></RecList>
    </div>
    <BreakingNewsDetailModal :visible="breakingNewsVisible" :banner="activeBreakingNews" @close="closeBreakingNews"></BreakingNewsDetailModal>
  </div>
</template>

<style scoped lang="scss">
  .home-page{
    height: 100%;
    display: flex;
    flex-direction: column;
    // 切换平台来源的渐入渐出，与搜索页同一套动画
    transition: 0.3s cubic-bezier(.3,.79,.55,.99);
    &.source-changing{
      transform: scale(0.95);
      opacity: 0;
      pointer-events: none;
    }
    .page-header{
      padding-top: 2.8vw;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
    }
    .page-content{
      margin-top: 40px;
      .rec-list{
        margin-bottom: 140px;
      }
    }
  }
</style>
