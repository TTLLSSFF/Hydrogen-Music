<script setup>
  import { ref } from 'vue'
  import Banner from '../components/Banner.vue'
  import BreakingNewsDetailModal from '../components/BreakingNewsDetailModal.vue'
  import Recommendation from '../components/Recommendation.vue';
  import NewestSong from '../components/NewestSong.vue';
  import RecList from '../components/RecList.vue';
  import { useUserStore } from '../store/userStore';

  const userStore = useUserStore()
  const breakingNewsVisible = ref(false)
  const activeBreakingNews = ref(null)

  const openBreakingNews = payload => {
    if (!payload) return
    activeBreakingNews.value = payload
    breakingNewsVisible.value = true
  }

  const closeBreakingNews = () => {
    breakingNewsVisible.value = false
    activeBreakingNews.value = null
  }

  const switchHomeSource = source => {
    userStore.setHomeSource(source)
  }
</script>

<template>
  <div class="home-page" v-if="userStore.homePage">
    <div class="home-source-switch">
      <div class="source-item" :class="{ 'source-active': userStore.homeSource == 'netease' }" @click="switchHomeSource('netease')">网易云音乐</div>
      <div class="source-item" :class="{ 'source-active': userStore.homeSource == 'qq' }" @click="switchHomeSource('qq')">QQ音乐</div>
    </div>
    <div class="page-header">
      <Banner class="banner" @open-breaking-news="openBreakingNews"></Banner>
      <Recommendation v-if="userStore.homeSource == 'netease'" class="recommendation"></Recommendation>
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
    .home-source-switch{
      display: flex;
      flex-direction: row;
      align-items: center;
      border: 1px solid rgba(0, 0, 0, 0.2);
      border-radius: 20px;
      overflow: hidden;
      align-self: flex-start;
      .source-item{
        padding: 5px 16px;
        font: 13Px SourceHanSansCN-Bold;
        color: rgba(0, 0, 0, 0.55);
        transition: 0.2s;
        &:hover{
          cursor: pointer;
          color: black;
        }
      }
      .source-active{
        background-color: rgba(0, 0, 0, 0.12);
        color: black;
      }
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
