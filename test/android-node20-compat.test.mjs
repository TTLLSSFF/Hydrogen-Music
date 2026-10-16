import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const compatPath = fileURLToPath(new URL('../apps/android/mobile-runtime/node20-compat.cjs', import.meta.url))
const runtimeEntryPath = fileURLToPath(new URL('../apps/android/mobile-runtime/index.js', import.meta.url))
const buildScriptPath = fileURLToPath(new URL('../apps/android/scripts/build-android.cjs', import.meta.url))

// The device runtime is nodejs-mobile 18.20.4, while the bundled QQ stack targets
// Node 20+: util.styleText arrived in 20.12, Array#toReversed in 20.0. Without them
// the QQ stack throws from koa's error handler on any failed request, and because
// the embedded Node shares the app process that uncaught error exits(1) — the app
// crashes right after QQ login.
function withMissingNode20Apis(run) {
  const util = require('node:util')
  const styleTextDescriptor = Object.getOwnPropertyDescriptor(util, 'styleText')
  const toReversedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, 'toReversed')
  const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any')

  delete util.styleText
  delete Array.prototype.toReversed
  delete AbortSignal.any
  try {
    return run()
  } finally {
    const restore = (target, name, descriptor) => {
      if (descriptor) Object.defineProperty(target, name, descriptor)
      else delete target[name]
    }
    restore(util, 'styleText', styleTextDescriptor)
    restore(Array.prototype, 'toReversed', toReversedDescriptor)
    restore(AbortSignal, 'any', anyDescriptor)
  }
}

test('compat restores the Node 20 APIs the QQ stack needs on the device runtime', () => {
  withMissingNode20Apis(() => {
    assert.equal(require('node:util').styleText, undefined)
    assert.equal([].toReversed, undefined)
    assert.equal(AbortSignal.any, undefined)

    require(compatPath).install()

    const { styleText } = require('node:util')
    assert.equal(typeof styleText, 'function')
    assert.match(String(styleText('red', 'boom')), /boom/)

    // 规范语义：返回副本，不改动原数组。
    const source = [1, 2, 3]
    assert.deepEqual(source.toReversed(), [3, 2, 1])
    assert.deepEqual(source, [1, 2, 3])

    // AbortSignal.any：任一路由 abort 时合并信号 abort，未 abort 时保持。
    const c1 = new AbortController()
    const c2 = new AbortController()
    const merged = AbortSignal.any([c1.signal, c2.signal])
    assert.equal(merged.aborted, false)
    c1.abort()
    assert.equal(merged.aborted, true)
  })
})

test('compat never replaces an existing implementation', () => {
  const util = require('node:util')
  const before = {
    styleText: util.styleText,
    toReversed: Array.prototype.toReversed,
    any: AbortSignal.any,
  }
  const installed = require(compatPath).install()

  // 原生已提供时保持原样、且不算作「本次安装」；缺失时才补上。
  const expectations = [
    ['util.styleText', before.styleText, util.styleText],
    ['Array.prototype.toReversed', before.toReversed, Array.prototype.toReversed],
    ['AbortSignal.any', before.any, AbortSignal.any],
  ]
  for (const [name, original, current] of expectations) {
    if (typeof original === 'function') {
      assert.equal(current, original, `${name} must be kept when it already exists`)
      assert.ok(!installed.includes(name), `${name} must not be reported as installed`)
    } else {
      assert.equal(typeof current, 'function', `${name} must be installed when missing`)
      assert.ok(installed.includes(name), `${name} must be reported as installed`)
    }
  }
})

test('the embedded runtime installs compat before it loads the API stack', () => {
  const source = readFileSync(runtimeEntryPath, 'utf8')
  const installAt = source.indexOf("require('./node20-compat.cjs').install()")
  assert.ok(installAt >= 0, 'the runtime entry must install the Node 20 compatibility layer')

  // 真正的加载点（不是文件头注释里的说明文字）。
  for (const later of ["require('./api-bridge.cjs')", "main().catch("]) {
    const at = source.indexOf(later)
    assert.ok(at >= 0, `expected to find ${later} in the runtime entry`)
    assert.ok(installAt < at, `compat must be installed before ${later}`)
  }
})

test('the Android build ships the compatibility layer into the APK runtime', () => {
  const source = readFileSync(buildScriptPath, 'utf8')
  assert.match(source, /'index\.js', 'api-bridge\.cjs', 'node20-compat\.cjs'/, 'build-android.cjs must copy node20-compat.cjs into assets/public/nodejs')
})
