// 必须最先执行：在浏览器/手机环境下补齐 windowApi 等 Electron 注入对象，
// 否则后续组件里任何一处裸调用都会导致白屏。
import './utils/webBridge'
// QQ 请求走内嵌转发层的绝对地址（必须在任何 QQ 请求之前安装）
import { installQQTransport } from './utils/qqTransport.mjs'
import { createApp } from 'vue'
import { installLogSanitizer } from './utils/logSanitizer'
import App from './App.vue'
import router from './router/router.js'
import pinia from './store/pinia'
import lazy from './utils/lazy'
import './assets/css/style.css'
import './assets/css/reset.css'
import './assets/css/common.css'
import '@shared-assets/css/fonts.css'
import './assets/css/theme.css'
import './assets/css/mobile.css'
import { initTheme } from './utils/theme'
import { init } from './utils/initApp'

installLogSanitizer()
installQQTransport()

const app = createApp(App)
app.use(router)
app.use(pinia)
app.directive('lazy', lazy)
// Initialize theme before app renders
initTheme()
app.mount('#app')

void init().catch(() => {})

// Prevent default browser file open on drag/drop globally
window.addEventListener('dragover', (e) => {
  e.preventDefault()
})
window.addEventListener('drop', (e) => {
  e.preventDefault()
})
