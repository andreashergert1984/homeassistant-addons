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
];

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
  fs.writeFileSync(path.join(GIT_DIR, 'info', 'exclude'), `${EXCLUDES.join('\n')}\n`);
}

// Commits the current state, returns the commit id (also when nothing changed).
async function snapshot(message) {
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
async function restore(pre, post) {
  const files = await changedFiles(pre, post);
  for (const f of files) {
    if (f.status.startsWith('A')) fs.rmSync(path.join(WORK, f.file), { force: true });
    else if (f.status.startsWith('R')) {
      fs.rmSync(path.join(WORK, f.file), { force: true });
      await git(['checkout', pre, '--', f.old]);
    } else await git(['checkout', pre, '--', f.file]);
  }
  return files;
}

module.exports = { init, snapshot, changedFiles, log, restore, GIT_DIR, WORK };
