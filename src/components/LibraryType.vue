<script setup>
  import { nextTick, onActivated, onMounted, onUnmounted, ref, watch } from 'vue'
  import router from '../router/router'
  import { getUserPlaylistCount, getUserPlaylist } from '../api/user'
  import { getUserSubAlbum } from '../api/album'
  import { getUserSubArtists } from '../api/artist'
  import { getUserSubMV } from '../api/mv'
  import { useUserStore } from '../store/userStore'
  import { getDjSubList } from '../api/dj'
  import { useLibraryStore } from '../store/libraryStore'
  import { useLocalStore } from '../store/localStore'
  import { resolveFavoritePlaylistMeta } from '../utils/favoritePlaylist'
  import { storeToRefs } from 'pinia'
  import { scanMusic } from '../utils/locaMusic.js'
  import { qqAccountStore } from '../store/qqAccountStore'
  import { getQQPlaylists, getQQCollectedPlaylists, getQQLikedSongs } from '../api/qq'
  import { normalizeQQLikedPlaylist } from '../api/qqMusic'
  import { loadQQPlaylistPages as loadQQPlaylistPagesData, mergeQQPlaylistLists } from '../utils/qqLibrary.mjs'
  import { isLogin } from '../utils/authority'
  import { getMusicAccountId, isMusicAccountRequestCurrent } from '../utils/accountIdentity.mjs'

  const userStore = useUserStore()
  const { user } = storeToRefs(userStore)
  const libraryStore = useLibraryStore()
  const { changeLibraryList, updateUserPlaylistCount } = libraryStore
  const { libraryList, libraryListAlbum, libraryListAritist, listType1, listType2, playlistOverviewVersion, playlistOverviewRefreshSilent } = storeToRefs(libraryStore)
  const localStore = useLocalStore()
  // 本地音乐依赖桌面端文件系统能力：网页端不渲染「本地管理」页签及其子项
  const isDesktop = typeof windowApi !== 'undefined'

  const typeTracker = ref(0)
  const option = ref(0)
  const typeOne = ref(0)
  const typeTwo = ref(0)
  const typeThree = ref(0)
  const typeFour = ref(0)
  const lastLoadedUserId = ref(null)
  const lastHandledPlaylistOverviewVersion = ref(playlistOverviewVersion.value)
  const SUB_ALBUM_PAGE_SIZE = 100
  let libraryRequestToken = 0

  // 顶部页签指示条：不再硬编码像素，按当前选中页签实测位置定位，页签数量/文案/窗口宽度变化都能对齐
  const typeOptionRef = ref(null)
  const trackerTrackRef = ref(null)
  const trackerStyle = ref({ left: '0Px', width: '0Px' })

  function updateTracker() {
    const optionBox = typeOptionRef.value
    const trackBox = trackerTrackRef.value
    if (!optionBox || !trackBox) return
    const target = optionBox.querySelector('.option-selected')
    if (!target) return
    const optionRect = target.getBoundingClientRect()
    const trackRect = trackBox.getBoundingClientRect()
    trackerStyle.value = {
      left: `${Math.round(optionRect.left - trackRect.left)}Px`,
      width: `${Math.round(optionRect.width)}Px`,
    }
  }

  function scheduleTrackerUpdate() {
    void nextTick(() => {
      updateTracker()
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(updateTracker)
    })
  }

  function getCurrentUserId() {
    const neteaseId = user.value?.userId == null || user.value?.userId === '' ? '' : String(user.value.userId)
    const qqId = qqAccountStore.user?.uin || qqAccountStore.user?.id || ''
    if (!neteaseId && !qqId) return null
    return `${neteaseId}:${qqId}`
  }

  async function loadQQPlaylist(requestToken, requestUserId, subscribed = false) {
    try {
      return await loadQQPlaylistPagesData(
        params => subscribed
          ? getQQCollectedPlaylists({ uin: requestUserId, ...params })
          : getQQPlaylists({ uin: requestUserId, ...params }),
        {
          subscribed,
          limit: subscribed ? 20 : 500,
          isActive: () => isLibraryRequestActive(requestToken, requestUserId, 'qq'),
        },
      )
    } catch (error) {
      if (!isLibraryRequestActive(requestToken, requestUserId, 'qq')) return false
      console.warn('QQ playlist load failed:', error?.message || error)
      return []
    }
  }

  async function loadQQLikedPlaylist(requestToken, requestUserId) {
    try {
      const likedResponse = await getQQLikedSongs({ uin: requestUserId, limit: 1, offset: 0 })
      if (!isLibraryRequestActive(requestToken, requestUserId, 'qq')) return false
      // 列表项保留元信息里的封面（歌曲封面）：详情页合并时以它为准，两处显示同一张
      return normalizeQQLikedPlaylist(likedResponse)
    } catch (error) {
      if (!isLibraryRequestActive(requestToken, requestUserId, 'qq')) return false
      console.warn('QQ liked playlist load failed:', error?.message || error)
      return null
    }
  }

  function isLibraryRequestActive(requestToken, requestUserId, provider = '') {
    if (requestToken !== libraryRequestToken) return false

    if (!provider) {
      return isMusicAccountRequestCurrent(requestUserId, getCurrentUserId())
    }

    const requestedId = getMusicAccountId(requestUserId, provider)
    if (!requestedId) return false

    const neteaseId = user.value?.userId == null || user.value?.userId === '' ? '' : String(user.value.userId)
    const qqId = qqAccountStore.user?.uin || qqAccountStore.user?.id || ''
    if (provider === 'qq') return qqAccountStore.loggedIn === true && String(qqId) === requestedId
    if (provider === 'netease') return isLogin() && neteaseId === requestedId

    return isMusicAccountRequestCurrent(requestUserId, getCurrentUserId())
  }

  function clearAccountLibraryLists() {
    libraryList.value = null
    libraryListAlbum.value = null
    libraryListAritist.value = null
  }

  function syncFavoritePlaylistTrackCount() {
    if (!Array.isArray(userStore.likelist)) return

    const favoritePlaylist = resolveFavoritePlaylistMeta(libraryStore.playlistUserCreated, user.value?.userId)
    const playlistId = userStore.favoritePlaylistId || favoritePlaylist?.id
    if (!playlistId) return

    libraryStore.setPlaylistOverviewTrackCount(playlistId, userStore.likelist.length)
  }

  async function loadUserPlaylist(requestToken, requestUserId, options = {}) {
    if (!requestUserId) {
      return { created: [], subscribed: [] }
    }

    const params = {
      uid: requestUserId,
      limit: 500,
      offset: 0,
      timestamp: Date.now()
    }

    try {
      const listCount = await getUserPlaylistCount(options)
      if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false

      updateUserPlaylistCount(listCount)

      const list = await getUserPlaylist(params, options)
      if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
      const playlists = Array.isArray(list?.playlist) ? list.playlist : []
      const createdCount = Number(listCount?.createdPlaylistCount) || 0
      const subscribedCount = Number(listCount?.subPlaylistCount) || 0
      return {
        created: playlists.slice(0, createdCount),
        subscribed: playlists.slice(createdCount, createdCount + subscribedCount),
      }
    } catch (error) {
      if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
      console.error('加载用户歌单失败:', error)
      return { created: [], subscribed: [] }
    }
  }

  async function loadAllUserSubAlbums(requestToken, requestUserId) {
    if (!requestUserId) {
      clearAccountLibraryLists()
      return false
    }

    const albums = []
    let offset = 0

    try {
      while (true) {
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false

        const result = await getUserSubAlbum({
          limit: SUB_ALBUM_PAGE_SIZE,
          offset,
        })
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false

        const currentPageAlbums = Array.isArray(result?.data) ? result.data : []
        const totalCount = Number(result?.count)

        albums.push(...currentPageAlbums)

        if (currentPageAlbums.length == 0) break

        offset += currentPageAlbums.length

        if (currentPageAlbums.length < SUB_ALBUM_PAGE_SIZE) break
        if (Number.isFinite(totalCount) && totalCount >= 0 && albums.length >= totalCount) break
      }

      if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false

      libraryList.value = albums
      listType2.value = 0
      libraryListAlbum.value = albums
      lastLoadedUserId.value = requestUserId
      return true
    } catch (error) {
      if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
      console.error('加载收藏专辑失败:', error)
      clearAccountLibraryLists()
      return false
    }
  }

  async function refreshCurrentSection(options = {}) {
    const requestUserId = getCurrentUserId()
    const requestToken = ++libraryRequestToken

    if (userStore.localOnlyMode) {
      option.value = 3
      typeTracker.value = 3
      listType1.value = 3
      listType2.value = typeFour.value
      return true
    }

    if ((option.value == 0 || option.value == 1) && !requestUserId) {
      clearAccountLibraryLists()
      return false
    }

    if (option.value == 0) {
      const qqUserId = String(qqAccountStore.user?.uin || qqAccountStore.user?.id || '')
      const [neteaseResult, qqCreated, qqSubscribed, qqLiked] = await Promise.all([
        isLogin() ? loadUserPlaylist(requestToken, user.value?.userId, options) : Promise.resolve({ created: [], subscribed: [] }),
        qqAccountStore.loggedIn ? loadQQPlaylist(requestToken, qqUserId, false) : Promise.resolve([]),
        qqAccountStore.loggedIn ? loadQQPlaylist(requestToken, qqUserId, true) : Promise.resolve([]),
        qqAccountStore.loggedIn ? loadQQLikedPlaylist(requestToken, qqUserId) : Promise.resolve(null),
      ])
      if (!isLibraryRequestActive(requestToken, requestUserId)) return false
      const qqLists = mergeQQPlaylistLists(qqCreated, qqSubscribed, qqLiked)
      const created = [...(neteaseResult?.created || []), ...qqLists.created]
      const subscribed = [...(neteaseResult?.subscribed || []), ...qqLists.subscribed]
      libraryStore.playlistUserCreated = created
      libraryStore.playlistUserSub = subscribed
      libraryStore.playlistCount = { createdPlaylistCount: created.length, subPlaylistCount: subscribed.length }
      syncFavoritePlaylistTrackCount()
      libraryList.value = typeOne.value == 0 ? created : subscribed
      listType2.value = typeOne.value == 0 ? 0 : 1
      libraryListAlbum.value = null
      libraryListAritist.value = null
      lastLoadedUserId.value = requestUserId
      lastHandledPlaylistOverviewVersion.value = playlistOverviewVersion.value
      changeLibraryList(typeOne.value == 0 ? 0 : 1)
    } else if (option.value == 1 && typeTwo.value == 0) {
      const loaded = await loadAllUserSubAlbums(requestToken, requestUserId)
      if (!loaded || !isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
    } else if (option.value == 1 && typeTwo.value == 1) {
      try {
        const result = await getUserSubArtists()
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
        libraryList.value = Array.isArray(result?.data) ? result.data : []
        listType2.value = 1
        libraryListAritist.value = libraryList.value
        lastLoadedUserId.value = requestUserId
      } catch (error) {
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
        console.error('加载收藏歌手失败:', error)
        clearAccountLibraryLists()
        return false
      }
    } else if (option.value == 1 && typeTwo.value == 2) {
      try {
        const result = await getUserSubMV()
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
        const list = Array.isArray(result?.data) ? result.data.map(item => ({ ...item, id: item?.vid })) : []
        libraryList.value = list
        listType2.value = 2
        lastLoadedUserId.value = requestUserId
      } catch (error) {
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
        console.error('加载收藏 MV 失败:', error)
        clearAccountLibraryLists()
        return false
      }
    } else if (option.value == 1 && typeTwo.value == 3) {
      try {
        const result = await getDjSubList({ limit: 50, offset: 0 })
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
        libraryList.value = result?.djRadios || result?.data || result?.radios || []
        listType2.value = 3
        lastLoadedUserId.value = requestUserId
      } catch (error) {
        if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false
        console.error('加载收藏电台失败:', error)
        clearAccountLibraryLists()
        return false
      }
    } else if (option.value == 2 && typeThree.value == 0) {
      listType2.value = 0
    } else if (option.value == 2 && typeThree.value == 1) {
      listType2.value = 1
    } else if (option.value == 3 && typeFour.value == 0) {
      listType2.value = 0
    } else if (option.value == 3 && typeFour.value == 1) {
      listType2.value = 1
    } else if (option.value == 3 && typeFour.value == 2) {
      listType2.value = 2
    }

    if(document.getElementById('libraryListScroll'))
      document.getElementById('libraryListScroll').scrollTop = 0
    return true
  }

  function changeTracker(num) {
    listType1.value = num
    option.value = num
    typeTracker.value = num
    void refreshCurrentSection()
  }

  function changeType(num) {
    if (option.value == 0) {
        typeOne.value = num
    } else if (option.value == 1) {
        typeTwo.value = num
    } else if (option.value == 2) {
        typeThree.value = num
    } else if (option.value == 3) {
        typeFour.value = num
    }
    void refreshCurrentSection()
  }

  const refreshLocal = () => {
    localStore.isRefreshLocalFile = true
    if(listType1.value == 3) {scanMusic({type:'local',refresh:true});}
    router.push('/mymusic')
  }

  watch(
    () => userStore.localOnlyMode,
    enabled => {
      changeTracker(enabled ? 3 : 0)
    }
  )

  watch(
    () => `${user.value?.userId || ''}:${qqAccountStore.loggedIn ? qqAccountStore.user?.uin || qqAccountStore.user?.id || 'qq' : ''}`,
    (nextUserId, previousUserId) => {
      if (nextUserId === previousUserId) return
      lastLoadedUserId.value = null
      if (option.value == 0 || option.value == 1) {
        void refreshCurrentSection()
      }
    }
  )

  watch(
    () => [userStore.favoritePlaylistId, Array.isArray(userStore.likelist) ? userStore.likelist.length : null],
    syncFavoritePlaylistTrackCount
  )

  watch(
    () => playlistOverviewVersion.value,
    version => {
      if (version === lastHandledPlaylistOverviewVersion.value) return
      if (option.value != 0) return
      void refreshCurrentSection({ silent: playlistOverviewRefreshSilent.value })
    }
  )

  onActivated(() => {
    scheduleTrackerUpdate()
    const currentUserId = getCurrentUserId()
    const needsUserReload = (option.value == 0 || option.value == 1) && currentUserId && lastLoadedUserId.value !== currentUserId
    const needsPlaylistOverviewReload = option.value == 0 && playlistOverviewVersion.value !== lastHandledPlaylistOverviewVersion.value
    if (needsUserReload || needsPlaylistOverviewReload) {
      void refreshCurrentSection({ silent: needsPlaylistOverviewReload && playlistOverviewRefreshSilent.value })
    }
  })

  watch([option, typeTracker, () => userStore.localOnlyMode], scheduleTrackerUpdate)

  onMounted(() => {
    scheduleTrackerUpdate()
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(updateTracker).catch(() => {})
    }
    if (typeof window !== 'undefined') window.addEventListener('resize', updateTracker)
  })

  onUnmounted(() => {
    if (typeof window !== 'undefined') window.removeEventListener('resize', updateTracker)
  })

  changeTracker(userStore.localOnlyMode ? 3 : 0)
</script>

<template>
  <div>
    <div class="library-type">
        <div class="type-one">
            <div class="type-option" ref="typeOptionRef">
            <span v-if="!userStore.localOnlyMode" class="option" :class="{'option-selected': option == 0}" @click="changeTracker(0)" id="myPlaylist">歌单</span>
            <span v-if="!userStore.localOnlyMode" class="option" :class="{'option-selected': option == 1}" @click="changeTracker(1)">收藏</span>
            <span v-if="isDesktop && !userStore.localOnlyMode" class="option" :class="{'option-selected': option == 2}" @click="changeTracker(2)">下载管理</span>
            <span v-if="isDesktop" class="option" :class="{'option-selected': option == 3}" @click="changeTracker(3)">本地管理</span>
            </div>
            <div class="option-tracker" ref="trackerTrackRef">
            <div class="tracker-line"></div>
            <div class="tracker" :style="trackerStyle"></div>
            </div>
        </div>
        <div class="type-two">
            <div class="type-option">
                <span v-show="option == 0" class="option" :class="{'option-selected': typeOne == 0}" @click="changeType(0)">我创建的</span>
                <span v-show="option == 0" class="option" :class="{'option-selected': typeOne == 1}" @click="changeType(1)">我收藏的</span>
                <span v-show="option == 1" class="option" :class="{'option-selected': typeTwo == 0}" @click="changeType(0)">专辑</span>
                <span v-show="option == 1" class="option" :class="{'option-selected': typeTwo == 1}" @click="changeType(1)">歌手</span>
                <span v-show="option == 1" class="option" :class="{'option-selected': typeTwo == 2}" @click="changeType(2)">MV</span>
                <span v-show="option == 1" class="option" :class="{'option-selected': typeTwo == 3}" @click="changeType(3)">电台</span>
                <span v-show="option == 2 && isDesktop" class="option" :class="{'option-selected': typeThree == 0}" @click="changeType(0)">正在下载</span>
                <span v-show="option == 2 && isDesktop" class="option" :class="{'option-selected': typeThree == 1}" @click="changeType(1)">下载完成</span>
                <span v-show="option == 3 && isDesktop" class="option" :class="{'option-selected': typeFour == 0}" @click="changeType(0)">全部</span>
                <span v-show="option == 3 && isDesktop" class="option" :class="{'option-selected': typeFour == 1}" @click="changeType(1)">专辑</span>
                <span v-show="option == 3 && isDesktop" class="option" :class="{'option-selected': typeFour == 2}" @click="changeType(2)">歌手</span>
            </div>
            <span class="refresh" @click="refreshLocal()" v-show="isDesktop && listType1 == 3 && localStore.localFolderSettings.length != 0">刷新</span>
        </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .library-type{
    height: 50Px;
    .type-one{
        .type-option{
            padding-left: 5Px;
            display: flex;
            span{
                margin-right: 20Px;
                font: 16Px SourceHanSansCN-Bold;
                color: rgb(78, 78, 78);
                white-space: nowrap;
                transition: 0.2s;
                &:hover{
                    cursor: pointer;
                }
            }
            .option-selected{
                color: black;
            }
        }
        .option-tracker{
            width: 100%;
            height: 3Px;
            position: relative;
            .tracker-line{
                width: 100%;
                height: 0.1Px;
                background-color: rgb(111, 111, 111);
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
            }
            .tracker{
                height: 3Px;
                background-color: black;
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                transition: 0.3s;
            }
        }
    }
    .type-two{
        margin-top: 4Px;
        padding-left: 5Px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        .type-option{
            display: flex;
            flex-direction: row;
        }
        span{
            margin-right: 10Px;
            font: 12Px SourceHanSansCN-Bold;
            font-weight: bold;
            color: rgb(78, 78, 78);
            white-space: nowrap;
            &:hover{
            cursor: pointer;
            }
        }
        .option-selected{
            color: black;
        }
        .library-edit{
            margin-right: 6Px;
            position: relative;
            right: 0;
            }
        }
        .refresh{
            &:hover{
                color: black;
            }
        }
    }

  :global(html.dark .library-type .type-option .option) {
    color: var(--muted-text) !important;
    -webkit-text-fill-color: var(--muted-text) !important;
  }

  :global(html.dark .library-type .type-option .option-selected) {
    color: var(--text) !important;
    -webkit-text-fill-color: var(--text) !important;
  }

  :global(html.dark .library-type .type-one .option-tracker .tracker-line) {
    background-color: var(--border) !important;
  }

  :global(html.dark .library-type .type-one .option-tracker .tracker) {
    background-color: var(--text) !important;
  }

  :global(html.dark .library-type .refresh:hover) {
    color: var(--text) !important;
    -webkit-text-fill-color: var(--text) !important;
  }
</style>
