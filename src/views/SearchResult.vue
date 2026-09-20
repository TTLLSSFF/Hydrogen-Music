<script setup>
  import { ref, onActivated } from 'vue'
  import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router';
  import { useOtherStore } from '../store/otherStore';
  import { storeToRefs } from 'pinia';
  import LibrarySongList from '../components/LibrarySongList.vue';
  import LibraryAlbumList from '../components/LibraryAlbumList.vue';
  import SearchResultList from '../components/SearchResultList.vue';
  import { getSearchSource } from '../utils/providerPolicy.mjs'
  
  const otherStore = useOtherStore()
  const { getSearchInfo } = otherStore
  const { searchResult } = storeToRefs(otherStore)
  const router = useRouter()
  const scrollTop = ref(null)
  const searchScroll = ref()
  // 切换来源时的渐入渐出（复用「切换歌单」的 fade）
  const sourceChanging = ref(false)

  const routerChange = (operation) => {
    if(operation) router.forward()
    else router.back()
  }
  onActivated(() => {
    searchScroll.value.scrollTop = scrollTop.value
  })
  onBeforeRouteUpdate((to, from, next) => {
      otherStore.searchSource = getSearchSource(to.query.source)
      getSearchInfo(to.query.keywords)
      next()
  })
  const switchSearchSource = async (source) => {
      const nextSource = getSearchSource(source)
      if (otherStore.searchSource === nextSource) return
      // 先淡出当前结果，切换来源并取回数据后再淡入
      sourceChanging.value = true
      await new Promise(resolve => setTimeout(resolve, 300))
      otherStore.searchSource = nextSource
      await router.replace({ query: { ...router.currentRoute.value.query, source: nextSource } }).catch(() => {})
      await getSearchInfo(router.currentRoute.value.query.keywords).catch(() => {})
      sourceChanging.value = false
  }
  // 开关：网易云为关，QQ音乐为开
  const toggleSearchSource = () => {
      switchSearchSource(otherStore.searchSource === 'qq' ? 'netease' : 'qq')
  }
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
      <div class="source-toggle" @click="toggleSearchSource()">
        <div class="toggle-off" :class="{ 'toggle-on-in': otherStore.searchSource == 'qq' }">
          {{ otherStore.searchSource == 'qq' ? 'QQ音乐' : '网易云音乐' }}
        </div>
        <Transition name="toggle">
          <div class="toggle-on" v-show="otherStore.searchSource == 'qq'"></div>
        </Transition>
      </div>
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
      // 来源开关：与设置页的开关同一套样式，网易云=关、QQ音乐=开
      .source-toggle{
        margin-left: 30px;
        width: 200px;
        height: 34px;
        position: relative;
        overflow: hidden;
        isolation: isolate;
        &:hover{
          cursor: pointer;
        }
        .toggle-on, .toggle-off{
          padding: 5px 10px;
          width: 100%;
          height: 100%;
          font: 13px SourceHanSansCN-Bold;
          transition: 0.2s;
          line-height: 24px;
        }
        .toggle-off{
          background-color: rgba(255, 255, 255, 0.35);
        }
        .toggle-on{
          background-color: black;
          position: absolute;
          top: 0;
          left: 0;
          z-index: -1;
        }
        .toggle-on-in{
          color: white;
          background-color: transparent;
        }
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

  // 开关滑块：与设置页一致
  .toggle-enter-active,
  .toggle-leave-active {
    transition: 0.1s;
  }
  .toggle-enter-from,
  .toggle-leave-to {
    transform: translateX(-100%);
  }
</style>
