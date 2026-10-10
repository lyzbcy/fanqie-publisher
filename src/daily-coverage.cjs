const fs = require('fs');
const path = require('path');

function resolveDailyDate(requested, now = new Date()) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(now);
  if (requested && requested !== today) throw Error('日更日期不等于当前北京时间，请核实客户端日期和运行时钟，不能用其他日期绕过覆盖门禁');
  return today;
}

function dayOf(value) {
  const match = /^(\d{4}-\d{2}-\d{2})[ T]/.exec(String(value || ''));
  return match?.[1] || null;
}
function progress(rows, day) {
  const published = rows.filter(row => row.status === '已发布' && dayOf(row.publishedAt) === day);
  if (published.some(row => !Number.isFinite(Number(row.characters)) || Number(row.characters) <= 0)) throw Error('当日已发布字数尚未加载或无效，重新实查后再排更新');
  return { chapters: published.length, characters: published.reduce((sum, row) => sum + Number(row.characters || 0), 0) };
}
function minimum(book) {
  const chapters = book.dailyMinimumChapters ?? 1;
  const characters = book.dailyMinimumCharacters ?? 0;
  if (!Number.isInteger(chapters) || chapters < 1 || !Number.isInteger(characters) || characters < 0) throw Error('每日基本目标无效');
  return { chapters, characters };
}
function covered(book, value) {
  const target = minimum(book);
  return value.chapters >= target.chapters && value.characters >= target.characters;
}
function scopedBooks(registry, day) {
  const active = registry.books.filter(book => book.daily === true);
  const scope = registry.dailyPolicy?.authorizedDayScopes?.[day];
  if (!scope) return active;
  if (scope.authorizedBy !== 'user' || !Array.isArray(scope.bookIds) || !scope.bookIds.length
    || new Set(scope.bookIds.map(String)).size !== scope.bookIds.length
    || scope.bookIds.some(id => !active.some(book => String(book.bookId) === String(id)))) throw Error('临时日更书目缺少作者授权或书号无效');
  return active.filter(book => scope.bookIds.map(String).includes(String(book.bookId)));
}
function loadRegistry(cwd, bookId) {
  let dir = path.resolve(cwd);
  while (true) {
    const file = path.join(dir, '小说日更登记.json');
    if (fs.existsSync(file)) {
      const registry = JSON.parse(fs.readFileSync(file, 'utf8'));
      const book = registry.books?.find(item => String(item.bookId) === String(bookId));
      if (book && registry.dailyPolicy?.coverageFirst === true) {
        const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
        if (normalize(book.directory) !== normalize(cwd)) throw Error('日更登记作品目录与当前工作目录不符');
        return registry;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
async function enforceCoverage({ registry, bookId, day, targetRows, readRows }) {
  if (!registry) return;
  const active = scopedBooks(registry, day);
  const target = active.find(book => String(book.bookId) === String(bookId));
  if (!target) throw Error('当前作品不在作者确认的今日临时更新书目内');
  const targetProgress = progress(targetRows, day);
  if (targetProgress.chapters === 0) return;
  const checkedProgress = (book, rows) => {
    const value = progress(rows, day);
    if (rows.length >= 15 && rows.every(row => dayOf(row.publishedAt) === day) && !covered(book, value)) {
      throw Error('当日章节跨页且基本目标未能确认，先完整核对，不按截断列表追加');
    }
    return value;
  };
  checkedProgress(target, targetRows);
  const missing = [];
  for (const book of active) {
    if (String(book.bookId) === String(bookId)) continue;
    const other = checkedProgress(book, await readRows(book));
    const firstPassMissing = other.chapters === 0;
    const extraBeforeMinimum = covered(target, targetProgress) && !covered(book, other);
    const roundSkipped = !covered(target, targetProgress) && !covered(book, other) && targetProgress.chapters > other.chapters;
    if (firstPassMissing || extraBeforeMinimum || roundSkipped) missing.push(book.title || String(book.bookId));
  }
  if (missing.length) throw Error(`每日覆盖门禁：${missing.join('、')}尚未完成${day}基本更新，禁止继续给当前作品加更。`);
}

// Quota is the verified remaining allowance, not a fabricated account-wide
// character pool. Character allowances belong to individual works.
function planCoverage({ books, snapshots, day, quota, extras = false }) {
  if (!Number.isInteger(quota.remainingWorkSlots) || quota.remainingWorkSlots < 0) throw Error('未确认有效的剩余更新作品数，先实查作者等级及当日已占额度');
  const active = books.filter(book => book.daily === true);
  const work = active.map(book => {
    const snapshot = snapshots[String(book.bookId)];
    if (!snapshot) throw Error(`缺少${book.title || book.bookId}实时后台快照`);
    if (snapshot.completeToday !== true) throw Error('当日发布统计不完整，不能据截断列表规划加更');
    if (snapshot.blockedByReview) throw Error(`${book.title || book.bookId}有待审章节，先核对同章`);
    const value = progress(snapshot.rows || [], day);
    const remaining = quota.remainingCharactersByBook?.[String(book.bookId)] ?? null;
    if (remaining != null && (!Number.isInteger(remaining) || remaining < 0)) throw Error('单作品字数余额无效');
    if (!covered(book, value) && remaining == null) throw Error(`${book.title || book.bookId}未确认单作品日/月字数余额`);
    return { book, value, index: 0, remaining };
  });
  const neededSlots = work.filter(item => !covered(item.book, item.value) && !snapshots[String(item.book.bookId)].occupiesTodaySlot).length;
  if (quota.remainingWorkSlots != null && neededSlots > quota.remainingWorkSlots) {
    throw Error(`作品数额度不足：全部覆盖需要新增${neededSlots}本，剩余只允许${quota.remainingWorkSlots}本；尚未提交任何章节。`);
  }
  const queue = [];
  function append(item, phase) {
    const chapter = item.book.preparedChapters?.[item.index];
    if (!chapter) {
      if (phase === 'minimum') throw Error(`${item.book.title || item.book.bookId}缺少基本更新的完整稿，先续写校对再统一规划`);
      return false;
    }
    const minCharacters = item.book.minChapterCharacters ?? 1000;
    if (!Number.isInteger(minCharacters) || minCharacters < 1) throw Error('作品最低章节字数门槛无效');
    if (!Number.isInteger(chapter.characters) || chapter.characters < minCharacters) {
      if (phase === 'minimum') throw Error(`${item.book.title || item.book.bookId}稿件不足该书发布门槛${minCharacters}字，不能计入基本更新`);
      return false;
    }
    if (item.remaining != null && chapter.characters > item.remaining) {
      if (phase === 'minimum') throw Error(`${item.book.title || item.book.bookId}单作品剩余字数不足以覆盖基本更新；不能借用其他书额度。`);
      return false;
    }
    if (item.remaining != null) item.remaining -= chapter.characters;
    item.value.chapters += 1; item.value.characters += chapter.characters; item.index += 1;
    queue.push({ bookId: String(item.book.bookId), chapter: chapter.chapter, characters: chapter.characters, phase });
    return true;
  }
  while (work.some(item => !covered(item.book, item.value))) {
    for (const item of work) if (!covered(item.book, item.value)) append(item, 'minimum');
  }
  if (extras) {
    let added;
    do {
      added = false;
      for (const item of work) {
        const target = item.book.dailyTargetChapters ?? minimum(item.book).chapters;
        if (item.remaining != null && item.value.chapters < target) added = append(item, 'extra') || added;
      }
    } while (added);
  }
  return { day, queue, coveredBooks: work.map(item => ({ bookId: String(item.book.bookId), ...item.value })) };
}
module.exports = { resolveDailyDate, dayOf, progress, minimum, covered, scopedBooks, loadRegistry, enforceCoverage, planCoverage };
