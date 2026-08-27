import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bridgePath = path.join(projectRoot, 'server', 'qqMusicApi.cjs')

function captureConfigDirAtPackageLoad(initialConfigDir) {
  const script = `
    const Module = require('node:module')
    const originalLoad = Module._load
    let capturedConfigDir
    ${initialConfigDir === undefined
      ? "delete process.env.QQ_MUSIC_API_CONFIG_DIR"
      : `process.env.QQ_MUSIC_API_CONFIG_DIR = ${JSON.stringify(initialConfigDir)}`}
    Module._load = function (request, parent, isMain) {
      if (request === '@sansenjian/qq-music-api') {
        capturedConfigDir = process.env.QQ_MUSIC_API_CONFIG_DIR
        return { middleware: [], listen() { throw new Error('not used') } }
      }
      if (request === '@sansenjian/qq-music-api/services') return {}
      return originalLoad.call(this, request, parent, isMain)
    }
    require(${JSON.stringify(bridgePath)})
    process.stdout.write(JSON.stringify(capturedConfigDir))
  `

  return JSON.parse(execFileSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
  }))
}

test('QQ server selects its ignored server-only session directory before loading the package', () => {
  assert.equal(
    captureConfigDirAtPackageLoad(),
    path.join(projectRoot, '.qq-music-session'),
  )
})

test('QQ server preserves an explicitly configured server-only session directory', () => {
  const configured = path.join(projectRoot, '.test-only-qq-session')
  assert.equal(captureConfigDirAtPackageLoad(configured), configured)
})
