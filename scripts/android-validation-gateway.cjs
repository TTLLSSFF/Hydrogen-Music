// Emulator validation only: reuse existing APIs; do not start or stop them.
const { createWebServer } = require('../web-server.js')
const server = createWebServer({ tls: null })
server.on('error', (error) => {
  console.error(`Validation gateway failed: ${error.code || 'unknown error'}`)
  process.exitCode = 1
})
server.listen(30000, '127.0.0.1', () => {
  console.log('Android validation gateway: http://127.0.0.1:30000 -> emulator http://10.0.2.2:30000')
  console.log('Reusing NetEase :36530 and QQ :3200. Login must be performed by the user.')
})
