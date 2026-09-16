#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const source = process.argv[2];
const outputDir = process.argv[3];

if (!source || !outputDir) {
  console.error('用法: node src/prepare-novel.js <合订稿.md> <输出目录>');
  process.exit(1);
}

const input = fs.readFileSync(path.resolve(source), 'utf8').replace(/^\uFEFF/, '');
const heading = /^##\s*第([一二三四五六七八九十百零〇两\d]+)章(?:\s+|[：:])(.+)$/gm;
const matches = [...input.matchAll(heading)];

if (!matches.length) {
  console.error('未找到“## 第X章 标题”格式的章节');
  process.exit(1);
}

const sha256 = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const countNonWhitespace = (value) => [...value.replace(/\s/g, '')].length;
const countCjk = (value) => (value.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g) || []).length;
const parseChapterNumber = (value) => {
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10);
  const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (!/[十百]/.test(value)) return Number([...value].map((item) => digits[item]).join(''));
  let total = 0;
  let current = 0;
  for (const character of value) {
    if (Object.hasOwn(digits, character)) {
      current = digits[character];
    } else if (character === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (character === '百') {
      total += (current || 1) * 100;
      current = 0;
    }
  }
  return total + current;
};

const resolvedOutputDir = path.resolve(outputDir);
fs.mkdirSync(resolvedOutputDir, { recursive: true });
const preparedChapters = matches.map((match, index) => {
  const bodyStart = match.index + match[0].length;
  const bodyEnd = index + 1 < matches.length ? matches[index + 1].index : input.length;
  const body = input.slice(bodyStart, bodyEnd).replace(/^\s*---\s*$/gm, '').trim();
  const chapter = parseChapterNumber(match[1]);
  if (!Number.isInteger(chapter) || chapter < 1) {
    console.error(`无法解析章节号：${match[1]}`);
    process.exit(1);
  }
  const title = match[2].trim();
  const filename = `${String(chapter).padStart(3, '0')}-${title.replace(/[<>:"/\\|?*]/g, '_')}.txt`;
  return {
    body,
    chapter,
    sourceHeading: match[0],
    title,
    filename,
    characters: [...body].length,
    nonWhitespaceCharacters: countNonWhitespace(body),
    cjkCharacters: countCjk(body),
    sha256: sha256(body),
  };
});

const chapterNumbers = preparedChapters.map((item) => item.chapter);
if (new Set(chapterNumbers).size !== chapterNumbers.length) {
  console.error('源稿包含重复章节号，已停止，未写入输出文件');
  process.exit(1);
}
for (let index = 1; index < chapterNumbers.length; index += 1) {
  if (chapterNumbers[index] <= chapterNumbers[index - 1]) {
    console.error('源稿章节号不是严格递增顺序，已停止，未写入输出文件');
    process.exit(1);
  }
}

const oldManifestPath = path.join(resolvedOutputDir, 'manifest.json');
if (fs.existsSync(oldManifestPath)) {
  const oldManifest = JSON.parse(fs.readFileSync(oldManifestPath, 'utf8'));
  for (const oldChapter of oldManifest.chapters || []) {
    if (!oldChapter.filename || path.basename(oldChapter.filename) !== oldChapter.filename) continue;
    const oldFile = path.join(resolvedOutputDir, oldChapter.filename);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
  }
}
for (const item of preparedChapters) {
  fs.writeFileSync(path.join(resolvedOutputDir, item.filename), `${item.body}\n`, 'utf8');
}
const chapters = preparedChapters.map(({ body, ...item }) => item);

const manifest = {
  schemaVersion: 1,
  source: path.resolve(source),
  sourceSha256: sha256(input),
  generatedAt: new Date().toISOString(),
  chapterCount: chapters.length,
  chapters,
};
fs.writeFileSync(path.join(resolvedOutputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const short = chapters.filter((item) => item.nonWhitespaceCharacters < 1000);
console.log(`已拆分 ${chapters.length} 章：${resolvedOutputDir}`);
console.log(`源文件 SHA-256: ${manifest.sourceSha256}`);
console.log(`非空白字符少于1000：${short.length}章`);
for (const item of short) console.log(`  第${item.chapter}章 ${item.title}: ${item.nonWhitespaceCharacters}`);
