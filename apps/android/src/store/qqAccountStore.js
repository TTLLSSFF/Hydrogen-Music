import { defineStore } from 'pinia'
import pinia from './pinia'
import { getQQSessionStatus, getQQUserProfile, getQQUserAvatar, getQQLikedSongs, qqLogout } from '../api/qq'
import { getQQSongListDetail, unwrapQQResponse } from '../api/qqMusic'
import { createQQPersistedState, createQQPersistStorage } from '../utils/qqSession.mjs'
import { sanitizeQQPayload } from '../utils/qqSecurity.mjs'
import { loadQQLikedSongmids } from '../utils/qqLibrary.mjs'
import { useUserStore } from './userStore'

export const useQQAccountStore = defineStore('qqAccountStore', {
  state: () => ({
    user: null,
    loggedIn: false,
    vip: null,
    sessionToken: null,
    loading: false,
  }),
  actions: {
    persistNow() {
      // Pinia's detached subscription is asynchronous in some runtimes. QR
      // login calls restoreSession immediately after setting the token, so
      // make the browser-owned session available synchronously as well.
      try {
        if (typeof this.$persist === 'function') this.$persist()
      } catch (_) {}
    },
    setSession(user = null) {
      const safeUser = sanitizeQQPayload(user)
      this.user = safeUser && typeof safeUser === 'object' ? safeUser : null
      this.loggedIn = Boolean(this.user)
      this.persistNow()
    },
    setSessionToken(token = null) {
      const normalized = typeof token === 'string' ? token.trim() : ''
      this.sessionToken = normalized || null
      this.persistNow()
    },
    clearSession() {
      this.user = null
      this.vip = null
      this.sessionToken = null
      this.loggedIn = false
      // 喜欢状态与账号绑定：退出时一并清掉，避免下一个账号看到上一个账号的 ♡
      useUserStore(pinia).updateQQLikelist([])
      this.persistNow()
    },
    // 喜欢状态按 songmid 记录（与网易云的数字 id 列表完全隔离）。
    // 登录与切号后拉一次全量，供播放器的 ♡ 判断当前歌曲是否已喜欢；
    // 具体两步加载（元信息取歌单 id → 歌单详情取歌曲）收在 loadQQLikedSongmids 里。
    async refreshLikedSongmids() {
      const userStore = useUserStore(pinia)
      const accountId = String(this.user?.uin || '')
      if (!this.loggedIn || !accountId) {
        userStore.updateQQLikelist([])
        return []
      }

      const sessionToken = String(this.sessionToken || '')
      const isActive = () => this.loggedIn && String(this.sessionToken || '') === sessionToken
      try {
        const list = await loadQQLikedSongmids({
          fetchLikedMeta: () => getQQLikedSongs({ uin: accountId }),
          fetchPlaylistDetail: id => getQQSongListDetail(id),
          isActive,
        })
        if (!isActive()) return []
        userStore.updateQQLikelist(Array.isArray(list) ? list : [])
        return list
      } catch (error) {
        console.warn('加载 QQ 喜欢列表失败:', error?.message || error)
        return []
      }
    },
    async restoreSession() {
      this.loading = true
      try {
        try {
          const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('qqAccountStore') : null
          const persisted = raw ? JSON.parse(raw) : null
          if (!this.sessionToken && persisted?.sessionToken) this.setSessionToken(persisted.sessionToken)
        } catch (_) {}
        const status = await getQQSessionStatus()
        const sessionState = unwrapQQResponse(status)
        if (sessionState?.loggedIn !== true) {
          this.clearSession()
          return null
        }
        // 资料和头像是“我的音乐”所需的最小登录数据；VIP 等附属能力已收敛掉。
        const [profileResult, avatarResult] = await Promise.allSettled([
          getQQUserProfile(),
          getQQUserAvatar(),
        ])
        const profile = profileResult.status === 'fulfilled' ? profileResult.value : null
        const profilePayload = unwrapQQResponse(profile)
        const profileData = profilePayload?.data && typeof profilePayload.data === 'object'
          ? profilePayload.data
          : profilePayload
        const user = profileData?.profile || profileData?.user || profileData?.data?.profile || profileData
        const accountId = sessionState?.session?.uin || sessionState?.session?.loginUin
        this.setSession(user && typeof user === 'object' ? { ...user, ...(accountId && !user.uin ? { uin: accountId } : {}) } : { uin: accountId || '' })
        if (status?.data?.clientSession || status?.clientSession) this.sessionToken = status.data?.clientSession || status.clientSession
        const avatarPayload = avatarResult.status === 'fulfilled' ? unwrapQQResponse(avatarResult.value) : null
        const avatarData = avatarPayload?.data && typeof avatarPayload.data === 'object' ? avatarPayload.data : avatarPayload
        const avatar = avatarData?.avatar || avatarData?.user || avatarData
        if (avatar?.avatarUrl && this.user) this.user.avatarUrl = avatar.avatarUrl
        this.vip = null
        // 喜欢列表不阻塞登录流程，后台补齐即可
        void this.refreshLikedSongmids()
        return this.user
      } catch (_) {
        this.clearSession()
        return null
      } finally {
        this.loading = false
      }
    },
    async logout() {
      try {
        await qqLogout()
      } finally {
        this.clearSession()
      }
    },
  },
  persist: {
    storage: createQQPersistStorage(localStorage),
    serializer: {
      serialize: state => JSON.stringify(createQQPersistedState(state)),
      deserialize: value => {
        try {
          return createQQPersistedState(JSON.parse(value))
        } catch (_) {
          return createQQPersistedState()
        }
      },
    },
  },
})

export const qqAccountStore = useQQAccountStore(pinia)
