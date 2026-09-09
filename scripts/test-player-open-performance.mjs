import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectDirectory = path.resolve(scriptDirectory, '..')
const viteEntry = path.join(projectDirectory, 'node_modules', 'vite', 'bin', 'vite.js')
const chromeCandidates = [
  process.env.CHROME_PATH,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

if (typeof WebSocket !== 'function') {
  throw new Error('WebSocket is unavailable. Run this script through npm with --experimental-websocket.')
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function getAvailablePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  await new Promise(resolve => server.close(resolve))
  return port
}

async function waitForUrl(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return response
    } catch (error) {
      lastError = error
    }
    await wait(80)
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function resolveChromePath() {
  const { access } = await import('node:fs/promises')
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate)
      return candidate
    } catch (_) {}
  }
  throw new Error('Chrome or Edge was not found. Set CHROME_PATH to a Chromium executable.')
}

class CdpClient {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
      else pending.resolve(message.result || {})
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('Chrome DevTools connection closed'))
      this.pending.clear()
    })
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    })
    return new CdpClient(socket)
  }

  close() {
    this.socket.close()
  }

  send(method, params = {}, timeoutMs = 8000) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      this.pending.set(id, {
        method,
        resolve: value => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: error => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  })
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime evaluation failed')
  }
  return response.result?.value
}

async function waitForExpression(client, expression, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await evaluate(client, expression)) return
    await wait(50)
  }
  throw new Error(`Timed out waiting for expression: ${expression}`)
}

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([
    new Promise(resolve => child.once('close', resolve)),
    wait(5000),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

const appPort = await getAvailablePort()
const debugPort = await getAvailablePort()
const chromePath = await resolveChromePath()
const profileDirectory = await mkdtemp(path.join(tmpdir(), 'hydrogen-player-open-'))
let vite = null
let chrome = null
let browserClient = null
let client = null

try {
  vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
    cwd: projectDirectory,
    stdio: 'ignore',
    windowsHide: true,
  })
  await waitForUrl(`http://127.0.0.1:${appPort}/`)

  chrome = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-sync',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    '--window-size=1440,1000',
    'about:blank',
  ], { cwd: projectDirectory, stdio: 'ignore', windowsHide: true })

  const version = await (await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`)).json()
  browserClient = await CdpClient.connect(version.webSocketDebuggerUrl)
  const { targetId } = await browserClient.send('Target.createTarget', { url: 'about:blank' })
  const targets = await (await waitForUrl(`http://127.0.0.1:${debugPort}/json/list`)).json()
  const target = targets.find(candidate => candidate.id === targetId)
  client = await CdpClient.connect(target.webSocketDebuggerUrl)
  await client.send('Page.enable')
  await client.send('Runtime.enable')
  await client.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/#/library` })
  await waitForExpression(client, "document.readyState === 'complete' && !!document.querySelector('#app')?.__vue_app__")

  await evaluate(client, `(async () => {
    const app = document.querySelector('#app').__vue_app__
    const pinia = app._context.provides.pinia
    const [{ usePlayerStore }, { nextTick }] = await Promise.all([
      import('/src/store/playerStore.js'),
      import('/node_modules/vue/dist/vue.esm-browser.js'),
    ])
    const store = usePlayerStore(pinia)
    store.$patch({
      widgetState: true,
      playlistWidgetShow: false,
      lyricShow: false,
      songId: 'perf-0',
      currentIndex: 0,
      songList: Array.from({ length: 5000 }, (_, index) => ({
        id: 'perf-' + index,
        name: 'Performance Song ' + index,
        source: 'netease',
        ar: [{ id: 'artist-' + index, name: 'Artist ' + index }],
      })),
    })
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 700))
    store.playlistWidgetShow = true
    await nextTick()
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return {
      widgetLists: document.querySelectorAll('.musicWidget .playlist-widget').length,
      playerLists: document.querySelectorAll('.musicPlayer .playlist-widget-player').length,
    }
  })()`)

  await waitForExpression(client, "document.querySelectorAll('.musicWidget .playlist-widget').length === 1")
  const result = await evaluate(client, `(async () => {
    const samples = []
    const performanceObserver = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) samples.push({ start: entry.startTime, duration: entry.duration })
    })
    performanceObserver.observe({ type: 'longtask', buffered: true })
    await new Promise(resolve => setTimeout(resolve, 100))
    samples.length = 0
    const startedAt = performance.now()
    let firstFrameDelay = 0
    let recording = true
    const sample = now => {
      if (!firstFrameDelay) firstFrameDelay = now - startedAt
      if (recording) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    document.querySelector('.musicWidget .music-img').click()
    await new Promise(resolve => setTimeout(resolve, 1050))
    recording = false
    performanceObserver.disconnect()
    const surfaceState = {
      widgetLists: document.querySelectorAll('.musicWidget .playlist-widget').length,
      playerLists: document.querySelectorAll('.musicPlayer .playlist-widget-player').length,
      rows: document.querySelectorAll('.vue-recycle-scroller__item-view').length,
    }
    return { firstFrameDelay, longTasks: samples.filter(entry => entry.start >= startedAt).map(entry => entry.duration), surfaceState }
  })()`)

  assert.equal(result.surfaceState.widgetLists, 0, 'opening the full player must unmount the hidden widget queue scroller')
  assert.equal(result.surfaceState.playerLists, 1, 'opening the full player must retain exactly one visible queue scroller')
  assert.ok(result.surfaceState.rows < 100, 'the queue must remain virtualized')
  assert.ok(result.firstFrameDelay < 500, `opening a 5,000-song queue must reach its first animation frame quickly, received ${result.firstFrameDelay.toFixed(1)}ms`)
  assert.ok(result.longTasks.length <= 1, `opening a 5,000-song queue must avoid competing long tasks, received ${JSON.stringify(result.longTasks)}`)
  console.log(`player open performance: first frame ${result.firstFrameDelay.toFixed(1)}ms; long tasks ${JSON.stringify(result.longTasks.map(value => Number(value.toFixed(1))))}; surfaces ${JSON.stringify(result.surfaceState)}`)
} finally {
  client?.close()
  if (browserClient) {
    try { await browserClient.send('Browser.close', {}, 1500) } catch (_) {}
    browserClient.close()
  }
  await stop(chrome)
  await stop(vite)
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
