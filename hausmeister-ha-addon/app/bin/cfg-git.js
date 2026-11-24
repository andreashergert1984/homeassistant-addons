#!/usr/bin/env node
'use strict';
// Read-only view of the Hausmeister snapshots of /homeassistant ("cfg-git log", "cfg-git diff ...").
// Every argument is checked (lib/policy.js): no options that write files, run programs or leave
// the snapshot repository; no system or global git configuration; secrets.yaml, the auth files,
// core.config_entries and .storage/*credential* are excluded by pathspec. Under Claude and in the terminal (HM_PROXY_URL) the server runs git
// through the local proxy, so the draft user needs no access to /data/configgit.

const policy = require('../lib/policy');
const i18n = require('../lib/i18n');

i18n.setLanguage(process.env.HM_LANG || 'en');
const tr = i18n.t;
const argv = process.argv.slice(2);

function refused(reason, arg) {
  console.error(reason === 'sub' ? tr('cli.cfg_git_only', { list: policy.CFG_GIT_SUBS.join(', ') }) : tr('cli.cfg_git_refused', { arg }));
  process.exit(2);
}

// First check here for a clear message; the server checks again.
const pre = policy.cfgGitArgs(argv);
if (!pre.ok) refused(pre.reason, pre.arg);

async function main() {
  let r;
  if (process.env.HM_PROXY_URL) {
    const res = await fetch(`${process.env.HM_PROXY_URL}/hm/cfg-git`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.HM_PROXY_TOKEN || ''}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: argv }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok && res.status !== 403) { console.error(tr('cli.cfg_git_proxy_failed', { status: res.status })); process.exit(1); }
    r = await res.json();
  } else {
    r = await require('../lib/cfggit').run(argv);
  }
  if (r.refused) refused(r.refused, r.arg);
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  process.exit(Number.isInteger(r.status) ? r.status : 1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
