# SDD ledger — plan: docs/superpowers/plans/2026-09-10-qq-toplist-detail.md

Baseline: `648d33a` (npm test 129/129 green before any task).

- Task 1: complete (commits 648d33a..16ffa54, review clean)
- Task 1: minor (deferred): 测试用 `JSON.stringify(body).includes(...)` 做脱敏断言，属字符串级宽松断言，建议后续改为显式键断言；默认实现内 `offset/+page || 0`、`num: +limit || 100` 兜底因固定参数不可达，无害。
- Task 2: complete (commits 16ffa54..1ac0a7f, review clean)
- Task 2: minor (deferred): `normalizeQQTopListDetail` 中 `trackCount` 经 `firstPositiveQQValue` 返回原始值，上游若以数字字符串下发则为字符串；建议 `Number(...)` 归一。`playlist.id` 优先取 `songData.topId` 再退回 fallbackId，属简报外的合理分支、通常相等，无害。
- Task 3: complete (commits 1ac0a7f..b00abb4, review clean)
- Task 3: minor (deferred): 无
- Task 4: complete (b00abb4, review clean)
- Task 4: minor (deferred): 无
- Task 5: complete (final local commit, review clean)