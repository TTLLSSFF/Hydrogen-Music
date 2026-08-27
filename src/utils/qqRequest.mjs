import { containsQQSecret, sanitizeQQPayload } from './qqSecurity.mjs'

const QQ_API_BASE_URL = '/api/qq'
const QQ_REQUEST_TIMEOUT_MS = 10000

function assertSafeQQRequest(config) {
  if (containsQQSecret({
    url: config.url,
    params: config.params,
    data: config.data,
    headers: config.headers,
  })) {
    throw new TypeError('QQ request contains forbidden secret material')
  }
}

export function createQQRequestConfig(config = {}) {
  const url = String(config.url || '')
  if (!url.startsWith('/') || url.startsWith('//')) {
    throw new TypeError('QQ request URL must be relative to the QQ API')
  }

  const safeConfig = {
    baseURL: QQ_API_BASE_URL,
    url,
    method: String(config.method || 'get').toLowerCase(),
  }
  if (config.params !== undefined) safeConfig.params = config.params
  if (config.data !== undefined) safeConfig.data = config.data
  if (config.headers !== undefined) safeConfig.headers = config.headers
  if (config.responseType !== undefined) safeConfig.responseType = config.responseType
  safeConfig.timeout = Number(config.timeout) > 0 ? Number(config.timeout) : QQ_REQUEST_TIMEOUT_MS
  safeConfig.withCredentials = false
  safeConfig.credentials = 'omit'

  assertSafeQQRequest(safeConfig)
  return safeConfig
}

export function createQQQrCheckRequestConfig(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim()
  if (!normalizedSessionId) throw new TypeError('QQ login session id is required')
  return createQQRequestConfig({
    url: '/checkQQLoginQr',
    method: 'post',
    data: { sessionId: normalizedSessionId },
  })
}

function createSafeQQRequestError(error) {
  const responseData = sanitizeQQPayload(error?.response?.data)
  const rawMessage = responseData?.message || responseData?.msg || error?.message || 'QQ Music request failed'
  const safeMessage = sanitizeQQPayload(String(rawMessage))
  const safeError = new Error(safeMessage)
  safeError.name = 'QQRequestError'
  if (Number.isFinite(Number(error?.response?.status))) safeError.status = Number(error.response.status)
  if (responseData && typeof responseData === 'object') safeError.responseData = responseData
  return safeError
}

export function createQQRequest(transport) {
  const send = transport || (async (config) => {
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
    const response = await fetch(`${config.baseURL}${config.url}${query ? `?${query}` : ''}`, init)
    const contentType = response.headers.get('content-type') || ''
    const data = contentType.includes('application/json') ? await response.json() : await response.text()
    if (!response.ok) {
      const error = new Error(`Request failed with status code ${response.status}`)
      error.response = { status: response.status, data }
      throw error
    }
    return { data }
  })
  return async function qqRequest(config = {}) {
    const safeConfig = createQQRequestConfig(config)
    try {
      const response = await send(safeConfig)
      return sanitizeQQPayload(response?.data ?? response)
    } catch (error) {
      throw createSafeQQRequestError(error)
    }
  }
}

const qqRequest = createQQRequest()

export default qqRequest
