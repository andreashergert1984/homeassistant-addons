'use strict';
// Runs cfg-git (read-only git on the snapshots of /homeassistant) for the server. Claude and the
// terminal reach it through the local proxy (lib/proxy.js), so the draft user needs no access to
// /data/configgit. Every argument passes lib/policy.js; secrets are excluded by pathspec.

const { execFile, spawnSync } = require('child_process');
const policy = require('./policy');

const GIT_DIR = process.env.HM_GIT_DIR || '/data/configgit';
const WORK = process.env.HM_CONFIG_DIR || '/homeassistant';

function base(gitDir, work) { return [`--git-dir=${gitDir}`, `--work-tree=${work}`, '--no-pager']; }

// True if git reads the argument as a revision (HEAD, HEAD~1..HEAD, HEAD:file), false for a path.
function revChecker(gitDir, work, env) {
  return (arg) => {
    const r = spawnSync('git', [...base(gitDir, work), 'rev-parse', '--revs-only', '-q', '--end-of-options', arg], { cwd: work, env, encoding: 'utf8', timeout: 10000 });
    return r.status === 0 && !!String(r.stdout || '').trim();
  };
}

// Returns { status, stdout, stderr, refused?, arg? }. status 2: refused by the policy.
function run(argv, { gitDir = GIT_DIR, work = WORK, env = process.env, timeoutMs = 120000 } = {}) {
  const genv = policy.cfgGitEnv(env);
  const r = policy.cfgGitArgs((argv || []).map(String), revChecker(gitDir, work, genv));
  if (!r.ok) return Promise.resolve({ status: 2, stdout: '', stderr: '', refused: r.reason, arg: r.arg });
  return new Promise((resolve) => {
    execFile('git', [...base(gitDir, work), ...r.args], { cwd: work, env: genv, maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      const status = !err ? 0 : (typeof err.code === 'number' ? err.code : 1);
      resolve({ status, stdout: String(stdout || ''), stderr: String(stderr || (err && !stderr ? err.message : '')) });
    });
  });
}

module.exports = { run, revChecker };
