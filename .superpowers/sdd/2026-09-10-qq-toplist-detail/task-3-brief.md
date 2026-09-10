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