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
let haLanguage = 'de';
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    calls.push(`${req.method} ${req.url}`);
    const json = (v) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    if (req.url === '/api/') return json({ message: 'API running.' });
    if (req.url === '/api/config') return json({ language: haLanguage, time_zone: 'Europe/Berlin' });
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
const rundgang = /^(Aufgabe: RUNDGANG|Task: INSPECTION)/.test(a[a.indexOf('-p') + 1]);
if (!draft && !rundgang) { fs.mkdirSync(${JSON.stringify(path.join(cfg, 'zigbee2mqtt'))}, { recursive: true }); fs.writeFileSync(${JSON.stringify(path.join(cfg, 'zigbee2mqtt', 'state.json'))}, String(Date.now())); }
const out = rundgang
  ? { status: 'entwurf', zusammenfassung: 'Zwei Dinge gefunden.', details: 'Befunde', vorschlaege: [{ titel: 'Batterie Flursensor tauschen', text: 'leer', begruendung: 'sensor.flur_batterie 4 %', kategorie: 'wartung', nutzen: 'hoch', aufwand: 'klein', handarbeit: true }, { titel: 'Reparatur offen', text: 'x', kategorie: 'unsinn', nutzen: 'mittel', aufwand: 'mittel' }, { titel: 'Batterie  Flursensor TAUSCHEN!', text: 'doppelt', kategorie: 'wartung', nutzen: 'hoch', aufwand: 'klein' }] }
  : draft
    ? { status: 'entwurf', zusammenfassung: 'Ich würde eine Zeile ergänzen.', details: '- configuration.yaml: automation einbinden' }
    : { status: 'umgesetzt', zusammenfassung: 'Zeile ergänzt.', details: 'erledigt', geaenderte_dateien: ['configuration.yaml'] };
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
say({ type: 'system', subtype: 'init' });
say({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: 4102444800 }, seven_day: { utilization: Number(process.env.FAKE_QUOTA || 0.1), resetsAt: 4102444800 } } } });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/homeassistant/configuration.yaml' } }] } });
say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ha-read states', description: 'Zustände lesen' } }] } });
say({ type: 'result', is_error: false, session_id: 'sess-1', num_turns: 3, result: '', structured_output: out });
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
    HM_TIME_SCALE: '0.001', HM_MAX_FILE_BYTES: '4000', HM_BASELINE: path.join(tmp, 'baseline.json'), CLAUDE_CODE_OAUTH_TOKEN: 'x',
  });
  fs.writeFileSync(process.env.HM_OPTIONS, JSON.stringify({ run_times: ['11:00'], intake_todo: '', auto_draft: true, language: 'de' }));
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
  assert.deepStrictEqual(t.results[0].steps, ['liest configuration.yaml', 'Zustände lesen'], 'Schritte mitgeschrieben');
  assert.strictEqual(mod.store.data.quota.window, 'five_hour', 'höchstes Fenster gemerkt');
  assert.ok(draftArgs.includes('Edit') && draftArgs.indexOf('--disallowedTools') < draftArgs.indexOf('Edit'));

  assert.strictEqual((await post(`/api/tickets/${id}/action`, { action: 'abnehmen' })).status, 400, 'Abnahme vor Umsetzung abgelehnt');
  assert.strictEqual((await post(`/api/tickets/${id}/action`, { action: 'umsetzen' })).body.state, 'umsetzen');

  const run2 = await mod.runner.cycle('Test');
  assert.deepStrictEqual(run2.tickets, [{ id, phase: 'umsetzen', kind: 'umgesetzt' }]);
  t = await get(`/api/tickets/${id}`);
  assert.strictEqual(t.state, 'umgesetzt');
  const impl = t.results[t.results.length - 1];
  assert.deepStrictEqual(impl.changed, ['configuration.yaml']);
  assert.deepStrictEqual(impl.changed_by_itself, ['zigbee2mqtt/state.json'], 'Zustand von Zigbee2MQTT gehört nicht zur Umsetzung');
  const zigbee = fs.readFileSync(path.join(cfg, 'zigbee2mqtt', 'state.json'), 'utf8');
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
  assert.strictEqual(fs.readFileSync(path.join(cfg, 'zigbee2mqtt', 'state.json'), 'utf8'), zigbee, 'nebenbei geänderte Datei bleibt');
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

test('Sofort umsetzen: startet ohne Zeitplan, plant und setzt in einem Lauf um', async () => {
  const other = (await post('/api/tickets', { title: 'Wartet auf den Zeitplan', mode: 'entwurf' })).body.id;
  const created = await post('/api/tickets', { title: 'Sofort etwas einbinden', mode: 'sofort' });
  assert.strictEqual(created.status, 200);
  const id = created.body.id;
  for (let i = 0; i < 200 && (await get(`/api/tickets/${id}`)).state !== 'umgesetzt'; i++) await new Promise((r) => setTimeout(r, 25));
  const t = await get(`/api/tickets/${id}`);
  assert.strictEqual(t.state, 'umgesetzt');
  assert.strictEqual(t.results.length, 1, 'kein Entwurf vorher');
  const args = fs.readFileSync(path.join(tmp, 'claude-args.log'), 'utf8').trim().split('\n').map(JSON.parse).pop();
  assert.ok(args.join(' ').includes('SOFORT UMSETZEN'));
  assert.strictEqual(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.strictEqual((await get(`/api/tickets/${other}`)).state, 'entwerfen', 'andere Tickets warten auf den Zeitplan');
  assert.strictEqual((await get('/api/state')).runs[0].reason, 'sofort');
  assert.strictEqual((await post('/api/tickets', { title: 'x', mode: 'quatsch' })).status, 400);
  await post(`/api/tickets/${other}/action`, { action: 'verwerfen' });
});

test('Knöpfe in der Benachrichtigung und Tickets aus Ereignissen', async () => {
  const id = (await post('/api/tickets', { title: 'Push-Test', mode: 'entwurf' })).body.id;
  await mod.runner.cycle('Test');
  const note = calls.filter((c) => c === 'POST /api/services/persistent_notification/create').length;
  assert.ok(note > 0);
  await mod.onEvent({ event_type: 'mobile_app_notification_action', data: { action: `HAUSMEISTER_SOFORT_${id}` }, context: {} });
  for (let i = 0; i < 200 && (await get(`/api/tickets/${id}`)).state !== 'umgesetzt'; i++) await new Promise((r) => setTimeout(r, 25));
  let t = await get(`/api/tickets/${id}`);
  assert.strictEqual(t.state, 'umgesetzt');
  assert.strictEqual(t.direct, false, 'Jetzt umsetzen aus dem Entwurf setzt den Entwurf um');
  await mod.onEvent({ event_type: 'mobile_app_notification_action', data: { action: `HAUSMEISTER_NACHBESSERN_${id}`, reply_text: 'heller bitte' }, context: {} });
  t = await get(`/api/tickets/${id}`);
  assert.strictEqual(t.state, 'umsetzen');
  assert.strictEqual(t.comments[t.comments.length - 1].text, 'heller bitte');
  await post(`/api/tickets/${id}/action`, { action: 'verwerfen' });
  await mod.onEvent({ event_type: 'mobile_app_notification_action', data: { action: 'ANDERE_APP_1' }, context: {} });
  await mod.onEvent({ event_type: 'hausmeister_neues_ticket', data: { titel: 'Aus Automation', text: 'Luftfeuchte hoch', modus: 'sammeln' } });
  const st = await get('/api/state');
  const ev = st.tickets.find((x) => x.title === 'Aus Automation');
  assert.ok(ev && ev.state === 'neu' && ev.created_by === 'Automation');
});

test('Kontingentgrenze lässt geplante Läufe aus, Sofort läuft trotzdem', async () => {
  mod.store.data.quota = { window: 'seven_day', utilization: 0.85, resetsAt: 4102444800 };
  mod.opts.max_quota_percent = 80;
  const id = (await post('/api/tickets', { title: 'Wartet', mode: 'entwurf' })).body.id;
  const run = await mod.runner.cycle('Zeitplan 11:00');
  assert.match(run.note, /Kontingent bei 85 %/);
  assert.strictEqual((await get(`/api/tickets/${id}`)).state, 'entwerfen');
  assert.strictEqual((await get('/api/state')).quota_blocked, true);
  mod.store.data.quota.resetsAt = 1;
  assert.strictEqual(mod.runner.quotaBlocked(), false, 'nach der Erneuerung frei');
  await post(`/api/tickets/${id}/action`, { action: 'verwerfen' });
});

test('Rundgang sammelt Vorschläge, du entscheidest einzeln', async () => {
  mod.opts.inspection_day = 'taeglich';
  const day = new Date();
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')} ${mod.opts.run_times[0]}`;
  mod.maybeInspection(key);
  mod.maybeInspection(key);
  const rg = mod.store.data.tickets.filter((x) => x.kind === 'rundgang');
  assert.strictEqual(rg.length, 1, 'nur ein Rundgang am Tag');
  await mod.runner.cycle('Test');
  const t = await get(`/api/tickets/${rg[0].id}`);
  assert.strictEqual(t.state, 'erledigt');
  let st = await get('/api/state');
  const open = st.suggestions.filter((x) => x.state === 'offen');
  assert.strictEqual(open.length, 2, 'doppelter Titel nur einmal');
  const bat = open.find((x) => x.title.startsWith('Batterie'));
  assert.deepStrictEqual([bat.category, bat.benefit, bat.effort, bat.reason, bat.manual], ['wartung', 'hoch', 'klein', 'sensor.flur_batterie 4 %', true]);
  assert.strictEqual(open.find((x) => x.title === 'Reparatur offen').category, 'wartung', 'unbekannte Kategorie wird Wartung');
  const args = fs.readFileSync(path.join(tmp, 'claude-args.log'), 'utf8').trim().split('\n').map(JSON.parse).pop();
  assert.strictEqual(args[args.indexOf('--permission-mode') + 1], 'default', 'Rundgang nur lesend');

  const take = await post(`/api/suggestions/${bat.id}`, { action: 'entwurf' });
  assert.strictEqual(take.status, 200);
  const nt = await get(`/api/tickets/${take.body.ticket}`);
  assert.strictEqual(nt.state, 'entwerfen');
  assert.match(nt.text, /sensor\.flur_batterie 4 %/, 'Begründung wandert ins Ticket');
  assert.strictEqual((await post(`/api/suggestions/${bat.id}`, { action: 'entwurf' })).status, 400, 'nicht zweimal übernehmen');
  const rep = open.find((x) => x.title === 'Reparatur offen');
  assert.strictEqual((await post(`/api/suggestions/${rep.id}`, { action: 'ablehnen' })).body.state, 'abgelehnt');
  assert.strictEqual((await post(`/api/suggestions/${rep.id}`, { action: 'quatsch' })).status, 400);

  // A second inspection does not propose declined or taken titles again and tells Claude so.
  const ins = await post('/api/inspect', {});
  assert.strictEqual(ins.status, 200);
  for (let i = 0; i < 200 && (await get(`/api/tickets/${ins.body.id}`)).state !== 'erledigt'; i++) await new Promise((r) => setTimeout(r, 25));
  st = await get('/api/state');
  assert.strictEqual(st.suggestions.length, 2, 'nichts doppelt');
  const a2 = fs.readFileSync(path.join(tmp, 'claude-args.log'), 'utf8').trim().split('\n').map(JSON.parse).pop();
  assert.match(a2[a2.indexOf('-p') + 1], /Reparatur offen \(abgelehnt\)/);
  assert.strictEqual((await post(`/api/suggestions/${rep.id}`, { action: 'wieder' })).body.state, 'offen');
  assert.strictEqual((await post(`/api/suggestions/${rep.id}`, { action: 'erledigt' })).body.state, 'erledigt', 'Handarbeit selbst erledigt');
  await post(`/api/tickets/${take.body.ticket}/action`, { action: 'verwerfen' });
});

test('Wächter zwischen den Läufen melden Schäden von außen', async () => {
  fs.rmSync(process.env.HM_BASELINE, { force: true });
  await mod.runner.cycle('Zeitplan 11:00');
  fs.writeFileSync(path.join(cfg, 'configuration.yaml'), 'kaputt\n');
  const run = await mod.runner.cycle('Zeitplan 16:00');
  assert.ok(run.watchdog.some((r) => /configuration\.yaml/.test(r)), JSON.stringify(run.watchdog));
  assert.ok((await get('/api/state')).watchdog.reasons.length);
  fs.writeFileSync(path.join(cfg, 'configuration.yaml'), `${'# Kommentar\n'.repeat(200)}homeassistant:\n  name: Test\n`);
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

test('Sprache: auto folgt Home Assistant, Board bekommt das Wörterbuch, Claude die Regeln der Sprache', async () => {
  const i18n = require('../lib/i18n');
  try {
    mod.opts.language = 'auto';
    for (const [ha, want] of [['de', 'de'], ['en', 'en'], ['fr', 'en'], ['de-CH', 'de']]) {
      haLanguage = ha;
      await mod.applyLanguage();
      assert.strictEqual(i18n.language(), want, `HA-Sprache ${ha}`);
      const board = await get('/api/i18n');
      assert.strictEqual(board.lang, want);
      assert.strictEqual(board.dict['tab.new'], want === 'de' ? 'Neues Ticket' : 'New ticket');
      assert.ok(!Object.keys(board.dict).some((k) => k.startsWith('prompt.')));
    }
    haLanguage = 'de';
    mod.opts.language = 'en';
    assert.strictEqual(await mod.applyLanguage(), true, 'Wechsel wird gemeldet');
    assert.strictEqual(i18n.language(), 'en', 'Option gewinnt gegen Home Assistant');
    assert.strictEqual(await mod.applyLanguage(), false, 'ohne Wechsel nichts zu tun');
    const st = await get('/api/state');
    assert.strictEqual(st.lang, 'en');
    assert.strictEqual(st.states.rueckfrage, 'Question');
    assert.strictEqual(st.kategorien.aufraeumen, 'Cleanup');
    assert.strictEqual(st.actors['Zeitplan'], 'Schedule');
    assert.strictEqual((await post('/api/tickets', { title: '  ' })).body.error, 'Title missing');
    assert.strictEqual((await post('/api/tickets/999/action', { action: 'umsetzen' })).body.error, 'Ticket 999 does not exist');
    const id = (await post('/api/tickets', { title: 'English ticket', draft: false })).body.id;
    assert.strictEqual((await get(`/api/tickets/${id}`)).actions.find((a) => a.key === 'sofort').label, 'Implement now');
    const doc = fs.readdirSync(path.join(tmp, 'share', 'tickets')).find((f) => f.includes('english-ticket'));
    assert.match(fs.readFileSync(path.join(tmp, 'share', 'tickets', doc), 'utf8'), /^State: New/m, 'Ticketdoku in der Sprache');
    await post(`/api/tickets/${id}/action`, { action: 'verwerfen' });

    const dirs = { work: path.join(tmp, 'rt-work'), home: path.join(tmp, 'rt-home'), share: path.join(tmp, 'rt-share') };
    mod.writeRuntimeFiles(dirs);
    assert.match(fs.readFileSync(path.join(dirs.work, 'CLAUDE.md'), 'utf8'), /^# Hausmeister: rules/);
    assert.match(fs.readFileSync(path.join(dirs.home, '.bash_profile'), 'utf8'), /Hausmeister terminal/);
    assert.match(fs.readFileSync(path.join(dirs.share, 'WISSEN.md'), 'utf8'), /^# Knowledge about this house/);
    mod.opts.language = 'de';
    await mod.applyLanguage();
    mod.writeRuntimeFiles(dirs);
    assert.match(fs.readFileSync(path.join(dirs.work, 'CLAUDE.md'), 'utf8'), /^# Hausmeister: Regeln/);
    assert.match(fs.readFileSync(path.join(dirs.share, 'WISSEN.md'), 'utf8'), /^# Knowledge/, 'vorhandenes Wissen bleibt unangetastet');
  } finally {
    mod.opts.language = 'de';
    i18n.setLanguage('de');
  }
});
