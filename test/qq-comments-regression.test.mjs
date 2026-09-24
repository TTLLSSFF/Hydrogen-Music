import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { ref, computed, watch, nextTick, effectScope, reactive, toRefs } from 'vue'
import { readCommentCountCache, writeCommentCountCache } from '../src/utils/commentCountCache.js'
import { normalizeQQCommentList, normalizeQQSong } from '../src/api/qqMusic.js'
import { getQQCommentId, isQQSong, canUseSongAction } from '../src/utils/providerPolicy.mjs'

const require = createRequire(import.meta.url)
const { createQQSecurityMiddleware } = require('../server/qqMusicApi.cjs')
const comment = id => ({ commentid: id, rootcommentcontent: `正文 ${id}`, nick: '读者' })
const payload = (id, total = 51774, more = 1) => ({ code: 0, subcode: 0, morecomment: more,
  comment: { commenttotal: total, commentlist: [comment(id)] },
  hot_comment: { commenttotal: 2685, commentlist: [comment(`hot-${id}`)] } })

test('QQ comment totals survive data/response envelopes and never depend on page length', () => {
  for (const body of [payload('a'), { response: payload('a') }, { data: payload('a') }, { body: { response: { data: payload('a') } } }]) {
    const result = normalizeQQCommentList(body)
    assert.equal(result.total, 51774)
    assert.equal(result.hotTotal, 2685)
    assert.equal(result.comments[0].content, '正文 a')
  }
})

test('QQ explicit zero total is not replaced by latest plus hot page lengths', () => {
  assert.equal(normalizeQQCommentList(payload('a', 0)).total, 0)
})

test('QQ HTTP-success business errors and malformed bodies must not become empty success', () => {
  for (const body of [{ code: 1000 }, { code: 0, subcode: 1 }, { response: { code: 500003 } }, { data: { code: 860100005 } }, {}, null]) {
    assert.throws(() => normalizeQQCommentList(body), /QQ/)
  }
})

test('QQ legacy null lists remain valid for zero comments', () => {
  const result = normalizeQQCommentList({ code: 0, comment: { commenttotal: 0, commentlist: null }, morecomment: 0 })
  assert.equal(result.total, 0)
  assert.deepEqual(result.comments, [])
  assert.equal(result.hasMore, false)
})

test('QQ songmid must not be stripped into a fake numeric comment id', () => {
  const song = normalizeQQSong({ source: 'qq', songId: '0039MnYb0qxYhV', id: 4830342 })
  assert.equal(getQQCommentId(song), '4830342')
  assert.equal(getQQCommentId(normalizeQQSong({ songId: '0039MnYb0qxYhV' })), '')
})

test('QQ route converts upstream business failure into HTTP failure', async () => {
  const middleware = createQQSecurityMiddleware({ commentsService: async () => ({ status: 200, body: { code: 1000, subcode: 0 } }) })
  const ctx = { method: 'GET', path: '/getComments', url: '/getComments?id=4830342', query: { id: '4830342' }, headers: {}, request: { headers: {} }, set() {}, remove() {} }
  await middleware(ctx, async () => assert.fail('must handle comments'))
  assert.equal(ctx.status, 502)
})

test('QQ legacy list zero is enriched with the independent cmd=4 total for nyamura', async t => {
  const urls = []
  t.mock.method(globalThis, 'fetch', async url => {
    urls.push(new URL(url))
    return { ok: true, json: async () => new URL(url).searchParams.get('cmd') === '4'
      ? { code: 0, subcode: 0, commenttotal: 22, topid: '662385897' }
      : { ...payload('nyamura', 0), topic_name: 'あたしの病気を治してくれる？' } }
  })
  const middleware = createQQSecurityMiddleware()
  const ctx = { method: 'GET', path: '/getComments', query: { id: '662385897' }, headers: {}, request: { headers: {} }, set() {}, remove() {} }
  await middleware(ctx, async () => assert.fail('must handle comments'))
  assert.equal(ctx.status, 200)
  const body = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body
  assert.equal(normalizeQQCommentList(body).total, 22)
  assert.deepEqual(urls.map(url => url.searchParams.get('cmd')), ['8', '4'])
})

test('QQ independent count failures never become successful zero totals', async t => {
  for (const countBody of [{ code: 1000 }, { code: 0 }, { code: 0, subcode: 1, commenttotal: 0 }]) {
    const mock = t.mock.method(globalThis, 'fetch', async url => ({ ok: true,
      json: async () => new URL(url).searchParams.get('cmd') === '4' ? countBody : payload('visible', 0) }))
    const ctx = { method: 'GET', path: '/getComments', query: { id: '662385897' }, headers: {}, request: { headers: {} }, set() {}, remove() {} }
    await createQQSecurityMiddleware()(ctx, async () => assert.fail('must handle comments'))
    assert.equal(ctx.status, 502)
    mock.mock.restore()
  }
})

test('QQ empty HTTP 500 list response stays failed and logs safe diagnostics before JSON parsing', async t => {
  const previous = process.env.QQ_COMMENT_DEBUG
  process.env.QQ_COMMENT_DEBUG = '1'
  t.after(() => { if (previous === undefined) delete process.env.QQ_COMMENT_DEBUG; else process.env.QQ_COMMENT_DEBUG = previous })
  const events = [], upstream = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('http://127.0.0.1:7777/')) {
      events.push(JSON.parse(options.body))
      return { ok: true }
    }
    upstream.push(new URL(url).searchParams.get('cmd'))
    return { ok: false, status: 500, headers: new Headers({ 'content-type': 'text/html' }), json: async () => { throw new SyntaxError('Unexpected end of JSON input') } }
  })
  const ctx = { method: 'GET', path: '/getComments', query: { id: '637446956' }, headers: {}, request: { headers: {} }, set() {}, remove() {} }
  await createQQSecurityMiddleware()(ctx, async () => assert.fail('must handle comments'))
  assert.equal(ctx.status, 502)
  assert.deepEqual(upstream, ['8'], 'must not pretend a count-only response contains comments')
  assert.ok(events.some(event => event.location === 'qqMusicApi:comment-http' && event.data.status === 500))
  assert.ok(events.some(event => event.location === 'qqMusicApi:comment-error' && event.data.name === 'SyntaxError' && event.data.id === '637446956'))
  assert.equal(JSON.stringify(events).includes('Unexpected end'), false, 'raw exception details must not enter diagnostics')
})

// Execute the real composable with only its store/transport/lifecycle boundaries replaced.
const source = readFileSync(new URL('../src/composables/useCommentsPanel.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace('export function useCommentsPanel', 'function useCommentsPanel')
function mountPanel(request, { playerStore, emit } = {}) {
  const store = playerStore ? toRefs(playerStore) : { songId: ref('A'), songList: ref([{ source: 'qq', numericId: '1' }]), currentIndex: ref(0), listInfo: ref({}) }
  const events = [], notices = [], unmounts = []
  const deps = { ref, computed, watch, nextTick, onMounted: () => {}, onUnmounted: fn => unmounts.push(fn),
    usePlayerStore: () => store, useUserStore: () => ({}), storeToRefs: value => value,
    getIndexedSongOrFirst: (songs, index) => songs[index] || songs[0],
    getQQCommentId, isQQSong, canUseSongAction, getQQComments: request, normalizeQQCommentList,
    noticeOpen: (...args) => notices.push(args), formatCommentTime: () => '',
    getCommentScrollPosition: () => null, setCommentScrollPosition: () => {},
    getLastCommentTargetKey: () => '', setLastCommentTargetKey: () => {},
    requestAnimationFrame: fn => { fn(); return 1 }, cancelAnimationFrame: () => {} }
  const create = new Function(...Object.keys(deps), `${source}; return useCommentsPanel`)(...Object.values(deps))
  const scope = effectScope()
  const panel = scope.run(() => create({ emit: (...args) => { events.push(args); emit?.(...args) } }))
  return { panel, store, events, notices, stop() { unmounts.forEach(fn => fn()); scope.stop() } }
}
const flush = async () => { for (let i = 0; i < 12; i++) await nextTick() }

// Run the actual MusicPlayer setup, including its immediate count watcher.
const playerSource = readFileSync(new URL('../src/views/MusicPlayer.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*$/gm, '')
function mountPlayer(request, numericId = '4830342') {
  const store = reactive({ songId: '0039MnYb0qxYhV', songList: [normalizeQQSong({
    source: 'qq', songmid: '0039MnYb0qxYhV', songid: numericId,
  })], currentIndex: 0, listInfo: {} })
  const deps = { ref, computed, watch, nextTick, defineAsyncComponent: () => ({}),
    usePlayerStore: () => store, getIndexedSongOrFirst: (songs, index) => songs[index] || songs[0],
    buildCoverBackdropCandidates: () => [], useStableImageSource: value => value,
    canUseSongAction, getQQCommentId, isQQSong, getQQComments: request, normalizeQQCommentList,
    readCommentCountCache, writeCommentCountCache }
  const scope = effectScope()
  const player = scope.run(() => new Function(...Object.keys(deps), `${playerSource};
    return { commentCount, commentCountBadge, commentTarget, handleCommentTotalChange }`)(...Object.values(deps)))
  return { player, store, stop: () => scope.stop() }
}

for (const outcome of ['reject', 'zero', 'business-error']) {
  test(`QQ entry retains panel total when earlier count request finishes with ${outcome}`, async () => {
    let resolveCount, rejectCount
    const h = mountPlayer(() => new Promise((resolve, reject) => { resolveCount = resolve; rejectCount = reject }), `483034${['reject', 'zero', 'business-error'].indexOf(outcome) + 2}`)
    const p = mountPanel(async args => {
      assert.equal(args.id, h.player.commentTarget.value.id)
      const body = payload('visible')
      body.comment.commentlist = Array.from({ length: 15 }, (_, i) => comment(i + 1))
      return body
    }, { playerStore: h.store, emit: (_, event) => h.player.handleCommentTotalChange(event) })
    try {
      await flush()
      const key = h.player.commentTarget.value.key
      assert.equal(p.panel.comments.value.length, 15)
      assert.equal(p.events[0][1].targetKey, key)
      assert.equal(h.player.commentCount.value, 51774)
      assert.equal(h.player.commentCountBadge.value, '5w+')
      if (outcome === 'reject') rejectCount(new Error('count request unavailable'))
      else resolveCount(outcome === 'zero' ? payload('old', 0) : { code: 1000 })
      await flush()
      assert.equal(h.player.commentCount.value, 51774, 'late count request must not erase successfully loaded panel total')
      assert.equal(readCommentCountCache(key), 51774)
    } finally { p.stop(); h.stop() }
  })
}

test('QQ entry resets previous song count immediately on uncached track change', async () => {
  const h = mountPlayer(args => args.id === '4830350' ? Promise.resolve(payload('first')) : new Promise(() => {}), '4830350')
  try {
    await flush()
    assert.equal(h.player.commentCount.value, 51774)
    h.store.songList = [{ source: 'qq', numericId: '4830351', songmid: 'another-mid' }]
    await nextTick()
    assert.equal(h.player.commentCount.value, 0, 'new song must not display the old song count while loading')
    await flush()
  } finally { h.stop() }
})

test('QQ entry preserves totals across panel reopen, cache reuse and track changes', async () => {
  const pending = []
  const h = mountPlayer(args => new Promise(resolve => pending.push({ args, resolve })), '4830360')
  const mount = () => mountPanel(async () => payload('visible'), {
    playerStore: h.store, emit: (_, event) => h.player.handleCommentTotalChange(event),
  })
  let p = mount()
  try {
    await flush()
    assert.equal(h.player.commentCountBadge.value, '5w+')
    p.stop()
    p = mount()
    await flush()
    assert.equal(h.player.commentCount.value, 51774)
    p.stop()
    h.store.songList = [{ source: 'qq', numericId: '4830361', songmid: 'different-mid', sourceKey: 'qq:different-mid' }]
    await flush()
    h.player.handleCommentTotalChange({ targetKey: 'qq:4830360', total: 888 })
    pending[0].resolve(payload('old', 999))
    await flush()
    assert.equal(h.player.commentCount.value, 0)
    pending[1].resolve(payload('new', 42))
    await flush()
    assert.equal(h.player.commentCountBadge.value, '42')
    h.store.songList = [normalizeQQSong({ songid: '4830360', songmid: '0039MnYb0qxYhV' })]
    await flush()
    assert.equal(h.player.commentTarget.value.key, 'qq:4830360')
    assert.equal(h.player.commentCount.value, 51774)
    pending[2].resolve({ code: 1000 })
    await flush()
    assert.equal(h.player.commentCount.value, 51774)
    h.player.handleCommentTotalChange({ targetKey: 'qq:4830360', total: 0 })
    assert.equal(h.player.commentCountBadge.value, '0', 'a successful explicit zero must still update the badge')
  } finally { h.stop() }
})

test('QQ panel renders contents and appends the next zero-based page without changing total', async () => {
  const calls = []
  const h = mountPanel(async args => { calls.push(args); return payload(`page-${args.page}`, 51774, args.page === 0 ? 1 : 0) })
  try {
    await flush()
    assert.equal(h.panel.comments.value[0].content, '正文 page-0')
    assert.equal(h.panel.total.value, 51774)
    h.panel.commentsContainerRef.value = { scrollTop: 1, clientHeight: 100, scrollHeight: 101 }
    h.panel.handleCommentsScroll()
    await flush()
    assert.deepEqual(h.panel.comments.value.map(c => c.commentId), ['page-0', 'page-1'])
    assert.equal(h.panel.total.value, 51774)
    assert.equal(h.panel.hasMore.value, false)
    assert.ok(calls.some(c => c.page === 1 && c.id === '1'))
  } finally { h.stop() }
})

test('QQ panel starts the new target while old requests are pending and ignores late results', async () => {
  const pending = []
  const h = mountPanel(args => new Promise(resolve => pending.push({ args, resolve })))
  try {
    h.store.songList.value = [{ source: 'qq', numericId: '2' }]
    await flush()
    const newer = pending.filter(p => p.args.id === '2')
    assert.ok(newer.length > 0, 'new target must not be blocked by loading')
    newer.forEach(p => p.resolve(payload('new', 42, 0)))
    await flush()
    pending.filter(p => p.args.id === '1').forEach(p => p.resolve(payload('old', 999, 0)))
    await flush()
    assert.equal(h.panel.comments.value[0].commentId, 'new')
    assert.equal(h.panel.total.value, 42)
    assert.ok(h.events.every(([, event]) => event.targetKey === 'qq:2'))
  } finally { h.stop() }
})

test('QQ panel ignores responses after unmount', async () => {
  const pending = []
  const h = mountPanel(() => new Promise(resolve => pending.push(resolve)))
  h.stop()
  pending.forEach(resolve => resolve(payload('late')))
  await flush()
  assert.equal(h.events.length, 0)
  assert.deepEqual(h.panel.comments.value, [])
})

test('QQ hot success cannot publish a zero count when latest failed', async () => {
  let calls = 0
  const h = mountPanel(async () => ++calls === 1 ? { code: 1000 } : payload('hot'))
  try {
    await flush()
    assert.equal(h.events.length, 0)
    assert.equal(h.panel.hotComments.value.length, 1)
    assert.ok(h.notices.length > 0)
    assert.equal(h.panel.loadError.value, '评论加载失败，请重试')
  } finally { h.stop() }
})

test('QQ entry shows unavailable rather than zero after an uncached request failure', async () => {
  const h = mountPlayer(async () => { throw new Error('upstream 502') }, '662385897')
  try {
    await flush()
    assert.equal(h.player.commentCountBadge.value, '—')
    assert.equal(readCommentCountCache('qq:662385897'), null)
  } finally { h.stop() }
})

test('QQ panel reports business errors without emitting a successful zero count', async () => {
  const h = mountPanel(async () => ({ code: 1000 }))
  try {
    await flush()
    assert.equal(h.events.length, 0)
    assert.ok(h.notices.length > 0)
  } finally { h.stop() }
})
