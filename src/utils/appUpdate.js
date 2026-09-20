import pinia from '../store/pinia'
import { useOtherStore } from '../store/otherStore'

// 网页版的「新版本追加」：更新日志取自本仓库最新的提交（推送）记录，
// 触发时机为首次打开网页、网页更新后首次打开、以及设置里的「检查更新」。
const REPO = 'TTLLSSFF/Hydrogen-Music'
// 通过同源代理请求：服务端（web-server.js / Vite dev 代理）会附带 GITHUB_TOKEN，
// 既能避免 Token 暴露在浏览器，也能提高 GitHub 接口限额
const COMMITS_API_PATH = `/repos/${REPO}/commits?per_page=20`
const COMMITS_PROXY = `/github-api${COMMITS_API_PATH}`
// 仅托管静态产物、没有代理时直连 GitHub（匿名请求，限额较低）
const COMMITS_DIRECT = `https://api.github.com${COMMITS_API_PATH}`
const COMMITS_PAGE = `https://github.com/${REPO}/commits`
const LAST_SEEN_BUILD_KEY = 'hydrogen:lastSeenBuild'
const MAX_LOG_COMMITS = 8
const REQUEST_TIMEOUT_MS = 8000

// 构建标识由 vite.config.js 注入（提交短 SHA，无 git 时为构建时间戳）。
// 项目已弃用语义化版本号，一律用该标识区分构建版本。
const BUILD_ID = typeof __APP_BUILD_ID__ === 'string' && __APP_BUILD_ID__ ? __APP_BUILD_ID__ : 'dev'
// 标识是提交 SHA 时可在提交列表里精确定位，时间戳标识只能退化为取最近若干条
const BUILD_ID_IS_COMMIT = /^[0-9a-f]{7,40}$/i.test(BUILD_ID)

const otherStore = useOtherStore(pinia)

function normalizeSha(value) {
  return String(value || '').trim().toLowerCase()
}

// 提交短 SHA 与完整 SHA 互为前缀即视为同一次提交
function shaMatches(fullSha, reference) {
  const full = normalizeSha(fullSha)
  const target = normalizeSha(reference)
  if (!full || !target) return false
  return full.startsWith(target) || target.startsWith(full)
}

async function requestCommits(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`commits-request-failed:${response.status}`)

    const payload = await response.json()
    if (!Array.isArray(payload)) throw new Error('commits-payload-invalid')
    return payload
  } finally {
    clearTimeout(timer)
  }
}

async function fetchCommits() {
  try {
    return await requestCommits(COMMITS_PROXY)
  } catch (_) {
    // 代理不可用（例如只托管静态产物）时回退到直连 GitHub
    return await requestCommits(COMMITS_DIRECT)
  }
}

function getCommitMeta(item) {
  return {
    sha: normalizeSha(item?.sha),
    shortSha: normalizeSha(item?.sha).slice(0, 7),
    subject: String(item?.commit?.message || '').split(/\r?\n/)[0].trim(),
    body: String(item?.commit?.message || '').split(/\r?\n/).slice(1).map(line => line.trim()).filter(Boolean),
    date: String(item?.commit?.author?.date || '').slice(0, 10),
    url: String(item?.html_url || '') || COMMITS_PAGE,
  }
}

// 把提交列表转成面板使用的轻量 Markdown（### 标题 / - 列表）
function formatCommitChangelog(commits) {
  const lines = []

  for (const rawCommit of commits.slice(0, MAX_LOG_COMMITS)) {
    const commit = getCommitMeta(rawCommit)
    if (!commit.subject) continue

    lines.push(`### ${commit.subject}`)
    lines.push(`${commit.shortSha} · ${commit.date}`)
    for (const line of commit.body) {
      lines.push(`- ${line.replace(/^[-*+]\s*/, '')}`)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

// 列表按时间倒序：取比 reference 更新的提交（不含 reference 本身）
function takeNewerThan(commits, reference) {
  const result = []
  for (const item of commits) {
    if (shaMatches(item?.sha, reference)) break
    result.push(item)
  }
  return result
}

// 本次构建包含的提交：从最新到构建提交为止，再截掉上次已经看过的部分
function takeBuildCommits(commits, previousBuildId) {
  const buildIndex = commits.findIndex(item => shaMatches(item?.sha, BUILD_ID))
  const upToBuild = commits.slice(0, buildIndex >= 0 ? buildIndex + 1 : MAX_LOG_COMMITS)
  if (!previousBuildId) return upToBuild

  const previousIndex = upToBuild.findIndex(item => shaMatches(item?.sha, previousBuildId))
  return previousIndex > 0 ? upToBuild.slice(0, previousIndex) : upToBuild
}

function showUpdatePage({ version, commits, fallbackUrl }) {
  otherStore.newVersion = version
  otherStore.updateChangelog = formatCommitChangelog(commits)
  otherStore.updateReleaseUrl = commits.length
    ? (getCommitMeta(commits[0]).url || COMMITS_PAGE)
    : (fallbackUrl || COMMITS_PAGE)
  otherStore.toUpdate = true
}

export function getCommitsPageUrl() {
  return COMMITS_PAGE
}

// 检查更新。alwaysShow 为 true（设置里的手动检查）时点击即弹出页面：先展示当前构建
// 信息，拉到提交后再填充日志；为 false（首次打开静默检查）时仅在有新版本才弹出。
export async function checkForUpdates({ alwaysShow = true } = {}) {
  const buildVersion = BUILD_ID
  if (alwaysShow) showUpdatePage({ version: buildVersion, commits: [] })

  try {
    const commits = await fetchCommits()
    const latest = commits.length ? getCommitMeta(commits[0]) : null
    if (!latest?.sha) return 'error'

    const hasNewer = !shaMatches(latest.sha, BUILD_ID)
    if (!hasNewer && !alwaysShow) return 'latest'

    const changelogCommits = hasNewer
      ? (BUILD_ID_IS_COMMIT ? takeNewerThan(commits, BUILD_ID) : commits.slice(0, MAX_LOG_COMMITS))
      : commits.slice(0, MAX_LOG_COMMITS)

    showUpdatePage({
      version: hasNewer ? latest.shortSha : buildVersion,
      commits: changelogCommits.length ? changelogCommits : commits.slice(0, MAX_LOG_COMMITS),
    })
    return hasNewer ? 'newer' : 'latest'
  } catch (_) {
    return 'error'
  }
}

// 网页更新后首次打开：展示本次构建（相对上次访问）新增的提交
async function showBuildChangelog(previousBuildId) {
  try {
    const commits = await fetchCommits()
    const buildCommits = takeBuildCommits(commits, previousBuildId)
    showUpdatePage({
      version: BUILD_ID,
      commits: buildCommits,
    })
    return
  } catch (_) {
    // 拉取失败时退化为只显示构建标识
  }

  showUpdatePage({
    version: BUILD_ID,
    commits: [],
  })
}

export function initAppUpdateCheck() {
  let lastSeenBuild = ''
  try {
    lastSeenBuild = localStorage.getItem(LAST_SEEN_BUILD_KEY) || ''
  } catch (_) {}
  try {
    localStorage.setItem(LAST_SEEN_BUILD_KEY, BUILD_ID)
  } catch (_) {}

  if (lastSeenBuild && lastSeenBuild !== BUILD_ID) {
    void showBuildChangelog(lastSeenBuild)
    return
  }

  // 首次打开网页时静默检查一次，有新提交才展示
  if (!lastSeenBuild) void checkForUpdates({ alwaysShow: false })
}