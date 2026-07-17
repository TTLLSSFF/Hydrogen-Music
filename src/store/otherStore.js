import { defineStore } from 'pinia'
import { search } from '../api/other';
import { mapSongsPlayableStatus } from '../utils/songStatus';
import { noticeOpen } from '../utils/dialog';

export const useOtherStore = defineStore('otherStore', {
    state: () => {
        return {
          screenWidth: 1056,
          contextMenuShow: false,
          menuTree: null,
          tree1: [
            {
                id: 1,
                name: '播放'
            },
            {
                id: 2,
                name: '下一首播放'
            },
            {
                id: 3,
                name: '下载'
            },
            {
                id: 11,
                name: '显示专辑'
            },
            {
                id: 4,
                name: '添加到歌单'
            },
            {
                id: 5,
                name: '从歌单中删除'
            }
          ],
          tree2: [
            {
                id: 1,
                name: '播放'
            },
            {
                id: 2,
                name: '下一首播放'
            },
            {
                id: 3,
                name: '下载'
            },
            {
                id: 11,
                name: '显示专辑'
            },
            {
                id: 4,
                name: '添加到歌单'
            }
          ],
          tree3: [
            {
                id: 6,
                name: '新建歌单'
            },
            {
                id: 7,
                name: '删除此歌单'
            }
          ],
          tree4: [
            {
                id: 8,
                name: '播放'
            },
            {
                id: 9,
                name: '下一首播放'
            },
            {
                id: 10,
                name: '打开本地文件夹'
            }
          ],
          tree5: [
            {
                id: 1,
                name: '播放'
            },
            {
                id: 2,
                name: '下一首播放'
            },
            {
                id: 3,
                name: '下载'
            },
            {
                id: 11,
                name: '显示专辑'
            }
          ],
          tree6: [
            {
                id: 10,
                name: '打开文件夹'
            }
          ],
          selectedPlaylist: null,
          selectedItem: null,
          addPlaylistShow: false,
          dialogShow: false,
          dialogHeader: null,
          dialogText: null,
          noticeShow: false,
          noticeText: null,
          niticeOutAnimation: false,
          player: null,
          searchResult: {},
          searchRequestToken: 0,
          toUpdate: false,
          newVersion: null,
        }
    },
    actions: {
        // setRem() {
        //     const scale = this.screenWidth / 16
        //     const htmlWidth = document.documentElement.clientWidth || document.body.clientWidth
        //     const htmlDom = document.getElementsByTagName('html')[0]
        //     htmlDom.style.fontSize = htmlWidth / scale + 'px'
        // },
        async getSearchInfo(keywords) {
            const requestToken = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            this.searchRequestToken = requestToken

            const requestConfigs = [
                { type: 1, key: 'searchSongs' },
                { type: 10, key: 'searchAlbums' },
                { type: 100, key: 'searchArtists', limit: 10 },
                { type: 1000, key: 'searchPlaylists', limit: 10 },
                { type: 1004, key: 'searchMvs', limit: 10 },
            ]

            const results = await Promise.allSettled(requestConfigs.map(config => {
                const params = {
                    keywords,
                    type: config.type,
                }
                if (config.limit) params.limit = config.limit
                return search(params)
            }))

            if (this.searchRequestToken !== requestToken) return

            const nextSearchResult = {
                searchSongs: [],
                searchAlbums: [],
                searchArtists: [],
                searchPlaylists: [],
                searchMvs: [],
            }

            results.forEach((result, index) => {
                if (result.status !== 'fulfilled') return
                const data = result.value
                const config = requestConfigs[index]
                if (!config || !data?.result) return

                if (config.key === 'searchSongs') {
                    nextSearchResult.searchSongs = mapSongsPlayableStatus(data.result.songs || [])
                    return
                }

                if (config.key === 'searchAlbums') {
                    nextSearchResult.searchAlbums = data.result.albums || []
                    return
                }

                if (config.key === 'searchArtists') {
                    nextSearchResult.searchArtists = data.result.artists || []
                    return
                }

                if (config.key === 'searchPlaylists') {
                    nextSearchResult.searchPlaylists = data.result.playlists || []
                    return
                }

                if (config.key === 'searchMvs') {
                    nextSearchResult.searchMvs = data.result.mvs || []
                }
            })

            this.searchResult = nextSearchResult
        }
    },
})
