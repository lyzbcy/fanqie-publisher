const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { installSkill, assertInstallUnmodified } = require('./install-skill.cjs');

const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function compareVersions(a, b) {
  const parse = v => { if (!/^\d+\.\d+\.\d+$/.test(v)) throw Error('仅接受正式三段版本号'); return v.split('.').map(Number); };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}
function checkForUpdates({ root, installDir, date = today(), force = false, timeoutMs = 12000 }) {
  root = path.resolve(root);
  const stateFile = path.join(root, '.skill-update.json'), lockFile = path.join(root, '.skill-update.lock');
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: timeoutMs, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' } });
    if (r.error || r.status !== 0) throw Error(r.error?.message || r.stderr?.trim() || 'git失败');
    return r.stdout.trim();
  };
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}
  if (!force && state.checkedDate === date) return { ...state, status: 'already-checked' };
  let lock;
  try {
    if (fs.existsSync(lockFile) && Date.now() - fs.statSync(lockFile).mtimeMs > 10 * 60 * 1000) fs.unlinkSync(lockFile);
    lock = fs.openSync(lockFile, 'wx');
  } catch { return { status: 'busy' }; }
  let originalHead, updated = false;
  const result = { checkedDate: date, status: 'kept-old' };
  try {
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
    result.localVersion = version;
    const upstream = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}');
    const slash = upstream.indexOf('/');
    const remote = upstream.slice(0, slash), branch = upstream.slice(slash + 1);
    if (slash < 1 || !branch) throw Error('未设置上游分支');
    git('fetch', '--quiet', remote, branch);
    const target = git('rev-parse', upstream);
    const remotePackage = JSON.parse(git('show', `${target}:package.json`));
    result.remoteVersion = remotePackage.version;
    const comparison = compareVersions(remotePackage.version, version);
    if (comparison <= 0) { result.status = comparison === 0 ? 'current' : 'local-newer'; }
    else {
      if (installDir) assertInstallUnmodified(path.resolve(installDir));
      if (git('status', '--porcelain', '--untracked-files=normal')) throw Error('本地有未提交修改，保留，不覆盖');
      originalHead = git('rev-parse', 'HEAD');
      git('merge-base', '--is-ancestor', originalHead, target);
      // Dependency migrations need a separate install; never break today's publishing runtime.
      for (const file of ['package.json', 'package-lock.json']) {
        const before = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
        const after = JSON.parse(git('show', `${target}:${file}`));
        if (file === 'package.json') {
          if (JSON.stringify(before.dependencies) !== JSON.stringify(after.dependencies) || JSON.stringify(before.devDependencies) !== JSON.stringify(after.devDependencies)) throw Error('依赖发生变化，保留旧版运行环境');
        } else {
          // Root package version may change; actual dependency nodes must stay compatible.
          delete before.version; delete after.version;
          if (before.packages?.['']) delete before.packages[''].version;
          if (after.packages?.['']) delete after.packages[''].version;
          if (JSON.stringify(before) !== JSON.stringify(after)) throw Error('依赖锁定发生变化，保留旧版运行环境');
        }
      }
      for (const file of ['docs/SKILL.md', 'docs/references/daily-update.md', 'docs/references/self-update.md', 'scripts/self-update.cjs', 'scripts/install-skill.cjs']) {
        const text = git('show', `${target}:${file}`);
        if (file === 'docs/SKILL.md' && !text.includes(`version: "${remotePackage.version}"`)) throw Error('远端skill与程序版本不一致，保留旧版');
      }
      git('merge', '--ff-only', '--quiet', target); updated = true;
      if (installDir) installSkill(root, path.resolve(installDir));
      result.status = 'updated'; result.localVersion = remotePackage.version;
    }
    if (!updated && installDir) {
      const installed = JSON.parse(fs.readFileSync(path.join(installDir, '.runtime.json'), 'utf8')).version;
      if (compareVersions(version, installed) > 0) {
        if (git('status', '--porcelain', '--untracked-files=normal')) throw Error('本地有未提交修改，不自动同步到安装副本');
        assertInstallUnmodified(path.resolve(installDir));
        installSkill(root, path.resolve(installDir));
        result.status = 'synced-installed';
      }
    }
  } catch (error) {
    if (updated && originalHead) {
      // Only tracked program files from the clean preflight are restored; user data are ignored.
      try { git('reset', '--keep', originalHead); } catch (rollbackError) { result.rollbackError = rollbackError.message; }
    }
    result.reason = error.message;
  } finally {
    try { fs.writeFileSync(stateFile, JSON.stringify(result, null, 2) + '\n'); } catch {}
    try { fs.closeSync(lock); } catch {}
    try { fs.unlinkSync(lockFile); } catch {}
  }
  return result;
}
module.exports = { checkForUpdates, compareVersions };
if (require.main === module) {
  // This helper is also copied into the installed skill; resolve its registered repository.
  try {
  const base = path.resolve(__dirname, '..');
  const runtime = path.join(base, '.runtime.json');
  let root = base, installDir;
  if (fs.existsSync(runtime)) { root = JSON.parse(fs.readFileSync(runtime, 'utf8')).repositoryRoot; installDir = base; }
  const result = checkForUpdates({ root, installDir, force: process.argv.includes('--force') });
  if (process.argv.includes('--verbose')) console.log(JSON.stringify(result));
  // Offline/failed checks never stop the publishing workflow.
  } catch (error) { if (process.argv.includes('--verbose')) console.log(JSON.stringify({ status: 'kept-old', reason: error.message })); }
}
