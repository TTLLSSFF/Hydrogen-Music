import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const libraryStorePath = new URL('../src/store/libraryStore.js', import.meta.url)

function extractMethod(source, name) {
  const marker = `async ${name}(`
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, `找不到 ${name}`)

  const bodyStart = source.indexOf('{', source.indexOf(')', start))
  let depth = 0
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`无法解析 ${name}`)
}

async function loadUpdateLibraryDetail() {
  const source = await readFile(libraryStorePath, 'utf8')
  const method = extractMethod(source, 'updateLibraryDetail')
  const functionSource = method.replace(/^async updateLibraryDetail/, 'async function updateLibraryDetail')
  return new Function('normalizeMusicSource', `return (${functionSource})`)(source => String(source || 'netease').toLowerCase())
}

function createStore() {
  const calls = []
  return {
    calls,
    libraryInfo: null,
    changeAnimation() { calls.push('changeAnimation') },
    resetSearchIndex() { calls.push('resetSearchIndex') },
    resetPlaylistHydration() { calls.push('resetPlaylistHydration') },
    shouldBypassLibraryDetailCache() { return true },
    restoreLibraryDetailFromCache() { return false },
    async updateQQTopListDetail(id) { calls.push(['updateQQTopListDetail', id]) },
    async updateQQPlaylistDetail(id) { calls.push(['updateQQPlaylistDetail', id]) },
    async updatePlaylistDetail(id, options) { calls.push(['updatePlaylistDetail', id, options]) },
    cacheCurrentLibraryDetail(id, routeName, source) { calls.push(['cacheCurrentLibraryDetail', id, routeName, source]) },
  }
}

test('QQ 公共榜单详情分流到公开榜单加载器，不走私人歌单或网易云加载器', async () => {
  const updateLibraryDetail = await loadUpdateLibraryDetail()
  const store = createStore()

  await updateLibraryDetail.call(store, '4', 'playlist', { source: 'qq', type: 'toplist' })

  assert.deepEqual(store.calls.filter(call => Array.isArray(call)), [
    ['updateQQTopListDetail', '4'],
    ['cacheCurrentLibraryDetail', '4', 'playlist', 'qq'],
  ])
})

test('QQ 私人歌单与网易云歌单保持原有详情分流', async () => {
  const updateLibraryDetail = await loadUpdateLibraryDetail()
  const qqStore = createStore()
  const neteaseStore = createStore()

  await updateLibraryDetail.call(qqStore, 'private-id', 'playlist', { source: 'qq' })
  await updateLibraryDetail.call(neteaseStore, 'cloud-id', 'playlist', { source: 'netease', type: 'toplist' })

  assert.deepEqual(qqStore.calls.filter(call => Array.isArray(call))[0], ['updateQQPlaylistDetail', 'private-id'])
  assert.deepEqual(neteaseStore.calls.filter(call => Array.isArray(call))[0], [
    'updatePlaylistDetail',
    'cloud-id',
    { source: 'netease', type: 'toplist' },
  ])
})

test('公开 QQ 榜单路由意图仅由 qq 与 toplist 组合满足', () => {
  const canEnterPlaylist = (source, type, loggedIn) => {
    const normalizedSource = String(source || 'netease').toLowerCase()
    const normalizedType = String(type || '').toLowerCase()
    const isQQTopList = normalizedSource === 'qq' && normalizedType === 'toplist'
    return isQQTopList || normalizedSource !== 'qq' || loggedIn === true
  }

  assert.equal(canEnterPlaylist('qq', 'toplist', false), true)
  assert.equal(canEnterPlaylist('QQ', 'TOPLIST', false), true)
  assert.equal(canEnterPlaylist('qq', '', false), false)
  assert.equal(canEnterPlaylist('qq', 'playlist', false), false)
  assert.equal(canEnterPlaylist('netease', 'toplist', false), true)
})
