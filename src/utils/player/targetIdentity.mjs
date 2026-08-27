import { getSongIdentity } from '../musicSource.mjs'

function normalizeTargetId(value) {
  return value === undefined || value === null || value === '' ? '' : String(value)
}

function resolveFallbackId(song, fallbackId) {
  return fallbackId === undefined || fallbackId === null || fallbackId === ''
    ? song?.id
    : fallbackId
}

/**
 * Return a provider-aware identity for an async playback target.
 *
 * `songId` is intentionally kept as a raw value in the player store for
 * compatibility with the existing UI. Async work must carry this identity so
 * a QQ song and a NetEase song that happen to share an id cannot match.
 */
export function getPlaybackTargetIdentity(song, fallbackId = '') {
  const identity = getSongIdentity(song)
  if (identity) return identity
  return normalizeTargetId(resolveFallbackId(song, fallbackId))
}

export function createPlaybackTarget(song, fallbackId = '') {
  return {
    id: normalizeTargetId(resolveFallbackId(song, fallbackId)),
    identity: getPlaybackTargetIdentity(song, fallbackId),
  }
}

export function isPlaybackTargetCurrent(target, currentSong, currentSongId = '') {
  if (!target) return false

  const targetIdentity = typeof target === 'string'
    ? target
    : target.identity || target.targetIdentity || getPlaybackTargetIdentity(target.song, target.id)
  const currentIdentity = getPlaybackTargetIdentity(currentSong, currentSongId)

  if (targetIdentity && currentIdentity) return targetIdentity === currentIdentity

  const targetId = normalizeTargetId(typeof target === 'string' ? target : target.id)
  const currentId = normalizeTargetId(resolveFallbackId(currentSong, currentSongId))
  return !!targetId && targetId === currentId
}
