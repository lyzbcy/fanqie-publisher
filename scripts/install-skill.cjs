const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function assertInstallUnmodified(destination) {
  if (!fs.existsSync(destination)) return;
  const runtime = JSON.parse(fs.readFileSync(path.join(destination, '.runtime.json'), 'utf8'));
  if (!runtime.files) throw Error('安装副本缺少完整性记录，保留本地副本');
  const actual = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw Error('安装副本包含链接，保留本地副本');
    if (entry.isDirectory()) walk(file); else actual.push(path.relative(destination, file).split(path.sep).join('/'));
  } };
  walk(destination);
  if (actual.filter(f => f !== '.runtime.json').some(f => !runtime.files[f])) throw Error('安装副本有本地新增文件，保留');
  for (const [file, expected] of Object.entries(runtime.files)) {
    const target = path.resolve(destination, file);
    if (!target.startsWith(path.resolve(destination) + path.sep) || !fs.existsSync(target) || hash(target) !== expected) throw Error('安装副本有本地修改，保留');
  }
}
function removeGenerated(directory, parent) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(parent)) throw Error('清理目标越出安装父目录');
  fs.rmSync(resolved, { recursive: true });
}

function installSkill(root, destination) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, '.fanqie-skill-stage-'));
  const backup = `${destination}.backup-${process.pid}`;
  try {
    fs.copyFileSync(path.join(root, 'docs', 'SKILL.md'), path.join(staging, 'SKILL.md'));
    fs.cpSync(path.join(root, 'docs', 'references'), path.join(staging, 'references'), { recursive: true });
    fs.mkdirSync(path.join(staging, 'scripts'));
    for (const file of ['self-update.cjs', 'install-skill.cjs']) {
      fs.copyFileSync(path.join(root, 'scripts', file), path.join(staging, 'scripts', file));
    }
    const files = {};
    const collect = dir => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const f = path.join(dir, e.name); if (e.isDirectory()) collect(f); else files[path.relative(staging, f).split(path.sep).join('/')] = hash(f); } };
    collect(staging);
    fs.writeFileSync(path.join(staging, '.runtime.json'), JSON.stringify({ repositoryRoot: root, version, files }, null, 2) + '\n');
    if (fs.existsSync(destination)) {
      // Automatic callers check integrity first; explicit installation is a maintenance action.
      fs.renameSync(destination, backup);
    }
    try { fs.renameSync(staging, destination); }
    catch (error) { if (fs.existsSync(backup)) fs.renameSync(backup, destination); throw error; }
    if (fs.existsSync(backup)) { try { removeGenerated(backup, parent); } catch {} }
    return version;
  } finally {
    if (fs.existsSync(staging)) removeGenerated(staging, parent);
  }
}

module.exports = { installSkill, assertInstallUnmodified };
if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const destination = path.resolve(process.argv[2] || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills', 'fanqie-publisher-skill'));
  console.log(`已安装 ${installSkill(root, destination)}：${destination}`);
}
