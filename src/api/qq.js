import qqRequest, { createQQQrCheckRequestConfig } from '../utils/qqRequest.mjs'

export const getQQLoginQr = () => qqRequest({ url: '/getQQLoginQr', method: 'get' })
export const checkQQLoginQr = (sessionId) => qqRequest(createQQQrCheckRequestConfig(sessionId))
export const getQQSessionStatus = () => qqRequest({ url: '/session/status', method: 'get' })
export const getQQSingerInfo = (singermid, params = {}) => qqRequest({ url: '/getSingerInfo', method: 'get', params: { singermid, ...params } })
export const getQQSingerSongs = (singermid, params = {}) => qqRequest({ url: '/getSingerSongs', method: 'get', params: { singermid, ...params } })
export const getQQSingerAlbums = (singermid, params = {}) => qqRequest({ url: '/getSingerAlbums', method: 'get', params: { singermid, ...params } })
export const getQQUserProfile = (params) => qqRequest({ url: '/user/getUserDetail', method: 'get', params })
export const getQQUserAvatar = (params) => qqRequest({ url: '/user/getUserAvatar', method: 'get', params })
export const getQQLikedSongs = (params) => qqRequest({ url: '/user/getUserLikedSongs', method: 'get', params })
export const getQQPlaylists = (params) => qqRequest({ url: '/user/getUserPlaylists', method: 'get', params })
export const getQQCollectedPlaylists = (params) => qqRequest({ url: '/user/getUserCollectedSongLists', method: 'get', params })
export const getQQCollectedAlbums = (params) => qqRequest({ url: '/user/getUserCollectedAlbums', method: 'get', params })
export const getQQFollowedSingers = (params) => qqRequest({ url: '/user/getUserFollowSingers', method: 'get', params })
export const getQQFavMvs = (params) => qqRequest({ url: '/user/getUserFavMv', method: 'get', params })
export const getQQVipInfo = () => qqRequest({ url: '/user/getVipInfo', method: 'get' })
export const getQQFriends = (params) => qqRequest({ url: '/user/getFriendList', method: 'get', params })
export const getQQFans = (params) => qqRequest({ url: '/user/getUserFans', method: 'get', params })
export const getQQMedals = (params) => qqRequest({ url: '/user/getUserMedal', method: 'get', params })
export const getQQListeningCalendar = (params) => qqRequest({ url: '/user/getListeningCalendar', method: 'get', params })
export const getQQMusicGene = (params) => qqRequest({ url: '/user/getMusicGene', method: 'get', params })
export const getQQDislikeList = (params) => qqRequest({ url: '/user/getDislikeList', method: 'get', params })
export const qqLogout = () => qqRequest({ url: '/session/logout', method: 'post', data: {} })

// 写操作：服务端会校验 songmid 与 dirId 并注入会话 cookie，未登录 QQ 时返回 401。
// 喜欢固定写「我喜欢」歌单（服务端 dirId=201），歌单增删由调用方给出目标 dirId。
export const setQQLike = (songmid, like) => qqRequest({
  url: '/user/likeSong',
  method: 'post',
  data: { songmid, op: like ? 'add' : 'del' },
})
export const addQQPlaylistSong = (songmid, dirId) => qqRequest({
  url: '/user/songList',
  method: 'post',
  data: { songmid, dirId, op: 'add' },
})
export const removeQQPlaylistSong = (songmid, dirId) => qqRequest({
  url: '/user/songList',
  method: 'post',
  data: { songmid, dirId, op: 'del' },
})
