import test from 'node:test'
import assert from 'node:assert/strict'
import qqRequest, { createQQRequestConfig, setQQRequestTransport } from '../src/utils/qqRequest.mjs'

// transport 模块内部缓存「已就绪」，每个用例用带 query 的全新模块实例，避免相互影响
let transportCase = 0
async function installFreshTransport() {
  transportCase += 1
  const mod = await import(`../apps/android/src/utils/qqTransport.mjs?case=${transportCase}`)
  mod.installQQTransport()
}

// 造一个可控的探针环境：window.__HM_QQ_API_BASE__ + XMLHttpRequest（转发层就绪探测）+ fetch
function createRuntime({ probeStatuses = [404] } = {}) {
  const probeCalls = []
  const requests = []
  const statuses = [...probeStatuses]

  globalThis.window = { __HM_QQ_API_BASE__: 'http://127.0.0.1:36531/qq' }
  globalThis.XMLHttpRequest = class {
    constructor() {
      this.status = 0
      this.readyState = 0
      this.onreadystatechange = null
      this.ontimeout = null
      this.onerror = null
    }
    open(method, url) {
      probeCalls.push({ method, url })
    }
    send() {
      const status = statuses.length > 1 ? statuses.shift() : statuses[0]
      this.status = status
      this.readyState = 4
      this.onreadystatechange?.()
    }
  }
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return new Response(JSON.stringify({ isOk: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  return { probeCalls, requests }
}

function cleanupRuntime() {
  setQQRequestTransport(null)
  delete globalThis.window
  delete globalThis.XMLHttpRequest
}

test('安卓 transport：把 QQ 请求打到注入的转发层绝对地址，并先探测就绪', async t => {
  const { probeCalls, requests } = createRuntime()
  t.after(cleanupRuntime)
  await installFreshTransport()
  const result = await qqRequest({ url: '/session/status' })

  assert.deepEqual(result, { isOk: true })
  assert.deepEqual(probeCalls, [{ method: 'GET', url: 'http://127.0.0.1:36531/qq/__hm_ready' }])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://127.0.0.1:36531/qq/session/status')
  assert.equal(requests[0].init.credentials, 'omit')
})

test('安卓 transport：数组参数展开成多个同名 key，POST 走 JSON body', async t => {
  const { requests } = createRuntime()
  t.after(cleanupRuntime)
  await installFreshTransport()
  await qqRequest({ url: '/user/songList', method: 'post', params: { ids: [1, 2] }, data: { dirId: 3 } })

  const [{ url, init }] = requests
  assert.equal(url, 'http://127.0.0.1:36531/qq/user/songList?ids=1&ids=2')
  assert.equal(init.method, 'POST')
  assert.equal(init.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(init.body), { dirId: 3 })
})

test('安卓 transport：转发层未就绪（502）时会重试探测，不直接放弃', async t => {
  const { probeCalls, requests } = createRuntime({ probeStatuses: [502, 502, 404] })
  t.after(cleanupRuntime)
  await installFreshTransport()
  await qqRequest({ url: '/getSearchByKey', params: { key: 'a' } })

  assert.equal(probeCalls.length, 3)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, 'http://127.0.0.1:36531/qq/getSearchByKey?key=a')
})

test('安卓 transport：非 2xx 包装成 response.status 供 qqRequest 归类错误', async t => {
  const { } = createRuntime()
  t.after(cleanupRuntime)
  await installFreshTransport()
  globalThis.fetch = async () => new Response(JSON.stringify({ code: 301, message: '需要登录' }), {
    status: 301,
    headers: { 'content-type': 'application/json' },
  })

  await assert.rejects(
    () => qqRequest({ url: '/user/getUserDetail' }),
    error => {
      assert.equal(error.name, 'QQRequestError')
      assert.equal(error.status, 301)
      return true
    },
  )
})

test('未安装 transport 时回到默认同源 /api/qq 行为（桌面/网页不受影响）', async t => {
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  t.after(() => {
    cleanupRuntime()
    delete globalThis.fetch
  })
  setQQRequestTransport(null)

  await qqRequest({ url: '/session/status' })

  assert.equal(requests[0].url, '/api/qq/session/status')
  // 默认实现不会替换 baseURL，配置仍与既有测试一致
  assert.equal(createQQRequestConfig({ url: '/x' }).baseURL, '/api/qq')
})