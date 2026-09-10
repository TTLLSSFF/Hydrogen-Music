# 任务 1 报告：服务端固定公共桥接（QQ 榜单详情）

## 实现了什么

在 `server/qqMusicApi.cjs` 新增只读公共白名单端点 `GET /gettoplistdetail`：

- 在 `createQQSecurityMiddleware` 内注入 `topListDetailService`（可在测试中替换）。默认实现复刻上游 `getRanks` 控制器（依赖包 `@sansenjian/qq-music-api` **未导出** `getRanks`，仅导出底层 `UCommon_default` 服务）的精确请求：构造 `musicToplist.ToplistInfoServer/GetDetail` 载荷，`period` 用 ISO 周号，走 `qqServices.UCommon_default(props)` 取 `.data`，返回 `{ status: 200, body: { response: responseData } }` 信封。
- 新增模块级辅助函数 `getWeekNumber`（函数声明，不导出），从上游复刻 ISO 周号算法。
- 新增路由分支（位于歌手详情分支之后、`isQQPathAllowed` 拒绝逻辑**之前**，故无需任何登录 session）：
  - 仅接受 `GET`，否则 `405`；
  - `topId = getSingleValue(ctx.query.topId).trim().replace(/[^0-9]/g, '')` 只保留纯数字，缺失返回 `400`；
  - 固定调用 `{ topId, page: 0, limit: 100 }`；
  - 经 `unwrapServiceResponse` + `sanitizeQQResponseBody` 脱敏后 `writeJson`；
  - 异常走 `502`。

## 测试了什么及结果

`test/qq-server-security.test.mjs` 新增 2 个测试：

1. **无 session 转发 + 参数精确 + 脱敏**：注入 `topListDetailService`，`getSession: () => null`，断言 `GET /getTopListDetail?topId=4` 走到 public 边界（`reached === false`）、`status 200`、调用参数严格为 `[{ topId: '4', page: 0, limit: 100 }]`，返回体不含 `cookie`（`must-not-leak`）与 `token`（`stale-token`）。
2. **缺失 / 非数字 / POST**：缺失 `topId` → `400`；`topId=abc4def` → 归一为 `'4'` → `200`；POST → `405`。

结果：
- 端点文件测试：初始 28 pass → 新增 2 RED（30 tests, 28 pass, 2 fail）→ 实现后 GREEN（30/30 pass）。
- 全量 `npm test`：**131/131 pass**（基线 129 + 新增 2）。

## TDD 证据

**RED**（`node --test test/qq-server-security.test.mjs`）：
```
✖ QQ public toplist detail forwards fixed topId/page/limit without a login session
✖ QQ public toplist detail only accepts a numeric topId and blocks non-GET methods
ℹ tests 30
ℹ pass 28
ℹ fail 2
```

**GREEN**（实现后同命令）：
```
✔ QQ public toplist detail forwards fixed topId/page/limit without a login session
✔ QQ public toplist detail only accepts a numeric topId and blocks non-GET methods
ℹ tests 30
ℹ pass 30
ℹ fail 0
```

## 修改的文件

- `server/qqMusicApi.cjs`（+60）：`getWeekNumber` 辅助函数、`topListDetailService` 注入、`/gettoplistdetail` 路由分支。
- `test/qq-server-security.test.mjs`（+52）：新增 2 个服务端测试。

不修改白名单集合，不导出 `/getRanks`，不读取/转发任何 QQ 凭证。

## 自审发现

对照简报逐条核对，全部满足：
- 无 session 可访问 ✓（路由在 `isQQPathAllowed` 之前，测试用 `getSession:()=>null` 验证）
- 参数精确 `[{ topId: '4', page: 0, limit: 100 }]` ✓（`data` 断言）
- 缺失 `topId` → 400 ✓
- POST → 405 ✓
- 脱敏后无 cookie/token ✓（断言 `must-not-leak` / `stale-token` 不出现）
- 路由在私有代理之前 ✓
- 不动 QQ 凭证 ✓（未加入白名单、不透传多余参数、无凭证读写）

无功能性问题。VSCode 提示 LF→CRLF 换行警告，属本仓库既有状态，无影响。

## 疑虑

无。计划中“计划步骤 3 依赖 `qqController.getRanks`”这一假定已在简报中据实更正为复刻上游控制器请求，实现与该更正一致，且已通过注入测试与全量测试验证。

## 提交

- `16ffa54` feat(qq-music): 开放QQ榜单详情桥接固定topId无session访问