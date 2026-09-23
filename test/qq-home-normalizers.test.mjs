import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeQQTagList,
  normalizeQQPlaylistCard,
  normalizeQQDigitalAlbumCard,
  normalizeQQCommentList,
  normalizeQQRecommendCards,
} from '../src/api/qqMusic.js'

// 以下 payload 形状取自 2026-09 对上游的真实抓包，用于锁定归一化契约。

test('QQ playlist tags flatten the legacy category groups', () => {
  const payload = {
    code: 0,
    data: {
      categories: [
        { categoryGroupName: '热门', items: [{ categoryId: 10000000, categoryName: '全部' }] },
        {
          categoryGroupName: '语种',
          items: [
            { categoryId: 165, categoryName: '国语' },
            { categoryId: 167, categoryName: '英语' },
          ],
        },
      ],
    },
  }
  const tags = normalizeQQTagList(payload)
  assert.equal(tags.length, 3)
  assert.deepEqual(tags.map(tag => tag.id), ['10000000', '165', '167'])
  assert.deepEqual(tags.map(tag => tag.name), ['全部', '国语', '英语'])
})

test('QQ playlist tags fall back to the generic tag list and tolerate junk', () => {
  assert.deepEqual(normalizeQQTagList({ tags: [{ id: 1, name: '摇滚' }] }), [{ id: '1', name: '摇滚', hot: false }])
  assert.deepEqual(normalizeQQTagList({}), [])
  assert.deepEqual(normalizeQQTagList(null), [])
  // 缺 id 的条目会被丢弃，避免生成无法请求的分类
  assert.deepEqual(normalizeQQTagList({ tags: [{ name: '无 id' }] }), [])
})

test('QQ playlist cards use dissid/dissname/imgurl from the legacy shape', () => {
  const payload = {
    code: 0,
    data: {
      sum: 11619,
      list: [
        {
          dissid: '7707261125',
          dissname: '甜度爆表 | 旋律说唱狙击少女心',
          imgurl: 'http://qpic.y.qq.com/music_cover/abc/300?n=1',
          listennum: 8550367,
        },
      ],
    },
  }
  const cards = normalizeQQPlaylistCard(payload)
  assert.equal(cards.length, 1)
  assert.equal(cards[0].id, '7707261125')
  assert.equal(cards[0].name, '甜度爆表 | 旋律说唱狙击少女心')
  assert.equal(cards[0].coverImgUrl, 'http://qpic.y.qq.com/music_cover/abc/300?n=1')
  assert.equal(cards[0].source, 'qq')
})

test('QQ playlist cards tolerate a missing or malformed list', () => {
  assert.deepEqual(normalizeQQPlaylistCard({ data: {} }), [])
  assert.deepEqual(normalizeQQPlaylistCard({ data: { list: null } }), [])
  assert.deepEqual(normalizeQQPlaylistCard(null), [])
})

test('QQ digital albums flatten content[].albumlist[] and build covers from the mid', () => {
  const payload = {
    response: {
      code: 0,
      data: {
        banner: [{ album_id: 102281837, album_name: '守夜人' }],
        content: [
          {
            type: 'newupload',
            albumlist: [
              {
                album_id: '102281837',
                album_mid: '003HbuYH2IHra3',
                album_name: '守夜人',
                price: 1200,
                publictime: 1789574400,
                singer_name: '张云雷',
                singers: [{ singer_id: '1142841', singer_mid: '001GAv1K3R27oe' }],
              },
            ],
          },
          { type: 'zhuanti', albumlist: [] },
        ],
      },
    },
  }
  const albums = normalizeQQDigitalAlbumCard(payload)
  assert.equal(albums.length, 1)
  assert.equal(albums[0].id, '003HbuYH2IHra3')
  assert.equal(albums[0].mid, '003HbuYH2IHra3')
  assert.equal(albums[0].name, '守夜人')
  assert.equal(albums[0].price, 1200)
  assert.equal(albums[0].publishTime, 1789574400)
  assert.equal(albums[0].source, 'qq')
  // albumlist 条目本身没有封面字段，必须由 mid 推导出来
  assert.match(albums[0].coverImgUrl, /003HbuYH2IHra3/)
  assert.deepEqual(albums[0].ar.map(artist => artist.name), ['张云雷'])
})

test('QQ digital albums tolerate a missing content group', () => {
  assert.deepEqual(normalizeQQDigitalAlbumCard({ response: { data: {} } }), [])
  assert.deepEqual(normalizeQQDigitalAlbumCard(null), [])
})

test('QQ comments read both the newest and hot lists from the legacy payload', () => {
  const payload = {
    code: 0,
    morecomment: 1,
    comment: {
      commenttotal: 0,
      commentlist: [
        {
          commentid: '1!newest',
          nick: 'Dan',
          rootcommentcontent: '最新一条评论',
          praisenum: 0,
          time: 1789917910,
          avatarurl: 'https://pic6.y.qq.com/avatar/newest',
        },
      ],
    },
    hot_comment: {
      commenttotal: 37,
      commentlist: [
        {
          commentid: '1!hot',
          nick: '庆怜',
          rootcommentcontent: '热门评论',
          praisenum: 49,
          ispraise: 1,
          time: 1789900263,
          avatarurl: 'https://pic6.y.qq.com/avatar/hot',
        },
      ],
    },
  }
  const result = normalizeQQCommentList(payload)
  assert.equal(result.comments.length, 1)
  assert.equal(result.hotComments.length, 1)
  assert.equal(result.comments[0].content, '最新一条评论')
  assert.equal(result.comments[0].user.nickname, 'Dan')
  assert.equal(result.comments[0].user.avatarUrl, 'https://pic6.y.qq.com/avatar/newest')
  // 秒级时间戳必须换算成毫秒
  assert.equal(result.comments[0].time, 1789917910000)
  assert.equal(result.hotComments[0].likedCount, 49)
  assert.equal(result.hotComments[0].liked, true)
  assert.equal(result.comments[0].liked, false)
  // commenttotal 为 0 时退回实际条数，避免前端显示「0 条评论」
  assert.equal(result.total, 2)
  // 热门列表有硬上限（实测最多 15 条），热门总数只能取 hot_comment.commenttotal，
  // 否则面板会把页大小显示成真实热门数。
  assert.equal(result.hotTotal, 37)
  assert.equal(result.hasMore, true)
})

test('QQ hot total falls back to the hot list length when the payload omits it', () => {
  const result = normalizeQQCommentList({
    comment: { commentlist: [] },
    hot_comment: { commentlist: [{ commentid: '1!hot', rootcommentcontent: '热门', nick: 'n' }] },
  })
  assert.equal(result.hotTotal, 1)
})

test('QQ comments keep the commentId contract used by the panel', () => {
  const result = normalizeQQCommentList({
    comment: { commentlist: [{ commentid: '1!abc', rootcommentcontent: 'x', nick: 'n' }] },
  })
  assert.equal(result.comments[0].commentId, '1!abc')
  assert.equal(result.comments[0].id, '1!abc')
  assert.equal(result.comments[0].replyCount, 0)
  assert.deepEqual(result.comments[0].replies, [])
})

test('QQ comments tolerate missing lists and empty payloads', () => {
  const empty = normalizeQQCommentList({})
  assert.deepEqual(empty.comments, [])
  assert.deepEqual(empty.hotComments, [])
  assert.equal(empty.hasMore, false)

  const nulled = normalizeQQCommentList(null)
  assert.deepEqual(nulled.comments, [])
  assert.deepEqual(nulled.hotComments, [])
})

test('QQ personalized recommendations flatten the RecommendFeed shelves into playlist cards', () => {
  // 形状取自 music.recommend.RecommendFeed / get_recommend_feed 的真实响应
  const payload = {
    recommend: {
      code: 0,
      data: {
        v_shelf: [
          {
            v_niche: [
              {
                v_card: [
                  {
                    id: 7110294730,
                    type: 500,
                    title: '致当年暗恋的我，给现在暗恋的你',
                    cover: 'http://qpic.y.qq.com/music_cover/abc/300',
                    miscellany: { cnt_content: 40, rcmd_reason: '根据你的喜好' },
                  },
                  { id: 999, type: 300, title: '不是歌单的卡片' },
                ],
              },
            ],
          },
          { v_niche: [{ v_card: [{ id: 6929902945, type: 500, title: '日系疗愈', cover: 'http://qpic.y.qq.com/music_cover/def/300' }] }] },
        ],
      },
    },
  }
  const cards = normalizeQQRecommendCards(payload)
  // 非歌单卡片（type=300）被丢弃
  assert.equal(cards.length, 2)
  assert.equal(cards[0].id, '7110294730')
  assert.equal(cards[0].name, '致当年暗恋的我，给现在暗恋的你')
  assert.equal(cards[0].coverImgUrl, 'http://qpic.y.qq.com/music_cover/abc/300')
  assert.equal(cards[0].source, 'qq')
  assert.equal(cards[0].recommendReason, '根据你的喜好')
  assert.equal(cards[1].id, '6929902945')
})

test('QQ personalized recommendations tolerate missing shelves and junk', () => {
  assert.deepEqual(normalizeQQRecommendCards({ recommend: { data: {} } }), [])
  assert.deepEqual(normalizeQQRecommendCards({}), [])
  assert.deepEqual(normalizeQQRecommendCards(null), [])
  // 缺 id 的歌单卡片会被丢弃，避免生成无法跳转的项
  assert.deepEqual(normalizeQQRecommendCards({ recommend: { data: { v_shelf: [{ v_niche: [{ v_card: [{ type: 500, title: '无 id' }] }] }] } } }), [])
})
