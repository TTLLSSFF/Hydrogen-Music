// 子路径部署（例如 nginx 把 /hydro/ 反代到本项目）时，前端所有同源请求都必须带上
// 与页面一致的前缀。Vite 构建期会把 import.meta.env.BASE_URL 替换成 vite.config.js 的 base：
// 网页部署可为 '/hydro/'，桌面端打包仍是相对路径 './'。
// 桌面端（file://）与 node 测试环境里没有 import.meta.env，统一归一成 '/'，
// 这样既有两个场景的历史行为完全不变。
const env = (() => {
  try {
    return import.meta.env || {}
  } catch (_) {
    return {}
  }
})()

export function normalizeBase(raw) {
  const value = String(raw ?? '').trim()
  if (!value || value === '.' || value === './') return '/'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value.endsWith('/') ? value : value + '/'
  const absolute = value.startsWith('/') ? value : '/' + value
  return absolute.endsWith('/') ? absolute : absolute + '/'
}

export const APP_BASE = normalizeBase(env.BASE_URL)

function isExternalUrl(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.startsWith('//')
}

// 拼给浏览器直接取用的路径（fetch / <a href> / new URL 的 path 部分）
// base 参数只供测试注入，运行期一律用 APP_BASE
export function resolveAppUrl(path = '', base = APP_BASE) {
  const relative = String(path ?? '')
  if (!relative) return base
  if (isExternalUrl(relative)) return relative
  const trimmed = relative.replace(/^\.?\//, '')
  return trimmed ? base + trimmed : base
}

// axios 的 baseURL：不能带尾斜杠，否则与已带前导斜杠的请求路径拼出双斜杠
export function resolveApiBaseUrl(path = '', base = APP_BASE) {
  const url = resolveAppUrl(path, base)
  return url === '/' ? '' : url.replace(/\/+$/, '')
}
