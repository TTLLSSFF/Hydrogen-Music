import test from 'node:test'
import assert from 'node:assert/strict'

import { parseTextWithEmoji, resolveEmojiToken, getQQEmojiUrl } from '../src/utils/emojiParser.js'

// QQ 旧版评论接口的正文是带表情码的纯文本，直接展示会原样吐出 [em]e401328[/em]。
test('QQ emoji codes become images instead of raw [em] tokens', () => {
  const segments = parseTextWithEmoji('[em]e401328[/em][em]e401328[/em][em]e400083[/em]')
  assert.equal(segments.length, 3)
  assert.deepEqual(segments.map(segment => segment.type), ['image', 'image', 'image'])
  assert.equal(segments[0].src, 'https://qzonestyle.gtimg.cn/qzone/em/e401328.gif')
  assert.equal(segments[2].src, 'https://qzonestyle.gtimg.cn/qzone/em/e400083.gif')
})

test('QQ emoji codes keep the surrounding text', () => {
  const segments = parseTextWithEmoji('好听[em]e100[/em]谢谢')
  assert.deepEqual(segments.map(segment => segment.type), ['text', 'image', 'text'])
  assert.equal(segments[0].content, '好听')
  assert.equal(segments[2].content, '谢谢')
})

test('QQ image placeholder becomes a media segment, not literal brackets', () => {
  const segments = parseTextWithEmoji('活着的氧气已经耗尽[图片]')
  assert.equal(segments.length, 2)
  assert.equal(segments[0].type, 'text')
  assert.equal(segments[1].type, 'image-placeholder')
  assert.equal(segments[1].content, '图片')
  assert.equal(segments[1].original, '[图片]')
})

test('NetEase emoji parsing still resolves its own tokens', () => {
  // QQ 表情码分支不能顺手把网易云的 [名字] 也吃掉
  const segments = parseTextWithEmoji('开心[可爱]')
  assert.equal(segments[1].type, 'image')
  assert.equal(segments[1].source, 'netease')
  assert.equal(segments[1].content, '😊')
  // 两边都不认识的方括号内容保持原样
  assert.equal(resolveEmojiToken('[随便写点什么]'), null)
})

test('QQ emoji url builder rejects empty codes', () => {
  assert.equal(getQQEmojiUrl(''), '')
  assert.equal(getQQEmojiUrl(null), '')
  assert.equal(getQQEmojiUrl('e401328'), 'https://qzonestyle.gtimg.cn/qzone/em/e401328.gif')
})