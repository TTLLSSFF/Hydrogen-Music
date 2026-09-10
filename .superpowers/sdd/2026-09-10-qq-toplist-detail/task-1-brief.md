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
