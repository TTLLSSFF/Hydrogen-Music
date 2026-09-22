import { defineStore } from "pinia";

export const useUserStore = defineStore('userStore', {
    state: () => {
        return {
            user: null,
            loginMode: null,
            likelist: null,
            // QQ 歌曲的喜欢状态单独存放 songmid 集合：likelist 存的是网易云数字 id，
            // 而 checkIsLike 是不带来源判断的 includes，两者混放会互相串号。
            qqLikelist: [],
            favoritePlaylistId: null,
            favoritePlaylistName: null,
            favoritePlaylistSource: null,
            appOptionShow: false,
            biliUser: null,
            homePage: true,
            cloudDiskPage: true,
            personalFMPage: true,
            sirenPage: false,
            localOnlyMode: false,
        }
    },
    actions: {
        updateUser(userinfo) {
            this.user = userinfo
        },
        resetAccountState() {
            this.user = null
            this.loginMode = null
            this.likelist = null
            this.qqLikelist = []
            this.favoritePlaylistId = null
            this.favoritePlaylistName = null
            this.favoritePlaylistSource = null
            this.appOptionShow = false
        },
        clearBiliAccountState() {
            this.biliUser = null
        },
        updateLikelist(likelist) {
            this.likelist = Array.isArray(likelist) ? likelist : []
        },
        updateQQLikelist(likelist) {
            this.qqLikelist = Array.isArray(likelist) ? likelist : []
        },
        updateFavoritePlaylistId(playlistId) {
            this.favoritePlaylistId = playlistId
            this.favoritePlaylistSource = playlistId ? 'netease' : null
        },
        updateFavoritePlaylistName(playlistName) {
            this.favoritePlaylistName = playlistName
        },
        updateFavoritePlaylistMeta(playlist = null) {
            this.favoritePlaylistId = playlist?.id ?? null
            this.favoritePlaylistName = playlist?.name ?? null
            this.favoritePlaylistSource = playlist?.id
                ? (String(playlist?.source || '').toLowerCase() === 'qq' ? 'qq' : 'netease')
                : null
        }
    },
    persist: {
        storage: localStorage,
        pick: ['user','biliUser','homePage','cloudDiskPage','personalFMPage','sirenPage','localOnlyMode','favoritePlaylistId','favoritePlaylistName','favoritePlaylistSource'],
        // 本地音乐依赖桌面端文件系统能力：网页端强制关闭「仅本地音乐模式」，
        // 避免历史持久化状态把网页端锁进没有入口可退出的本地模式。
        afterHydrate: ({ store }) => {
            if (typeof windowApi === 'undefined') store.localOnlyMode = false
        },
    },
})
