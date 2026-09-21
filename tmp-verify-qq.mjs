import {
  normalizeQQPlaylistCard,
  normalizeQQPlaylistDetail,
  normalizeQQRecommendCards,
} from './src/api/qqMusic.js'

const base = 'http://127.0.0.1:3200'
const get = async p => {
  const r = await fetch(base + p)
  let body = null
  try { body = await r.json() } catch (_) { body = null }
  return { status: r.status, body }
}

const tag = await get('/getPlaylistsByTag?tagId=10000000&page=0&limit=20')
console.log('[playlistsByTag] status=', tag.status)
const cards = normalizeQQPlaylistCard(tag.body)
console.log('[cards] count=', cards.length, 'first=', JSON.stringify(cards[0]))
const first = cards[0]
if (first?.id) {
  const d = await get('/getSongListDetail?disstid=' + first.id)
  console.log('[detail] status=', d.status)
  const norm = normalizeQQPlaylistDetail(d.body, String(first.id))
  console.log('[normalized playlist]', JSON.stringify({
    id: norm.playlist.id,
    name: norm.playlist.name,
    trackCount: norm.playlist.trackCount,
  }))
  console.log('[songs] count=', norm.songs.length)
  console.log('[song sample]', JSON.stringify(norm.songs[0]).slice(0, 700))
}

const personal = await get('/getPersonalRecommend')
console.log('[personalRecommend] status=', personal.status, 'body=', JSON.stringify(personal.body).slice(0, 200))
const recCards = normalizeQQRecommendCards(personal.body)
console.log('[personalRecommend cards] count=', recCards.length)
