# Agent 交接：播放页大队列动画性能优化

更新时间：2026-09-09  
项目：Hydrogen Music  ���  当前任务：优化播放列表歌曲较多时打开播放页的掉帧问题

## 1. 当前结论

本次优化已经完成，目标是减少打开播放页时的主线程竞争，同时保持现有动画效果不变。

在 5,000 首歌曲队列的 Chromium 实测中，打开播放页后只保留一个可见的播放列表虚拟滚动组件，首帧延迟约为 93–101 ms，没有观察到长任务，虚拟列表渲染行数保持在 100 行以内。

当前工作区的改动尚未提交。请保留这些改动，不要使用 `git reset --hard` 或 `git checkout --` 覆盖工作区。

## 2. 根因与实现

播放页和底部小窗此前会同时挂载两个 `PlayList`。即使其中一个被动画隐藏，它仍然会响应同一个 5,000 首队列的响应式更新和虚拟滚动计算。打开播放页时，两个组件会与展开动画、歌词加载共同竞争主线程，造成掉帧。

本次采用“单一播放列表表面”的方案：

1. `widgetState === true` 时，只挂载小窗的 `PlayList`。
2. `widgetState === false` 时，只挂载播放页的 `PlayList`。
3. 列表仍使用原有 `vue-virtual-scroller`，没有改动画 CSS、动画时长、缓动函数或视觉结构。
4. 播放列表项使用来源身份与队列下标组成稳定 key，兼容 QQ 音乐、网易云音乐混合队列，以及同一首歌重复出现的情况。
5. 外部点击关闭逻辑改为只检查当前实际挂载的列表表面，避免互斥挂载后因为找不到另一份 DOM 而无法关闭。

## 3. 已修改文件

| 文件 | 作用 |
| --- | --- |
| [`src/components/MusicWidget.vue`](../src/components/MusicWidget.vue) | 小窗只在自身为活动表面时挂载 `PlayList`；`playlistWidgetShow` watcher 增加 `immediate`。 |
| [`src/components/Player.vue`](../src/components/Player.vue) | 播放页只在自身为活动表面时挂载 `PlayList`；`playlistWidgetShow` watcher 增加 `immediate`。 |
| [`src/components/PlayList.vue`](../src/components/PlayList.vue) | 使用统一的 `getPlaylistItemKey` 生成虚拟列表 key。 |
| [`src/utils/player.js`](../src/utils/player.js) | 使用新的外部点击判断函数，适配只挂载一个列表表面的情况。 |
| [`src/utils/player/playlistRuntime.mjs`](../src/utils/player/playlistRuntime.mjs) | 新增活动表面、列表项 key 和外部点击判断的纯函数。 |
| [`test/playlist-runtime.test.mjs`](../test/playlist-runtime.test.mjs) | 覆盖活动表面选择和混合来源/重复歌曲 key。 |
| [`test/playlist-close.test.mjs`](../test/playlist-close.test.mjs) | 覆盖小窗、播放页、控件、右键菜单和删除项例外的关闭逻辑。 |
| [`scripts/test-player-open-performance.mjs`](../scripts/test-player-open-performance.mjs) | 新增 Chromium 性能回归脚本，注入 5,000 首队列并测量打开播放页。 |
| [`package.json`](../package.json) | 增加 `test:player-open-performance` 脚本。 |

## 4. 验证命令

在 Windows PowerShell 中执行：

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:player-open-performance
git diff --check
```

已知结果：

- `npm.cmd test`：105 项通过。
- `npm.cmd run build`：成功。
- `npm.cmd run test:player-open-performance`：通过。
- 性能脚本示例：`first frame 101.0ms`、`long tasks []`、`widgetLists 0`、`playerLists 1`、`rows 6`。

性能脚本需要本机安装 Chrome 或 Edge；也可以通过 `CHROME_PATH` 指定 Chromium 可执行文件。

## 5. 当前工作区状态

预期状态如下：

```text
M  package.json
M  src/components/MusicWidget.vue
M  src/components/PlayList.vue
M  src/components/Player.vue
M  src/utils/player.js
?? scripts/test-player-open-performance.mjs
?? src/utils/player/playlistRuntime.mjs
?? test/playlist-close.test.mjs
?? test/playlist-runtime.test.mjs
```

`.qq-music-session/` 属于本地 QQ 会话目录，已被 `.gitignore` 忽略。交接、日志和测试输出中不要写入 QQ Cookie、二维码会话或其他登录凭据。

## 6. 已知取舍与后续建议

切换小窗和播放页时，`PlayList` 会因为表面切换而重新挂载，滚动位置可能重置。这是当前为避免两个大队列同时更新而接受的取舍。若后续需要保留滚动位置，应在 Pinia 或局部状态中保存/恢复滚动偏移，并重新验证打开动画性能；不要直接恢复两个 `PlayList` 实例。

后续 Agent 接手时建议按以下顺序操作：

1. 先阅读本文件和 `src/utils/player/playlistRuntime.mjs`。
2. 运行上述四条验证命令，确认基线仍然通过。
3. 若出现掉帧，先用 Chromium Performance 面板或性能脚本确认是否再次出现两个列表表面，再定位具体组件。
4. 若修改列表渲染或动画相关代码，必须同时运行单测、构建和性能回归脚本。

本文件只记录当前播放页性能任务。QQ 音乐登录、歌单、VIP 播放和本地会话等历史功能请结合项目 README、对应 API 模块及最近的 QQ 相关提交一起检查，避免把 QQ 来源曲目误写入网易云状态。
