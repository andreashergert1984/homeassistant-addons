'use strict';
// Hardening of 0.8.0: network, cfg-git, local proxy for Home Assistant, rules for Claude,
// limits and the add-on configuration.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync, spawn } = require('child_process');
const policy = require('../lib/policy');
const L = require('../lib/logic');
const { createProxy } = require('../lib/proxy');
const runner = require('../lib/runner');

const APP = path.join(__dirname, '..');
const ROOT = path.join(APP, '..');
// git in temp repositories without inherited GIT_* variables (hooks export GIT_DIR).
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

test('Ingress: nur das Gateway des Supervisors und Loopback', () => {
  for (const a of ['172.30.32.2', '::ffff:172.30.32.2', '127.0.0.1', '127.0.0.5', '::1', '::ffff:127.0.0.1']) assert.ok(policy.ingressAllowed(a), a);
  for (const a of ['172.30.32.1', '172.30.33.2', '172.30.32.22', '192.168.1.2', '::ffff:10.0.0.1', '', undefined, 'localhost']) assert.ok(!policy.ingressAllowed(a), String(a));
});

test('cfg-git: Unterbefehle und Argumente streng geprüft', () => {
  const bad = [
    ['log', '--output=x'], ['log', '--output', 'x'], ['log', '--out=x'], ['log', '--outp=x'], ['diff', '-o', 'x'], ['log', '-po', 'x'], ['diff', '-Ox'],
    ['log', '-c'], ['diff', '--ext-diff'], ['diff', '--textconv'], ['log', '--exec-path=/tmp'], ['log', '--git-dir=/data'], ['log', '--work-tree=/'],
    ['log', '--config=a'], ['log', '--config-env=a=b'], ['diff', '--no-index', '/dev/null', '/data/home/.claude/.credentials.json'], ['diff', '--no-i'],
    ['show', 'HEAD:secrets.yaml'], ['log', '-p', '--', 'secrets.yaml'], ['show', 'HEAD:.storage/auth'], ['diff', '--', '.storage/core.config_entries'],
    ['commit', '-m', 'x'], ['checkout', '.'], ['-c', 'core.pager=sh', 'log'], ['config', 'x'], [],
  ];
  for (const a of bad) assert.strictEqual(policy.cfgGitArgs(a).ok, false, a.join(' '));
  const good = [['log', '--oneline', '-5'], ['log', '-n5', '--stat'], ['diff', 'HEAD~1', '--', 'configuration.yaml'], ['show', '--stat', 'HEAD'], ['log', '-Sfoo'],
    ['status', '--porcelain'], ['ls-files'], ['blame', 'automations.yaml'], ['diff', '--no-ext-diff', '--name-only'], ['log', '--format=%H %s', '--date=iso']];
  for (const a of good) assert.strictEqual(policy.cfgGitArgs(a).ok, true, a.join(' '));
  assert.deepStrictEqual(policy.cfgGitArgs(['log', '-1']).args, ['log', '--no-ext-diff', '--no-textconv', '-1', '--', ...policy.CFG_GIT_EXCLUDES]);
  assert.deepStrictEqual(policy.cfgGitArgs(['blame', 'a']).args, ['blame', '--no-textconv', 'a']);
  assert.deepStrictEqual(policy.cfgGitArgs(['status']).args, ['status']);
  const env = policy.cfgGitEnv({ PATH: '/bin', GIT_DIR: '/x', GIT_EXTERNAL_DIFF: 'sh', SUPERVISOR_TOKEN: 't' });
  assert.deepStrictEqual([env.GIT_DIR, env.GIT_EXTERNAL_DIFF, env.SUPERVISOR_TOKEN], [undefined, undefined, undefined]);
  assert.deepStrictEqual([env.GIT_CONFIG_NOSYSTEM, env.GIT_CONFIG_GLOBAL, env.PATH], ['1', '/dev/null', '/bin']);
});

test('cfg-git: Credential-Dateien in .storage abgelehnt und per Pathspec ausgeschlossen (0.8.3)', () => {
  for (const a of [['show', 'HEAD:.storage/application_credentials'], ['diff', '--', '.storage/application_credentials'], ['log', '-p', '.storage/application_credentials'],
    ['ls-files', '.storage/nest_credentials.json'], ['blame', '.storage/application_credentials'], ['show', 'HEAD~1:.storage/xyz_credential']]) {
    const r = policy.cfgGitArgs(a);
    assert.strictEqual(r.ok, false, a.join(' '));
    assert.strictEqual(r.reason, 'secret', a.join(' '));
  }
  assert.ok(policy.CFG_GIT_EXCLUDES.includes(':(top,exclude,glob).storage/*credential*'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cfggit-cred-'));
  try {
    const work = path.join(tmp, 'config');
    const gitDir = path.join(tmp, 'git');
    fs.mkdirSync(path.join(work, '.storage'), { recursive: true });
    fs.writeFileSync(path.join(work, 'configuration.yaml'), 'homeassistant:\n');
    fs.writeFileSync(path.join(work, '.storage', 'application_credentials'), '{"client_secret":"GEHEIM1"}');
    fs.writeFileSync(path.join(work, '.storage', 'other_credentials.json'), '{"token":"GEHEIM2"}');
    fs.writeFileSync(path.join(work, '.storage', 'lovelace'), '{}');
    const g = (...a) => spawnSync('git', [`--git-dir=${gitDir}`, `--work-tree=${work}`, ...a], { env: cleanEnv(), encoding: 'utf8' });
    spawnSync('git', ['init', '--bare', '-q', gitDir], { env: cleanEnv() });
    g('add', '-A', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'eins');
    const run = (...a) => spawnSync(process.execPath, [path.join(APP, 'bin', 'cfg-git.js'), ...a], { cwd: tmp, env: { ...cleanEnv(), HM_GIT_DIR: gitDir, HM_CONFIG_DIR: work, HM_LANG: 'en' }, encoding: 'utf8' });
    const ls = run('ls-files');
    assert.strictEqual(ls.status, 0, ls.stderr);
    assert.match(ls.stdout, /\.storage\/lovelace/);
    assert.doesNotMatch(ls.stdout, /credential/);
    const log = run('log', '-p');
    assert.strictEqual(log.status, 0, log.stderr);
    assert.match(log.stdout, /configuration\.yaml/);
    assert.doesNotMatch(log.stdout, /GEHEIM/);
    const refused = run('show', 'HEAD:.storage/application_credentials');
    assert.strictEqual(refused.status, 2);
    assert.doesNotMatch(refused.stdout, /GEHEIM/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('cfg-git als Programm: log --output=x wird abgelehnt und schreibt nichts', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-cfggit-'));
  try {
    const work = path.join(tmp, 'config');
    const gitDir = path.join(tmp, 'git');
    fs.mkdirSync(work);
    fs.writeFileSync(path.join(work, 'configuration.yaml'), 'homeassistant:\n');
    const g = (...a) => spawnSync('git', [`--git-dir=${gitDir}`, `--work-tree=${work}`, ...a], { env: cleanEnv(), encoding: 'utf8' });
    spawnSync('git', ['init', '--bare', '-q', gitDir], { env: cleanEnv() });
    g('add', '-A', '.');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'eins');
    const run = (...a) => spawnSync(process.execPath, [path.join(APP, 'bin', 'cfg-git.js'), ...a], { cwd: tmp, env: { ...cleanEnv(), HM_GIT_DIR: gitDir, HM_CONFIG_DIR: work, HM_LANG: 'en' }, encoding: 'utf8' });
    const out = path.join(tmp, 'x');
    const r = run('log', `--output=${out}`);
    assert.strictEqual(r.status, 2);
    assert.match(r.stderr, /not allowed: --output=/);
    assert.ok(!fs.existsSync(out), 'keine Datei geschrieben');
    assert.strictEqual(run('log', '--out', out).status, 2);
    assert.ok(!fs.existsSync(out));
    assert.match(run('commit', '-m', 'x').stderr, /only log, diff, show, status, ls-files, blame/);
    const ok = run('log', '--oneline');
    assert.strictEqual(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /eins/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('WebSocket-Allowlist für ha-read ist exakt', () => {
  for (const t of ['get_states', 'config/entity_registry/list', 'todo/item/list', 'system_log/list', 'lovelace/config']) assert.ok(policy.readWsAllowed(t), t);
  for (const t of ['config/auth/list', 'application_credentials/list', 'auth/refresh_tokens', 'config/auth/create', 'cloud/status', 'something/list', 'get_states2', 'xget_states', 'call_service']) {
    assert.ok(!policy.readWsAllowed(t), t);
  }
});

test('Pfade für den Proxy: keine Traversal, nichts kodiert', () => {
  assert.strictEqual(policy.corePath('/core/api/states'), '/states');
  assert.strictEqual(policy.corePath('/core/api/history/period?filter_entity_id=a.b'), '/history/period');
  assert.strictEqual(policy.corePath('/core/api'), '/');
  for (const p of ['/core/api/../../addons', '/core/api/%2e%2e/addons', '/core/api/%2E%2e%2faddons', '/core/api/.%2e/x', '/core/api/a/..', '/core/api//x', '/core/api/a\\..\\b',
    '/sup/addons', '/core/apix', '/addons', '/core/api/%2fsupervisor', '/core/api/%ZZ']) {
    assert.strictEqual(policy.corePath(p), null, p);
  }
  assert.ok(policy.restAllowed('read', 'GET', '/states'));
  assert.ok(policy.restAllowed('read', 'POST', '/template'));
  assert.ok(!policy.restAllowed('read', 'POST', '/services/light/turn_on'));
  assert.ok(!policy.restAllowed('read', 'DELETE', '/states/a.b'));
  assert.ok(policy.restAllowed('write', 'POST', '/services/light/turn_on'));
  for (const s of ['/services/hassio/addon_stop', '/services/HASSIO/backup_full', '/services/shell_command/x', '/services/homeassistant/stop', '/events/hausmeister_neues_ticket', '/events/mobile_app_notification_action', '/hassio/addons']) {
    assert.ok(!policy.restAllowed('write', 'POST', s), s);
  }
  assert.ok(policy.restAllowed('write', 'POST', '/services/homeassistant/restart'));
  assert.ok(!policy.restAllowed('other', 'GET', '/states'));
  for (const [t, p] of [['config/auth/delete', {}], ['auth/long_lived_access_token', {}], ['supervisor/api', {}], ['hassio/x', {}], ['execute_script', {}],
    ['call_service', { domain: 'hassio', service: 'addon_start' }], ['call_service', { domain: 'shell_command', service: 'x' }], ['call_service', { domain: 'homeassistant', service: 'stop' }],
    ['fire_event', { event_type: 'hausmeister_neues_ticket' }], ['application_credentials/list', {}]]) {
    assert.ok(policy.wsWriteDenied(t, p), t);
  }
  assert.ok(!policy.wsWriteDenied('call_service', { domain: 'light', service: 'turn_on' }));
  assert.ok(!policy.wsWriteDenied('config/entity_registry/update', {}));
});

// Raw HTTP request (fetch would normalize "/../").
function rawRequest(base, method, p, token, body) {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method, path: p, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('Proxy: Lese- und Schreibmodus, Token je Phase, ha-read über den Proxy', async () => {
  const seen = [];
  const proxy = createProxy({
    core: async (method, sub) => { seen.push(`${method} ${sub}`); return { status: 200, text: '[{"entity_id":"light.a","state":"on","attributes":{}}]', type: 'application/json' }; },
    ws: async (type, payload) => { seen.push(`ws ${type} ${JSON.stringify(payload)}`); return { ok: type }; },
    log: async () => 'line1\nline2',
  });
  const url = await proxy.ensure();
  try {
    const read = proxy.issue('read');
    const write = proxy.issue('write');
    assert.notStrictEqual(read, write);
    assert.match(read, /^[0-9a-f]{48}$/);
    assert.strictEqual((await rawRequest(url, 'GET', '/core/api/states', 'falsch')).status, 401);
    assert.strictEqual((await rawRequest(url, 'GET', '/core/api/states', read)).status, 200);
    for (const p of ['/core/api/../../addons', '/core/api/%2e%2e/%2e%2e/addons', '/sup/addons', '/addons/self/info', '/core/websocket']) {
      assert.strictEqual((await rawRequest(url, 'GET', p, write)).status, 403, p);
    }
    assert.strictEqual((await rawRequest(url, 'POST', '/core/api/services/light/turn_on', read, '{}')).status, 403);
    assert.strictEqual((await rawRequest(url, 'POST', '/core/api/services/light/turn_on', write, '{}')).status, 200);
    assert.strictEqual((await rawRequest(url, 'POST', '/core/api/services/hassio/addon_stop', write, '{}')).status, 403);
    assert.strictEqual((await rawRequest(url, 'POST', '/ws', read, JSON.stringify({ type: 'config/auth/list' }))).status, 403);
    assert.strictEqual((await rawRequest(url, 'POST', '/ws', read, JSON.stringify({ type: 'get_states' }))).status, 200);
    assert.strictEqual((await rawRequest(url, 'POST', '/ws', write, JSON.stringify({ type: 'call_service', payload: { domain: 'shell_command', service: 'x' } }))).status, 403);
    assert.strictEqual((await rawRequest(url, 'GET', '/hm/log', read)).body, 'line1\nline2');

    // The helper itself, as Claude calls it: no Supervisor token, only the proxy.
    const helper = (mode, token, ...a) => new Promise((resolve) => {
      const env = { ...cleanEnv(), HA_TOOL_MODE: mode, HM_PROXY_URL: url, HM_PROXY_TOKEN: token, HM_LANG: 'en' };
      delete env.SUPERVISOR_TOKEN;
      const c = spawn(process.execPath, [path.join(APP, 'bin', 'ha.js'), ...a], { env });
      let out = '';
      let err = '';
      c.stdout.on('data', (d) => { out += d; });
      c.stderr.on('data', (d) => { err += d; });
      c.on('close', (code) => resolve({ code, out, err }));
    });
    let r = await helper('read', read, 'get', '/../../addons');
    assert.strictEqual(r.code, 3, r.err);
    assert.match(r.err, /Path not allowed/);
    r = await helper('read', read, 'get', '/%2e%2e/%2e%2e/addons');
    assert.strictEqual(r.code, 3, r.err);
    r = await helper('read', read, 'state', '../../addons');
    assert.strictEqual(r.code, 3, r.err);
    r = await helper('read', read, 'states');
    assert.strictEqual(r.code, 0, r.err);
    assert.match(r.out, /light\.a\ton/);
    r = await helper('read', read, 'ws', 'config/auth/list');
    assert.strictEqual(r.code, 3, 'Benutzerliste nicht lesbar');
    r = await helper('read', read, 'ws', 'application_credentials/list');
    assert.strictEqual(r.code, 3);
    // The payload cannot replace the command type (allowlist bypass).
    r = await helper('write', read, 'ws', 'get_states', '{"type":"config/auth/list"}');
    assert.strictEqual(r.code, 0, r.err);
    assert.match(seen[seen.length - 1], /^ws get_states /);
    r = await helper('write', read, 'rest', 'POST', '/services/light/turn_on', '{}');
    assert.notStrictEqual(r.code, 0, 'Lesetoken kann nicht schalten, auch nicht mit ha-api');
    r = await helper('read', read, 'log', '1');
    assert.strictEqual(r.out.trim(), 'line2');
    // 0.8.2: filters instead of jq, grep and wc.
    r = await helper('read', read, 'states', 'light.', '--count');
    assert.strictEqual(r.out.trim(), '1', r.err);
    r = await helper('read', read, 'states', '--json', '--fields', 'entity_id,state');
    assert.deepStrictEqual(JSON.parse(r.out), [{ entity_id: 'light.a', state: 'on' }]);
    r = await helper('read', read, 'get', '/states', '--pick', '0.entity_id');
    assert.strictEqual(r.out.trim(), 'light.a');
    r = await helper('read', read, 'get', '/states', '--pick');
    assert.strictEqual(r.code, 2);
    assert.match(r.err, /--pick needs a value/);
    proxy.revoke(read);
    assert.strictEqual((await rawRequest(url, 'GET', '/core/api/states', read)).status, 401, 'nach dem Lauf ungültig');
  } finally { proxy.close(); }
});

test('Direkte WebSocket-Befehle: Nutzdaten überschreiben den Typ nicht', () => {
  const src = fs.readFileSync(path.join(APP, 'lib', 'ha.js'), 'utf8');
  assert.ok(src.includes('{ ...payload, id: 1, type }'), 'type und id nach den Nutzdaten');
  assert.ok(!src.includes('{ id: 1, type, ...payload }'));
});

test('Werkzeuge für Claude: kein cat/sort/uniq, WebFetch nur Doku, Sperrregeln, keine Tokens', () => {
  for (const list of [runner.READ_TOOLS, runner.WRITE_TOOLS]) {
    assert.ok(!list.includes('WebFetch'), 'kein freies WebFetch');
    for (const d of ['home-assistant.io', 'www.home-assistant.io', 'github.com', 'raw.githubusercontent.com', 'community.home-assistant.io']) assert.ok(list.includes(`WebFetch(domain:${d})`), d);
    assert.strictEqual(list.filter((x) => x.startsWith('WebFetch')).length, 5);
  }
  for (const c of ['cat', 'sort', 'uniq', 'grep', 'head', 'tail', 'jq', 'ls', 'wc', 'cut', 'tr', 'find', 'sed', 'awk', 'less', 'python3', 'node']) {
    assert.ok(!runner.READ_TOOLS.some((t) => t === `Bash(${c}:*)` || t === `Bash(${c})`), c);
  }
  // 0.8.2: in drafts the shell opens no files; only the proxy helpers and pure output.
  assert.deepStrictEqual(runner.READ_TOOLS.filter((t) => t.startsWith('Bash')), ['Bash(ha-read:*)', 'Bash(cfg-git:*)', 'Bash(echo:*)', 'Bash(printf:*)', 'Bash(date:*)']);
  assert.ok(!runner.READ_TOOLS.includes('Bash'), 'kein freies Bash im Entwurf');
  for (const t of ['Read', 'Grep', 'Glob']) assert.ok(runner.READ_TOOLS.includes(t), t);
  assert.ok(runner.WRITE_TOOLS.includes('Edit(//data/wissen.md)'), 'Wissen bearbeitbar');
  const deny = runner.denyRules('/homeassistant');
  for (const r of ['Read(//homeassistant/secrets.yaml)', 'Edit(//homeassistant/secrets.yaml)', 'Read(//homeassistant/.storage/auth*)', 'Read(//homeassistant/.storage/core.config_entries)', 'Read(//homeassistant/.storage/*credential*)', 'Read(//homeassistant/**/secrets.yaml)',
    'Read(//data/home/.claude/**)', 'Read(//data/configgit/**)', 'Read(//proc/**)', 'Read(//app/**)', 'Edit(//app/**)', 'Bash(curl:*)', 'Bash(wget:*)', 'Bash(nc:*)']) {
    assert.ok(deny.includes(r), r);
  }
  const env = runner.childEnv({ SUPERVISOR_TOKEN: 's', HASSIO_TOKEN: 'h', PATH: '/bin' }, { HM_PROXY_TOKEN: 'p' });
  assert.deepStrictEqual(env, { PATH: '/bin', HM_PROXY_TOKEN: 'p' });
});

test('Benachrichtigungen mit Nonce, Admins, Grenze je Stunde, flüchtige Dateien', () => {
  const acts = L.notifyActions('entwurf', 7, 'a1b2c3d4e5f60718');
  assert.strictEqual(acts[0].action, 'HAUSMEISTER_SOFORT_7_a1b2c3d4e5f60718');
  assert.deepStrictEqual(L.parseNotifyAction(acts[0].action), { key: 'sofort', id: 7, nonce: 'a1b2c3d4e5f60718' });
  assert.deepStrictEqual(L.parseNotifyAction('HAUSMEISTER_SOFORT_7'), { key: 'sofort', id: 7, nonce: null }, 'alte Knöpfe erkannt, aber ohne Nonce');
  assert.strictEqual(L.parseNotifyAction('HAUSMEISTER_SOFORT_7_xyz'), null);
  assert.ok(policy.isActiveAdmin({ is_active: true, is_admin: true }));
  assert.ok(policy.isActiveAdmin({ is_active: true, group_ids: ['system-admin'] }));
  assert.ok(!policy.isActiveAdmin({ is_active: false, is_admin: true }));
  assert.ok(!policy.isActiveAdmin({ is_active: true, is_admin: false, group_ids: ['system-users'] }));
  assert.ok(!policy.isActiveAdmin({ is_active: true, is_admin: true, system_generated: true }), 'Systemnutzer zählen nicht');
  assert.ok(!policy.isActiveAdmin(null));
  let times = [];
  for (let i = 0; i < 10; i++) { const r = policy.rateTake(times, 1000 + i); assert.ok(r.ok); times = r.times; }
  assert.strictEqual(policy.rateTake(times, 2000).ok, false, 'elftes in der Stunde verworfen');
  assert.ok(policy.rateTake(times, 1000 + 3600000 + 1).ok, 'nach einer Stunde wieder frei');
  for (const f of ['configuration.yaml', 'packages/licht.yaml', 'automations.yaml', 'scripts.yaml', 'scenes.yaml', '.storage/lovelace', '.storage/lovelace.dashboard_x', '.storage/lovelace_dashboards', 'automations/flur.yaml']) {
    assert.ok(L.neverVolatile(f), f);
    assert.ok(!L.isVolatile(f, [f]), `${f} gelernt, zählt aber nicht`);
  }
  assert.ok(L.isVolatile('zigbee2mqtt/coordinator.json', ['zigbee2mqtt/coordinator.json']));
});

test('Add-on-Konfiguration 0.8.3: Option, Übersetzungen, Backup-Ausschlüsse, cfg-git im Image', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'config.yaml'), 'utf8');
  assert.match(cfg, /^version: "0\.8\.3"$/m);
  assert.match(cfg, /^ {2}allow_immediate_from_outside: false$/m);
  assert.match(cfg, /^ {2}allow_immediate_from_outside: bool$/m);
  for (const x of ['home/.claude/.credentials.json', 'home/.claude/projects', 'home/.claude/projects/*', 'configgit', 'configgit/*']) assert.ok(cfg.includes(`  - "${x}"\n`), x);
  assert.match(cfg, /^hassio_role: manager$/m);
  for (const lang of ['de', 'en']) {
    const tr = fs.readFileSync(path.join(ROOT, 'translations', `${lang}.yaml`), 'utf8');
    assert.match(tr, /^ {2}allow_immediate_from_outside:\n {4}name: .+\n {4}description: .+/m, lang);
  }
  const docker = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(docker, /node \/app\/bin\/cfg-git\.js/);
  assert.ok(!fs.existsSync(path.join(APP, 'bin', 'cfg-git')), 'altes Shell-Skript entfernt');
});
