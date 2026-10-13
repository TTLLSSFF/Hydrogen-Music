import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const libraryTypeSource = readFileSync(new URL('../apps/android/src/components/LibraryType.vue', import.meta.url), 'utf8')
const myMusicSource = readFileSync(new URL('../apps/android/src/views/MyMusic.vue', import.meta.url), 'utf8')

test('Android playlist requests keep the composite guard but send only the NetEase id', () => {
  assert.match(libraryTypeSource, /uid:\s*getMusicAccountId\(requestUserId,\s*['"]netease['"]\)/)
  assert.match(libraryTypeSource, /isLibraryRequestActive\(requestToken,\s*requestUserId,\s*['"]netease['"]\)/)
  assert.match(libraryTypeSource, /loadUserPlaylist\(requestToken,\s*requestUserId,\s*options\)/)
})

test('Android My Music renders for a QQ-only login', () => {
  assert.match(myMusicSource, /hasAnyMusicAccount/)
  assert.match(myMusicSource, /v-if="hasMusicAccount \|\| userStore\.localOnlyMode"/)
})
