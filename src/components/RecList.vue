<script setup>
  import RecListItem from './RecListItem.vue'
  import { useUserStore } from '../store/userStore'

  const userStore = useUserStore()
</script>

<template>
  <div class="rec-list">
    <template v-if="userStore.homeSource == 'netease'">
      <RecListItem recType="0" class="list-item"></RecListItem>
      <RecListItem recType="1" class="list-item"></RecListItem>
      <RecListItem recType="2" class="list-item"></RecListItem>
      <RecListItem recType="3" class="list-item"></RecListItem>
    </template>
    <template v-else>
      <!-- QQ 首页只提供榜单类公共数据；歌单/歌手/专辑推荐区块按设计不展示 -->
      <RecListItem recType="3" class="list-item"></RecListItem>
    </template>
  </div>
</template>

<style scoped lang="scss">
  .list-item{
    margin-bottom: 35px;
    &:last-child{
      margin-bottom: none;
    }
  }
</style>