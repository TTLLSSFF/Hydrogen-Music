import { defineStore } from "pinia";
import { normalizeMusicSource } from '../utils/musicSource.mjs'

export const useUserStore = defineStore('userStore', {
    state: () => {
        return {
            user: null,
            loginMode: null,
            likelist: null,
            favoritePlaylistId: null,
            favoritePlaylistName: null,
            favoritePlaylistSource: null,
            appOptionShow: false,
            biliUser: null,
            homePage: true,
            homeSource: 'netease', // 首页音乐源：netease/qq，持久化，非法值回退
            cloudDiskPage: true,
            personalFMPage: true,
            sirenPage: false,
        }
    },
    actions: {
        updateUser(userinfo) {
            this.user = userinfo
        },
        setHomeSource(source) {
            this.homeSource = normalizeMusicSource(source) === 'qq' ? 'qq' : 'netease'
        },
        resetAccountState() {
            this.user = null
            this.loginMode = null
            this.likelist = null
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
        pick: ['user','biliUser','homePage','homeSource','cloudDiskPage','personalFMPage','sirenPage','favoritePlaylistId','favoritePlaylistName','favoritePlaylistSource']
    },
})
