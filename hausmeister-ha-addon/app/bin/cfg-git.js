#!/usr/bin/env node
'use strict';
// Read-only view of the Hausmeister snapshots of /homeassistant ("cfg-git log", "cfg-git diff ...").
// Every argument is checked (lib/policy.js): no options that write files, run programs or leave
// the snapshot repository; no system or global git configuration.

const { spawnSync } = require('child_process');
const policy = require('../lib/policy');
const i18n = require('../lib/i18n');

i18n.setLanguage(process.env.HM_LANG || 'en');
const tr = i18n.t;
const GIT_DIR = process.env.HM_GIT_DIR || '/data/configgit';
const WORK = process.env.HM_CONFIG_DIR || '/homeassistant';

const r = policy.cfgGitArgs(process.argv.slice(2));
if (!r.ok) {
  console.error(r.reason === 'sub' ? tr('cli.cfg_git_only', { list: policy.CFG_GIT_SUBS.join(', ') }) : tr('cli.cfg_git_refused', { arg: r.arg }));
  process.exit(2);
}
const p = spawnSync('git', [`--git-dir=${GIT_DIR}`, `--work-tree=${WORK}`, '--no-pager', ...r.args], { stdio: 'inherit', env: policy.cfgGitEnv(process.env) });
process.exit(p.status === null ? 1 : p.status);
