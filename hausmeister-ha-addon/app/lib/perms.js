'use strict';
// File permissions for the split between root and the unprivileged user "hausmeister".
// Draft and inspection run as hausmeister; the implementation after approval stays root.
// hausmeister owns /data/home (login of Claude, token refresh) and reads the rest; it never
// writes /data/configgit, /data/options.json, the store, /app or the configuration of Home Assistant.
// All file functions are injectable, so the logic is testable without root.

const fs = require('fs');
const path = require('path');

const RUN_USER = process.env.HM_RUN_USER || 'hausmeister';

// { name, uid, gid } from /etc/passwd, or null (outside the image, or the user is root).
function lookupUser(name = RUN_USER, passwdFile = '/etc/passwd', readFile = fs.readFileSync) {
  let text;
  try { text = String(readFile(passwdFile, 'utf8')); } catch { return null; }
  for (const line of text.split('\n')) {
    const [n, , uid, gid] = line.split(':');
    if (n === name && /^\d+$/.test(uid || '') && /^\d+$/.test(gid || '') && Number(uid) !== 0) return { name, uid: Number(uid), gid: Number(gid) };
  }
  return null;
}

// Gives a whole tree to uid:gid (lchown, symlinks are not followed). Only entries that differ are
// changed, so it is cheap to call before every run. Returns the number of changed entries.
function chownTree(dir, uid, gid, fsx = fs) {
  let n = 0;
  const walk = (p) => {
    let st;
    try { st = fsx.lstatSync(p); } catch { return; }
    if (st.uid !== uid || st.gid !== gid) { fsx.lchownSync(p, uid, gid); n++; }
    if (st.isDirectory()) for (const e of fsx.readdirSync(p)) walk(path.join(p, e));
  };
  walk(dir);
  return n;
}

// Sets the mode if it differs. Returns true when it changed something.
function ensureMode(p, mode, fsx = fs) {
  let st;
  try { st = fsx.statSync(p); } catch { return false; }
  if ((st.mode & 0o7777) === mode) return false;
  fsx.chmodSync(p, mode);
  return true;
}

// Prepares the rights at start (idempotent). paths: { home, work, claudeMd, wissen, gitDir,
// private: [files only root reads], config }. Returns a list of English log lines.
function prepare(user, paths, { fsx = fs } = {}) {
  const log = [];
  if (!user) return log;
  const { home, work, claudeMd, wissen, gitDir, config } = paths;
  fsx.mkdirSync(home, { recursive: true });
  const n = chownTree(home, user.uid, user.gid, fsx);
  ensureMode(home, 0o700, fsx);
  if (n) log.push(`${home} now belongs to ${user.name} (${n} entries)`);
  // Working directory and rules: readable, not writable for hausmeister.
  if (work) { fsx.mkdirSync(work, { recursive: true }); ensureMode(work, 0o755, fsx); }
  if (claudeMd) ensureMode(claudeMd, 0o644, fsx);
  if (wissen) ensureMode(wissen, 0o644, fsx);
  // Snapshots, options and store: root only.
  if (gitDir) ensureMode(gitDir, 0o700, fsx);
  for (const f of paths.private || []) ensureMode(f, 0o600, fsx);
  if (config) {
    // The only change in the configuration folder: secrets.yaml 0600 (Home Assistant runs as root).
    if (ensureMode(path.join(config, 'secrets.yaml'), 0o600, fsx)) log.push(`${path.join(config, 'secrets.yaml')} set to 0600 (only root reads it now)`);
    // .storage: only checked, never changed.
    for (const f of ['auth', 'auth_provider.homeassistant', 'core.config_entries']) {
      const p = path.join(config, '.storage', f);
      let st;
      try { st = fsx.statSync(p); } catch { continue; }
      if (st.mode & 0o077) log.push(`warning: ${p} is readable for others (mode ${(st.mode & 0o777).toString(8)}); drafts can read it`);
    }
  }
  return log;
}

module.exports = { RUN_USER, lookupUser, chownTree, ensureMode, prepare };
