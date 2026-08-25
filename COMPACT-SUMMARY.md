# 会话上下文压缩总结

> 由 `/compact` 生成，记录本轮会话（截至 2026-08-24）的完整技术上下文。

## 1. 需求与意图

### 早期已完成并验证的部分

- 将 `LibraryDetail.vue` 中的「下载」按钮改造为「选择」按钮，点击后展开 4 个子选项：下载、添加到歌单、添加到播放列表、从歌单中删除。
- 修复「添加到播放列表」；点击后「选择」按钮自身消失，只显示子选项；子选项字重与「选择」一致。
- 为子选项展开/收回加上反色背景动画（复用正在播放歌词的背景动画），整条连续；收回速率调慢至与展开匹配；子选项必须在「选择」二字完全消失后才开始展开，「选择」必须在子选项完全收回后才重新出现。
- 展开需紧贴「选择」左侧滑入、不漂移；收回到「选择」重现之间留一点间隔，保证收回动画完整播完。
- 后续修订：背景改为位于子选项**下层**，仅在鼠标悬停时播放；深色模式下背景为白色，与歌词背景、选中歌曲一致。
- 扫码登录：不再让二维码消失，而是缩小到贴合 CONFIRM 框内线；登录失败则刷新新二维码并重新放大。
- 修复多选添加到歌单只添加一首、且不自动退出选择模式；修复多选添加到播放列表提示失败。

### 本轮会话内的请求

1. 「选择」子选项收回时**字体**闪烁 —— 已解决，用户未再提出。
2. 「选择」子选项背景动画收回时，选项**右侧**偶尔残留一点 —— 用户三次反馈未修复（「还是有残留」「问题还在」），第三次修复方案已构建通过但**尚未经用户视觉确认**。

用户全程未提出任何安全相关的指令或约束。

## 2. 关键技术概念

- Vue 3 组合式 API：`ref`、`computed`、`watch`（含自解除监听）、`defineProps`/`defineEmits`/`defineExpose`、`onActivated`/`onDeactivated`/`onUnmounted`、`onBeforeRouteLeave`
- `v-show` 会立即应用 `display: none`，从而取消 CSS `animation-delay` 与 transition —— 这是最初「动画没生效」的根因
- `animation-fill-mode`：`forwards` 只保持**结束**状态，在 `animation-delay` 期间不起作用；`both`（= `backwards` + `forwards`）会在延迟期间预先应用 `0%` 关键帧
- 用 `max-width` 折叠替代切换 `display`，使其可动画
- 通过 `:nth-child(n)` 的错峰 `animation-delay` 实现进出场序列编排
- `::before` 伪元素揭示：项目既有写法是 `translateX(-101%)` → `translateX(0)`，配 `cubic-bezier(0.14, 0.91, 0.58, 1)`
- 亚像素合成：变换层与父级裁剪矩形各自独立取整；Windows 在 125%/150% 分数缩放下裁剪向外取整而层向内取整，留下一条无法用「加大位移距离」消除的细缝
- `transform: scaleX(0)` 配 `transform-origin: left center`，作为「零面积」替代方案
- 伪元素上的 `display: none` 会将其完全移出合成
- CSS 自定义属性主题化：`--ld-selection-bg`、`--ld-selection-text`、`--ld-text`、`--ld-border`、`--ld-btn-bg`、`--ld-btn-text`；深色模式通过 `html.dark` / `.dark` 作用域覆盖
- 用 `pointer-events` 而非 `display` 控制可点击性，以免破坏动画
- SCSS 嵌套、scoped 与非 scoped 样式块、`:global(.dark)`
- `vue-virtual-scroller` 的 `RecycleScroller`，`key-field` 配 `WeakMap` 支撑的稳定行 key
- **`npx vite build` 是唯一可用的验证手段** —— 项目没有 test / lint 脚本（`package.json` scripts 仅有 `dev`、`build`、`preview`、`postinstall`、`serve`）

## 3. 涉及的文件与代码

### `src/components/LibraryDetail.vue`

本轮会话唯一被编辑的文件。承载歌单/专辑详情页头部的操作行，包含「选择」按钮及其子菜单。

**模板（763-788 行）** —— 本轮未改动。`v-show` 早已移除，「选择」常驻 DOM，全选/取消是 `.selection-menu` 的第 5 个子元素：

```vue
<div class="operation-selection-wrapper" v-if="!isSinger" :class="{ 'selection-active': downloadSelectionMode }">
    <div class="operation-selection operation-item" @click="enterSelectionMode">
        <svg t="1735052000000" class="selection-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="200" height="200">
            <path d="M810.666667 128c23.466667 ..."></path>
        </svg>
        <span>选择</span>
    </div>
    <div class="selection-menu" :class="{ 'selection-menu-expanded': selectionMenuExpanded && downloadSelectionMode }">
        <div class="selection-menu-item" @click="downloadSelected">下载</div>
        <div class="selection-menu-item" @click="addSelectedToPlaylist">添加到歌单</div>
        <div class="selection-menu-item" @click="addSelectedToPlayerList">添加到播放列表</div>
        <div class="selection-menu-item" @click="deleteSelectedFromPlaylist">从歌单中删除</div>
        <div class="operation-download-select">
            <button @click="selectAllDownloadSongs()">全选</button>
            <button @click="cancelDownloadSelection()">取消</button>
        </div>
    </div>
</div>
```

**脚本（628-636 行）** —— 未改动，取消时重置三个 ref：

```javascript
const selectAllDownloadSongs = () => {
    selectedDownloadSongs.value = (visibleLibrarySongs.value || []).filter(song => song?.type !== 'local');
};

const cancelDownloadSelection = () => {
    downloadSelectionMode.value = false;
    selectedDownloadSongs.value = [];
    selectionMenuExpanded.value = false;
};
```

**`.selection-menu-item`** —— 最后一次编辑后的当前状态（原约 1135-1173 行）。`::before` 使用 `scaleX`；hover 不再携带背景/反色，这部分移到了限定展开状态的规则里：

```scss
.selection-menu-item {
    margin-left: 15px;
    padding: 4px 10px;
    flex: 0 0 auto;
    font: 15px SourceHanSansCN-Bold;
    font-weight: bold;
    color: var(--ld-text);
    white-space: nowrap;
    position: relative;
    opacity: 0;
    transform: translateX(-20px);
    z-index: 1;
    overflow: hidden;
    transition: color 0.2s ease;
    &::before {
        content: '';
        width: 100%;
        height: 100%;
        position: absolute;
        top: 0;
        left: 0;
        background-color: var(--ld-selection-bg);
        //用左侧为原点的scaleX代替translateX：收起时宽度为0，不存在亚像素取整残留
        //纯色矩形下观感与滑入一致，色块同样是从左向右展开
        transform: scaleX(0);
        transform-origin: left center;
        transition: transform 0.32s cubic-bezier(0.14, 0.91, 0.58, 1);
        z-index: -1;
    }
    &:hover {
        cursor: pointer;
    }
}
//背景与反色只在展开状态下才可能出现，收回瞬间规则即失配，不存在需要收尾的动画
.selection-menu-expanded .selection-menu-item:hover {
    color: var(--ld-selection-text) !important;
    &::before {
        transform: scaleX(1);
    }
}
```

**收回时的复位规则** —— 最后一次编辑后的当前状态：

```scss
//收回时把背景整体撤出渲染：display:none 不参与合成，无论取整如何都不会留下痕迹
.selection-menu:not(.selection-menu-expanded) .selection-menu-item {
    pointer-events: none;
    color: var(--ld-text) !important;
    &::before {
        display: none;
    }
}
```

**错峰序列编排** —— `forwards` → `both` 是闪烁修复（1170-1172 行与 1197-1199 行）：

```scss
.selection-menu-expanded .selection-menu-item,
.selection-menu-expanded .operation-download-select {
    animation: selection-item-slide-in 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) both;
    &:nth-child(1) { animation-delay: 0.25s; }
    &:nth-child(2) { animation-delay: 0.3s; }
    &:nth-child(3) { animation-delay: 0.35s; }
    &:nth-child(4) { animation-delay: 0.4s; }
    &:nth-child(5) { animation-delay: 0.45s; }
}
.selection-menu:not(.selection-menu-expanded) .selection-menu-item,
.selection-menu:not(.selection-menu-expanded) .operation-download-select {
    animation: selection-item-slide-out 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) both;
    &:nth-child(1) { animation-delay: 0.2s; }
    &:nth-child(2) { animation-delay: 0.15s; }
    &:nth-child(3) { animation-delay: 0.1s; }
    &:nth-child(4) { animation-delay: 0.05s; }
    &:nth-child(5) { animation-delay: 0s; }
}
@keyframes selection-item-slide-in {
    0%   { opacity: 0; transform: translateX(-20px); }
    100% { opacity: 1; transform: translateX(0); }
}
@keyframes selection-item-slide-out {
    0%   { opacity: 1; transform: translateX(0); }
    100% { opacity: 0; transform: translateX(-20px); }
}
```

**`.selection-menu` 容器**（本轮调整了约 1131-1134 行）—— 收回时只折叠宽度；`opacity` 在 0.48s 时在各项淡出之后直接归零，容器不再与逐项淡出相乘：

```scss
.selection-menu {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 0;
    max-width: 0;
    margin-left: 0;
    overflow: visible;
    opacity: 0;
    transition: max-width 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) 0.05s, opacity 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) 0.05s, margin-left 0.28s cubic-bezier(0.14, 0.91, 0.58, 1) 0.05s;
    position: relative;
    z-index: 1;
}
.selection-menu-expanded { max-width: 600px; margin-left: 0; opacity: 1; }
```

**包裹层状态规则**（本轮未改动）—— 折叠隐藏的「选择」使其不占布局，收回延迟经过调校，确保它只在子选项结束后才回来：

```scss
.operation-selection-wrapper.selection-active .operation-selection {
    opacity: 0;
    max-width: 0;
    pointer-events: none;
    transition: opacity 0.15s ease 0s, max-width 0.2s cubic-bezier(0.14, 0.91, 0.58, 1) 0.15s;
}
.operation-selection-wrapper:not(.selection-active) .operation-selection {
    transition: opacity 0.2s ease 0.73s, max-width 0.2s cubic-bezier(0.14, 0.91, 0.58, 1) 0.58s;
}
```

**`.operation-download-select`**（本轮未改动）—— 移除了自身动画，改用 `pointer-events` 控制：

```scss
.operation-download-select {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: 15px;
    flex: 0 0 auto;
    opacity: 0;
    transform: translateX(-20px);
    button {
        min-width: 38px;
        height: 22px;
        padding: 0 8px;
        border: 1px solid var(--ld-border);
        background: transparent;
        color: var(--ld-text);
        font: 11px SourceHanSansCN-Bold;
        transition: 0.2s;
        &:hover { cursor: pointer; background-color: var(--ld-btn-bg); color: var(--ld-btn-text); }
        &:active { transform: scale(0.94); }
    }
}
.operation-download-select button { pointer-events: none; }
.selection-menu-expanded .operation-download-select button { pointer-events: auto; }
```

**主题变量**（早期工作，仍然有效）：浅色 `--ld-selection-bg: #000000; --ld-selection-text: #ffffff;`；深色在 `html.dark .library-detail, .dark .library-detail` 下覆盖为 `--ld-selection-bg: #ffffff; --ld-selection-text: #0f1114;`

### `src/components/LibrarySongList.vue`

用户要求复用的那个动画的参考实现。本轮未读取、未编辑。其 `.list-item` 写法：

```scss
&::before {
    content: '';
    width: 100%; height: 100%;
    position: absolute; top: 0; left: 0;
    background-color: black;
    transform: translateX(-101%);
    transition: transform 0.32s cubic-bezier(0.14, 0.91, 0.58, 1);
    z-index: 0;
}
```

相关待解问题：该参考实现用的是 `translateX(-101%)`，而用户从未反馈它有残留 —— 这可能意味着 `.selection-menu-item` 的残留取决于它自身特有的某个因素（它的 `padding`、它处于一个正在折叠的 flex 容器中、或父级 `max-width` 动画的并发执行）。

### `src/components/LoginByQRCode.vue`

526 行，在早前部分读过；本轮未触碰。`loging` 取值：-2（恢复）、-1（空闲）、1（已扫码/等待确认 → 缩小）、3（成功 → 播放动画）；`.qrcode` 基础 26vh，配 `transition: all 0.3s cubic-bezier(0.14, 0.91, 0.58, 1)`；`.qrcode-hiding { width: 22vh !important; height: 22vh !important; opacity: 0.3; }`；`DataCheckAnimaton` 仅在 `loging == 3` 时出现；轮询由 `pollingSessionId` / `qrLoadSessionId` 两个世代计数器加上 `pollingInFlight` 和 `loginCompleted` 守卫。

### `src/components/ContextMenu.vue`

早前为批量添加到歌单做过修改；本轮未触碰：

```javascript
const items = otherStore.selectedItems && otherStore.selectedItems.length > 0
  ? otherStore.selectedItems
  : [otherStore.selectedItem]
const trackIds = items.map(item => item.id).join(',')
```

### `CHANGES.md`

早前读过。其「技术实现」一节现已过时：只描述了 `@keyframes selection-item-slide-in`，未提及包裹层 / `selection-active` 方案、全选/取消移入菜单内部、`both` 填充模式，以及 `scaleX` / `display: none` 的背景处理。

## 4. 错误与修复

### 子选项文字收回时闪烁

用户原话：「”选择“的子选项收回时字体会闪烁」。

成因：`animation-fill-mode: forwards` 只保持结束状态，因此在每一项的 `animation-delay` 期间元素退回其基础 `opacity: 0`，随后动画从 `0%`（`opacity: 1`）开始淡出 —— 文字先消失、再突然出现、然后才淡出。

修复：两条错峰规则均改为 `both`，使 `0%` 关键帧在延迟期间被预先应用。同时移除容器在收回时与之竞争的 `opacity` 1→0 过渡（它会与逐项淡出相乘）—— 容器现在只折叠宽度，`opacity` 在 0.48s 直接归零。用户未再提出异议，视为已解决。

### 背景在选项右侧残留（偶发，收回时）

用户三次反馈：「有时候选项右侧会残留一点」→「还是有残留」→「问题还在」。共尝试三次：

1. **被用户否定。** 当时判断 0.32s 的背景回滑长于 0.28s 的逐项淡出，且分数宽度导致取整误差。应用了 `:not(.selection-menu-expanded)` 下的 `transition: none; transform: translateX(-102%)`，外加 `::before` 上的 `width: calc(100% + 2px); left: -1px`。用户回复：「还是有残留」。

2. **被用户否定。** 重新判断为变换层与父级裁剪矩形各自独立取整（Windows 分数显示缩放），加大位移距离无法解决。将 `::before` 改为 `transform: scaleX(0)` / `scaleX(1)` 配 `transform-origin: left center`；同时把 1px / `-102%` 的补丁回退为 `width: 100%; left: 0`。用户回复：「问题还在」。

3. **当前方案，尚未确认。** 停止调整几何尺寸，改为把元素从渲染中移除：收回期间 `::before { display: none; }`，并加上 `color: var(--ld-text) !important` 以免文字被留在反色状态；同时将 hover 规则限定为 `.selection-menu-expanded .selection-menu-item:hover`，使 expanded 类一被移除，背景与反色的声明立即失配，不留任何需要收尾的进行中动画。构建通过；用户尚未回应。

### 早期修复（仍然有效）

- `v-show` 破坏动画 —— 已移除，改为 opacity + `max-width` + `pointer-events`
- 全选/取消没有收回动画 —— 移入 `.selection-menu` 作为第 5 个子元素，移除 `v-if`
- 展开/收回速率不匹配 —— 收回统一为 0.28s，延迟反向 0.2→0s，容器同步镜像
- 深色模式文字不反色 —— 非 scoped 块中的嵌套 `&` 改为 `--ld-selection-bg` / `--ld-selection-text` 变量
- 二维码变大而非缩小 —— 27.6vh → 22vh
- 成功动画在扫码时而非确认时触发 —— `loging` 拆分为 1 与 3
- 多选添加到歌单只加一首 —— 通过 `otherStore.selectedItems` 传数组，`ContextMenu.vue` 处理数组，对 `addPlaylistShow` 加自解除 `watch` 以退出选择模式
- 多选添加到播放列表失败 —— 移除未使用的 `addToList` 导入，改为循环 `addToNext`

### 构建情况

本轮三次 `npx vite build` 全部成功 —— `✓ built in 10.83s`、`✓ built in 7.11s`、`✓ built in 13.07s`。唯一的警告是既有且无关的：某个 chunk 超过 1000 kB。

## 5. 问题解决状况

**已解决**：收回时的文字闪烁，靠 `animation-fill-mode: both` 加上移除容器竞争性 opacity 过渡。

**仍在进行**：右侧背景残留。已尝试三种不同假设 —— 动画时长不匹配、亚像素取整加 padding 补偿、变换类型改为 `scaleX` —— 前两种被用户明确否定。当前方案完全绕开几何问题：把 `::before` 移出合成（`display: none`），并限定 hover 规则使其在收回瞬间失配。已编译通过，但未经视觉验证。

**若仍未修复**：应彻底放弃几何这条前提。值得追查的未验证线索 —— 父级 `.selection-menu` 在 `max-width` 从 600px 动画到 0 的同时是 `overflow: visible`，因此子元素在折叠过程中可能被绘制在容器盒子之外；所谓「残留」可能不是伪元素在其自身右边缘，而是折叠中途被容器裁切的选项本身。另外也值得确认残留是否其实是 `.operation-download-select` 按钮的 `background-color` hover 状态，或相邻选项的背景，而非被悬停项自己的 `::before`。用 devtools 确认**究竟是哪个元素**绘制了这条细缝，比再猜一次 CSS 更有价值。

**我从未验证过的部分**：运行时视觉行为。项目没有 test / lint 脚本，因此动画时序、深色模式外观、残留行为全都需要用户亲眼确认或开 `npm run dev` 会话。

## 6. 用户消息全记录

1. 修复"添加到播放列表"功能、将"选择"选项卡改成点击"选择"的时候"选择"按钮消失，只显示子选项卡，将子选项的字体调粗至和"选择"按钮字体相同
2. 给"选择"选项卡子选项弹出和收回加上背景动画，动画直接用正在播放歌词的反色背景动画就可以；选项卡收回时没有动画，给他添加上回缩的动画衔接"选择"按钮的重新显示 我刚才是这么说的，补充：[中断后继续] 背景动画包含在整个四个选项卡后面一整条，回缩动画和展开动画速率不匹配，调慢回缩动画速率；展开和关闭"选择"选项卡的时候动画要等"选择"二字完全消失之后再开始弹出子选项卡，同理，在子选项卡完全关闭消失之后再重新显示"选择二字"
3. 展开动画应该是紧贴着"选择"二字的左侧开始滑入，不要漂移 收回动画到"选择"二字出现之间可以有一点间隔，保证收回动画可以完整播放完之后再显示"选择"按钮
4. 还是改成背景在子选项下边，鼠标指针悬停在上面时再播放动画；动画在深色模式下应为白色背景，和歌词背景、选择中的歌曲一样
5. "深色模式：白色背景 + 黑色文字"没有生效
6. 字体没有反色，白底下根本看不见
7. 深色模式下字体还是白色背景上显示白色字体
8. 还是没修好
9. 更改扫码登录的动画：在扫码成功并且在手机上已经确认登陆之后立刻让二维码消失并播放登陆成功的动画 更正：在用户扫描二维码等待确认的时候，就令二维码消失，如果没有登陆成功的话就重新生成一个新的二维码
10. 扫描之后二维码还在 [中断] 动画错乱，还没有点确认就自动播放登陆成功的动画
11. 取消二维码的消失效果，而是让二维码缩小到贴合CONFIRM框的内线；如果登陆失败则刷新新的二维码并重新放大
12. 应当缩小的，但是变成放大了
13. 多选歌曲添加到歌单时只会添加一首，并且添加完之后不会自动退出选择模式；多选歌曲添加到播放列表时会显示添加失败
14. 继续
15. "选择"的子选项收回时会闪烁 —— [请求被用户中断] —— "选择"的子选项收回时字体会闪烁
16. "选择"选项卡的子选项背景动画收回时有时候选项右侧会残留一点
17. 还是有残留
18. 问题还在

用户全程未给出任何安全相关的指令或约束。

## 7. 待办事项

子选项收回时的右侧背景残留仍未关闭。用户已三次反馈未修复；第三次修复尝试已编译通过，但未获确认。

## 8. 当前工作

紧接本次压缩之前，我在 `src/components/LibraryDetail.vue` 中进行残留问题的第三次尝试。在两个基于几何的修复被用户否定（「还是有残留」「问题还在」）之后，我放弃调整尺寸，转而在收回期间把背景从渲染中移除。

应用了两处编辑。第一，把 hover 声明从基础规则中拆出，使背景与反色只可能在菜单展开时匹配：

```scss
&:hover {
    cursor: pointer;
}
}
//背景与反色只在展开状态下才可能出现，收回瞬间规则即失配，不存在需要收尾的动画
.selection-menu-expanded .selection-menu-item:hover {
    color: var(--ld-selection-text) !important;
    &::before {
        transform: scaleX(1);
    }
}
```

第二，收回规则现在把 `::before` 完全移出合成，并强制文字颜色复位：

```scss
//收回时把背景整体撤出渲染：display:none 不参与合成，无论取整如何都不会留下痕迹
.selection-menu:not(.selection-menu-expanded) .selection-menu-item {
    pointer-events: none;
    color: var(--ld-text) !important;
    &::before {
        display: none;
    }
}
```

随后 `npx vite build` 返回 `✓ built in 13.07s`，仅有既有的 >1000 kB chunk 警告。该次尝试的结论已在压缩前向用户报告。

## 9. 下一步

等待用户对第三次尝试的视觉确认。

若用户第四次反馈残留仍在，**不要再做盲目的 CSS 改动** —— 请用户指出究竟是哪个元素绘制了这条细缝，或者去核查真正的元凶是否是父级 `.selection-menu` 在 `max-width` 600px → 0 动画期间保持 `overflow: visible`，从而让子元素绘制到折叠中的盒子之外，而非 `::before` 本身。

用户在此问题上最近的原话正是「问题还在」，之前是「还是有残留」，最初是「”选择“选项卡的子选项背景动画收回时有时候选项右侧会残留一点」。
