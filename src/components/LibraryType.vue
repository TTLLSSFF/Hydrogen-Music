<script setup>
  import { onActivated, ref, watch } from 'vue'
  import { getUserPlaylistCount, getUserPlaylist } from '../api/user'
  import { getUserSubAlbum } from '../api/album'
  import { getUserSubArtists } from '../api/artist'
  import { getUserSubMV } from '../api/mv'
  import { useUserStore } from '../store/userStore'
  import { getDjSubList } from '../api/dj'
  import { useLibraryStore } from '../store/libraryStore'
  import { storeToRefs } from 'pinia'
  import { qqAccountStore } from '../store/qqAccountStore'
  import { getQQPlaylists, getQQCollectedPlaylists, getQQLikedSongs } from '../api/qq'
  import { normalizeQQLikedPlaylist } from '../api/qqMusic'
  import { loadQQPlaylistPages as loadQQPlaylistPagesData, mergeQQPlaylistLists } from '../utils/qqLibrary.mjs'
  import { isLogin } from '../utils/authority'
  import { getMusicAccountId, isMusicAccountRequestCurrent } from '../utils/accountIdentity.mjs'

  const userStore = useUserStore()
  const { user } = storeToRefs(userStore)
  const libraryStore = useLibraryStore()
  const { changeLibraryList } = libraryStore
  const { libraryList, libraryListAlbum, libraryListAritist, listType1, listType2, playlistOverviewVersion } = storeToRefs(libraryStore)

  const typeTracker = ref(0)
  const option = ref(0)
  const typeOne = ref(0)
  const typeTwo = ref(0)
  const lastLoadedUserId = ref(null)
  const lastHandledPlaylistOverviewVersion = ref(playlistOverviewVersion.value)
  const SUB_ALBUM_PAGE_SIZE = 100
  let libraryRequestToken = 0

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

  async function loadUserPlaylist(requestToken, requestUserId) {
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
      const listCount = await getUserPlaylistCount()
      if (!isLibraryRequestActive(requestToken, requestUserId, 'netease')) return false

      const list = await getUserPlaylist(params)
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

  async function refreshCurrentSection() {
    const requestUserId = getCurrentUserId()
    const requestToken = ++libraryRequestToken

    if ((option.value == 0 || option.value == 1) && !requestUserId) {
      clearAccountLibraryLists()
      return false
    }

    if (option.value == 0) {
      const qqUserId = String(qqAccountStore.user?.uin || qqAccountStore.user?.id || '')
      const [neteaseResult, qqCreated, qqSubscribed, qqLiked] = await Promise.all([
        isLogin() ? loadUserPlaylist(requestToken, user.value?.userId) : Promise.resolve({ created: [], subscribed: [] }),
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
    }
    void refreshCurrentSection()
  }

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
    () => playlistOverviewVersion.value,
    version => {
      if (version === lastHandledPlaylistOverviewVersion.value) return
      if (option.value != 0) return
      void refreshCurrentSection()
    }
  )

  onActivated(() => {
    const currentUserId = getCurrentUserId()
    const needsUserReload = (option.value == 0 || option.value == 1) && currentUserId && lastLoadedUserId.value !== currentUserId
    const needsPlaylistOverviewReload = option.value == 0 && playlistOverviewVersion.value !== lastHandledPlaylistOverviewVersion.value
    if (needsUserReload || needsPlaylistOverviewReload) {
      void refreshCurrentSection()
    }
  })

  changeTracker(0)
</script>

<template>
  <div>
    <div class="library-type">
        <div class="type-one">
            <div class="type-option">
            <span class="option" :class="{'option-selected': option == 0}" @click="changeTracker(0)" id="myPlaylist">歌单</span>
            <span class="option" :class="{'option-selected': option == 1}" @click="changeTracker(1)">收藏</span>
            </div>
            <div class="option-tracker">
            <div class="tracker-line"></div>
            <div :class="{'tracker': true, 'tracker0': typeTracker == 0, 'tracker1': typeTracker == 1}"></div>
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
            </div>
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
            .tracker0{
                width: 32Px;
                left: 4Px;
            }
            .tracker1{
                width: 32Px;
                left: 57Px;
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
</style>
