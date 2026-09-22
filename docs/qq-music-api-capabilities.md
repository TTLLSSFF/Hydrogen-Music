# QQ 音乐 API 能力清单

项目通过 `@sansenjian/qq-music-api` 提供独立的 QQ 音乐服务，Web 层使用 `/api/qq/*` 转发到默认端口 `3200`；网易云仍使用 `/api/*` 和 `36530`。

当前产品对 QQ 音乐采用收敛后的只读白名单，在登录后的“我的音乐”和播放链路之外，已开放公共类型搜索：

- 公共搜索：歌曲、专辑、歌手、MV 四分类（无登录要求），由服务端 `/api/qq/getSearchByKey` 直连上游 `client_search_cp` 固定参数模板返回。歌单搜索另走 `/api/qq/getSearchPlaylists`：`client_search_cp` 没有任何歌单分类（t=0..20 实测只有歌曲/歌词/专辑/歌手/MV），歌单改由上游 `musicu.fcg` 的 `music.search.SearchCgiService` / `DoSearchForQQMusicDesktop`（`search_type=3`）提供，请求必须带网页端身份 `ct=19`/`cv=1859`，否则上游返回 `code=0` 但列表为空；匿名即可返回公共歌单。
- 公共专辑详情（无登录要求）：`/api/qq/getAlbumInfo` 返回专辑元数据与完整歌曲列表，搜索结果中的 QQ 专辑可点击进入专辑详情并播放。
- 公共歌手详情（无登录要求）：`/api/qq/getSingerInfo` 聚合描述、关注数、歌曲列表与 MV 列表。歌曲列表走 `musicu.fcg` 的歌手详情模块（`music.web_singer_info_svr` / `get_singer_detail_info`，按热度排序，单次上限 60 首），并回传 `total_song`/`total_album`/`total_mv` 供页头展示真实总量；旧 zhida 搜索结果仅在该接口不可用时兜底（约 10 首）。搜索歌手页可跳转歌手详情，歌曲列表可播放；MV 播放与收藏暂未开放。
- 公共歌手歌曲分页（无登录要求）：`/api/qq/getSingerSongs`（`singermid` + `page`/`limit`，`page` 从 0 开始，`limit` 默认与上限均为 60）返回 `{ songs, totalSong }`，歌手页歌曲列表滚动到底自动请求下一页，按 `qq:` 歌曲标识去重后追加。
- 公共歌手专辑列表（无登录要求）：`/api/qq/getSingerAlbums`（`singermid` + `page`/`limit`，`page` 从 0 开始，`limit` 默认 30、上限 100）返回 `{ albums, totalAlbum }`。上游走 `musicu.fcg` 的 `music.musichallAlbum.AlbumListServer` / `GetAlbumList`（`param.begin` 是偏移量而非页码，故服务端按 `page * limit` 换算），专辑页签滚动到底自动请求下一页，按专辑 mid 去重后追加。注意上游 `totalNum`（专辑曲目数）恒为 0，列表页据此隐藏曲目数而不是显示「0首」。
- 公共首页推荐（无登录要求）：`/api/qq/getRecommendBanner`（轮播焦点图）、`/api/qq/getNewSongs`（最新歌曲）、`/api/qq/getTopLists`（榜单总榜）均为无参 `GET`；`/api/qq/getTopListDetail`（`topId` 仅数字，`page`/`limit` 固定 0/100）返回榜单详情，上游走 `musicu.fcg` 的 `musicToplist.ToplistInfoServer` / `GetDetail`，`period` 按 ISO 周计算。
- 公共分类歌单（无登录要求）：`/api/qq/getPlaylistTags`（无参，返回分类标签）与 `/api/qq/getPlaylistsByTag`（`tagId` 纯数字 + `page`/`limit`，`page` 从 0 开始，`limit` 默认 20、上限 30；可选 `sortId` 1-5）。依赖包的 `playlist.web_srf` 模块（`get_tags` / `get_playlist_by_tag`）在上游已失效（稳定返回 `500003`/`860100005`），故服务端改用与真实 y.qq.com 歌单分类页一致的旧版 `c.y.qq.com` 固定参数模板直连；该接口默认回 gb2312，服务端已显式要求 `outCharset=utf-8`。
- 公共数字专辑/新碟（无登录要求）：`/api/qq/getDigitalAlbums`（无参 `GET`），上游为 `musicmall.fcg`，真实数据位于 `data.content[].albumlist[]` 分组内。
- 公共评论（无登录要求，只读）：`/api/qq/getComments`（`id` 为**数字歌曲 id**，即 `topid`，songmid 不被接受；`type` 仅 1/2/3；`page`/`pagesize`，`pagesize` 默认 20、上限 30；可选 `sortType` 1/2）。依赖包的 `comment.CommentReadServer` 模块同样已失效，服务端改用旧版 `c.y.qq.com` 评论接口，一次响应同时含 `comment.commentlist`（最新）与 `hot_comment.commentlist`（热门）。
- 个性化推荐（无登录要求）：`/api/qq/getPersonalRecommend`。依赖包使用的 `music.web_srf_svr` / `get_recommend` 模块在上游已失效（稳定返回 `500003`/`860100005`），服务端改用仍可用的 `music.recommend.RecommendFeed` / `get_recommend_feed`，返回推荐**歌单**卡片（`v_shelf[].v_niche[].v_card[]`，`type=500`，`id` 即 dissid），前端归一化后复用现有 QQ 歌单详情链路。该上游**匿名即可返回公共推荐流**（实测 `code=0`），登录后服务端改传会话 `uin` 返回个性化结果，因此不再要求会话。QQ 侧没有可用的「每日歌曲列表」接口，首页每日推荐卡片因此指向个性化推荐歌单。
- 登录会话状态、资料和头像。
- 喜欢歌曲、自己创建的歌单、已收藏的歌单及歌单详情（歌曲列表）。
- 歌曲播放地址和歌词；QQ 歌曲保留来源标识、曲绘和专辑基础展示字段。

服务端 `/api/qq/*` 只放行以下上游路径（除写操作探针外均为 `GET`，登录与退出使用专用会话路由）：

```text
/getSearchByKey（公共搜索，仅 t=0/8/9/12）
/getSearchPlaylists（公共歌单搜索，仅 key/n/p，上游 musicu search_type=3）
/getAlbumInfo（公共专辑详情，仅 albummid）
/getSingerInfo（公共歌手详情聚合：singermid + 可选 name/singerid）
/getSingerSongs（公共歌手歌曲分页：singermid + page/limit）
/getSingerAlbums（公共歌手专辑分页：singermid + page/limit）
/getRecommendBanner / getNewSongs / getTopLists（公共首页，无参）
/getTopListDetail（公共榜单详情，仅数字 topId）
/getPlaylistTags / getPlaylistsByTag（公共分类歌单，旧版 c.y.qq.com 模板）
/getDigitalAlbums（公共新碟）
/getComments（公共评论，只读，topid 为数字歌曲 id）
/getPersonalRecommend（个性化推荐歌单卡片，匿名可用，登录后按 uin 个性化）
/getMusicPlay
/getLyric
/getSongListDetail
/user/getUserDetail
/user/getUserAvatar
/user/getUserLikedSongs
/user/getUserPlaylists
/user/getUserCollectedSongLists
```

写端点（`/user/likeSong`、`/user/songList`）只接受 `POST`，且**必须携带真实登录态**——无会话时会在会话闸门处直接返回 `401`，不会触达上游。它们走旧版未签名 `musicu.fcg` 的 `music.musicasset.PlaylistDetailWrite`（`AddSonglist` / `DelSonglist`，`dirId=201` 表示「我喜欢」，喜欢端点固定写该歌单），会话 cookie 通过 `option.headers.Cookie` 透传给上游。响应只回 `{ ok, code }`，不暴露任何上游原始数据或凭证。服务端以 `QQ_WRITE_ENABLED=0` 启动可整体关闭写路径（回落成 `404`）。真机验收与回归用 `scripts/qq-write-probe.mjs`。

QQ 写操作（收藏、加入/移出歌单）与下载已接入 UI：下载复用 QQ 播放地址解析链路，写操作走上面的 provider 自有端点。好友/粉丝、勋章、听歌日历、音乐基因和不喜欢列表仍明确禁用。`/getMusicPlay` 仅按当前登录账号自身的权益取流，账号有权播放的会员曲目可正常播放，但不提供任何 VIP 特权接口。前端适配器会返回"不支持"错误，服务端白名单也会以 `404` 拦截，避免旧调用绕过产品边界。QQ 歌曲不会触发网易云喜欢、歌单、评论或最近播放副作用。

QQ 扫码登录状态码：`800` 过期、`801` 等待扫码、`802` 已扫码待确认、`803` 登录成功。Cookie 仅由服务端 QQ API 进程持有，不写入 Pinia、localStorage、URL、响应体或日志。

上游包未提供可靠写操作的功能（收藏/取消收藏、关注/取消关注、发表评论等）保持禁用，不伪造成功结果。Cookie 只在服务端会话中流转，不写入前端持久化状态、URL、响应体或日志。
