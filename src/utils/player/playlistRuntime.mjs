import { getSongIdentity } from '../musicSource.mjs'

export function getActivePlaylistSurface(widgetState) {
  return widgetState ? 'widget' : 'player'
}

export function getPlaylistItemKey(song, index) {
  return `${getSongIdentity(song) || 'playlist'}:${index}`
}

// 队列条目（含虚拟列表 key）按 songList 引用缓存。播放页 PlayList 在
// widget/player 表面切换时会被 v-if 重新挂载；若每次都从完整 songList 重新
// map，队列越大打开播放页越卡（实测 15000 首单次 map 约 80ms，卡在开场动画
// 首帧）。歌曲列表内容发生引用不变的变更（splice/push 等）时需显式失效。
let cachedQueueRef = null
let cachedQueueItems = null

export function getPlaylistItems(songList) {
  if (!Array.isArray(songList)) return []
  if (cachedQueueRef !== songList) {
    cachedQueueRef = songList
    cachedQueueItems = songList.map((song, index) => ({
      song,
      index,
      key: getPlaylistItemKey(song, index),
    }))
  }
  return cachedQueueItems
}

export function invalidatePlaylistItems(songList) {
  if (cachedQueueRef === songList) {
    cachedQueueRef = null
    cachedQueueItems = null
  }
}

/**
 * Return whether a window click should dismiss the currently open playlist.
 *
 * The widget and full player intentionally mount only one playlist surface at
 * a time.  Callers therefore pass the elements that actually exist instead of
 * requiring both legacy surfaces to be present.
 */
export function shouldClosePlaylistOnExternalClick(target, options = {}) {
  const playlistElements = Array.isArray(options.playlistElements) ? options.playlistElements : []
  if (playlistElements.length === 0 || options.isItemDelete === true) return false

  const allowedElements = [
    ...playlistElements,
    ...(Array.isArray(options.controlElements) ? options.controlElements : []),
    ...(Array.isArray(options.contextMenuElements) ? options.contextMenuElements : []),
  ]

  return !allowedElements.some(element => (
    element
    && typeof element.contains === 'function'
    && element.contains(target)
  ))
}
