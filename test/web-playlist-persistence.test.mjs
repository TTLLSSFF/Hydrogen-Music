import test from 'node:test'
import assert from 'node:assert/strict'
import {
  loadStoredPlaylist,
  persistPlaylistBeforeExit,
  saveStoredPlaybackProgress,
  saveStoredPlaylist,
} from '../src/utils/player/playlistPersistence.js'

const createMemoryStorage = () => {
  const store = new Map()
  return {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)) },
    removeItem: key => { store.delete(key) },
  }
}

const installGlobals = (values = {}) => {
  for (const [name, value] of Object.entries(values)) {
    try {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
    } catch (_) {
      globalThis[name] = value
    }
  }
}

const clearGlobals = (...names) => {
  for (const name of names) {
    try { delete globalThis[name] } catch (_) {}
  }
}

test('网页端把播放队列与进度分开落盘，恢复时进度覆盖队列里的旧值', async () => {
  const storage = createMemoryStorage()
  installGlobals({ localStorage: storage })
  clearGlobals('windowApi')

  saveStoredPlaylist({
    songList: [{ id: 1 }, { id: 2 }],
    shuffledList: [{ id: 2 }, { id: 1 }],
    progress: 12,
    songId: 1,
    currentIndex: 0,
  })
  saveStoredPlaybackProgress({ progress: 42, songId: 2, currentIndex: 1 })

  const restored = await loadStoredPlaylist()
  assert.equal(restored.songList.length, 2)
  assert.equal(restored.shuffledList.length, 2)
  assert.equal(restored.progress, 42)
  assert.equal(restored.songId, 2)
  assert.equal(restored.currentIndex, 1)

  clearGlobals('localStorage', 'windowApi')
})

test('网页端队列超过阈值时清掉旧记录且不再写入', async () => {
  const storage = createMemoryStorage()
  installGlobals({ localStorage: storage })
  clearGlobals('windowApi')

  saveStoredPlaylist({ songList: [{ id: 1 }], progress: 5, songId: 1, currentIndex: 0 })
  assert.ok(storage.getItem('hydrogen:last-playlist'))

  saveStoredPlaylist({
    songList: Array.from({ length: 2001 }, (_, index) => ({ id: index })),
    progress: 5,
    songId: 1,
    currentIndex: 0,
  })

  assert.equal(storage.getItem('hydrogen:last-playlist'), null)
  assert.equal(storage.getItem('hydrogen:last-playback-progress'), null)
  assert.equal(await loadStoredPlaylist(), null)

  clearGlobals('localStorage', 'windowApi')
})

test('网页端 localStorage 写入失败时不抛异常', async () => {
  const storage = createMemoryStorage()
  storage.setItem = () => { throw new Error('QuotaExceededError') }
  installGlobals({ localStorage: storage })
  clearGlobals('windowApi')

  assert.doesNotThrow(() => saveStoredPlaylist({ songList: [{ id: 1 }] }))
  assert.doesNotThrow(() => saveStoredPlaybackProgress({ progress: 1, songId: 1, currentIndex: 0 }))
  assert.doesNotThrow(() => persistPlaylistBeforeExit({ songList: [{ id: 1 }] }))
  assert.equal(await loadStoredPlaylist(), null)

  clearGlobals('localStorage', 'windowApi')
})

test('桌面端仍走 windowApi，不写 localStorage', async () => {
  const storage = createMemoryStorage()
  const calls = { playlist: [], progress: [], exit: [] }
  installGlobals({
    localStorage: storage,
    windowApi: {
      getLastPlaylist: async () => ({ songList: [{ id: 9 }], progress: 7, songId: 9, currentIndex: 0 }),
      saveLastPlaylist: json => { calls.playlist.push(json) },
      saveLastPlaybackProgress: state => { calls.progress.push(state) },
      exitApp: json => { calls.exit.push(json) },
    },
  })

  saveStoredPlaylist({ songList: [{ id: 1 }] })
  saveStoredPlaybackProgress({ progress: 3, songId: 1, currentIndex: 0 })
  persistPlaylistBeforeExit({ songList: [{ id: 2 }] })

  const restored = await loadStoredPlaylist()
  assert.equal(restored.songList[0].id, 9)
  assert.equal(calls.playlist.length, 1)
  assert.equal(calls.progress.length, 1)
  assert.equal(calls.exit.length, 1)
  assert.equal(storage.getItem('hydrogen:last-playlist'), null)

  clearGlobals('localStorage', 'windowApi')
})