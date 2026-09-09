# 播放页大队列动画性能优化交接

## 交接目的

本文件用于把“播放列表歌曲较多时打开播放页动画掉帧”的当前实现和验证方式交给其他 AI Agent。目标是保持现有动画的视觉效果、时长和缓动不变，只减少播放页打开时主线程的同步工作。

## 当前状态

- 工作区分支：`main`。
- 当前改动尚未提交，不能使用 `git reset --hard` 或 `git checkout --` 清理工作区。
- 优化的核心代码和回归验证已经完成，是否提交由用户或后续 Agent 决定。
- QQ 音乐、网易云音乐混合播放列表仍使用同一套列表组件和播放逻辑。

## 问题根因

播放页和底部小窗此前会同时挂载两个 `PlayList` 组件。即使其中一个表面上不可见，两个虚拟列表仍会同时响应 5,000 首歌曲队列的响应式更新、计算和 DOM 更新。打开播放页时，这些工作会与专辑图和歌词的既有动画竞争主线程，造成首帧延迟和掉帧。

## 已采用的方案

### 1. 两个播放列表表面互斥挂载

`widgetState` 表示当前播放界面：

- `true`：只挂载底部小窗中的 `.playlist-widget`。
- `false`：只挂载播放页中的 `.playlist-widget-player`。

组件仍保留原有 CSS class、动画时长、缓动和 DOM 内部结构；变化仅在于隐藏的另一份列表不再挂载。

相关文件：

- `src/components/MusicWidget.vue`
- `src/components/Player.vue`
- `src/utils/player/playlistRuntime.mjs`

### 2. 播放列表显示状态立即同步

`MusicWidget.vue` 和 `Player.vue` 中的 `playlistWidgetShow` watcher 使用 `{ immediate: true }`。这样在组件初次创建时，如果队列已经处于打开状态，正确的列表表面会立即加载，不需要等待下一次状态变化。

### 3. 稳定的虚拟列表 key

`PlayList.vue` 使用 `getPlaylistItemKey(song, index)` 生成 key。key 包含歌曲来源身份和队列位置，因此：

- QQ 音乐和网易云音乐的同 ID 歌曲不会冲突。
- 同一首歌在队列中重复出现时仍然有唯一 key。
- 不会因为列表重挂载而错误复用另一来源歌曲的行组件。

### 4. 外部点击关闭逻辑适配互斥挂载

`src/utils/player.js` 通过 `shouldClosePlaylistOnExternalClick` 检查实际存在的列表元素。以前逻辑要求小窗列表和播放页列表同时存在；互斥挂载后，这会导致外部点击无法关闭列表，因此新增的运行时辅助函数同时覆盖只有小窗或只有播放页的情况，并保留删除项例外逻辑。

## 相关文件清单

| 文件 | 作用 |
| --- | --- |
| `src/components/MusicWidget.vue` | 小窗列表的按需挂载和立即加载 watcher |
| `src/components/Player.vue` | 播放页列表的按需挂载和立即加载 watcher |
| `src/components/PlayList.vue` | 虚拟列表行 key 生成 |
| `src/utils/player.js` | 播放列表外部点击关闭桥接 |
| `src/utils/player/playlistRuntime.mjs` | 表面选择、稳定 key、外部点击判断的纯函数 |
| `test/playlist-runtime.test.mjs` | 表面选择和列表 key 单测 |
| `test/playlist-close.test.mjs` | 互斥挂载下的外部点击关闭单测 |
| `scripts/test-player-open-performance.mjs` | Chromium 端到端性能回归脚本 |
| `package.json` | 新增 `test:player-open-performance` 命令 |

## 不要改动的约束

后续 Agent 处理本问题时必须保持以下约束：

1. 不修改播放页专辑图展开动画的 CSS、时长、缓动或关键帧。
2. 不修改歌词加载动画的视觉效果或时序，除非用户提出新的独立需求。
3. 不为了保留列表滚动位置而恢复两个 `PlayList` 实例同时挂载；这会重新引入大队列主线程竞争。
4. 不删除 QQ 音乐与网易云音乐混合队列的来源身份和重复歌曲 key 逻辑。
5. 不把 QQ Cookie、登录信息或播放凭证写入服务端、响应体或日志。

## 验证命令

在仓库根目录 `D:\Finalshell\project\Hydrogen-Music` 执行：

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:player-open-performance
git diff --check
```

性能脚本会启动临时 Vite 和 Chromium，注入 5,000 首歌曲，然后打开播放页并检查：

- 小窗列表数量为 `0`。
- 播放页列表数量为 `1`。
- 虚拟列表实际行数小于 `100`。
- 首个动画帧延迟小于 `500 ms`。
- 打开过程中的 long task 不超过 `1` 个。

脚本需要本机安装 Chrome 或 Edge；也可以通过 `CHROME_PATH` 指定 Chromium 可执行文件。脚本会自动清理临时浏览器 profile 和子进程。

## 已知取舍

切换小窗和播放页时，`PlayList` 会随活动表面重挂载，因此列表滚动位置可能回到默认位置。这是为了保证任意时刻只有一个 5,000 首队列虚拟列表参与更新。除非有明确的产品需求和新的性能方案，不要为恢复滚动位置而恢复双实例挂载。

## 接手流程

1. 先运行 `git status --short`，确认不要覆盖本交接之外的用户改动。
2. 阅读上面的相关文件，优先查看 `playlistRuntime.mjs` 和两个容器组件的 `PlayList` 条件。
3. 先运行完整测试和性能脚本，再进行任何优化；记录首帧延迟、long task、列表数量和虚拟行数。
4. 如果需要继续优化，只允许围绕响应式更新、组件挂载时机或虚拟列表计算进行，并保留现有动画参数。
5. 修改后重新运行全部验证命令，并在交接文档末尾补充日期、改动和结果。

## 最近一次验证结果

验证日期：2026-09-09。

- `npm.cmd test`：106 项通过，0 项失败。
- `npm.cmd run build`：成功；仅保留项目原有的大 chunk 警告。
- `npm.cmd run test:player-open-performance`：通过。
  - 首帧延迟：`130.4 ms`。
  - long task：`[50 ms]`，不超过脚本阈值。
  - 活动小窗列表：`0`。
  - 活动播放页列表：`1`。
  - 虚拟列表实际行数：`6`。
- `git diff --check`：通过。

独立只读审查期间再次运行性能脚本得到首帧 `95.4 ms`、1 个 `105 ms` long task，列表表面和虚拟行数结果相同。首帧和 long task 时长会受本机浏览器、CPU 调度和后台进程影响；判断回归时应关注“只挂载一个列表、保持虚拟化、long task 数量不超过阈值”，不要把单次毫秒数当作固定基线。

## 当前待办

- [x] 确认当前 Agent 最后一次 `npm.cmd test`、`npm.cmd run build` 和性能脚本输出。
- [x] 检查完整 diff，确认没有与本问题无关的代码变更。
- [ ] 是否提交由用户或后续 Agent 决定。

## 后续验证记录

验证日期：2026-09-09（接手复核，无代码改动）。

- `npm.cmd test`：106 项通过，0 项失败。
- `npm.cmd run build`：成功；仅保留项目原有的大 chunk 警告。
- `npm.cmd run test:player-open-performance`：通过。
  - 首帧延迟：`107.6 ms`。
  - long task：`[]`（0 个），低于阈值。
  - 活动小窗列表：`0`；活动播放页列表：`1`。
  - 虚拟列表实际行数：`6`。
- `git diff --check`：通过。
