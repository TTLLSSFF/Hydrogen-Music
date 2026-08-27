# QQ 音乐双源整合实现计划

> **面向 AI 代理的工作者：** 使用 `executing-plans` 在当前会话逐任务实现；每个生产改动遵循红—绿—重构。当前仓库没有可写的 Git 元数据权限，因此每项提交步骤改为记录可提交文件清单，不伪造提交成功。

**目标：** 在不破坏现有网易云账号能力的前提下，接入 `@sansenjian/qq-music-api`，实现 QQ 音乐的搜索、首页浏览、资源详情、播放、歌词、MV 与下载，并支持双平台混合播放队列。

**架构：** 服务端以 `/api/qq/*` 隔离 QQ 路由；前端用独立 QQ 客户端和 Provider 网关分发公共能力。QQ 响应在边界归一为现有页面结构，所有资源使用 `source:id` 作为身份键；网易云旧资源默认来源为 `netease`。

**技术栈：** Node.js、Vue 3、Pinia、Axios、Vite、Node.js `node:test`、`@neteasecloudmusicapienhanced/api`、`@sansenjian/qq-music-api`。

---

## 文件结构

- 修改 `package.json`、`package-lock.json`：加入 QQ API 依赖与双源测试脚本。
- 修改 `web-server.js`、`vite.config.js`：挂载并代理 `/api/qq/*`，保持网易云路由不变。
- 创建 `src/utils/musicSource.mjs`：来源规范化、`sourceKey`、路由来源和能力判断。
- 创建 `src/api/qqRequest.js`：不注入网易云 Cookie 的 QQ Axios 客户端。
- 创建 `src/api/providers/qqNormalizer.mjs`：归一化 QQ 歌曲、歌单、专辑、歌手、MV、歌词和媒体地址。
- 创建 `src/api/providers/neteaseProvider.js`：包装现有网易云公共 API。
- 创建 `src/api/providers/qqProvider.js`：包装 QQ 命名空间 API。
- 创建 `src/api/musicProvider.js`：按来源分发公共能力。
- 修改 `src/store/otherStore.js`、`src/views/SearchResult.vue` 及搜索结果组件：双源搜索与竞态隔离。
- 修改 `src/store/libraryStore.js`、`src/router/router.js`、`src/components/LibraryDetail.vue` 及资源列表组件：来源感知的详情与导航。
- 修改首页组件和设置 schema：持久化首页音乐源并切换推荐、榜单和新歌。
- 修改 `src/store/playerStore.js`、`src/utils/player.js`、`src/utils/musicUrlResolver.js`、歌词和下载相关组件：混合队列与来源分发。
- 修改上下文菜单和账号操作组件：集中屏蔽 QQ 账号能力。
- 创建 `src/api/qqAccount.js`、`src/store/qqAccountStore.js`、`src/components/LoginByQQQRCode.vue`：QQ 扫码登录、会话恢复和只读账号数据。
- 修改 `src/components/LoginContent.vue`、`src/views/LoginPage.vue`、`src/components/LibraryType.vue`、`src/views/MyMusic.vue`：平台登录切换和 QQ 账号库入口。
- 创建 `test/music-source.test.mjs`、`test/qq-normalizer.test.mjs`、`test/qq-server.test.cjs`：核心契约与服务共存测试。
- 创建 `test/qq-account.test.mjs`、`test/qq-session-isolation.test.mjs`：二维码状态机、只读账号映射和双账号隔离测试。
- 修改 `README.md`：双源使用方式和限制。

### 任务 1：审计并接入 QQ API 依赖

**文件：**

- 修改：`package.json`
- 修改：`package-lock.json`
- 创建：`docs/qq-music-api-capabilities.md`

- [ ] 运行 `npm.cmd install @sansenjian/qq-music-api --save`，确认锁文件记录实际版本。
- [ ] 读取包入口、导出、README、路由模块和许可证，记录搜索、推荐、榜单、新歌、详情、播放地址、歌词和 MV 的真实调用签名。
- [ ] 用最小 Node 命令加载包入口，确认 CommonJS 或 ESM 加载方式；命令必须退出码为 `0`。
- [ ] 将可用接口、必需参数、返回顶层字段和确认缺失的能力写入 `docs/qq-music-api-capabilities.md`。
- [ ] 运行 `npm.cmd ls @sansenjian/qq-music-api`，确认依赖树无缺失。
- [ ] 记录可提交文件：依赖清单、锁文件和能力说明。

### 任务 2：建立来源身份与能力契约

**文件：**

- 创建：`src/utils/musicSource.mjs`
- 创建：`test/music-source.test.mjs`
- 修改：`package.json`

- [ ] 先写失败测试，断言缺少来源默认为 `netease`、`qq:123` 与 `netease:123` 不相等、字符串 `songmid` 不被数值化、QQ 账号操作返回不支持。
- [ ] 运行 `node --test test/music-source.test.mjs`，确认因模块或导出缺失而失败。
- [ ] 实现 `normalizeMusicSource`、`getResourceId`、`getResourceKey`、`isSameResource`、`readRouteSource` 和 `supportsAccountAction`。
- [ ] 再次运行测试并确认通过。
- [ ] 在 `package.json` 增加 `test:music-source` 与汇总 `test` 脚本。
- [ ] 记录可提交文件：来源工具、测试和脚本。

### 任务 3：挂载隔离的 QQ 服务命名空间

**文件：**

- 修改：`web-server.js`
- 修改：`vite.config.js`
- 创建：`server/qqMusicApi.cjs`
- 创建：`test/qq-server.test.cjs`

- [ ] 根据任务 1 的真实包导出写失败测试：QQ 健康检查可达、未知路由返回 `404`、初始化失败不阻断网易云启动。
- [ ] 运行 `node --test test/qq-server.test.cjs`，确认 `/api/qq` 挂载缺失导致失败。
- [ ] 在 `server/qqMusicApi.cjs` 封装包加载、路由前缀剥离、错误转换和日志脱敏；导出可注入上游处理器的创建函数以便测试。
- [ ] 在 `web-server.js` 的 `/api/qq/*` 分支调用 QQ 处理器；确保该分支先于网易云/静态回退判断。
- [ ] 在 `vite.config.js` 增加同源开发代理或中间件，保持生产与开发路径一致。
- [ ] 运行服务测试，确认全部通过；再启动服务并分别请求一个网易云健康端点和 QQ 健康端点。
- [ ] 记录可提交文件：QQ 服务桥、服务入口、Vite 配置和测试。

### 任务 4：实现 QQ 规范化与 Provider 网关

**文件：**

- 创建：`src/api/qqRequest.js`
- 创建：`src/api/providers/qqNormalizer.mjs`
- 创建：`src/api/providers/qqProvider.js`
- 创建：`src/api/providers/neteaseProvider.js`
- 创建：`src/api/musicProvider.js`
- 创建：`test/qq-normalizer.test.mjs`
- 创建：`test/fixtures/qq/*.json`

- [ ] 从任务 1 已验证的真实响应裁剪脱敏 fixture，覆盖歌曲、歌单、专辑、歌手、MV、歌词和媒体地址。
- [ ] 写失败测试，断言 QQ 数据映射出 `id/source/sourceKey/name/ar/al/dt`，缺失附加歌词为空，音质降级不高于用户目标。
- [ ] 运行 `node --test test/qq-normalizer.test.mjs`，确认归一化函数缺失导致失败。
- [ ] 实现纯函数归一化模块，并保持无浏览器依赖。
- [ ] 实现 `qqRequest`，使用 `/api/qq`、独立超时和错误转换，不复用 NCM IPC、Cookie 或自动退出拦截器。
- [ ] 实现 QQ 与网易云 Provider，并由 `musicProvider` 按 `source` 分发搜索、首页、详情、播放 URL、歌词和 MV。
- [ ] 运行来源与归一化测试，确认全部通过。
- [ ] 记录可提交文件：客户端、Provider、fixture 和测试。

### 任务 5：接入双源搜索

**文件：**

- 修改：`src/store/otherStore.js`
- 修改：`src/views/SearchResult.vue`
- 修改：`src/components/SearchResultList.vue`
- 修改：`src/components/LibrarySongList.vue`
- 修改：`src/components/LibraryAlbumList.vue`
- 修改：`src/components/LibraryMVList.vue`

- [ ] 为搜索状态提取纯函数测试，覆盖切换到 QQ 后网易云旧请求完成但不能覆盖结果。
- [ ] 运行测试并确认旧请求仍会提交结果。
- [ ] 在 Store 中保存 `searchSource`、关键词与请求令牌，调用 Provider 的五类搜索并仅提交当前令牌结果。
- [ ] 在搜索页添加“网易云音乐 / QQ 音乐”切换，默认网易云；切换后重新请求并清空旧来源结果。
- [ ] 列表导航和播放载荷传递资源 `source`，列表 key 与当前歌曲比较改用 `sourceKey`。
- [ ] 运行搜索相关测试和生产构建，确认无模板或导入错误。
- [ ] 记录可提交文件：搜索 Store、页面和列表组件。

### 任务 6：接入来源感知的详情页与路由

**文件：**

- 修改：`src/router/router.js`
- 修改：`src/store/libraryStore.js`
- 修改：`src/components/LibraryDetail.vue`
- 修改：`src/components/SearchResultList.vue`
- 修改：`src/components/LibraryAlbumList.vue`
- 修改：`src/components/LibraryMVList.vue`

- [ ] 写失败测试，断言 `?source=qq` 被传到详情 Provider，且相同 `id` 的两平台详情缓存键不同。
- [ ] 运行测试并确认现有代码只按 `id` 分发。
- [ ] 路由进入详情时读取 `source`，加载判断同时比较来源和 ID；无查询参数时保持网易云兼容。
- [ ] Store 使用 Provider 加载歌单、专辑、歌手和 MV，并用 `sourceKey` 索引 hydration、详情缓存和搜索索引。
- [ ] 详情页仅对网易云资源显示收藏和网易云歌单编辑操作；QQ 资源保留公共播放与导航。
- [ ] 运行详情测试和生产构建。
- [ ] 记录可提交文件：路由、详情 Store 和详情组件。

### 任务 7：接入首页音乐源并持久化

**文件：**

- 修改：`src/shared/settingsDefaults.json`
- 修改：`src/shared/settingsSchema.js`
- 修改：`src/shared/settingsSchema.cjs`
- 修改：首页推荐、榜单和新歌组件对应文件
- 修改：`src/views/Settings.vue`（仅在现有设置入口需要展示时）
- 创建：`test/home-source-settings.test.cjs`

- [ ] 写失败测试，断言默认 `netease`、合法 `qq` 被保留、非法来源回退到 `netease`。
- [ ] 运行测试并确认 schema 尚未包含 `musicSource`。
- [ ] 在默认设置与两个 schema 实现中加入 `musicSource` 规范化。
- [ ] 在首页提供持久化来源切换，并用 Provider 分别加载推荐、排行榜和新歌；区块独立处理失败。
- [ ] 确认搜索来源不被首页切换强制修改。
- [ ] 运行设置测试、现有动画测试和生产构建。
- [ ] 记录可提交文件：设置 schema、首页组件和测试。

### 任务 8：改造混合播放队列、歌词、MV 与下载

**文件：**

- 修改：`src/store/playerStore.js`
- 修改：`src/utils/player.js`
- 修改：`src/utils/musicUrlResolver.js`
- 修改：`src/utils/player/lyricFallback.js`
- 修改：`src/utils/lyricLineOffset.js`
- 修改：`src/utils/mediaSession.js`
- 修改：播放队列、播放器、歌词、MV 和下载相关组件
- 创建：`test/mixed-queue.test.mjs`

- [ ] 写失败测试，覆盖相同 ID 的网易云与 QQ 歌曲可以并存、分别定位、歌词键不同，以及 QQ 不进入网易云歌词回退。
- [ ] 运行测试并确认当前仅比较 `id` 的逻辑失败。
- [ ] 将队列去重、高亮、索引、选择状态和歌词偏移统一改用 `getResourceKey`。
- [ ] 播放 URL、歌词、MV 和下载通过 Provider 分发；QQ 使用自身 ID，网易云与本地/塞壬分支保持现有行为。
- [ ] 音质不可用时按已测试的降级规则处理；无 URL 时显示明确错误且不跨平台替换。
- [ ] 运行混合队列测试、来源测试、归一化测试和生产构建。
- [ ] 记录可提交文件：播放器、队列、歌词、MV、下载和测试。

### 任务 9：集中账号能力隔离并完成文档

**文件：**

- 修改：`src/components/ContextMenu.vue`
- 修改：`src/components/LibraryDetail.vue`
- 修改：`src/views/MusicPlayer.vue`
- 修改：`src/composables/useCommentsPanel.js`
- 修改：`src/components/LoginContent.vue`
- 修改：`src/views/LoginPage.vue`
- 修改：`src/components/LibraryType.vue`
- 修改：`src/views/MyMusic.vue`
- 创建：`src/api/qqAccount.js`
- 创建：`src/store/qqAccountStore.js`
- 创建：`src/components/LoginByQQQRCode.vue`
- 创建：`test/qq-account.test.mjs`
- 创建：`test/qq-session-isolation.test.mjs`
- 修改：`README.md`

- [ ] 写失败测试，断言 QQ 二维码 `800/801/802/803` 状态机、会话恢复、退出清理、只读账号数据映射以及 QQ 会话失效不影响网易云。
- [ ] 运行 `node --test test/qq-account.test.mjs test/qq-session-isolation.test.mjs`，确认现有代码因缺少 QQ 会话模块而失败。
- [ ] 实现 `qqAccount.js`：请求二维码、轮询状态、调用用户资料、歌单、喜欢歌曲、收藏专辑、关注歌手、收藏 MV 和 VIP 等只读端点；Cookie 只在服务端流转。
- [ ] 实现 QQ Store 与二维码组件；登录页平台切换，应用启动恢复 QQ 会话，QQ 退出只清理 QQ 状态。
- [ ] 所有账号入口使用 `supportsAccountAction` 决定是否显示或启用；调用层再做一次防御性校验；上游无写接口的操作明确禁用。
- [ ] 运行账号测试并确认菜单能力、会话隔离和只读数据均通过。
- [ ] 更新 README 的双源说明、启动方式、功能边界、版权/会员/地区限制和临时 URL 说明。
- [ ] 运行能力测试和生产构建。
- [ ] 记录可提交文件：账号入口、能力防线和 README。

### 任务 10：完整验证与交付审计

**文件：**

- 检查：本计划涉及的全部文件

- [ ] 运行 `npm.cmd test`，记录通过数与失败数。
- [ ] 运行 `npm.cmd run test:selection-animation`，确认现有动画回归通过。
- [ ] 运行 `npm.cmd run build`，确认退出码为 `0`。
- [ ] 启动 `npm.cmd run serve`，烟雾检查网易云与 QQ 命名空间、QQ 搜索和一条可公开访问资源的详情；随后正常停止服务。
- [ ] 运行 `git diff --check`，检查空白错误；运行 `git status --short` 和限定范围 diff，确认未覆盖用户改动。
- [ ] 对照设计规格逐项核对搜索、首页、详情、混合播放、歌词、MV、下载、账号隔离、兼容与文档。
- [ ] 若 `.git` 仍不可写，输出建议提交分组和 commit message，不声称已提交。
