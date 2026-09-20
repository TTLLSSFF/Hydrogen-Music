# QQ 音乐 API 能力清单

项目通过 `@sansenjian/qq-music-api` 提供独立的 QQ 音乐服务，Web 层使用 `/api/qq/*` 转发到默认端口 `3200`；网易云仍使用 `/api/*` 和 `36530`。

当前产品对 QQ 音乐采用收敛后的只读白名单，在登录后的“我的音乐”和播放链路之外，已开放公共类型搜索：

- 公共搜索：歌曲、专辑、歌手、MV 四分类（无登录要求），由服务端 `/api/qq/getSearchByKey` 直连上游 `client_search_cp` 固定参数模板返回。歌单分类上游未提供，搜索页对应区块显示为空。
- 公共专辑详情（无登录要求）：`/api/qq/getAlbumInfo` 返回专辑元数据与完整歌曲列表，搜索结果中的 QQ 专辑可点击进入专辑详情并播放。
- 公共歌手详情（无登录要求）：`/api/qq/getSingerInfo` 聚合描述、关注数、歌曲列表与 MV 列表。歌曲列表走 `musicu.fcg` 的歌手详情模块（`music.web_singer_info_svr` / `get_singer_detail_info`，按热度排序，单次上限 60 首），并回传 `total_song`/`total_album`/`total_mv` 供页头展示真实总量；旧 zhida 搜索结果仅在该接口不可用时兜底（约 10 首）。搜索歌手页可跳转歌手详情，歌曲列表可播放；MV 播放与收藏暂未开放。
- 公共歌手歌曲分页（无登录要求）：`/api/qq/getSingerSongs`（`singermid` + `page`/`limit`，`page` 从 0 开始，`limit` 默认与上限均为 60）返回 `{ songs, totalSong }`，歌手页歌曲列表滚动到底自动请求下一页，按 `qq:` 歌曲标识去重后追加。
- 公共歌手专辑列表（无登录要求）：`/api/qq/getSingerAlbums`（`singermid` + `page`/`limit`，`page` 从 0 开始，`limit` 默认 30、上限 100）返回 `{ albums, totalAlbum }`。上游走 `musicu.fcg` 的 `music.musichallAlbum.AlbumListServer` / `GetAlbumList`（`param.begin` 是偏移量而非页码，故服务端按 `page * limit` 换算），专辑页签滚动到底自动请求下一页，按专辑 mid 去重后追加。注意上游 `totalNum`（专辑曲目数）恒为 0，列表页据此隐藏曲目数而不是显示「0首」。
- 登录会话状态、资料和头像。
- 喜欢歌曲、自己创建的歌单、已收藏的歌单及歌单详情（歌曲列表）。
- 歌曲播放地址和歌词；QQ 歌曲保留来源标识、曲绘和专辑基础展示字段。

服务端 `/api/qq/*` 只放行以下上游路径（均为 `GET`，登录与退出使用专用会话路由）：

```text
/getSearchByKey（公共搜索，仅 t=0/8/9/12）
/getAlbumInfo（公共专辑详情，仅 albummid）
/getSingerInfo（公共歌手详情聚合：singermid + 可选 name/singerid）
/getSingerSongs（公共歌手歌曲分页：singermid + page/limit）
/getSingerAlbums（公共歌手专辑分页：singermid + page/limit）
/getMusicPlay
/getLyric
/getSongListDetail
/user/getUserDetail
/user/getUserAvatar
/user/getUserLikedSongs
/user/getUserPlaylists
/user/getUserCollectedSongLists
```

QQ 下载、收藏或歌单写操作、好友/粉丝、勋章、听歌日历、音乐基因和不喜欢列表均明确禁用。`/getMusicPlay` 仅按当前登录账号自身的权益取流，账号有权播放的会员曲目可正常播放，但不提供任何 VIP 特权接口。前端适配器会返回"不支持"错误，服务端白名单也会以 `404` 拦截，避免旧调用绕过产品边界。QQ 歌曲不会触发网易云喜欢、歌单、评论或最近播放副作用。

QQ 扫码登录状态码：`800` 过期、`801` 等待扫码、`802` 已扫码待确认、`803` 登录成功。Cookie 仅由服务端 QQ API 进程持有，不写入 Pinia、localStorage、URL、响应体或日志。

上游包未提供可靠写操作的功能（喜欢歌曲写入、收藏/取消收藏、关注/取消关注、发表评论等）保持禁用，不伪造成功结果。Cookie 只在服务端会话中流转，不写入前端持久化状态、URL、响应体或日志。
