const { test } = require('node:test');
const assert = require('node:assert/strict');
const { progress, enforceCoverage, planCoverage, resolveDailyDate } = require('../src/daily-coverage.cjs');
const day = '2026-10-10';
const row = (characters = 1200, status = '已发布', date = day) => ({ status, characters, publishedAt: `${date} 07:05` });
const books = ['a', 'b'].map(bookId => ({ bookId, title: bookId, daily: true, dailyTargetChapters: 2, preparedChapters: [{ chapter: 1, characters: 1200 }, { chapter: 2, characters: 1200 }] }));
const snapshots = { a: { rows: [], occupiesTodaySlot: false, completeToday: true }, b: { rows: [], occupiesTodaySlot: false, completeToday: true } };
const quota = { remainingWorkSlots: 2, remainingCharactersByBook: { a: 5000, b: 5000 } };
test('requested future or past date cannot bypass today coverage', () => {
  const now = new Date('2026-10-09T16:01:00Z');
  assert.equal(resolveDailyDate('2026-10-10', now), '2026-10-10');
  assert.throws(() => resolveDailyDate('2099-01-01', now), /不等于当前北京时间/);
  assert.throws(() => resolveDailyDate('2026-10-09', now), /不等于当前北京时间/);
});
test('short drafts cannot be reported as complete chapters; each book keeps its own minimum', () => {
  assert.throws(() => planCoverage({ books: [{ ...books[0], preparedChapters: [{ chapter: 1, characters: 1 }] }, books[1]], snapshots, day, quota }), /不足该书发布门槛/);
  assert.throws(() => planCoverage({ books: [books[0], { ...books[1], minChapterCharacters: 2000 }], snapshots, day, quota }), /2000字/);
  const mixed = [{ ...books[0], minChapterCharacters: 1000 }, { ...books[1], minChapterCharacters: 2000, preparedChapters: [{ chapter: 1, characters: 2000 }] }];
  assert.equal(planCoverage({ books: mixed, snapshots, day, quota }).queue.length, 2);
});
test('first pass covers every work before second round', () => {
  const result = planCoverage({ books, snapshots, day, quota, extras: true });
  assert.deepEqual(result.queue.map(x => [x.bookId, x.phase]), [['a', 'minimum'], ['b', 'minimum'], ['a', 'extra'], ['b', 'extra']]);
});
test('Lv0 one-work quota cannot be fixed by smaller character allocations', () => {
  assert.throws(() => planCoverage({ books, snapshots, day, quota: { ...quota, remainingWorkSlots: 1 } }), /作品数额度不足/);
});
test('character allowance cannot be borrowed from another work', () => {
  assert.throws(() => planCoverage({ books, snapshots, day, quota: { ...quota, remainingCharactersByBook: { a: 1000, b: 9999 } } }), /单作品剩余字数不足/);
});
test('unknown quota never claims all-work coverage is feasible', () => {
  assert.throws(() => planCoverage({ books, snapshots, day, quota: {} }), /未确认/);
  assert.throws(() => planCoverage({ books, snapshots, day, quota: { remainingWorkSlots: 2 } }), /未确认单作品/);
});
test('missing manuscript in one active work aborts planning rather than omitting it', () => {
  assert.throws(() => planCoverage({ books: [books[0], { ...books[1], preparedChapters: [] }], snapshots, day, quota }), /缺少基本更新/);
});
test('pending, scheduled and yesterday rows do not count as today published coverage', () => {
  assert.deepEqual(progress([row(1200, '审核中'), row(1200, '定时发布'), row(1200, '已发布', '2026-10-09'), row()], day), { chapters: 1, characters: 1200 });
});
test('unloaded publication counters do not permit unbounded catch-up in one book', () => {
  assert.throws(() => progress([row(0)], day), /未加载或无效/);
});
test('confirmed character goal is reached round by round without equating one chapter with 4000 chars', () => {
  const extended = books.map(book => ({ ...book, dailyMinimumCharacters: 2400 }));
  const result = planCoverage({ books: extended, snapshots, day, quota });
  assert.deepEqual(result.queue.map(x => x.bookId), ['a', 'b', 'a', 'b']);
  assert.ok(result.queue.every(x => x.phase === 'minimum'));
});
test('extra chapter is blocked while another work has no real update', async () => {
  const registry = { books };
  await assert.rejects(enforceCoverage({ registry, bookId: 'a', day, targetRows: [row()], readRows: async () => [] }), /每日覆盖门禁/);
  await enforceCoverage({ registry, bookId: 'a', day, targetRows: [], readRows: async () => { throw Error('should not inspect extras on first chapter'); } });
  await enforceCoverage({ registry, bookId: 'a', day, targetRows: [row()], readRows: async () => [row()] });
});
test('4000-char target still gives every book its first chapter before filling one book', async () => {
  const registry = { books: books.map(b => ({ ...b, dailyMinimumCharacters: 4000 })) };
  await assert.rejects(enforceCoverage({ registry, bookId: 'a', day, targetRows: [row()], readRows: async () => [] }), /每日覆盖门禁/);
  await assert.rejects(enforceCoverage({ registry, bookId: 'a', day, targetRows: [row(), row()], readRows: async () => [row()] }), /每日覆盖门禁/);
  await enforceCoverage({ registry, bookId: 'a', day, targetRows: [row()], readRows: async () => [row()] });
});
test('truncated all-today page cannot be treated as a shortage permitting more updates', async () => {
  const registry = { books: books.map(b => ({ ...b, dailyMinimumCharacters: 40000 })) };
  await assert.rejects(enforceCoverage({ registry, bookId: 'a', day, targetRows: Array.from({ length: 15 }, () => row()), readRows: async () => [] }), /跨页/);
  assert.throws(() => planCoverage({ books, snapshots: { ...snapshots, a: { ...snapshots.a, completeToday: false } }, day, quota }), /统计不完整/);
});
test('third work already occupying today slot needs no additional new-work quota', () => {
  const result = planCoverage({ books, snapshots: { ...snapshots, a: { rows: [], occupiesTodaySlot: true, completeToday: true } }, day, quota: { ...quota, remainingWorkSlots: 1 } });
  assert.equal(result.queue.length, 2);
});
