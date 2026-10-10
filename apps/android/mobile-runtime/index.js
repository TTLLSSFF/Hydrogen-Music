/**
 * App 内嵌的 Node 运行时入口
 *
 * 启动三件事：
 *   1. 内置增强版网易云 API（127.0.0.1:36530）—— 与桌面端复用同一套实现
 *   2. QQ 音乐 API（127.0.0.1:36532）—— 与桌面/网页端共用 server/qqMusicApi.cjs
 *   3. 一层带 CORS 的转发服务（127.0.0.1:36531），按 /qq 前缀分流到上面两个后端
 *
 * 为什么需要转发层：
 * App 内前端由 WebView 以 http://localhost 提供，而 Node 服务在另一个端口，
 * 浏览器按跨域处理。上游 API 本身不带 CORS 头，且它返回 app 时已经 listen 完成，
 * 没法再往路由链前面挂中间件，所以单独加一层转发最省事也最可控。
 */
const os = require('os')
const fs = require('fs')
const path = require('path')

/**
 * 修正临时目录（必须在加载 API 之前执行）
 *
 * Android 上没有可写的 /tmp，而内置网易云 API 会把 anonymous_token、
 * xeapi_public_key 等文件写到 os.tmpdir() 下，于是启动即失败：
 *   EACCES: permission denied, open '/tmp/anonymous_token'
 *
 * 插件虽然通过 setenv 设了 TMPDIR，但实测 os.tmpdir() 仍返回 /tmp，
 * 所以这里直接把 os.tmpdir() 改写到一个确认可写的目录。
 * 最可靠的可写位置是插件内置 bridge 模块的 datadir()。
 */
function isWritableDir(dir) {
  try {
    if (!dir) return false
    fs.mkdirSync(dir, { recursive: true })
    const probe = path.join(dir, '.hm_writable_probe')
    fs.writeFileSync(probe, 'ok')
    fs.unlinkSync(probe)
    return true
  } catch (_) {
    return false
  }
}

let BRIDGE_DATA_DIR = null
try {
  BRIDGE_DATA_DIR = require('bridge').app.datadir()
} catch (_) { }

const TMP_DIR = [
  BRIDGE_DATA_DIR,
  process.env.TMPDIR,
  process.env.TMP,
  process.env.TEMP,
  process.env.HOME,
].find(isWritableDir) || null

console.log(
  `[node][diag] os.tmpdir()=${os.tmpdir()} | TMPDIR=${process.env.TMPDIR || '(未设置)'} ` +
  `| cwd=${process.cwd()} | bridge.datadir=${BRIDGE_DATA_DIR || 'N/A'}`
)
if (TMP_DIR) {
  process.env.TMPDIR = TMP_DIR
  process.env.TMP = TMP_DIR
  process.env.TEMP = TMP_DIR
  os.tmpdir = () => TMP_DIR
  console.log(`[node] 临时目录已指向: ${TMP_DIR}`)
} else {
  console.error('[node] 未找到可写临时目录，网易云 API 很可能启动失败')
}

const { createApiBridge } = require('./api-bridge.cjs')

const NCM_PORT = Number(process.env.HM_NCM_PORT || 36530)
const BRIDGE_PORT = Number(process.env.HM_BRIDGE_PORT || 36531)
const QQ_PORT = Number(process.env.HM_QQ_PORT || 36532)

// QQ API 的会话目录必须在 require 之前设好：@sansenjian/qq-music-api 在模块加载时
// 就会算出它的 cookie 存储路径，默认会落到 APK 只读的 assets 目录。
// 这里指向 bridge 提供的可写私有目录（与 os.tmpdir() 改写用的是同一处）。
process.env.QQ_API_PORT = String(QQ_PORT)
if (!process.env.QQ_MUSIC_API_CONFIG_DIR && TMP_DIR) {
  process.env.QQ_MUSIC_API_CONFIG_DIR = path.join(TMP_DIR, 'qq-music-session')
}

function startBridge() {
  const server = createApiBridge(NCM_PORT, QQ_PORT)

  server.on('error', error => {
    console.error('[node] 转发层启动失败:', error && error.message)
  })

  server.listen(BRIDGE_PORT, '127.0.0.1', () => {
    console.log(`[node] 转发层已就绪: http://127.0.0.1:${BRIDGE_PORT}`)
  })
}

/**
 * 生成网易云 API 需要的初始配置（必须在启动 API 之前）。
 *
 * 对齐官方入口 app.js 的启动流程：先确保 anonymous_token 文件存在，
 * 再跑 generateConfig() 拉取真实匿名 token 与 xeapi 公钥。
 *
 * 不做这一步的后果：/song/url/v1 等走 xeapi 加密的接口会抛
 *   "xeapi public key is missing"
 * 表现为能进 App、歌单能加载，但歌曲点开拿不到播放地址。
 */
async function prepareNcmConfig() {
  try {
    const tokenPath = path.join(os.tmpdir(), 'anonymous_token')
    if (!fs.existsSync(tokenPath)) {
      fs.writeFileSync(tokenPath, '', 'utf-8')
    }
    // API 4.35.1 registers the anonymous session before refreshing its xeapi key.
    // On a fresh install that registration itself requires the missing key.
    const keyPath = path.join(os.tmpdir(), 'xeapi_public_key')
    if (!fs.existsSync(keyPath)) {
      const { getXeapiPublicKey } = require('@neteasecloudmusicapienhanced/api/util/xeapiKey')
      const { generateDeviceId } = require('@neteasecloudmusicapienhanced/api/util/index')
      global.deviceId = generateDeviceId()
      const publicKey = await getXeapiPublicKey({}, global.deviceId)
      fs.writeFileSync(keyPath, JSON.stringify(publicKey), 'utf-8')
    }
    const generateConfig = require('@neteasecloudmusicapienhanced/api/generateConfig')
    await generateConfig()
    console.log('[node] 网易云配置已就绪（anonymous_token / xeapi_public_key）')
  } catch (error) {
    console.error('[node] 生成网易云配置失败:', error && error.message)
  }
}

async function startNcmApi() {
  try {
    const enhancedApi = require('@neteasecloudmusicapienhanced/api')
    if (!enhancedApi || typeof enhancedApi.serveNcmApi !== 'function') {
      throw new Error('serveNcmApi 不可用')
    }
    await enhancedApi.serveNcmApi({ checkVersion: false, port: NCM_PORT, host: '127.0.0.1' })
    console.log(`[node] 网易云 API 已就绪: http://127.0.0.1:${NCM_PORT}`)
    return true
  } catch (error) {
    console.error('[node] 网易云 API 启动失败:', error && error.message)
    return false
  }
}

/**
 * 启动 QQ 音乐 API（与桌面端共用 server/qqMusicApi.cjs）。
 *
 * 与桌面端 qqApiService 一样：加载/启动失败只记日志，绝不让整个运行时崩掉——
 * 网易云、塞壬、本地音乐都还等着这个进程活着。
 */
async function startQQApi() {
  try {
    // 打包后由 build-android.cjs 拷到运行时目录；开发模式（npm run android:api）直接引用仓库根的单一真源
    const qqApiPath = [
      path.join(__dirname, 'qqMusicApi.cjs'),
      path.join(__dirname, '..', '..', '..', 'server', 'qqMusicApi.cjs'),
    ].find(candidate => fs.existsSync(candidate))
    if (!qqApiPath) throw new Error('qqMusicApi.cjs 未找到')

    const { startQQMusicApi } = require(qqApiPath)
    if (typeof startQQMusicApi !== 'function') throw new Error('startQQMusicApi 不可用')
    await startQQMusicApi(QQ_PORT)
    console.log(`[node] QQ 音乐 API 已就绪: http://127.0.0.1:${QQ_PORT}`)
    return true
  } catch (error) {
    console.error('[node] QQ 音乐 API 启动失败:', error && error.message)
    return false
  }
}

async function main() {
  console.log(`[node] 运行时启动中 (node ${process.version})`)
  // 必须先跑配置生成，否则 xeapi 加密的接口（如 /song/url/v1）拿不到播放地址
  await prepareNcmConfig()
  // QQ 与网易云并行启动：QQ 要多 require 一棵依赖树，await 会把冷启动拖长
  const qqReady = startQQApi()
  await startNcmApi()
  // 即使上游起不来也把转发层拉起来，前端能收到明确的错误响应而不是连接失败
  startBridge()
  await qqReady
}

main().catch(error => {
  console.error('[node] 启动异常:', error && error.message)
})
