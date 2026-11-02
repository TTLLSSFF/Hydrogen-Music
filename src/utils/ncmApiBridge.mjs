import { APP_BASE } from './appBase.mjs'

// 网页端 API 走同源反代（baseURL = '/api'，子路径部署时为 '<base>api'），桌面端由 Electron 主进程内置的
// 网易云 API 服务提供（见 src/electron/services.js），主进程只接受
// hostname 为 localhost/127.0.0.1 且端口为 36530 的绝对地址。
// 这里负责把渲染层的请求路径换算成主进程可接受的形式。
export const DESKTOP_NCM_API_ORIGIN = 'http://127.0.0.1:36530'

// ['/hydro/api', '/api']：先试带部署前缀的长前缀，再退回根路径部署
const API_PREFIXES = [
  `${APP_BASE.replace(/\/+$/, '')}/api`,
  '/api',
].filter((prefix, index, all) => prefix && all.indexOf(prefix) === index)

function stripApiPrefix(path) {
  for (const prefix of API_PREFIXES) {
    if (path.startsWith(prefix + '/')) return path.slice(prefix.length)
  }
  // 形如 '/api' 的精确路径保留原样：上游的 generic 路由本身就是 /api
  return path
}

export function resolveNcmBridgeUrl(config = {}, origin = DESKTOP_NCM_API_ORIGIN) {
  const baseURL = String(config.baseURL || '')
  if (/^https?:\/\//i.test(baseURL)) {
    try {
      return new URL(String(config.url || ''), baseURL).toString()
    } catch (_) {
      return String(config.url || '')
    }
  }

  const requestUrl = String(config.url || '/')
  // /api 前缀由 web 服务器（vite 代理 / web-server.js）承载，直连主进程要剥掉。
  // 请求路径通常是相对 baseURL 的（不含 base），但兼容调用方自带 base 前缀的情形。
  const apiPath = stripApiPrefix(requestUrl)
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`

  try {
    return new URL(normalizedPath, origin).toString()
  } catch (_) {
    return `${origin}${normalizedPath}`
  }
}