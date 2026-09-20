<script setup>
  import { ref, onActivated, onDeactivated, watch } from 'vue'
  import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router';
  import { useOtherStore } from '../store/otherStore';
  import { storeToRefs } from 'pinia';
  import LibrarySongList from '../components/LibrarySongList.vue';
  import LibraryAlbumList from '../components/LibraryAlbumList.vue';
  import SearchResultList from '../components/SearchResultList.vue';
  import PlatformSourceSwitch from '../components/PlatformSourceSwitch.vue';
  import { resolvePlatformSource } from '../utils/providerPolicy.mjs'
  
  const otherStore = useOtherStore()
  const { getSearchInfo } = otherStore
  const { searchResult } = storeToRefs(otherStore)
  const router = useRouter()
  const scrollTop = ref(null)
  const searchScroll = ref()
  // 切换来源时的渐入渐出（复用「切换歌单」的 fade）
  const sourceChanging = ref(false)
  // 路由驱动的来源同步（前进后退 / 显式 ?source=）不需要动画，页面本身正在切换
  let syncingSourceFromRoute = false
  // 开关触发的 query 同步：拉取与渐显统一交给 switchSearchSource，避免重复请求
  let programmaticSourceReplace = false
  // keep-alive 下组件可能在后台仍存活，只有搜索页可见时才响应来源变化
  let pageActive = false

  const routerChange = (operation) => {
    if(operation) router.forward()
    else router.back()
  }
  onActivated(() => {
    pageActive = true
    searchScroll.value.scrollTop = scrollTop.value
  })
  onDeactivated(() => {
    pageActive = false
  })
  onBeforeRouteUpdate((to, from, next) => {
      if (programmaticSourceReplace) {
          next()
          return
      }
      const resolved = resolvePlatformSource(to.query.source, otherStore.searchSource)
      if (resolved !== otherStore.searchSource) {
          syncingSourceFromRoute = true
          otherStore.setSearchSource(resolved)
      }
      getSearchInfo(to.query.keywords)
      next()
  })
  // 来源开关（PlatformSourceSwitch）写入 store 后统一走这里：
  // 先淡出当前结果，切换来源并取回数据后再淡入。
  // 注意：进入本函数时 store 已经是新值（由 watch 触发），因此不能再做
  // 「值相同就 return」的短路，否则永远不会刷新结果。
  const switchSearchSource = async (nextSource) => {
      sourceChanging.value = true
      await new Promise(resolve => setTimeout(resolve, 300))
      programmaticSourceReplace = true
      await router.replace({ query: { ...router.currentRoute.value.query, source: nextSource } }).catch(() => {})
      programmaticSourceReplace = false
      await getSearchInfo(router.currentRoute.value.query.keywords).catch(() => {})
      sourceChanging.value = false
  }
  watch(() => otherStore.searchSource, nextSource => {
      if (syncingSourceFromRoute) {
          syncingSourceFromRoute = false
          return
      }
      if (!pageActive) return
      void switchSearchSource(nextSource)
  })
  onBeforeRouteLeave((to, from, next) => {
    scrollTop.value = searchScroll.value.scrollTop
    next()
  })
</script>

<template>
  <div class="search-page">
    <div class="view-control">
      <svg t="1669039513804" @click="routerChange(0)" class="router-last" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1053" width="200" height="200"><path d="M716.608 1010.112L218.88 512.384 717.376 13.888l45.248 45.248-453.248 453.248 452.48 452.48z" p-id="1054"></path></svg>
      <svg t="1669039531646" @click="routerChange(1)" class="router-next" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1207" width="200" height="200"><path d="M264.896 1010.112l497.728-497.728L264.128 13.888 218.88 59.136l453.248 453.248-452.48 452.48z" p-id="1208"></path></svg>
      <span class="search-title">搜索内容：{{router.currentRoute.value.query.keywords}}</span>
      <PlatformSourceSwitch variant="toggle" class="source-toggle"></PlatformSourceSwitch>
    </div>
    <Transition name="fade">
      <div class="search-container" ref="searchScroll" v-show="!sourceChanging">
        <div class="search-classify">
          <div class="classify-item">
            <div class="classify-title">歌曲</div>
            <div class="classify-content">
              <LibrarySongList :songlist="searchResult.searchSongs" type="search"></LibrarySongList>
            </div>
          </div>
          <div class="classify-item">
            <div class="classify-title">专辑</div>
            <div class="classify-content">
              <LibraryAlbumList :albumlist="searchResult.searchAlbums" type="search"></LibraryAlbumList>
            </div>
          </div>
        </div>
        <div class="search-classify-other">
          <div class="classify-item-other">
            <div class="classify-title">歌手</div>
            <div class="content">
              <SearchResultList :listdata="searchResult.searchArtists" type="artist"></SearchResultList>
            </div>
          </div>
          <div class="classify-item-other">
            <div class="classify-title">歌单</div>
            <div class="content">
              <SearchResultList :listdata="searchResult.searchPlaylists" type="playlist"></SearchResultList>
            </div>
          </div>
          <div class="classify-item-other">
            <div class="classify-title">视频</div>
            <div class="content">
              <SearchResultList :listdata="searchResult.searchMvs" type="mv"></SearchResultList>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
  .search-page{
    width: 100%;
    height: 100%;
    .view-control{
      margin-bottom: 15Px;
      margin-left: -8Px;
      height: 32Px;
      display: flex;
      flex-direction: row;
      align-items: center;
      svg{
        padding: 8Px;
        width: 32Px;
        height: 32Px;
        float: left;
        transition: 0.2s;
        &:hover{
          cursor: pointer;
          opacity: 0.7;
        }
        &:active{
          transform: scale(0.9);
        }
      }
      .search-title{
        font: 17Px SourceHanSansCN-Bold;
        color: black;
      }
      // 来源开关：与设置页的开关同一套样式（组件内自带样式），这里只保留间距
      .source-toggle{
        margin-left: 30px;
      }
      .router-last, .router-next{
        margin-right: 10Px;
      }
    }
    .search-container{
      width: 100%;
      height: calc(100% - 47Px);
      overflow: auto;
      &::-webkit-scrollbar{
        display: none;
      }
      .search-classify, .search-classify-other{
        width: 100%;
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        .classify-item{
          height: 460Px;
          &:first-child{
            width: calc(70% - 20Px);

          }
          &:last-child{
            width: 30%;
          }
          .classify-title{
            font: 20Px SourceHanSansCN-Bold;
            color: black;
            text-align: left;
          }
          .classify-content{
            height: calc(100% - 30Px);
            overflow: auto;
            &::-webkit-scrollbar{
              display: none;
            }
          }
        }
      }
      .search-classify-other{
        display: flex;
        flex-direction: column;
        &:last-child{
          margin-bottom: 150Px;
        }
        .classify-item-other{
          margin-top: 15Px;
          .classify-title{
            font: 20Px SourceHanSansCN-Bold;
            color: black;
            text-align: left;
          }
          .classify-content{
            height: calc(100% - 30Px);
            overflow: auto;
            &::-webkit-scrollbar{
              display: none;
            }
          }
        }
      }
    }
  }

  // 切换来源的渐入渐出：与「切换歌单」同一套动画
  .fade-enter-active,
  .fade-leave-active {
    transition: 0.3s cubic-bezier(.3,.79,.55,.99);
  }

  .fade-enter-from,
  .fade-leave-to {
    transform: scale(0.95);
    opacity: 0;
  }
</style>
