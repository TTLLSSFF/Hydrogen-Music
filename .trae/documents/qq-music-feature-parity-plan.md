# QQ 音乐功能补齐实施方案

## Context

用户在播放 QQ 音乐来源的歌曲时，发现播放详情页与底部播放条上的操作图标（音译 / 翻译 / 原词 / 收藏 / 下载 / 加入歌单 / 专辑 / 播放模式 / 评论 / 歌词面板）相对网易云歌曲大面积缺失，要求补齐。

盘点后确认：**这批图标并非全部缺失能力**，其中音译、翻译、原词、播放模式、歌词面板对 QQ 本来就可用；专辑与评论是「能力已存在但被 UI 藏住」；真正需要新增接口的只有收藏、下载、加入歌单三项。

因此本方案的目标是：把三个层次（能力 → UI 可见性 → 调用分支）逐一对齐，让 QQ 歌曲的行为与网易云一致，并对无法支持的部分给出明确提示而非静默无响应。

### 现状盘点

| 图标 | 功能 | 现状 |
|---|---|---|
| ABC / 译 / T | 音译、翻译、原词 | **已可用**。`normalizeQQLyricPayload` 已归一出 `tlyric`/`romalrc`，`lyricCore.js` 直接消费 |
| ⇄ / 🎵 | 播放模式、歌词面板 | **已可用**，未按来源限制 |
| ⊙ | 专辑 | **能力已存在**（`Player.vue` 的 `toAlbum` 已有 QQ 分支），仅按钮被 `showOnlineCurrentSongActions` 藏住 |
| 💬 | 评论 | 服务端 `/getcomments` 已实现且 policy 已放行 `commentRead`，但按钮被藏住；且取 id 有 bug（见阶段 A） |
| ↓ | 下载 | 被 policy、`download.js`、`resolveDownloadPlaybackInfo` 三处拦截 |
| ♡ | 收藏 | 被 policy + `player.js` 的 `likeSong` 硬拦截 |
| ⊕ | 加入歌单 | 被 policy 拦截；弹窗只列网易云歌单、提交走网易云接口；QQ 右键菜单里根本没有该入口 |

---

## 三个贯穿全局的约束

1. **三道闸门必须同时打开**：能力（`providerPolicy.mjs`）→ UI 可见性（`Player.vue` / `MusicWidget.vue`）→ 调用分支（`player.js` / `download.js`）。只改一层必然出现「按钮在、点了没反应」。
2. **`song.id` 保持现状不动**。QQ 的稳定身份是 `sourceId` / `sourceKey`。把 `id` 改成数字会连带影响 `playerStore.songId` 持久化、队列去重、`ContextMenu` 删除时的 `song.id == selectedItem.id` 匹配，以及既有 adapter 测试断言。数字 id 一律走**新增显式字段**。
3. **写接口未经真机验证**。`scripts/qq-write-probe.mjs` 自述 payload/签名均未经验证，`server/qqMusicApi.cjs` 的写探针从上线起就是默认关闭状态。因此收藏与加入歌单**首版不做乐观更新**——await 成功后再改状态，失败只提示、不动 UI，避免「乐观更新后回滚」的闪烁。同时所有能力位集中在 `providerPolicy.mjs` 一张表里，若真机验证失败可一次性改回 blocked。

---

## 阶段 A：评论（纯前端，零风险）

根因：`server/qqMusicApi.cjs` 的 `/getcomments` 用 `QQ_COMMENT_ID_PATTERN = /^\d{1,20}$/` 校验，**只接受纯数字**，songmid 会被 400。而 `src/api/qqMusic.js` 的 `normalizeQQSong` 计算 `songId` 时取值链是 `value.id, value.songId, value.song_id, mid`，**漏了 QQ 上游实际返回的全小写 `songid`**（证据：`test/qq-music-adapters.test.mjs` 的 fixture 用 `songid: 4936030`；`src/api/qqMusic.js:300` 在别处就引用了 `value.songid`）。结果 QQ 歌曲的 `song.id` 常退化成 songmid 字符串，数字 id 只靠 `...value` 展开残留。

前端两处取 id 逻辑还互相矛盾：`useCommentsPanel.js` 的候选列表是 `[cur.id, cur.songId, cur.song_id, cur.musicId, cur.mediaId]`（缺 `songid`，取不到就静默走空态），而 `MusicPlayer.vue` 的 `getQQCommentId` 却**优先 songmid**（必然 400，评论数恒为 0）。

改动：

- `src/api/qqMusic.js`：`normalizeQQSong` 显式归一数字 id，不再依赖 `...value` 残留，返回体新增 `numericId` 字段（**不改 `id`**）。
- `src/utils/providerPolicy.mjs`：新增**唯一**取 id 入口 `getQQCommentId(song)`，按 `numericId → songid → song_id → musicId → mediaId` 找 `/^\d{1,20}$/`，全不中返回 `''`。放在这里是因为它是两端都信任的纯函数模块，且已有对应测试文件。
- `src/composables/useCommentsPanel.js`：`qqCommentId` 改为调用 `getQQCommentId`，删掉本地候选列表。
- `src/views/MusicPlayer.vue`：删掉「优先 songmid」的实现，改调 policy 版本。
- `src/components/Player.vue`：把 `showCommentPanelAction` 放开给 QQ；同时把 `showOnlineCurrentSongActions` 拆成 `showLikeAction` / `showDownloadAction` / `showAddToPlaylistAction` 三个独立开关（后续阶段逐个打开）。

**降级**：取不到数字 id 时**隐藏评论按钮**，不提示。无数字 id 是上游数据形态问题而非操作失败，提示会误导用户；评论数保持 0。

---

## 阶段 B：下载（纯前端，复用已有播放链路）

QQ 的在线播放已经打通（`src/utils/player.js` 的 QQ 分支走 `getPlayBySource('qq', ...)`），下载用的就是同一个 purl，因此不需要新接口，只需解开三处拦截并处理扩展名与失败文案。

改动：

- `src/utils/player.js`：把现有 QQ 播放分支抽成 `resolveQQPlaybackInfo(song, quality)`，`resolveDownloadPlaybackInfo` 里的 `if (isQQSong(song)) return null` 改为调用它。注意**不要**给它传 `checkAvailability`——那是网易云端点。
- `src/utils/download.js`：删掉 `pushSongsToBrowserDownloads` 里的 QQ skip；`reason` 区分「无 purl（付费/无版权）」与「HTTP 失败」。
- 扩展名：QQ 的 `trackInfo` 常为 null，`inferAudioExtension` 会退化到 URL 后缀猜测。**不修改共享的 `normalizeQQPlaybackPayload` 的 trackInfo**（播放路径也在用它，改动面太大），而是在 QQ 下载分支返回的 playbackInfo 上带一个来源明确的 quality 提示，让 `inferAudioExtension` 优先采信（flac/ape → flac，其余 → mp3），URL 后缀作为兜底。
- 传输层 Referer：`web-server.js` 的 `proxyDownloadUrl` 现在无条件设 `Referer: parsedTarget.origin`，对 QQ purl 来说是错来源（会变成流域名）。改为**仅当 host 含 `qq.com` 时用 `https://y.qq.com/`**，其余保持原样以免影响网易云与 Siren 下载。
- 失败文案：purl 缺失时提示「该歌曲为付费/无版权资源，无法下载」，替换现在的通用「当前歌曲无法播放」。
- 已知限制需在实现后确认：purl 带 `guid` 且有有效期，批量下载是逐首实时解析的，若出现 403 需重试一次。

---

## 阶段 C：服务端写端点正式化（阶段 D/E 的硬依赖）

`server/qqMusicApi.cjs` 里已有一段写操作探针（用 `musicu.fcg` 的 `music.musicasset.PlaylistDetailWrite` 模块，`dirId=201` 即 QQ「我喜欢」），但它需要 `QQ_WRITE_SPIKE=1` 才挂载、只回状态码、且 `option: {}` **没有注入任何凭证**——这就是它从未真正生效的原因。

已验证 cookie 注入路径：`UCommon_default({method, params, option})` 会把 `option` 展开进 http options，`option.headers.Cookie` 能透传到底层请求（`node_modules/@sansenjian/qq-music-api/dist/services.js` 的 `793-801` → `540-545` → `122-141`）。该函数**没有** `customCookie` 参数，所以必须用 `option: { headers: { Cookie: sessionCookie } }`。

改动（全部在 `server/qqMusicApi.cjs`）：

- **路径**：沿用 `/user/likesong`（`dirId=201` 是特例），新增 `/user/songlist` 用 `op: add|del` 合一处理任意歌单。两个方向都要做，否则「取消喜欢」与「从歌单移除」无法实现。
- **不保留 `QQ_WRITE_SPIKE`**：探针使命结束，删除相关分支；改留单一 kill-switch `QQ_WRITE_ENABLED`（默认开启）便于紧急关闭。
- **必须留在会话闸门之后**（`sessionCookie` 与 `activeSession` 的组装处，约 1476-1527 行），不要挪到 `/getcomments` 那种提前 `return` 的位置，这样无 cookie 会自动 401。
- **参数校验**：songmid `^[A-Za-z0-9]{8,20}$`、dirId 正整数（likesong 强制 201）、body ≤ 4KB。复用现有的 `readQQProbeJsonBody`（可改名）。
- **服务注入化**：仿照文件里既有的 `options.xxxService || 默认实现` 风格加 `songlistWriteService`，让端点契约与上游实现解耦——若真机实测 `UCommon_default` 失效，可换成 c.y.qq.com 直连而不动端点。
- **响应**：只回 `{ ok, code }` 状态码，经 `sanitizeQQResponseBody` 脱敏；`400 INVALID_*` / `401` / `409 UPSTREAM_REJECTED` / `502 UPSTREAM_ERROR`。
- `src/api/qq.js`（或 `qqMusic.js`）补 `setQQLike`、`addQQPlaylistSongs`、`removeQQPlaylistSongs` 三个 POST 封装。渲染层带 token 的方式已有现成机制：`src/utils/qqRequest.mjs` 自动加 `X-QQ-Music-Session` 头（桌面端走 IPC，`src/electron/ipcMain.js` 已保留该头）。

---

## 阶段 D：加入歌单（依赖 C）

现状：弹窗**内嵌在** `src/components/ContextMenu.vue` 里（不是独立组件），歌单源是 `filterProviderPlaylists(libraryStore.playlistUserCreated, 'netease')`，`normalizePlaylistTarget` 用 `isProviderPlaylist(...,'netease')` 拒绝非网易云，提交走 `src/api/playlist.js` 的 POST `/playlist/tracks`（网易云接口，pid/songid 语义与 QQ 的 dirId/songmid 完全不同）。此外 `src/store/otherStore.js` 的 `treeQQ` 菜单里只有播放/下一首，**根本没有「添加到歌单」入口**。

改动：

- **新建 `src/utils/playlistMutation.mjs`**：导出统一的 `addSongsToPlaylist({ provider, playlistId, songs })`，内部 netease → 现有 `updatePlaylist`，qq → 新的 `addQQPlaylistSongs(dirId, songmids)`。**这是全项目唯一的按来源分流点**，ContextMenu 只调它。
- `src/components/ContextMenu.vue`：歌单源改为合并列表（网易云 + QQ），`normalizePlaylistTarget` 改为 provider-aware，模板列表换成合并后的。
  - **坑**：QQ 歌单源不能复用 `ensureUserPlaylistsLoaded`，它以 `userStore.user.userId` 为前提，纯 QQ 账号永远进不去，会导致弹窗恒空；需由 `qqAccountStore` 的登录态单独门控。
  - QQ 目标下隐藏「创建新歌单并添加」——QQ 建歌单是另一套写接口，本期不做。
- **dirId 提取**：`normalizeQQPlaylist` 的 `...value` 会透传上游字段，但字段名大小写不确定，需显式提取 `dirid / dirId / dirID / dir_id`。另一个坑是它的 `id` 取值链是 `disstid/dissid/tid/id/dirid`，若上游只给驼峰 `dirId` 会退到 `undefined`，并被 `qqLibrary` 里 `filter(item => item.id)` 静默丢弃。
- `src/store/otherStore.js`：`treeQQ` 菜单补「下载」「添加到歌单」「从歌单删除」（仅当当前歌单来源是 QQ）「显示专辑」。删除走 `DelSonglist(当前 dirId)`，不是网易云的 `/playlist/tracks`。
- 放开 `src/components/Player.vue`、`src/components/MusicWidget.vue`、`src/components/LibraryDetail.vue` 里各自的 QQ 排除判断。

---

## 阶段 E：收藏（依赖 C）

**id 隔离是这一阶段的核心问题**：`userStore.likelist` 存的是网易云数字 id，而 `checkIsLike` 是不带来源判断的 `includes`。QQ 的数字 songid 与网易云 id 存在碰撞可能，会互相污染。

改动：

- **新增 `userStore.qqLikelist`，存 songmid 集合**。选 songmid 而非数字 songid 有两个好处：写接口要的就是 songmid；且字符串 mid 天然不会与网易云数字 id 串号。
- 登录 / 切号时用 `getQQLikedSongs` 分页拉全量填充（目前 `LibraryType.vue` 只取 `limit:1` 拿歌单壳），清空时机照 `src/utils/accountSession.js` 的既有做法。
- `src/utils/player.js` 的 `likeSong`：把现有 QQ 硬拦截换成 QQ 分支，**复用同一套骨架**（`createLikeActionToken` / `queueLikeRequest` / `applySuccessfulLikeAction` 都与来源无关），只替换 `likeMusic` → `setQQLike(songmid, like)`、`updateLikelist` → `updateQQLikelist`。注意删掉 `applyFavoritePlaylistFallback` 那一步——它是网易云 502 专用的降级，QQ 无对应物。
- `src/components/Player.vue`：`checkIsLike` 改为按来源取数（QQ 用 `sourceId`/`songmid` 查 `qqLikelist`）；like 按钮上的 `v-if="Array.isArray(userStore.likelist)"` 要放开给 QQ，否则未登录网易云时 QQ 的 ♡ 不渲染。
- `src/components/MusicWidget.vue`：`canShowSongLike` 去掉 QQ 排除。

---

## 阶段 F：policy 收口与验证

`src/utils/providerPolicy.mjs` 的 `QQ_BLOCKED_SONG_ACTIONS` 从 `{like, commentWrite, commentLike, download, collect, playlistMutation}` 收敛为**仅保留上游确实没有写接口的两项**：`commentWrite` 与 `commentLike`。`collect` 当前没有任何真实调用点，一并清理。

**改完必须同步更新 `test/qq-provider-policy.test.mjs`**，它固化了当前语义。

---

## 验证方案

**可用 `npm test` 覆盖（`node --test test/*.test.mjs`，基线 189/189）：**

- `normalizeQQSong` 的数字 id 归一，用三种真实来源的 fixture 分别断言：搜索结果（`client_search_cp`）、榜单（`songid` 存在）、musicu `GetDetail`（只有数字 songId、没有 songmid）。
- `getQQCommentId` 的取 id 与空值降级。
- policy 新语义。
- 服务端写端点：参考 `test/qq-server-security.test.mjs` 的现成范式（`createQQSecurityMiddleware` + 注入 fake `songlistWriteService`），断言 401（无会话）/ 400（非法 songmid、非法 dirId）/ Cookie 正确透传 / 旧的 `QQ_WRITE_SPIKE` 路径已 404。
- `normalizeQQPlaylist` 的 dirId 多大小写提取。

**必须真机手测（需 `npm run serve` + 真实 QQ 扫码登录）——这是写接口能否成立的唯一判据：**

1. 收藏 / 取消收藏后，到 QQ 侧「我的音乐 → 我喜欢」核对是否真的写入。
2. 加入歌单 / 从歌单移除后，到 QQ 侧核对。
3. 三档音质（128 / 320 / flac）下载各一次，确认文件可播放且标签已写入（网页端标签写入是上一轮刚做的能力）。
4. VIP / 付费歌曲的下载失败文案是否正确。
5. 评论面板是否有内容，混源队列里评论数是否正确。
6. 混源队列批量下载 / 批量加歌单时的逐首结果统计。

---

## 实施顺序与风险

**A（评论）→ B（下载）→ C（服务端端点）→ D（加入歌单）→ E（收藏）→ F（收口与验证）**

- A、B 完全独立且零新增接口，可先落地并独立验证。
- C 是 D、E 的硬依赖。
- **风险集中在 C 之后**：QQ 写接口是逆向旧版未签名的 `musicu.fcg`，历史上从未在真实登录态下验证成功过。因此 D、E 的功能位必须在 `providerPolicy.mjs` 集中管理，一旦真机验证失败可一次性改回 blocked，UI 退回现在的明确提示（而不是「点了没反应」）。

**本方案完成后，QQ 歌曲相对网易云歌曲仅剩的差异**：评论的发表 / 点赞 / 回复（上游无写接口，保持现状提示）、创建 QQ 歌单（本期不做）。