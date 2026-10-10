// 安卓端 QQ 请求传输层：把 qqRequest 的默认实现替换为「打到内嵌转发层的绝对地址」。
//
// 与网易云链路（utils/request.js 的 resolveApiBaseURL）同构：
//   · base 由构建期注入（build-android.cjs 写 window.__HM_QQ_API_BASE__ = http://127.0.0.1:36531/qq）；
//     开发期没有注入时退回相对路径 /api/qq，由 vite 代理（apps/android/vite.config.js）转发。
//   · App 冷启动时内嵌 Node 尚未监听端口，首批请求会 Network Error 且不会自动重试，
//     因此对绝对地址先探测 /qq/__hm_ready：QQ 未起来时转发层回 502，起来后是 404，
//     沿用 request.js 的判据「status < 500 即就绪」。
import { setQQRequestTransport } from '../../../../src/utils/qqRequest.mjs'

const PROBE_TIMEOUT_MS = 20000
const PROBE_INTERVAL_MS = 300
const PROBE_SINGLE_TIMEOUT_MS = 1500

function resolveQQBase() {
  const injected = typeof window !== 'undefined' ? window.__HM_QQ_API_BASE__ : ''
  if (typeof injected === 'string' && injected) return injected.replace(/\/+$/, '')
  return '/api/qq'
}

let readyPromise = null

function probeOnce(base) {
  return new Promise(resolve => {
    let settled = false
    const finish = ok => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    try {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', `${base}/__hm_ready`, true)
      xhr.timeout = PROBE_SINGLE_TIMEOUT_MS
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) finish(xhr.status >= 200 && xhr.status < 500)
      }
      xhr.ontimeout = () => finish(false)
      xhr.onerror = () => finish(false)
      xhr.send()
    } catch (_) {
      finish(false)
    }
  })
}

async function waitForQQApi(base) {
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await probeOnce(base)) return true
    await new Promise(resolve => setTimeout(resolve, PROBE_INTERVAL_MS))
  }
  return false
}

function ensureQQApiReady(base) {
  if (readyPromise) return readyPromise
  readyPromise = waitForQQApi(base).then(ready => {
    // 超时后允许下一次请求重新等一轮，避免一次冷启动失败把后续请求全部钉死
    if (!ready) readyPromise = null
    return ready
  })
  return readyPromise
}

// 与 qqRequest 默认传输同构：query 拼装、POST JSON、credentials omit、超时，
// 非 2xx 包装成 { response: { status, data } }（qqRequest 的 createSafeQQRequestError 读这个形状）。
async function sendViaBridge(config) {
  const base = resolveQQBase()
  if (/^https?:\/\//i.test(base)) await ensureQQApiReady(base)

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(config.params || {})) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) value.forEach(item => search.append(key, String(item)))
    else search.set(key, String(value))
  }
  const query = search.toString()
  const headers = { ...(config.headers || {}) }
  const init = {
    method: config.method.toUpperCase(),
    headers,
    credentials: 'omit',
    signal: AbortSignal.timeout(config.timeout),
  }
  if (config.data !== undefined) {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json'
    init.body = JSON.stringify(config.data)
  }

  const response = await fetch(`${base}${config.url}${query ? `?${query}` : ''}`, init)
  const contentType = response.headers.get('content-type') || ''
  const data = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) {
    const error = new Error(`Request failed with status code ${response.status}`)
    error.response = { status: response.status, data }
    throw error
  }
  return { data }
}

export function installQQTransport() {
  setQQRequestTransport(sendViaBridge)
}