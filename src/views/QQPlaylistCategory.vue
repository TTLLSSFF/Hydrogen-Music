<script setup>
  import { nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import {
    getQQPlaylistTags,
    getQQPlaylistsByTag,
    normalizeQQTagList,
    normalizeQQPlaylistCard,
  } from '../api/qqMusic'
  import { usePlayerStore } from '../store/playerStore'
  import { withCoverParam } from '../utils/coverBackdrop'

  // QQ 专属分类歌单页：左侧标签、右侧歌单网格，滚动到底自动加载下一页。
  // 本页固定 QQ 来源，不读也不写全局平台来源（otherStore.searchSource）。
  const PAGE_SIZE = 20
  const LOAD_MORE_THRESHOLD = 160

  const router = useRouter()
  const playerStore = usePlayerStore()

  const tags = ref([])
  const tagsLoading = ref(false)
  const tagsFailed = ref(false)
  const activeTagId = ref('')

  const playlists = ref([])
  const listLoading = ref(false)
  const listFailed = ref(false)
  const hasMore = ref(false)
  const page = ref(0)
  const scrollerRef = ref(null)

  // 分页游标与去重集合不参与渲染，无需响应式
  let seenIds = new Set()
  let tagsLoaded = false

  const loadTags = async () => {
    if (tagsLoading.value || tagsLoaded) return
    tagsLoading.value = true
    tagsFailed.value = false
    try {
      tags.value = normalizeQQTagList(await getQQPlaylistTags())
    } catch (_) {
      tags.value = []
      tagsFailed.value = true
    } finally {
      tagsLoading.value = false
    }
    tagsLoaded = true
    // 首次进入默认选中第一个标签
    if (!activeTagId.value) {
      const firstTag = tags.value[0]
      if (firstTag?.id) {
        activeTagId.value = firstTag.id
        await loadPlaylists({ reset: true })
      }
    }
  }

  const loadPlaylists = async ({ reset = false } = {}) => {
    if (listLoading.value || !activeTagId.value) return
    if (!reset && !hasMore.value) return
    const targetPage = reset ? 0 : page.value
    listLoading.value = true
    listFailed.value = false
    try {
      const payload = await getQQPlaylistsByTag({
        tagId: activeTagId.value,
        page: targetPage,
        limit: PAGE_SIZE,
      })
      const cards = normalizeQQPlaylistCard(payload)
      if (reset) {
        seenIds = new Set()
        playlists.value = []
      }
      const next = playlists.value.slice()
      cards.forEach(card => {
        const key = String(card.id || '')
        if (!key || seenIds.has(key)) return
        seenIds.add(key)
        next.push(card)
      })
      playlists.value = next
      page.value = targetPage + 1
      hasMore.value = cards.length >= PAGE_SIZE
    } catch (_) {
      listFailed.value = true
      if (reset) playlists.value = []
      hasMore.value = false
    } finally {
      listLoading.value = false
    }
  }

  const selectTag = tagId => {
    const nextTagId = String(tagId || '')
    if (!nextTagId || nextTagId === activeTagId.value) return
    activeTagId.value = nextTagId
    if (scrollerRef.value) scrollerRef.value.scrollTop = 0
    void loadPlaylists({ reset: true })
  }

  const retryList = () => {
    hasMore.value = true
    void loadPlaylists({ reset: true })
  }

  const openPlaylist = item => {
    if (!item?.id) return
    playerStore.forbidLastRouter = true
    router.push({ path: `/mymusic/playlist/${item.id}`, query: { source: 'qq' } })
  }

  const getCover = item => withCoverParam(item?.coverImgUrl || item?.picUrl, 300)

  const handleScrollerScroll = () => {
    if (!hasMore.value || listLoading.value) return
    const scroller = scrollerRef.value
    if (!scroller) return
    const remaining = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
    if (remaining > LOAD_MORE_THRESHOLD) return
    void loadPlaylists()
  }
  const attachScrollerScroll = async () => {
    await nextTick()
    const scroller = scrollerRef.value
    if (!scroller) return
    scroller.removeEventListener('scroll', handleScrollerScroll)
    scroller.addEventListener('scroll', handleScrollerScroll, { passive: true })
  }
  const detachScrollerScroll = () => {
    scrollerRef.value?.removeEventListener('scroll', handleScrollerScroll)
  }

  onMounted(() => {
    void attachScrollerScroll()
    void loadTags()
  })
  onActivated(() => {
    void attachScrollerScroll()
    if (!tagsLoaded) void loadTags()
  })
  onDeactivated(detachScrollerScroll)
  onBeforeUnmount(detachScrollerScroll)
</script>

<template>
  <div class="category-page">
    <div class="view-control">
      <svg @click="router.back()" class="router-last" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="200"><path d="M716.608 1010.112L218.88 512.384 717.376 13.888l45.248 45.248-453.248 453.248 452.48 452.48z"></path></svg>
      <span class="category-title">QQ音乐 · 分类歌单</span>
    </div>
    <div class="category-body">
      <div class="tag-sidebar">
        <div class="tag-status" v-if="tagsLoading">标签加载中...</div>
        <div class="tag-status" v-else-if="tagsFailed">标签加载失败</div>
        <div class="tag-status" v-else-if="tags.length === 0">暂无分类标签</div>
        <div
          class="tag-item"
          :class="{ 'tag-item-active': String(tag.id) === String(activeTagId) }"
          v-for="tag in tags"
          :key="tag.id"
          @click="selectTag(tag.id)"
        >{{ tag.name }}</div>
      </div>
      <div class="playlist-panel" ref="scrollerRef">
        <div class="playlist-grid" v-if="playlists.length > 0">
          <div class="playlist-card" v-for="item in playlists" :key="item.id">
            <div class="card-img" @click="openPlaylist(item)">
              <img v-lazy :src="getCover(item)" alt="">
            </div>
            <div class="card-name" @click="openPlaylist(item)">{{ item.name }}</div>
            <div class="card-sub">{{ item.trackCount > 0 ? item.trackCount + '首' : '' }}</div>
          </div>
        </div>
        <div class="list-empty" v-else-if="!listLoading && !listFailed">暂无歌单</div>
        <div class="library-load-more" v-if="listLoading">
          <span>正在加载更多...</span>
        </div>
        <div class="library-load-more" v-else-if="listFailed" @click="retryList">
          <span>加载失败，点击重试</span>
        </div>
        <div class="library-load-more" v-else-if="playlists.length > 0 && !hasMore">
          <span>没有更多了</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .category-page{
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
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
      .category-title{
        font: 17Px SourceHanSansCN-Bold;
        color: black;
      }
    }
    .category-body{
      width: 100%;
      height: calc(100% - 47Px);
      display: flex;
      flex-direction: row;
      min-height: 0;
      .tag-sidebar{
        margin-right: 25Px;
        padding-right: 10Px;
        width: 150Px;
        height: 100%;
        overflow: auto;
        border-right: 0.5Px solid rgba(0, 0, 0, 0.1);
        &::-webkit-scrollbar{
          display: none;
        }
        .tag-item{
          margin-bottom: 4Px;
          padding: 7Px 10Px;
          font: 13Px SourceHanSansCN-Bold;
          color: rgb(107, 107, 107);
          text-align: left;
          transition: 0.2s;
          &:hover{
            cursor: pointer;
            color: black;
            background-color: rgba(0, 0, 0, 0.05);
          }
        }
        .tag-item-active{
          color: black;
          background-color: rgba(0, 0, 0, 0.1);
        }
        .tag-status{
          padding: 7Px 10Px;
          font: 13Px SourceHanSansCN-Bold;
          color: rgb(150, 150, 150);
          text-align: left;
        }
      }
      .playlist-panel{
        flex: 1;
        min-width: 0;
        height: 100%;
        overflow: auto;
        &::-webkit-scrollbar{
          display: none;
        }
        .playlist-grid{
          width: 100%;
          display: grid;
          grid-template-columns: repeat(5, 1fr);
          gap: 30Px 25Px;
          .playlist-card{
            .card-img{
              width: 100%;
              overflow: hidden;
              transition: 0.2s;
              &:hover{
                cursor: pointer;
                box-shadow: 0 0 10Px 1Px rgba(0, 0, 0, 0.1);
              }
              img{
                width: 100%;
                height: 100%;
                border: 1px solid rgba(0, 0, 0, 0.04);
                vertical-align: bottom;
              }
            }
            .card-name{
              margin-top: 5px;
              font: 14Px SourceHanSansCN-Bold;
              font-weight: bold;
              color: black;
              text-align: left;
              overflow: hidden;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 2;
              word-break: break-all;
              transition: 0.2s;
              &:hover{
                cursor: pointer;
                color: rgba(43, 43, 43, 1);
              }
            }
            .card-sub{
              margin-top: 2px;
              font: 12Px SourceHanSansCN-Bold;
              color: rgb(122, 122, 122);
              text-align: left;
            }
          }
        }
        .list-empty{
          padding: 30Px 0;
          font: 14Px SourceHanSansCN-Bold;
          color: rgb(122, 122, 122);
          text-align: left;
        }
        // 滚动加载状态：沿用被移除的 .library-load-more 视觉
        .library-load-more{
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          font: 12px SourceHanSansCN-Bold;
          color: rgb(122, 122, 122);
          cursor: pointer;
          user-select: none;
          transition: 0.2s;
          &:hover{
            color: black;
          }
        }
      }
    }
  }
</style>
