// 音频播放的浏览器兼容处理，集中两处线上问题：
//
// 1) 跨域音频拿不到频谱：Howler 在 html5 模式下自建 <audio> 且从不设置 crossOrigin，
//    浏览器会把媒体数据判定为「跨域污染」，captureStream() 直接抛
//    "Cannot capture from element with cross-origin data"，音频可视化因此永远没有数据。
//    这里在创建播放实例前给音频元素补上 crossOrigin；各音源 CDN（网易云 / QQ / 塞壬）
//    均返回 Access-Control-Allow-Origin: *，因此不会影响播放。
//
// 2) HTTPS 下的混合内容：部分音源返回的播放地址是 http://，HTTPS 页面加载时会被
//    浏览器升级或拦截（控制台报 insecure audio file）。这里统一升级为 https。
const AUDIO_CROSS_ORIGIN = 'anonymous'

let crossOriginPatched = false

// 必须在任何播放实例（new Howl）创建之前调用，且需早于元素设置 src 的时机
export function ensureAudioCrossOrigin() {
  if (crossOriginPatched || typeof window === 'undefined') return

  const NativeAudio = window.Audio
  if (typeof NativeAudio !== 'function') return

  crossOriginPatched = true

  function AudioWithCrossOrigin(src) {
    const element = new NativeAudio()
    // crossOrigin 必须先于 src 设置，否则媒体数据仍会被判定为跨域污染
    element.crossOrigin = AUDIO_CROSS_ORIGIN
    if (src !== undefined) element.src = src
    return element
  }

  AudioWithCrossOrigin.prototype = NativeAudio.prototype
  Object.setPrototypeOf(AudioWithCrossOrigin, NativeAudio)

  try {
    window.Audio = AudioWithCrossOrigin
  } catch (_) {
    crossOriginPatched = false
  }
}

// 把 http 音频地址升级为 https，避免 HTTPS 页面下的混合内容拦截
export function normalizeAudioUrl(url) {
  const normalized = typeof url === 'string' ? url.trim() : ''
  if (!normalized || !normalized.startsWith('http://')) return normalized
  return `https://${normalized.slice('http://'.length)}`
}