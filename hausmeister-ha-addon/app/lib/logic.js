'use strict';
// Pure logic without I/O: ticket states, allowed actions, schedule, watch comparison.
// Everything here is covered by test/logic.test.js.

const STATES = {
  neu: 'Neu',
  entwerfen: 'Entwurf angefordert',
  entwurf: 'Entwurf liegt vor',
  rueckfrage: 'Rückfrage',
  umsetzen: 'Umsetzung freigegeben',
  in_arbeit: 'In Arbeit',
  umgesetzt: 'Umgesetzt, bitte abnehmen',
  pruefen: 'Umgesetzt, Wächter melden etwas',
  fehler: 'Fehler',
  erledigt: 'Erledigt',
  verworfen: 'Verworfen',
  zurueckgerollt: 'Zurückgerollt',
};

// Actions a person can take. "to" may depend on the ticket (function).
const ACTIONS = {
  entwerfen: { label: 'Claude soll entwerfen', from: ['neu', 'entwurf', 'rueckfrage', 'fehler', 'zurueckgerollt', 'verworfen', 'erledigt'], to: 'entwerfen' },
  umsetzen: { label: 'Claude soll umsetzen', from: ['entwurf'], to: 'umsetzen' },
  // Immediately, without waiting for the schedule; from a draft it implements that draft,
  // otherwise Claude plans and implements in one go.
  sofort: { label: 'Sofort umsetzen', from: ['neu', 'entwerfen', 'entwurf', 'rueckfrage', 'umsetzen', 'fehler', 'zurueckgerollt'], to: 'umsetzen', immediate: true },
  antworten: { label: 'Antwort senden', from: ['rueckfrage'], to: (t) => t.phase === 'umsetzen' ? 'umsetzen' : 'entwerfen', comment: true },
  nachbessern: { label: 'Nachbessern', from: ['umgesetzt', 'pruefen'], to: 'umsetzen', comment: true },
  wiederholen: { label: 'Erneut versuchen', from: ['fehler'], to: (t) => t.phase === 'umsetzen' ? 'umsetzen' : 'entwerfen' },
  abnehmen: { label: 'Abnehmen, passt', from: ['umgesetzt', 'pruefen'], to: 'erledigt' },
  verwerfen: { label: 'Verwerfen', from: ['neu', 'entwerfen', 'entwurf', 'rueckfrage', 'umsetzen', 'fehler', 'zurueckgerollt'], to: 'verworfen' },
  zurueckstellen: { label: 'Zurück auf Neu', from: ['entwerfen', 'umsetzen'], to: 'neu' },
};

function actionsFor(ticket) {
  return Object.entries(ACTIONS)
    .filter(([, a]) => a.from.includes(ticket.state))
    .map(([key, a]) => ({ key, label: a.label, comment: !!a.comment, immediate: !!a.immediate }));
}

function applyAction(ticket, key, comment) {
  const a = ACTIONS[key];
  if (!a) throw new Error(`Unbekannte Aktion ${key}`);
  if (!a.from.includes(ticket.state)) throw new Error(`Aktion "${a.label}" ist im Zustand "${STATES[ticket.state]}" nicht möglich`);
  if (a.comment && !(comment && comment.trim())) throw new Error(`Für "${a.label}" bitte einen Kommentar schreiben`);
  return typeof a.to === 'function' ? a.to(ticket) : a.to;
}

// "HH:MM" list; returns the entries that are due at `now` and not yet fired today.
function parseTimes(list) {
  const out = [];
  for (const raw of list || []) {
    const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(String(raw));
    if (!m) throw new Error(`Ungültige Uhrzeit "${raw}", erwartet HH:MM`);
    out.push(`${m[1].padStart(2, '0')}:${m[2]}`);
  }
  return [...new Set(out)].sort();
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dueTimes(times, now, fired) {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = dayKey(now);
  return times.filter((t) => t <= hm && !fired.has(`${day} ${t}`) && minutesBetween(t, hm) <= 10)
    .map((t) => `${day} ${t}`);
}

function minutesBetween(a, b) {
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  return (bh * 60 + bm) - (ah * 60 + am);
}

function nextRun(times, now) {
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = times.find((t) => t > hm);
  if (today) return `heute ${today}`;
  return times.length ? `morgen ${times[0]}` : 'keine Zeit eingestellt';
}

// Picks the queued tickets for one run: drafts first (cheap, read only), then implementations.
function pickQueue(tickets, max, only) {
  const by = (s) => tickets.filter((t) => t.state === s && (!only || only.includes(t.id))).sort((a, b) => a.updated.localeCompare(b.updated));
  return [...by('entwerfen').map((t) => ({ t, phase: 'entwerfen' })), ...by('umsetzen').map((t) => ({ t, phase: 'umsetzen' }))].slice(0, max);
}

const BAD = new Set(['unavailable']);

// Compares two state snapshots ({entity_id: state}) and file sizes ({path: bytes}).
function compareWatch(before, after) {
  const vanished = Object.keys(before.states).filter((e) => !(e in after.states)).sort();
  const unavailable = Object.keys(after.states)
    .filter((e) => BAD.has(after.states[e]) && e in before.states && !BAD.has(before.states[e]) && before.states[e] !== 'unknown')
    .sort();
  const shrunk = [];
  for (const [p, size] of Object.entries(before.files)) {
    const now = after.files[p];
    if (now === undefined) shrunk.push({ file: p, before: size, after: 0 });
    else if (size >= 1024 && now < size * 0.7) shrunk.push({ file: p, before: size, after: now });
  }
  return { vanished, unavailable, shrunk };
}

// Second pass: only keep findings that are still present (restarts make entities flap).
function confirmWatch(first, second) {
  const keep = (a, b) => a.filter((x) => b.includes(x));
  return {
    vanished: keep(first.vanished, second.vanished),
    unavailable: keep(first.unavailable, second.unavailable),
    shrunk: second.shrunk,
  };
}

function watchAlarm(w, check) {
  const reasons = [];
  if (check && check.result && check.result !== 'valid') reasons.push(`Konfigurationsprüfung: ${check.errors || check.result}`);
  if (w.shrunk.length) reasons.push(`Dateien geschrumpft oder gelöscht: ${w.shrunk.map((s) => `${s.file} (${s.before} → ${s.after} Byte)`).join(', ')}`);
  if (w.vanished.length) reasons.push(`Entitäten verschwunden (${w.vanished.length}): ${w.vanished.slice(0, 20).join(', ')}${w.vanished.length > 20 ? ' …' : ''}`);
  if (w.unavailable.length) reasons.push(`Neu nicht verfügbar (${w.unavailable.length}): ${w.unavailable.slice(0, 20).join(', ')}${w.unavailable.length > 20 ? ' …' : ''}`);
  return reasons;
}

// Short German description of a tool call, for the live progress.
function stepText(name, input = {}) {
  const f = (p) => String(p || '').replace(/^\/homeassistant\//, '');
  switch (name) {
    case 'Read': return `liest ${f(input.file_path)}`;
    case 'Edit': return `ändert ${f(input.file_path)}`;
    case 'Write': return `schreibt ${f(input.file_path)}`;
    case 'Grep': return `sucht nach "${String(input.pattern || '').slice(0, 60)}"`;
    case 'Glob': return `sucht Dateien ${String(input.pattern || '').slice(0, 60)}`;
    case 'WebSearch': return `sucht im Netz: ${String(input.query || '').slice(0, 60)}`;
    case 'WebFetch': return `liest ${String(input.url || '').slice(0, 80)}`;
    case 'Bash': return input.description ? String(input.description).slice(0, 100) : `führt aus: ${String(input.command || '').slice(0, 80)}`;
    case 'StructuredOutput': return 'schreibt das Ergebnis';
    default: return name;
  }
}

// Output of --output-format stream-json: one JSON object per line.
function parseStream(raw) {
  const steps = [];
  let result = null;
  let quota = null;
  for (const line of String(raw).split('\n')) {
    if (!line.trim()) continue;
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.type === 'result') result = m;
    else if (m.type === 'rate_limit_event' && m.rate_limit_info) quota = quotaFrom(m.rate_limit_info);
    else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      for (const c of m.message.content) if (c.type === 'tool_use') steps.push(stepText(c.name, c.input));
    }
  }
  return { result, quota, steps };
}

// Highest utilization over the reported windows (five hours, seven days).
function quotaFrom(info) {
  const wins = Object.entries(info.unifiedWindows || {}).map(([k, w]) => ({ window: k, utilization: Number(w.utilization || 0), resetsAt: w.resetsAt || info.resetsAt, status: w.status }));
  if (!wins.length) return { window: info.rateLimitType || '', utilization: null, resetsAt: info.resetsAt || null, status: info.status };
  return wins.sort((a, b) => b.utilization - a.utilization)[0];
}

// Scheduled runs stop above the limit until the window resets; immediate runs are not limited.
function quotaBlocks(quota, maxPercent, nowSec) {
  if (!quota || !maxPercent || quota.utilization == null) return false;
  if (quota.resetsAt && quota.resetsAt <= nowSec) return false;
  return quota.utilization * 100 >= maxPercent;
}

// Buttons of a push notification per state (mobile app actionable notifications).
function notifyActions(state, id) {
  const a = (key, title, extra = {}) => ({ action: `HAUSMEISTER_${key}_${id}`, title, ...extra });
  switch (state) {
    case 'entwurf': return [a('SOFORT', 'Jetzt umsetzen'), a('UMSETZEN', 'Beim nächsten Lauf'), a('VERWERFEN', 'Verwerfen')];
    case 'rueckfrage': return [a('ANTWORTEN', 'Antworten', { behavior: 'textInput', textInputButtonTitle: 'Senden', textInputPlaceholder: 'Antwort an Claude' })];
    case 'umgesetzt': return [a('ABNEHMEN', 'Passt'), a('NACHBESSERN', 'Nachbessern', { behavior: 'textInput', textInputButtonTitle: 'Senden', textInputPlaceholder: 'Was soll anders sein?' })];
    case 'pruefen': return [a('NACHBESSERN', 'Nachbessern', { behavior: 'textInput', textInputButtonTitle: 'Senden', textInputPlaceholder: 'Was soll anders sein?' })];
    case 'fehler': return [a('WIEDERHOLEN', 'Erneut versuchen')];
    default: return [];
  }
}

function parseNotifyAction(action) {
  const m = /^HAUSMEISTER_([A-Z]+)_(\d+)$/.exec(String(action || ''));
  if (!m) return null;
  const key = m[1].toLowerCase();
  return ACTIONS[key] ? { key, id: Number(m[2]) } : null;
}

// Result of a Claude run (stream-json or json) to ticket outcome.
function interpretResult(phase, raw) {
  let res;
  try { res = JSON.parse(raw); } catch {
    res = parseStream(raw).result;
    if (!res) return { kind: 'fehler', message: `Antwort nicht lesbar: ${String(raw).slice(-300)}` };
  }
  if (Array.isArray(res)) res = res.filter((m) => m && m.type === 'result').pop() || {};
  const text = typeof res.result === 'string' ? res.result : '';
  if (res.is_error) {
    if (/limit|usage|quota|rate/i.test(text) && /reach|hit|exceed|erreicht|resets?/i.test(text)) return { kind: 'kontingent', message: text.slice(0, 300), session_id: res.session_id };
    if (/log ?in|authenticat|credentials|api key|oauth/i.test(text)) return { kind: 'anmeldung', message: text.slice(0, 300), session_id: res.session_id };
    return { kind: 'fehler', message: text.slice(0, 500) || res.subtype || 'unbekannter Fehler', session_id: res.session_id };
  }
  let out = res.structured_output;
  if (!out) {
    const m = /```json\s*([\s\S]*?)```/.exec(text);
    if (m) { try { out = JSON.parse(m[1]); } catch { /* handled below */ } }
  }
  if (!out || typeof out !== 'object') return { kind: 'fehler', message: 'Kein strukturiertes Ergebnis erhalten', session_id: res.session_id, text };
  const allowed = phase === 'entwerfen' ? ['entwurf', 'rueckfrage', 'fehler'] : ['umgesetzt', 'rueckfrage', 'fehler'];
  if (!allowed.includes(out.status)) return { kind: 'fehler', message: `Unerwarteter Status "${out.status}"`, session_id: res.session_id, out };
  return { kind: out.status, out, session_id: res.session_id, cost: res.total_cost_usd, turns: res.num_turns, denied: Array.isArray(res.permission_denials) ? res.permission_denials.length : 0 };
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['entwurf', 'umgesetzt', 'rueckfrage', 'fehler'] },
    zusammenfassung: { type: 'string', description: 'Ein bis zwei Sätze' },
    details: { type: 'string', description: 'Entwurf oder Umsetzungsbericht in Markdown' },
    frage: { type: 'string', description: 'Nur bei rueckfrage: die konkrete Frage' },
    geaenderte_dateien: { type: 'array', items: { type: 'string' } },
    ha_aenderungen: { type: 'array', items: { type: 'string' }, description: 'Über die API geänderte Dinge, z. B. Dashboard xyz, Automation abc' },
    test: { type: 'string', description: 'Wie man das Ergebnis selbst prüft' },
    vorschlaege: {
      type: 'array',
      description: 'Nur beim Rundgang: was du anpassen würdest',
      items: {
        type: 'object',
        properties: {
          titel: { type: 'string', description: 'kurz, als Auftrag formuliert' },
          text: { type: 'string', description: 'Befund und Ziel, so konkret, dass daraus ein Ticket werden kann' },
          begruendung: { type: 'string', description: 'warum es sich lohnt, mit Beleg (Entität, Wert, Logzeile)' },
          kategorie: { type: 'string', enum: ['fehler', 'sicherheit', 'energie', 'komfort', 'aufraeumen', 'wartung'] },
          nutzen: { type: 'string', enum: ['hoch', 'mittel', 'gering'] },
          aufwand: { type: 'string', enum: ['klein', 'mittel', 'gross'] },
          handarbeit: { type: 'boolean', description: 'true, wenn ein Mensch es vor Ort tun muss (Batterie, Gerät, Kabel); Claude kann es nicht umsetzen' },
        },
        required: ['titel', 'text', 'kategorie', 'nutzen', 'aufwand'],
      },
    },
  },
  required: ['status', 'zusammenfassung', 'details'],
};

// "sofort: ..." or "! ..." at the start of a todo item means: implement right away.
function parseIntake(summary) {
  const m = /^\s*(?:sofort\s*[:!-]|!)\s*(.*)$/i.exec(String(summary || ''));
  return m ? { title: m[1].trim() || String(summary).trim(), immediate: true } : { title: String(summary || '').trim(), immediate: false };
}

// Normalized title for "already proposed or declined".
function sameKey(s) {
  return String(s || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

const KATEGORIEN = { fehler: 'Fehler', sicherheit: 'Sicherheit', energie: 'Energie', komfort: 'Komfort', aufraeumen: 'Aufräumen', wartung: 'Wartung' };

function slug(s) {
  return String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'ticket';
}

module.exports = { STATES, ACTIONS, actionsFor, applyAction, parseTimes, dueTimes, nextRun, dayKey, pickQueue, compareWatch, confirmWatch, watchAlarm, interpretResult, RESULT_SCHEMA, slug, sameKey, KATEGORIEN, parseIntake, stepText, parseStream, quotaFrom, quotaBlocks, notifyActions, parseNotifyAction };
