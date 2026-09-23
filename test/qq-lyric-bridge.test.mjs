import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bridgeNamesMatch,
  normalizeBridgeSongName,
  parseBridgeTimedLines,
  buildAlignedLyricTrack,
  pickNeteaseLyricCandidate,
  bridgeQQNeteaseLyricTracks,
  clearQQNeteaseLyricBridgeCache,
} from '../src/utils/player/qqLyricBridge.mjs'

const QQ_LRC = [
  '[ti:紅蓮華]',
  '[00:01.21]強くなれる理由を知った',
  '[00:07.63]僕を連れて 進め',
  '[00:18.97]泥だらけの走馬灯に酔う',
  '[00:24.52]こわばる心 震える手は',
  '[00:28.50]掴みたいものがある',
].join('\n')

test('QQ 桥接按归一化后的歌名匹配候选', () => {
  // QQ 歌名常带剧情后缀，网易云只写主标题
  assert.equal(normalizeBridgeSongName('紅蓮華 (《鬼灭之刃》TV动画片头曲)'), '紅蓮華')
  assert.equal(bridgeNamesMatch('紅蓮華 (《鬼灭之刃》TV动画片头曲)', '紅蓮華'), true)
  assert.equal(bridgeNamesMatch('Lemon', 'Lemon (柠檬)'), true)
  assert.equal(bridgeNamesMatch('lemon', 'LEMON'), true)
  assert.equal(bridgeNamesMatch('Lemon', 'Lemonade'), false)
  assert.equal(bridgeNamesMatch('', '紅蓮華'), false)
})

test('QQ 桥接把译文按最近时间戳贴回原文时间轴', () => {
  // 网易云的译文时间戳与 QQ 原文有几毫秒到几百毫秒的偏移，必须用原文时间戳重建，
  // 否则渲染层（0.12s 精确匹配）根本贴不上翻译。
  const neteaseTrans = [
    '[00:01.30]明白了变强的理由',
    '[00:07.70]带着我 前进吧',
    '[00:19.05]沉醉于满是泥泞的走马灯',
    '[00:24.60]僵硬的心 颤抖的手',
    '[00:28.58]有着想要抓住的东西',
  ].join('\n')

  const aligned = buildAlignedLyricTrack(QQ_LRC, neteaseTrans)
  assert.equal(aligned.matched, 5)
  assert.equal(aligned.total, 5)
  assert.equal(aligned.coverage, 1)

  const rows = parseBridgeTimedLines(aligned.lyric)
  const baseTimes = parseBridgeTimedLines(QQ_LRC).map(row => row.time)
  assert.deepEqual(rows.map(row => row.time), baseTimes)
  assert.equal(rows[0].text, '明白了变强的理由')
})

test('QQ 桥接在时间轴对不上时放弃（宁缺毋滥）', () => {
  // 另一个版本/剪辑版：只有 1 行能对上，覆盖率不足
  const mismatch = [
    '[00:01.30]明白了变强的理由',
    '[00:52.00]完全不同的另一段',
    '[01:20.00]完全不同的另一段二',
  ].join('\n')
  const rejected = buildAlignedLyricTrack(QQ_LRC, mismatch)
  assert.equal(rejected.lyric, '')
  assert.equal(rejected.matched, 1)

  // 完全没有时间标签（纯文本歌词）同样放弃
  assert.equal(buildAlignedLyricTrack(QQ_LRC, '没有时间轴的纯文本'), null)
})

test('QQ 桥接候选排序优先同歌手与相近时长', () => {
  const songs = [
    { id: '1', name: '紅蓮華', ar: [{ name: '別人' }], dt: 260000 },
    { id: '2', name: '紅蓮華 (TV Version)', ar: [{ name: 'LiSA (織部里沙)' }], dt: 90000 },
    { id: '3', name: '紅蓮華', ar: [{ name: 'LiSA' }], dt: 259000 },
    { id: '4', name: '残酷な天使のテーゼ', ar: [{ name: 'LiSA' }], dt: 240000 },
  ]

  const picked = pickNeteaseLyricCandidate(songs, { name: '紅蓮華', artist: 'LiSA', durationSec: 259 })
  assert.equal(picked.id, '3')

  // 歌名完全不一致的候选不会入选
  assert.equal(pickNeteaseLyricCandidate([songs[3]], { name: '紅蓮華', artist: 'LiSA' }), null)
})

test('QQ 桥接主流程合并译文轨道并缓存结果', async () => {
  clearQQNeteaseLyricBridgeCache()
  const searched = []
  const payload = { lrc: { lyric: QQ_LRC }, hmLyricSource: 'qq' }
  const song = { source: 'qq', sourceId: '003nEAIf3Rmatn', name: '紅蓮華', ar: [{ name: 'LiSA' }] }

  const bridge = () => bridgeQQNeteaseLyricTracks({
    song,
    payload,
    searchCandidates: async params => {
      searched.push(params)
      return [{ id: '9', name: '紅蓮華', ar: [{ name: 'LiSA' }], dt: 259000 }]
    },
    fetchCandidateLyric: async () => ({
      lrc: { lyric: '[00:01.30]強くなれる理由を知った' },
      tlyric: { lyric: '[00:01.30]明白了变强的理由' },
      romalrc: { lyric: '[00:01.30]tsuyoku nareru riyuu wo shitta' },
    }),
  })

  const merged = await bridge()
  assert.equal(searched.length, 1)
  assert.equal(searched[0].name, '紅蓮華')
  assert.equal(searched[0].artist, 'LiSA')
  // 只有 1 行能对上（覆盖率不足），所以不采用
  assert.equal(merged, null)

  // 命中行足够时才会合并，并且译文时间戳被改写成 QQ 原文的时间戳
  const mergedFull = await bridgeQQNeteaseLyricTracks({
    song: { ...song, sourceId: 'another-mid' },
    payload,
    searchCandidates: async () => [{ id: '9', name: '紅蓮華', artist: 'LiSA', ar: [{ name: 'LiSA' }], dt: 259000 }],
    fetchCandidateLyric: async () => ({
      tlyric: { lyric: [
        '[00:01.30]明白了变强的理由',
        '[00:07.70]带着我 前进吧',
        '[00:19.05]沉醉于满是泥泞的走马灯',
        '[00:24.60]僵硬的心 颤抖的手',
        '[00:28.58]有着想要抓住的东西',
      ].join('\n') },
    }),
  })

  assert.equal(mergedFull.lrc.lyric, QQ_LRC)
  assert.equal(mergedFull.hmLyricSource, 'qq')
  const baseTimes = parseBridgeTimedLines(QQ_LRC).map(row => row.time)
  assert.deepEqual(parseBridgeTimedLines(mergedFull.tlyric.lyric).map(row => row.time), baseTimes)

  // 结果进缓存：再次调用不再触发搜索
  let secondSearch = 0
  const cached = await bridgeQQNeteaseLyricTracks({
    song,
    payload,
    searchCandidates: async () => {
      secondSearch += 1
      return []
    },
    fetchCandidateLyric: async () => null,
  })
  assert.equal(secondSearch, 0)
  assert.equal(cached, null)
})

test('QQ 桥接缓存只复用借来的轨道，不带上旧歌词对象', async () => {
  clearQQNeteaseLyricBridgeCache()
  const baseLrc = [
    '[00:01.21]強くなれる理由を知った',
    '[00:07.63]僕を連れて 進め',
    '[00:18.97]泥だらけの走馬灯に酔う',
    '[00:24.52]こわばる心 震える手は',
  ].join('\n')
  const transLrc = [
    '[00:01.30]明白了变强的理由',
    '[00:07.70]带着我 前进吧',
    '[00:19.05]沉醉于满是泥泞的走马灯',
    '[00:24.60]僵硬的心 颤抖的手',
  ].join('\n')
  const song = { source: 'qq', sourceId: 'cache-mid', name: '紅蓮華', ar: [{ name: 'LiSA' }] }

  let searches = 0
  const loader = {
    searchCandidates: async () => {
      searches += 1
      return [{ id: '9', name: '紅蓮華', ar: [{ name: 'LiSA' }], dt: 259000 }]
    },
    fetchCandidateLyric: async () => ({ tlyric: { lyric: transLrc } }),
  }

  const first = await bridgeQQNeteaseLyricTracks({ song, payload: { lrc: { lyric: baseLrc }, hmLyricSource: 'qq' }, ...loader })
  assert.ok(first.tlyric.lyric.includes('明白了变强的理由'))

  // 第二次换成另一个歌词对象（例如重新解析后的 payload），缓存只补轨道、不复用旧对象
  const other = { lrc: { lyric: baseLrc }, hmLyricSource: 'qq', marker: 'fresh' }
  const second = await bridgeQQNeteaseLyricTracks({ song, payload: other, ...loader })
  assert.equal(searches, 1)
  assert.equal(second.marker, 'fresh')
  assert.equal(second.lrc.lyric, other.lrc.lyric)
  assert.ok(second.tlyric.lyric.includes('明白了变强的理由'))
})

test('QQ 桥接在缺数据与上游异常时安静退化', async () => {
  clearQQNeteaseLyricBridgeCache()
  const payload = { lrc: { lyric: QQ_LRC } }
  const song = { source: 'qq', sourceId: 'mid-x', name: '紅蓮華', ar: [{ name: 'LiSA' }] }

  // 已经有翻译轨道就不再重复桥接
  assert.equal(await bridgeQQNeteaseLyricTracks({
    song,
    payload: { ...payload, tlyric: { lyric: '[00:01.21]明白了变强的理由' } },
    searchCandidates: async () => { throw new Error('should not search') },
    fetchCandidateLyric: async () => null,
  }), null)

  // 搜索失败不影响播放，只是没有翻译
  assert.equal(await bridgeQQNeteaseLyricTracks({
    song,
    payload,
    searchCandidates: async () => { throw new Error('network down') },
    fetchCandidateLyric: async () => null,
  }), null)

  // 候选歌词里没有译文时直接返回 null
  assert.equal(await bridgeQQNeteaseLyricTracks({
    song: { ...song, sourceId: 'mid-y' },
    payload,
    searchCandidates: async () => [{ id: '1', name: '紅蓮華', ar: [{ name: 'LiSA' }] }],
    fetchCandidateLyric: async () => ({ lrc: { lyric: '[00:01.30]強くなれる理由を知った' } }),
  }), null)

  await assert.rejects(
    () => bridgeQQNeteaseLyricTracks({ song: { ...song, sourceId: 'mid-z' }, payload }),
    /loaders are required/,
  )
})