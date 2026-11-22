'use strict';
// Snapshots of /homeassistant in a separate git directory (/data/configgit).
// The HA config folder itself is never turned into a repository.

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const GIT_DIR = process.env.HM_GIT_DIR || '/data/configgit';
const WORK = process.env.HM_CONFIG_DIR || '/homeassistant';

const EXCLUDES = [
  '*.db', '*.db-shm', '*.db-wal', '*.db-journal', '*.log', '*.log.*', '*.log.fault',
  'deps/', 'tts/', 'backups/', '.cache/', '__pycache__/', '*.pyc', '.cloud/', 'node_modules/',
  '.storage/core.restore_state', '.storage/trace.saved_traces', '.storage/backup', '.storage/http.auth',
  '.storage/auth', '.storage/auth_provider.homeassistant', '.storage/onboarding', '.storage/cloud',
  '.storage/hacs.*', 'www/community/', 'zigbee2mqtt/log/', '*.tar', '*.tar.gz', '*.zip', '*.mp4', '*.jpg', '*.png',
  'ollama/', 'media/', 'esphome/.esphome/', '.esphome/', 'frigate/', '.git/', '.venv/', 'venv/', '*.bin', '*.gguf', '*.safetensors',
];
// Directories the size scan does not enter (also excluded above).
const SKIP_DIRS = new Set(['ollama', 'media', '.esphome', 'frigate', '.git', '.venv', 'venv', 'node_modules', 'deps', 'tts', 'backups', '.cache', '__pycache__', 'community', 'log']);
// Files above this size are left out, except the registries and dashboards in .storage.
const MAX_BYTES = Number(process.env.HM_MAX_FILE_BYTES || 20 * 1024 * 1024);

function largeFiles(dir = WORK, rel = '') {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) out.push(...largeFiles(dir, r)); continue; }
    if (!e.isFile() || r.startsWith('.storage/')) continue;
    try { if (fs.statSync(path.join(dir, r)).size > MAX_BYTES) out.push(r); } catch { /* gone */ }
  }
  return out;
}

function writeExcludes() {
  const big = largeFiles().map((f) => `/${f.replace(/([*?[\\])/g, '\\$1')}`);
  fs.writeFileSync(path.join(GIT_DIR, 'info', 'exclude'), `${[...EXCLUDES, '# larger than the limit', ...big].join('\n')}\n`);
  return big;
}

function git(args, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', [`--git-dir=${GIT_DIR}`, `--work-tree=${WORK}`, ...args], { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err && !allowFail) reject(new Error(`git ${args[0]}: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

async function init() {
  if (!fs.existsSync(path.join(GIT_DIR, 'HEAD'))) {
    fs.mkdirSync(GIT_DIR, { recursive: true });
    await new Promise((res, rej) => execFile('git', ['init', '--bare', '-q', GIT_DIR], (e) => (e ? rej(e) : res())));
    await git(['config', 'core.bare', 'false']);
    await git(['config', 'user.name', 'Hausmeister']);
    await git(['config', 'user.email', 'hausmeister@localhost']);
    await git(['config', 'gc.auto', '256']);
  }
  fs.mkdirSync(path.join(GIT_DIR, 'info'), { recursive: true });
  writeExcludes();
}

// Commits the current state, returns the commit id (also when nothing changed).
async function snapshot(message) {
  writeExcludes();
  await git(['add', '-A', '.']);
  const changed = await git(['status', '--porcelain'], { allowFail: true });
  const hasHead = !!(await git(['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true }));
  if (changed || !hasHead) await git(['commit', '-q', '--allow-empty', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

async function changedFiles(from, to) {
  if (!from || !to || from === to) return [];
  const out = await git(['diff', '--name-status', from, to]);
  return out ? out.split('\n').map((l) => { const [st, ...p] = l.split('\t'); return { status: st, file: p[p.length - 1], old: p.length > 1 ? p[0] : null }; }) : [];
}

async function log(n = 40) {
  const out = await git(['log', `-${n}`, '--date=iso-strict', '--pretty=format:%H%x09%ad%x09%s'], { allowFail: true });
  return out ? out.split('\n').map((l) => { const [id, at, msg] = l.split('\t'); return { id, at, msg }; }) : [];
}

// Restores the files that changed between pre and post to their state in pre.
async function restore(pre, post, only) {
  const files = (await changedFiles(pre, post)).filter((f) => !only || only.includes(f.file));
  for (const f of files) {
    if (f.status.startsWith('A')) fs.rmSync(path.join(WORK, f.file), { force: true });
    else if (f.status.startsWith('R')) {
      fs.rmSync(path.join(WORK, f.file), { force: true });
      await git(['checkout', pre, '--', f.old]);
    } else await git(['checkout', pre, '--', f.file]);
  }
  return files;
}

module.exports = { init, snapshot, largeFiles, changedFiles, log, restore, GIT_DIR, WORK };
