import request from '../utils/request'
import { getQQMusicPlay, getQQLyric, normalizeQQPlaybackPayload } from './qqMusic'
import { normalizeMusicSource } from '../utils/musicSource.mjs'

const neteaseRequest = (config) => request(config)

export { normalizeQQPlaybackPayload }

export function searchBySource(_source, keyword, params = {}) {
  // QQ is intentionally limited to authenticated My Music. Search remains a
  // NetEase-only capability even when a stale caller passes `source=qq`.
  return neteaseRequest({ url: '/cloudsearch', method: 'get', params: { keywords: keyword, ...params } })
}

export function getPlayBySource(source, id, params = {}) {
  if (normalizeMusicSource(source) === 'qq') return getQQMusicPlay(id, params)
  return neteaseRequest({ url: '/song/url/v1', method: 'get', params: { id, ...params } })
}

export function getLyricBySource(source, id, params = {}) {
  if (normalizeMusicSource(source) === 'qq') return getQQLyric(id, params)
  return neteaseRequest({ url: '/lyric', method: 'get', params: { id, ...params } })
}
