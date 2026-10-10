// 歌单写入的唯一按来源分流点。
//
// 网易云用「pid + songid」，QQ 用「dirId + songmid」，两套语义完全不同。
// 把分流收在这一处，UI（ContextMenu、批量入口）只调这里，就不会出现
// 某一处漏改而把 QQ 的歌曲 id 送进网易云歌单接口的情况。
//
// provider API 用动态 import：这些模块内部是 Vite 风格的省略扩展名导入，
// 静态引入会让本模块无法被 node --test 直接加载。
import { getQQSongMid, isQQSong } from './providerPolicy.mjs'

// 可写歌单标识：网易云是 pid，QQ 是 dirId（数字）。
// dirId 缺失说明该 QQ 歌单只能读，调用方应据此隐藏入口。
export function getWritablePlaylistId(playlist) {
  if (isQQSong(playlist)) {
    return String(playlist?.dirId ?? playlist?.dirid ?? '').replace(/[^0-9]/g, '')
  }
  return String(playlist?.id ?? '').trim()
}

export function isWritablePlaylist(playlist) {
  return !!getWritablePlaylistId(playlist)
}

function isNeteasePlaylistUpdateSuccess(result) {
  return !!(result && (
    (result.status === 200 && result.body && result.body.code === 200) ||
    result.code === 200 ||
    result.status === 200
  ))
}

async function defaultNeteaseUpdate(params) {
  const { updatePlaylist } = await import('../api/playlist.js')
  return updatePlaylist(params)
}

async function defaultQQMutate(op, songmid, dirId) {
  const { addQQPlaylistSong, removeQQPlaylistSong } = await import('../api/qq.js')
  return op === 'del'
    ? removeQQPlaylistSong(songmid, dirId)
    : addQQPlaylistSong(songmid, dirId)
}

// QQ 写端点一次只接受一个 songmid，因此逐首提交并统计失败数：
// 部分失败时不能整体报成功，否则用户会以为全部写入了。
async function mutateQQPlaylist(playlistId, songs, op, mutate) {
  const mids = songs.map(getQQSongMid).filter(Boolean)
  if (!mids.length) return { ok: false, total: 0, failed: 0, message: 'QQ 音乐歌曲标识缺失' }

  let failed = 0
  let message = ''
  for (const songmid of mids) {
    try {
      const result = await mutate(op, songmid, playlistId)
      const body = result?.data && typeof result.data === 'object' ? result.data : result
      if (body?.ok !== true) {
        failed += 1
        if (!message) message = String(body?.message || '')
      }
    } catch (error) {
      failed += 1
      if (!message) message = String(error?.message || '')
    }
  }

  return { ok: failed === 0, total: mids.length, failed, message }
}

async function mutatePlaylist({ playlist, songs, op, mutateQQ }) {
  const list = Array.isArray(songs) ? songs.filter(Boolean) : []
  const isRemove = op === 'del'
  if (!list.length) return { ok: false, total: 0, failed: 0, message: '请先选择歌曲' }

  const playlistId = getWritablePlaylistId(playlist)
  if (!playlistId) return { ok: false, total: list.length, failed: list.length, message: '歌单不可用' }

  if (isQQSong(playlist)) {
    const mutate = mutateQQ || ((mutateOp, songmid, dirId) => defaultQQMutate(mutateOp, songmid, Number(dirId)))
    return mutateQQPlaylist(playlistId, list, op, mutate)
  }

  const tracks = list.map(song => song.id).filter(Boolean).join(',')
  if (!tracks) return { ok: false, total: list.length, failed: list.length, message: '歌曲标识缺失' }

  try {
    const result = await defaultNeteaseUpdate({ op, pid: playlistId, tracks })
    const ok = isNeteasePlaylistUpdateSuccess(result)
    return {
      ok,
      total: list.length,
      failed: ok ? 0 : list.length,
      message: ok ? '' : (isRemove ? '删除失败' : '添加至歌单错误'),
    }
  } catch (error) {
    return { ok: false, total: list.length, failed: list.length, message: String(error?.message || '') }
  }
}

export function addSongsToPlaylist({ playlist, songs, mutateQQ } = {}) {
  return mutatePlaylist({ playlist, songs, op: 'add', mutateQQ })
}

export function removeSongsFromPlaylist({ playlist, songs, mutateQQ } = {}) {
  return mutatePlaylist({ playlist, songs, op: 'del', mutateQQ })
}