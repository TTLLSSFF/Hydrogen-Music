#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const { version } = require('../../../package.json')
const mode = process.argv[2]
const tasks = { debug: 'assembleDebug', release: 'assembleRelease', bundle: 'bundleRelease' }
if (mode !== 'sync' && !tasks[mode]) {
  throw new Error('Usage: node scripts/build-android.cjs sync|debug|release|bundle')
}

function run(command, args, cwd = root, shell = false) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}

if (mode === 'release' || mode === 'bundle') {
  for (const key of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    if (!process.env[key]) throw new Error(`${key} is required for a signed release (see apps/android/README.md)`)
  }
}

// Standard Capacitor sync regenerates native plugin wiring and removes stale assets.
// Copy the Node runtime afterwards, since sync replaces assets/public entirely.
const runtime = path.join(root, 'mobile-runtime')
const apiPackage = path.join(runtime, 'node_modules/@neteasecloudmusicapienhanced/api/package.json')
if (!fs.existsSync(apiPackage)) throw new Error('Run npm run android:install from the repository root first')
const qqApiPackage = path.join(runtime, 'node_modules/@sansenjian/qq-music-api/dist/index.cjs')
if (!fs.existsSync(qqApiPackage)) throw new Error('Run npm run android:install from the repository root first (QQ music API missing)')
run(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'])
run(process.execPath, [path.join(root, 'node_modules/@capacitor/cli/bin/capacitor'), 'sync', 'android'])

const publicDir = path.join(root, 'android/app/src/main/assets/public')
const runtimeDest = path.join(publicDir, 'nodejs')
fs.mkdirSync(runtimeDest, { recursive: true })
for (const name of ['index.js', 'api-bridge.cjs', 'node20-compat.cjs', 'package.json', 'node_modules']) {
  fs.cpSync(path.join(runtime, name), path.join(runtimeDest, name), { recursive: true, dereference: true })
}
// QQ 音乐 API 服务端保持单一真源：直接拷仓库根 server/qqMusicApi.cjs，不在 mobile-runtime 里放副本
fs.copyFileSync(path.join(root, '../../server/qqMusicApi.cjs'), path.join(runtimeDest, 'qqMusicApi.cjs'))
run(process.execPath, [path.join(root, '../../scripts/patch-ncm-api.cjs'), path.join(runtimeDest, 'node_modules')])
run(process.execPath, [path.join(__dirname, 'patch-path-to-regexp.cjs'), path.join(runtimeDest, 'node_modules')])
const index = path.join(publicDir, 'index.html')
// __HM_QQ_API_BASE__：前端 qqTransport 用它把 QQ 请求打到转发层的 /qq 前缀上
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace(
  '<head>',
  `<head><script>window.__HM_APP__ = true;window.__HM_QQ_API_BASE__ = 'http://127.0.0.1:36531/qq';</script>`
))
if (mode === 'sync') process.exit(0)

const androidDir = path.join(root, 'android')
const windows = process.platform === 'win32'
run(windows ? 'gradlew.bat' : './gradlew', [tasks[mode], '--console=plain', ...process.argv.slice(3)], androidDir, windows)

const bundle = mode === 'bundle'
const variant = mode === 'debug' ? 'debug' : 'release'
const extension = bundle ? 'aab' : 'apk'
const artifact = path.join(androidDir, `app/build/outputs/${bundle ? 'bundle' : 'apk'}/${variant}/app-${variant}.${extension}`)
const output = path.join(root, 'release', version, `Hydrogen.Music-Android-${version}-${variant}.${extension}`)
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.copyFileSync(artifact, output)
console.log(`Android artifact: ${output}`)
