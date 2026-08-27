import { containsQQSecret, isQQSecretKey, sanitizeQQPayload } from './qqSecurity.mjs'

/**
 * Keep QR image data private. A QR URL carrying qrsig/ptqrtoken (or any
 * cookie-like query key) is an authentication credential, not public image
 * metadata, so reject it before it can reach browser state or the DOM.
 */
export function sanitizeQQQrImage(value) {
  if (typeof value !== 'string') return ''
  const normalized = value.trim()
  if (!normalized || containsQQSecret(normalized)) return ''
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(normalized)) return normalized

  let parsed
  try {
    parsed = new URL(normalized)
  } catch (_) {
    return ''
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return ''
  for (const key of parsed.searchParams.keys()) {
    if (isQQSecretKey(key)) return ''
  }
  if (containsQQSecret(parsed.hash)) return ''
  return parsed.toString()
}

/**
 * Login endpoints may be returned directly or wrapped by an API adapter in
 * `data`, `body`, `response`, or `result`. Locate the first object carrying
 * QQ login fields without exposing or copying any credential material.
 */
export function extractQQLoginPayload(value, depth = 0, seen = new Set()) {
  if (depth > 6 || value == null || typeof value !== 'object' || seen.has(value)) return null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractQQLoginPayload(item, depth + 1, seen)
      if (found) return found
    }
    return null
  }
  if (Object.prototype.hasOwnProperty.call(value, 'clientSession')
    || Object.prototype.hasOwnProperty.call(value, 'isOk')
    || Object.prototype.hasOwnProperty.call(value, 'sessionId')
    || Object.prototype.hasOwnProperty.call(value, 'img')
    || Object.prototype.hasOwnProperty.call(value, 'qrUrl')) return value
  seen.add(value)
  for (const key of ['data', 'body', 'response', 'result']) {
    const found = extractQQLoginPayload(value[key], depth + 1, seen)
    if (found) {
      seen.delete(value)
      return found
    }
  }
  seen.delete(value)
  return null
}

export function createQQSessionSnapshot(user, _session = {}) {
  if (!user || typeof user !== 'object') return { source: 'qq', loggedIn: false, user: null }
  const safeUser = sanitizeQQPayload(user)
  return { source: 'qq', loggedIn: true, user: safeUser }
}

export function createQQPersistedState(state = {}) {
  const safeUser = sanitizeQQPayload(state.user)
  const safeVip = sanitizeQQPayload(state.vip)

  const text = (value) => {
    if (typeof value !== 'string' || containsQQSecret(value)) return undefined
    const normalized = value.trim()
    return normalized || undefined
  }
  const identifier = (value) => {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') return undefined
    if (typeof value === 'number' && !Number.isFinite(value)) return undefined
    return text(String(value))
  }
  const number = (value) => {
    if (typeof value !== 'number' && typeof value !== 'string') return undefined
    if (typeof value === 'string' && !value.trim()) return undefined
    const normalized = Number(value)
    return Number.isFinite(normalized) ? normalized : undefined
  }
  const boolean = value => typeof value === 'boolean' ? value : undefined
  const url = (value) => {
    const normalized = text(value)
    if (!normalized) return undefined
    if (/\[REDACTED\]/i.test(normalized)) return undefined
    try {
      const parsed = new URL(normalized)
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined
      if (parsed.username || parsed.password) return undefined
      for (const key of parsed.searchParams.keys()) {
        if (isQQSecretKey(key)) return undefined
      }
      if (containsQQSecret(parsed.hash)) return undefined
      return normalized
    } catch (_) {
      return undefined
    }
  }
  const assign = (target, key, value) => {
    if (value !== undefined) target[key] = value
  }

  const user = {}
  if (safeUser && typeof safeUser === 'object' && !Array.isArray(safeUser)) {
    assign(user, 'uin', identifier(safeUser.uin))
    assign(user, 'id', identifier(safeUser.id))
    assign(user, 'nickname', text(safeUser.nickname))
    assign(user, 'nick', text(safeUser.nick))
    assign(user, 'name', text(safeUser.name))
    assign(user, 'avatar', url(safeUser.avatar))
    assign(user, 'avatarUrl', url(safeUser.avatarUrl))
  }

  const vip = {}
  if (safeVip && typeof safeVip === 'object' && !Array.isArray(safeVip)) {
    assign(vip, 'level', number(safeVip.level))
    assign(vip, 'vipLevel', number(safeVip.vipLevel))
    assign(vip, 'isVip', boolean(safeVip.isVip))
    assign(vip, 'icon', url(safeVip.icon))
    assign(vip, 'expireTime', identifier(safeVip.expireTime))
  }

  const persistedUser = Object.keys(user).length ? user : null
  const persistedVip = Object.keys(vip).length ? vip : null
  const persisted = {
    loggedIn: Boolean(state.loggedIn && persistedUser),
    user: persistedUser,
    vip: persistedVip,
  }
  const sessionToken = typeof state.sessionToken === 'string' ? state.sessionToken.trim() : ''
  if (sessionToken) persisted.sessionToken = sessionToken
  return persisted
}

export function createPublicQQLoginSession(session = {}) {
  return {
    sessionId: String(session.sessionId || ''),
    img: sanitizeQQQrImage(session.img),
  }
}

export function createQQPersistStorage(storage) {
  const backing = storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function'
    ? storage
    : null

  const serialize = (raw) => JSON.stringify(createQQPersistedState(JSON.parse(String(raw))))

  return {
    getItem(key) {
      if (!backing) return null
      const raw = backing.getItem(key)
      if (raw === null || raw === undefined || raw === '') return null
      try {
        const migrated = serialize(raw)
        if (migrated !== raw) backing.setItem(key, migrated)
        return migrated
      } catch (_) {
        if (typeof backing.removeItem === 'function') backing.removeItem(key)
        return null
      }
    },
    setItem(key, value) {
      if (!backing) return
      try {
        backing.setItem(key, serialize(value))
      } catch (_) {
        if (typeof backing.removeItem === 'function') backing.removeItem(key)
      }
    },
    removeItem(key) {
      if (typeof backing?.removeItem === 'function') backing.removeItem(key)
    },
  }
}
