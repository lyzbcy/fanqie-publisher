const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { checkForUpdates, compareVersions } = require('../scripts/self-update.cjs');
const { installSkill } = require('../scripts/install-skill.cjs');
const source = path.resolve(__dirname, '..');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanqie-update-test-'));
  t.after(() => { const absolute = path.resolve(dir); assert.equal(path.dirname(absolute), path.resolve(os.tmpdir())); assert.ok(path.basename(absolute).startsWith('fanqie-update-test-')); fs.rmSync(absolute, { recursive: true, force: true }); });
  const remote = path.join(dir, 'origin'), root = path.join(dir, 'local'); fs.mkdirSync(remote);
  function git(cwd, ...args) { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
  git(remote, 'init', '--quiet', '--initial-branch=master');
  git(remote, 'config', 'user.name', 'Test'); git(remote, 'config', 'user.email', 'test@example.invalid');
  fs.mkdirSync(path.join(remote, 'docs'), { recursive: true });
  fs.copyFileSync(path.join(source, 'docs/SKILL.md'), path.join(remote, 'docs/SKILL.md'));
  fs.cpSync(path.join(source, 'docs/references'), path.join(remote, 'docs/references'), { recursive: true });
  fs.cpSync(path.join(source, 'scripts'), path.join(remote, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(remote, '.gitignore'), '.skill-update.json\n.skill-update.lock\nconfig.json\nbrowser-data/\n.publish-state/\n');
  function release(version, dependencies = {}) {
    fs.writeFileSync(path.join(remote, 'package.json'), JSON.stringify({ name: 'fixture', version, dependencies }));
    fs.writeFileSync(path.join(remote, 'package-lock.json'), JSON.stringify({ name: 'fixture', version, lockfileVersion: 3, packages: { '': { name: 'fixture', version, dependencies } } }));
    fs.writeFileSync(path.join(remote, 'docs/SKILL.md'), `---\nname: fanqie-publisher-skill\ndescription: test\nmetadata:\n  version: "${version}"\n---\nVersion ${version}\n`);
    git(remote, 'add', '.'); git(remote, 'commit', '--quiet', '-m', version);
  }
  release('1.0.0'); git(dir, 'clone', '--quiet', remote, root);
  return { root, remote, dir, git, release, check: options => checkForUpdates({ root, date: '2026-10-02', ...options }) };
}
test('numeric version comparison does not mistake 1.10 for 1.2', () => {
  assert.equal(compareVersions('1.10.0', '1.2.9'), 1); assert.equal(compareVersions('1.0.0', '1.0.0'), 0); assert.throws(() => compareVersions('dev', '1.0.0'));
});
test('daily cache checks once and retries on next date', t => {
  const f = fixture(t); assert.equal(f.check().status, 'current'); f.release('1.1.0');
  assert.equal(f.check().status, 'already-checked'); assert.equal(f.check({ date: '2026-10-03' }).status, 'updated');
});
test('new release updates complete skill and preserves ignored runtime data', t => {
  const f = fixture(t), installed = path.join(f.dir, 'installed'); installSkill(f.root, installed);
  for (const file of ['config.json', 'browser-data/cookies', '.publish-state/book.json']) { fs.mkdirSync(path.dirname(path.join(f.root, file)), { recursive: true }); fs.writeFileSync(path.join(f.root, file), 'private-runtime'); }
  f.release('1.1.0'); assert.equal(f.check({ installDir: installed }).status, 'updated');
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed, '.runtime.json'))).version, '1.1.0');
  assert.ok(fs.existsSync(path.join(installed, 'references/daily-update.md'))); assert.ok(fs.existsSync(path.join(installed, 'scripts/self-update.cjs')));
  for (const file of ['config.json', 'browser-data/cookies', '.publish-state/book.json']) assert.equal(fs.readFileSync(path.join(f.root, file), 'utf8'), 'private-runtime');
});
test('offline update keeps old version; failure never terminates workflow', t => {
  const f = fixture(t); f.git(f.root, 'remote', 'set-url', 'origin', path.join(f.dir, 'missing'));
  assert.equal(f.check().status, 'kept-old'); assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'))).version, '1.0.0'); assert.equal(f.check().status, 'already-checked');
  const r = spawnSync(process.execPath, [path.join(f.root, 'scripts/self-update.cjs'), '--force'], { encoding: 'utf8' }); assert.equal(r.status, 0); assert.equal(r.stdout, '');
});
test('dirty repository and edited installed skill are never overwritten', t => {
  const f = fixture(t), installed = path.join(f.dir, 'installed'); installSkill(f.root, installed); f.release('1.1.0');
  fs.appendFileSync(path.join(f.root, 'docs/SKILL.md'), 'local edit'); assert.match(f.check().reason, /未提交/);
  f.git(f.root, 'restore', 'docs/SKILL.md'); fs.appendFileSync(path.join(installed, 'SKILL.md'), 'custom edit');
  assert.match(f.check({ force: true, installDir: installed }).reason, /本地修改/); assert.match(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'), /custom edit/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'))).version, '1.0.0');
});
test('dependency-changing release fails safely without altering old tool', t => {
  const f = fixture(t); f.release('1.1.0', { changed: '1.0.0' }); assert.match(f.check().reason, /依赖/); assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'))).version, '1.0.0');
});
test('installation failure rolls back only its clean fast-forward', t => {
  const f = fixture(t), installed = path.join(f.dir, 'installed'); installSkill(f.root, installed);
  // Block the atomic directory swap after the git fast-forward, without touching the old skill.
  const backup = `${installed}.backup-${process.pid}`; fs.mkdirSync(backup); fs.writeFileSync(path.join(backup, 'blocker'), 'occupied');
  f.release('1.1.0'); const result = f.check({ installDir: installed }); assert.equal(result.status, 'kept-old');
  assert.equal(result.rollbackError, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'package.json'))).version, '1.0.0'); assert.equal(JSON.parse(fs.readFileSync(path.join(installed, '.runtime.json'))).version, '1.0.0');
});
