// 网页端 API 走同源反代（baseURL = '/api'），桌面端由 Electron 主进程内置的
// 网易云 API 服务提供（见 src/electron/services.js），主进程只接受
// hostname 为 localhost/127.0.0.1 且端口为 36530 的绝对地址。
// 这里负责把渲染层的请求路径换算成主进程可接受的形式。
export const DESKTOP_NCM_API_ORIGIN = 'http://127.0.0.1:36530'

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
  // /api 前缀由 web 服务器（vite 代理 / web-server.js）承载，直连主进程要剥掉
  const apiPath = requestUrl.startsWith('/api/') ? requestUrl.slice('/api'.length) : requestUrl
  const normalizedPath = apiPath.startsWith('/') ? apiPath : `/${apiPath}`

  try {
    return new URL(normalizedPath, origin).toString()
  } catch (_) {
    return `${origin}${normalizedPath}`
  }
}