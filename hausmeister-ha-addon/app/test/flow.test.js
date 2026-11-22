'use strict';
// Whole flow against a fake Home Assistant and a fake claude binary:
// ticket → draft → approval → implementation with snapshots and watch → rollback.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hausmeister-'));
const cfg = path.join(tmp, 'config');
fs.mkdirSync(path.join(cfg, '.storage'), { recursive: true });
fs.writeFileSync(path.join(cfg, 'configuration.yaml'), `${'# Kommentar\n'.repeat(200)}homeassistant:\n  name: Test\n`);
fs.writeFileSync(path.join(cfg, 'home-assistant_v2.db'), 'x');
fs.writeFileSync(path.join(cfg, 'grosse-datei.yaml'), 'x'.repeat(5000));
fs.writeFileSync(path.join(cfg, '.storage', 'core.entity_registry'), 'x'.repeat(5000));
fs.mkdirSync(path.join(cfg, 'ollama', 'models'), { recursive: true });
fs.writeFileSync(path.join(cfg, 'ollama', 'models', 'blob'), 'x');

const calls = [];
let statesNow = { 'light.flur': 'on', 'sensor.temp': '21' };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    calls.push(`${req.method} ${req.url}`);
    const json = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/api/') return json({ message: 'API running.' });
    if (fs.existsSync(path.join(tmp, 'broken'))) statesNow = { 'light.flur': 'on' };
    if (req.url === '/api/states' && req.method === 'GET') return json(Object.entries(statesNow).map(([entity_id, state]) => ({ entity_id, state, attributes: {} })));
    if (req.url.startsWith('/api/states/')) return json({});
    if (req.url === '/api/config/core/check_config') return json({ result: 'valid', errors: null });
    if (req.url.startsWith('/api/services/')) return json([]);
    if (req.url.startsWith('/sup/')) return json({ result: 'ok', data: {} });
    res.writeHead(404); res.end('nein');
  });
});

const fakeClaude = path.join(tmp, 'claude');
fs.writeFileSync(fakeClaude, `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(path.join(tmp, 'claude-args.log'))}, JSON.stringify(a) + '\\n');
const draft = a[a.indexOf('--permission-mode') + 1] === 'default';
if (!draft) fs.appendFileSync(${JSON.stringify(path.join(cfg, 'configuration.yaml'))}, 'automation: !include automations.yaml\\n');
const out = draft
  ? { status: 'entwurf', zusammenfassung: 'Ich würde eine Zeile ergänzen.', details: '- configuration.yaml: automation einbinden' }
  : { status: 'umgesetzt', zusammenfassung: 'Zeile ergänzt.', details: 'erledigt', geaenderte_dateien: ['configuration.yaml'] };
process.stdout.write(JSON.stringify({ type: 'result', is_error: false, session_id: 'sess-1', num_turns: 3, result: '', structured_output: out }));
`);
fs.chmodSync(fakeClaude, 0o755);

let base;
let srv;
let mod;

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const port = fake.address().port;
  Object.assign(process.env, {
    SUPERVISOR_TOKEN: 'test', HA_CORE_URL: `http://127.0.0.1:${port}/api`, HA_SUPERVISOR_URL: `http://127.0.0.1:${port}/sup`,
    HM_GIT_DIR: path.join(tmp, 'git'), HM_CONFIG_DIR: cfg, HM_WORK_DIR: tmp, HM_SHARE_DIR: path.join(tmp, 'share'),
    HM_STATE: path.join(tmp, 'state.json'), HM_OPTIONS: path.join(tmp, 'options.json'), HM_CLAUDE_BIN: fakeClaude,
    HM_TIME_SCALE: '0.001', HM_MAX_FILE_BYTES: '4000', CLAUDE_CODE_OAUTH_TOKEN: 'x',
  });
  fs.writeFileSync(process.env.HM_OPTIONS, JSON.stringify({ run_times: ['11:00'], intake_todo: '', auto_draft: true }));
  mod = require('../server');
  await require('../lib/git').init();
  srv = http.createServer((q, s) => mod.route(q, s));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

test.after(() => { srv.close(); fake.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function post(p, body, user = 'Andreas') {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Remote-User-Display-Name': user }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
}
const get = async (p) => (await fetch(base + p)).json();

test('kompletter Ablauf mit Entwurf, Freigabe, Umsetzung und Rückrollung', async () => {
  const created = await post('/api/tickets', { title: 'Automationen einbinden', text: 'bitte', draft: true });
  assert.strictEqual(created.status, 200);
  const id = created.body.id;
  assert.strictEqual(created.body.state, 'entwerfen');
  assert.strictEqual(created.body.created_by, 'Andreas');

  const before = fs.readFileSync(path.join(cfg, 'configuration.yaml'), 'utf8');
  const run1 = await mod.runner.cycle('Test');
  assert.deepStrictEqual(run1.tickets, [{ id, phase: 'entwerfen', kind: 'entwurf' }]);
  assert.strictEqual(fs.readFileSync(path.join(cfg, 'configuration.yaml'), 'utf8'), before, 'Entwurf ändert nichts');
  let t = await get(`/api/tickets/${id}`);
  assert.strictEqual(t.state, 'entwurf');
  assert.strictEqual(t.session_id, 'sess-1');
  const draftArgs = JSON.parse(fs.readFileSync(path.join(tmp, 'claude-args.log'), 'utf8').trim().split('\n')[0]);
  assert.ok(draftArgs.includes('Bash(ha-read:*)') && !draftArgs.includes('Bash'), 'Entwurf nur mit lesenden Werkzeugen');
  assert.ok(draftArgs.includes('Edit') && draftArgs.indexOf('--disallowedTools') < draftArgs.indexOf('Edit'));

  assert.strictEqual((await post(`/api/tickets/${id}/action`, { action: 'abnehmen' })).status, 400, 'Abnahme vor Umsetzung abgelehnt');
  assert.strictEqual((await post(`/api/tickets/${id}/action`, { action: 'umsetzen' })).body.state, 'umsetzen');

  const run2 = await mod.runner.cycle('Test');
  assert.deepStrictEqual(run2.tickets, [{ id, phase: 'umsetzen', kind: 'umgesetzt' }]);
  t = await get(`/api/tickets/${id}`);
  assert.strictEqual(t.state, 'umgesetzt');
  const impl = t.results[t.results.length - 1];
  assert.deepStrictEqual(impl.changed, ['configuration.yaml']);
  assert.deepStrictEqual(impl.watch, []);
  assert.ok(t.can_rollback);
  const implArgs = JSON.parse(fs.readFileSync(path.join(tmp, 'claude-args.log'), 'utf8').trim().split('\n')[1]);
  assert.deepStrictEqual(implArgs.slice(implArgs.indexOf('--resume'), implArgs.indexOf('--resume') + 2), ['--resume', 'sess-1']);
  assert.ok(implArgs.join('\n').includes('Freigegebener Entwurf:\n- configuration.yaml: automation einbinden'));
  assert.ok(calls.includes('POST /sup/backups/new/partial'), 'HA-Sicherung vor der Umsetzung');
  assert.ok(fs.readFileSync(path.join(cfg, 'configuration.yaml'), 'utf8').includes('automation: !include'));

  const rb = await post(`/api/tickets/${id}/rollback`, {});
  assert.strictEqual(rb.status, 200, JSON.stringify(rb.body));
  assert.strictEqual(rb.body.state, 'zurueckgerollt');
  assert.strictEqual(fs.readFileSync(path.join(cfg, 'configuration.yaml'), 'utf8'), before, 'Datei wieder wie vorher');
  assert.ok(calls.includes('POST /sup/core/restart'), 'YAML-Rückrollung startet Core neu');
  assert.ok(!calls.includes('POST /sup/core/stop'), 'ohne .storage kein Stopp');

  const doc = fs.readdirSync(path.join(tmp, 'share', 'tickets'));
  assert.deepStrictEqual(doc, [`${String(id).padStart(4, '0')}-automationen-einbinden.md`]);
  const backups = await get('/api/backups');
  assert.ok(backups.some((b) => b.msg.startsWith('nach #')) && backups.some((b) => b.msg.startsWith('Rückrollung #')));
  const tracked = require('child_process').execFileSync('git', [`--git-dir=${process.env.HM_GIT_DIR}`, 'ls-files'], { encoding: 'utf8' });
  assert.ok(!tracked.includes('.db'), 'Datenbank nicht in der Sicherung');
  assert.ok(!tracked.includes('ollama'), 'Modelle nicht in der Sicherung');
  assert.ok(!tracked.includes('grosse-datei.yaml'), 'zu große Datei nicht in der Sicherung');
  assert.ok(tracked.includes('.storage/core.entity_registry'), 'Registry trotz Größe gesichert');
});

test('Wächter: geschrumpfte Datei und verschwundene Entität führen zu "pruefen"', async () => {
  fs.writeFileSync(fakeClaude, fs.readFileSync(fakeClaude, 'utf8').replace(
    "if (!draft) fs.appendFileSync(", `if (!draft) fs.writeFileSync(${JSON.stringify(path.join(tmp, 'broken'))}, '');\nif (!draft) fs.writeFileSync(`,
  ));
  const id = (await post('/api/tickets', { title: 'Kaputtmacher', draft: true })).body.id;
  await mod.runner.cycle('Test');
  await post(`/api/tickets/${id}/action`, { action: 'umsetzen' });
  await mod.runner.cycle('Test');
  const t = await get(`/api/tickets/${id}`);
  assert.strictEqual(t.state, 'pruefen');
  const w = t.results[t.results.length - 1].watch.join('\n');
  assert.match(w, /configuration\.yaml/);
  assert.match(w, /sensor\.temp/);
});

test('Eingaben werden geprüft', async () => {
  assert.strictEqual((await post('/api/tickets', { title: '  ' })).status, 400);
  assert.strictEqual((await post('/api/tickets/999/action', { action: 'umsetzen' })).status, 400);
  const id = (await post('/api/tickets', { title: 'Frage', draft: false })).body.id;
  assert.strictEqual((await get(`/api/tickets/${id}`)).state, 'neu');
  assert.strictEqual((await post(`/api/tickets/${id}/comment`, { text: '' })).status, 400);
  assert.strictEqual((await post(`/api/tickets/${id}/rollback`, {})).status, 400);
  const st = await get('/api/state');
  assert.ok(st.runs.length >= 3);
  assert.strictEqual(st.logged_in, true);
});
