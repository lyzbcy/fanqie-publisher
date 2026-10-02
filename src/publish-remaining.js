#!/usr/bin/env node

/**
 * Sequentially run the guarded single-chapter publisher.
 * Stops at the first rejected, limited, duplicated, or unverifiable chapter.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const bookDirArg = args.find((value) => value.startsWith('--book-dir='));
const bookDir = path.resolve(bookDirArg?.slice('--book-dir='.length) || process.cwd());
const publish = args.includes('--publish');
const waitForReview = args.includes('--wait-for-review');
const fromArg = args.find((value) => value.startsWith('--from='));
const toArg = args.find((value) => value.startsWith('--to='));
const manifestArg = args.find((value) => value.startsWith('--manifest='));
const configPath = path.join(bookDir, 'config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const ledgerPath = path.join(bookDir, '.publish-state', `${config.book_id}.json`);
const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8')) : { chapters: {} };
const from = Number.parseInt(fromArg?.slice('--from='.length) || String(Object.keys(ledger.chapters).length + 1), 10);
const to = Number.parseInt(toArg?.slice('--to='.length) || String(Number.MAX_SAFE_INTEGER), 10);
const manifestPath = path.resolve(
  manifestArg?.slice('--manifest='.length)
    || path.join(bookDir, 'publish', 'fanqie', 'chapters', 'manifest.json'),
);

if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
  console.error('用法: node src/publish-remaining.js --from=5 --to=42 [--publish] [--manifest=manifest.json]');
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error(`找不到章节清单：${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const chapters = manifest.chapters.filter(({ chapter }) => chapter >= from && chapter <= to);
if (!chapters.length) {
  console.error(`清单中没有第${from}—${to}章`);
  process.exit(1);
}
if (chapters[0].chapter !== from || (toArg && chapters.at(-1).chapter !== to)) {
  console.error('清单缺少请求的起章或止章，拒绝悄悄跳到其他章节');
  process.exit(1);
}
for (let index = 1; index < chapters.length; index += 1) {
  if (chapters[index].chapter !== chapters[index - 1].chapter + 1) {
    console.error(`清单在第${chapters[index - 1].chapter}章与第${chapters[index].chapter}章之间断号`);
    process.exit(1);
  }
}

if (publish) {
  if (!fs.existsSync(configPath)) {
    console.error('找不到 config.json，无法核对发布账本');
    process.exit(1);
  }
  if (!config.book_id || (process.env.BOOK_ID && process.env.BOOK_ID !== String(config.book_id))) {
    console.error('书号缺失或环境变量BOOK_ID与本书配置冲突，拒绝发布');
    process.exit(1);
  }
  const publishedNumbers = Object.keys(ledger.chapters)
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
  for (let expected = 1; expected <= publishedNumbers.length; expected += 1) {
    if (publishedNumbers[expected - 1] !== expected) {
      console.error(`本地账本已断号：期望第${expected}章，实际读到第${publishedNumbers[expected - 1]}章`);
      process.exit(1);
    }
  }
  const expectedNext = publishedNumbers.length + 1;
  if (from !== expectedNext) {
    console.error(`本地账本显示下一章必须是第${expectedNext}章，拒绝从第${from}章开始`);
    process.exit(1);
  }
}

const publisherPath = path.resolve(__dirname, 'publish-chapter.js');
const chapterDir = path.dirname(manifestPath);
const mode = publish ? '--publish' : '--dry-run';

console.log(`准备顺序${publish ? '发布' : '预检'}第${chapters[0].chapter}—${chapters.at(-1).chapter}章；任一章失败即停止。`);
for (const item of chapters) {
  console.log(`\n===== 第${item.chapter}章 ${item.title} =====`);
  const reviewDeadline = Date.now() + 30 * 60 * 1000;
  while (true) {
    const result = spawnSync(
      process.execPath,
      [publisherPath, String(item.chapter), item.title, path.join(chapterDir, item.filename), mode],
      { cwd: bookDir, encoding: 'utf8', env: { ...process.env, BOOK_ID: String(config.book_id || '') } },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) {
      console.error(`第${item.chapter}章启动失败：${result.error.message}`);
      process.exit(1);
    }
    if (result.status === 0) break;
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    if (publish && waitForReview && /状态为“审核中”/.test(output) && Date.now() < reviewDeadline) {
      console.log(`第${item.chapter}章仍在审核，20秒后只复查本章；不会进入第${item.chapter + 1}章。`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000);
      continue;
    }
    console.error(`已停在第${item.chapter}章，后续章节未操作。`);
    process.exit(result.status || 1);
  }
}

console.log(`\n✅ 第${chapters[0].chapter}—${chapters.at(-1).chapter}章全部${publish ? '发布并验证' : '通过本地预检'}。`);
