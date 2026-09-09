import test from 'node:test'
import assert from 'node:assert/strict'
import { shouldClosePlaylistOnExternalClick } from '../src/utils/player/playlistRuntime.mjs'

function nodeThatContains(...targets) {
  return {
    contains(target) {
      return targets.includes(target)
    },
  }
}

test('closes the playlist when only the widget surface is mounted', () => {
  const target = {}
  const playlist = nodeThatContains()
  const musicControl = nodeThatContains()

  assert.equal(shouldClosePlaylistOnExternalClick(target, {
    playlistElements: [playlist],
    controlElements: [musicControl],
  }), true)
})

test('closes the playlist when only the player surface is mounted', () => {
  const target = {}
  const playlistPlayer = nodeThatContains()
  const songControl = nodeThatContains()

  assert.equal(shouldClosePlaylistOnExternalClick(target, {
    playlistElements: [playlistPlayer],
    controlElements: [songControl],
  }), true)
})

test('keeps the playlist open when the click is inside an active surface', () => {
  const target = {}
  const playlist = nodeThatContains(target)

  assert.equal(shouldClosePlaylistOnExternalClick(target, {
    playlistElements: [playlist],
  }), false)
})

test('keeps the playlist open when the click is inside a player control or context menu', () => {
  const target = {}
  const playlist = nodeThatContains()
  const musicControl = nodeThatContains(target)
  const musicOther = nodeThatContains()
  const songControl = nodeThatContains()
  const contextMenu = nodeThatContains()

  assert.equal(shouldClosePlaylistOnExternalClick(target, {
    playlistElements: [playlist],
    controlElements: [musicControl, musicOther, songControl],
    contextMenuElements: [contextMenu],
  }), false)
})

test('keeps the playlist open for the delete-item exception', () => {
  assert.equal(shouldClosePlaylistOnExternalClick({}, {
    playlistElements: [{ contains: () => false }],
    isItemDelete: true,
  }), false)
})

test('does not close when no playlist surface is mounted', () => {
  assert.equal(shouldClosePlaylistOnExternalClick({}, {
    playlistElements: [],
    controlElements: [{ contains: () => false }],
  }), false)
})
