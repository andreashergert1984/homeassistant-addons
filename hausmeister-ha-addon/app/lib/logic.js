'use strict';
// Pure logic without I/O: ticket states, allowed actions, schedule, watch comparison.
// Everything here is covered by test/logic.test.js.
// State, action and category keys are internal identifiers stored in the tickets; their
// labels come from the dictionaries (state.<key>, action.<key>, category.<key>).

const i18n = require('./i18n');

const STATE_KEYS = ['neu', 'entwerfen', 'entwurf', 'rueckfrage', 'umsetzen', 'in_arbeit', 'umgesetzt', 'pruefen', 'fehler', 'erledigt', 'verworfen', 'zurueckgerollt'];
const stateLabel = (s) => (STATE_KEYS.includes(s) ? i18n.t(`state.${s}`) : s);
const states = () => Object.fromEntries(STATE_KEYS.map((s) => [s, stateLabel(s)]));

// Names stored as "created_by", "by" or run reason. They are identifiers from before 0.7.0
// and stay as they are; the board shows them through actorLabel and reasonLabel.
const ACTOR = { schedule: 'Zeitplan', todo: 'To-do-Liste', automation: 'Automation', caretaker: 'Hausmeister', unknown: 'unbekannt', phone: 'Handy' };
const REASON = { manual: 'von Hand', now: 'sofort', start: 'Start', schedule: 'Zeitplan' };
function actorLabel(name) {
  const k = Object.keys(ACTOR).find((x) => ACTOR[x] === name);
  return k ? i18n.t(`actor.${k}`) : name;
}
function reasonLabel(reason) {
  const r = String(reason || '');
  const m = new RegExp(`^${REASON.schedule} (\\d\\d:\\d\\d)$`).exec(r);
  if (m) return i18n.t('reason.schedule', { time: m[1] });
  const k = Object.keys(REASON).find((x) => REASON[x] === r);
  return k ? i18n.t(`reason.${k}`) : r;
}

// Actions a person can take. "to" may depend on the ticket (function). Labels: action.<key>.
const ACTIONS = {
  entwerfen: { from: ['neu', 'entwurf', 'rueckfrage', 'fehler', 'zurueckgerollt', 'verworfen', 'erledigt'], to: 'entwerfen' },
  umsetzen: { from: ['entwurf'], to: 'umsetzen' },
  // Immediately, without waiting for the schedule; from a draft it implements that draft,
  // otherwise Claude plans and implements in one go.
  sofort: { from: ['neu', 'entwerfen', 'entwurf', 'rueckfrage', 'umsetzen', 'fehler', 'zurueckgerollt'], to: 'umsetzen', immediate: true },
  antworten: { from: ['rueckfrage'], to: (t) => t.phase === 'umsetzen' ? 'umsetzen' : 'entwerfen', comment: true },
  nachbessern: { from: ['umgesetzt', 'pruefen'], to: 'umsetzen', comment: true },
  wiederholen: { from: ['fehler'], to: (t) => t.phase === 'umsetzen' ? 'umsetzen' : 'entwerfen' },
  abnehmen: { from: ['umgesetzt', 'pruefen'], to: 'erledigt' },
  verwerfen: { from: ['neu', 'entwerfen', 'entwurf', 'rueckfrage', 'umsetzen', 'fehler', 'zurueckgerollt'], to: 'verworfen' },
  zurueckstellen: { from: ['entwerfen', 'umsetzen'], to: 'neu' },
};

function actionsFor(ticket) {
  return Object.entries(ACTIONS)
    .filter(([, a]) => a.from.includes(ticket.state))
    .map(([key, a]) => ({ key, label: actionLabel(key), comment: !!a.comment, immediate: !!a.immediate }));
}

const actionLabel = (key) => (ACTIONS[key] ? i18n.t(`action.${key}`) : key);

function applyAction(ticket, key, comment) {
  const a = ACTIONS[key];
  if (!a) throw new Error(i18n.t('err.unknown_action', { action: key }));
  if (!a.from.includes(ticket.state)) throw new Error(i18n.t('err.action_not_allowed', { action: actionLabel(key), state: stateLabel(ticket.state) }));
  if (a.comment && !(comment && comment.trim())) throw new Error(i18n.t('err.comment_needed', { action: actionLabel(key) }));
  return typeof a.to === 'function' ? a.to(ticket) : a.to;
}

// "HH:MM" list; returns the entries that are due at `now` and not yet fired today.
function parseTimes(list) {
  const out = [];
  for (const raw of list || []) {
    const m = /^\s*([01]?\d|2[0-3]):([0-5]\d)\s*$/.exec(String(raw));
    if (!m) throw new Error(i18n.t('err.invalid_time', { value: raw }));
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
  if (today) return i18n.t('run.next_today', { time: today });
  return times.length ? i18n.t('run.next_tomorrow', { time: times[0] }) : i18n.t('run.no_times');
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
  const list = (l) => `${l.slice(0, 20).join(', ')}${l.length > 20 ? ' …' : ''}`;
  if (check && check.result && check.result !== 'valid') reasons.push(i18n.t('watch.config_check', { errors: check.errors || check.result }));
  if (w.shrunk.length) reasons.push(i18n.t('watch.shrunk', { files: shrunkList(w.shrunk) }));
  if (w.vanished.length) reasons.push(i18n.t('watch.vanished', { n: w.vanished.length, list: list(w.vanished) }));
  if (w.unavailable.length) reasons.push(i18n.t('watch.unavailable', { n: w.unavailable.length, list: list(w.unavailable) }));
  return reasons;
}

const shrunkList = (shrunk) => shrunk.map((s) => i18n.t('watch.file_size', { file: s.file, before: s.before, after: s.after })).join(', ');

// Short description of a tool call in the active language, for the live progress.
function stepText(name, input = {}) {
  const f = (p) => String(p || '').replace(/^\/homeassistant\//, '');
  switch (name) {
    case 'Read': return i18n.t('step.read', { file: f(input.file_path) });
    case 'Edit': return i18n.t('step.edit', { file: f(input.file_path) });
    case 'Write': return i18n.t('step.write', { file: f(input.file_path) });
    case 'Grep': return i18n.t('step.grep', { pattern: String(input.pattern || '').slice(0, 60) });
    case 'Glob': return i18n.t('step.glob', { pattern: String(input.pattern || '').slice(0, 60) });
    case 'WebSearch': return i18n.t('step.websearch', { query: String(input.query || '').slice(0, 60) });
    case 'WebFetch': return i18n.t('step.read', { file: String(input.url || '').slice(0, 80) });
    case 'Bash': return input.description ? String(input.description).slice(0, 100) : i18n.t('step.bash', { command: String(input.command || '').slice(0, 80) });
    case 'StructuredOutput': return i18n.t('step.result');
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

// Buttons of a push notification per state (mobile app actionable notifications). The nonce is
// random per notification and stored at the ticket; only a button with the current nonce counts.
function notifyActions(state, id, nonce = '') {
  const a = (key, title, extra = {}) => ({ action: `HAUSMEISTER_${key}_${id}${nonce ? `_${nonce}` : ''}`, title: i18n.t(title), ...extra });
  const input = (placeholder) => ({ behavior: 'textInput', textInputButtonTitle: i18n.t('notify.btn.send'), textInputPlaceholder: i18n.t(placeholder) });
  switch (state) {
    case 'entwurf': return [a('SOFORT', 'notify.btn.now'), a('UMSETZEN', 'notify.btn.next_run'), a('VERWERFEN', 'notify.btn.discard')];
    case 'rueckfrage': return [a('ANTWORTEN', 'notify.btn.answer', input('notify.ph.answer'))];
    case 'umgesetzt': return [a('ABNEHMEN', 'notify.btn.ok'), a('NACHBESSERN', 'notify.btn.improve', input('notify.ph.improve'))];
    case 'pruefen': return [a('NACHBESSERN', 'notify.btn.improve', input('notify.ph.improve'))];
    case 'fehler': return [a('WIEDERHOLEN', 'notify.btn.retry')];
    default: return [];
  }
}

// { key, id, nonce }; nonce is null for buttons from before 0.8.0 (they are refused).
function parseNotifyAction(action) {
  const m = /^HAUSMEISTER_([A-Z]+)_(\d+)(?:_([0-9a-f]{16,64}))?$/.exec(String(action || ''));
  if (!m) return null;
  const key = m[1].toLowerCase();
  return ACTIONS[key] ? { key, id: Number(m[2]), nonce: m[3] || null } : null;
}

// Result of a Claude run (stream-json or json) to ticket outcome.
function interpretResult(phase, raw) {
  let res;
  try { res = JSON.parse(raw); } catch {
    res = parseStream(raw).result;
    if (!res) return { kind: 'fehler', message: i18n.t('result.unreadable', { raw: String(raw).slice(-300) }) };
  }
  if (Array.isArray(res)) res = res.filter((m) => m && m.type === 'result').pop() || {};
  const text = typeof res.result === 'string' ? res.result : '';
  if (res.is_error) {
    if (/limit|usage|quota|rate/i.test(text) && /reach|hit|exceed|erreicht|resets?/i.test(text)) return { kind: 'kontingent', message: text.slice(0, 300), session_id: res.session_id };
    if (/log ?in|authenticat|credentials|api key|oauth/i.test(text)) return { kind: 'anmeldung', message: text.slice(0, 300), session_id: res.session_id };
    return { kind: 'fehler', message: text.slice(0, 500) || res.subtype || i18n.t('result.unknown_error'), session_id: res.session_id };
  }
  let out = res.structured_output;
  if (!out) {
    const m = /```json\s*([\s\S]*?)```/.exec(text);
    if (m) { try { out = JSON.parse(m[1]); } catch { /* handled below */ } }
  }
  if (!out || typeof out !== 'object') return { kind: 'fehler', message: i18n.t('result.no_structured'), session_id: res.session_id, text };
  const allowed = phase === 'entwerfen' ? ['entwurf', 'rueckfrage', 'fehler'] : ['umgesetzt', 'rueckfrage', 'fehler'];
  if (!allowed.includes(out.status)) return { kind: 'fehler', message: i18n.t('result.unexpected_status', { status: out.status }), session_id: res.session_id, out };
  return { kind: out.status, out, session_id: res.session_id, cost: res.total_cost_usd, turns: res.num_turns, denied: Array.isArray(res.permission_denials) ? res.permission_denials.length : 0 };
}

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['entwurf', 'umgesetzt', 'rueckfrage', 'fehler'] },
    zusammenfassung: { type: 'string', description: 'One or two sentences' },
    details: { type: 'string', description: 'Draft or implementation report in Markdown' },
    frage: { type: 'string', description: 'Only with rueckfrage: the concrete question' },
    geaenderte_dateien: { type: 'array', items: { type: 'string' } },
    ha_aenderungen: { type: 'array', items: { type: 'string' }, description: 'Things changed through the API, e.g. dashboard xyz, automation abc' },
    test: { type: 'string', description: 'How a person checks the result' },
    vorschlaege: {
      type: 'array',
      description: 'Only in an inspection: what you would change',
      items: {
        type: 'object',
        properties: {
          titel: { type: 'string', description: 'short, phrased as a task' },
          text: { type: 'string', description: 'finding and goal, concrete enough to become a ticket' },
          begruendung: { type: 'string', description: 'why it is worth it, with evidence (entity, value, log line)' },
          kategorie: { type: 'string', enum: ['fehler', 'sicherheit', 'energie', 'komfort', 'aufraeumen', 'wartung'] },
          nutzen: { type: 'string', enum: ['hoch', 'mittel', 'gering'] },
          aufwand: { type: 'string', enum: ['klein', 'mittel', 'gross'] },
          handarbeit: { type: 'boolean', description: 'true if a person has to do it on site (battery, device, cable); Claude cannot implement it' },
        },
        required: ['titel', 'text', 'kategorie', 'nutzen', 'aufwand'],
      },
    },
  },
  required: ['status', 'zusammenfassung', 'details'],
};

// "sofort: ...", "now: ..." or "! ..." at the start of a todo item means: implement right away.
function parseIntake(summary) {
  const m = /^\s*(?:(?:sofort|now)\s*[:!-]|!)\s*(.*)$/i.exec(String(summary || ''));
  return m ? { title: m[1].trim() || String(summary).trim(), immediate: true } : { title: String(summary || '').trim(), immediate: false };
}

// Files that integrations rewrite on their own all the time. They change between
// the snapshots before and after an implementation without Claude touching them,
// and restoring them would break things (a login secret, a device state).
const VOLATILE = [
  /^zigbee2mqtt\/(state\.json|coordinator_backup\.json|database\.db)$/, /^\.storage\/.*secret/i, /^\.storage\/.*\.(events|load|history|cache)$/,
  /discovered_contacts/, /^\.storage\/(core\.(device_registry|entity_registry|area_registry|restore_state)|person|bluetooth\.|http\.|mobile_app|assist_pipeline\.pipelines|repairs\.issue_registry|homeassistant\.exposed_entities)/,
  /^\.storage\/.*(token|session|cookie|cache)/i, /\.log$/,
];
// Configuration is never learned as volatile, even if it changed between two runs: YAML,
// dashboards, automations, scripts and scenes. Otherwise a rollback would skip them.
const NEVER_VOLATILE = [/\.ya?ml$/i, /(^|\/)lovelace/i, /(^|\/)(automations?|scripts?|scenes?)(\.|\/|$)/i];
const neverVolatile = (file) => NEVER_VOLATILE.some((r) => r.test(String(file)));
const isVolatile = (file, learned = []) => VOLATILE.some((r) => r.test(file)) || (learned.includes(file) && !neverVolatile(file));

// Normalized title for "already proposed or declined".
function sameKey(s) {
  return String(s || '').toLowerCase().replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue').replace(/\u00df/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

const CATEGORY_KEYS = ['fehler', 'sicherheit', 'energie', 'komfort', 'aufraeumen', 'wartung'];
const categories = () => Object.fromEntries(CATEGORY_KEYS.map((k) => [k, i18n.t(`category.${k}`)]));

// Option inspection_day: German values from before 0.7.0 and English values.
const INSPECTION_DAYS = {
  aus: 'off', off: 'off', taeglich: 'daily', daily: 'daily',
  so: 0, sun: 0, mo: 1, mon: 1, di: 2, tue: 2, mi: 3, wed: 3, do: 4, thu: 4, fr: 5, fri: 5, sa: 6, sat: 6,
};
function inspectionDue(option, date) {
  const v = INSPECTION_DAYS[String(option || 'off').toLowerCase()];
  if (v === undefined || v === 'off') return false;
  return v === 'daily' || v === date.getDay();
}

function slug(s) {
  return String(s).toLowerCase().replace(/\u00e4/g, 'ae').replace(/\u00f6/g, 'oe').replace(/\u00fc/g, 'ue').replace(/\u00df/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'ticket';
}

module.exports = { STATE_KEYS, states, stateLabel, ACTIONS, actionLabel, actionsFor, applyAction, ACTOR, REASON, actorLabel, reasonLabel, CATEGORY_KEYS, categories, INSPECTION_DAYS, inspectionDue, shrunkList, parseTimes, dueTimes, nextRun, dayKey, pickQueue, compareWatch, confirmWatch, watchAlarm, interpretResult, RESULT_SCHEMA, slug, sameKey, VOLATILE, isVolatile, neverVolatile, parseIntake, stepText, parseStream, quotaFrom, quotaBlocks, notifyActions, parseNotifyAction };
