# 安卓端补齐缺失功能（含 QQ 音乐移植）实施方案

## Context

合并上游（ldx123000）后，本仓库有两套前端：根 `src/`（桌面/网页端，功能最全）与 `apps/android/src/`（安卓端，上游移植版）。安卓端是主 src 的裁剪改造版（174 vs 243 文件），目前缺口：

- **完全没有 QQ 音乐**（来源切换、扫码登录、QQ 搜索/歌单/歌手/专辑/榜单、QQ 播放、QQ 喜欢写入、QQ 歌词桥接）；
- 下载链路缺 **批量选择/批量下载**、**下载「完成记录」页签**、**下载音质选择弹窗**；
- 心动模式只有旧 `intelligence` 实现，缺主端的 **`heartModeArmed`「登记后切歌生效」** 语义。

用户已确认：**全部四个阶段一次做完、逐阶段提交**；**QQ 后端服务照搬进 APK**。

目标：安卓端功能面与主应用对齐（明确排除桌面专属能力），每个阶段独立可验证、可回滚。

## 总体架构决策（已逐项核对源码）

| 决策点 | 结论 |
|---|---|
| QQ 后端 | 照搬 `server/qqMusicApi.cjs`（~1830 行，含白名单/脱敏/会话闸门/写签名），不写精简版，保持单一真源；代价 koa 依赖树约 +1.5～2.5MB APK |
| 会话目录 | 在 `apps/android/mobile-runtime/index.js` 里 **require 之前**设 `QQ_MUSIC_API_CONFIG_DIR` 指向 `bridge.app.datadir()`（复用现有 `isWritableDir` 探针）；不改服务端信任模型（不落盘 cookie、不开 `allowServerSession`） |
| 传输链路 | 扩展 `api-bridge.cjs` 做 `/qq` 前缀分流 → `127.0.0.1:36532`；前端在 `src/utils/qqRequest.mjs` 加**惰性 transport 接缝**，安卓实现放 `apps/android/src/utils/qqTransport.mjs`；base 由构建期注入 `window.__HM_QQ_API_BASE__`。不用 CapacitorHttp 作主路径 |
| 桌面共用性 | `qqRequest.mjs` 只加接缝，`createQQRequestConfig`/脱敏/错误形状不动，`test/qq-request-boundary.test.mjs` 继续守住桌面/网页行为 |

已核实的接缝事实：安卓 `webBridge.js` 无 `requestQQApi` → `isDesktopQQBridgeAvailable()` 为 false，默认 fetch 分支生效，因此接缝必须早于首次请求安装；安卓 `vite.config.js` 仅代理 `/api`，需新增 `/api/qq` 且**排在 `/api` 之前**（对齐根 `vite.config.js` 的顺序）；`build-android.cjs` 在 `index.html` 的 `<head>` 注入点已存在。

## 阶段 1：下载链路补全（不依赖 QQ）

**目标效果**：下载管理出现「下载完成」页签（成功/失败/移除/清空）；歌单/专辑页可进多选模式，选择或全选后弹音质选择再整批入队；整单下载也统一走音质弹窗。

**要点**：安卓不走 `src/utils/download.js`（桌面/网页分流），队列唯一真源仍是 `localStore.downloadList` + 原生 `MusicDownloadPlugin`；新增的 `downloadStore` 只记「已完成」。

改动：
- 新增 `apps/android/src/utils/downloadQueue.js`：`enqueueDownloads(songs, quality)`，复用 `utils/quality.js` 归一化音质 → `localStore.updateDownloadList()` + `downloadStore.beginDownload()`。
- 新增 `apps/android/src/store/downloadStore.js`：从 `src/store/downloadStore.js` 原样拷贝（provider 无关），保留 `completed` 持久化。
- 新增 `apps/android/src/components/DownloadQualityDialog.vue`：以主端同名文件为模板，唯一改动是把 `pushSongsToBrowserDownloads` 换成 `enqueueDownloads`。
- 改 `apps/android/src/components/DownloadList.vue`：加 `view` prop（`downloading` 默认 / `completed`），completed 分支照抄主端。
- 改 `apps/android/src/views/MyMusic.vue`：`listType2==1` 渲染 completed；原「已下载文件」树挪到 `listType2==2`。
- 改 `apps/android/src/components/LibraryType.vue`、`LocalMusicList.vue`：新增第三个子项与刷新条件。
- 改 `apps/android/src/utils/downloadManager.js`：完成/失败事件写入 `downloadStore`；**顺手修复既有 bug——失败时不发 `downloadNext` 会卡队列**；发起下载前 `beginDownload`。
- 改 `apps/android/src/store/otherStore.js`：补 `downloadQualityShow/downloadItems/downloadTitle`。
- 改 `apps/android/src/App.vue`：按现有 `defineAsyncComponent` 模式挂 `<DownloadQualityDialog/>`。
- 改 `apps/android/src/components/LibraryDetail.vue` + `LibrarySongList.vue`：多选模式（`downloadSelectionMode/selectedDownloadIds`、全选、勾选态）；本阶段**只做「下载/添加到播放列表/全选」**，QQ 歌单写操作留到阶段 3。
- 改 `apps/android/src/assets/css/mobile.css`：多选行样式与触控目标。

**验证**：`npm --prefix apps/android run build`、根 `npm test`、`npm run android:sync && npm run android:build`；真机（用户配合）批量下载 3 首 → 完成页签可见、失败项有原因、移除/清空生效。

## 阶段 2：QQ 运行时骨架（API 上线 + 传输 + 扫码登录）

**目标效果**：安卓 App 内 QQ 扫码登录成功、设置页可切 QQ 来源、搜索出 QQ 结果并可试听（歌单/首页模块属阶段 3）。

后端/打包：
- 改 `apps/android/mobile-runtime/index.js`：require 前设 `QQ_API_PORT=36532`、`QQ_MUSIC_API_CONFIG_DIR`；`startQQApi()` 用 try/catch 包裹且 **不 reject main()**（对齐 `src/electron/qqApiService.js` 的失败不崩契约），与 NCM 并行启动。
- 改 `apps/android/mobile-runtime/api-bridge.cjs`：`createApiBridge(ncmPort, qqPort)`，`/qq/*` 剥前缀转发到 QQ，其余转发 NCM；保留现有 CORS/OPTIONS 逻辑（该文件第 9 行的头回显是有意为之，不要退回 `*`）。
- 改 `apps/android/mobile-runtime/package.json`：加 `@sansenjian/qq-music-api`（**精确版本 2.5.0**），重生成 lock（`npm run android:install` 用 `npm ci`，lock 必须同步）。
- 改 `apps/android/scripts/build-android.cjs`：前置校验 QQ 依赖存在；拷贝列表追加 `../../server/qqMusicApi.cjs` → `${runtimeDest}/qqMusicApi.cjs`；注入 `window.__HM_APP__` 的同时注入 `window.__HM_QQ_API_BASE__='http://127.0.0.1:36531/qq'`。
- 改 `apps/android/vite.config.js`：新增 `/api/qq` → `http://127.0.0.1:36532`（置于 `/api` 之前）。

前端：
- 改 `src/utils/qqRequest.mjs`：加模块级 `setQQRequestTransport(fn)` + 默认 transport 首行短路。
- 新增 `apps/android/src/utils/qqTransport.mjs`：绝对 base + `ensureQQReady()`（轮询 `/qq/__hm_ready`，策略照搬 `apps/android/src/utils/request.js` 的 `waitForNativeBridge`）+ 参数拼装 + 错误形状 `{ response: { status, data } }`。
- 改 `apps/android/src/main.js`：webBridge 之后安装 transport。
- 原样拷贝（仅改相对路径）：`api/qq.js`、`api/qqMusic.js`、`api/musicSource.js`、`utils/{qqSecurity,qqSession,qqLoginState,qqLibrary,providerPolicy,musicSource,accountProviders,accountIdentity}.mjs`、`store/qqAccountStore.js`、`components/LoginByQQQRCode.vue`、`components/PlatformSourceSwitch.vue`。
- 改 `apps/android/src/store/otherStore.js`：补 `searchSource/setSearchSource/treeQQ/getQQSearchInfo` 与 `persist.pick`（与安卓原有 MV 相关 action 手工合并）。
- 改 `apps/android/src/utils/initApp.js`：加 `qqAccountStore.restoreSession()`；改 `views/Settings.vue`、`views/LoginPage.vue`、`components/SearchResultList.vue` 的最小接入。

**验证**：新增两个可跑在根 `node --test` 的测试 —— `test/android-api-bridge.test.mjs`（前缀分流/OPTIONS）、`test/qq-android-transport.test.mjs`（绝对 base 与重试）；`npm test`、`npm --prefix apps/android run build`、`npm run android:install && npm run android:sync && npm run android:build`；真机扫码登录 → 切源 → 搜索 → 单曲出声。

## 阶段 3：QQ 内容面与播放链路

**目标效果**：QQ 歌单/歌手/专辑可打开并分页；首页腾讯模块与 QQ 分类歌单页可用；QQ 歌曲可播放（音质降级）、可写入「我喜欢」、可下载；多来源 UI 全部就位；心动模式改为「登记后切歌生效」。

按风险从高到低：
1. `apps/android/src/store/libraryStore.js`：QQ 详情/歌手分页/登出清理；**必须同步把详情缓存 key 改成 3 参（id+name+source）**，否则 QQ 与网易云同 id 详情互相覆盖。
2. `apps/android/src/utils/player.js`：`resolveQQPlaybackInfo`（音质档位降级）+ 喜欢写入 `setQQLike` + **`clearQQPlaybackState`（切源剔除异来源队列项，防 `qq:` 与数字 id 撞号串味）**。
3. `apps/android/src/utils/downloadManager.js`：QQ 歌曲改走 `resolveQQPlaybackInfo`，`fileObj` 带 `source:'qq'`。
4. `apps/android/src/store/playerStore.js` + `utils/player.js`：`heartModeArmed` 新语义（登记 + 切歌触发），保留旧 intelligence 路径。
5. `apps/android/src/store/userStore.js`：`qqLikelist/updateQQLikelist`。
6. UI 多来源分支（一个模式，按文件搬主端条件）：`Banner/Recommendation/NewestSong/RecListItem/Title/HomePage/Home/SearchResult/SearchInput/MusicWidget/Player/MusicPlayer/ContextMenu/PlayList/LibraryType/LibraryList/LibraryDetail/LibrarySongList/LibraryAlbumList/LibraryMVList/Settings`。
7. 新增 `apps/android/src/views/QQPlaylistCategory.vue` + 路由 `/qq/playlists` + Home 入口。
8. `LibraryDetail.vue` 补 QQ 歌单「添加到歌单/从歌单删除」（用 `playlistMutation.mjs` 拷贝版），接上阶段 1 预留的菜单项。
9. `mobile.css` 对新增面板做三档视口（390×844 / 320×568 / 430×932）核对。

**验证**：`npm test`（qq-* / playlist-mutation / music-source / queue-identity 等全绿）+ 安卓 build；真机：QQ 歌单打开 → 歌手翻页 → 播放（观察音质回退）→ 喜欢写入 → 混合队列切歌不串 → 心动模式提示「切歌后生效」。

## 阶段 4：QQ 歌词桥接与收尾

- 新增 `apps/android/src/utils/player/qqLyricBridge.mjs`（主端原样拷贝，仅依赖安卓已有的 `lyricPayload.js`）。
- 改 `apps/android/src/utils/player/lyricFallback.js`：加 QQ 分支与两个候选/取词助手，请求带 `suppressGlobalNotice: true`。
- 改 `apps/android/src/store/playerStore.js`（`qqNeteaseLyricBridge` 进 `pick`）与 `views/Settings.vue`（开关行）。
- 可选硬化：把 `qqNeteaseLyricBridge` 布尔归一化补进共享的 `src/shared/settingsSchema.js`（目前只有 `.cjs` 版有）。
- 把阶段 2/3 实测的体积与冷启动数据写进 `apps/android/README.md`。

**验证**：`npm test` + 安卓 build；真机对比开关前后的译文/罗马音与时间轴对齐。

## 风险与回滚

| 风险 | 缓解 |
|---|---|
| Android 内嵌 Node 版本与 QQ 依赖 engines 声明不匹配 | 先打印 `process.version` 观察，再决定是否需要兼容开关 |
| koa 依赖树来自全新 registry 拉包 | 阶段 2 先跑通 `npm run android:install`；镜像缺包时对该包指定官方 registry |
| QQ 上游接口签名易变（musicu/musics） | 与桌面共用同一份服务端代码，一处修两端受益；写操作有 `QQ_WRITE_ENABLED=0` 降级 |
| 播放直链在 `<audio>` 403 | 桌面已验证可行；若真机 403，在 bridge 加带 Range 的 `/qq/stream` 代理，不动前端链路 |
| **队列/缓存串味（QQ 数字 id 撞网易云 id）** | 阶段 3 必须同时移植 `clearQQPlaybackState` 与 3 参缓存 key（最高危项） |
| 冷启动变慢 | QQ 并行启动、不 await；前端 ready 门吸收首批请求失败 |
| 桌面组件在 390px 下的观感 | 每阶段做一次三档视口核对，改动集中在 `mobile.css` |
| 安卓端无测试基建 | 纯逻辑（bridge 分流、transport）落成根 `node --test` 用例；其余靠 `vite build` + `android:inspect` + 真机 |

回滚原则：新能力默认关闭（transport 未安装即旧行为、设置项默认 false、UI 分支以来源为条件），每阶段一个独立提交，可单独 revert。

## 不做清单

Electron/IPC、MPV/HiFi 输出、桌面歌词、自动更新、全局快捷键、窗口控制、音乐视频（安卓已禁用，QQ MV 不做）、`src/utils/download.js`（桌面/网页下载分流）；不改 QQ 服务端信任模型。

## 需要的配合

阶段 2/3/4 的最终验证需要一台安卓真机或模拟器（`npm run android:build` + `npm run android:inspect`），我无法代跑；每阶段我会先给可自动化的证据（构建、单测），再列真机核对清单。