<script setup>
  import { computed, onActivated, ref, watch } from 'vue'
  import { useRouter } from 'vue-router';
  import { getNewAlbum } from '../api/album';
  import { getRecommendedArtists } from '../api/artist';
  import { getRecommendedSongList, getTopList } from '../api/playlist'
  import {
    getQQPlaylistTags,
    getQQPlaylistsByTag,
    getQQDigitalAlbumLists,
    getQQPersonalRecommend,
    getQQTopLists,
    normalizeQQTagList,
    normalizeQQPlaylistCard,
    normalizeQQRecommendCards,
    normalizeQQDigitalAlbumCard,
    normalizeQQTopLists,
  } from '../api/qqMusic';
  import { useOtherStore } from '../store/otherStore'
  import { useLibraryStore } from '../store/libraryStore'
  import { usePlayerStore } from '../store/playerStore';
  import { openArtistRoute } from '../utils/qqArtistRoute.mjs';
  const libraryStore = useLibraryStore()
  const playerStore = usePlayerStore()
  const otherStore = useOtherStore()
  const router = useRouter()
  //0为歌单,1为歌手,2为专辑,3为排行榜
  const props = defineProps(['recType'])
  const recType = ref(props.recType)
  const recTitle = ref('')
  const recTitleEN = ref('')
  const recommendationList = ref([{}])
  // QQ 来源下的空态（未登录 / 上游不可用 / 无数据）
  const qqEmpty = ref(false)
  let recommendationLoaded = false
  let loadedQQSource = false
  const isQQSource = computed(() => otherStore.searchSource === 'qq')
  // 分类歌单的默认热门标签：标签接口不可用时用它兜底
  const QQ_DEFAULT_PLAYLIST_TAG_ID = '1'

  onActivated(() => {
    const qqSource = isQQSource.value
    if (recommendationLoaded && loadedQQSource === qqSource && Array.isArray(recommendationList.value) && recommendationList.value.length > 0) return
    /**
     * 第一个参数为推荐歌手的国家,第二个为推荐歌单请求数量，第三个为最新专辑的国家，
     * 最后为当前列表的类型
     */
    loadData(1, 10, 'all', recType.value)
  })

  // 切换平台来源后必须重新加载，否则会继续显示上一个来源的推荐内容
  watch(() => otherStore.searchSource, () => {
    recommendationLoaded = false
    qqEmpty.value = false
    recommendationList.value = [{}]
    void loadData(1, 10, 'all', recType.value)
  })
  //设置标题
  const setTitle = (cn, en) => {
    recTitle.value = cn
    recTitleEN.value = en
  }
  //随机选取数据
  const shuffleData = (originData, limit, total) => {
    let indexs = [];
    while (indexs.length < limit) {
        let num = parseInt(Math.random() * total)
        if (!indexs.includes(num)) indexs.push(num)
        else indexs = [];
    }
    return originData.filter((item,index) => {
        return indexs.includes(index)
    });
  }

  // QQ 各 recType 的数据源映射：0 推荐歌单 / 1 个性化推荐 / 2 新碟 / 3 排行榜
  async function loadQQData(limit, recType) {
    const size = Math.max(1, Number(limit) || 10)
    try {
        if(recType == 0) {
            setTitle("推荐歌单", "RECOMMENDED SONG LIST")
            // 标签接口不可用时退回默认热门标签，不因标签失败而丢掉整个区块
            let tagId = QQ_DEFAULT_PLAYLIST_TAG_ID
            try {
                const tags = normalizeQQTagList(await getQQPlaylistTags())
                const hotTag = tags.find(tag => /热门|推荐/.test(tag.name)) || tags[0]
                if (hotTag?.id) tagId = hotTag.id
            } catch (_) {}
            const payload = await getQQPlaylistsByTag({ tagId, page: 0, limit: 20 })
            recommendationList.value = normalizeQQPlaylistCard(payload).slice(0, size)
        } else if(recType == 1) {
            setTitle("个性化推荐", "PERSONAL RECOMMEND")
            // 上游返回的是推荐歌单卡片，归一化后与推荐歌单共用同一套卡片契约
            recommendationList.value = normalizeQQRecommendCards(await getQQPersonalRecommend()).slice(0, size)
        } else if(recType == 2) {
            setTitle("最新专辑", "NEWEST ALBUM")
            recommendationList.value = normalizeQQDigitalAlbumCard(await getQQDigitalAlbumLists()).slice(0, size)
        } else if(recType == 3) {
            setTitle("排行榜", "TOP LIST")
            recommendationList.value = normalizeQQTopLists(await getQQTopLists())
                .slice(0, size)
                .map(list => ({
                    ...list,
                    updateFrequency: list.listenCount > 0 ? `热度 ${list.listenCount}` : '',
                }))
        }
    } catch (_) {
        // 未登录（401）或上游不可用时只显示空态，绝不把异常抛进渲染
        recommendationList.value = []
    }
    qqEmpty.value = recommendationList.value.length === 0
  }

  //加载数据
  async function loadData(artistNation,limit,albumNation,recType) {
    if (isQQSource.value) {
        await loadQQData(limit, recType)
        recommendationLoaded = true
        loadedQQSource = true
        return
    }
    qqEmpty.value = false
    if(recType == 0) {
        const listData = await getRecommendedSongList(limit)
        recommendationList.value = listData.result
        setTitle("推荐歌单", "RECOMMENDED SONG LIST")
    } else if(recType == 1) {
        const listData = await getRecommendedArtists(artistNation)
        setTitle("推荐歌手", "RECOMMENDED ARTISTS")
        recommendationList.value = shuffleData(listData.artists, 5, 50)
    } else if(recType == 2) {
        const listData = await getNewAlbum({
            limit: limit,
            area: albumNation
        })
        setTitle("最新专辑", "NEWEST ALBUM")
        recommendationList.value = listData.albums
    } else if(recType == 3) {
        const listData = await getTopList()
        setTitle("排行榜", "TOP LIST")
        //选取指定排行榜
        let indexs = [0,3,8,11,15]
        recommendationList.value = listData.list.filter((item,index) => {
            return indexs.includes(index)
        });;
    }
    recommendationLoaded = true
    loadedQQSource = false
    // console.log(recommendationList.value)
  }

  // QQ 推荐歌单的「更多」入口：进入 QQ 专属分类歌单页
  const moreQQPlaylists = () => {
    router.push({ name: 'qqPlaylistCategory' })
  }

  const checkDetail = (id, item) => {
    if (loadedQQSource) {
      if (props.recType == 3) {
        router.push({ path: `/mymusic/playlist/${id}`, query: { source: 'qq', type: 'toplist' } })
        playerStore.forbidLastRouter = true
        return
      }
      if (props.recType == 0) {
        // 公共推荐歌单：带 type 让路由守卫识别为公共资源，未登录 QQ 也能打开
        router.push({ path: `/mymusic/playlist/${id}`, query: { source: 'qq', type: 'rec' } })
        playerStore.forbidLastRouter = true
        return
      }
      if (props.recType == 2) {
        router.push({ path: `/mymusic/album/${id}`, query: { source: 'qq' } })
        playerStore.forbidLastRouter = true
        return
      }
      // QQ 的 recType 1 是「个性化推荐歌单」，与 recType 0 一样跳 QQ 歌单详情
      if (props.recType == 1) {
        router.push({ path: `/mymusic/playlist/${id}`, query: { source: 'qq', type: 'rec' } })
        playerStore.forbidLastRouter = true
        return
      }
      playerStore.forbidLastRouter = true
      return
    }
    if (props.recType == 1) {
      openArtistRoute(router, item || { id }, {
        id,
        playerStore,
        source: item?.source,
        name: item?.name,
        singerid: item?.singerid || item?.singerID,
      })
      return
    }
    libraryStore.libraryInfo = null
    if(props.recType == 0) router.push('/mymusic/playlist/' + id)
    if(props.recType == 2) router.push('/mymusic/album/' + id)
    if(props.recType == 3) router.push('/mymusic/playlist/' + id)
    playerStore.forbidLastRouter = true
  }
  const checkArtist = (artist) => {
    openArtistRoute(router, artist, {
      playerStore,
      source: loadedQQSource ? 'qq' : artist?.source,
    })
  }
</script>

<template>
  <div class="rec-list-item">
    <div class="item-header">
        <div class="header">
            <div class="header-title-en">{{recTitleEN}}</div>
            <div class="line"></div>
            <div class="header-more" v-if="isQQSource && recType == 0" @click="moreQQPlaylists">更多</div>
        </div>
        <div class="header-title-cn">{{recTitle}}</div>
    </div>
    <div class="item-empty" v-if="qqEmpty">{{ recType == 1 ? '登录 QQ 音乐后可查看个性化推荐' : '暂无 QQ 音乐数据' }}</div>
    <div class="item-list" v-else>
        <div class="item" v-for="(item,index) in recommendationList">
            <div class="item-img" :class="(recType == 1 && !isQQSource) ? 'item-img-circle' : 'item-img-sqaure'" @click="checkDetail(item.id, item)">
                <img :src="(item.coverImgUrl || item.img1v1Url || item.picUrl) + '?param=450y450'" alt="">
            </div>
            <div class="item-name" :class="{'item-name-center': recType == 1 && !isQQSource}">{{item.name}}</div>
            <div class="item-sub" @click="checkArtist(item.artist)" v-if="item.artist">{{ item.artist.name }}</div>
            <div class="item-sub" v-else>{{ item.updateFrequency}}</div>
        </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .rec-list-item{
    .item-header{
        .header{
            width: 100%;
            display: flex;
            flex-direction: row;
            align-items: center;
            .header-title-en{
                margin-right: 6px;
                padding: 1px 0 1px 2px;
                width: 20vw;
                background-color: black;
                font: 0.7vw Geometos;
                color: white;
                text-align: left;
                white-space: nowrap;
            }
            .line{
                width: 100%;
                height: 1px;
                background-color: rgb(176 176 176);
            }
            .header-more{
                width: 60px;
                text-align: right;
                font: 10px SourceHanSansCN-Bold;
                color: rgb(112 112 112);
                transition: 0.2s;
                &:hover{
                    cursor: pointer;
                    color: black;
                }
            }
        }
        .header-title-cn{
            text-align: left;
            font: 2.1vw SourceHanSansCN-Bold;
            line-height: 2.5vw;
            color: black;
        }
    }
    // QQ 来源下的空态文案（未登录 / 上游不可用 / 无数据）
    .item-empty{
        margin-top: 13px;
        padding: 18px 0;
        text-align: left;
        font: 1.4vw SourceHanSansCN-Bold;
        color: rgb(109, 109, 109);
    }
    .item-list{
        margin-top: 13px;
        width: 100%;
        display: grid;
        grid-template-columns: repeat(5, 1fr);
        gap: 3.4vw 2.5vw;
        .item{
            .item-img{
                // width: 168px;
                // height: 168px;
                overflow: hidden;
                transition: 0.2s;
                &:hover{
                    cursor: pointer;
                    box-shadow: 0 0 10Px 1Px rgba(0, 0, 0, 0.1);
                }
                img{
                    width: 100%;
                    height: 100%;
                    border: 1px solid rgba(0,0,0,0.04);
                    vertical-align: bottom;
                }
            }
            .item-img-sqaure{
                border-radius: 0;
            }
            .item-img-circle{
                border-radius: 50%;
                img{
                    border-radius: 50%;
                }
            }
            .item-name,.item-sub{
                margin-top: 5px;
                text-align: left;
                font: 1.5vw SourceHanSansCN-Bold;
                font-weight: bold;
                color: black;
                overflow: hidden;
                display: -webkit-box;
                -webkit-box-orient:vertical;
                -webkit-line-clamp: 2;
                word-break: break-all;
                transition: 0.2s;
                &:hover{
                    cursor: pointer;
                    color: rgba(43, 43, 43, 1);
                }
            }
            .item-name-center{
                margin-top: 15px;
                text-align: center;
            }
            .item-sub{
                font: 1.2vw Source Han Sans;
                font-weight: normal;
                color: rgb(109, 109, 109);
                &:hover{
                    color: black;
                }
            }
        }
    }
  }
</style>
