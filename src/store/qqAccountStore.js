import { defineStore } from 'pinia'
import pinia from './pinia'
import { getQQSessionStatus, getQQUserProfile, getQQUserAvatar, qqLogout } from '../api/qq'
import { unwrapQQResponse } from '../api/qqMusic'
import { createQQPersistedState, createQQPersistStorage } from '../utils/qqSession.mjs'
import { sanitizeQQPayload } from '../utils/qqSecurity.mjs'

export const useQQAccountStore = defineStore('qqAccountStore', {
  state: () => ({
    user: null,
    loggedIn: false,
    vip: null,
    loading: false,
  }),
  actions: {
    setSession(user = null) {
      const safeUser = sanitizeQQPayload(user)
      this.user = safeUser && typeof safeUser === 'object' ? safeUser : null
      this.loggedIn = Boolean(this.user)
    },
    clearSession() {
      this.user = null
      this.vip = null
      this.loggedIn = false
    },
    async restoreSession() {
      this.loading = true
      try {
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
        const avatarPayload = avatarResult.status === 'fulfilled' ? unwrapQQResponse(avatarResult.value) : null
        const avatarData = avatarPayload?.data && typeof avatarPayload.data === 'object' ? avatarPayload.data : avatarPayload
        const avatar = avatarData?.avatar || avatarData?.user || avatarData
        if (avatar?.avatarUrl && this.user) this.user.avatarUrl = avatar.avatarUrl
        this.vip = null
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
