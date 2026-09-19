import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildQQArtistRoute,
  looksLikeQQSingerMid,
  openArtistRoute,
} from '../src/utils/qqArtistRoute.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

test('QQ singer mid is alphanumeric and numeric ids are rejected as route ids', () => {
  assert.equal(looksLikeQQSingerMid('0025NhlN2yWrP4'), true)
  assert.equal(looksLikeQQSingerMid('4558'), false)
  assert.equal(looksLikeQQSingerMid(''), false)
})

test('QQ artist route prefers singer mid and keeps numeric singerid in query', () => {
  const route = buildQQArtistRoute({
    id: '0025NhlN2yWrP4',
    mid: '0025NhlN2yWrP4',
    singerid: '4558',
    name: '周杰伦',
    source: 'qq',
  })
  assert.deepEqual(route, {
    path: '/mymusic/artist/0025NhlN2yWrP4',
    query: { source: 'qq', name: '周杰伦', singerid: '4558' },
  })
})

test('QQ artist route does not treat a numeric extra.id as singermid', () => {
  assert.equal(buildQQArtistRoute({ name: '周杰伦' }, { source: 'qq', id: '4558' }), null)
  const route = buildQQArtistRoute({ name: '周杰伦' }, { source: 'qq', id: '0025NhlN2yWrP4', singerid: 4558 })
  assert.equal(route.path, '/mymusic/artist/0025NhlN2yWrP4')
  assert.equal(route.query.singerid, '4558')
})

test('openArtistRoute sends QQ artists through query and NetEase artists through path only', () => {
  const pushes = []
  const router = { push: (value) => pushes.push(value) }

  assert.equal(openArtistRoute(router, { id: '0025NhlN2yWrP4', mid: '0025NhlN2yWrP4', name: '周杰伦' }, { source: 'qq' }), true)
  assert.equal(openArtistRoute(router, { id: 6452, name: '周杰伦' }, { source: 'netease' }), true)
  assert.equal(openArtistRoute(router, { id: '0025NhlN2yWrP4' }, { source: 'qq' }), true)

  assert.deepEqual(pushes[0], {
    path: '/mymusic/artist/0025NhlN2yWrP4',
    query: { source: 'qq', name: '周杰伦' },
  })
  assert.equal(pushes[1], '/mymusic/artist/6452')
})

test('login request path no longer references HasNeedTimestampUrl', () => {
  const requestSource = readFileSync(join(root, 'src/utils/request.js'), 'utf8')
  const librarySource = readFileSync(join(root, 'src/store/libraryStore.js'), 'utf8')
  assert.equal(requestSource.includes('hasNeedTimestampUrl'), false)
  assert.equal(requestSource.includes('needTimestamp.mjs'), false)
  assert.equal(librarySource.includes('hasNeedTimestampUrl'), false)
  assert.equal(librarySource.includes('needTimestamp.mjs'), false)
  assert.match(requestSource, /Array\.isArray\(needTimestamp\) && needTimestamp\.includes\(config\.url\)/)
})
