# QQ 音乐 API 能力清单

项目通过 `@sansenjian/qq-music-api` 提供独立的 QQ 音乐服务，Web 层使用 `/api/qq/*` 转发到默认端口 `3200`；网易云仍使用 `/api/*` 和 `36530`。

当前产品对 QQ 音乐采用收敛后的只读白名单，只保留登录后的“我的音乐”和播放链路：

- 登录会话状态、资料和头像。
- 喜欢歌曲、自己创建的歌单、已收藏的歌单及歌单详情（歌曲列表）。
- 歌曲播放地址和歌词；QQ 歌曲保留来源标识、曲绘和专辑基础展示字段。

服务端 `/api/qq/*` 只放行以下上游路径（均为 `GET`，登录与退出使用专用会话路由）：

```text
/getMusicPlay
/getLyric
/getSongListDetail
/user/getUserDetail
/user/getUserAvatar
/user/getUserLikedSongs
/user/getUserPlaylists
/user/getUserCollectedSongLists
```

QQ 公共搜索、首页推荐、榜单、新歌、专辑/歌手/MV 详情、评论、下载、收藏或歌单写操作、VIP、好友/粉丝、勋章、听歌日历、音乐基因和不喜欢列表均明确禁用。前端适配器会返回“不支持”错误，服务端白名单也会以 `404` 拦截，避免旧调用绕过产品边界。QQ 歌曲不会触发网易云喜欢、歌单、评论或最近播放副作用。

QQ 扫码登录状态码：`800` 过期、`801` 等待扫码、`802` 已扫码待确认、`803` 登录成功。Cookie 仅由服务端 QQ API 进程持有，不写入 Pinia、localStorage、URL、响应体或日志。

上游包未提供可靠写操作的功能（喜欢歌曲写入、收藏/取消收藏、关注/取消关注、发表评论等）保持禁用，不伪造成功结果。Cookie 只在服务端会话中流转，不写入前端持久化状态、URL、响应体或日志。
