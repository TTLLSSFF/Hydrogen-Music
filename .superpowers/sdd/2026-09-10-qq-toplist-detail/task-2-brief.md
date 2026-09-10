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