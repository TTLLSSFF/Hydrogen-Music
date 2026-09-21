# Hydrogen Music

<p align="center">
  <img src="img/icon.png" width="96" alt="Hydrogen Music" />
</p>

<p align="center">
  <strong>基于 Vue 3 和网易云音乐 API Enhanced 的 Web 音乐播放器。</strong>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/ldx123000/Hydrogen-Music?style=for-the-badge" /></a>
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42B883?style=for-the-badge&logo=vuedotjs&logoColor=white" />
  <img alt="Vite" src="https://img.shields.io/badge/Vite-7-646CFF?style=for-the-badge&logo=vite&logoColor=white" />
</p>

<p align="center">
  <a href="#项目定位">项目定位</a>
  ·
  <a href="#功能概览">功能概览</a>
  ·
  <a href="#截图预览">截图预览</a>
  ·
  <a href="#本地运行">本地运行</a>
  ·
  <a href="#技术栈">技术栈</a>
  ·
  <a href="#声明">声明</a>
</p>

<p align="center">
  <img src="img/home.png" alt="Hydrogen Music 首页" />
</p>

## 项目定位

Hydrogen Music 是一个第三方网易云音乐 Web 播放器。当前仓库保留原 Hydrogen Music 的视觉方向，并围绕浏览器运行场景继续维护：前端使用 Vue 3 和 Vite，后端通过本地 Node 服务启动网易云音乐 API Enhanced，同时代理 Monster Siren API 和歌曲下载流。

当前项目重点维护这些内容：

- 账号登录、曲库浏览、搜索、播放队列、歌词、评论、云盘、本地音乐和私人漫游。
- 歌曲解析、无缝衔接、播放状态持久化和媒体会话信息。
- 深色模式、自定义字体、歌词显示偏好、背景封面模糊等可选设置。
- 一个可直接部署的 Web 产物，以及配套的本地 API 与下载代理服务。

## 功能概览

### 账号与服务

- 支持网易云音乐二维码登录和手机号登录；扫码等待确认时二维码会缩小贴合确认框，登录失败会自动刷新并放大新二维码。
- 内置 `@neteasecloudmusicapienhanced/api`，开发和部署时通过 `/api` 访问本地 API 服务。
- 支持账号状态恢复、登录信息迁移、VIP 信息展示和账号退出。
- 可上报最近播放记录，让官方客户端中也能看到这边产生的播放历史。

### 播放

- 支持标准、较高、极高、无损、Hi-Res、高清环绕声、沉浸环绕声、杜比全景声、超清母带等音质偏好。
- 可播放歌单、专辑、歌手热门歌曲、每日推荐、搜索结果、私人漫游、电台节目、云盘歌曲、本地音乐和 Monster Siren 音源。
- 支持顺序播放、列表循环、单曲循环、随机播放、播放队列持久化和断点恢复。
- 支持歌曲无缝衔接，会预缓冲下一首以减少切歌空隙。
- 支持喜欢歌曲、添加到歌单、下一首播放、评论面板切换和播放列表面板。
- 支持歌曲下载：播放器下载按钮和歌曲右键菜单可直接打开音质选择弹窗；歌单或专辑详情页可点击「选择」进入多选模式，再选择下载音质。若目标音质不可用，会自动回退到可下载的最高音质，并通过同源下载代理逐个推送给浏览器保存，避免音频链接被新标签页直接播放。
- 歌单或专辑详情页的「选择」按钮支持批量操作：点击后展开子菜单（下载、添加到歌单、添加到播放列表、从歌单中删除，以及全选/取消），支持多选歌曲后一次性批量执行；子菜单展开与收回带有歌词同款反色背景动画，并适配深色模式。
- 支持背景封面模糊、歌词模糊、歌曲名翻译显示等播放相关偏好。

### 首页、曲库与搜索

- 首页包含 Banner、推荐歌单和最新歌曲。
- 曲库支持歌单、专辑、歌手、收藏 MV、电台等常用入口。
- 搜索支持歌曲、专辑、歌手、歌单和 MV 结果。
- 歌单、专辑、歌手歌曲、歌手专辑、歌手 MV 和塞壬唱片列表支持关键字过滤。
- 首页保留心动模式入口；播放页不再显示心动模式图标。

### 私人漫游

- 支持默认推荐、熟悉偏好、探索发现、场景推荐和 AI DJ 模式。
- 场景推荐包含运动、专注、夜晚情绪等子模式。
- 内置近期去重队列，减少短时间内重复推荐同一首歌。
- 支持上一首、下一首、喜欢、不喜欢、封面轮播和候选歌曲预取。

### 歌词与评论

- 播放器右侧可在歌词和评论区之间切换，本地或受限音源会自动隐藏不适合的评论入口。
- 歌词支持原文、翻译、罗马音、间奏提示、字体大小、逐行时间偏移和滚动同步。
- 评论区支持精彩评论、最新评论、楼层回复、点赞、回复、发送和复制评论。
- 评论文本支持网易云表情解析。

### 云盘与扩展音源

- 云盘页面支持容量信息、文件分类、拖拽上传、列表刷新、删除和播放；云盘文件下载入口在 Web 版中仍会提示暂不支持。
- 云盘文件可按全部、图片、音乐、视频、压缩包和文档分类查看。
- Monster Siren 页面支持官方专辑列表、专辑详情、搜索过滤、刷新和播放。
- MV 相关能力目前以曲库和搜索结果列表、动态详情跳转为主，项目内不再维护独立 MV 预览播放器。

### 设置

- 音乐设置：音质偏好、背景封面模糊、歌词模糊、歌曲名翻译、无缝衔接、搜索下拉数量、歌词字号和间奏等待时间。
- 快捷键设置：展示播放、上一首、下一首、音量和进度控制快捷键。
- 其他设置：主题、自定义字体、首页、云盘、私人漫游、塞壬唱片页面开关，以及私人漫游缓存清理。

### 桌面端

- 桌面歌词为 Electron 无边框置顶窗口，与主窗口通过 IPC 同步歌词与播放进度；网页端则以 Document Picture-in-Picture 置顶浮窗承载同一套歌词界面。
- 支持浅色、深色、跟随系统主题。
- 支持自定义字体与系统字体选择。
- 支持全局快捷键、系统托盘、退出行为设置。
- macOS 支持原生窗口交通灯、Dock 菜单与歌曲信息展示。
- Linux 支持 MPRIS 媒体控制。
- Windows / macOS / Linux 均提供打包配置。

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
    <td colspan="2"><img src="img/dark_mode.png" alt="深色模式" /></td>
  </tr>
</table>

## 安装使用

前往 [Releases](https://github.com/ldx123000/Hydrogen-Music/releases) 下载对应平台的安装包。

当前构建配置支持：

- Windows：NSIS 安装包、Portable、Zip。
- macOS：DMG。
- Linux：AppImage、Deb、RPM。

Arch Linux 用户可通过 AUR 安装：

```shell
yay -S hydrogen-music-bin
```

首次使用建议先登录网易云账号。部分功能依赖账号权限、VIP 权益或第三方服务登录状态。

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

如果你已经单独启动了网易云音乐 API Enhanced，可以直接跑前端开发服务：

```shell
npm run dev
```

项目默认使用 `36530` 作为 API 端口。Vite 会把 `/api` 代理到该服务，把 `/siren-api` 代理到 Monster Siren API，并通过 `/download-proxy` 流式代理歌曲下载。打开 Vite 输出的本地地址即可访问播放器。

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
- Hydrogen Music 静态资源服务：`http://localhost:30000`

本地服务会同时处理 `/api`、`/siren-api` 和 `/download-proxy`。可通过 `PORT` 环境变量修改 Web 服务端口。

### 启用 HTTPS

默认是明文 HTTP，用内网 IP 或域名访问时浏览器会在地址栏提示「不安全」，并且桌面歌词只能降级为普通弹窗（置顶浮窗需要安全上下文）。本地服务支持直接以 HTTPS 启动：

1. 先创建证书目录 `certs`，把证书与私钥放到 `certs/server.crt` 与 `certs/server.key`（也可以改用 `TLS_CERT_FILE`、`TLS_KEY_FILE` 环境变量指定路径）。
2. 重新运行 `npm run serve`，启动日志会显示 `(HTTPS)`，用 `https://` 访问即可。

证书说明：

- 想让浏览器显示安全标志，证书必须是受信任的。推荐用 [mkcert](https://github.com/FiloSottile/mkcert) 生成本地受信任证书：`mkcert -install` 之后执行 `mkcert -cert-file certs/server.crt -key-file certs/server.key localhost 127.0.0.1 <你的内网IP>`。
- 自签证书（例如 `openssl req -x509 -newkey rsa:2048 -nodes -keyout certs/server.key -out certs/server.crt -days 365 -subj "/CN=localhost"`）虽然同样是 HTTPS，但浏览器仍会提示不安全，需要先手动信任该证书。
- 也可以用 Nginx/Caddy 等反向代理终止 TLS，此时无需上面的证书配置——但请确保代理只转发 `/api`、`/siren-api`、`/download-proxy` 与静态资源，浏览器侧的全部请求都会以同源 HTTPS 发出。

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

本地音乐的 HiFi 输出使用 MPV 作为后端。普通在线播放和默认本地播放不依赖 MPV；只有在「设置 - 音乐 - 本地音乐 HiFi 输出」开启后，才会走这个后端。

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

打包产物会输出到 `release/<version>/`。

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

- 前端框架：Vue 3、Vue Router、Pinia。
- 构建工具：Vite 7、Rollup、Terser、Sass。
- 播放能力：Howler、Web Audio API。
- UI 组件：`vue-slider-component`、`vue-virtual-scroller`。
- API 与网络：Axios、网易云音乐 API Enhanced、本地 Node 代理服务、同源下载代理。
- 文本与工具：OpenCC、QRCode、nanoid。
- 桌面端：Electron、electron-builder、MPV（本地音乐 HiFi 输出后端）。

## 项目结构

```text
Hydrogen-Music
├── index.html                 # Vite 入口页面
├── background.js              # Electron 主进程入口
├── desktop-lyric.html         # 桌面歌词独立窗口入口
├── web-server.js              # 生产静态资源服务、API 代理和下载代理
├── vite.config.js             # Vite 配置
├── electron-builder.config.cjs # 桌面端打包配置
├── scripts                    # 构建和依赖修补脚本
├── resources/mpv              # 音频专用 MPV 运行时
├── img                        # README 截图资源
└── src
    ├── api                    # 网易云音乐、云盘、MV、电台、塞壬等接口封装
    ├── assets                 # 样式、字体、图标资源
    ├── components             # 播放器、歌词、评论、曲库、私人漫游等组件
    ├── composables            # 组合式运行时逻辑
    ├── electron               # Electron 主进程模块（托盘、IPC、MPRIS、下载等）
    ├── router                 # 页面路由
    ├── shared                 # 设置默认值和规范化逻辑
    ├── store                  # Pinia 状态管理
    ├── utils                  # 播放、下载、歌词、主题、账号、搜索和媒体会话工具
    └── views                  # 页面级视图
```

## 注意事项

- 项目同时提供 Web 运行方式与 Electron 桌面端：Web 方式见上文「本地运行」，桌面端开发与打包见「本地 HiFi 输出与 MPV 后端」和「打包当前平台客户端」。
- 一些代码保留了 `windowApi` / `window.electronAPI` 兼容判断，用于适配桌面宿主能力；在普通浏览器中会自动降级（例如桌面歌词改用 Document Picture-in-Picture）。
- 部分功能依赖网易云音乐账号权限、VIP 权益、歌曲版权状态或第三方服务可用性。

### QQ 音乐支持

项目现同时支持网易云音乐与 QQ 音乐。登录页可选择 QQ 音乐扫码登录；QQ 会话由服务端独立持有，前端不会接触 Cookie。QQ 接口统一挂载在 `/api/qq/*`，网易云接口继续使用 `/api/*`，两种来源的歌曲可通过 `sourceKey`（如 `qq:mid`、`netease:id`）安全共存。

QQ 音乐在本项目中只保留登录后的“我的音乐”与播放链路：资料和头像、喜欢歌曲、自己创建的歌单、已收藏的歌单，以及这些歌单中的歌曲可读取并播放；歌曲同时提供 QQ 来源的歌词和曲绘。QQ 会话与网易云会话彼此独立，可以同时登录。

为避免把 QQ 数据误当成网易云数据，QQ 公共搜索、首页推荐、榜单、新歌、专辑/歌手/MV 详情、评论、收藏或歌单写操作、VIP 及其他附属账号能力均不在当前产品范围内。QQ 歌曲不会写入网易云喜欢或歌单，也不会参与网易云评论、专辑和歌手跳转；播放列表含 QQ 歌曲时，心动模式会提示“播放列表里存在QQ音乐来源的曲目，心动模式无效”。

## 声明

本项目仅供个人学习与研究使用，禁止用于商业用途或任何非法用途。项目涉及的音乐、歌词、评论、图片、视频等内容版权归其权利方所有。

本仓库基于原 [Hydrogen-Music](https://github.com/Kaidesuyo/Hydrogen-Music) 的创意与方向继续维护。若原作者或相关权利方认为本仓库存在不妥，请联系维护者处理。

代码基于 [MIT License](LICENSE) 开源。
