import { getSongIdentity } from '../musicSource.mjs'

export function getActivePlaylistSurface(widgetState) {
  return widgetState ? 'widget' : 'player'
}

export function getPlaylistItemKey(song, index) {
  return `${getSongIdentity(song) || 'playlist'}:${index}`
}

/**
 * Return whether a window click should dismiss the currently open playlist.
 *
 * The widget and full player intentionally mount only one playlist surface at
 * a time.  Callers therefore pass the elements that actually exist instead of
 * requiring both legacy surfaces to be present.
 */
export function shouldClosePlaylistOnExternalClick(target, options = {}) {
  const playlistElements = Array.isArray(options.playlistElements) ? options.playlistElements : []
  if (playlistElements.length === 0 || options.isItemDelete === true) return false

  const allowedElements = [
    ...playlistElements,
    ...(Array.isArray(options.controlElements) ? options.controlElements : []),
    ...(Array.isArray(options.contextMenuElements) ? options.contextMenuElements : []),
  ]

  return !allowedElements.some(element => (
    element
    && typeof element.contains === 'function'
    && element.contains(target)
  ))
}
