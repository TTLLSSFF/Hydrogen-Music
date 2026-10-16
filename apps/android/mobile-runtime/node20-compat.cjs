/**
 * 真机内嵌运行时的 Node 20 兼容层。
 *
 * 背景（2026-10-16 真机闪退根因）：
 * Capacitor Node.js 插件内置的是 nodejs-mobile 18.20.4（见
 * node_modules/@capawesome/capacitor-nodejs/android/build.gradle 的
 * nodejsMobileVersion），而随 APK 打包的 QQ 依赖树是按 Node 20+ 构建的：
 *   · @sansenjian/qq-music-api 的日志着色走 util.styleText（Node 20.12+）
 *   · @koa/router@15.7.0 的 _setMatchedRouteInfo 走 Array#toReversed（Node 20+，
 *     其 package.json 的 engines 也写着 >=20）
 * 一旦 QQ 请求失败，koa 的 onerror 会调用 colors.error → util.styleText，
 * 在 Node 18 上抛 TypeError: (0 , node_util.styleText) is not a function。
 * 该异常发生在 koa 错误处理内部而没有旁路，内嵌 Node 与 App 同进程
 * （Nodejs.java 用 System.loadLibrary("node") 起在同一进程），于是整个 Node
 * 进程退出、App 立即闪退——QQ 登录后才会走到这些路由，所以表现为「登录闪退」。
 *
 * 这里在加载任何 API 依赖之前补上缺失的 API（已存在则完全不动），
 * 让真机上的行为与宿主 Node 24 一致。宿主 Node 24 与真机 Node 18 的
 * 对照复现记录见 apps/android/README.md。
 */

function installStyleText() {
  const util = require('node:util')
  if (typeof util.styleText === 'function') return false
  // Node 20.12+ 的 styleText 只在 TTY 上着色，非 TTY 原样返回文本；
  // 这里保留同样的默认语义，避免把 ANSI 序列写进 Android 日志。
  const styleText = (format, text) => String(text)
  try {
    Object.defineProperty(util, 'styleText', {
      value: styleText,
      writable: true,
      enumerable: true,
      configurable: true,
    })
  } catch (_) {
    util.styleText = styleText
  }
  return true
}

function installToReversed() {
  if (typeof Array.prototype.toReversed === 'function') return false
  Object.defineProperty(Array.prototype, 'toReversed', {
    // 与规范一致：返回副本，不改动原数组。
    value: function toReversed() {
      return Array.prototype.slice.call(this).reverse()
    },
    writable: true,
    enumerable: false,
    configurable: true,
  })
  return true
}

function installAbortSignalAny() {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.any === 'function') return false
  const any = signals => {
    const list = Array.from(signals || [])
    const controller = new AbortController()
    const abort = signal => controller.abort(signal && signal.reason)
    for (const signal of list) {
      if (!signal) continue
      if (signal.aborted) { abort(signal); break }
    }
    if (!controller.signal.aborted) {
      for (const signal of list) {
        if (signal && typeof signal.addEventListener === 'function') {
          signal.addEventListener('abort', () => abort(signal), { once: true })
        }
      }
    }
    return controller.signal
  }
  try {
    Object.defineProperty(AbortSignal, 'any', { value: any, writable: true, enumerable: false, configurable: true })
  } catch (_) {
    AbortSignal.any = any
  }
  return true
}

function install() {
  const installed = []
  if (installStyleText()) installed.push('util.styleText')
  if (installToReversed()) installed.push('Array.prototype.toReversed')
  if (installAbortSignalAny()) installed.push('AbortSignal.any')
  return installed
}

module.exports = { install }
