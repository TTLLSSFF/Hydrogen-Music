import request from '../utils/request'

export function togetherRequest(path, data = {}) {
    // The bundled list wrapper discards playMode and other participants' versions.
    // Use its generic authenticated API route for the complete protocol payload.
    // 这两个 url 是相对 axios baseURL（'<base>api'）的路径，'.../api' 才是上游的
    // generic 路由；base 前缀由 request 的 baseURL 承担，这里不能再加一次。
    let url = `/listentogether/${path}`
    if (path === 'sync/list/command') {
        url = '/api'
        const { roomId, ...playlistParam } = data
        data = { uri: '/api/listen/together/sync/list/command/report', data: {
            roomId, playlistParam: JSON.stringify({ anchorSongId: '', anchorPosition: -1, ...playlistParam }),
        } }
    } else if (path === 'invite') {
        url = '/api'
        data = { uri: '/api/listen/together/invite/message/send', data }
    }
    return request({ url, method: 'post', data, params: { timestamp: Date.now() }, suppressGlobalNotice: true })
}
