const targets = await (await fetch('http://127.0.0.1:9223/json')).json()
const target = targets.find(item => item.url.startsWith('http://localhost/'))
if (!target) throw new Error('Validation WebView not found')
const ws = new WebSocket(target.webSocketDebuggerUrl)
const expression = process.argv[2] || `JSON.stringify({url:location.href,text:document.body.innerText.slice(0,1600),scripts:document.scripts.length})`
const timer = setTimeout(() => { ws.close(); process.exitCode = 1 }, 15000)
ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true, userGesture: true } }))
ws.onmessage = event => {
  const message = JSON.parse(event.data)
  if (message.id !== 1) return
  console.log(JSON.stringify(message.result))
  clearTimeout(timer)
  ws.close()
}
