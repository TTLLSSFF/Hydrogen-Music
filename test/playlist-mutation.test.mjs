import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addSongsToPlaylist,
  getWritablePlaylistId,
  isWritablePlaylist,
  removeSongsFromPlaylist,
} from '../src/utils/playlistMutation.mjs'
import { normalizeQQPlaylist } from '../src/api/qqMusic.js'

// QQ 歌单写入用的是 dirId（数字），展示用的 disstid 不能当写目标。
test('QQ playlist dirId is extracted separately from the display id', () => {
  const fromDirId = normalizeQQPlaylist({ disstid: '9748964820', dirid: 7788, dissname: '我的歌单' })
  assert.equal(fromDirId.id, '9748964820')
  assert.equal(fromDirId.dirId, '7788')

  // 上游字段大小写不稳定，四种写法都要认
  assert.equal(normalizeQQPlaylist({ dirId: 11 }).dirId, '11')
  assert.equal(normalizeQQPlaylist({ dirID: 12 }).dirId, '12')
  assert.equal(normalizeQQPlaylist({ dir_id: 13 }).dirId, '13')
  assert.equal(normalizeQQPlaylist({ dirid: '14' }).dirId, '14')

  // 「我喜欢」这类歌单只有数字 id 时才可退化
  assert.equal(normalizeQQPlaylist({ id: 201 }).dirId, '201')

  // 只有 songmid 形态的 disstid 时不能产出 dirId，否则会写错目标
  const midOnly = normalizeQQPlaylist({ disstid: '0039MnYb0qxYhV', dissname: '无法写入' })
  assert.equal(midOnly.id, '0039MnYb0qxYhV')
  assert.equal(midOnly.dirId, undefined)
})

test('writable playlist id resolves per provider', () => {
  assert.equal(getWritablePlaylistId({ source: 'qq', id: '9748964820', dirId: '7788' }), '7788')
  assert.equal(getWritablePlaylistId({ source: 'qq', id: '9748964820' }), '')
  assert.equal(getWritablePlaylistId({ source: 'qq', dirid: 7788 }), '7788')
  assert.equal(getWritablePlaylistId({ id: 12345 }), '12345')
  assert.equal(getWritablePlaylistId({ id: '0039MnYb0qxYhV', source: 'qq' }), '')

  assert.equal(isWritablePlaylist({ source: 'qq', dirId: 1 }), true)
  assert.equal(isWritablePlaylist({ source: 'qq' }), false)
})

const qqSong = (mid, id) => ({ id, source: 'qq', sourceId: mid })

test('QQ playlist add sends one songmid per request and reports all-success', async () => {
  const calls = []
  const result = await addSongsToPlaylist({
    playlist: { source: 'qq', id: '9748964820', dirId: '7788' },
    songs: [qqSong('mid-1', '1'), qqSong('mid-2', '2')],
    mutateQQ: async (op, songmid, dirId) => {
      calls.push({ op, songmid, dirId })
      return { ok: true }
    },
  })

  assert.deepEqual(calls, [
    { op: 'add', songmid: 'mid-1', dirId: '7788' },
    { op: 'add', songmid: 'mid-2', dirId: '7788' },
  ])
  assert.deepEqual(result, { ok: true, total: 2, failed: 0, message: '' })
})

test('QQ playlist mutation counts partial failures instead of reporting success', async () => {
  const result = await addSongsToPlaylist({
    playlist: { source: 'qq', dirId: 7788 },
    songs: [qqSong('mid-1', '1'), qqSong('mid-2', '2'), qqSong('mid-3', '3')],
    mutateQQ: async (op, songmid) => {
      if (songmid === 'mid-2') return { ok: false, code: 10006, message: 'need login' }
      if (songmid === 'mid-3') throw new Error('network down')
      return { ok: true }
    },
  })

  assert.equal(result.ok, false)
  assert.equal(result.total, 3)
  assert.equal(result.failed, 2)
  assert.equal(result.message, 'need login')
})

test('QQ playlist removal uses the del op and skips songs without a songmid', async () => {
  const calls = []
  const result = await removeSongsFromPlaylist({
    playlist: { source: 'qq', dirId: 7788 },
    songs: [qqSong('mid-1', '1'), { id: '2', source: 'qq' }],
    mutateQQ: async (op, songmid, dirId) => {
      calls.push({ op, songmid, dirId })
      return { ok: true }
    },
  })

  assert.deepEqual(calls, [{ op: 'del', songmid: 'mid-1', dirId: '7788' }])
  assert.deepEqual(result, { ok: true, total: 1, failed: 0, message: '' })
})

test('playlist mutation rejects unusable targets and empty selections', async () => {
  const qqPlaylist = { source: 'qq', id: '9748964820' }
  assert.deepEqual(
    await addSongsToPlaylist({ playlist: qqPlaylist, songs: [qqSong('mid-1', '1')] }),
    { ok: false, total: 1, failed: 1, message: '歌单不可用' },
  )
  assert.deepEqual(
    await addSongsToPlaylist({ playlist: { source: 'qq', dirId: 1 }, songs: [] }),
    { ok: false, total: 0, failed: 0, message: '请先选择歌曲' },
  )
  assert.equal(
    (await removeSongsFromPlaylist({ playlist: { source: 'qq', dirId: 1 }, songs: [{ source: 'qq' }] })).message,
    'QQ 音乐歌曲标识缺失',
  )
})