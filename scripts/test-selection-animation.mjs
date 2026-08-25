import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
].filter(Boolean)

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
const activeProcesses = new Map()
const activeProfileDirectories = new Set()
let signalCleanupStarted = false

if (typeof WebSocket !== 'function') {
    throw new Error('WebSocket is unavailable. Run this test through npm run test:selection-animation.')
}

function monitorChildProcess(child, label) {
    const lifecycle = { closed: false, stopPromise: null }
    let rejectProcessError
    lifecycle.errorPromise = new Promise((_, reject) => { rejectProcessError = reject })
    //启动成功后仍保留处理器，避免极少见的后续进程错误变成未处理 rejection
    lifecycle.errorPromise.catch(() => {})
    lifecycle.exitPromise = new Promise(resolve => {
        child.once('close', (code, signal) => {
            lifecycle.closed = true
            activeProcesses.delete(child)
            resolve({ code, signal })
        })
    })
    let errorReported = false
    child.on('error', error => {
        if (errorReported) return
        errorReported = true
        rejectProcessError(new Error(`${label} process error: ${error.message}`, { cause: error }))
    })
    activeProcesses.set(child, { label, lifecycle })
    return lifecycle
}

async function stopChildProcess(child, lifecycle, label) {
    if (lifecycle.closed) return
    if (lifecycle.stopPromise) return lifecycle.stopPromise
    lifecycle.stopPromise = (async () => {
        child.kill()
        let exited = await Promise.race([
            lifecycle.exitPromise.then(() => true),
            wait(5000).then(() => false),
        ])
        if (exited) return

        child.kill('SIGKILL')
        exited = await Promise.race([
            lifecycle.exitPromise.then(() => true),
            wait(5000).then(() => false),
        ])
        if (!exited) throw new Error(`${label} did not exit during test cleanup`)
    })()
    return lifecycle.stopPromise
}

async function removeProfileDirectory(profileDirectory) {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    activeProfileDirectories.delete(profileDirectory)
}

async function cleanupActiveResources() {
    const failures = []
    const processResults = await Promise.allSettled(
        Array.from(activeProcesses.entries()).map(([child, { label, lifecycle }]) => stopChildProcess(child, lifecycle, label)),
    )
    failures.push(...processResults.filter(result => result.status === 'rejected').map(result => result.reason))
    const profileResults = await Promise.allSettled(
        Array.from(activeProfileDirectories, profileDirectory => removeProfileDirectory(profileDirectory)),
    )
    failures.push(...profileResults.filter(result => result.status === 'rejected').map(result => result.reason))
    if (failures.length) throw new AggregateError(failures, 'Failed to clean up selection animation test resources')
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => {
        if (signalCleanupStarted) return
        signalCleanupStarted = true
        cleanupActiveResources()
            .catch(error => console.error(error))
            .finally(() => process.exit(exitCode))
    })
}

async function getAvailablePort() {
    const server = net.createServer()
    await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    await new Promise(resolve => server.close(resolve))
    return address.port
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

    send(method, params = {}, sessionId = undefined, timeoutMs = 8000) {
        const id = this.nextId++
        const message = { id, method, params }
        if (sessionId) message.sessionId = sessionId
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
            this.socket.send(JSON.stringify(message))
        })
    }
}

async function evaluate(client, sessionId, expression) {
    const response = await client.send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
    }, sessionId)
    if (response.exceptionDetails) {
        const description = response.exceptionDetails.exception?.description
            || response.exceptionDetails.text
            || 'Runtime evaluation failed'
        throw new Error(description)
    }
    return response.result?.value
}

async function waitForExpression(client, sessionId, expression, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (await evaluate(client, sessionId, expression)) return
        await wait(50)
    }
    throw new Error(`Timed out waiting for expression: ${expression}`)
}

function screenshotDigest(data) {
    return createHash('sha256').update(data, 'base64').digest('hex')
}

async function compareScreenshots(client, sessionId, first, second) {
    return evaluate(client, sessionId, `(async () => {
        const loadPixels = async source => {
            const image = new Image()
            image.src = 'data:image/png;base64,' + source
            await image.decode()
            const canvas = document.createElement('canvas')
            canvas.width = image.naturalWidth
            canvas.height = image.naturalHeight
            const context = canvas.getContext('2d', { willReadFrequently: true })
            context.drawImage(image, 0, 0)
            return {
                width: canvas.width,
                height: canvas.height,
                pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
            }
        }
        const [before, after] = await Promise.all([
            loadPixels(${JSON.stringify(first)}),
            loadPixels(${JSON.stringify(second)}),
        ])
        if (before.width !== after.width || before.height !== after.height) {
            return { sameSize: false, before: [before.width, before.height], after: [after.width, after.height] }
        }
        let differentPixels = 0
        let rightEdgeDifferentPixels = 0
        let visibleDifferentPixels = 0
        let rightEdgeVisibleDifferentPixels = 0
        let maxChannelDelta = 0
        let minX = before.width
        let minY = before.height
        let maxX = -1
        let maxY = -1
        const edgeStart = Math.max(0, before.width - Math.ceil(12 * devicePixelRatio))
        for (let y = 0; y < before.height; y++) {
            for (let x = 0; x < before.width; x++) {
                const offset = (y * before.width + x) * 4
                let pixelDelta = 0
                for (let channel = 0; channel < 4; channel++) {
                    pixelDelta = Math.max(pixelDelta, Math.abs(before.pixels[offset + channel] - after.pixels[offset + channel]))
                }
                if (pixelDelta === 0) continue
                differentPixels++
                if (x >= edgeStart) rightEdgeDifferentPixels++
                if (pixelDelta > 4) {
                    visibleDifferentPixels++
                    if (x >= edgeStart) rightEdgeVisibleDifferentPixels++
                }
                maxChannelDelta = Math.max(maxChannelDelta, pixelDelta)
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x)
                maxY = Math.max(maxY, y)
            }
        }
        return {
            sameSize: true,
            width: before.width,
            height: before.height,
            differentPixels,
            rightEdgeDifferentPixels,
            visibleDifferentPixels,
            rightEdgeVisibleDifferentPixels,
            maxChannelDelta,
            bounds: differentPixels ? { minX, minY, maxX, maxY } : null,
        }
    })()`)
}

async function captureItem(client, sessionId, clip) {
    const response = await client.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
        clip: {
            x: Math.max(0, clip.x - 2),
            y: Math.max(0, clip.y - 2),
            width: clip.width + 4,
            height: clip.height + 4,
            scale: 1,
        },
    }, sessionId)
    return response.data
}

async function runScaleCheck(scaleFactor, appPort, chromePath) {
    const debugPort = await getAvailablePort()
    const profileDirectory = await mkdtemp(path.join(tmpdir(), `hydrogen-selection-${scaleFactor}-`))
    activeProfileDirectories.add(profileDirectory)
    const chrome = spawn(chromePath, [
        '--headless=new',
        '--no-sandbox',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-breakpad',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-gpu-sandbox',
        '--disable-sync',
        '--metrics-recording-only',
        `--force-device-scale-factor=${scaleFactor}`,
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profileDirectory}`,
        '--window-size=1440,1000',
        'about:blank',
    ], {
        cwd: projectDirectory,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
    })
    const chromeLifecycle = monitorChildProcess(chrome, 'Chromium')
    let chromeErrors = ''
    chrome.stderr.on('data', chunk => { chromeErrors += String(chunk) })

    let browserClient = null
    let client = null
    try {
        console.log(`selection hover retraction: ${scaleFactor}x launching Chromium`)
        const versionResponse = await Promise.race([
            waitForUrl(`http://127.0.0.1:${debugPort}/json/version`),
            chromeLifecycle.errorPromise,
        ])
        const version = await versionResponse.json()
        browserClient = await CdpClient.connect(version.webSocketDebuggerUrl)
        console.log(`selection hover retraction: ${scaleFactor}x connected to Chromium`)

        const { targetId } = await browserClient.send('Target.createTarget', { url: 'about:blank' })
        const targetsResponse = await waitForUrl(`http://127.0.0.1:${debugPort}/json/list`)
        const targets = await targetsResponse.json()
        const target = targets.find(candidate => candidate.id === targetId)
        assert.ok(target?.webSocketDebuggerUrl, 'Chrome must expose the created page target')
        client = await CdpClient.connect(target.webSocketDebuggerUrl)
        console.log(`selection hover retraction: ${scaleFactor}x connected to page target`)
        const sessionId = undefined
        await client.send('Page.enable')
        await client.send('Runtime.enable')
        await client.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/#/library` })
        console.log(`selection hover retraction: ${scaleFactor}x mounting LibraryDetail`)
        await waitForExpression(client, sessionId, "document.readyState === 'complete' && !!document.querySelector('#app')")
        await wait(900)

        await evaluate(client, sessionId, `(async () => {
            localStorage.setItem('cookie:MUSIC_U', 'selection-animation-test')
            const [{ useLibraryStore }, { default: pinia }] = await Promise.all([
                import('/src/store/libraryStore.js'),
                import('/src/store/pinia.js'),
            ])
            const store = useLibraryStore(pinia)
            store.$patch({
                libraryInfo: {
                    id: 'selection-animation-test',
                    name: 'Selection animation test',
                    coverImgUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E',
                    creator: { nickname: 'Test' },
                    trackCount: 0,
                    createTime: 0,
                    followed: false,
                },
                librarySongs: [],
                playlistUserCreated: [],
                playlistUserSub: [],
                libraryChangeAnimation: false,
            })
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
            await document.fonts.ready
            return !!document.querySelector('.operation-selection')
        })()`)

        await waitForExpression(client, sessionId, "!!document.querySelector('.operation-selection')")
        await evaluate(client, sessionId, "document.querySelector('.operation-selection').click()")
        await waitForExpression(client, sessionId, "document.querySelector('.selection-menu')?.classList.contains('selection-menu-expanded')")
        await wait(850)
        console.log(`selection hover retraction: ${scaleFactor}x exercising hover-out`)

        const itemCount = await evaluate(client, sessionId, "document.querySelectorAll('.selection-menu-item').length")
        assert.equal(itemCount, 4, 'the real selection menu must expose all four action items')
        const animationContract = await evaluate(client, sessionId, `(() => {
            const style = getComputedStyle(document.querySelector('.selection-menu-item'))
            return {
                backgroundPosition: style.backgroundPosition,
                backgroundRepeat: style.backgroundRepeat,
                transitionProperties: style.transitionProperty.split(',').map(value => value.trim()),
                transitionDurations: style.transitionDuration.split(',').map(value => value.trim()),
                transitionTimingFunction: style.transitionTimingFunction,
            }
        })()`)
        const backgroundTransitionIndex = animationContract.transitionProperties.indexOf('background-size')
        assert.match(animationContract.backgroundPosition, /^(?:left|0%) (?:center|50%)$/, 'the hover background must grow from the left edge')
        assert.equal(animationContract.backgroundRepeat, 'no-repeat', 'the hover background must be a single continuous block')
        assert.notEqual(backgroundTransitionIndex, -1, 'background-size must be animated')
        assert.equal(animationContract.transitionDurations[backgroundTransitionIndex], '0.32s', 'the hover background must keep its 0.32s duration')
        assert.equal(
            animationContract.transitionTimingFunction,
            'ease, cubic-bezier(0.14, 0.91, 0.58, 1)',
            'the hover background must keep its easing curve',
        )

        for (const theme of ['light', 'dark']) {
            await evaluate(client, sessionId, `document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
            //全局主题本身带过渡；先等页面底色和文本色稳定，再建立像素基线
            await wait(650)
            for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
                const geometry = await evaluate(client, sessionId, `(() => {
                    const item = document.querySelectorAll('.selection-menu-item')[${itemIndex}]
                    const rect = item.getBoundingClientRect()
                    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
                })()`)
                assert.ok(geometry.width > 20 && geometry.height > 10, 'the real selection menu item must be laid out')

                const baseline = await captureItem(client, sessionId, geometry)
                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: geometry.x + geometry.width / 2,
                    y: geometry.y + geometry.height / 2,
                }, sessionId)
                await wait(80)
                const transitionProgress = await evaluate(client, sessionId, `(() => {
                    const item = document.querySelectorAll('.selection-menu-item')[${itemIndex}]
                    const width = item.getBoundingClientRect().width
                    const token = getComputedStyle(item).backgroundSize.split(' ')[0]
                    const value = Number.parseFloat(token)
                    return token.endsWith('%') ? value / 100 : value / width
                })()`)
                assert.ok(transitionProgress > 0 && transitionProgress < 1, 'the hover background must visibly progress instead of appearing instantly')
                await wait(320)
                const hovered = await captureItem(client, sessionId, geometry)
                const hoverState = await evaluate(client, sessionId, `(() => {
                    const item = document.querySelectorAll('.selection-menu-item')[${itemIndex}]
                    const style = getComputedStyle(item)
                    return { hovered: item.matches(':hover'), backgroundSize: style.backgroundSize }
                })()`)
                assert.equal(hoverState.hovered, true, 'the pointer must hover the exercised menu item')
                assert.equal(hoverState.backgroundSize, '100% 100%', 'hover must fully reveal the selection background')
                assert.notEqual(screenshotDigest(hovered), screenshotDigest(baseline), `${theme} hover must visibly reveal the selection background`)

                await client.send('Input.dispatchMouseEvent', {
                    type: 'mouseMoved',
                    x: geometry.x + geometry.width / 2,
                    y: Math.max(1, geometry.y - 60),
                }, sessionId)
                await wait(450)
                const retracted = await captureItem(client, sessionId, geometry)
                const state = await evaluate(client, sessionId, `(() => {
                    const menu = document.querySelector('.selection-menu')
                    const item = document.querySelectorAll('.selection-menu-item')[${itemIndex}]
                    const style = getComputedStyle(item)
                    const before = getComputedStyle(item, '::before')
                    return {
                        menuExpanded: menu.classList.contains('selection-menu-expanded'),
                        hovered: item.matches(':hover'),
                        backgroundSize: style.backgroundSize,
                        itemTransform: style.transform,
                        beforeTransform: before.transform,
                    }
                })()`)

                assert.equal(state.menuExpanded, true, 'this regression must exercise hover-out while the menu remains expanded')
                assert.equal(state.hovered, false, 'the pointer must have left the menu item')
                assert.match(state.backgroundSize, /^0(?:px|%) 100%$/, 'the hover background must fully retract')
                assert.equal(
                    state.itemTransform,
                    'none',
                    `the settled menu item must release its entrance transform layer in ${theme} mode at ${scaleFactor}x`,
                )
                assert.equal(
                    state.beforeTransform,
                    'none',
                    `the retracted background must not retain a transformed compositor layer in ${theme} mode at ${scaleFactor}x`,
                )
                const screenshotDiff = await compareScreenshots(client, sessionId, baseline, retracted)
                console.log(`selection hover retraction: ${scaleFactor}x ${theme} item ${itemIndex + 1} screenshot diff ${JSON.stringify(screenshotDiff)}`)
                assert.equal(screenshotDiff.sameSize, true, 'the compared item screenshots must have equal dimensions')
                assert.ok(screenshotDiff.maxChannelDelta <= 4, `${theme} screenshot noise must stay below the visible threshold at ${scaleFactor}x`)
                assert.equal(screenshotDiff.visibleDifferentPixels, 0, `the item must return to its ${theme} pre-hover appearance at ${scaleFactor}x`)
                assert.equal(screenshotDiff.rightEdgeVisibleDifferentPixels, 0, `the item right edge must not retain a visible ${theme} background pixel at ${scaleFactor}x`)
            }
        }

        await evaluate(client, sessionId, "document.querySelector('.operation-download-select button:last-child').click()")
        await wait(100)
        const delayedExitState = await evaluate(client, sessionId, `(() => {
            const firstItem = document.querySelector('.selection-menu-item')
            const selection = document.querySelector('.operation-selection')
            return {
                menuExpanded: document.querySelector('.selection-menu').classList.contains('selection-menu-expanded'),
                firstItemOpacity: Number(getComputedStyle(firstItem).opacity),
                selectionOpacity: Number(getComputedStyle(selection).opacity),
            }
        })()`)
        assert.equal(delayedExitState.menuExpanded, false, 'cancel must begin closing the menu')
        assert.ok(delayedExitState.firstItemOpacity > 0.95, 'the delayed first item must stay visible instead of flashing before its exit starts')
        assert.equal(delayedExitState.selectionOpacity, 0, 'the selection button must remain hidden while menu items exit')

        await wait(420)
        const hiddenExitState = await evaluate(client, sessionId, `(() => {
            const menu = document.querySelector('.selection-menu')
            const selection = document.querySelector('.operation-selection')
            return {
                itemOpacities: Array.from(menu.children).map(item => Number(getComputedStyle(item).opacity)),
                menuOpacity: Number(getComputedStyle(menu).opacity),
                selectionOpacity: Number(getComputedStyle(selection).opacity),
                backgroundsRemoved: Array.from(document.querySelectorAll('.selection-menu-item')).every(item => getComputedStyle(item).backgroundImage === 'none'),
            }
        })()`)
        assert.ok(hiddenExitState.itemOpacities.every(opacity => opacity === 0), 'all menu items must finish fading before the selection button returns')
        assert.equal(hiddenExitState.menuOpacity, 0, 'the collapsed menu must be transparent after its items exit')
        assert.equal(hiddenExitState.selectionOpacity, 0, 'the selection button delay must outlast the menu exit')
        assert.equal(hiddenExitState.backgroundsRemoved, true, 'closing the menu must remove every hover background paint')

        await wait(330)
        const settledExitState = await evaluate(client, sessionId, `(() => {
            const menu = document.querySelector('.selection-menu')
            const selection = document.querySelector('.operation-selection')
            return {
                menuWidth: menu.getBoundingClientRect().width,
                selectionWidth: selection.getBoundingClientRect().width,
                selectionOpacity: Number(getComputedStyle(selection).opacity),
            }
        })()`)
        assert.ok(settledExitState.menuWidth < 0.5, 'the menu must fully collapse after its exit animation')
        assert.ok(settledExitState.selectionWidth > 20, 'the selection button must reclaim its layout space after the menu collapses')
        assert.ok(settledExitState.selectionOpacity > 0.99, 'the selection button must be fully visible after the close sequence')
    } catch (error) {
        if (chromeErrors) error.message += `\nChrome output:\n${chromeErrors}`
        throw error
    } finally {
        if (client) client.close()
        if (browserClient) {
            try { await browserClient.send('Browser.close', {}, undefined, 1500) } catch (_) {}
            browserClient.close()
        }
        try {
            await stopChildProcess(chrome, chromeLifecycle, 'Chromium')
        } finally {
            await removeProfileDirectory(profileDirectory)
        }
    }
}

const appPort = await getAvailablePort()
const chromePath = await resolveChromePath()
const vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(appPort), '--strictPort'], {
    cwd: projectDirectory,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
})
const viteLifecycle = monitorChildProcess(vite, 'Vite')
let viteOutput = ''
vite.stdout.on('data', chunk => { viteOutput += String(chunk) })
vite.stderr.on('data', chunk => { viteOutput += String(chunk) })

try {
    await Promise.race([
        waitForUrl(`http://127.0.0.1:${appPort}/`),
        viteLifecycle.errorPromise,
    ])
    for (const scaleFactor of [1.25, 1.5]) {
        await runScaleCheck(scaleFactor, appPort, chromePath)
        console.log(`selection hover retraction: ${scaleFactor}x passed`)
    }
} catch (error) {
    if (viteOutput) error.message += `\nVite output:\n${viteOutput}`
    console.error(error)
    process.exitCode = 1
} finally {
    await stopChildProcess(vite, viteLifecycle, 'Vite')
}
