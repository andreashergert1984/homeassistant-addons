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

test('Rechte vorbereiten: /data/home an hausmeister, Rest root, in der Konfiguration nichts', () => {
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
    const chmodded = [];
    const fsx = {
      ...fs,
      chmodSync: (f, m) => { chmodded.push(f); fs.chmodSync(f, m); },
      lstatSync: (f) => { const st = fs.lstatSync(f); const o = owned.get(f); return o ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, o) : st; },
      lchownSync: (f, uid, gid) => { chowned.push(f); owned.set(f, { uid, gid }); },
    };
    const user = { name: 'hausmeister', uid: 4242, gid: 4243 };
    const paths = { home: p('home'), work: p('work'), claudeMd: p('work', 'CLAUDE.md'), wissen: p('wissen.md'), gitDir: p('configgit'), config: p('config'), dataDir: tmp, private: [p('options.json'), p('state.json'), p('fehlt.json')] };
    const log = perms.prepare(user, paths, { fsx });
    assert.ok(chowned.includes(p('home')) && chowned.includes(p('home', '.claude', '.credentials.json')), 'Login gehört hausmeister');
    assert.ok(chowned.every((f) => f.startsWith(p('home'))), 'nur /data/home');
    assert.strictEqual(mode(p('home')), 0o700);
    assert.strictEqual(mode(p('work')), 0o755);
    assert.strictEqual(mode(p('work', 'CLAUDE.md')), 0o644, 'Regeln lesbar');
    assert.strictEqual(mode(p('configgit')), 0o700, 'Schnappschüsse nur root');
    assert.strictEqual(mode(p('options.json')), 0o600);
    assert.strictEqual(mode(p('state.json')), 0o600);
    assert.strictEqual(mode(p('config', 'secrets.yaml')), 0o644, 'secrets.yaml wie von Home Assistant angelegt');
    assert.strictEqual(mode(p('config', 'configuration.yaml')), 0o644, 'sonst nichts in der Konfiguration geändert');
    assert.strictEqual(mode(p('config', '.storage', 'core.config_entries')), 0o644, '.storage unverändert');
    assert.ok(chmodded.every((f) => !perms.inside(f, p('config'))), `kein chmod in der Konfiguration: ${chmodded}`);
    assert.ok(!log.some((l) => /warning|0600/.test(l)), 'keine Warnung mehr');
    assert.strictEqual(log.filter((l) => /^info: .*core\.config_entries.*0644.*deny rules/.test(l)).length, 1, 'Hinweis einmal');
    // Idempotent: a second start changes nothing and does not log secrets.yaml again.
    chowned.length = 0;
    const again = perms.prepare(user, paths, { fsx });
    assert.deepStrictEqual(chowned, []);
    assert.ok(!again.some((l) => /secrets|core\.config_entries/.test(l)), 'Hinweis nur beim ersten Start');
    // A root login in the terminal leaves a root file; the next draft gives it back.
    fs.writeFileSync(p('home', '.claude', 'neu.json'), '{}');
    assert.strictEqual(perms.chownTree(p('home'), 4242, 4243, fsx), 1);
    assert.deepStrictEqual(perms.prepare(null, paths, { fsx }), [], 'ohne Benutzer nichts');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('secrets.yaml: Rücknahme von 0.8.1 genau einmal, danach nie wieder angefasst', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-restore-'));
  try {
    const config = path.join(tmp, 'config');
    const data = path.join(tmp, 'data');
    fs.mkdirSync(config); fs.mkdirSync(data);
    const sec = path.join(config, 'secrets.yaml');
    fs.writeFileSync(sec, 'pw: x\n');
    fs.chmodSync(sec, 0o600);
    // The test does not run as root: stat reports uid 0 for the file, chmod is recorded.
    const chmods = [];
    let uid = 0;
    const fsx = { ...fs, statSync: (f) => { const st = fs.statSync(f); return f === sec ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { uid }) : st; },
      chmodSync: (f, m) => { chmods.push([f, m]); fs.chmodSync(f, m); } };
    const line = perms.restoreSecretsOnce(config, data, fsx);
    assert.match(line, /secrets\.yaml set back to 0644/);
    assert.strictEqual(mode(sec), 0o644);
    assert.deepStrictEqual(chmods, [[sec, 0o644]]);
    assert.ok(fs.existsSync(path.join(data, perms.MARKER_SECRETS)), 'Markierung geschrieben');
    // The owner sets 0600 himself later: the add-on leaves it alone.
    fs.chmodSync(sec, 0o600);
    chmods.length = 0;
    assert.strictEqual(perms.restoreSecretsOnce(config, data, fsx), null);
    assert.deepStrictEqual(chmods, []);
    assert.strictEqual(mode(sec), 0o600);
    // Without a marker, but not owned by root or not 0600: nothing changes, the marker is written.
    for (const [u, m] of [[1000, 0o600], [0, 0o640]]) {
      fs.rmSync(path.join(data, perms.MARKER_SECRETS));
      uid = u;
      fs.chmodSync(sec, m);
      assert.strictEqual(perms.restoreSecretsOnce(config, data, fsx), null);
      assert.strictEqual(mode(sec), m);
      assert.ok(fs.existsSync(path.join(data, perms.MARKER_SECRETS)));
    }
    assert.deepStrictEqual(chmods, []);
    // No secrets.yaml at all.
    fs.rmSync(path.join(data, perms.MARKER_SECRETS));
    fs.rmSync(sec);
    assert.strictEqual(perms.restoreSecretsOnce(config, data, fsx), null);
    // Notice once.
    assert.match(perms.configEntriesNoticeOnce(data, fsx), /^info: /);
    assert.strictEqual(perms.configEntriesNoticeOnce(data, fsx), null);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('Wächter: chmod/chown nur unter /data und /app, nie in der Konfiguration', () => {
  // prepare refuses a path in the configuration folder, whatever the caller passes.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-guard-'));
  try {
    const config = path.join(tmp, 'config');
    fs.mkdirSync(config);
    const user = { name: 'hausmeister', uid: 4242, gid: 4243 };
    const fsx = { ...fs, lchownSync: () => {} };
    for (const bad of [{ home: path.join(config, 'home') }, { home: path.join(tmp, 'h'), private: [path.join(config, 'secrets.yaml')] }, { home: path.join(tmp, 'h'), wissen: path.join(config, 'x.md') }]) {
      assert.throws(() => perms.prepare(user, { config, ...bad }, { fsx }), /configuration folder/);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  // Defaults of the paths handed to chmod/chown: only /data and /app.
  const runnerSrc = fs.readFileSync(path.join(APP, 'lib', 'runner.js'), 'utf8');
  const serverSrc = fs.readFileSync(path.join(APP, 'server.js'), 'utf8');
  const permsSrc = fs.readFileSync(path.join(APP, 'lib', 'perms.js'), 'utf8');
  assert.ok(!/\bchmod|\bchown/.test(runnerSrc), 'runner.js ändert keine Rechte');
  const serverCalls = serverSrc.match(/\b\w*(chmod|chown)\w*\(/gi) || [];
  assert.deepStrictEqual(serverCalls, ['chownTree('], 'server.js: nur chownTree');
  assert.ok(/perms\.chownTree\(paths\.home,/.test(serverSrc), 'nur für /data/home');
  for (const m of serverSrc.matchAll(/const (OPTIONS_FILE|HOME_DIR|WISSEN|STATE_FILE|WORK_DIR|DATA_DIR) = process\.env\.\w+ \|\| '([^']+)'/g)) {
    assert.ok(m[2] === '/data' || m[2].startsWith('/data/'), `${m[1]} = ${m[2]}`);
  }
  // In perms.js chmodSync appears in ensureMode and once in the restore of secrets.yaml.
  const chmodCalls = permsSrc.match(/chmodSync\(/g) || [];
  assert.strictEqual(chmodCalls.length, 2);
  assert.ok(/fsx\.chmodSync\(p, 0o644\)/.test(permsSrc.slice(permsSrc.indexOf('function restoreSecretsOnce'), permsSrc.indexOf('function configEntriesNoticeOnce'))), 'Rücknahme ist die einzige Ausnahme');
  assert.ok(!/ensureMode\([^)]*config/.test(permsSrc), 'ensureMode nie auf config');
  assert.strictEqual(require('../lib/git').WORK, process.env.HM_CONFIG_DIR || '/homeassistant');
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
