# QQ 音乐全面集成实施计划

## 背景（Context）

当前项目已完成一次方向反转：commit `1882438`（"移除多源切换逻辑，统一使用网易云音乐作为数据源"）删除了首页的网易云/QQ 来源切换条、首页 QQ 推荐模块、`userStore.homeSource`，以及服务端 4 个 QQ 公共首页路由。

本需求要求把 QQ 音乐从"仅我的音乐 + 播放 + 搜索"扩展为**与网易云对等的完整平台**：首页推荐、全局平台切换器、分类歌单、以及播放器的专辑/评论/喜欢/加入歌单四项增强。

预期结果：用户在首页、搜索页、设置页三处看到同一个平台切换器，切换后首页与搜索页整体切换数据源且状态跨会话保留；QQ 歌曲在播放器中获得与网易云尽可能一致的操作体验。

**本计划已确认的三项决策**（来自用户）：
1. 恢复 QQ 首页推荐模块 + 首页/搜索页/设置页三处统一切换器。
2. 「喜欢 / 添加到歌单」走**时间盒探针**：先用真实 QQ 登录态验证旧版 `musicu.fcg` 写接口是否可用，通过才接 UI，不通过保留现有降级提示。
3. 新建分类歌单页（QQ 专属），复用现有列表页样式。

---

## 关键约束（已验证，决定了方案边界）

**上游能力**（`@sansenjian/qq-music-api` v2.5.0，见 `node_modules/@sansenjian/qq-music-api/dist/services.d.ts`）
- 可用的只读服务：`getRecommendBanner`、`getNewSongs`、`getTopLists`、`getDailyRecommend`、`getPersonalRecommend`、`getSongLists`、`getPlaylistTags`、`getPlaylistsByTag`、`getDigitalAlbumLists`、`getComments`、`getHotComments`、`getAlbumInfo`、`getAlbumSongs`、`UCommon`。
- **无任何写操作服务**（只有只读 `getUserLikedSongs`），且请求走**旧版未签名** `https://u.y.qq.com/cgi-bin/musicu.fcg`（无 `sign`/`zzc`）。→ 喜欢 / 加入歌单无法保证实现，故走探针。

**服务端安全姿态**（`server/qqMusicApi.cjs`）
- `isQQPathAllowed` 使用**正向白名单**（`QQ_ALLOWED_EXACT_PATHS` / `QQ_ALLOWED_PATH_PATTERNS` / `QQ_PRIVATE_PATHS`），注释明确要求"新增上游端点不得让公共推荐/评论/专辑/MV 接口意外可达"。
- 现有公共 handler（`/getsearchbykey`、`/getalbuminfo`、`/getsingerinfo`、`/getsingersongs`、`/getsingeralbums`）是**刻意的例外**，做法是严格参数校验 + `sanitizeQQResponseBody` 凭证脱敏。新增端点必须复制这套模式。
- 已登录请求的 cookie 来自模块级 `global.userInfo`，由 `syncQQUpstreamUserInfo(session)` 对齐；无会话时中间件直接 401。
- 复刻上游 `musicu.fcg` 请求的现成范式见 `fetchQQSingerSongsPage` / `fetchQQSingerAlbumsPage`（`qqServices.UCommon_default({ method:'get', params:{ format:'json', data: JSON.stringify(data) }, option:{} })`）。

**可干净恢复的删除内容**（`git show 1882438 -- <path>`）
- `src/api/qqMusic.js`：`getQQRecommendBanner`、`getQQNewSongs`、`getQQTopLists`、`getQQTopListDetail`，及 `normalizeQQRecommendBanner`、`normalizeQQNewSongs`、`normalizeQQTopLists`、`normalizeQQTopListDetail`。
- `server/qqMusicApi.cjs`：`getWeekNumber`、`bannerService`/`newSongsService`/`topListsService`/`topListDetailService`，及路由 `/getRecommendBanner`、`/getNewSongs`、`/getTopLists`、`/getTopListDetail`。
- `HomePage.vue` 的 `.home-source-switch` 标记与 `switchHomeSource`；`Banner.vue` / `NewestSong.vue` / `RecList.vue` / `RecListItem.vue` 的 QQ 分支。
- 测试：`test/qq-toplist-detail-flow.test.mjs`（整文件删除）；`test/qq-music-adapters.test.mjs` 与 `test/qq-server-security.test.mjs` 各被删去一段首页用例。
- 文档：`docs/qq-music-api-capabilities.md`（含白名单表，需同步更新）。

**必须复用的既有抽象**（不要新造）
- `src/utils/musicSource.mjs`：`normalizeMusicSource`、`getSongIdentity`、`getResourceId`
- `src/utils/providerPolicy.mjs`：`isQQSong`、`canUseSongAction`、`isProviderPlaylist`、`filterProviderPlaylists`、`findProviderPlaylist`、`getSearchSource`
- `src/utils/qqLibrary.mjs`、`qqArtistRoute.mjs`、`accountProviders.mjs`、`accountIdentity.mjs`
- `src/api/musicSource.js`：播放/歌词的唯一 provider 分发入口
- `src/utils/commentFormat.js`：评论结构格式化

**测试约定**：`node:test` + `assert/strict`，文件位于顶层 `test/*.test.mjs`，`npm test` 运行；**仅纯函数/模块测试，无组件测试、无 DOM 环境**；`test/extension-loader.mjs` 支持无扩展名 import。

---

## 实施方案

### 阶段 0：平台源状态层（一切的前置）

**设计决策：把 `otherStore.searchSource` 提升为全局唯一平台源并持久化，不恢复 `userStore.homeSource`。**

理由：`searchSource` 已是搜索页 / 路由 / `SearchInput.vue` 的唯一消费字段，改动面最小；恢复 `homeSource` 会产生第二份真相并必然双写漂移。持久化沿用项目既有的 `pinia-plugin-persistedstate`（已在 `src/store/pinia.js` 全局注册），不写入 `settingsSchema.js`，避免 localStorage 双写。

- `src/store/otherStore.js`：新增 `persist: { storage: localStorage, pick: ['searchSource'] }`；新增 action `setSearchSource(source)`，内部经 `normalizeMusicSource` 归一化，非法值回退 `'netease'`。
- `src/utils/providerPolicy.mjs`：新增纯函数 `resolvePlatformSource(querySource, current)` —— query 显式提供时取 `getSearchSource(querySource)`，**否则保留 `current`**。
  - 这是修复持久化被覆盖的关键：`src/router/router.js:229` 与 `src/views/SearchResult.vue` 当前写法是 `searchSource = getSearchSource(to.query.source)`，在 `?source=` 缺失时会强制回落到 `netease`，持久化后必须改走 `resolvePlatformSource`。
- `src/router/router.js:229`、`src/views/SearchResult.vue`：改用 `resolvePlatformSource`。

**连带影响（必须同步处理）**：`Banner.vue` / `NewestSong.vue` / `RecListItem.vue` 使用模块级 `xxxLoaded` 布尔短路，切换来源后不会重新拉取；需按源重置，并把缓存键改为按源区分（旧实现是 `${type}:qq`）。

### 阶段 1：服务端 QQ 公共接口白名单（`server/qqMusicApi.cjs`）

沿用现有"options 注入 service + 严格校验 + `sanitizeQQResponseBody`"范式。

**公共 GET（无需登录）**，与现有 `/getsearchbykey` 同层处理：
`/getRecommendBanner`、`/getNewSongs`、`/getTopLists`、`/getTopListDetail`、`/getPlaylistTags`、`/getPlaylistsByTag`、`/getDigitalAlbumLists`、`/getComments`、`/getHotComments`。
- 恢复 `getWeekNumber(d)` 与 `topListDetailService`（`musicToplist.ToplistInfoServer` / `GetDetail`，`period` 为 `YYYY_WW`）；其余直连上游同名 service。
- 参数校验（非法一律 400）：`topId` 仅数字；`tagId`/`page`/`limit` 数值并夹取（`limit ≤ 30`）；`songmid` 匹配 `^[A-Za-z0-9]{8,20}$`；`cmtype` 固定 `1`；`sort` 走白名单枚举。

**需登录**（登记进 `QQ_ALLOWED_EXACT_PATHS`，落在 `isQQPathAllowed` 之后以复用 401 与 `syncQQUpstreamUserInfo`）：
`/getPersonalRecommend`、`/getDailyRecommend`。

**写操作探针路由（默认关闭）**：新增常量 `QQ_WRITE_SPIKE_PATHS`（`/user/likeSong`、`/user/addSonglist`、`/user/delSonglist`），**仅当 `process.env.QQ_WRITE_SPIKE === '1'` 时纳入放行**，强制 POST；body 只接受 `{ songmid, dirId, op }` 并复用既有凭证字段拒绝逻辑；响应只回 `{ ok, code, message }`。默认态下这三个路径仍 404。

同步更新 `docs/qq-music-api-capabilities.md` 的白名单表。

### 阶段 2：客户端适配层（`src/api/qqMusic.js`）

- 恢复：`getQQRecommendBanner` / `getQQNewSongs` / `getQQTopLists` / `getQQTopListDetail` 与 4 个对应 normalizer（全部经 `qqRequest` → `/api/qq`）。
- 新增：`getQQPlaylistTags`、`getQQPlaylistsByTag`、`getQQDigitalAlbumLists`、`getQQPersonalRecommend`、`getQQSongComments`、`getQQHotComments`。
- 新增纯函数 normalizer：`normalizeQQTagList`、`normalizeQQPlaylistCard`、`normalizeQQDigitalAlbumCard`、`normalizeQQCommentList` —— 统一补 `source: 'qq'`、`id = mid`，复用现有 `normalizeQQSong` 与 `unwrapQQResponse`。

### 阶段 3：首页 QQ 推荐模块

- 新建 `src/components/PlatformSourceSwitch.vue`，`props.variant: 'pill' | 'toggle'`：
  - `pill` 用于 `src/views/HomePage.vue`（恢复 `.home-source-switch` 样式）与 `src/views/SearchResult.vue`（替换现有 `.source-toggle` 标记，保留 `<Transition name="toggle">`）；
  - `toggle` 用于 `src/views/Settings.vue`，复用 `.option > .option-operation > .toggle` 结构（`.toggle-off` / `.toggle-on-in`）。
  - 三处均读写 `otherStore.setSearchSource`，不触发页面重载。
- `src/views/HomePage.vue`：恢复 pill 切换器；`Recommendation.vue`（每日推荐卡片）仅网易云显示——QQ 无对等数据。
- `src/components/Banner.vue`：恢复 QQ 分支 + 按源区分的缓存键。
- `src/components/NewestSong.vue`：恢复 QQ 分支（`getQQNewSongs`），补 `picUrl` / `ar` 字段映射。
- `src/components/RecList.vue` + `RecListItem.vue`：QQ 分支映射 `recType` ——
  `0` 推荐歌单（`getQQPlaylistsByTag` 默认热门 tag）、`1` 个性化推荐（`getQQPersonalRecommend`，未登录或失败显示空态文案）、`2` 新碟（`getQQDigitalAlbumLists`）、`3` 排行榜（`getQQTopLists`）。
  切源时重置列表与 `loadedQQSource`；`recType 0` 标题旁为 QQ 增加「更多」入口跳分类页。

### 阶段 4：分类歌单页（QQ 专属）

- 新建 `src/views/QQPlaylistCategory.vue`，路由 `/qq/playlists`（name `qqPlaylistCategory`）加入 `src/router/router.js`。
- 左侧 tag 侧栏（`getQQPlaylistTags`），右侧复用现有歌单卡片网格与滚动加载样式（`getQQPlaylistsByTag` 分页，按 `mid` 去重）。
- 该页固定 QQ 源，不读全局平台源。

### 阶段 5：播放器只读增强

- **专辑信息 + 曲目列表**：QQ 侧**已经可用**（`libraryStore.updateQQAlbumDetail` + `getQQAlbumInfo` + `normalizeQQAlbumDetail`）。当前问题是行为不一致：`src/views/Player.vue` 与 `src/components/MusicWidget.vue` 的 `toAlbum()` 对 QQ 直接弹「暂不支持」，而 `src/components/ContextMenu.vue` 已放行。→ 删除这两处拦截，与 `ContextMenu.vue` 对齐。
- **评论**：`src/utils/providerPolicy.mjs` 把 `QQ_BLOCKED_SONG_ACTIONS` 中的 `'comment'` 拆为 `'commentRead'`（允许）与 `'commentWrite'` / `'commentLike'`（先阻止）。
  - 同步调整 `src/views/MusicPlayer.vue` 的 `commentTarget` / `commentPanelKey` / `fetchCommentCount` 与面板渲染条件。
  - `src/composables/useCommentsPanel.js` 的 `requestCommentList` / `requestCommentFloor` 增加 `track.source === 'qq'` 分支走 `getQQSongComments`，并把返回结构适配为现有 `comments` / `hotComments` 形状（复用 `src/utils/commentFormat.js`）。
- **喜欢 / 加入歌单**：本阶段**保持阻止**（等探针结果）。
  - 若后续接入：QQ 需要独立的喜欢集合（`userStore.likelist` 是网易云语义）——在 `src/store/qqAccountStore.js` 增加 `likedSongmids`，登录后由 `/user/getUserLikedSongs` 填充。
  - `src/components/ContextMenu.vue` 增加与 `neteaseWritablePlaylists` 并列的 `qqWritablePlaylists = filterProviderPlaylists(libraryStore.playlistUserCreated, 'qq')`。

### 阶段 6：写操作探针（独立 commit，可整体 revert）

- 新建 `scripts/qq-write-probe.mjs`，手动运行：
  `node scripts/qq-write-probe.mjs like <songmid>` / `add <dirId> <songmid>` / `del <dirId> <songmid>`
- 内部直连 `https://u.y.qq.com/cgi-bin/musicu.fcg`，模块 `music.musicasset.PlaylistDetailWrite`，方法 `AddSonglist` / `DelSonglist`，参数 `{ dirId: 201, v_songInfo: [{ songMid, songType: 0 }] }`（`dirId: 201` = 我喜欢）。
- **用户验证方式**：脚本执行前后各调一次 `/user/getUserLikedSongs`，对比 `songmid` 集合差异。
- 时间盒：一天。**成功** → 打开 `QQ_WRITE_SPIKE=1` 并接线 UI（阶段 7）；**失败/超时** → 保留「暂不支持」降级，`git revert` 该 spike commit（probe 脚本 + 服务端常量 + `qqMusic.js` 写函数）。

### 阶段 7：写操作接线（仅在探针通过后执行）

- `src/api/qqMusic.js` 增加 `likeQQSong` / `updateQQPlaylist`（走 spike 路由）。
- `src/utils/player.js` 的 `likeSong()` 顶部加 `isQQSong` 分支，复用其乐观更新 / 竞态令牌 / 限流队列思路，但**不复用**网易云的 `syncLikelistAfterLikeAction` 对账逻辑。
- 入口 `Player.vue` / `MusicWidget.vue` / `LibraryDetail.vue` 用 `canUseSongAction(song, 'playlistMutation')` 统一门控。

### 阶段 8：测试与 QA

单元测试（`test/*.test.mjs`，纯函数）：
- 恢复 `test/qq-toplist-detail-flow.test.mjs`；恢复 `test/qq-music-adapters.test.mjs` 与 `test/qq-server-security.test.mjs` 中被删的首页用例（用 `createQQSecurityMiddleware` 的 options 注入 service，无需真实网络）。
- 新增 `test/platform-source.test.mjs`：`resolvePlatformSource(querySource, current)` 覆盖规则，重点覆盖"持久化偏好不被缺失的 `?source=` 覆盖"。
- 新增 `test/qq-home-normalizers.test.mjs`：`normalizeQQTagList` / `normalizeQQPlaylistCard` / `normalizeQQDigitalAlbumCard` / `normalizeQQCommentList` 的空值与畸形 payload。
- 扩展 `test/qq-provider-policy.test.mjs`：`commentRead` 允许、`commentWrite` 阻止、QQ likelist 判定。
- 服务端安全：spike 路由默认 404、非法参数 400、响应无 cookie/uin 泄漏。

---

## 风险与不确定点（按严重度排序）

1. **写接口探针（最高）**：`v_songInfo` 字段形状未知、是否需要 `zzc` 签名未知、`dirId 201` 在旧版 `musicu.fcg` 下是否仍生效未知。**可能整体失败**——这是已接受的决策，失败即回退降级。
2. **`getPersonalRecommend`**：登录态要求与响应形状不稳定，首页「个性化推荐」可能只能显示空态。
3. **QQ 评论**：`topid` / `cmtype` 语义需实测；`getComments` 与 `getHotComments` 的分页形状与网易云不同，适配层需要防御性处理。
4. **切源缓存失效**：`Banner.vue` / `NewestSong.vue` / `RecListItem.vue` 的模块级 `xxxLoaded` 短路与 banner 缓存键必须按源隔离，否则切源后显示旧数据。
5. **`providerPolicy` 动作拆分**：`'comment'` 拆为 `commentRead`/`commentWrite` 会连带影响 `MusicPlayer.vue` 的面板开关与评论数拉取，需回归。

---

## 验证方式

1. **静态与单测**：`npm test`（当前基线 143/143，改造后应只增不减）与 `npm run build` 必须通过。
2. **浏览器实测**（dev server `http://localhost:5173`）：
   - 首页切换器切到 QQ：Banner / 新歌 / 四个 RecList 区块全部切为 QQ 数据，无残留网易云内容；刷新后仍保持 QQ。
   - 搜索页切换器与首页开关状态互通；`?source=qq` 显式传参时优先生效。
   - 设置页开关能改变首页与搜索页来源。
   - 分类歌单页 tag 切换与滚动加载正常。
   - QQ 歌曲：专辑详情可进入、评论区可打开；喜欢 / 加入歌单按探针结果表现为可用或明确提示。
3. **降级路径**：未登录 QQ 时访问需登录的 QQ 模块，应显示空态或登录引导而非报错；后端 QQ API 服务（3200）不可达时应显示错误态而非崩溃。
4. **后端依赖（当前环境不可用）**：实测需要 QQ API 服务监听 `127.0.0.1:3200`。该服务由 `npm run serve`（`web-server.js:441` 内部调用 `startQQMusicApi()`）拉起，与 `npm run dev` 的 vite 代理是**两个进程**——当前 `3200` 与网易云的 `36530` **都未监听**。因此：
   - 无后端时只能验证网易云侧骨架、空态/错误态、切源状态与持久化、以及静态结构；
   - 首页 QQ 数据、评论、分类歌单、专辑详情、写操作探针**都必须先启动 `npm run serve` 并具备真实 QQ 登录态**才能验证。
