import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
  clear: () => storage.clear(),
}

globalThis.window = globalThis

globalThis.location = { href: 'http://localhost/' }

let viteServer
let useLibraryStore

test.before(async () => {
  viteServer = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: 'custom',
  })
  ;({ useLibraryStore } = await viteServer.ssrLoadModule('/src/store/libraryStore.js'))
})

test.after(async () => {
  await viteServer.close()
})

function createStore() {
  setActivePinia(createPinia())
  return useLibraryStore()
}

function seedDetail(store, source, type) {
  store.libraryInfo = { id: 'same-id', source, type, name: `${source}-${type || 'private'}` }
  store.librarySongs = []
  store.cacheCurrentLibraryDetail('same-id', 'playlist', source, type)
}

test('真实 Store 按 QQ toplist、QQ 私人歌单和网易云歌单分流', async () => {
  const toplistStore = createStore()
  toplistStore.updateQQTopListDetail = async id => {
    toplistStore.libraryInfo = { id, source: 'qq', type: 'toplist' }
  }
  await toplistStore.updateLibraryDetail('top-id', 'playlist', { source: 'qq', type: 'toplist' })
  assert.equal(toplistStore.libraryInfo.type, 'toplist')

  const privateStore = createStore()
  privateStore.updateQQPlaylistDetail = async id => {
    privateStore.libraryInfo = { id, source: 'qq', type: 'private' }
  }
  await privateStore.updateLibraryDetail('private-id', 'playlist', { source: 'qq' })
  assert.equal(privateStore.libraryInfo.type, 'private')

  const neteaseStore = createStore()
  neteaseStore.updatePlaylistDetail = async (id, options) => {
    neteaseStore.libraryInfo = { id, source: options.source, type: options.type }
  }
  await neteaseStore.updateLibraryDetail('cloud-id', 'playlist', { source: 'netease', type: 'toplist' })
  assert.deepEqual(neteaseStore.libraryInfo, { id: 'cloud-id', source: 'netease', type: 'toplist' })
})

test('真实 Store 的详情缓存隔离 QQ 私人歌单与公共榜单 type', async () => {
  const toplistStore = createStore()
  seedDetail(toplistStore, 'qq', 'toplist')

  let privateLoaded = false
  toplistStore.updateQQPlaylistDetail = async id => {
    privateLoaded = true
    toplistStore.libraryInfo = { id, source: 'qq', type: 'private' }
  }
  await toplistStore.updateLibraryDetail('same-id', 'playlist', { source: 'qq' })
  assert.equal(privateLoaded, true)
  assert.equal(toplistStore.libraryInfo.type, 'private')

  const privateStore = createStore()
  seedDetail(privateStore, 'qq', '')
  let toplistLoaded = false
  privateStore.updateQQTopListDetail = async id => {
    toplistLoaded = true
    privateStore.libraryInfo = { id, source: 'qq', type: 'toplist' }
  }
  await privateStore.updateLibraryDetail('same-id', 'playlist', { source: 'qq', type: 'toplist' })
  assert.equal(toplistLoaded, true)
  assert.equal(privateStore.libraryInfo.type, 'toplist')
})

test('真实 Store 缓存恢复仅匹配规范化 type', () => {
  const store = createStore()
  seedDetail(store, 'qq', 'toplist')
  store.libraryInfo = null
  assert.equal(store.restoreLibraryDetailFromCache('same-id', 'playlist', 'qq', ''), false)
  assert.equal(store.libraryInfo, null)
  assert.equal(store.restoreLibraryDetailFromCache('same-id', 'playlist', 'qq', 'TOPLIST'), true)
  assert.equal(store.libraryInfo.type, 'toplist')
})
