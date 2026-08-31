import test from 'node:test'
import assert from 'node:assert/strict'
import {
  extractQQPlaylists,
  getQQAlbumInfo,
  getQQMv,
  getQQMvPlay,
  getQQSongListDetail,
  normalizeQQLyricPayload,
  normalizeQQLikedPlaylist,
  normalizeQQPlaylist,
  normalizeQQPlaylistDetail,
  normalizeQQSearchPayload,
  normalizeQQSong,
  QQ_PUBLIC_API_DISABLED_CODE,
  searchQQ,
  searchQQAll,
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

test('QQ public search and detail adapters fail closed without issuing requests', async () => {
  const originalFetch = globalThis.fetch
  let requestCount = 0
  globalThis.fetch = async url => {
    requestCount += 1
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ response: { code: 0, data: { song: { list: [] } } } }) }
  }
  try {
    for (const call of [
      () => searchQQ('keyword'),
      () => searchQQAll('keyword', { limit: 10 }),
      () => getQQAlbumInfo('album-mid'),
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
    singer: [{ singer_mid: 'singer-mid', singerName: 'Alias singer' }],
    album: { album_mid: 'album-mid', albumName: 'Alias album', picurl: 'https://example.test/album.jpg' },
    songtime: 241,
  })

  assert.deepEqual({
    id: song.id,
    sourceId: song.sourceId,
    name: song.name,
    artistName: song.ar[0]?.name,
    artistMid: song.ar[0]?.mid,
    albumName: song.al.name,
    cover: song.al.picUrl,
    duration: song.dt,
  }, {
    id: 90210,
    sourceId: '002-song-mid',
    name: 'Alias song',
    artistName: 'Alias singer',
    artistMid: 'singer-mid',
    albumName: 'Alias album',
    cover: 'https://example.test/album.jpg',
    duration: 241000,
  })
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
