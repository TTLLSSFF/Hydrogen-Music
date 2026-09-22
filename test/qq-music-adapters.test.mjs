import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractQQPlaylists,
  getQQAlbumInfo,
  getQQMusicPlay,
  getQQMv,
  getQQMvPlay,
  getQQSongListDetail,
  normalizeQQAlbumDetail,
  normalizeQQLyricPayload,
  normalizeQQLikedPlaylist,
  normalizeQQPlaylist,
  normalizeQQPlaylistDetail,
  normalizeQQSearchAlbums,
  normalizeQQSearchArtists,
  normalizeQQSearchMvs,
  normalizeQQSearchPayload,
  normalizeQQSearchPlaylists,
  normalizeQQSearchSongs,
  normalizeQQSingerDetail,
  normalizeQQSingerSongs,
  normalizeQQSingerAlbums,
  normalizeQQSong,
  normalizeQQTopListDetail,
  QQ_PUBLIC_API_DISABLED_CODE,
  searchQQAll,
  searchQQCategory,
  unwrapQQResponse,
} from '../src/api/qqMusic.js'
import { normalizeQQPlaybackPayload } from '../src/api/qqMusic.js'

test('QQ adapters unwrap the server response envelope', () => {
  assert.deepEqual(unwrapQQResponse({ response: { code: 0, data: { playlists: [{ dissid: '1' }] } } }), {
    code: 0,
    data: { playlists: [{ dissid: '1' }] },
  })
  assert.deepEqual(normalizeQQSearchPayload({ response: { code: 0, data: { song: { list: [{ songmid: 'mid-3' }] } } } }).searchSongs.map(song => song.sourceId), ['mid-3'])
})

test('QQ playlist detail uses the upstream disstid parameter', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  globalThis.fetch = async url => {
    requestUrl = String(url)
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ code: 0, data: {} }) }
  }
  try {
    await getQQSongListDetail('123456')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.match(requestUrl, /disstid=123456/)
  assert.doesNotMatch(requestUrl, /[?&]id=/)
})

test('QQ MV detail adapters fail closed without issuing requests', async () => {
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = async url => {
    requestCount += 1
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ response: { code: 0, data: { song: { list: [] } } } }) }
  }
  try {
    for (const call of [
      () => getQQMv('mv-id'),
      () => getQQMvPlay('mv-id'),
    ]) {
      await assert.rejects(call, error => error?.code === QQ_PUBLIC_API_DISABLED_CODE)
    }
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(requestCount, 0)
})

test('QQ search adapter reads the documented result lists', () => {
  const result = normalizeQQSearchPayload({
    code: 0,
    data: {
      result: {
        songList: [{ songmid: 'mid-1', songname: 'Song', singer: [{ mid: 's1', name: 'Singer' }] }],
        singerList: [{ singer_mid: 's1', singer_name: 'Singer' }],
        albumList: [{ album_mid: 'a1', album_name: 'Album' }],
      },
    },
  })

  assert.equal(result.searchSongs[0].source, 'qq')
  assert.equal(result.searchSongs[0].sourceId, 'mid-1')
  assert.equal(result.searchArtists[0].name, 'Singer')
  assert.equal(result.searchAlbums[0].id, 'a1')
})

test('QQ search adapter reads singer and album data from the live zhida shape', () => {
  const result = normalizeQQSearchPayload({
    response: {
      code: 0,
      data: {
        song: { list: [] },
        zhida: {
          zhida_singer: {
            singerID: 4558,
            singerMID: '0025NhlN2yWrP4',
            singerName: '周杰伦',
            singerPic: 'https://example.test/singer.jpg',
            hotalbum: [{ albumID: 8220, albumMID: '000MkMni19ClKG', albumName: '叶惠美' }],
          },
        },
      },
    },
  })

  assert.equal(result.searchArtists[0].name, '周杰伦')
  assert.equal(result.searchArtists[0].id, '0025NhlN2yWrP4')
  assert.equal(result.searchAlbums[0].name, '叶惠美')
  assert.equal(result.searchAlbums[0].id, '000MkMni19ClKG')
})

test('QQ search request maps categories to the upstream t parameter', async () => {
  const originalFetch = globalThis.fetch
  const requestUrls = []
  globalThis.fetch = async url => {
    requestUrls.push(String(url))
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ code: 0, data: {} }) }
  }
  try {
    await searchQQCategory('周杰伦', 'songs', { limit: 20 })
    await searchQQCategory('周杰伦', 'albums')
    await searchQQCategory('周杰伦', 'artists')
    await searchQQCategory('周杰伦', 'mvs')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(requestUrls.length, 4)
  assert.match(requestUrls[0], /[?&]t=0(&|$)/)
  assert.match(requestUrls[0], /n=20/)
  assert.match(requestUrls[0], /key=%E5%91%A8%E6%9D%B0%E4%BC%A6/)
  assert.match(requestUrls[1], /[?&]t=8(&|$)/)
  assert.match(requestUrls[2], /[?&]t=9(&|$)/)
  assert.match(requestUrls[3], /[?&]t=12(&|$)/)
  assert.throws(() => searchQQCategory('周杰伦', 'playlists'), /unsupported QQ search category/)
})

test('QQ live album category response normalizes to the shared album contract', () => {
  const albums = normalizeQQSearchAlbums({
    code: 0,
    data: {
      album: {
        list: [{
          albumID: '8220',
          albumMID: '000MkMni19ClKG',
          albumName: '叶惠美',
          albumPic: 'https://example.test/album.jpg',
          singerMID: '0025NhlN2yWrP4',
          singerName: '周杰伦',
          publicTime: '1059580800',
          song_count: '12',
        }],
      },
    },
  })
  assert.equal(albums.length, 1)
  assert.equal(albums[0].id, '000MkMni19ClKG')
  assert.equal(albums[0].name, '叶惠美')
  assert.equal(albums[0].source, 'qq')
  assert.equal(albums[0].picUrl, 'https://example.test/album.jpg')
  assert.equal(albums[0].size, 12)
  assert.equal(albums[0].artists[0].name, '周杰伦')
})

test('QQ live singer category response normalizes to the shared artist contract', () => {
  const artists = normalizeQQSearchArtists({
    code: 0,
    data: {
      singer: {
        list: [{
          singerID: '4558',
          singerMID: '0025NhlN2yWrP4',
          singerName: '周杰伦',
          singerPic: 'https://example.test/singer.jpg',
        }],
      },
    },
  })
  assert.equal(artists.length, 1)
  assert.equal(artists[0].id, '0025NhlN2yWrP4')
  assert.equal(artists[0].name, '周杰伦')
  assert.equal(artists[0].source, 'qq')
  assert.equal(artists[0].coverImgUrl, 'https://example.test/singer.jpg')
})

test('QQ live mv category response normalizes to the shared mv contract', () => {
  const mvs = normalizeQQSearchMvs({
    code: 0,
    data: {
      mv: {
        list: [{
          v_id: 'x00135ao69x',
          mv_id: '123',
          mv_name: '搁浅',
          mv_pic_url: 'https://example.test/mv.jpg',
          duration: '240',
          play_count: '3800000',
          singer_name: '周杰伦',
        }],
      },
    },
  })
  assert.equal(mvs.length, 1)
  assert.equal(mvs[0].id, 'x00135ao69x')
  assert.equal(mvs[0].name, '搁浅')
  assert.equal(mvs[0].source, 'qq')
  assert.equal(mvs[0].coverImgUrl, 'https://example.test/mv.jpg')
  assert.equal(mvs[0].duration, 240000)
  assert.equal(mvs[0].artists[0].name, '周杰伦')
})

test('QQ live song category response normalizes through the song adapter', () => {
  const songs = normalizeQQSearchSongs({
    code: 0,
    data: {
      song: {
        list: [{
          songmid: '001Bbywq2gicae',
          songname: '搁浅',
          interval: '240',
          albummid: '003DFRzD192KKD',
          albumname: '七里香',
          singer: [{ mid: '0025NhlN2yWrP4', name: '周杰伦' }],
        }],
      },
    },
  })
  assert.equal(songs.length, 1)
  assert.equal(songs[0].id, '001Bbywq2gicae')
  assert.equal(songs[0].name, '搁浅')
  assert.equal(songs[0].source, 'qq')
  assert.equal(songs[0].dt, 240000)
})

test('QQ aggregate search carries playlists and isolates failed categories', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async url => {
    const query = String(url)
    if (query.includes('t=12')) return { ok: false, status: 502, headers: { get: () => 'application/json' }, json: async () => ({}) }
    if (query.includes('t=9')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ code: 0, data: { singer: { list: [{ singerMID: 's1', singerName: 'Singer' }] } } }) }
    // 歌单分类走独立的 musicu 端点，信封与 client_search_cp 不同
    if (query.includes('/getSearchPlaylists')) {
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          code: 0,
          req_1: {
            code: 0,
            data: {
              meta: { sum: 300 },
              body: {
                songlist: {
                  list: [{ dissid: '7039749142', dissname: '百听不厌的周杰伦', imgurl: 'https://example.test/cover.jpg', song_count: 99 }],
                },
              },
            },
          },
        }),
      }
    }
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ code: 0, data: { song: { list: [{ songmid: 'm1', songname: 'Song' }] } } }) }
  }
  let result
  try {
    result = await searchQQAll('Song')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(result.searchSongs.length, 1)
  assert.equal(result.searchArtists[0].name, 'Singer')
  assert.equal(result.searchPlaylists.length, 1)
  assert.equal(result.searchPlaylists[0].id, '7039749142')
  assert.equal(result.searchPlaylists[0].name, '百听不厌的周杰伦')
  assert.equal(result.searchPlaylists[0].coverImgUrl, 'https://example.test/cover.jpg')
  assert.equal(result.searchPlaylists[0].trackCount, 99)
  assert.equal(result.searchPlaylists[0].source, 'qq')
  assert.deepEqual(result.searchMvs, [])
})

// musicu 歌单搜索的条目字段（dissid/dissname/imgurl/song_count）与
// client_search_cp 不同，这里锁定归一化结果，避免搜索页歌单区块变空。
test('QQ playlist search normalizes the musicu songlist envelope', () => {
  const playlists = normalizeQQSearchPlaylists({
    code: 0,
    req_1: {
      code: 0,
      data: {
        meta: { sum: 2 },
        body: {
          songlist: {
            list: [
              {
                dissid: '7039749142',
                dissname: '百听不厌的周杰伦',
                imgurl: 'http://qpic.y.qq.com/music_cover/cover/300?n=1',
                song_count: 99,
                listennum: 412634467,
                creator: { name: '今晚月色很美', qq: 2904004371 },
              },
              { dissname: '缺少 id 的条目' },
            ],
          },
        },
      },
    },
  })

  assert.equal(playlists.length, 1)
  assert.equal(playlists[0].id, '7039749142')
  assert.equal(playlists[0].name, '百听不厌的周杰伦')
  assert.equal(playlists[0].picUrl, 'http://qpic.y.qq.com/music_cover/cover/300?n=1')
  assert.equal(playlists[0].trackCount, 99)
  assert.equal(playlists[0].source, 'qq')
  assert.deepEqual(normalizeQQSearchPlaylists({ code: 0 }), [])
})

// 榜单详情走旧版 fcg_v8_toplist_cp 模板：歌曲字段藏在 songlist[].data 内层，
// 且只有这一层带 songmid（musicToplist.GetDetail 只有数字 songId，无法播放）。
test('QQ toplist detail normalizes the legacy songlist envelope', () => {
  const detail = normalizeQQTopListDetail({
    response: {
      code: 0,
      topinfo: {
        topID: '4',
        ListName: '巅峰榜·流行指数',
        pic_v12: 'http://y.gtimg.cn/music/photo_new/T003R300x300M0000048E6jv0avzOV.jpg',
        info: '1.榜单定义：站内播放相对涨幅排名前100首歌曲。',
      },
      total_song_num: 100,
      update_time: '2026-09-21',
      songlist: [
        {
          Franking_value: '402946',
          data: {
            songmid: '0027rBks3lqPA3',
            songid: 4936030,
            songname: '茶汤',
            albummid: '002iWKlh2DcjFL',
            albumname: '微加幸福',
            interval: 308,
            singer: [{ id: 19624, mid: '000NUoMp2WAEpO', name: '郁可唯' }],
          },
        },
      ],
    },
  })

  assert.equal(detail.playlist.id, '4')
  assert.equal(detail.playlist.name, '巅峰榜·流行指数')
  assert.equal(detail.playlist.coverImgUrl, 'http://y.gtimg.cn/music/photo_new/T003R300x300M0000048E6jv0avzOV.jpg')
  assert.equal(detail.playlist.trackCount, 100)
  assert.equal(detail.playlist.source, 'qq')
  assert.equal(detail.songs.length, 1)
  // 播放依赖 sourceId（songmid），不能退化成数字 songId
  assert.equal(detail.songs[0].sourceId, '0027rBks3lqPA3')
  assert.equal(detail.songs[0].name, '茶汤')
  assert.equal(detail.songs[0].dt, 308000)
  assert.equal(detail.songs[0].ar[0].name, '郁可唯')
})

test('QQ toplist detail still tolerates the musicu GetDetail envelope', () => {
  const detail = normalizeQQTopListDetail({
    response: {
      code: 0,
      req_1: {
        code: 2000,
        data: {
          data: {
            topId: 26,
            title: '巅峰榜·热歌',
            totalNum: 2,
            headPicUrl: 'https://example.test/top.jpg',
            song: [{ songId: 1, title: '歌曲一', singerName: '歌手' }],
          },
        },
      },
    },
  }, '26')

  assert.equal(detail.playlist.id, '26')
  assert.equal(detail.playlist.name, '巅峰榜·热歌')
  assert.equal(detail.playlist.coverImgUrl, 'https://example.test/top.jpg')
  assert.equal(detail.playlist.trackCount, 2)
  assert.equal(detail.songs.length, 1)
})

test('QQ album detail request carries the albummid query and requires it', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  globalThis.fetch = async url => {
    requestUrl = String(url)
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ response: { code: '0', data: {} } }) }
  }
  try {
    await getQQAlbumInfo('003DFRzD192KKD')
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.match(requestUrl, /albummid=003DFRzD192KKD/)
  assert.throws(() => getQQAlbumInfo(''), /album mid is required/)
})

test('QQ album detail normalizes the live response into the shared album contract', () => {
  const detail = normalizeQQAlbumDetail({
    response: {
      code: '0',
      data: {
        mid: '003DFRzD192KKD',
        name: '七里香',
        singername: '周杰伦',
        singermid: '0025NhlN2yWrP4',
        aDate: '2004-08-03',
        company: '杰威尔音乐有限公司',
        desc: '2004年夏天周杰伦带来浓郁《七里香》！',
        genre: 'Pop 流行',
        lan: '国语',
        cur_song_num: '10',
        list: [{
          songmid: '001Bbywq2gicae',
          songname: '搁浅',
          interval: '240',
          albummid: '003DFRzD192KKD',
          albumname: '七里香',
          singer: [{ mid: '0025NhlN2yWrP4', name: '周杰伦' }],
        }],
      },
    },
  }, '003DFRzD192KKD')

  assert.equal(detail.album.id, '003DFRzD192KKD')
  assert.equal(detail.album.mid, '003DFRzD192KKD')
  assert.equal(detail.album.source, 'qq')
  assert.equal(detail.album.name, '七里香')
  assert.equal(detail.album.coverImgUrl, 'https://y.gtimg.cn/music/photo_new/T002R500x500M000003DFRzD192KKD.jpg')
  assert.equal(detail.album.artists[0].name, '周杰伦')
  assert.equal(detail.album.publishTime, '2004-08-03')
  assert.equal(detail.album.trackCount, 10)
  assert.deepEqual(detail.album.description, '2004年夏天周杰伦带来浓郁《七里香》！')
  assert.equal(detail.songs.length, 1)
  assert.equal(detail.songs[0].id, '001Bbywq2gicae')
  assert.equal(detail.songs[0].source, 'qq')
  assert.equal(detail.songs[0].dt, 240000)
})

test('QQ singer detail parses the zhida hotsong f field and aggregates mvs', () => {
  const detail = normalizeQQSingerDetail({
    desc: '周杰伦（Jay Chou）简介',
    starNum: 50731674,
    hotSongs: [
      { songID: '97773', songMID: '0039MnYb0qxYhV', songName: '晴天', f: '97773|晴天|4558|周杰伦|8220|叶惠美|0|269|-1|1|0|10792943|4317292|0|0|0|55397039|5860576|6519764|0|0039MnYb0qxYhV|0025NhlN2yWrP4|000MkMni19ClKG|0|4009' },
    ],
    mvs: [
      { vid: 'o001320lolt', id: '247083', title: '东风破+兰亭序', pic: 'http://y.gtimg.cn/pic.jpg', listenCount: '64721', singer_name: '周杰伦' },
    ],
  }, { mid: '0025NhlN2yWrP4', name: '周杰伦' })

  assert.equal(detail.singer.source, 'qq')
  assert.equal(detail.singer.name, '周杰伦')
  assert.equal(detail.singer.description, '周杰伦（Jay Chou）简介')
  assert.equal(detail.singer.starNum, 50731674)
  assert.equal(detail.singer.musicSize, 1)
  assert.equal(detail.singer.mvSize, 1)
  assert.equal(detail.singer.albumSize, 0)
  assert.equal(detail.hotSongs.length, 1)
  assert.equal(detail.hotSongs[0].id, '0039MnYb0qxYhV')
  assert.equal(detail.hotSongs[0].name, '晴天')
  assert.equal(detail.hotSongs[0].source, 'qq')
  assert.equal(detail.hotSongs[0].ar[0].name, '周杰伦')
  assert.equal(detail.hotSongs[0].dt, 269000)
  assert.equal(detail.mvs[0].id, 'o001320lolt')
  assert.equal(detail.mvs[0].name, '东风破+兰亭序')
  assert.equal(detail.mvs[0].playCount, 64721)
})

test('QQ singer hot songs fall back to explicit song fields without the f column', () => {
  const detail = normalizeQQSingerDetail({
    hotSongs: [{ songMID: 'mid-fallback', songName: '备选歌', singer: [{ name: '歌手A' }] }],
    mvs: [],
  }, { mid: 's-mid', name: '歌手A' })
  assert.equal(detail.hotSongs[0].id, 'mid-fallback')
  assert.equal(detail.hotSongs[0].name, '备选歌')
  assert.equal(detail.hotSongs[0].ar[0].name, '歌手A')
})

test('QQ singer detail consumes the musicu songlist and reports upstream totals', () => {
  const detail = normalizeQQSingerDetail({
    desc: '歌手简介',
    starNum: 50760177,
    hotSongs: [{
      id: 97773,
      mid: '0039MnYb0qxYhV',
      name: '晴天',
      singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
      album: { id: 8220, mid: '000MkMni19ClKG', name: '叶惠美' },
      interval: 269,
    }],
    totalSong: 1012,
    totalAlbum: 43,
    totalMv: 808,
    mvs: [],
  }, { mid: '0025NhlN2yWrP4', name: '周杰伦' })

  assert.equal(detail.hotSongs.length, 1)
  assert.equal(detail.hotSongs[0].id, 97773)
  assert.equal(detail.hotSongs[0].sourceId, '0039MnYb0qxYhV')
  assert.equal(detail.hotSongs[0].sourceKey, 'qq:0039MnYb0qxYhV')
  assert.equal(detail.hotSongs[0].name, '晴天')
  assert.equal(detail.hotSongs[0].dt, 269000)
  assert.equal(detail.hotSongs[0].al.mid, '000MkMni19ClKG')
  assert.equal(detail.hotSongs[0].ar[0].id, '0025NhlN2yWrP4')
  assert.equal(detail.hotSongs[0].ar[0].singerid, '4558')
  assert.equal(detail.singer.musicSize, 1012)
  assert.equal(detail.singer.albumSize, 43)
  assert.equal(detail.singer.mvSize, 808)
})

test('QQ singer songs page normalizes the musicu songlist for load-more appends', () => {
  const page = normalizeQQSingerSongs({
    songs: [{
      id: 97773,
      mid: '0039MnYb0qxYhV',
      name: '晴天',
      singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
      album: { id: 8220, mid: '000MkMni19ClKG', name: '叶惠美' },
      interval: 269,
    }],
    totalSong: 1012,
  })

  assert.equal(page.songs.length, 1)
  assert.equal(page.songs[0].sourceKey, 'qq:0039MnYb0qxYhV')
  assert.equal(page.songs[0].name, '晴天')
  assert.equal(page.songs[0].dt, 269000)
  assert.equal(page.totalSong, 1012)
})

test('QQ singer songs page tolerates a missing songlist', () => {
  const page = normalizeQQSingerSongs({})
  assert.deepEqual(page.songs, [])
  assert.equal(page.totalSong, 0)
})

test('QQ singer albums page normalizes the musicu albumList for load-more appends', () => {
  const page = normalizeQQSingerAlbums({
    albums: [{
      albumMid: '000MkMni19ClKG',
      albumName: '叶惠美',
      albumTranName: 'Ye Hui Mei',
      singerName: '周杰伦',
      publishDate: '2003-07-31',
      albumType: '录音室专辑',
      // 上游 totalNum（曲目数）恒为 0
      totalNum: 0,
    }],
    totalAlbum: 43,
  })

  assert.equal(page.albums.length, 1)
  assert.equal(page.albums[0].id, '000MkMni19ClKG')
  assert.equal(page.albums[0].mid, '000MkMni19ClKG')
  assert.equal(page.albums[0].source, 'qq')
  assert.equal(page.albums[0].name, '叶惠美')
  assert.equal(page.albums[0].artists[0].name, '周杰伦')
  assert.equal(page.albums[0].publishTime, '2003-07-31')
  assert.equal(page.albums[0].type, '录音室专辑')
  // size 恒 0 时列表页隐藏曲目数，而不是显示「0首」
  assert.equal(page.albums[0].size, 0)
  assert.equal(page.albums[0].trackCount, 0)
  assert.equal(
    page.albums[0].blurPicUrl,
    'https://y.gtimg.cn/music/photo_new/T002R500x500M000000MkMni19ClKG.jpg',
  )
  assert.equal(page.totalAlbum, 43)
})

test('QQ singer albums page tolerates a missing albumList', () => {
  const page = normalizeQQSingerAlbums({})
  assert.deepEqual(page.albums, [])
  assert.equal(page.totalAlbum, 0)
})

test('QQ song normalization keeps a stable provider-specific identity', () => {
  const song = normalizeQQSong({
    songmid: 'mid-2',
    songname: 'Song 2',
    interval: 187,
    album: { mid: 'album-mid', id: 42, name: 'Album 2' },
  })
  assert.deepEqual({ id: song.id, source: song.source, sourceId: song.sourceId, sourceKey: song.sourceKey }, {
    id: 'mid-2',
    source: 'qq',
    sourceId: 'mid-2',
    sourceKey: 'qq:mid-2',
  })
  assert.equal(song.dt, 187000)
  assert.equal(song.al.mid, 'album-mid')
  assert.match(song.al.picUrl, /album-mid/)
})

test('QQ song normalization maps upstream snake/camel aliases into playable metadata', () => {
  const song = normalizeQQSong({
    song_id: 90210,
    song_mid: '002-song-mid',
    songName: 'Alias song',
    singer: [{ singer_id: 4558, singer_mid: 'singer-mid', singerName: 'Alias singer' }],
    album: { album_mid: 'album-mid', albumName: 'Alias album', picurl: 'https://example.test/album.jpg' },
    songtime: 241,
  })

  assert.deepEqual({
    id: song.id,
    sourceId: song.sourceId,
    name: song.name,
    artistId: song.ar[0]?.id,
    artistName: song.ar[0]?.name,
    artistMid: song.ar[0]?.mid,
    artistSingerId: song.ar[0]?.singerid,
    albumName: song.al.name,
    cover: song.al.picUrl,
    duration: song.dt,
  }, {
    id: 90210,
    sourceId: '002-song-mid',
    name: 'Alias song',
    artistId: 'singer-mid',
    artistName: 'Alias singer',
    artistMid: 'singer-mid',
    artistSingerId: '4558',
    albumName: 'Alias album',
    cover: 'https://example.test/album.jpg',
    duration: 241000,
  })
})

test('QQ song artist id prefers mid and stores numeric singerid separately', () => {
  const song = normalizeQQSong({
    songmid: 'mid-jay',
    songname: '晴天',
    singer: [{ id: 4558, mid: '0025NhlN2yWrP4', name: '周杰伦' }],
  })
  assert.equal(song.ar[0].id, '0025NhlN2yWrP4')
  assert.equal(song.ar[0].mid, '0025NhlN2yWrP4')
  assert.equal(song.ar[0].singerid, '4558')
})

test('QQ song normalization keeps scalar singer, song-level cover, and clock duration fields', () => {
  const song = normalizeQQSong({
    songmid: 'scalar-mid',
    songname: 'Scalar song',
    singer: 'Scalar singer',
    albumname: 'Scalar album',
    albummid: 'scalar-album-mid',
    albumid: 17,
    picurl: 'https://example.test/song-cover.jpg',
    songtime: '03:45',
  })

  assert.deepEqual(song.ar, [{ name: 'Scalar singer' }])
  assert.equal(song.al.name, 'Scalar album')
  assert.equal(song.al.mid, 'scalar-album-mid')
  assert.equal(song.albumId, 17)
  assert.equal(song.al.picUrl, 'https://example.test/song-cover.jpg')
  assert.equal(song.coverUrl, 'https://example.test/song-cover.jpg')
  assert.equal(song.dt, 225000)
})

test('QQ song normalization maps pay metadata to vipOnly and mediaId', () => {
  const song = normalizeQQSong({
    songmid: 'vip-mid',
    songname: 'VIP song',
    pay: { pay_play: 1, pay_down: 1 },
    file: { media_mid: 'media-mid' },
  })
  assert.equal(song.vipOnly, true)
  assert.equal(song.mediaId, 'media-mid')
})

test('QQ song normalization does not mark free tracks as vipOnly', () => {
  const song = normalizeQQSong({
    songmid: 'free-mid',
    songname: 'Free song',
    pay: { pay_play: 0, pay_down: 0 },
  })
  assert.equal(song.vipOnly, false)
})

test('QQ lyric adapter exposes the shared lrc/tlyric shape', () => {
  const lyric = normalizeQQLyricPayload({
    response: { lyric: '[00:01.00]hello', trans: '[00:01.00]你好' },
  })
  assert.equal(lyric.lrc.lyric, '[00:01.00]hello')
  assert.equal(lyric.tlyric.lyric, '[00:01.00]你好')
  assert.equal(lyric.hmLyricSource, 'qq')
})

test('QQ lyric adapter decodes the upstream base64 lyric field', () => {
  const encoded = Buffer.from('[00:01.00]hello', 'utf8').toString('base64')
  const lyric = normalizeQQLyricPayload({ response: { lyric: encoded } })
  assert.equal(lyric.lrc.lyric, '[00:01.00]hello')
})

test('QQ lyric adapter maps package translation aliases from nested payloads', () => {
  const encodedTranslation = Buffer.from('[00:01.00]你好', 'utf8').toString('base64')
  const lyric = normalizeQQLyricPayload({
    response: {
      data: {
        lyric: '[00:01.00]hello',
        transLyric: { lyric: encodedTranslation },
        romaLyric: '[00:01.00]ni hao',
      },
    },
  })

  assert.equal(lyric.lrc.lyric, '[00:01.00]hello')
  assert.equal(lyric.tlyric.lyric, '[00:01.00]你好')
  assert.equal(lyric.translrc.lyric, '[00:01.00]你好')
  assert.equal(lyric.romalrc.lyric, '[00:01.00]ni hao')
  assert.equal(lyric.roma, '[00:01.00]ni hao')
})

test('QQ lyric adapter accepts trans_tlyric and translation text aliases', () => {
  const fromTransTlyric = normalizeQQLyricPayload({
    body: {
      lyric: '[00:00.00]original',
      trans_tlyric: '[00:00.00]translated',
    },
  })
  assert.equal(fromTransTlyric.tlyric.lyric, '[00:00.00]translated')

  const fromTranslation = normalizeQQLyricPayload({
    data: {
      lyric: '[00:00.00]original',
      translation: { text: '[00:00.00]translated' },
    },
  })
  assert.equal(fromTranslation.tlyric.lyric, '[00:00.00]translated')
})

test('QQ lyric adapter handles the package MusicU req_0.data envelope', () => {
  const lyric = normalizeQQLyricPayload({
    req_0: {
      data: {
        lyric: Buffer.from('[00:00.00]original', 'utf8').toString('base64'),
        trans: Buffer.from('[00:00.00]translated', 'utf8').toString('base64'),
        roma: Buffer.from('[00:00.00]original (romanized)', 'utf8').toString('base64'),
      },
    },
  })

  assert.equal(lyric.lrc.lyric, '[00:00.00]original')
  assert.equal(lyric.tlyric.lyric, '[00:00.00]translated')
  assert.equal(lyric.romalrc.lyric, '[00:00.00]original (romanized)')
})

test('QQ playback adapter unwraps nested playUrl maps', () => {
  const playback = normalizeQQPlaybackPayload({
    data: { playUrl: { 'mid-4': { url: 'https://cdn.example/track.mp3' } } },
  }, 'mid-4')
  assert.deepEqual(playback, {
    url: 'https://cdn.example/track.mp3',
    trackInfo: null,
    duration: 0,
  })
})

test('QQ playback request translates the shared lossless quality and keeps mediaId', async () => {
  const originalFetch = globalThis.fetch
  let requestUrl = ''
  globalThis.fetch = async url => {
    requestUrl = String(url)
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { playUrl: { 'song-mid': { url: 'https://example.test/lossless.flac' } } } }),
    }
  }

  try {
    await getQQMusicPlay('song-mid', { quality: 'lossless', mediaId: 'media-mid' })
  } finally {
    globalThis.fetch = originalFetch
  }

  const request = new URL(requestUrl, 'http://localhost')
  assert.equal(request.searchParams.get('quality'), 'flac')
  assert.equal(request.searchParams.get('mediaId'), 'media-mid')
})

test('QQ playback request falls back from unavailable lossless to playable member quality', async () => {
  const originalFetch = globalThis.fetch
  const requestedQualities = []
  globalThis.fetch = async url => {
    const request = new URL(String(url), 'http://localhost')
    const requestQuality = request.searchParams.get('quality')
    requestedQualities.push(requestQuality)
    const urlByQuality = requestQuality === '320' ? 'https://example.test/vip-320.mp3' : ''
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ data: { playUrl: { 'vip-mid': { url: urlByQuality } } } }),
    }
  }

  let result
  try {
    result = await getQQMusicPlay('vip-mid', { quality: 'lossless', mediaId: 'vip-media-mid' })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(requestedQualities, ['flac', '320'])
  assert.equal(normalizeQQPlaybackPayload(result, 'vip-mid')?.url, 'https://example.test/vip-320.mp3')
})

test('QQ profile and collection playlist summaries keep their real fields', () => {
  const createdPayload = {
    response: {
      code: 0,
      data: {
        playlists: [{
          dissid: 9748964820,
          dirid: 2,
          picurl: 'https://example.test/created.jpg',
          title: 'Created playlist',
          subtitle: '3首    0次播放',
        }],
      },
    },
  }
  const collectedPayload = {
    response: {
      code: 0,
      data: {
        totaldiss: 1,
        cdlist: [{
          dissid: 9232786605,
          dissname: 'Collected playlist',
          logo: 'https://example.test/collected.jpg',
          songnum: 161,
        }],
      },
    },
  }

  const created = extractQQPlaylists(unwrapQQResponse(createdPayload)).map(normalizeQQPlaylist)[0]
  const collected = extractQQPlaylists(unwrapQQResponse(collectedPayload)).map(normalizeQQPlaylist)[0]
  assert.deepEqual(
    { id: created.id, name: created.name, cover: created.coverImgUrl, trackCount: created.trackCount },
    { id: '9748964820', name: 'Created playlist', cover: 'https://example.test/created.jpg', trackCount: 3 },
  )
  assert.deepEqual(
    { id: collected.id, name: collected.name, cover: collected.coverImgUrl, trackCount: collected.trackCount },
    { id: '9232786605', name: 'Collected playlist', cover: 'https://example.test/collected.jpg', trackCount: 161 },
  )
})

test('QQ liked playlist combines info identity with song summary cover', () => {
  const liked = normalizeQQLikedPlaylist({
    response: {
      code: 0,
      data: {
        songs: [{
          title: '我喜欢',
          picurl: 'https://example.test/liked.jpg',
          id: '2370991765',
          num0: 3,
        }],
        info: { title: '我喜欢', id: '2370991765', songCount: 3 },
      },
    },
  })
  assert.deepEqual(
    { id: liked.id, name: liked.name, cover: liked.coverImgUrl, trackCount: liked.trackCount },
    { id: '2370991765', name: '我喜欢', cover: 'https://example.test/liked.jpg', trackCount: 3 },
  )
})

test('QQ liked playlist keeps alternate detail ids and embedded songs for fallback loading', () => {
  const liked = normalizeQQLikedPlaylist({
    data: {
      songs: [{
        title: '我喜欢',
        id: 'virtual-id',
        dissid: 'real-dissid',
        songlist: [{ songmid: 'mid-1', songname: 'Song 1' }],
      }],
      info: { id: 'virtual-id', dirid: 'real-dirid', title: '我喜欢' },
    },
  })

  assert.deepEqual(liked.detailIds, ['virtual-id', 'real-dissid', 'real-dirid'])
  assert.equal(liked.songs[0].sourceId, 'mid-1')
})

test('QQ liked playlist does not use a song id when playlist metadata has no id', () => {
  const liked = normalizeQQLikedPlaylist({
    data: {
      songs: [{ id: 'song-only-id', title: 'Song only', picurl: 'https://example.test/song.jpg' }],
      info: { title: 'liked playlist' },
    },
  })
  assert.equal(liked, null)
})

test('QQ playlist detail falls back to the loaded song count', () => {
  const detail = normalizeQQPlaylistDetail({
    data: {
      cdlist: [{
        disstid: 'list-1',
        dissname: 'Playlist',
        songnum: 0,
        songlist: [{ mid: 'song-1', songname: 'Song' }, { mid: 'song-2', songname: 'Song 2' }],
      }],
    },
  })
  assert.equal(detail.playlist.trackCount, 2)
  assert.equal(detail.playlist.size, 2)
})

// 服务端 /getSongListDetail 现在用 CgiGetDiss 的 dirinfo + songlist 组装 cdlist，
// 这里锁定该信封形状，避免服务端改动悄悄让歌单页变空。
test('QQ playlist detail reads the CgiGetDiss cdlist envelope', () => {
  const detail = normalizeQQPlaylistDetail({
    response: {
      code: 0,
      data: {
        cdlist: [{
          id: 7707261125,
          dirid: 31,
          title: '甜度爆表 | 旋律说唱狙击少女心',
          picurl: 'https://example.test/cover.jpg',
          songnum: 2,
          songlist: [
            { id: 127404639, mid: 'song-mid-1', name: '你的', singer: [{ id: 1, mid: 'singer-mid-1', name: 'DouDou' }] },
            { id: 127404640, mid: 'song-mid-2', name: 'Song 2', singer: [{ id: 2, mid: 'singer-mid-2', name: 'Singer 2' }] },
          ],
        }],
      },
    },
  })

  assert.equal(detail.playlist.id, '7707261125')
  assert.equal(detail.playlist.name, '甜度爆表 | 旋律说唱狙击少女心')
  assert.equal(detail.playlist.coverImgUrl, 'https://example.test/cover.jpg')
  assert.equal(detail.playlist.trackCount, 2)
  assert.equal(detail.songs.length, 2)
  assert.equal(detail.songs[0].name, '你的')
})

test('QQ playlist detail normalizes nested cdlist songlist responses', () => {
  const detail = normalizeQQPlaylistDetail({
    response: {
      code: 0,
      data: {
        cdlist: [{
          disstid: '9748964820',
          dissname: 'Created playlist',
          logo: 'https://example.test/created.jpg',
          songnum: 1,
          songlist: [{
            id: 123,
            mid: 'song-mid-1',
            name: 'Song 1',
            singer: [{ id: 9, mid: 'singer-mid-1', name: 'Singer 1' }],
            album: { id: 7, mid: 'album-mid-1', name: 'Album 1' },
          }],
        }],
      },
    },
  }, 'fallback-id')

  assert.equal(detail.playlist.id, '9748964820')
  assert.equal(detail.playlist.name, 'Created playlist')
  assert.equal(detail.playlist.coverImgUrl, 'https://example.test/created.jpg')
  assert.equal(detail.songs.length, 1)
  assert.deepEqual(
    { id: detail.songs[0].id, source: detail.songs[0].source, sourceId: detail.songs[0].sourceId, name: detail.songs[0].name },
    { id: 123, source: 'qq', sourceId: 'song-mid-1', name: 'Song 1' },
  )
})

// 回归：QQ 上游的数字歌曲 id 字段名是全小写 songid。历史实现的取值链漏了它，
// 导致 song.id 退化成 songmid，评论接口（只接受数字 topid）拿不到可用的资源 id。
test('QQ song normalization exposes the numeric song id without touching song.id', () => {
  const searchResult = normalizeQQSong({
    songmid: '0039MnYb0qxYhV',
    songid: 4936030,
    songname: '搜索来源',
  })
  // song.id 是队列身份，必须保持 songmid，不能被改成数字
  assert.equal(searchResult.id, '0039MnYb0qxYhV')
  assert.equal(searchResult.sourceId, '0039MnYb0qxYhV')
  assert.equal(searchResult.numericId, '4936030')

  // 榜单来源同样带 songid
  const toplistResult = normalizeQQSong({ songmid: 'toplist-mid', songid: 1024, title: '榜单来源' })
  assert.equal(toplistResult.numericId, '1024')

  // musicu GetDetail 只有数字 songId、没有 songmid：此时 song.id 本身就是数字
  const detailResult = normalizeQQSong({ songId: 90210, title: 'GetDetail 来源' })
  assert.equal(detailResult.numericId, '90210')

  // 完全没有数字 id 时不产出该字段
  const noNumeric = normalizeQQSong({ songmid: 'only-mid', songname: '无数字 id' })
  assert.equal(noNumeric.numericId, undefined)
})
