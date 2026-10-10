<script setup>
  import { computed, ref, watch, watchPostEffect } from 'vue'
  import { useRouter } from 'vue-router'
  import { createPlaylist, updatePlaylist, deletePlaylist } from '../api/playlist'
  import { addToNext, addToNextLocal } from '../utils/player/lazy'
  import { noticeOpen } from '../utils/dialog';
  import { useLibraryStore } from '../store/libraryStore';
  import { useOtherStore } from '../store/otherStore';
  import { usePlayerStore } from '../store/playerStore'
  import { useUserStore } from '../store/userStore';
  import {
    canUseSongAction,
    filterProviderPlaylists,
    findProviderPlaylist,
    isProviderPlaylist,
    isQQSong,
  } from '../utils/providerPolicy.mjs'
  import { openArtistRoute } from '../utils/qqArtistRoute.mjs'
  import { getSirenSourceId } from '../utils/siren'
  import { normalizeMusicSource } from '../utils/musicSource.mjs'
  import { withCoverParam } from '../utils/coverBackdrop'
  import { getLikelist, getUserPlaylistCount, getUserPlaylist } from '../api/user'
  import { getQQPlaylists } from '../api/qq'
  import { loadQQPlaylistPages } from '../utils/qqLibrary.mjs'
  import { useQQAccountStore } from '../store/qqAccountStore'
  import {
    addSongsToPlaylist,
    getWritablePlaylistId,
    removeSongsFromPlaylist,
  } from '../utils/playlistMutation.mjs'
  import { schedulePlaylistCacheInvalidation } from '../utils/cacheInvalidation'
  import { copyToClipboard } from '../utils/clipboard'
  import { storeToRefs } from 'pinia';
  import { useIsMobile } from '../composables/useIsMobile'
  const isMobile = useIsMobile()
  const router = useRouter()
  const libraryStore = useLibraryStore()
  const otherStore = useOtherStore()
  const playerStore = usePlayerStore()
  const userStore = useUserStore()
  const qqAccountStore = useQQAccountStore()
  const loadedNeteasePlaylistUserId = ref('')
  const neteaseWritablePlaylists = computed(() => {
    const accountId = String(userStore.user?.userId || '')
    if (!accountId || loadedNeteasePlaylistUserId.value !== accountId) return []
    return filterProviderPlaylists(libraryStore.playlistUserCreated, 'netease')
  })
  // QQ 歌单单独加载而不是复用 ensureUserPlaylistsLoaded：后者以网易云 userId 为前提，
  // 纯 QQ 账号永远进不去，弹窗会恒空。只写本弹窗自己的 ref，避免动 libraryStore
  // 里那份由 LibraryType 维护、还包含「我喜欢」的歌单列表。
  const qqDialogPlaylists = ref([])
  const loadedQQPlaylistUserId = ref('')
  const qqWritablePlaylists = computed(() => (
    qqAccountStore.loggedIn ? qqDialogPlaylists.value : []
  ))
  // 待添加歌曲的来源：QQ 歌曲只能写 QQ 歌单（dirId + songmid），网易云歌曲只能写网易云歌单
  // （pid + songid）。两套歌单混在一个列表里时，用户会把 QQ 歌曲点进网易云歌单——必然失败。
  // 批量选择里混了两种来源时不做过滤（没有能同时覆盖两者的目标歌单）。
  const selectedSongSource = computed(() => {
    const items = Array.isArray(otherStore.selectedItems) && otherStore.selectedItems.length > 0
      ? otherStore.selectedItems
      : [otherStore.selectedItem]
    const sources = new Set(
      items
        .filter(item => item && typeof item === 'object')
        .map(item => normalizeMusicSource(item.source)),
    )
    return sources.size === 1 ? Array.from(sources)[0] : ''
  })
  const writablePlaylists = computed(() => {
    if (selectedSongSource.value === 'qq') return qqWritablePlaylists.value
    if (selectedSongSource.value === 'netease') return neteaseWritablePlaylists.value
    return [
      ...neteaseWritablePlaylists.value,
      ...qqWritablePlaylists.value,
    ]
  })
  // 创建歌单走的是网易云接口，QQ 歌曲写不进新建的网易云歌单，因此只对网易云歌曲展示该入口
  const canCreateNeteasePlaylist = computed(() => (
    !!userStore.user?.userId && selectedSongSource.value !== 'qq'
  ))
  const getPlaylistCover = item => withCoverParam(
    item?.coverImgUrl || item?.img1v1Url || item?.picUrl || item?.coverUrl,
    150,
  )
  const { librarySongs, listType1, listType2 } = storeToRefs(libraryStore)
  const menu = ref(null)

  watchPostEffect(() => {
    if (isMobile.value || !otherStore.contextMenuShow || !menu.value) return
    const { x, y } = otherStore.contextMenuPosition
    const menuList = menu.value
    menuList.style.left = Math.max(0, Math.min(x, document.body.clientWidth - menuList.offsetWidth)) + 'px'
    menuList.style.top = Math.max(0, Math.min(y, document.body.clientHeight - menuList.offsetHeight)) + 'px'
  })

  const isPrivacy = ref(false)
  const createActive = ref(false)
  const justNewPlaylist = ref(false)
  const newPlaylistTitle = ref(null)

  const isPlaylistUpdateSuccess = result => !!(result && (
    (result.status === 200 && result.body && result.body.code === 200) ||
    result.code === 200 ||
    result.status === 200
  ))

  const getPlaylistDisplayName = playlist => {
    const rawName = playlist?.name ?? playlist?.title ?? ''
    const playlistName = typeof rawName == 'string' ? rawName.trim() : String(rawName || '').trim()
    const isFavoritePlaylist = playlist?.id == userStore.favoritePlaylistId
      || Number(playlist?.specialType) === 5
      || playlistName === '我喜欢的音乐'
      || playlistName.endsWith('喜欢的音乐')

    if (isFavoritePlaylist) return '我喜欢的音乐'
    return playlistName || '歌单'
  }

  const normalizePlaylistTarget = playlistTarget => {
    if (playlistTarget && typeof playlistTarget == 'object') {
      // QQ 目标用 dirId 写入；没有 dirId 说明该歌单只能读
      if (isQQSong(playlistTarget)) {
        if (!getWritablePlaylistId(playlistTarget)) return null
        return {
          ...playlistTarget,
          source: 'qq',
          name: getPlaylistDisplayName(playlistTarget),
        }
      }
      if (!userStore.user?.userId) return null
      if (!isProviderPlaylist(playlistTarget, 'netease')) return null
      return {
        ...playlistTarget,
        id: playlistTarget.id,
        source: 'netease',
        name: getPlaylistDisplayName(playlistTarget),
      }
    }

    if (userStore.user?.userId) {
      const matchedPlaylist = findProviderPlaylist(
        neteaseWritablePlaylists.value,
        playlistTarget,
        'netease',
      )
      if (matchedPlaylist) {
        return {
          ...matchedPlaylist,
          id: matchedPlaylist.id,
          source: 'netease',
          name: getPlaylistDisplayName(matchedPlaylist),
        }
      }
    }

    const matchedQQPlaylist = qqWritablePlaylists.value.find(
      item => String(item.id) === String(playlistTarget),
    )
    if (matchedQQPlaylist) {
      return {
        ...matchedQQPlaylist,
        source: 'qq',
        name: getPlaylistDisplayName(matchedQQPlaylist),
      }
    }
    return null
  }

  // 确保在打开“添加到歌单”弹窗时，已加载用户歌单列表
  const ensureUserPlaylistsLoaded = async () => {
    try {
      // 仅在已登录且还未加载过时拉取
      if (!userStore.user || !userStore.user.userId) {
        loadedNeteasePlaylistUserId.value = ''
        return
      }
      const accountId = String(userStore.user.userId)
      if (loadedNeteasePlaylistUserId.value === accountId) return

      const count = await getUserPlaylistCount()

      const params = {
        uid: accountId,
        limit: 500,
        offset: 0,
        timestamp: Date.now(),
      }
      const list = await getUserPlaylist(params)
      if (list && Array.isArray(list.playlist)) {
        const createdCount = Number(count?.createdPlaylistCount) || 0
        const subscribedCount = Number(count?.subPlaylistCount) || 0
        const neteaseCreated = list.playlist.slice(0, createdCount).map(item => ({ ...item, source: 'netease' }))
        const neteaseSubscribed = list.playlist.slice(createdCount, createdCount + subscribedCount).map(item => ({ ...item, source: 'netease' }))
        const existingCreated = Array.isArray(libraryStore.playlistUserCreated)
          ? libraryStore.playlistUserCreated
          : []
        const existingSubscribed = Array.isArray(libraryStore.playlistUserSub)
          ? libraryStore.playlistUserSub
          : []
        const qqCreated = filterProviderPlaylists(existingCreated, 'qq')
        const qqSubscribed = filterProviderPlaylists(existingSubscribed, 'qq')
        const mergedCreated = [...neteaseCreated, ...qqCreated]
        const mergedSubscribed = [...neteaseSubscribed, ...qqSubscribed]
        const currentLibraryList = libraryStore.libraryList
        const wasCreatedList = currentLibraryList === existingCreated
        const wasSubscribedList = currentLibraryList === existingSubscribed
        libraryStore.playlistUserCreated = mergedCreated
        libraryStore.playlistUserSub = mergedSubscribed
        libraryStore.playlistCount = {
          ...(libraryStore.playlistCount || {}),
          createdPlaylistCount: mergedCreated.length,
          subPlaylistCount: mergedSubscribed.length,
        }
        if (wasCreatedList) libraryStore.libraryList = mergedCreated
        else if (wasSubscribedList) libraryStore.libraryList = mergedSubscribed
        loadedNeteasePlaylistUserId.value = accountId
      }
    } catch (e) {
      // 静默失败，弹窗仍可显示，后续可再次尝试
      console.error('加载用户歌单失败:', e)
    }
  }

  // QQ 歌单：只在弹窗需要时拉一次，并且只落到本弹窗的 ref（见 qqDialogPlaylists 的说明）。
  // 没有可写 dirId 的歌单直接过滤掉，避免用户点了才发现写不进去。
  const ensureQQPlaylistsLoaded = async () => {
    if (!qqAccountStore.loggedIn) {
      qqDialogPlaylists.value = []
      loadedQQPlaylistUserId.value = ''
      return
    }
    const accountId = String(qqAccountStore.user?.uin || '')
    if (!accountId || loadedQQPlaylistUserId.value === accountId) return
    try {
      const loaded = await loadQQPlaylistPages(
        params => getQQPlaylists({ uin: accountId, ...params }),
        { subscribed: false, limit: 500 },
      )
      if (!qqAccountStore.loggedIn) return
      qqDialogPlaylists.value = (Array.isArray(loaded) ? loaded : [])
        .filter(item => !!getWritablePlaylistId(item))
      loadedQQPlaylistUserId.value = accountId
    } catch (error) {
      // 静默失败：弹窗仍可显示网易云歌单，后续打开会再次尝试
      console.error('加载 QQ 歌单失败:', error)
    }
  }

  watch(
    () => otherStore.addPlaylistShow,
    async (show) => {
      if (!show) return
      await ensureUserPlaylistsLoaded()
      await ensureQQPlaylistsLoaded()
    },
    { immediate: true }
  )

  watch(
    () => userStore.user?.userId,
    () => {
      loadedNeteasePlaylistUserId.value = ''
    },
  )

  watch(
    () => [qqAccountStore.loggedIn, qqAccountStore.user?.uin],
    () => {
      loadedQQPlaylistUserId.value = ''
      qqDialogPlaylists.value = []
    },
  )

  const addToPlaylist = () => {
    if (!canUseSongAction(otherStore.selectedItem, 'playlistMutation')) {
      noticeOpen('该歌曲暂不支持歌单修改', 2)
      return
    }
    otherStore.addPlaylistShow = true
  }

  const deleteFromPlaylist = async () => {
    if (!canUseSongAction(otherStore.selectedItem, 'playlistMutation')) {
      noticeOpen('该歌曲暂不支持歌单修改', 2)
      return
    }
    const currentPlaylist = otherStore.selectedPlaylist
    if (!getWritablePlaylistId(currentPlaylist)) {
      // 从搜索结果、榜单等非歌单场景右键时没有歌单上下文
      noticeOpen('请从歌单内操作', 2)
      otherStore.contextMenuShow = false
      return
    }
    // QQ 歌单走 provider 自有写端点；网易云特有的喜欢列表联动与详情重取不适用
    if (isQQSong(currentPlaylist)) {
      const qqResult = await removeSongsFromPlaylist({
        playlist: currentPlaylist,
        songs: [otherStore.selectedItem],
      })
      if (!qqResult.ok) {
        noticeOpen('删除失败', 2)
        return
      }
      const qqSongIndex = (librarySongs.value || []).findIndex((song) => song.id == otherStore.selectedItem.id)
      if (qqSongIndex !== -1) librarySongs.value.splice(qqSongIndex, 1)
      updatePlaylistCache(currentPlaylist.id)
      noticeOpen('删除成功', 2)
      return
    }
    let params = {
      op: 'del',
      pid: otherStore.selectedPlaylist.id,
      tracks: otherStore.selectedItem.id
    }
    
    try {
      const result = await updatePlaylist(params)
      
      // 根据实际返回格式判断成功
      const isSuccess = isPlaylistUpdateSuccess(result)
      
      if(isSuccess) {
        // 从当前歌曲列表中移除该歌曲
        const songIndex = (librarySongs.value || []).findIndex((song) => song.id == otherStore.selectedItem.id)
        if(songIndex !== -1) {
          librarySongs.value.splice(songIndex, 1)
        }
        
        // 检查是否从"我喜欢的音乐"歌单删除，如果是则同步更新喜欢列表
        await updateLikelistIfFromFavorite()
        
        // 如果当前正在查看该歌单，实时更新歌单内容
        await updateCurrentPlaylistIfViewing(otherStore.selectedPlaylist.id)
        
        updatePlaylistCache(otherStore.selectedPlaylist.id)
        const isFavoritePlaylist = userStore.favoritePlaylistId && otherStore.selectedPlaylist.id == userStore.favoritePlaylistId
        noticeOpen(isFavoritePlaylist ? '已取消喜欢' : '删除成功', 2)
      } else {
        noticeOpen('删除失败', 2)
      }
    } catch (error) {
      console.error('删除歌曲失败:', error)
      noticeOpen('删除失败', 2)
    }
  }

  const markPlaylistDetailStale = playlistId => {
    schedulePlaylistCacheInvalidation()
    libraryStore.markPlaylistOverviewStale()
    if (playlistId) libraryStore.invalidatePlaylistDetailCache(playlistId)
  }

  const updatePlaylistCache = playlistId => {
    otherStore.addPlaylistShow = false
    createActive.value = false
    markPlaylistDetailStale(playlistId)
    try {
      if(listType1.value == 0 && listType2.value == 0) {
        const myPlaylistElement = document.getElementById('myPlaylist')
        if (myPlaylistElement) {
          myPlaylistElement.click()
        }
      }
    } catch (e) {
      console.error('点击myPlaylist失败，忽略:', e)
    }
  }

  // 检查并更新当前查看的歌单
  const updateCurrentPlaylistIfViewing = async playlistId => {
    if (!playlistId) return
    // 检查当前是否在查看被删除歌曲的歌单
    if (libraryStore.libraryInfo && libraryStore.libraryInfo.id == playlistId) {
        try {
            markPlaylistDetailStale(playlistId)
            // 重新获取歌单详情
            await libraryStore.updatePlaylistDetail(playlistId, { deferRemaining: true })
        } catch (error) {
            console.error('更新歌单失败:', error)
        }
    }
  }

  // 检查是否从"我喜欢的音乐"删除歌曲，如果是则同步更新喜欢列表
  const updateLikelistIfFromFavorite = async () => {
    try {
      // 检查被删除的歌单是否是"我喜欢的音乐"歌单
      const isFromFavoritePlaylist = userStore.favoritePlaylistId && 
        otherStore.selectedPlaylist.id == userStore.favoritePlaylistId
      
      if (isFromFavoritePlaylist) {
        // 从本地喜欢列表中移除该歌曲
        if (Array.isArray(userStore.likelist) && userStore.likelist.includes(otherStore.selectedItem.id)) {
          const likeIndex = userStore.likelist.indexOf(otherStore.selectedItem.id)
          userStore.likelist.splice(likeIndex, 1)
        }
        
        // 异步获取最新的喜欢列表以确保数据最终一致
        try {
          const res = await getLikelist(userStore.user.userId)
          userStore.updateLikelist(res?.ids)
        } catch (error) {
          console.error('同步喜欢列表失败:', error)
        }
      }
    } catch (error) {
      console.error('检查并更新喜欢列表失败:', error)
    }
  }

  const newPlaylist = () => {
    otherStore.addPlaylistShow = true
    justNewPlaylist.value = true
  }

  const deleteMyPlaylist = () => {
    let params = {
      id: otherStore.selectedItem.id
    }
    deletePlaylist(params).then(result => {
      if(result.code == 200) {
        if(listType1.value == 0 && listType2.value == 0) {
          document.getElementById('myPlaylist').click()
          noticeOpen('删除成功', 2)
        }
      } else {
        noticeOpen("删除歌单失败", 2)
      }
      
    })
  }

  // 分享链接按来源生成：网易云歌曲用网页版歌曲页，网易云电台节目用节目页，
  // QQ 歌曲用官方曲目页，塞壬唱片用官网曲目页；都不匹配时提示不支持。
  const copySongLink = async () => {
    const song = otherStore.selectedItem
    let link = ''
    if (isQQSong(song)) {
      const songMid = song?.sourceId || song?.songmid || song?.mid
      if (songMid) link = `https://y.qq.com/n/ryqq/songDetail/${songMid}`
    } else if (song?.source === 'siren') {
      const cid = getSirenSourceId(song)
      if (cid) link = `https://monster-siren.hypergryph.com/music/${cid}`
    } else if (song?.type === 'dj' && song?.programId) {
      link = `https://music.163.com/#/program?id=${song.programId}`
    } else if (song?.id) {
      link = `https://music.163.com/#/song?id=${song.id}`
    }
    otherStore.contextMenuShow = false
    if (!link) {
      noticeOpen('该歌曲暂不支持复制链接', 2)
      return
    }
    const copied = await copyToClipboard(link)
    noticeOpen(copied ? '歌曲链接已复制' : '复制失败', 2)
  }

  const menuOpt = (id) => {
    otherStore.contextMenuShow = false
    if(id == 1) { addToNext(otherStore.selectedItem, true); return; }
    if(id == 2) { addToNext(otherStore.selectedItem, false); return; }
    if(id == 21) {
      const song = otherStore.selectedItem
      const artist = song?.ar?.[0]
      if (!artist) {
        noticeOpen('暂无歌手信息', 2)
        return
      }
      if (song?.source === 'siren') {
        const artistId = artist.id
        if (!artistId) {
          noticeOpen('暂无歌手信息', 2)
          return
        }
        playerStore.forbidLastRouter = true
        router.push('/siren/artist/' + artistId)
        otherStore.contextMenuShow = false
        return
      }
      if (!openArtistRoute(router, artist, { song, playerStore, source: song?.source })) {
        noticeOpen('暂无歌手信息', 2)
        return
      }
      otherStore.contextMenuShow = false
      return
    }
    if(id == 22) {
      const song = otherStore.selectedItem
      if (!canUseSongAction(song, 'mv')) {
        noticeOpen('QQ 音乐暂不支持 MV', 2)
        otherStore.contextMenuShow = false
        return
      }
      const mvId = song?.mv
      if (!mvId) {
        noticeOpen('暂无 MV 信息', 2)
        return
      }
      playerStore.forbidLastRouter = true
      if (song?.source === 'qq') router.push({ path: '/mymusic/mv/' + mvId, query: { source: 'qq' } })
      else router.push('/mymusic/mv/' + mvId)
      otherStore.contextMenuShow = false
      return
    }
    if(id == 3) {
      const song = otherStore.selectedItem
      if (!canUseSongAction(song, 'download')) {
        noticeOpen('该歌曲暂不支持下载', 2)
        otherStore.contextMenuShow = false
        return
      }
      if (!song || song.type === 'local') {
        noticeOpen('本地歌曲无需下载', 2)
        return
      }
      // 与歌单页的批量下载统一：先选音质，再由弹窗入队
      otherStore.downloadItems = [song]
      otherStore.downloadTitle = '下载当前歌曲'
      otherStore.downloadQualityShow = true
      return
    }
    if(id == 12) { return copySongLink(); }
    if(id == 11) {
      const song = otherStore.selectedItem
      if (!canUseSongAction(song, 'album')) {
        noticeOpen('该歌曲暂不支持专辑详情', 2)
        otherStore.contextMenuShow = false
        return
      }
      // QQ 专辑路由按 albumMid 取数（getQQAlbumInfo 只认 albummid），
      // al.id 是数字 albumid，用它拼路由会查不到专辑。
      const albumId = isQQSong(song)
        ? (song?.al?.mid || song?.albumMid || song?.al?.albumMid)
        : song?.al?.id
      if (!albumId) {
        noticeOpen('暂无专辑信息', 2)
        return
      }
      playerStore.forbidLastRouter = true
      if (song?.source === 'siren') router.push('/siren/album/' + albumId)
      else if (song?.source === 'qq') router.push({ path: '/mymusic/album/' + albumId, query: { source: 'qq' } })
      else router.push('/mymusic/album/' + albumId)
      otherStore.contextMenuShow = false
      return
    }
    if(id == 4) { addToPlaylist(); return; }
    if(id == 5) { deleteFromPlaylist(); return; }
    if(id == 6) { newPlaylist(); return; }
    if(id == 7) { deleteMyPlaylist(); return; }
    if(id == 8) { addToNextLocal(otherStore.selectedItem, true); return; }
    if(id == 9) { addToNextLocal(otherStore.selectedItem, false); return; }
    if(id == 10) {
      const folderPath = otherStore.selectedItem?.dirPath || otherStore.selectedItem?.path
      if (folderPath) windowApi.openLocalFolder(folderPath)
      otherStore.contextMenuShow = false
      return
    }
  }
  const createAndAdd = () => {
    const playlistName = String(newPlaylistTitle.value || '').trim()
    if(playlistName) {
      let params = {
        name: playlistName,
        privacy: (isPrivacy.value ? 10 : 0),
      }
      createPlaylist(params).then(result => {
        if(result.code == 200) {
          newPlaylistTitle.value = null
          isPrivacy.value = false
          if(justNewPlaylist.value) {
            document.getElementById('myPlaylist').click()
            otherStore.addPlaylistShow = false
            justNewPlaylist.value = false
            noticeOpen('添加成功', 2)
            return
          }
          addToMyPlaylist({ id: result.id, name: playlistName })
        } else {
          noticeOpen('创建歌单错误', 2)
        }
      })
    }
  }
  const createCancel = () => {
    if(justNewPlaylist.value) {
      otherStore.addPlaylistShow = false
      justNewPlaylist.value = false
      return
    }
    createActive.value = false
  }
  const addToMyPlaylist = async playlistTarget => {
      if (!canUseSongAction(otherStore.selectedItem, 'playlistMutation')) {
        noticeOpen('该歌曲暂不支持歌单修改', 2)
        return
      }
      const playlist = normalizePlaylistTarget(playlistTarget)
      if (!playlist || !getWritablePlaylistId(playlist)) {
        noticeOpen('歌单不可用', 2)
        return
      }
      // 支持批量添加：优先使用 selectedItems，如果不存在则使用 selectedItem
      const items = otherStore.selectedItems && otherStore.selectedItems.length > 0
        ? otherStore.selectedItems
        : [otherStore.selectedItem]
      if (items.some(item => !canUseSongAction(item, 'playlistMutation'))) {
        noticeOpen('该歌曲暂不支持歌单修改', 2)
        return
      }

      const result = await addSongsToPlaylist({ playlist, songs: items })
      if (!result.ok) {
        noticeOpen(result.message || '添加至歌单错误', 2)
        return
      }

      const count = items.length
      // QQ 歌单没有网易云那套本地详情缓存，写完直接刷新弹窗与列表即可
      if (isQQSong(playlist)) {
        updatePlaylistCache(playlist.id)
        noticeOpen(`已添加 ${count} 首歌曲到${playlist.name}`, 2)
        return
      }

      updateCurrentPlaylistIfViewing(playlist.id).finally(() => {
        updatePlaylistCache(playlist.id)
        noticeOpen(`已添加 ${count} 首歌曲到${playlist.name}`, 2)
      })
  }
</script>

<template>
  <div ref="menu" id="menu" class="context-menu">
    <div v-if="isMobile && otherStore.contextMenuShow" class="menu-backdrop" @click.stop="otherStore.contextMenuShow = false"></div>
    <div class="menu-container" v-show="otherStore.contextMenuShow" @click.stop>
      <div v-if="isMobile" class="mobile-menu-title">{{ otherStore.selectedItem?.name || '更多操作' }}</div>
      <div class="menu-item">
        <button type="button" class="item" @click="menuOpt(item.id)" v-for="item in otherStore.menuTree" :key="item.id">{{item.name}}</button>
      </div>
      <button v-if="isMobile" type="button" class="menu-cancel" @click="otherStore.contextMenuShow = false">取消</button>
      <div class="menu-style menu-style1">+</div>
      <div class="menu-style menu-style2">+</div>
      <div class="menu-style menu-style3">+</div>
      <div class="menu-style menu-style4">+</div>
      <div class="menu-style5">MENU</div>
    </div>
    <Transition name="add-fade">
      <div class="add-to-playlist" v-if="otherStore.addPlaylistShow" @click="otherStore.addPlaylistShow = false;createActive = false;newPlaylistTitle = '';">
        <div class="playlist-container" :class="{'playlist-container-newPlaylist': justNewPlaylist}" @click.stop>
          <span class="add-title">{{justNewPlaylist ? '添加歌单' : '添加到我的歌单'}}</span>
          <div class="my-playlist">
            <div class="create-playlist" v-show="!justNewPlaylist && canCreateNeteasePlaylist" :style="{background: createActive ? 'rgba(53, 53, 53, 0.7)' : 'none'}" @click="createActive = !createActive">
              <div class="list-img">
                <svg t="1671329712143" class="icon" viewBox="-1 -2 1027 1027" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="2116" width="200" height="200"><path d="M939.939489 459.072557 562.339502 459.072557 562.339502 83.519182 462.055494 83.519182 462.055494 459.072557 84.455507 459.072557 84.455507 559.356564 462.055494 559.356564 462.055494 939.003164 562.339502 939.003164 562.339502 559.356564 939.939489 559.356564Z" fill="#ffffff" p-id="2117"></path></svg>
              </div>
              <span class="list-name">创建新歌单并添加</span>
            </div>
            <div class="create-playlist create-playlist-active" :class="{'create-playlist-active2': createActive || justNewPlaylist}">
              <input type="text" v-model="newPlaylistTitle" placeholder="请输入新歌单标题">
              <div class="checkbox" @click="isPrivacy = !isPrivacy">
                <div class="box" :class="{'box-selected': isPrivacy}">
                  <svg t="1671347600812" class="icon" viewBox="-24 -24 1072 1072" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="4196" width="200" height="200"><path d="M155.644361 439.225533 376.468722 660.086733l486.86146-490.229161 95.379301 95.352695-585.574692 588.933183L65.289494 546.298154 155.644361 439.225533 155.644361 439.225533zM155.644361 439.225533" fill="#272636" p-id="4197"></path></svg>
                </div>
                <span class="box-label">设置为隐私歌单</span>
              </div>
              <div class="create-confirm" @click="createAndAdd()">完成</div>
              <div class="create-cancel" @click="createCancel()">取消</div>
            </div>
            <div class="list" @click="addToMyPlaylist(item)" v-show="!justNewPlaylist" v-for="(item, index) in writablePlaylists" :key="`${item.source || 'netease'}-playlist-${item.id}`">
              <div class="list-img">
                <img :src="getPlaylistCover(item)" alt="">
              </div>
              <span class="list-name">{{(item.name ?? item.title)}}</span>
            </div>
          </div>
          <span class="add-style add-style1"></span>
          <span class="add-style add-style2"></span>
          <span class="add-style add-style3"></span>
          <span class="add-style add-style4"></span>
          <span class="add-style5">ADD</span>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped lang="scss">
  .context-menu{
    position: absolute;
    overflow: hidden;
    .menu-container{
      padding: 18Px 0;
      position: relative;
      background-color: rgb(32, 32, 32);
      transform: translateY(-100%);
      animation: menu-container-in 0.2s cubic-bezier(.3,.79,.55,.99) forwards;
      @keyframes menu-container-in {
        0%{transform: translateY(-100%)}
        100%{transform: translateY(0)}
      }
      .menu-item{
        display: flex;
        flex-direction: column;
        .item{
          border: 0;
          background: transparent;
          padding: 10Px 18Px;
          width: 100%;
          font: 13Px SourceHanSansCN-Bold;
          color: white;
          text-align: left;
          transition: 0.2s;
          z-index: 2;
          &:hover{
            cursor: pointer;
            background-color: rgba(53, 53, 53, 0.7);
          }
          &:active{
            transform: scale(0.95);
          }
          &:first-child{
            padding-top: 8Px;
          }
          &:last-child{
            padding-bottom: 8Px;
          }
        }
      }
      .menu-style{
        position: absolute;
        color: white;
      }
      .menu-style1{
        top: 0;
        left: 3Px;
      }
      .menu-style2{
        top: 0;
        right: 3Px;
      }
      .menu-style3{
        bottom: 0;
        right: 3Px;
      }
      .menu-style4{
        bottom: 0;
        left: 3Px;
      }
      .menu-style5{
        font: 35Px Gilroy-ExtraBold;
        color: rgb(57, 57, 57);
        position: absolute;
        top: 10Px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1;
      }
    }
    .add-to-playlist{
      width: 100%;
      height: 100%;
      position: fixed;
      top: 0;
      left: 0;
      background-color: rgba(0, 0, 0, 0.05);
      overflow: hidden;
      z-index: 9999;
      .playlist-container{
        width: 0;
        height: 0;
        background-color: rgb(15, 15, 15);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        animation: playlist-container-in 0.6s 0.3s forwards;
        @keyframes playlist-container-in {
          0%{width: 0;height: 0;}
          50%{width: 300Px;height: 0;}
          100%{width: 300Px;height: 500Px;}
        }
        .add-title{
          display: inline-block;
          padding: 10Px 0;
          font: 16Px SourceHanSansCN-Bold;
          color: white;
          opacity: 0;
          animation: add-title-in 0.3s 0.5s forwards;
          @keyframes add-title-in {
            0%{opacity: 0;}
            100%{opacity: 1;}
          }
        }
        .my-playlist{
          width: 100%;
          height: calc(100% - 44Px);
          overflow: auto;
          &::-webkit-scrollbar{
            display: none;
          }
          .create-playlist, .list{
            padding: 10Px 22Px;
            width: 100%;
            display: flex;
            flex-direction: row;
            align-items: center;
            transition: 0.2s;
            &:hover{
              cursor: pointer;
              background-color: rgba(53, 53, 53, 0.7);
            }
            input{
              padding: 4Px 8Px;
              width: 100%;
              background-color: white;
              outline: none;
              border: 0.5Px solid white;
              background-color: transparent;
              color: white;
              font: 16Px SourceHanSansCN-Bold;
              &::-webkit-input-placeholder{
                font: 12Px Source Han Sans;
                font-weight: bold;
                color: rgb(180, 180, 180);
              }
            }
            .checkbox{
              margin-top: 4Px;
              display: flex;
              flex-direction: row;
              align-items: center;
              .box{
                margin-right: 5Px;
                width: 10Px;
                height: 10Px;
                border: 0.5Px solid white;
                position: relative;
                transition: 0.1s;
                svg{
                  width: 100%;
                  height: 100%;
                  position: absolute;
                  top: 0;
                  left: 0;
                }
              }
              .box-selected{
                background-color: white;
              }
              .box-label{
                font: 12Px SourceHanSansCN-Bold;
                color: white;
              }
            }
            .create-confirm, .create-cancel{
              padding: 4Px 0;
              margin-top: 20Px;
              width: 100%;
              font: 11Px SourceHanSansCN-Bold;
              color: white;
              text-align: center;
              border: 1Px solid white;
              &:hover{
                color: black;
                background-color: white;
              }
            }
            .create-cancel{
              margin-top: 10Px;
            }
            .list-img{
              margin-right: 15Px;
              width: 45Px;
              height: 45Px;
              border: 0.5Px solid rgb(69, 69, 69);
              svg{
                padding: 10Px;
                width: 100%;
                height: 100%;
              }
              img{
                width: 100%;
                height: 100%;
              }
            }
            .list-name{
              font: 14Px SourceHanSansCN-Bold;
              color: white;
            }
          }
          .create-playlist-active{
            padding: 0;
            height: 0;
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            overflow: hidden;
            transition: 0.2s;
          }
          .create-playlist-active2{
            padding: 10Px 22Px;
            height: 160Px;
          }
        }
        .add-style{
          width: 9Px;
          height: 9Px;
          background-color: rgb(247, 247, 247);
          position: absolute;
          opacity: 0;
          animation: add-style-in 0.4s forwards;
          @keyframes add-style-in {
            0%{opacity: 0;}
            10%{opacity: 1;}
            20%{opacity: 0;}
            30%{opacity: 1;}
            40%{opacity: 0;}
            50%{opacity: 1;}
            60%{opacity: 0;}
            70%{opacity: 1;}
            80%{opacity: 0;}
            90%{opacity: 0;}
            100%{opacity: 1;}
          }
        }
        $position: -4Px;
        .add-style1{
          top: $position;
          left: $position;
        }
        .add-style2{
          top: $position;
          right: $position;
        }
        .add-style3{
          bottom: $position;
          right: $position;
        }
        .add-style4{
          bottom: $position;
          left: $position;
        }
        .add-style5{
          font: 55Px Gilroy-ExtraBold;
          color: rgb(37, 37, 37);
          position: absolute;
          top: 10Px;
          left: 20Px;
          z-index: -1;
          opacity: 0;
          animation: add-style5-in 0.3s 0.6s forwards;
          @keyframes add-style5-in {
            0%{opacity: 0;}
            100%{opacity: 1;}
          }
        }
      }
      .playlist-container-newPlaylist{
        animation: playlist-container-in-extra 0.6s 0.3s forwards;
        @keyframes playlist-container-in-extra {
          0%{width: 0;height: 0;}
          50%{width: 300Px;height: 0;}
          100%{width: 300Px;height: 240Px;}
        }
      }
    }
    .add-fade-enter-active {
      transition: 0.2s;
    }
    .add-fade-leave-active {
      transition: 0.1s;
    }

    .add-fade-enter-from,
    .add-fade-leave-to {
      opacity: 0;
    }
  }
</style>
