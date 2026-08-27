import { isLogin } from './authority'
import { qqAccountStore } from '../store/qqAccountStore'
export { getMusicAccountId } from './accountIdentity.mjs'

export function hasQQAccount() {
  return qqAccountStore.loggedIn === true
}

export function hasAnyMusicAccount() {
  return isLogin() || hasQQAccount()
}

export function currentMusicAccountSource(preferred = '') {
  const source = String(preferred || '').trim().toLowerCase()
  if (source === 'qq' && hasQQAccount()) return 'qq'
  if (source === 'netease' && isLogin()) return 'netease'
  if (hasQQAccount() && !isLogin()) return 'qq'
  return 'netease'
}
