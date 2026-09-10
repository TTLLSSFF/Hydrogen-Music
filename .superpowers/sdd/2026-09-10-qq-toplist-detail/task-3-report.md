# 任务 3 报告：QQ 公共榜单详情

## RED 证据

新增 `test/qq-toplist-detail-flow.test.mjs` 后，先将 Store 的榜单类型条件临时改为 `toplist-red`。执行：

```powershell
node --test test/qq-toplist-detail-flow.test.mjs
```

结果为 1 个失败：公共榜单测试实际调用 `updateQQPlaylistDetail('4')`，而断言要求 `updateQQTopListDetail('4')`。随后恢复条件为 `toplist`，测试通过。

## 实现范围

- `src/store/libraryStore.js`
  - QQ 且 `type=toplist` 时改走 `updateQQTopListDetail`。
  - 该方法使用 `getQQTopListDetail` 和 `normalizeQQTopListDetail`，写入标准化歌曲、搜索索引、`libraryInfo.source='qq'` 和已完成的 hydration 状态。
  - QQ 私人歌单继续走原有 `updateQQPlaylistDetail`，网易云分支未变。
- `src/router/router.js`
  - 将 `query.type` 纳入详情重新加载条件。
  - 仅 QQ 公共榜单绕过 QQ My Music 登录校验，并向 Store 转发 `source`、`type`。
- `src/components/LibraryDetail.vue`
  - 同页详情跳转采用相同的公共榜单豁免并转发规范化参数。
- `src/components/RecListItem.vue`
  - QQ 首页仅排行榜卡片（`recType === 3`）跳转至带 `source=qq&type=toplist` 的公开详情；其他 QQ 首页入口继续阻断。
- `test/qq-toplist-detail-flow.test.mjs`
  - 覆盖公共榜单 Store 分流、QQ 私人歌单与网易云分流保持不变，以及公开路由意图。

## 验证

- `node --test test/qq-toplist-detail-flow.test.mjs`：3 通过，0 失败。
- `npm test`：137 通过，0 失败。
- `npm run build`：成功。
- 编辑文件语言诊断：无错误。

## 自审

- 公共榜单分支只调用 QQ 公共榜单 API，不触发 QQ 私人 `disstid` 加载器或网易云详情加载器。
- `libraryInfo.source='qq'` 保留既有 QQ 只读写保护。
- 未开放视频或 MV，未添加敏感 URL 或上游 URL 转发能力。
- 构建仍显示项目既有的动态/静态导入及大 chunk 警告；不影响构建结果。

## Commit

`4a64c1a feat(qq-music): 开放公共榜单详情`
