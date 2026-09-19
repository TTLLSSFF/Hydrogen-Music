# QQ 音乐公共榜单详情实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 QQ 首页排行榜能够进入无需登录、只读且可播放的公共榜单详情页。

**架构：** 服务端以固定的 `/getTopListDetail` 白名单端点桥接依赖包的 `/getRanks?topId=` 控制器，并脱敏返回结果。前端在 `qqMusic.js` 中请求和标准化该响应，Store 使用显式 `type=toplist` 分流，路由与详情页仅对该公共类型绕过 QQ 私人音乐登录校验。

**技术栈：** Vue 3、Pinia、Vue Router、Koa 风格中间件、Node `node:test`、`@sansenjian/qq-music-api`。

---

## 文件职责

- `server/qqMusicApi.cjs`：受控公共榜单详情服务、请求参数校验与响应脱敏。
- `test/qq-server-security.test.mjs`：验证公共榜单详情不依赖登录、方法和参数限制、敏感字段过滤。
- `src/api/qqMusic.js`：公共榜单请求与上游响应至共享歌曲/歌单模型的标准化。
- `test/qq-music-adapters.test.mjs`：验证 `topId` 协议和标准化后的 QQ 来源字段。
- `src/store/libraryStore.js`：按 `type=toplist` 加载 QQ 榜单，不走 `disstid` 私人歌单逻辑。
- `src/router/router.js`：允许 QQ 公共榜单进入详情，并把类型传给 Store。
- `src/components/LibraryDetail.vue`：同页详情切换时保留公共榜单登录豁免和类型。
- `src/components/RecListItem.vue`：QQ 首页榜单点击使用 `source=qq&type=toplist`。
- `docs/qq-music-api-capabilities.md`：更新榜单详情能力状态与只读边界。

### 任务 1：服务端固定公共桥接

**文件：**
- 修改：`server/qqMusicApi.cjs`
- 测试：`test/qq-server-security.test.mjs`

- [ ] **步骤 1：编写失败的服务端测试**

在 `qq-server-security.test.mjs` 为 `GET /getTopListDetail?topId=4` 添加测试，注入 `topListDetailService`，断言无 session 也会调用服务，参数严格为：

```js
[{ topId: '4', page: 0, limit: 100 }]
```

再覆盖缺少 `topId` 的 `400`、POST 的 `405`，以及响应中的 `cookie` / `token` 未出现在返回体。

- [ ] **步骤 2：运行服务端测试确认失败**

运行：

```powershell
node --test test/qq-server-security.test.mjs
```

预期：新端点尚未处理，测试失败。

- [ ] **步骤 3：实现最小白名单端点**

在 `createQQSecurityMiddleware` 注入：

```js
const topListDetailService = options.topListDetailService || (async ({ topId, page, limit }) =>
  qqController.getRanks({
    method: 'get',
    params: { topId, page, limit },
    option: {},
  })
)
```

在私有会话和通用代理判断之前处理 `/gettoplistdetail`：仅接受 GET、仅接受数字 `topId`，调用服务时固定 `page: 0, limit: 100`，通过 `unwrapServiceResponse` 与 `sanitizeQQResponseBody` 返回。不要将 `/getRanks` 暴露给浏览器，也不要读取或转发任何 QQ 凭证。

- [ ] **步骤 4：运行服务端测试确认通过**

运行：

```powershell
node --test test/qq-server-security.test.mjs
```

预期：全部通过。

### 任务 2：前端请求与共享模型适配

**文件：**
- 修改：`src/api/qqMusic.js`
- 测试：`test/qq-music-adapters.test.mjs`

- [ ] **步骤 1：编写失败的适配器测试**

添加请求测试，调用 `getQQTopListDetail('4')` 后断言 URL 含 `/getTopListDetail` 与 `topId=4`，且不含 `disstid`。

添加标准化测试，使用依赖控制器返回的 `response.req_1.data` 包络和一首 QQ 歌曲，断言：

```js
assert.equal(detail.playlist.id, '4')
assert.equal(detail.playlist.source, 'qq')
assert.equal(detail.songs[0].source, 'qq')
assert.equal(detail.songs[0].sourceKey, 'qq:001Bbywq2gicae')
```

- [ ] **步骤 2：运行适配器测试确认失败**

运行：

```powershell
node --test test/qq-music-adapters.test.mjs
```

预期：新 API 和适配器尚未导出，测试失败。

- [ ] **步骤 3：实现请求与适配器**

新增：

```js
export function getQQTopListDetail(topId, params = {}) {
  if (!topId) throw new TypeError('QQ top list id is required')
  return qqRequest({ url: '/getTopListDetail', method: 'get', params: { topId, ...params } })
}
```

新增 `normalizeQQTopListDetail(payload, fallbackId)`：解包 `response.req_1.data` 或等价嵌套，读取 `songInfoList`、`songList` 或 `list` 中第一个数组；读取可用的标题、封面、简介、歌曲总数；生成 `source: 'qq'` 的 playlist；全部歌曲使用现有 `normalizeQQSong()`。

- [ ] **步骤 4：运行适配器测试确认通过**

运行：

```powershell
node --test test/qq-music-adapters.test.mjs
```

预期：全部通过。

### 任务 3：详情数据流与公共路由

**文件：**
- 修改：`src/store/libraryStore.js`
- 修改：`src/router/router.js`
- 修改：`src/components/LibraryDetail.vue`
- 修改：`src/components/RecListItem.vue`

- [ ] **步骤 1：实现 Store 类型分流**

在 `updateLibraryDetail` 的 playlist 分支中按以下顺序分流：

```js
if (source === 'qq' && options.type === 'toplist') {
  await this.updateQQTopListDetail(id)
} else if (source === 'qq') {
  await this.updateQQPlaylistDetail(id)
} else {
  await this.updatePlaylistDetail(id, { ...options, source })
}
```

`updateQQTopListDetail` 动态导入新 API，设置 `libraryInfo`、`librarySongs`，索引歌曲，并以已完成状态设置 `playlistHydration`。禁止调用 `getQQSongListDetail` 或 `loadQQPlaylistDetail`。

- [ ] **步骤 2：实现路由与同页跳转豁免**

在 `router.js` 和 `LibraryDetail.vue` 都用同一判断：

```js
const isQQTopList = source === 'qq' && String(type || '').toLowerCase() === 'toplist'
```

仅当它不是公共榜单时调用 `canAccessQQMyMusic`。所有 playlist 详情加载参数均携带 `type`；路由重新加载条件也比较 `type`，避免错误复用不同资源类型的缓存。

- [ ] **步骤 3：开放首页入口**

修改 `RecListItem.vue`：当当前数据源为 QQ 且 `recType === 3` 时跳转：

```js
router.push({
  path: `/mymusic/playlist/${id}`,
  query: { source: 'qq', type: 'toplist' },
})
```

其余首页卡片维持原有行为，不开放视频/MV。

- [ ] **步骤 4：核对只读与播放链路**

确认详情页的 `libraryInfo.source === 'qq'`，使现有收藏、下载、歌单写操作拦截继续生效；确认 `playAll` 和歌曲搜索继续使用标准化 QQ 歌曲。

### 任务 4：完整验证、烟雾测试与能力文档

**文件：**
- 修改：`docs/qq-music-api-capabilities.md`

- [ ] **步骤 1：更新能力文档**

将 QQ 榜单详情状态更新为已实现，说明使用公共 `topId`，非 `disstid`；记录公共访问、前 100 首、播放/歌词可用，以及只读限制和不实现视频/MV。

- [ ] **步骤 2：运行完整自动验证**

运行：

```powershell
node --test test/qq-server-security.test.mjs
node --test test/qq-music-adapters.test.mjs
npm test
npm run build
```

预期：全部通过，构建无错误。

- [ ] **步骤 3：受控真实上游烟雾测试**

启动项目服务后通过本地端点访问：

```text
/getTopListDetail?topId=4
```

确认 HTTP 成功、返回歌曲可被 `normalizeQQSong()` 处理、返回体不含 Cookie、token、qrsig、ptqrtoken。若 Chrome 远程调试仍不可用，使用项目本地服务的无登录公共请求完成验证，不操作用户浏览器标签。

- [ ] **步骤 4：审查变更并提交**

检查受影响文件与测试结果；仅在用户再次要求时创建提交并推送。
