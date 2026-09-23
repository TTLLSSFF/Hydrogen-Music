# Hydrogen Music

<p align="center">
  <img src="img/icon.png" width="96" alt="Hydrogen Music" />
</p>

<p align="center">
  <strong>基于 Vue 3 与 Electron 的网易云 / QQ 音乐播放器，同时提供 Web 与桌面端。</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/TTLLSSFF/Hydrogen-Music?style=for-the-badge" /></a>
  <a href="https://github.com/TTLLSSFF/Hydrogen-Music/releases"><img alt="Release" src="https://img.shields.io/github/v/release/TTLLSSFF/Hydrogen-Music?style=for-the-badge&label=Release" /></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-38-47848F?style=for-the-badge&logo=electron&logoColor=white" />
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42B883?style=for-the-badge&logo=vuedotjs&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
</p>

<p align="center">
  <a href="#项目定位">项目定位</a>
  ·
  <a href="#功能概览">功能概览</a>
  ·
  <a href="#qq-音乐支持">QQ 音乐支持</a>
  ·
  <a href="#截图预览">截图预览</a>
  ·
  <a href="#安装使用">安装使用</a>
  ·
  <a href="#本地运行">本地运行</a>
  ·
  <a href="#技术栈">技术栈</a>
  ·
  <a href="#项目结构">项目结构</a>
  ·
  <a href="#注意事项">注意事项</a>
  ·
  <a href="#声明与致谢">声明与致谢</a>
</p>

<p align="center">
  <img src="img/home.png" alt="Hydrogen Music 首页" />
</p>

## 项目定位

Hydrogen Music 是一个第三方网易云 / QQ 音乐播放器。当前仓库在上游「复活版」的桌面端基础上继续维护，并围绕浏览器运行场景补齐了一套可独立部署的 Web 产物，因此同一份代码同时支撑两种运行方式：

- 桌面端：Electron 主进程负责本地音乐、音乐视频、MPV/HiFi 输出、桌面歌词窗口、全局快捷键、托盘与窗口状态，并内置网易云与 QQ 音乐 API 服务。
- Web 端：前端产物由本地 Node 服务托管，服务端代理网易云 API、QQ 音乐 API、Monster Siren API、GitHub 只读接口与歌曲下载流。

当前项目重点维护这些内容：

- 账号登录、曲库浏览、搜索、播放队列、歌词、评论、云盘、本地音乐和私人漫游。
- 歌曲解析、无缝衔接、下载与标签写入、播放状态持久化和媒体会话信息。
- 深色模式、自定义字体、歌词显示偏好、音频可视化、背景封面模糊等可选设置。
- 一套可复用的前端产物，以及配套的本地 API 与下载代理服务。

## 功能概览

### 账号与服务

- 支持网易云音乐二维码登录和手机号登录；扫码等待确认时二维码会缩小贴合确认框，登录失败会自动刷新并放大新二维码。
- 支持 QQ 音乐扫码登录，会话由服务端独立持有，可与网易云账号同时登录。
- 内置 `@neteasecloudmusicapienhanced/api` 与 `@sansenjian/qq-music-api`，开发和部署时分别通过 `/api` 与 `/api/qq` 访问本地 API 服务。
- 支持账号状态恢复、登录信息迁移、VIP 信息展示和账号退出。
- 可上报最近播放记录，让官方客户端中也能看到这边产生的播放历史。

### 播放

- 支持标准、较高、极高、无损、Hi-Res、高清环绕声、沉浸环绕声、杜比全景声、超清母带等音质偏好。
- 可播放歌单、专辑、歌手热门歌曲、每日推荐、搜索结果、私人漫游、电台节目、云盘歌曲、本地音乐和 Monster Siren 音源；QQ 音乐来源的歌曲同样可以正常播放。
- 支持顺序播放、列表循环、单曲循环、随机播放、播放队列持久化和断点恢复。
- 支持心动模式：在播放顺序切到「随机」后再点一次即可进入，仅当正在播放「我喜欢的音乐」时可用。切换播放顺序本身不会改动正在播放的队列，进入后会等到下一次切歌（上一首/下一首或自动切歌）才按当前歌曲生成推荐队列，避免调顺序时误触发；再点一次可取消，退出时恢复原歌单。
- 支持歌曲无缝衔接，会预缓冲下一首以减少切歌空隙。
- 支持音频可视化效果，可在设置中开关。
- 支持喜欢歌曲、添加到歌单、下一首播放、评论面板切换和播放列表面板。
- 支持背景封面模糊、歌词模糊、歌曲名翻译显示等播放相关偏好。
- 歌单或专辑详情页的「选择」按钮支持批量操作：点击后展开子菜单（下载、添加到歌单、添加到播放列表、从歌单中删除，以及全选/取消），支持多选歌曲后一次性批量执行；子菜单展开与收回带有歌词同款反色背景动画，并适配深色模式。

### 首页、曲库与搜索

- 首页包含 Banner、推荐歌单和最新歌曲。
- 曲库支持歌单、专辑、歌手、收藏 MV、电台等常用入口。
- 搜索支持歌曲、专辑、歌手、歌单和 MV 结果。
- 歌单、专辑、歌手歌曲、歌手专辑、歌手 MV 和塞壬唱片列表支持关键字过滤。

### 私人漫游

- 支持默认推荐、熟悉偏好、探索发现、场景推荐和 AI DJ 模式。
- 场景推荐包含运动、专注、夜晚情绪等子模式。
- 内置近期去重队列，减少短时间内重复推荐同一首歌。
- 支持上一首、下一首、喜欢、不喜欢、封面轮播和候选歌曲预取。

### 歌词与评论

- 播放器右侧可在歌词和评论区之间切换，本地或受限音源会自动隐藏不适合的评论入口。
- 歌词支持原文、翻译、罗马音、间奏提示、字体大小、逐行时间偏移和滚动同步。
- 桌面歌词支持独立置顶窗口、拖动、锁定与缩放；网页端则以 Document Picture-in-Picture 置顶浮窗承载同一套歌词界面。
- 评论区支持精彩评论、最新评论、楼层回复、点赞、回复、发送和复制评论。
- 评论文本支持表情解析：网易云的 `[名字]` 会映射为官方表情图（个别表情回退为 Unicode 文本表情），QQ 的 `[em]eNNNNN[/em]` 会映射为 QQ 官方表情图；QQ 带图评论的 `[图片]` 占位符因接口不下发图片地址，会渲染为图片占位块而不是原始方括号。
- QQ 音乐本身不提供歌词翻译与罗马音，可在设置中开启「QQ 歌词翻译/罗马音匹配网易云」：先按歌名与歌手在网易云寻找同名候选，再按时间轴对齐，命中后才会补充翻译与罗马音。

### 下载、本地音乐与云盘

- 支持歌曲下载：播放器下载按钮和歌曲右键菜单可直接打开音质选择弹窗；歌单或专辑详情页可点击「选择」进入多选模式，再选择下载音质。
- 若目标音质不可用，会自动回退到可下载的最高音质，并通过同源下载代理逐个推送给浏览器保存，避免音频链接被新标签页直接播放。
- 桌面端提供下载列表，可查看进行中与已完成任务、进度，并支持取消单个或全部任务。
- 下载时可写入标题、歌手、专辑等基础标签，内嵌封面与歌词标签；桌面端还可额外生成独立 LRC 文件，并在设置中配置下载目录与「每首歌独立文件夹」，网页端只写入内嵌标签。
- 支持扫描多个本地音乐目录，并按文件夹维度分类浏览。
- 支持本地音乐 HiFi 输出：以 MPV 作为后端，可选择输出模式与音频设备，可指定 MPV 可执行文件路径。
- 云盘页面支持容量信息、文件分类、拖拽上传、列表刷新、删除和播放；云盘文件下载复用统一的音质选择弹窗，与普通歌曲一致。
- 云盘文件可按全部、图片、音乐、视频、压缩包和文档分类查看。

### 音乐视频、电台与扩展音源

- 支持绑定 B 站账号，并按 BV 号下载、缓存音乐视频；视频可在播放器内作为当前歌曲的画面播放，支持选择分 P 与清晰度（部分清晰度需要登录或大会员），并可与音频做时间轴同步。
- 网易云 MV 相关能力目前以曲库和搜索结果列表、动态详情跳转为主，项目内不再维护独立的网易云 MV 预览播放器。
- 支持收藏电台与电台节目播放，播放器会展示电台节目简介。
- Monster Siren 页面支持官方专辑列表、专辑详情、搜索过滤、刷新和播放。

### 桌面端

- 桌面歌词为 Electron 无边框置顶窗口，与主窗口通过 IPC 同步歌词与播放进度。
- 支持浅色、深色、跟随系统主题。
- 支持自定义字体与系统字体选择。
- 支持全局快捷键、系统托盘、退出行为设置。
- 支持窗口大小记忆。
- macOS 支持原生窗口交通灯、Dock 菜单与歌曲信息展示。
- Linux 支持 MPRIS 媒体控制。
- Windows / macOS / Linux 均提供打包配置。

### 设置

- 音乐：音质偏好、背景封面模糊、歌词模糊、显示歌曲翻译、QQ 歌词翻译/罗马音匹配网易云、歌曲无缝衔接、音频可视化、搜索下拉数量、歌词/翻译/罗马字号与间奏等待时间；桌面端另有音乐视频开关与音乐视频缓存清理。
- 本地（桌面端专属）：仅本地音乐模式、本地音乐 HiFi 输出、HiFi 输出模式与音频设备、MPV 后端路径、音乐视频缓存、下载目录、下载时创建独立文件夹、下载时创建独立 LRC 文件、本地音乐目录。
- 快捷键：桌面端可录制并修改播放、上一首、下一首、音量、快进/后退快捷键与对应的全局快捷键，也可一键恢复默认；网页端只使用默认快捷键。
- 其他：平台来源、主题、自定义字体、首页/云盘/私人漫游/塞壬唱片页面开关、清空私人漫游缓存；桌面端另有记住窗口大小与退出应用行为。

## QQ 音乐支持

项目现同时支持网易云音乐与 QQ 音乐。登录页可选择 QQ 音乐扫码登录；QQ 会话由服务端独立持有，前端不会接触 Cookie，也不会写入 Pinia、localStorage、URL、响应体或日志。QQ 接口统一挂载在 `/api/qq/*`（默认端口 `3200`），网易云接口继续使用 `/api/*`（默认端口 `36530`），两种来源的歌曲通过 `sourceKey`（如 `qq:mid`、`netease:id`）安全共存，队列与收藏互不串源。

已开放的 QQ 能力：

- 公开能力（无需登录）：搜索歌曲、专辑、歌手、MV 与歌单；首页焦点图、最新歌曲与榜单总榜/详情；分类歌单与新碟；个性化推荐歌单卡片；专辑详情；歌手详情（描述、歌曲、专辑与 MV 列表，支持分页）；歌曲评论（只读）。
- 登录后能力：账号资料与头像、喜欢歌曲、自己创建与已收藏的歌单及歌单详情、播放地址、歌词与曲绘。
- 写操作：喜欢歌曲，以及加入/移出歌单（`POST`，必须携带真实登录态）；服务端可用 `QQ_WRITE_ENABLED=0` 整体关闭写路径。

明确不在范围内的能力：QQ MV 详情与播放、VIP 及其他特权接口、好友/粉丝、勋章、听歌日历、音乐基因、不喜欢列表等。QQ 评论为只读，发表评论、回复与点赞会给出「暂不支持」提示而不是伪造成功。QQ 歌曲不会触发网易云侧的喜欢、歌单、评论或最近播放副作用；播放列表里存在 QQ 来源曲目时，心动模式会提示不可用而不是混入网易云推荐。

## 截图预览

<table>
  <tr>
    <td><img src="img/home.png" alt="首页" /></td>
    <td><img src="img/lyric.png" alt="歌词" /></td>
  </tr>
  <tr>
    <td><img src="img/comment.png" alt="评论区" /></td>
    <td><img src="img/privateFM.png" alt="私人漫游" /></td>
  </tr>
  <tr>
    <td><img src="img/desktop-lyric.png" alt="桌面歌词" /></td>
    <td><img src="img/music_video.png" alt="音乐视频" /></td>
  </tr>
  <tr>
    <td colspan="2"><img src="img/dark_mode.png" alt="深色模式" /></td>
  </tr>
</table>

## 安装使用

前往 [Releases](https://github.com/TTLLSSFF/Hydrogen-Music/releases) 下载对应平台的安装包。

当前构建配置支持：

- Windows：NSIS 安装包、Portable、Zip。
- macOS：DMG。
- Linux：AppImage、Deb、RPM（当前仅提供 x64）。

Arch Linux 用户可通过 AUR 安装（本仓库 fork 的包名，与上游 `hydrogen-music-bin` 相互独立）：

```shell
yay -S hydrogen-music-fork-bin
```

首次使用建议先登录网易云或 QQ 音乐账号。部分功能依赖账号权限、VIP 权益或第三方服务登录状态。

## 本地运行

### 环境要求

- Node.js：建议使用 Vite 7 支持的 Node.js 版本，至少为 `20.19.0` 或 `22.12.0`。
- npm。

### 安装依赖

```shell
npm ci
```

安装后会运行 `scripts/patch-ncm-api.cjs`，用于修补网易云音乐 API Enhanced 在当前项目中的兼容细节。

### 开发模式

如果你已经单独启动了网易云音乐 API Enhanced 与 QQ 音乐 API 服务，可以直接跑前端开发服务：

```shell
npm run dev
```

Vite 会把 `/api` 代理到 `36530`，把 `/api/qq` 代理到 `3200`，把 `/siren-api` 代理到 Monster Siren API，把 `/github-api` 代理到 GitHub 只读接口，并通过 `/download-proxy` 流式代理歌曲下载。打开 Vite 输出的本地地址即可访问播放器。

如果希望由项目自己拉起这两个 API 服务，可以使用下面的「一体化本地服务」，或在桌面端开发时用 `npm start`（Electron 主进程会自动启动内置服务）。

### 桌面端开发

终端一启动前端开发服务：

```shell
npm run dev
```

终端二启动 Electron：

```shell
npm start
```

开发环境下主窗口会加载 `http://localhost:5173/`，桌面歌词窗口会加载 `http://localhost:5173/desktop-lyric.html`；网易云音乐 API（`36530`）与 QQ 音乐 API（`3200`）由 Electron 主进程自动拉起。

### 一体化本地服务

如果你想一次启动 API 服务和静态站点，先构建前端资源：

```shell
npm run build
```

然后启动本地服务：

```shell
npm run serve
```

它会同时启动：

- 网易云音乐 API Enhanced：`http://127.0.0.1:36530`
- QQ 音乐 API 服务：`http://127.0.0.1:3200`
- Hydrogen Music 静态资源服务：`http://localhost:30000`

本地服务会同时处理 `/api`、`/api/qq`、`/siren-api`、`/github-api` 与 `/download-proxy`。可通过 `PORT` 环境变量修改 Web 服务端口，通过 `QQ_API_PORT` 修改 QQ API 端口。

### 运行测试

```shell
npm test
```

测试基于 Node 内置的 `node:test`，覆盖 QQ 接口归一化、来源隔离、写入边界、下载标签、Web 服务静态资源安全等场景。另有两个需要开发服务的性能与动画用例：

```shell
npm run test:selection-animation
npm run test:player-open-performance
```

### 启用 HTTPS

默认是明文 HTTP，用内网 IP 或域名访问时浏览器会在地址栏提示「不安全」，并且桌面歌词只能降级为普通弹窗（置顶浮窗需要安全上下文）。本地服务支持直接以 HTTPS 启动：

1. 先创建证书目录 `certs`，把证书与私钥放到 `certs/server.crt` 与 `certs/server.key`（也可以改用 `TLS_CERT_FILE`、`TLS_KEY_FILE` 环境变量指定路径）。
2. 重新运行 `npm run serve`，启动日志会显示 `(HTTPS)`，用 `https://` 访问即可。

证书说明：

- 想让浏览器显示安全标志，证书必须是受信任的。推荐用 [mkcert](https://github.com/FiloSottile/mkcert) 生成本地受信任证书：`mkcert -install` 之后执行 `mkcert -cert-file certs/server.crt -key-file certs/server.key localhost 127.0.0.1 <你的内网IP>`。
- 自签证书（例如 `openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/server.key -out certs/server.crt -days 365 -subj "/CN=localhost"`）虽然同样是 HTTPS，但浏览器仍会提示不安全，需要先手动信任该证书。
- 也可以用 Nginx/Caddy 等反向代理终止 TLS，此时无需上面的证书配置——但请确保代理只转发 `/api`、`/api/qq`、`/siren-api`、`/github-api`、`/download-tags`、`/download-proxy` 与静态资源，浏览器侧的全部请求都会以同源 HTTPS 发出。

### 提高「检查更新」限额（可选）

「新版本追加」的更新日志取自本仓库的提交记录，前端通过同源只读代理 `/github-api` 请求，由服务端转发（Vite 开发服务器同样支持该代理）。未配置 Token 时按匿名请求转发，GitHub 限制约 60 次/小时/IP；配置 Token 后提高到 5000 次/小时，更适合多人共用同一出口 IP 的部署：

```shell
# PowerShell
$env:GITHUB_TOKEN='你的token'; npm run serve

# Linux / macOS
GITHUB_TOKEN=你的token npm run serve
```

Token 只需要公开仓库的只读权限（classic PAT 可不勾选任何 scope，fine-grained PAT 勾选 public repositories 的 Contents 只读即可）。Token 只在服务端使用，不会下发到浏览器；也可以改用 `GITHUB_API_TOKEN` 变量名。

### 本地 HiFi 输出与 MPV 后端

本地音乐的 HiFi 输出使用 MPV 作为后端。普通在线播放和默认本地播放不依赖 MPV；只有在「设置 - 本地 - 本地音乐 HiFi 输出」开启后，才会走这个后端。

仓库提供了音频专用 MPV 构建脚本，生成的运行时放在 `resources/mpv/<platform-arch>/` 下。开发或打包前，建议先下载对应平台的构建产物：

MPV 构建由 `.github/workflows/build-mpv-audio-only.yml` 负责。这个 workflow 会在 `scripts/mpv-audio-only/**`、`resources/mpv/README.md` 或 workflow 自身变化时自动运行，也可以在 GitHub Actions 页面手动运行。手动运行时可以指定 `mpv_ref` 和 `ffmpeg_ref`，默认都是 `release`。

每次 workflow 会分别构建并上传这些 artifact：

- `mpv-audio-only-linux-x64`
- `mpv-audio-only-darwin-arm64`
- `mpv-audio-only-win32-x64`
- `mpv-audio-only-all-platforms`

下面的下载命令不会在本机重新编译 MPV，只会把 GitHub Actions 已经构建好的 artifact 拉到 `resources/mpv`：

```shell
npm run mpv:download
```

如果要一次性准备 Windows、macOS、Linux 三端资源：

```shell
npm run mpv:download:all
```

GitHub Actions artifact 的下载接口需要认证。如果命令提示 `Requires authentication`，先设置有 `Actions: Read-only` 权限的 `GH_TOKEN` 或 `GITHUB_TOKEN`。已安装 GitHub CLI 时，可以这样临时使用当前登录凭据：

```shell
GH_TOKEN="$(gh auth token)" npm run mpv:download:all
```

下载后会得到类似这些目录：

- `resources/mpv/win32-x64`
- `resources/mpv/darwin-arm64`
- `resources/mpv/linux-x64`

`electron-builder` 打包时只会带上当前目标平台对应的 MPV 目录。运行时会优先使用内置 MPV；如果没有内置资源，可以在设置里手动选择 MPV 可执行文件，也可以通过 `HYDROGEN_MPV_PATH` 指定路径。

如需自己构建精简 MPV，需要在目标系统上执行对应脚本：

```shell
# Linux x64
bash scripts/mpv-audio-only/build-linux-x64.sh

# macOS Apple Silicon
bash scripts/mpv-audio-only/build-darwin-arm64.sh

# Windows x64，需要在 MSYS2 MINGW64 shell 中运行
bash scripts/mpv-audio-only/build-win32-x64.sh
```

更多构建细节见 [scripts/mpv-audio-only/README.md](scripts/mpv-audio-only/README.md) 和 [resources/mpv/README.md](resources/mpv/README.md)。

### 构建前端资源

```shell
npm run build
```

构建产物会输出到 `dist/`。

### 打包当前平台客户端

```shell
npm run dist
```

打包产物会输出到 `release/<version>/`。版本号需要是三段 semver（例如 `26.9.23`），构建脚本会在打包前校验，不满足会直接退出。

如需指定平台，可将参数透传给构建脚本：

```shell
npm run dist -- --win
npm run dist -- --mac
npm run dist -- --linux
```

### 预览构建产物

```shell
npm run preview
```

`npm run preview` 使用 Vite 预览服务，默认端口为 `4173`。它只适合检查构建后的静态界面；需要登录、播放解析、塞壬接口代理或歌曲下载代理时，请使用 `npm run dev` 或 `npm run serve`。

## 技术栈

- 桌面框架：Electron、electron-builder。
- 前端框架：Vue 3、Vue Router、Pinia。
- 构建工具：Vite 7、Rollup、Terser、Sass。
- 音频播放：Howler、Web Audio API。
- 视频播放：Plyr。
- UI 组件：`vue-slider-component`、`vue-virtual-scroller`。
- API 与网络：Axios、网易云音乐 API Enhanced、QQ 音乐 API、本地 Node 代理服务、同源下载代理。
- 本地元数据与标签：`music-metadata`、`node-id3`、`metaflac-js`、`ffmpeg-static`。
- 桌面集成：`electron-store`、`electron-updater`、`mpris-service`。
- 文本与工具：OpenCC、QRCode、nanoid。
- 本地 HiFi 输出：MPV 运行时（`resources/mpv`）。

## 项目结构

```text
Hydrogen-Music
├── index.html                 # Vite 入口页面
├── background.js              # Electron 主进程入口
├── desktop-lyric.html         # 桌面歌词独立窗口入口
├── web-server.js              # 生产静态资源服务、API 代理和下载代理
├── vite.config.js             # Vite 配置
├── electron-builder.config.cjs # 桌面端打包配置
├── server                     # QQ 音乐 API 服务与下载标签写入
├── scripts                    # 构建、依赖修补、AUR 更新等脚本
├── resources/mpv              # 音频专用 MPV 运行时
├── test                       # node:test 测试用例
├── docs                       # QQ 音乐 API 能力清单等文档
├── .github/workflows          # 打包发布、MPV 构建与 AUR 发布工作流
├── img                        # README 截图资源
└── src
    ├── api                    # 网易云音乐、QQ 音乐、云盘、MV、电台、塞壬等接口封装
    ├── assets                 # 样式、字体、图标资源
    ├── components             # 播放器、歌词、评论、曲库、私人漫游、音乐视频等组件
    ├── composables            # 组合式运行时逻辑
    ├── electron               # Electron 主进程模块（托盘、IPC、MPRIS、下载、本地音乐等）
    ├── router                 # 页面路由
    ├── shared                 # 设置默认值和规范化逻辑
    ├── store                  # Pinia 状态管理
    ├── utils                  # 播放、下载、歌词、视频、主题、账号、搜索和媒体会话工具
    └── views                  # 页面级视图
```

## 注意事项

- 项目同时提供 Web 运行方式与 Electron 桌面端：Web 方式见上文「本地运行」，桌面端开发与打包见「本地 HiFi 输出与 MPV 后端」和「打包当前平台客户端」。
- 桌面端专属功能（本地音乐、MPV/HiFi 输出、全局快捷键、托盘、窗口记忆等）只在桌面环境渲染；一些代码保留了 `windowApi` / `window.electronAPI` 兼容判断，在普通浏览器中会自动降级（例如桌面歌词改用 Document Picture-in-Picture）。
- 网易云与 QQ 音乐两套会话彼此独立，可同时登录；QQ 会话 Cookie 仅由服务端持有。
- 部分功能依赖网易云音乐账号权限、VIP 权益、歌曲版权状态或第三方服务可用性。

## 声明与致谢

本项目仅供个人学习与研究使用，禁止用于商业用途或任何非法用途。项目涉及的音乐、歌词、评论、图片、视频等内容版权归其权利方所有。

本仓库在 [ldx123000/Hydrogen-Music](https://github.com/ldx123000/Hydrogen-Music) 的基础上继续维护，并延续原 [Hydrogen-Music](https://github.com/Kaidesuyo/Hydrogen-Music) 的创意与方向。感谢原作者与上游维护者的设计与实现。若原作者或相关权利方认为本仓库存在不妥，请联系维护者处理。

代码基于 [MIT License](LICENSE) 开源。