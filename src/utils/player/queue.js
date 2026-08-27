import { getSongIdentity } from '../musicSource.mjs'

export function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min)
}

export function createShuffledList(songList, {
    isPlayAll = false,
    currentSongId = null,
    currentSong = null,
    randomInt = getRandomInt,
} = {}) {
    const shuffledSongs = Array.isArray(songList) ? songList.slice() : []

    for (let i = 0; i < shuffledSongs.length; i++) {
        const j = randomInt(0, i)
        const t = shuffledSongs[i]
        shuffledSongs[i] = shuffledSongs[j]
        shuffledSongs[j] = t
    }

    if (!isPlayAll) {
        const currentIdentity = currentSong
            ? getSongIdentity(currentSong)
            : (typeof currentSongId === 'string' && /^(?:qq|netease):/.test(currentSongId)
                ? currentSongId
                : '')
        const currentSongIndex = (shuffledSongs || []).findIndex((song) => {
            if (!song) return false
            if (currentIdentity) return getSongIdentity(song) === currentIdentity
            return String(song.id) === String(currentSongId)
        })
        const selectedCurrentSong = currentSong || (currentSongIndex >= 0 ? shuffledSongs[currentSongIndex] : null)
        if (selectedCurrentSong) {
            if (currentSongIndex >= 0) shuffledSongs.splice(currentSongIndex, 1)
            shuffledSongs.unshift(selectedCurrentSong)
        }
    }

    return shuffledSongs
}
