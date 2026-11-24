'use strict';
// 0.8.1: draft and inspection as the user hausmeister, implementation as root; rights of the
// files; cfg-git through the proxy with secrets excluded by pathspec; terminal without token.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const policy = require('../lib/policy');
const perms = require('../lib/perms');
const runner = require('../lib/runner');
const cfggit = require('../lib/cfggit');
const { createProxy } = require('../lib/proxy');

const APP = path.join(__dirname, '..');
const ROOT = path.join(APP, '..');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const mode = (p) => fs.statSync(p).mode & 0o777;

test('Spawn-Optionen: Entwurf und Rundgang mit uid/gid und HOME, Umsetzung als root', () => {
  const user = { name: 'hausmeister', uid: 1001, gid: 1001 };
  const env = { PATH: '/bin', HOME: '/root' };
  const draft = runner.spawnOptions({ write: false, user, env });
  assert.deepStrictEqual([draft.uid, draft.gid], [1001, 1001]);
  assert.strictEqual(draft.env.HOME, '/data/home');
  assert.deepStrictEqual([draft.env.USER, draft.env.LOGNAME], ['hausmeister', 'hausmeister']);
  const impl = runner.spawnOptions({ write: true, user, env });
  assert.ok(!('uid' in impl) && !('gid' in impl), 'Umsetzung ohne uid');
  assert.strictEqual(impl.env, env);
  const noUser = runner.spawnOptions({ write: false, user: null, env });
  assert.ok(!('uid' in noUser), 'ohne Benutzer (außerhalb des Images) wie bisher');
  assert.deepStrictEqual(runner.SETTINGS_ARGS, ['--setting-sources', 'project', '--strict-mcp-config']);
});

test('Benutzer aus /etc/passwd, root zählt nicht', () => {
  const passwd = 'root:x:0:0:root:/root:/bin/bash\nnode:x:1000:1000::/home/node:/bin/bash\nhausmeister:x:1001:1001::/data/home:/usr/sbin/nologin\n';
  assert.deepStrictEqual(perms.lookupUser('hausmeister', 'p', () => passwd), { name: 'hausmeister', uid: 1001, gid: 1001 });
  assert.strictEqual(perms.lookupUser('root', 'p', () => passwd), null);
  assert.strictEqual(perms.lookupUser('fehlt', 'p', () => passwd), null);
  assert.strictEqual(perms.lookupUser('hausmeister', 'p', () => { throw new Error('nope'); }), null);
});

test('Rechte vorbereiten: /data/home an hausmeister, Rest root, nur secrets.yaml in der Konfiguration', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-rights-'));
  try {
    const p = (...x) => path.join(tmp, ...x);
    fs.mkdirSync(p('home', '.claude', 'projects'), { recursive: true });
    fs.writeFileSync(p('home', '.claude', '.credentials.json'), '{}');
    fs.mkdirSync(p('work'), { recursive: true });
    fs.writeFileSync(p('work', 'CLAUDE.md'), 'x');
    fs.chmodSync(p('work', 'CLAUDE.md'), 0o600);
    fs.writeFileSync(p('wissen.md'), 'x');
    fs.mkdirSync(p('configgit'));
    fs.chmodSync(p('configgit'), 0o755);
    for (const f of ['options.json', 'state.json']) { fs.writeFileSync(p(f), '{}'); fs.chmodSync(p(f), 0o644); }
    fs.mkdirSync(p('config', '.storage'), { recursive: true });
    fs.writeFileSync(p('config', 'secrets.yaml'), 'pw: geheim\n');
    fs.chmodSync(p('config', 'secrets.yaml'), 0o644);
    fs.writeFileSync(p('config', 'configuration.yaml'), 'x');
    fs.chmodSync(p('config', 'configuration.yaml'), 0o644);
    fs.writeFileSync(p('config', '.storage', 'auth'), '{}');
    fs.chmodSync(p('config', '.storage', 'auth'), 0o600);
    fs.writeFileSync(p('config', '.storage', 'core.config_entries'), '{}');
    fs.chmodSync(p('config', '.storage', 'core.config_entries'), 0o644);

    // No root in the test: lchown is injected and changes the uid seen by lstat.
    const owned = new Map();
    const chowned = [];
    const fsx = {
      ...fs,
      lstatSync: (f) => { const st = fs.lstatSync(f); const o = owned.get(f); return o ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, o) : st; },
      lchownSync: (f, uid, gid) => { chowned.push(f); owned.set(f, { uid, gid }); },
    };
    const user = { name: 'hausmeister', uid: 4242, gid: 4243 };
    const paths = { home: p('home'), work: p('work'), claudeMd: p('work', 'CLAUDE.md'), wissen: p('wissen.md'), gitDir: p('configgit'), config: p('config'), private: [p('options.json'), p('state.json'), p('fehlt.json')] };
    const log = perms.prepare(user, paths, { fsx });
    assert.ok(chowned.includes(p('home')) && chowned.includes(p('home', '.claude', '.credentials.json')), 'Login gehört hausmeister');
    assert.ok(chowned.every((f) => f.startsWith(p('home'))), 'nur /data/home');
    assert.strictEqual(mode(p('home')), 0o700);
    assert.strictEqual(mode(p('work')), 0o755);
    assert.strictEqual(mode(p('work', 'CLAUDE.md')), 0o644, 'Regeln lesbar');
    assert.strictEqual(mode(p('configgit')), 0o700, 'Schnappschüsse nur root');
    assert.strictEqual(mode(p('options.json')), 0o600);
    assert.strictEqual(mode(p('state.json')), 0o600);
    assert.strictEqual(mode(p('config', 'secrets.yaml')), 0o600);
    assert.strictEqual(mode(p('config', 'configuration.yaml')), 0o644, 'sonst nichts in der Konfiguration geändert');
    assert.strictEqual(mode(p('config', '.storage', 'core.config_entries')), 0o644, '.storage nur geprüft');
    assert.strictEqual(log.filter((l) => /secrets\.yaml set to 0600/.test(l)).length, 1);
    assert.ok(log.some((l) => /warning: .*core\.config_entries/.test(l)), 'lesbare .storage-Datei gemeldet');
    assert.ok(!log.some((l) => /\.storage\/auth /.test(l)), 'auth ist 0600');
    // Idempotent: a second start changes nothing and does not log secrets.yaml again.
    chowned.length = 0;
    const again = perms.prepare(user, paths, { fsx });
    assert.deepStrictEqual(chowned, []);
    assert.ok(!again.some((l) => /secrets/.test(l)));
    // A root login in the terminal leaves a root file; the next draft gives it back.
    fs.writeFileSync(p('home', '.claude', 'neu.json'), '{}');
    assert.strictEqual(perms.chownTree(p('home'), 4242, 4243, fsx), 1);
    assert.deepStrictEqual(perms.prepare(null, paths, { fsx }), [], 'ohne Benutzer nichts');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// Snapshot repository with secrets in it, as /data/configgit.
function snapRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cfgx-'));
  const work = path.join(tmp, 'config');
  const gitDir = path.join(tmp, 'git');
  fs.mkdirSync(path.join(work, '.storage'), { recursive: true });
  fs.mkdirSync(path.join(work, 'packages'));
  const g = (...a) => spawnSync('git', [`--git-dir=${gitDir}`, `--work-tree=${work}`, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { env: cleanEnv(), encoding: 'utf8' });
  spawnSync('git', ['init', '--bare', '-q', gitDir], { env: cleanEnv() });
  const write = (n) => {
    fs.writeFileSync(path.join(work, 'configuration.yaml'), `homeassistant:\n  name: Haus${n}\n`);
    fs.writeFileSync(path.join(work, 'secrets.yaml'), `pw: GEHEIM${n}\n`);
    fs.writeFileSync(path.join(work, 'packages', 'secrets.yaml'), `pk: PAKETGEHEIM${n}\n`);
    fs.writeFileSync(path.join(work, '.storage', 'auth'), `{"t":"AUTHGEHEIM${n}"}`);
    fs.writeFileSync(path.join(work, '.storage', 'core.config_entries'), `{"t":"ENTRYGEHEIM${n}"}`);
    g('add', '-A', '.');
    g('commit', '-q', '-m', `stand ${n}`);
  };
  write(1);
  write(2);
  return { tmp, work, gitDir };
}

test('cfg-git: secrets.yaml und Auth-Dateien per Pathspec ausgeschlossen, auch ohne Pfad', async () => {
  const ex = policy.CFG_GIT_EXCLUDES;
  assert.deepStrictEqual(policy.cfgGitArgs(['show', 'HEAD'], () => true).args, ['show', '--no-ext-diff', '--no-textconv', 'HEAD', '--', ...ex]);
  assert.deepStrictEqual(policy.cfgGitArgs(['log', '-n', '5', '-p'], () => false).args, ['log', '--no-ext-diff', '--no-textconv', '-n', '5', '-p', '--', ...ex], '-n 5: Wert, kein Pfad');
  assert.deepStrictEqual(policy.cfgGitArgs(['diff', 'HEAD~1', 'configuration.yaml'], (a) => a === 'HEAD~1').args,
    ['diff', '--no-ext-diff', '--no-textconv', 'HEAD~1', '--', 'configuration.yaml', ...ex], 'Pfad ohne -- wandert hinter --');
  assert.deepStrictEqual(policy.cfgGitArgs(['ls-files', '-s']).args, ['ls-files', '-s', '--', ...ex], 'keine Blob-IDs der Geheimnisse');
  assert.deepStrictEqual(policy.cfgGitArgs(['blame', 'automations.yaml']).args, ['blame', '--no-textconv', 'automations.yaml']);
  assert.strictEqual(policy.cfgGitArgs(['log', '-n', '--output=x']).ok, false, 'Wert, der wie eine Option aussieht, wird geprüft');
  for (const a of [['show', 'HEAD:./secrets.yaml'], ['show', 'HEAD:packages/secrets.yaml'], ['blame', 'secrets.yaml'], ['log', '-p', 'secrets.yaml']]) assert.strictEqual(policy.cfgGitArgs(a).ok, false, a.join(' '));

  const { tmp, work, gitDir } = snapRepo();
  try {
    const run = (...a) => cfggit.run(a, { gitDir, work, env: cleanEnv() });
    const SECRET = /GEHEIM|AUTHGEHEIM|ENTRYGEHEIM|PAKETGEHEIM/;
    for (const a of [['show'], ['show', 'HEAD'], ['log', '-p'], ['log', '-p', '-n', '1'], ['diff', 'HEAD~1'], ['diff', 'HEAD~1', 'HEAD'], ['diff', 'HEAD~1..HEAD', '--stat'], ['log', '--stat'], ['show', '--name-only', 'HEAD']]) {
      const r = await run(...a);
      assert.strictEqual(r.status, 0, `${a.join(' ')}: ${r.stderr}`);
      assert.ok(!SECRET.test(r.stdout) && !/secrets\.yaml|\.storage\/auth|core\.config_entries/.test(r.stdout), `${a.join(' ')} zeigt nichts Geheimes:\n${r.stdout}`);
    }
    let r = await run('diff', 'HEAD~1', 'configuration.yaml');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /\+  name: Haus2/, 'Pfad ohne -- funktioniert');
    r = await run('show', 'HEAD:configuration.yaml');
    assert.match(r.stdout, /name: Haus2/, 'Datei eines Stands lesbar');
    r = await run('ls-files', '-s');
    assert.match(r.stdout, /configuration\.yaml/);
    assert.ok(!/secrets|auth|config_entries/.test(r.stdout), r.stdout);
    r = await run('log', '--output=x');
    assert.strictEqual(r.status, 2);
    assert.strictEqual(r.refused, 'option');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('cfg-git über den Proxy: läuft ohne Zugriff auf configgit, Prüfung im Server', async () => {
  const { tmp, work, gitDir } = snapRepo();
  const seen = [];
  const proxy = createProxy({ cfgGit: (argv) => { seen.push(argv); return cfggit.run(argv, { gitDir, work, env: cleanEnv() }); } });
  const url = await proxy.ensure();
  try {
    const tok = proxy.issue('read');
    const helper = (token, ...a) => new Promise((resolve) => {
      // HM_GIT_DIR points nowhere: only the server reaches the snapshots.
      const env = { ...cleanEnv(), HM_PROXY_URL: url, HM_PROXY_TOKEN: token, HM_LANG: 'en', HM_GIT_DIR: path.join(tmp, 'gibt-es-nicht') };
      const c = spawn(process.execPath, [path.join(APP, 'bin', 'cfg-git.js'), ...a], { env });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => { out += d; });
      c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => resolve({ code, out, err }));
    });
    let r = await helper(tok, 'log', '--oneline');
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /stand 2/);
    r = await helper(tok, 'show', 'HEAD');
    assert.strictEqual(r.code, 0, r.err);
    assert.ok(!/GEHEIM/.test(r.out), r.out);
    assert.match(r.out, /Haus2/);
    r = await helper(tok, 'log', '--output=x');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /not allowed: --output=x/);
    assert.strictEqual(seen.length, 2, 'Abgelehntes erreicht den Server nicht');
    r = await helper('falsch', 'log');
    assert.strictEqual(r.code, 1, 'ohne gültiges Token nichts');
    assert.match(r.err, /HTTP 401/);
    // Refused by the server even when the helper is bypassed.
    const raw = await fetch(`${url}/hm/cfg-git`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({ args: ['show', 'HEAD:secrets.yaml'] }) });
    assert.strictEqual(raw.status, 403);
    const bad = await fetch(`${url}/hm/cfg-git`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: JSON.stringify({ args: 'log' }) });
    assert.strictEqual(bad.status, 400);
  } finally { proxy.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Image: Benutzer hausmeister mit fester UID, Terminal nicht mehr aus run.sh, git ohne globale Konfiguration', () => {
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(docker, /groupadd -g 1001 hausmeister/);
  assert.match(docker, /useradd -u 1001 -g 1001 -d \/data\/home -M -s \/usr\/sbin\/nologin hausmeister/);
  const run = fs.readFileSync(path.join(APP, 'run.sh'), 'utf8');
  assert.match(run, /^umask 022$/m, 'nichts von root für andere schreibbar');
  assert.ok(!/^[^#]*ttyd/m.test(run), 'ttyd startet der Server ohne Token');
  const git = fs.readFileSync(path.join(APP, 'lib', 'git.js'), 'utf8');
  assert.match(git, /GIT_CONFIG_GLOBAL: '\/dev\/null'/);
  assert.match(git, /GIT_CONFIG_NOSYSTEM: '1'/);
});
