'use strict';
// File permissions for the split between root and the unprivileged user "hausmeister".
// Draft and inspection run as hausmeister; the implementation after approval stays root.
// hausmeister owns /data/home (login of Claude, token refresh) and reads the rest; it never
// writes /data/configgit, /data/options.json, the store, /app or the configuration of Home Assistant.
// Rights in the configuration folder stay as Home Assistant sets them (0.8.2).
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

// True when p is the folder base or lies inside it.
function inside(p, base) {
  const r = path.relative(path.resolve(base), path.resolve(p));
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
}

// Markers in /data: what the add-on did once and must never do again.
const MARKER_SECRETS = '.secrets_restored';
const MARKER_NOTICE = '.config_entries_notice';

// 0.8.1 set secrets.yaml to 0600 without leaving a marker. Home Assistant creates it with a normal
// open() (0644 with its umask), so the add-on gives it back once: only when it is 0600 and owned by
// root, and only while the marker is missing. The marker is written in any case; after that the
// file is never touched again. Returns a log line or null.
function restoreSecretsOnce(config, dataDir, fsx = fs) {
  const marker = path.join(dataDir, MARKER_SECRETS);
  if (fsx.existsSync(marker)) return null;
  const p = path.join(config, 'secrets.yaml');
  let line = null;
  let st = null;
  try { st = fsx.statSync(p); } catch { /* no secrets.yaml */ }
  if (st && st.isFile() && (st.mode & 0o777) === 0o600 && st.uid === 0) {
    fsx.chmodSync(p, 0o644);
    line = `${p} set back to 0644 (0.8.1 had set it to 0600; Home Assistant itself creates it with 0644)`;
  }
  fsx.writeFileSync(marker, `${new Date().toISOString()} ${line ? 'restored' : 'unchanged'}\n`);
  return line;
}

// One info line, once: Home Assistant writes .storage files with 0644 (only auth stores with 0600),
// drafts keep away from them through the deny rules of Claude, not through file rights.
function configEntriesNoticeOnce(dataDir, fsx = fs) {
  const marker = path.join(dataDir, MARKER_NOTICE);
  if (fsx.existsSync(marker)) return null;
  fsx.writeFileSync(marker, `${new Date().toISOString()}\n`);
  return 'info: Home Assistant writes .storage/core.config_entries and secrets.yaml readable for all local users (0644) by default; '
    + 'the add-on does not change rights in the configuration folder, drafts and inspections do not read these files because of the deny rules of Claude';
}

// Prepares the rights at start (idempotent). paths: { home, work, claudeMd, wissen, gitDir,
// private: [files only root reads], config, dataDir }. Rights are only changed below /data and
// never in the configuration folder of Home Assistant (config), apart from the one restore above.
// Returns a list of English log lines.
function prepare(user, paths, { fsx = fs } = {}) {
  const log = [];
  if (!user) return log;
  const { home, work, claudeMd, wissen, gitDir, config, dataDir } = paths;
  const own = (p) => {
    if (config && inside(p, config)) throw new Error(`refusing to change rights in the configuration folder: ${p}`);
    return p;
  };
  fsx.mkdirSync(own(home), { recursive: true });
  const n = chownTree(home, user.uid, user.gid, fsx);
  ensureMode(home, 0o700, fsx);
  if (n) log.push(`${home} now belongs to ${user.name} (${n} entries)`);
  // Working directory and rules: readable, not writable for hausmeister.
  if (work) { fsx.mkdirSync(own(work), { recursive: true }); ensureMode(work, 0o755, fsx); }
  if (claudeMd) ensureMode(own(claudeMd), 0o644, fsx);
  if (wissen) ensureMode(own(wissen), 0o644, fsx);
  // Snapshots, options and store: root only.
  if (gitDir) ensureMode(own(gitDir), 0o700, fsx);
  for (const f of paths.private || []) ensureMode(own(f), 0o600, fsx);
  if (config && dataDir) {
    const restored = restoreSecretsOnce(config, dataDir, fsx);
    if (restored) log.push(restored);
    const notice = configEntriesNoticeOnce(dataDir, fsx);
    if (notice) log.push(notice);
  }
  return log;
}

module.exports = { RUN_USER, lookupUser, chownTree, ensureMode, prepare, inside, restoreSecretsOnce, configEntriesNoticeOnce, MARKER_SECRETS, MARKER_NOTICE };
