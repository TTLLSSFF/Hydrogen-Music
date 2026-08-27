/**
 * Prepare the input used by playAll and return an empty array for anything
 * that cannot produce a playable queue.
 *
 * The optional normalizer lets the caller apply the same song mapping used by
 * the player before deciding whether it should attempt to start playback.
 */
export function preparePlayAllSongs(list, normalizeSongs = value => value) {
    if (!Array.isArray(list) || list.length === 0) return []

    const normalized = typeof normalizeSongs === 'function'
        ? normalizeSongs(list)
        : list

    if (!Array.isArray(normalized)) return []
    return normalized.filter(song => song !== null && song !== undefined)
}
