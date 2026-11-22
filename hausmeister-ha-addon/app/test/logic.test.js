'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../lib/logic');

const t = (state, phase = null) => ({ state, phase });

test('Aktionen je Zustand', () => {
  assert.deepStrictEqual(L.actionsFor(t('entwurf')).map((a) => a.key).sort(), ['entwerfen', 'umsetzen', 'sofort', 'verwerfen'].sort());
  assert.ok(!L.actionsFor(t('neu')).some((a) => a.key === 'umsetzen'), 'ohne Entwurf keine Umsetzung');
  assert.deepStrictEqual(L.actionsFor(t('in_arbeit')), []);
});

test('Umsetzen geht nur aus dem Entwurf', () => {
  assert.strictEqual(L.applyAction(t('entwurf'), 'umsetzen'), 'umsetzen');
  for (const s of ['neu', 'entwerfen', 'rueckfrage', 'umgesetzt', 'fehler']) assert.throws(() => L.applyAction(t(s), 'umsetzen'));
});

test('Antwort und Nachbessern brauchen einen Kommentar', () => {
  assert.throws(() => L.applyAction(t('rueckfrage', 'entwerfen'), 'antworten', '  '), /Kommentar/);
  assert.strictEqual(L.applyAction(t('rueckfrage', 'entwerfen'), 'antworten', 'ja'), 'entwerfen');
  assert.strictEqual(L.applyAction(t('rueckfrage', 'umsetzen'), 'antworten', 'ja'), 'umsetzen');
  assert.throws(() => L.applyAction(t('umgesetzt'), 'nachbessern', ''), /Kommentar/);
  assert.strictEqual(L.applyAction(t('pruefen'), 'nachbessern', 'Licht zu hell'), 'umsetzen');
  assert.strictEqual(L.applyAction(t('fehler', 'umsetzen'), 'wiederholen'), 'umsetzen');
  assert.throws(() => L.applyAction(t('neu'), 'gibtsnicht'), /Unbekannte/);
});

test('Sofort umsetzen', () => {
  assert.strictEqual(L.applyAction(t('neu'), 'sofort'), 'umsetzen');
  assert.strictEqual(L.applyAction(t('entwurf'), 'sofort'), 'umsetzen');
  assert.throws(() => L.applyAction(t('in_arbeit'), 'sofort'));
  assert.throws(() => L.applyAction(t('umgesetzt'), 'sofort'), /nicht möglich/, 'nach Umsetzung nur Nachbessern mit Kommentar');
  assert.ok(L.actionsFor(t('neu')).find((a) => a.key === 'sofort').immediate);
  assert.deepStrictEqual(L.parseIntake('sofort: Flurlicht dimmen'), { title: 'Flurlicht dimmen', immediate: true });
  assert.deepStrictEqual(L.parseIntake('Sofort - Licht'), { title: 'Licht', immediate: true });
  assert.deepStrictEqual(L.parseIntake('! Licht'), { title: 'Licht', immediate: true });
  assert.deepStrictEqual(L.parseIntake('Sofortbild-Kamera einbinden'), { title: 'Sofortbild-Kamera einbinden', immediate: false });
  assert.deepStrictEqual(L.parseIntake('Licht!'), { title: 'Licht!', immediate: false });
  const q = L.pickQueue([{ id: 1, state: 'umsetzen', updated: 'a' }, { id: 2, state: 'entwerfen', updated: 'a' }], 5, [1]);
  assert.deepStrictEqual(q.map((x) => x.t.id), [1], 'Sofort-Lauf nimmt nur die angestoßenen Tickets');
});

test('Uhrzeiten', () => {
  assert.deepStrictEqual(L.parseTimes(['16:00', '9:05', '16:00']), ['09:05', '16:00']);
  assert.throws(() => L.parseTimes(['25:00']));
  assert.throws(() => L.parseTimes(['abc']));
  const fired = new Set();
  const at = (h, m) => new Date(2026, 10, 22, h, m);
  assert.deepStrictEqual(L.dueTimes(['11:00'], at(10, 59), fired), []);
  assert.deepStrictEqual(L.dueTimes(['11:00'], at(11, 0), fired), ['2026-11-22 11:00']);
  fired.add('2026-11-22 11:00');
  assert.deepStrictEqual(L.dueTimes(['11:00'], at(11, 1), fired), [], 'nur einmal am Tag');
  assert.deepStrictEqual(L.dueTimes(['11:00'], at(11, 30), new Set()), [], 'nicht lange nachholen');
  assert.strictEqual(L.nextRun(['11:00', '16:00'], at(12, 0)), 'heute 16:00');
  assert.strictEqual(L.nextRun(['11:00', '16:00'], at(17, 0)), 'morgen 11:00');
});

test('Warteschlange: Entwürfe zuerst, älteste zuerst, begrenzt', () => {
  const tickets = [
    { id: 1, state: 'umsetzen', updated: '2026-01-01' },
    { id: 2, state: 'entwerfen', updated: '2026-01-03' },
    { id: 3, state: 'entwerfen', updated: '2026-01-02' },
    { id: 4, state: 'neu', updated: '2026-01-01' },
  ];
  assert.deepStrictEqual(L.pickQueue(tickets, 5).map((q) => [q.t.id, q.phase]), [[3, 'entwerfen'], [2, 'entwerfen'], [1, 'umsetzen']]);
  assert.strictEqual(L.pickQueue(tickets, 2).length, 2);
});

test('Wächter erkennen Schrumpfung, Verschwinden und neue Ausfälle', () => {
  const before = { states: { 'light.a': 'on', 'sensor.b': '3', 'sensor.c': 'unavailable', 'sensor.d': 'unknown' }, files: { 'configuration.yaml': 5000, 'small.yaml': 100, 'gone.yaml': 2000 } };
  const after = { states: { 'light.a': 'unavailable', 'sensor.c': 'unavailable', 'sensor.d': 'unavailable' }, files: { 'configuration.yaml': 1200, 'small.yaml': 10 } };
  const w = L.compareWatch(before, after);
  assert.deepStrictEqual(w.vanished, ['sensor.b']);
  assert.deepStrictEqual(w.unavailable, ['light.a'], 'vorher schon kaputt oder unbekannt zählt nicht');
  assert.deepStrictEqual(w.shrunk.map((s) => s.file).sort(), ['configuration.yaml', 'gone.yaml']);
  const second = L.compareWatch(before, { states: { 'light.a': 'on', 'sensor.c': 'unavailable' }, files: after.files });
  const c = L.confirmWatch(w, second);
  assert.deepStrictEqual(c.unavailable, [], 'nach Neustart wieder da');
  assert.deepStrictEqual(c.vanished, ['sensor.b']);
  const reasons = L.watchAlarm(c, { result: 'invalid', errors: 'x' });
  assert.strictEqual(reasons.length, 3);
  assert.deepStrictEqual(L.watchAlarm({ vanished: [], unavailable: [], shrunk: [] }, { result: 'valid' }), []);
});

test('Ergebnis von Claude auswerten', () => {
  const ok = JSON.stringify({ type: 'result', is_error: false, session_id: 's', result: '', structured_output: { status: 'entwurf', zusammenfassung: 'z', details: 'd' }, permission_denials: [{}] });
  const r = L.interpretResult('entwerfen', ok);
  assert.strictEqual(r.kind, 'entwurf');
  assert.strictEqual(r.denied, 1);
  assert.strictEqual(L.interpretResult('umsetzen', ok).kind, 'fehler', 'Entwurfsstatus in der Umsetzung ist falsch');
  const fenced = JSON.stringify({ type: 'result', result: 'x\n```json\n{"status":"umgesetzt","zusammenfassung":"z","details":"d"}\n```' });
  assert.strictEqual(L.interpretResult('umsetzen', fenced).kind, 'umgesetzt');
  assert.strictEqual(L.interpretResult('entwerfen', JSON.stringify({ is_error: true, result: "You've hit your usage limit · resets 5pm" })).kind, 'kontingent');
  assert.strictEqual(L.interpretResult('entwerfen', JSON.stringify({ is_error: true, result: 'Invalid API key · Please run /login' })).kind, 'anmeldung');
  assert.strictEqual(L.interpretResult('entwerfen', 'kaputt').kind, 'fehler');
  assert.strictEqual(L.interpretResult('entwerfen', JSON.stringify({ result: 'kein json' })).kind, 'fehler');
});

test('Fortschritt, Kontingent und Benachrichtigungsknöpfe', () => {
  assert.strictEqual(L.stepText('Read', { file_path: '/homeassistant/automations.yaml' }), 'liest automations.yaml');
  assert.strictEqual(L.stepText('Bash', { command: 'ha-read states', description: 'Zustände lesen' }), 'Zustände lesen');
  assert.strictEqual(L.stepText('Bash', { command: 'ha-read check' }), 'führt aus: ha-read check');
  const raw = [
    JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { unifiedWindows: { seven_day: { utilization: 0.42, resetsAt: 100 }, five_hour: { utilization: 0.1, resetsAt: 50 } } } }),
    'kein json',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'flur' } }] } }),
    JSON.stringify({ type: 'result', is_error: false, structured_output: { status: 'entwurf', zusammenfassung: 'z', details: 'd' } }),
  ].join('\n');
  const p = L.parseStream(raw);
  assert.deepStrictEqual(p.steps, ['sucht nach "flur"']);
  assert.deepStrictEqual(p.quota, { window: 'seven_day', utilization: 0.42, resetsAt: 100, status: undefined });
  assert.strictEqual(L.interpretResult('entwerfen', raw).kind, 'entwurf', 'Streamformat wird ausgewertet');
  assert.strictEqual(L.quotaBlocks({ utilization: 0.8, resetsAt: 200 }, 80, 100), true);
  assert.strictEqual(L.quotaBlocks({ utilization: 0.79, resetsAt: 200 }, 80, 100), false);
  assert.strictEqual(L.quotaBlocks({ utilization: 0.95, resetsAt: 50 }, 80, 100), false, 'Fenster schon erneuert');
  assert.strictEqual(L.quotaBlocks({ utilization: 0.95 }, 0, 100), false, '0 schaltet aus');
  assert.deepStrictEqual(L.notifyActions('entwurf', 7).map((a) => a.action), ['HAUSMEISTER_SOFORT_7', 'HAUSMEISTER_UMSETZEN_7', 'HAUSMEISTER_VERWERFEN_7']);
  assert.strictEqual(L.notifyActions('rueckfrage', 7)[0].behavior, 'textInput');
  assert.deepStrictEqual(L.notifyActions('erledigt', 7), []);
  for (const s of ['entwurf', 'rueckfrage', 'umgesetzt', 'pruefen', 'fehler']) {
    for (const a of L.notifyActions(s, 3)) {
      const p2 = L.parseNotifyAction(a.action);
      assert.ok(p2 && p2.id === 3, a.action);
      assert.ok(L.ACTIONS[p2.key].from.includes(s), `${a.action} ist im Zustand ${s} erlaubt`);
    }
  }
  assert.strictEqual(L.parseNotifyAction('HAUSMEISTER_GIBTSNICHT_1'), null);
  assert.strictEqual(L.parseNotifyAction('ANDERES'), null);
});

test('Dateinamen', () => {
  assert.strictEqual(L.slug('Flurlicht über Nacht dimmen!'), 'flurlicht-ueber-nacht-dimmen');
  assert.strictEqual(L.slug('???'), 'ticket');
});
