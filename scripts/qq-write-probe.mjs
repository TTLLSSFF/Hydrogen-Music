// QQ 音乐写操作探针（手动运行，不属于 npm test）
//
// 用途：时间盒验证旧版未签名的 `musicu.fcg` / `music.musicasset.PlaylistDetailWrite`
// 在真实 QQ 登录态下是否仍然可用。通过才考虑接线 UI，失败即保留现有「暂不支持」降级。
//
// 用法：
//   node scripts/qq-write-probe.mjs like <songmid>
//   node scripts/qq-write-probe.mjs like <songmid> del
//   node scripts/qq-write-probe.mjs add <dirId> <songmid>
//   node scripts/qq-write-probe.mjs del <dirId> <songmid>
//
// 会话令牌：
//   浏览器端由 localStorage 的 `qqAccountStore.sessionToken` 提供，Node 无 localStorage，
//   因此这里通过环境变量 `QQ_SESSION_TOKEN` 传入，并作为 `X-QQ-Music-Session` 请求头发送。
//   取值方式：DevTools → Application → Local Storage → qqAccountStore → sessionToken。
//
// 服务端地址：
//   默认 `http://127.0.0.1:3200`（`web-server.js` 内部拉起的 QQ API），可用 `QQ_API_BASE` 覆盖。
//   写探针默认关闭，必须先以 `QQ_WRITE_SPIKE=1` 启动：`QQ_WRITE_SPIKE=1 npm run serve`。
//
// 验证方式：写操作前后各拉一次 `/user/getUserLikedSongs`，对比 songmid 集合差异。
//
// 注意：探针 payload 形状（v_songInfo）与是否需要签名均**未经验证**，失败属预期结果之一。

const DEFAULT_BASE_URL = 'http://127.0.0.1:3200'
// QQ 音乐「我喜欢」是 dirId 固定为 201 的特殊歌单。
const LIKE_DIR_ID = 201
const LIKED_PAGE_SIZE = 100
const LIKED_MAX_PAGES = 20
const REQUEST_TIMEOUT_MS = 15000
const SONGMID_PATTERN = /^[A-Za-z0-9]{8,20}$/

const baseUrl = String(process.env.QQ_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, '')
const sessionToken = String(process.env.QQ_SESSION_TOKEN || '').trim()

function printUsage() {
  console.error([
    '用法：',
    '  node scripts/qq-write-probe.mjs like <songmid>',
    '  node scripts/qq-write-probe.mjs like <songmid> del',
    '  node scripts/qq-write-probe.mjs add <dirId> <songmid>',
    '  node scripts/qq-write-probe.mjs del <dirId> <songmid>',
  ].join('\n'))
}

function parseProbePlan(argv) {
  const [command, ...rest] = argv
  if (command === 'like') {
    const [songmid, ...flags] = rest
    if (!songmid) return null
    const isRemove = flags.includes('del')
    return {
      path: '/user/likeSong',
      songmid,
      dirId: LIKE_DIR_ID,
      op: isRemove ? 'del' : 'add',
    }
  }
  if (command === 'add' || command === 'del') {
    const [dirId, songmid] = rest
    if (!dirId || !songmid) return null
    return {
      path: command === 'add' ? '/user/addSonglist' : '/user/delSonglist',
      songmid,
      dirId: Number(dirId),
      op: command === 'add' ? 'add' : 'del',
    }
  }
  return null
}

async function requestJson(path, { method = 'GET', body } = {}) {
  const headers = {}
  if (sessionToken) headers['X-QQ-Music-Session'] = sessionToken
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let data = text
  try {
    data = text ? JSON.parse(text) : null
  } catch (_) {}
  return { status: response.status, data }
}

// 从任意层级的 payload 中收集歌曲标识（songmid / songMid，或带歌名的 mid）。
function collectSongmids(payload, found = new Set(), depth = 0, seen = new Set()) {
  if (depth > 12 || payload == null || typeof payload !== 'object' || seen.has(payload)) return found
  if (Array.isArray(payload)) {
    for (const item of payload) collectSongmids(item, found, depth + 1, seen)
    return found
  }

  seen.add(payload)
  const direct = payload.songmid ?? payload.songMid
  const fallbackMid = payload.mid
  const hasName = Boolean(payload.songname || payload.songName || payload.name || payload.title)
  const isSongLike = direct !== undefined || (fallbackMid !== undefined && hasName)
  const candidate = direct !== undefined ? direct : (isSongLike ? fallbackMid : undefined)
  if (candidate !== undefined && candidate !== null && candidate !== '') found.add(String(candidate))

  for (const key of Object.keys(payload)) {
    const value = payload[key]
    if (value && typeof value === 'object') collectSongmids(value, found, depth + 1, seen)
  }
  seen.delete(payload)
  return found
}

async function fetchLikedSongmids() {
  const all = new Set()
  for (let page = 0; page < LIKED_MAX_PAGES; page += 1) {
    const offset = page * LIKED_PAGE_SIZE
    const { status, data } = await requestJson(`/user/getUserLikedSongs?limit=${LIKED_PAGE_SIZE}&offset=${offset}`)
    if (status !== 200) {
      throw new Error(`/user/getUserLikedSongs 返回 HTTP ${status}：${JSON.stringify(data)}`)
    }
    const before = all.size
    for (const mid of collectSongmids(data)) all.add(mid)
    // 本页没有带来任何新增，视为已翻到末尾。
    if (all.size === before) break
  }
  return all
}

function printLikedSummary(label, set) {
  console.log(`${label}：共 ${set.size} 首`)
}

function printFailureGuidance(plan, extra = '') {
  console.error('')
  console.error('探针失败。请依次确认：')
  console.error('  1. 服务端已开启写探针：`QQ_WRITE_SPIKE=1 npm run serve`（默认关闭时这三个路径返回 404）。')
  console.error(`  2. 已设置会话令牌：PowerShell 用 \`$env:QQ_SESSION_TOKEN='<sessionToken>'\`，值取自 qqAccountStore.sessionToken。`)
  console.error(`  3. 服务端地址正确（当前 ${baseUrl}），可用 \`QQ_API_BASE\` 覆盖。`)
  console.error('  4. 该探针的 payload 形状（v_songInfo）与是否需要签名均未经验证，失败是预期结果之一；')
  console.error('     若确认不可用，请保留「暂不支持」降级，不要接线 UI，并整体回退该 spike 提交。')
  if (extra) console.error(`  补充信息：${extra}`)
  console.error('')
}

async function main() {
  const plan = parseProbePlan(process.argv.slice(2))
  if (!plan) {
    printUsage()
    process.exitCode = 2
    return
  }
  if (!SONGMID_PATTERN.test(plan.songmid)) {
    console.error(`songmid 非法（需匹配 ${SONGMID_PATTERN}）：${plan.songmid}`)
    process.exitCode = 2
    return
  }
  if (!Number.isFinite(plan.dirId) || plan.dirId <= 0) {
    console.error(`dirId 非法：${plan.dirId}`)
    process.exitCode = 2
    return
  }
  if (!sessionToken) {
    console.error('缺少环境变量 QQ_SESSION_TOKEN，无法携带 QQ 登录态。')
    printFailureGuidance(plan, '未设置 QQ_SESSION_TOKEN')
    process.exitCode = 1
    return
  }

  console.log(`目标服务端：${baseUrl}`)
  console.log(`探针动作：${plan.op} ${plan.path}（songmid=${plan.songmid}, dirId=${plan.dirId}）`)
  console.log('')

  let before
  try {
    before = await fetchLikedSongmids()
  } catch (error) {
    console.error(`写入前拉取「我喜欢」失败：${error?.message || error}`)
    printFailureGuidance(plan, '服务端可能未启动或会话无效')
    process.exitCode = 1
    return
  }
  printLikedSummary('写入前「我喜欢」', before)
  console.log('')

  let probeResult
  try {
    probeResult = await requestJson(plan.path, {
      method: 'POST',
      body: { songmid: plan.songmid, dirId: plan.dirId, op: plan.op },
    })
  } catch (error) {
    console.error(`写探针请求失败：${error?.message || error}`)
    printFailureGuidance(plan, '网络错误，服务端未启动？')
    process.exitCode = 1
    return
  }

  console.log(`写探针响应 HTTP ${probeResult.status}：`)
  console.log(JSON.stringify(probeResult.data))
  console.log('')

  const probeBody = probeResult.data && typeof probeResult.data === 'object' ? probeResult.data : {}
  const probeOk = probeResult.status === 200 && probeBody.ok === true

  let after
  try {
    after = await fetchLikedSongmids()
  } catch (error) {
    console.error(`写入后拉取「我喜欢」失败：${error?.message || error}`)
    printFailureGuidance(plan, '写入后对账失败')
    process.exitCode = 1
    return
  }

  const added = [...after].filter(mid => !before.has(mid))
  const removed = [...before].filter(mid => !after.has(mid))
  const expectedLiked = plan.op === 'add'
  const likedBefore = before.has(plan.songmid)
  const likedAfter = after.has(plan.songmid)

  printLikedSummary('写入后「我喜欢」', after)
  console.log(`新增 songmid：${added.length ? added.join(', ') : '（无）'}`)
  console.log(`移除 songmid：${removed.length ? removed.join(', ') : '（无）'}`)
  console.log(`目标 songmid ${plan.songmid}：写入前${likedBefore ? '已喜欢' : '未喜欢'} → 写入后${likedAfter ? '已喜欢' : '未喜欢'}`)
  console.log('')

  if (!probeOk) {
    console.error('结论：写探针未成功。')
    printFailureGuidance(plan, `HTTP ${probeResult.status} / ${JSON.stringify(probeBody)}`)
    process.exitCode = 1
    return
  }

  if (likedAfter !== expectedLiked) {
    console.error(`结论：探针返回成功，但「我喜欢」集合未按预期变化（期望 ${expectedLiked ? '加入' : '移除'}）。`)
    console.error('可能原因：上游写接口需要签名 / payload 形状不符 / 列表存在缓存延迟。')
    printFailureGuidance(plan, '接口返回 ok 但集合未变')
    process.exitCode = 1
    return
  }

  console.log(`结论：写操作已生效（${expectedLiked ? '加入' : '移除'}成功），可以进入后续接线评估。`)
}

await main()
