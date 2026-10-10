import { useLocalStore } from '../store/localStore'
import { getPreferredQuality } from './quality'

// 安卓端下载入队适配器：把「选择 → 下载」统一收敛到 localStore.downloadList，
// 逐首携带本次选择的音质（downloadManager 会优先读它，而不是全局设置）。
//
// 桌面/网页端的下载入队在 utils/download.js（主进程下载或浏览器下载），
// 安卓端两者都不存在，因此不移植该文件，只保留这一层薄适配。
export function enqueueDownloads(songs, quality) {
    const list = (Array.isArray(songs) ? songs : [songs]).filter(Boolean)
    if (list.length === 0) return 0

    const level = getPreferredQuality(quality)
    const localStore = useLocalStore()
    // updateDownloadList 在「没设置下载目录」时会给出提示并拒绝入队，这里如实透传结果
    const accepted = localStore.updateDownloadList(list.map(song => ({ ...song, quality: level })))
    return accepted ? list.length : 0
}