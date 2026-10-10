#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { planCoverage, resolveDailyDate, scopedBooks } = require('./daily-coverage.cjs');
const args = process.argv.slice(2);
const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
try {
  const day = option('date'), registryFile = option('registry'), snapshotFile = option('snapshot');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !registryFile || !snapshotFile) throw Error('用法：node src/plan-daily.js --date=YYYY-MM-DD --registry=登记.json --snapshot=实时快照.json [--extras]');
  resolveDailyDate(day);
  const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  if (snapshot.day !== day || snapshot.source !== 'fanqie-backend') throw Error('快照日期或来源不符');
  const age = Date.now() - Date.parse(snapshot.verifiedAt);
  if (!Number.isFinite(age) || age < 0 || age > 10 * 60 * 1000) throw Error('后台快照超过10分钟或时间无效，重新实查后再规划');
  const selected = scopedBooks(registry, day);
  const books = selected.map(book => {
    if (!book.daily) return book;
    const config = JSON.parse(fs.readFileSync(path.join(book.directory, 'config.json'), 'utf8'));
    if (String(config.book_id) !== String(book.bookId)) throw Error('书号与作品配置不符');
    const manifest = JSON.parse(fs.readFileSync(path.join(book.directory, 'publish/fanqie/chapters/manifest.json'), 'utf8'));
    const stateFile = path.join(book.directory, '.publish-state', `${book.bookId}.json`);
    const ledger = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { chapters: {} };
    const keys = Object.keys(ledger.chapters).map(Number).sort((a, b) => a - b);
    if (keys.some((value, index) => value !== index + 1)) throw Error('本地账本断号');
    for (const number of keys) {
      const item = manifest.chapters.find(c => c.chapter === number), prior = ledger.chapters[number];
      if (!item || item.title !== prior.title || item.sha256 !== prior.sha256) throw Error('已发布清单与账本不符');
    }
    const next = keys.length + 1;
    const prepared = manifest.chapters.filter(c => c.chapter >= next);
    if (prepared.some((c, index) => c.chapter !== next + index)) throw Error('待发清单断号，不能跳章规划');
    const minChapterCharacters = Number(process.env.MIN_CHAPTER_CHARACTERS || config.min_chapter_characters || 1000);
    return { ...book, minChapterCharacters, preparedChapters: prepared.map(c => {
      if (path.basename(c.filename) !== c.filename) throw Error('稿件文件名越界');
      const content = fs.readFileSync(path.join(book.directory, 'publish/fanqie/chapters', c.filename), 'utf8').trim();
      if (crypto.createHash('sha256').update(content).digest('hex') !== c.sha256) throw Error('待发正文与清单哈希不同');
      return { chapter: c.chapter, characters: [...content.replace(/\s/g, '')].length };
    }) };
  });
  const plan = planCoverage({ books, snapshots: snapshot.books, day, quota: snapshot.quota || {}, extras: args.includes('--extras') });
  plan.deferredBooks = registry.books.filter(book => book.daily === true && !selected.some(item => String(item.bookId) === String(book.bookId))).map(book => ({ bookId: String(book.bookId), title: book.title }));
  console.log(JSON.stringify(plan, null, 2));
  console.log('仅生成轮转计划；未连接浏览器或提交章节。执行时每章仍须通过发布器的实时门禁。');
} catch (error) { console.error(error.message); process.exitCode = 1; }
