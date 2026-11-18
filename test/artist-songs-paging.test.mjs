import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = file => readFileSync(join(root, file), 'utf8')

test('artist API exposes paginated /artist/songs with limit/offset/order', () => {
  const source = read('src/api/artist.js')
  assert.match(source, /export function getArtistSongs\(/)
  assert.match(source, /get\('\/artist\/songs', \{ id, limit, offset, order/)
})

test('library store loads artist songs page by page instead of the 50-song top list', () => {
  const source = read('src/store/libraryStore.js')
  assert.match(source, /const ARTIST_SONGS_PAGE_SIZE = 100/)
  assert.match(source, /async fetchArtistSongPage\(artistId, offset = 0\)/)
  assert.match(source, /async updateArtistSongs\(id, fallbackSongs = \[\]\)/)
  assert.match(source, /async loadMoreArtistSongs\(\)/)
  // /artist/top/song 只回 50 首，歌手页不再依赖它
  assert.equal(source.includes('getArtistTopSong'), false)
  assert.match(source, /this\.artistSongsHasMore = Boolean\(page\.more\)/)
})

test('artist detail cache keeps the loaded paging total so scroll cursor survives a revisit', () => {
  const source = read('src/store/libraryStore.js')
  assert.match(source, /artistSongsTotal: this\.artistSongsTotal,/)
  assert.match(source, /this\.resetArtistSongsPaging\(\{\n\s+offset: Array\.isArray\(this\.librarySongs\) \? this\.librarySongs\.length : 0,/)
})

test('song list load-more dispatches to the NetEase or QQ paging loader by source', () => {
  const source = read('src/components/LibraryDetail.vue')
  assert.match(source, /const isSingerSongsPaging = computed\(\(\) => isArtistTopSongRoute\.value && !hasSongSearchKeyword\.value\)/)
  assert.match(source, /if \(isQQSource\.value\) void libraryStore\.loadMoreQQSingerSongs\(\)/)
  assert.match(source, /else void libraryStore\.loadMoreArtistSongs\(\)/)
  assert.match(source, /:has-more="isSingerSongsPaging && singerSongsHasMore"/)
  assert.match(source, /@load-more="loadMoreSingerSongs"/)
})
