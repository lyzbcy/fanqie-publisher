const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const script = path.resolve(__dirname, '../src/publish-remaining.js');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fanqie-book-test-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir())); assert.ok(path.basename(root).startsWith('fanqie-book-test-')); fs.rmSync(root, { recursive: true, force: true }); });
  const dir = path.join(root, 'publish/fanqie/chapters'); fs.mkdirSync(dir, { recursive: true });
  const content = '正文'.repeat(600), sha256 = crypto.createHash('sha256').update(content).digest('hex');
  const chapters = [1, 2].map(chapter => ({ chapter, title: `测试${chapter}`, filename: `${chapter}.txt`, sha256 }));
  for (const item of chapters) fs.writeFileSync(path.join(dir, item.filename), content);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ chapters }));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ book_id: 'test-book', cdp_port: 65001 }));
  fs.mkdirSync(path.join(root, '.publish-state')); fs.writeFileSync(path.join(root, '.publish-state/test-book.json'), JSON.stringify({ bookId: 'test-book', chapters: { 1: { title: '测试1', sha256, backendStatus: '已发布' } } }));
  const run = args => spawnSync(process.execPath, [script, `--book-dir=${root}`, ...args], { cwd: os.tmpdir(), encoding: 'utf8', env: { ...process.env, BOOK_ID: '', CDP_PORT: '' } });
  return { root, dir, run };
}
test('explicit book directory resolves manifest when invoked outside repository', t => {
  const f = fixture(t), r = f.run(['--from=2', '--to=2']); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /第2章/);
});
test('missing requested start chapter is refused, never silently skipped', t => {
  const f = fixture(t); const file = path.join(f.dir, 'manifest.json'), m = JSON.parse(fs.readFileSync(file)); m.chapters = m.chapters.filter(c => c.chapter === 2); fs.writeFileSync(file, JSON.stringify(m));
  const r = f.run(['--from=1', '--to=2']); assert.notEqual(r.status, 0); assert.match(r.stderr, /缺少请求的起章/);
});
test('child publisher uses selected book CDP and not repository old-book config', t => {
  const f = fixture(t), r = f.run(['--from=2', '--to=2', '--publish']); assert.notEqual(r.status, 0); assert.match(r.stderr, /127\.0\.0\.1:65001/);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(f.root, '.publish-state/test-book.json'))).chapters), ['1']);
});
