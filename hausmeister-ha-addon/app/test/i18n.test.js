'use strict';
// Languages: dictionaries complete and alike, no German left in the code, language choice,
// English texts where the other tests check the German ones.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const i18n = require('../lib/i18n');
const L = require('../lib/logic');
const { promptFor } = require('../lib/runner');

const APP = path.join(__dirname, '..');
const de = i18n.dict('de');
const en = i18n.dict('en');
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// ---- a small scanner for JavaScript: string literals outside comments ----------------
// Returns { strings: [text], templates: [raw template text] }; regex literals are skipped.
function scanJs(src) {
  const strings = [];
  let i = 0;
  const n = src.length;
  const stack = []; // open template literals: brace depth inside ${ }
  let prev = '';
  const regexAllowed = () => !prev || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /\b(return|typeof|case|in|of)$/.test(prev);
  const readTemplate = () => {
    let text = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; strings.push(text); return 'end'; }
      if (c === '$' && src[i + 1] === '{') { i += 2; strings.push(text); text = ''; return 'expr'; }
      text += c; i++;
    }
    strings.push(text);
    return 'end';
  };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      let text = '';
      while (j < n && src[j] !== c) { if (src[j] === '\\') { text += src.slice(j, j + 2); j += 2; } else text += src[j++]; }
      strings.push(text);
      i = j + 1; prev = 'x'; continue;
    }
    if (c === '/' && regexAllowed()) {
      let j = i + 1;
      let cls = false;
      while (j < n && (cls || src[j] !== '/') && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      i = j + 1;
      while (/[a-z]/.test(src[i] || '')) i++;
      prev = 'x'; continue;
    }
    if (c === '`') { i++; if (readTemplate() === 'expr') stack.push(0); prev = 'x'; continue; }
    if (stack.length && c === '{') { stack[stack.length - 1]++; }
    if (stack.length && c === '}') {
      if (stack[stack.length - 1] === 0) { stack.pop(); i++; if (readTemplate() === 'expr') stack.push(0); prev = 'x'; continue; }
      stack[stack.length - 1]--;
    }
    if (!/\s/.test(c)) prev = (/\w/.test(c) && /\w$/.test(prev)) ? prev + c : (/\w/.test(c) ? c : c);
    if (/\w/.test(c)) { let j = i; while (j < n && /\w/.test(src[j])) j++; prev = src.slice(i, j); i = j; continue; }
    i++;
  }
  return strings;
}

const GERMAN = /[äöüÄÖÜß„“]|\b(und|nicht|bitte|wird|werden|gibt|kein|keine|noch|schon|oder|mit|für|über|bei|vom|zum|zur|der|die|das|den|dem|des|ein|eine|einen|dich|dein|deine|wurde|fehlt|ist|sind|jetzt|gerade|Entwurf|Umsetzung|Sicherung|Rückfrage|Lauf|Läufe|Vorschlag|Anmeldung|Kommentar|Fehler|Wächter|Rundgang|Ticket anlegen)\b/;
const CODE_FILES = ['server.js', 'public/app.js', ...fs.readdirSync(path.join(APP, 'lib')).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`),
  ...fs.readdirSync(path.join(APP, 'bin')).filter((f) => f.endsWith('.js')).map((f) => `bin/${f}`)];

test('Wörterbücher: gleiche Schlüssel, gleiche Platzhalter, keine leeren Texte, keine Gedankenstriche', () => {
  assert.deepStrictEqual(i18n.LANGS, ['de', 'en']);
  assert.deepStrictEqual(Object.keys(de).sort(), Object.keys(en).sort());
  for (const k of Object.keys(de)) {
    assert.deepStrictEqual(placeholders(de[k]), placeholders(en[k]), `Platzhalter in ${k}`);
    for (const [lang, d] of [['de', de], ['en', en]]) {
      assert.ok(String(d[k]).trim(), `${lang}: ${k} ist leer`);
      assert.ok(!d[k].includes('—'), `${lang}: ${k} enthält einen Gedankenstrich`);
    }
    assert.ok(!/[äöüÄÖÜß]/.test(en[k]), `en: ${k} enthält Umlaute: ${en[k]}`);
  }
  assert.ok(Object.keys(de).length > 300, 'Wörterbuch vollständig');
});

test('Wächter: keine hart codierten deutschen Texte in Board, Server, Bibliotheken und Helfern', () => {
  const found = [];
  for (const f of CODE_FILES) {
    for (const s of scanJs(fs.readFileSync(path.join(APP, f), 'utf8'))) {
      // Stored identifiers from before 0.7.0 (shown through actorLabel/reasonLabel) are not texts.
      if (Object.values(L.ACTOR).includes(s) || Object.values(L.REASON).includes(s)) continue;
      if (GERMAN.test(s)) found.push(`${f}: ${s.slice(0, 80)}`);
    }
  }
  const html = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  for (const line of html.split('\n')) if (GERMAN.test(line)) found.push(`index.html: ${line.trim().slice(0, 80)}`);
  assert.deepStrictEqual(found, []);
});

test('Wächter erkennt deutsche Texte und überspringt Kommentare und reguläre Ausdrücke', () => {
  const s = scanJs("// Kommentar für dich\nconst a = 'Titel fehlt'; const r = /[\"']ü/g; const b = `x ${c ? `für ${d}` : 'y'} z`; /* über */");
  assert.ok(s.includes('Titel fehlt'));
  assert.ok(s.some((x) => x.includes('für')), 'verschachtelte Vorlagen');
  assert.ok(!s.some((x) => /Kommentar|über/.test(x)), 'Kommentare zählen nicht');
  assert.ok(s.filter((x) => GERMAN.test(x)).length === 2);
});

test('Jeder verwendete Schlüssel steht im Wörterbuch', () => {
  const namespaces = new Set(Object.keys(en).map((k) => k.split('.')[0]));
  const missing = [];
  for (const f of CODE_FILES) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    for (const m of src.matchAll(/\b(?:t|tr|i18n\.t)\(\s*'([\w.]+)'/g)) if (!(m[1] in en)) missing.push(`${f}: ${m[1]}`);
    for (const s of scanJs(src)) {
      // 'notify.btn.now' passed around as a key, or `state.${s}` as a family of keys.
      if (/^[a-z_]+(\.[a-z0-9_]+)+$/.test(s) && namespaces.has(s.split('.')[0]) && !(s in en)) missing.push(`${f}: ${s}`);
      const fam = /^([a-z_]+(?:\.[a-z_]+)*)\.\$\{/.exec(s);
      if (fam && !Object.keys(en).some((k) => k.startsWith(`${fam[1]}.`))) missing.push(`${f}: ${fam[1]}.*`);
    }
  }
  const html = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8');
  for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) if (!(m[1] in en)) missing.push(`index.html: ${m[1]}`);
  // Families built from internal keys.
  const fams = {
    state: L.STATE_KEYS, action: Object.keys(L.ACTIONS), category: L.CATEGORY_KEYS, actor: Object.keys(L.ACTOR),
    reason: Object.keys(L.REASON), level: ['hoch', 'mittel', 'gering', 'klein', 'gross'],
    kind: ['entwurf', 'umgesetzt', 'rueckfrage', 'fehler', 'kontingent', 'anmeldung'],
    'toast.action': Object.keys(L.ACTIONS), 'toast.sug': ['entwurf', 'sofort', 'sammeln', 'ablehnen', 'wieder', 'erledigt'],
    group: ['waiting', 'queue', 'collected', 'closed'], stepper: ['intake', 'draft', 'approval', 'impl', 'acceptance'],
    'cli.usage': ['states', 'state', 'get', 'ws', 'template', 'log', 'check', 'ws_write', 'rest', 'reload', 'restart'],
  };
  for (const [p, keys] of Object.entries(fams)) for (const k of keys) if (!(`${p}.${k}` in en)) missing.push(`${p}.${k}`);
  assert.deepStrictEqual(missing, []);
});

test('Sprachwahl: auto folgt Home Assistant, sonst Englisch; Option gewinnt', async () => {
  assert.strictEqual(i18n.resolve('auto', 'de'), 'de');
  assert.strictEqual(i18n.resolve('auto', 'de-CH'), 'de');
  assert.strictEqual(i18n.resolve('auto', 'en-GB'), 'en');
  assert.strictEqual(i18n.resolve('auto', 'fr'), 'en', 'nicht unterstützt wird Englisch');
  assert.strictEqual(i18n.resolve('auto', undefined), 'en');
  assert.strictEqual(i18n.resolve(undefined, 'de'), 'de', 'ohne Option wie auto');
  assert.strictEqual(i18n.resolve('de', 'en'), 'de');
  assert.strictEqual(i18n.resolve('en', 'de'), 'en');
  assert.strictEqual(await i18n.detect('auto', async () => ({ language: 'de' })), 'de');
  assert.strictEqual(await i18n.detect('auto', async () => ({ language: 'fr' })), 'en');
  assert.strictEqual(await i18n.detect('auto', async () => { throw new Error('offline'); }), 'en');
  let asked = false;
  assert.strictEqual(await i18n.detect('de', async () => { asked = true; return { language: 'en' }; }), 'de');
  assert.ok(!asked, 'feste Sprache fragt Home Assistant nicht');
  assert.strictEqual(i18n.t('gibt.es.nicht'), 'gibt.es.nicht', 'fehlender Schlüssel bleibt sichtbar statt leer');
  assert.strictEqual(i18n.t('err.ticket_missing', { id: 7 }, 'de'), 'Ticket 7 gibt es nicht');
  assert.strictEqual(i18n.t('err.ticket_missing', { id: 7 }, 'en'), 'Ticket 7 does not exist');
  assert.ok(!Object.keys(i18n.boardDict('en')).some((k) => k.startsWith('prompt.')), 'Prompts gehen nicht ans Board');
});

test('Option language und inspection_day in config.yaml und den Übersetzungen', () => {
  const cfg = fs.readFileSync(path.join(APP, '..', 'config.yaml'), 'utf8');
  assert.match(cfg, /^\s+language: auto$/m);
  assert.match(cfg, /^\s+language: list\(auto\|de\|en\)\?$/m);
  const days = /inspection_day: list\(([^)]+)\)/.exec(cfg)[1].split('|');
  assert.deepStrictEqual(days.sort(), Object.keys(L.INSPECTION_DAYS).sort(), 'Schema und Logik kennen dieselben Werte');
  for (const lang of ['de', 'en']) {
    const tr = fs.readFileSync(path.join(APP, '..', 'translations', `${lang}.yaml`), 'utf8');
    assert.match(tr, /^ {2}language:\n {4}name: .+\n {4}description: .+/m, `translations/${lang}.yaml`);
  }
});

test('Rundgang-Tag: deutsche und englische Werte', () => {
  const mon = new Date(2026, 10, 23); // Monday
  const sun = new Date(2026, 10, 22);
  for (const v of ['aus', 'off', '', undefined, 'quatsch']) assert.strictEqual(L.inspectionDue(v, mon), false, String(v));
  for (const v of ['taeglich', 'daily']) assert.strictEqual(L.inspectionDue(v, sun), true, v);
  for (const v of ['mo', 'mon', 'MON']) { assert.strictEqual(L.inspectionDue(v, mon), true, v); assert.strictEqual(L.inspectionDue(v, sun), false, v); }
  for (const v of ['so', 'sun']) assert.strictEqual(L.inspectionDue(v, sun), true, v);
  const all = [['di', 'tue', 2], ['mi', 'wed', 3], ['do', 'thu', 4], ['fr', 'fri', 5], ['sa', 'sat', 6]];
  for (const [g, e, day] of all) {
    const d = new Date(2026, 10, 22 + day);
    assert.ok(L.inspectionDue(g, d) && L.inspectionDue(e, d), `${g}/${e}`);
  }
});

test('Englische Texte in Logik, Prompts und Benachrichtigungen', () => {
  i18n.setLanguage('en');
  try {
    assert.strictEqual(L.nextRun(['11:00', '16:00'], new Date(2026, 10, 22, 12, 0)), 'today 16:00');
    assert.throws(() => L.applyAction({ state: 'umgesetzt' }, 'nachbessern', ''), /Please write a comment for "Ask for a fix"/);
    assert.throws(() => L.applyAction({ state: 'neu' }, 'umsetzen'), /not possible in state "New"/);
    assert.strictEqual(L.stepText('Read', { file_path: '/homeassistant/automations.yaml' }), 'reads automations.yaml');
    assert.deepStrictEqual(L.notifyActions('entwurf', 1).map((a) => a.title), ['Implement now', 'On the next run', 'Discard']);
    assert.strictEqual(L.actionsFor({ state: 'entwurf' }).find((a) => a.key === 'umsetzen').label, 'Ask Claude to implement');
    assert.strictEqual(L.reasonLabel('Zeitplan 11:00'), 'Schedule 11:00', 'gespeicherter Anlass wird übersetzt angezeigt');
    assert.strictEqual(L.reasonLabel('sofort'), 'immediately');
    assert.strictEqual(L.actorLabel('To-do-Liste'), 'Todo list');
    assert.strictEqual(L.actorLabel('Andreas'), 'Andreas');
    const tk = { id: 3, title: 'Light', text: '', comments: [], results: [], kind: 'ticket' };
    const p = promptFor(tk, 'entwerfen');
    assert.match(p, /^Ticket #3: Light\n\n\(no description\)/);
    assert.match(p, /Task: DRAFT/);
    assert.match(p, /in English\. Status values and field names stay exactly as given\.$/);
    i18n.setLanguage('de');
    assert.match(promptFor(tk, 'entwerfen'), /Aufgabe: ENTWURF[\s\S]*auf Deutsch\./);
    assert.match(promptFor({ ...tk, kind: 'rundgang' }, 'entwerfen'), /^Aufgabe: RUNDGANG/);
  } finally { i18n.setLanguage('de'); }
});

test('Regeln für Claude gibt es in jeder Sprache, mit denselben Statuswerten', () => {
  for (const lang of i18n.LANGS) {
    const r = fs.readFileSync(path.join(APP, 'prompt', `regeln.${lang}.md`), 'utf8');
    for (const s of ['entwurf', 'rueckfrage', 'fehler', 'umgesetzt', 'zusammenfassung', 'geaenderte_dateien', 'ha_aenderungen', '/data/wissen.md']) assert.ok(r.includes(s), `${lang}: ${s}`);
    assert.ok(!r.includes('WISSEN.md'), `${lang}: Wissensdatei heißt /data/wissen.md`);
    assert.ok(!r.replace(/„\u2014“|"\u2014"/g, '').includes('\u2014'), `${lang}: kein Gedankenstrich im Text`);
  }
});

test('Sofort-Präfix in der To-do-Liste: sofort, now und !', () => {
  assert.deepStrictEqual(L.parseIntake('now: dim the hallway'), { title: 'dim the hallway', immediate: true });
  assert.deepStrictEqual(L.parseIntake('Now - light'), { title: 'light', immediate: true });
  assert.deepStrictEqual(L.parseIntake('sofort: Licht'), { title: 'Licht', immediate: true });
  assert.deepStrictEqual(L.parseIntake('Nowhere sensor'), { title: 'Nowhere sensor', immediate: false });
  assert.deepStrictEqual(L.parseIntake('nowadays: x'), { title: 'nowadays: x', immediate: false });
});
