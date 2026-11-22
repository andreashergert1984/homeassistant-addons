'use strict';
// Hausmeister add-on: board (ingress), schedule, intake from a todo list, sensors.

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const L = require('./lib/logic');
const ha = require('./lib/ha');
const git = require('./lib/git');
const { Store } = require('./lib/store');
const { Runner } = require('./lib/runner');

const OPTIONS_FILE = process.env.HM_OPTIONS || '/data/options.json';
const PORT = Number(process.env.HM_PORT || 8099);
const TTYD_PORT = Number(process.env.HM_TTYD_PORT || 7681);
const SHARE = process.env.HM_SHARE_DIR || '/share/hausmeister';
const PUBLIC = path.join(__dirname, 'public');

const raw = fs.existsSync(OPTIONS_FILE) ? JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8')) : {};
const opts = {
  run_times: L.parseTimes(raw.run_times || ['11:00', '16:00']),
  auto_draft: raw.auto_draft !== false,
  max_tickets_per_run: Number(raw.max_tickets_per_run || 5),
  run_timeout_minutes: Number(raw.run_timeout_minutes || 30),
  backup_before_change: raw.backup_before_change !== false,
  intake_todo: raw.intake_todo === undefined ? 'todo.hausmeister' : String(raw.intake_todo || ''),
  notify_service: raw.notify_service || '',
  model: raw.model || '',
  max_quota_percent: raw.max_quota_percent === undefined ? 80 : Number(raw.max_quota_percent),
  inspection_day: raw.inspection_day || 'aus',
  panel_url: '',
};
const WEEKDAYS = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];

fs.mkdirSync(SHARE, { recursive: true });
const store = new Store(process.env.HM_STATE || '/data/state.json', path.join(SHARE, 'tickets'));
const runner = new Runner(store, opts);
const fired = new Set();

// ---- sensors -------------------------------------------------------------
async function publish() {
  const count = (s) => store.data.tickets.filter((t) => s.includes(t.state)).length;
  const waiting = count(['entwurf', 'rueckfrage', 'umgesetzt', 'pruefen', 'fehler']);
  const last = store.data.runs[0];
  await ha.setSensor('sensor.hausmeister_wartet_auf_dich', waiting, {
    friendly_name: 'Hausmeister wartet auf dich', icon: 'mdi:account-hard-hat', unit_of_measurement: 'Tickets',
    entwurf: count(['entwurf']), rueckfrage: count(['rueckfrage']), abnehmen: count(['umgesetzt', 'pruefen']), fehler: count(['fehler']),
  });
  await ha.setSensor('sensor.hausmeister_offen', count(['neu', 'entwerfen', 'entwurf', 'rueckfrage', 'umsetzen', 'in_arbeit', 'umgesetzt', 'pruefen', 'fehler']), {
    friendly_name: 'Hausmeister offene Tickets', icon: 'mdi:clipboard-list', unit_of_measurement: 'Tickets',
    in_arbeit: runner.current ? `#${runner.current.id}` : null, naechster_lauf: L.nextRun(opts.run_times, new Date()),
    letzter_lauf: last ? last.at : null, letzter_lauf_ergebnis: last ? (last.note || `${last.tickets.length} Ticket(s)`) : null,
    angemeldet: runner.loggedIn(), schritt: runner.current ? runner.current.step : null,
    kontingent_prozent: store.data.quota && store.data.quota.utilization != null ? Math.round(store.data.quota.utilization * 100) : null,
    kontingent_fenster: store.data.quota ? store.data.quota.window : null,
  });
}
runner.onChange = () => { publish().catch(() => {}); };

// ---- intake from the todo list ------------------------------------------
let intakeWarned = false;
async function intake() {
  if (!opts.intake_todo) return;
  let items;
  try {
    const r = await ha.ws('todo/item/list', { entity_id: opts.intake_todo });
    items = r.items || [];
    intakeWarned = false;
  } catch (e) {
    if (!intakeWarned) console.error(`[hausmeister] To-do-Liste ${opts.intake_todo} nicht lesbar: ${e.message}`);
    intakeWarned = true;
    return;
  }
  const now = [];
  for (const it of items.filter((i) => i.status === 'needs_action')) {
    const p = L.parseIntake(it.summary);
    const t = store.create({ title: p.title, text: it.description || '', by: 'To-do-Liste', source: 'todo', state: p.immediate ? 'umsetzen' : (opts.auto_draft ? 'entwerfen' : 'neu'), direct: p.immediate });
    if (p.immediate) now.push(t.id);
    try {
      await ha.core('POST', '/services/todo/remove_item', { entity_id: opts.intake_todo, item: it.uid || it.summary });
    } catch (e) { console.error(`[hausmeister] Eintrag nicht entfernt (#${t.id}):`, e.message); }
    console.log(`[hausmeister] Ticket #${t.id} aus der To-do-Liste: ${t.title}`);
  }
  if (now.length) runner.kick(now, 'To-do-Liste');
  if (items.length) publish().catch(() => {});
}

// ---- events: buttons in push notifications, tickets from automations -------
let userNames = {};
async function userName(id) {
  if (!id) return 'Handy';
  if (!userNames[id]) {
    try { for (const u of await ha.ws('config/auth/list')) userNames[u.id] = u.name; } catch { /* not allowed */ }
  }
  return userNames[id] || 'Handy';
}

async function onEvent(ev) {
  if (ev.event_type === 'mobile_app_notification_action') {
    const a = L.parseNotifyAction(ev.data && ev.data.action);
    if (!a) return;
    const by = await userName(ev.context && ev.context.user_id);
    const t = store.get(a.id);
    try {
      const text = ev.data.reply_text;
      const to = L.applyAction(t, a.key, text);
      if (text && String(text).trim()) t.comments.push({ at: store.now(), by, text: String(text).trim() });
      if (a.key === 'sofort' && t.state !== 'umsetzen') t.direct = t.state !== 'entwurf';
      else if (a.key === 'umsetzen') t.direct = false;
      store.move(t, to, by, `${L.ACTIONS[a.key].label} (Benachrichtigung)`);
      if (L.ACTIONS[a.key].immediate) runner.kick([t.id], by);
      console.log(`[hausmeister] #${t.id}: ${a.key} über die Benachrichtigung von ${by}`);
    } catch (e) {
      await ha.notify(`Hausmeister #${t.id}`, `Nicht ausgeführt: ${e.message}`, { service: opts.notify_service, id: `hausmeister_${t.id}` });
    }
    publish().catch(() => {});
  } else if (ev.event_type === 'hausmeister_neues_ticket') {
    const d = ev.data || {};
    const mode = d.modus || d.mode || (opts.auto_draft ? 'entwurf' : 'sammeln');
    const state = { entwurf: 'entwerfen', sofort: 'umsetzen', sammeln: 'neu' }[mode];
    if (!state) { console.error(`[hausmeister] hausmeister_neues_ticket: unbekannter Modus ${mode}`); return; }
    const t = store.create({ title: d.titel || d.title, text: d.text || '', by: d.von || 'Automation', source: 'event', state, direct: mode === 'sofort' });
    if (mode === 'sofort') runner.kick([t.id], 'Automation');
    console.log(`[hausmeister] Ticket #${t.id} aus einem Ereignis: ${t.title}`);
    publish().catch(() => {});
  }
}

// ---- schedule --------------------------------------------------------------
function maybeInspection(key) {
  const [day, time] = key.split(' ');
  if (opts.inspection_day === 'aus' || time !== opts.run_times[0]) return;
  if (WEEKDAYS[new Date().getDay()] !== opts.inspection_day && opts.inspection_day !== 'taeglich') return;
  if (store.data.tickets.some((t) => t.kind === 'rundgang' && t.created.slice(0, 10) === day)) return;
  const t = store.create({ title: `Rundgang vom ${day}`, text: 'Regelmäßiger Rundgang: nur lesen, Probleme finden, Tickets vorschlagen.', by: 'Zeitplan', source: 'rundgang', state: 'entwerfen', kind: 'rundgang' });
  console.log(`[hausmeister] Rundgang #${t.id} angelegt`);
}

async function tick() {
  for (const key of L.dueTimes(opts.run_times, new Date(), fired)) {
    fired.add(key);
    maybeInspection(key);
    console.log(`[hausmeister] Geplanter Lauf ${key}`);
    runner.cycle(`Zeitplan ${key.split(' ')[1]}`).then(() => publish()).catch((e) => console.error(e));
  }
}
// Times already passed today do not fire after a restart.
for (const t of opts.run_times) {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (t <= hm) fired.add(`${L.dayKey(now)} ${t}`);
}

// ---- HTTP ------------------------------------------------------------------
function who(req) {
  return String(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || 'unbekannt');
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e6) { reject(new Error('zu groß')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('kein JSON')); } });
  });
}

function view(t, full) {
  const base = { id: t.id, title: t.title, state: t.state, state_label: L.STATES[t.state], updated: t.updated, created: t.created, created_by: t.created_by };
  if (!full) return { ...base, summary: (t.results[t.results.length - 1] || {}).summary || '' };
  return { ...t, ...base, actions: L.actionsFor(t), can_rollback: !!(t.snapshot && t.snapshot.post && ['umgesetzt', 'pruefen', 'erledigt', 'fehler'].includes(t.state)) };
}

function proxyTtyd(req, res) {
  const p = http.request({ host: '127.0.0.1', port: TTYD_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  p.on('error', () => send(res, 502, 'Terminal nicht erreichbar', 'text/plain; charset=utf-8'));
  req.pipe(p);
}

const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p.startsWith('/terminal')) return proxyTtyd(req, res);
  if (req.method === 'GET' && STATIC[p]) {
    const f = path.join(PUBLIC, STATIC[p]);
    return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)]);
  }
  try {
    if (req.method === 'GET' && p === '/api/state') {
      return send(res, 200, {
        tickets: store.data.tickets.map((t) => view(t, false)).sort((a, b) => b.updated.localeCompare(a.updated)),
        runs: store.data.runs.slice(0, 30), busy: runner.busy, current: runner.current && { ...runner.current, steps: runner.current.steps.slice(-15) }, logged_in: runner.loggedIn(),
        quota: store.data.quota || null, max_quota_percent: opts.max_quota_percent, quota_blocked: runner.quotaBlocked(), watchdog: store.data.watchdog || null,
        next_run: L.nextRun(opts.run_times, new Date()), options: { run_times: opts.run_times, auto_draft: opts.auto_draft, intake_todo: opts.intake_todo },
        states: L.STATES,
      });
    }
    let m = /^\/api\/tickets\/(\d+)$/.exec(p);
    if (req.method === 'GET' && m) return send(res, 200, view(store.get(m[1]), true));
    if (req.method === 'POST' && p === '/api/tickets') {
      const b = await readBody(req);
      const mode = b.mode || (b.draft === false ? 'sammeln' : 'entwurf');
      if (!['entwurf', 'sofort', 'sammeln'].includes(mode)) throw new Error(`Unbekannter Modus ${mode}`);
      const state = { entwurf: 'entwerfen', sofort: 'umsetzen', sammeln: 'neu' }[mode];
      const t = store.create({ title: b.title, text: b.text, by: who(req), state, direct: mode === 'sofort' });
      if (mode === 'sofort') runner.kick([t.id], who(req));
      publish().catch(() => {});
      return send(res, 200, view(t, true));
    }
    m = /^\/api\/tickets\/(\d+)\/(action|comment|rollback|edit)$/.exec(p);
    if (req.method === 'POST' && m) {
      const t = store.get(m[1]);
      const b = await readBody(req);
      if (m[2] === 'comment') {
        if (!String(b.text || '').trim()) throw new Error('Kommentar ist leer');
        store.comment(t, who(req), b.text);
      } else if (m[2] === 'edit') {
        if (!['neu', 'entwurf', 'rueckfrage', 'fehler'].includes(t.state)) throw new Error('Ändern geht nur, solange das Ticket nicht bearbeitet wird');
        if (b.title !== undefined) { if (!String(b.title).trim()) throw new Error('Titel fehlt'); t.title = String(b.title).trim().slice(0, 200); }
        if (b.text !== undefined) t.text = String(b.text);
        store.touch(t);
      } else if (m[2] === 'rollback') {
        await runner.rollback(t, who(req));
      } else {
        if (t.state === 'in_arbeit') throw new Error('Das Ticket wird gerade bearbeitet');
        const to = L.applyAction(t, b.action, b.comment);
        if (b.comment && String(b.comment).trim()) t.comments.push({ at: store.now(), by: who(req), text: String(b.comment).trim() });
        // Implementing an approved draft vs. planning and implementing in one go.
        if (b.action === 'sofort' && t.state !== 'umsetzen') t.direct = t.state !== 'entwurf';
        else if (b.action === 'umsetzen' || b.action === 'entwerfen') t.direct = false;
        store.move(t, to, who(req), L.ACTIONS[b.action].label);
        if (L.ACTIONS[b.action].immediate) runner.kick([t.id], who(req));
      }
      publish().catch(() => {});
      return send(res, 200, view(t, true));
    }
    if (req.method === 'POST' && p === '/api/run') {
      if (runner.busy) throw new Error('Es läuft schon ein Lauf');
      runner.cycle('von Hand', who(req)).then(() => publish()).catch((e) => console.error(e));
      return send(res, 200, { started: true });
    }
    if (req.method === 'POST' && p === '/api/cancel') return send(res, 200, { cancelled: runner.cancel() });
    if (req.method === 'GET' && p === '/api/backups') return send(res, 200, await git.log(50));
    return send(res, 404, { error: 'nicht gefunden' });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
}

const server = http.createServer((req, res) => { route(req, res).catch((e) => send(res, 500, { error: e.message })); });

// WebSocket of the terminal (ttyd) through ingress.
server.on('upgrade', (req, sock, head) => {
  if (!req.url.startsWith('/terminal')) { sock.destroy(); return; }
  const up = net.connect(TTYD_PORT, '127.0.0.1', () => {
    const h = [];
    for (let i = 0; i < req.rawHeaders.length; i += 2) h.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${h.join('\r\n')}\r\n\r\n`);
    if (head && head.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on('error', () => sock.destroy());
  sock.on('error', () => up.destroy());
});

async function main() {
  await git.init();
  try { const self = await ha.sup('GET', '/addons/self/info'); opts.panel_url = `/${self.slug}`; } catch { /* outside the Supervisor */ }
  server.listen(PORT, () => console.log(`[hausmeister] Board auf Port ${PORT}, Läufe um ${opts.run_times.join(', ')}`));
  await ha.waitForCore();
  await publish().catch(() => {});
  await runner.backup('Start');
  ha.subscribe(['mobile_app_notification_action', 'hausmeister_neues_ticket'], (ev) => { onEvent(ev).catch((e) => console.error('[hausmeister] Ereignis:', e.message)); });
  setInterval(() => { tick().catch((e) => console.error(e)); }, 30000);
  setInterval(() => { intake().catch((e) => console.error(e)); }, 60000);
  setInterval(() => { publish().catch(() => {}); }, 15 * 60000);
  intake().catch(() => {});
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { route, store, runner, opts, onEvent, maybeInspection };
