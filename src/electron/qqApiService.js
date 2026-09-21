const http = require('http')

// QQ 音乐本地 API 服务（默认 3200，可用 QQ_API_PORT 覆盖）。
// 桌面端渲染层走 IPC `qq-api-request` 访问它，避免 file/app 协议下相对路径 /api/qq 打不到服务端。
const QQ_API_DEFAULT_PORT = 3200
const QQ_API_READY_WAIT_TIMEOUT_MS = 10000
const QQ_API_PROBE_TIMEOUT_MS = 1000

const qqApiPort = (() => {
    const configured = Number(process.env.QQ_API_PORT)
    return Number.isFinite(configured) && configured > 0 ? Math.trunc(configured) : QQ_API_DEFAULT_PORT
})()

let qqApiReadyResolved = false
let qqApiReadyPayload = null
let qqApiStartPromise = null
const qqApiReadyWaiters = []

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function resolveQQApiReady(payload) {
    if (qqApiReadyResolved) return
    qqApiReadyResolved = true
    qqApiReadyPayload = payload
    while (qqApiReadyWaiters.length > 0) {
        const waiter = qqApiReadyWaiters.shift()
        try {
            waiter(payload)
        } catch (_) {}
    }
}

function getQQApiPort() {
    return qqApiPort
}

function isQQApiReady() {
    return qqApiReadyResolved && Boolean(qqApiReadyPayload && qqApiReadyPayload.ready)
}

// 供 IPC 查询：已就绪立即返回，启动中则等待（超时返回未就绪）。
function waitForQQApiReady(timeoutMs = QQ_API_READY_WAIT_TIMEOUT_MS) {
    if (qqApiReadyResolved) return Promise.resolve(qqApiReadyPayload)

    return new Promise(resolve => {
        let timer = null
        const onReady = (payload) => {
            if (timer) clearTimeout(timer)
            resolve(payload)
        }
        timer = setTimeout(() => {
            const index = qqApiReadyWaiters.indexOf(onReady)
            if (index >= 0) qqApiReadyWaiters.splice(index, 1)
            resolve({ ready: false, error: 'qq-api-ready-timeout', port: qqApiPort })
        }, timeoutMs)
        qqApiReadyWaiters.push(onReady)
    })
}

function probeQQApiReachable(timeoutMs = QQ_API_PROBE_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${qqApiPort}/`, (res) => {
            res.resume()
            resolve(res.statusCode || 200)
        })
        req.setTimeout(timeoutMs, () => req.destroy(new Error('qq-api-probe-timeout')))
        req.on('error', reject)
    })
}

async function waitForQQApiReachable(timeoutMs = 4000, intervalMs = 150) {
    const deadline = Date.now() + timeoutMs
    let lastError = null

    while (Date.now() < deadline) {
        try {
            await probeQQApiReachable()
            return
        } catch (error) {
            lastError = error
            await delay(intervalMs)
        }
    }

    throw lastError || new Error('qq-api-unreachable')
}

// 启动失败（含端口占用）只记录日志并标记未就绪，绝不让主进程崩溃。
async function startQQMusicApi() {
    if (qqApiStartPromise) return qqApiStartPromise

    qqApiStartPromise = (async () => {
        let startServer = null
        try {
            ({ startQQMusicApi: startServer } = require('../../server/qqMusicApi.cjs'))
        } catch (error) {
            const errorMessage = error && error.message ? error.message : 'unknown error'
            console.error('QQ API 模块加载失败:', errorMessage)
            const payload = { ready: false, error: errorMessage, port: qqApiPort }
            resolveQQApiReady(payload)
            return payload
        }

        try {
            await startServer(qqApiPort)
            await waitForQQApiReachable()
            console.log(`QQ API 已就绪 (127.0.0.1:${qqApiPort})`)
            const payload = { ready: true, port: qqApiPort }
            resolveQQApiReady(payload)
            return payload
        } catch (error) {
            const errorMessage = error && error.message ? error.message : 'unknown error'
            // 端口被占用时可能是上一次残留实例仍在监听：探测可达即复用，避免误报未就绪。
            if (error && error.code === 'EADDRINUSE') {
                try {
                    await waitForQQApiReachable(1000, 100)
                    console.warn(`QQ API 端口 ${qqApiPort} 已被占用，复用现有实例`)
                    const payload = { ready: true, port: qqApiPort, reused: true }
                    resolveQQApiReady(payload)
                    return payload
                } catch (_) {}
            }
            console.error('QQ API 启动失败:', errorMessage)
            const payload = { ready: false, error: errorMessage, port: qqApiPort }
            resolveQQApiReady(payload)
            return payload
        }
    })()

    return qqApiStartPromise
}

module.exports = {
    QQ_API_DEFAULT_PORT,
    startQQMusicApi,
    getQQApiPort,
    isQQApiReady,
    waitForQQApiReady,
}