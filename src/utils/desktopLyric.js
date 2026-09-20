import { createApp } from 'vue'
import pinia from '../store/pinia'
import { usePlayerStore } from '../store/playerStore'
import { registerTraditionalTextRoot } from './traditionalText'

// 网页版桌面歌词窗口。参考桌面端实现（Electron 无边框置顶窗口 + IPC 推送歌词数据），
// 这里改用 Document Picture-in-Picture（系统级置顶浮窗）承载，不支持该 API 的浏览器
// 降级为 window.open 弹窗（可拖动/缩放，但不置顶）。
// 两种窗口都与主页面同源，且 PiP 与主页面共享脚本上下文：直接把 Vue 组件挂载后移动到
// 歌词窗口即可复用主窗口的 Pinia 状态，无需 Electron 版的数据推送协议。
const LYRIC_WINDOW_NAME = 'hydrogen-desktop-lyric'
const LYRIC_WINDOW_WIDTH = 520
const LYRIC_WINDOW_HEIGHT = 360
const LYRIC_WINDOW_FEATURES = `popup=yes,width=${LYRIC_WINDOW_WIDTH},height=${LYRIC_WINDOW_HEIGHT},resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no`
// 部分内嵌 Chromium（如 Electron 外壳）存在 documentPictureInPicture 但 requestWindow 永不返回，
// 超时后降级为普通弹窗，避免点击后毫无反应
const PIP_REQUEST_TIMEOUT_MS = 2000
// 自定义字体样式 id，与 setFont.js 的 CUSTOM_FONT_STYLE_ID 对应
const CUSTOM_FONT_STYLE_ID = '__CUSTOM_FONT__'
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g

let lyricWindow = null
let lyricContainer = null
let lyricApp = null
let themeObserver = null
let unregisterTraditionalTextRoot = null
let windowListeners = []

const playerStore = usePlayerStore(pinia)

export function isDesktopLyricSupported() {
  return typeof window !== 'undefined' && !!window.documentPictureInPicture && window.isSecureContext !== false
}

// 给永不返回的 requestWindow 兜底；若超时后窗口才姗姗来迟，直接关掉它
function requestPipWindowWithTimeout(options) {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      reject(new Error('pip-timeout'))
    }, PIP_REQUEST_TIMEOUT_MS)

    window.documentPictureInPicture.requestWindow(options).then(
      pipWindow => {
        if (settled) {
          try {
            pipWindow.close()
          } catch (_) {}
          return
        }

        clearTimeout(timer)
        settled = true
        resolve(pipWindow)
      },
      error => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        reject(error)
      }
    )
  })
}

export function isDesktopLyricOpen() {
  return !!lyricWindow && !lyricWindow.closed
}

// 复制过来的样式表可能带相对 url()（字体、图片），在歌词窗口里会按 about:blank 解析而失效
function toAbsoluteCssUrls(cssText) {
  return String(cssText || '').replace(CSS_URL_PATTERN, (match, quote, rawUrl) => {
    const url = String(rawUrl || '').trim()
    if (!url || url.startsWith('#') || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(url)) {
      return match
    }

    try {
      return `url(${quote}${new URL(url, document.baseURI).href}${quote})`
    } catch (_) {
      return match
    }
  })
}

// PiP 窗口是全新文档，不会继承主页面的样式，需要显式复制
function copyStyleSheets(targetDocument) {
  for (const sheet of Array.from(document.styleSheets)) {
    let styleElement = null
    try {
      const cssText = Array.from(sheet.cssRules || []).map(rule => rule.cssText).join('\n')
      if (!cssText) continue

      styleElement = targetDocument.createElement('style')
      styleElement.textContent = toAbsoluteCssUrls(cssText)
    } catch (_) {
      // 跨域样式表读不到 cssRules，退化为按链接重新加载
      if (!sheet.href) continue
      styleElement = targetDocument.createElement('link')
      styleElement.rel = 'stylesheet'
      styleElement.href = sheet.href
    }

    if (styleElement) targetDocument.head.appendChild(styleElement)
  }
}

function injectBaseStyle(targetDocument) {
  const style = targetDocument.createElement('style')
  style.id = 'desktop-lyric-base'
  style.textContent = `
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; overscroll-behavior: none; }
    body { user-select: none; }
  `
  targetDocument.head.appendChild(style)
}

function prepareDocument(targetDocument) {
  targetDocument.title = 'Hydrogen Music - Desktop Lyric'

  const charset = targetDocument.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  targetDocument.head.appendChild(charset)

  const referrer = targetDocument.createElement('meta')
  referrer.name = 'referrer'
  referrer.content = 'no-referrer'
  targetDocument.head.appendChild(referrer)
}

// 歌词窗口跟随主窗口的深浅色与语言（主题切换时同步）
function syncDocumentTheme(targetDocument) {
  const applyTheme = () => {
    const source = document.documentElement
    targetDocument.documentElement.className = source.className
    const lang = source.getAttribute('lang')
    if (lang) targetDocument.documentElement.setAttribute('lang', lang)
    else targetDocument.documentElement.removeAttribute('lang')
  }

  applyTheme()
  themeObserver = new MutationObserver(applyTheme)
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] })
}

function addWindowListener(target, type, handler) {
  target.addEventListener(type, handler)
  windowListeners.push(() => target.removeEventListener(type, handler))
}

function forgetLyricWindow() {
  themeObserver?.disconnect()
  themeObserver = null

  unregisterTraditionalTextRoot?.()
  unregisterTraditionalTextRoot = null

  windowListeners.forEach(remove => remove())
  windowListeners = []

  try {
    lyricApp?.unmount()
  } catch (_) {}
  lyricApp = null
  lyricContainer?.remove()
  lyricContainer = null
  lyricWindow = null
  playerStore.isDesktopLyricOpen = false
}

async function openDesktopLyricWindow() {
  let targetWindow = null

  if (isDesktopLyricSupported()) {
    try {
      targetWindow = await requestPipWindowWithTimeout({
        width: LYRIC_WINDOW_WIDTH,
        height: LYRIC_WINDOW_HEIGHT,
      })
    } catch (_) {
      // 置顶浮窗不可用时降级为普通弹窗
    }
  }

  if (!targetWindow) {
    targetWindow = window.open('', LYRIC_WINDOW_NAME, LYRIC_WINDOW_FEATURES)
  }

  if (!targetWindow) throw new Error('popup-blocked')

  lyricWindow = targetWindow
  const targetDocument = targetWindow.document
  if (!targetDocument?.body) throw new Error('window-unavailable')

  // 动态引入的组件样式会在 import 时注入主文档 head，因此先引入再复制样式
  const { default: DesktopLyric } = await import('../components/DesktopLyric.vue')

  prepareDocument(targetDocument)
  copyStyleSheets(targetDocument)
  injectBaseStyle(targetDocument)
  syncDocumentTheme(targetDocument)

  // 直接挂载到歌词窗口的容器：PiP 与主页面共享脚本上下文，同源弹窗也能直接操作其
  // document，组件内的状态与响应式更新都和主窗口共用一套运行时。
  const container = targetDocument.createElement('div')
  container.style.cssText = 'position: relative; width: 100%; height: 100%;'
  targetDocument.body.appendChild(container)

  lyricContainer = container
  lyricApp = createApp(DesktopLyric, { onClose: closeDesktopLyric })
  lyricApp.use(pinia)
  lyricApp.mount(container)

  // 歌词窗口是独立文档，注册为繁体转换的额外根，跟随主窗口的简繁设置
  unregisterTraditionalTextRoot = registerTraditionalTextRoot(targetDocument.body)

  const handleWindowClosed = () => forgetLyricWindow()
  addWindowListener(targetWindow, 'pagehide', handleWindowClosed)
  // 主页面刷新/关闭时不留孤儿窗口（PiP 会随主页面自动关闭）
  addWindowListener(window, 'beforeunload', () => {
    try {
      targetWindow.close()
    } catch (_) {}
  })

  playerStore.isDesktopLyricOpen = true
}

export async function toggleDesktopLyric() {
  if (isDesktopLyricOpen()) {
    closeDesktopLyric()
    return { ok: true, open: false }
  }

  try {
    await openDesktopLyricWindow()
    return { ok: true, open: true }
  } catch (error) {
    closeDesktopLyric()
    return { ok: false, open: false, reason: error?.message || 'failed' }
  }
}

export function closeDesktopLyric() {
  if (!lyricWindow) return

  const targetWindow = lyricWindow
  forgetLyricWindow()
  try {
    targetWindow.close()
  } catch (_) {}
}

// 自定义字体变化时同步到已打开的歌词窗口
export function syncDesktopLyricStyle(cssText) {
  const targetDocument = lyricWindow?.document
  if (!targetDocument?.head) return

  const existingStyle = targetDocument.getElementById(CUSTOM_FONT_STYLE_ID)
  const style = existingStyle || targetDocument.createElement('style')
  style.id = CUSTOM_FONT_STYLE_ID
  style.textContent = toAbsoluteCssUrls(cssText)

  if (!existingStyle) targetDocument.head.appendChild(style)
}