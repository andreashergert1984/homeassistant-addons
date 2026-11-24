'use strict';
// Hausmeister add-on: board (ingress), schedule, intake from a todo list, sensors.

const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const L = require('./lib/logic');
const i18n = require('./lib/i18n');
const ha = require('./lib/ha');
const git = require('./lib/git');
const { Store } = require('./lib/store');
const { Runner, childEnv } = require('./lib/runner');
const perms = require('./lib/perms');
const { createProxy } = require('./lib/proxy');
const policy = require('./lib/policy');

const OPTIONS_FILE = process.env.HM_OPTIONS || '/data/options.json';
const PORT = Number(process.env.HM_PORT || 8099);
const TTYD_PORT = Number(process.env.HM_TTYD_PORT || 7681);
const SHARE = process.env.HM_SHARE_DIR || '/share/hausmeister';
const PUBLIC = path.join(__dirname, 'public');
const WORK_DIR = process.env.HM_WORK_DIR || '/data/work';
const HOME_DIR = process.env.HM_HOME_DIR || '/data/home';
const WISSEN = process.env.HM_WISSEN || '/data/wissen.md';
// Start file of the terminal shell; root-owned outside /data/home (which the draft user owns).
const TERMINAL_RC = process.env.HM_TERMINAL_RC || '/data/terminal.rc';
const STATE_FILE = process.env.HM_STATE || '/data/state.json';
const MAX_INTAKE_PER_HOUR = 10;
const tr = i18n.t;
const { ACTOR, REASON } = L;

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
  max_backup_gb: raw.max_backup_gb === undefined ? 2 : Number(raw.max_backup_gb),
  inspection_day: raw.inspection_day || 'off',
  language: raw.language || 'auto',
  allow_immediate_from_outside: raw.allow_immediate_from_outside === true,
  panel_url: '',
};
// Until Home Assistant answers, "auto" means English.
i18n.setLanguage(i18n.resolve(opts.language, null));

// Language from the option, "auto" asks Home Assistant. Returns true when it changed.
async function applyLanguage(getConfig = () => ha.core('GET', '/config')) {
  const before = i18n.language();
  i18n.setLanguage(await i18n.detect(opts.language, getConfig));
  return i18n.language() !== before;
}

const writeFile = (f, text) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); } catch (e) { console.error(`[hausmeister] ${f}:`, e.message); } };

// The knowledge file lives in the add-on data (/data/wissen.md); /share is writable by other
// add-ons and Samba, so /share/hausmeister/WISSEN.md is only an export that gets overwritten.
function exportWissen({ share = SHARE, wissen = WISSEN } = {}) {
  try { if (fs.existsSync(wissen)) writeFile(path.join(share, 'WISSEN.md'), fs.readFileSync(wissen, 'utf8')); } catch (e) { console.error('[hausmeister] knowledge export:', e.message); }
}

// Files Claude and the terminal read, in the active language: rules (CLAUDE.md), the
// greeting of the login terminal and, if missing, the knowledge file of the house.
function writeRuntimeFiles({ work = WORK_DIR, rc = TERMINAL_RC, share = SHARE, wissen = WISSEN } = {}) {
  const lang = i18n.language();
  writeFile(path.join(work, 'CLAUDE.md'), fs.readFileSync(path.join(__dirname, 'prompt', `regeln.${lang}.md`), 'utf8'));
  writeFile(rc, `[ -r /etc/bash.bashrc ] && . /etc/bash.bashrc\ncd ${work}\necho\necho ${JSON.stringify(tr('terminal.hello'))}\necho ${JSON.stringify(tr('terminal.helpers'))}\necho\n`);
  if (!fs.existsSync(wissen)) {
    // Once: take over the file from before 0.8.0.
    const old = path.join(share, 'WISSEN.md');
    if (fs.existsSync(old)) { writeFile(wissen, fs.readFileSync(old, 'utf8')); console.log(`[hausmeister] knowledge taken over from ${old}`); } else writeFile(wissen, `# ${tr('knowledge.title')}\n\n${tr('knowledge.text')}\n`);
  }
  exportWissen({ share, wissen });
}

fs.mkdirSync(SHARE, { recursive: true });
const store = new Store(STATE_FILE, path.join(SHARE, 'tickets'));
const runner = new Runner(store, opts);
const proxy = createProxy();
runner.proxy = proxy;
runner.afterRun = () => exportWissen();

// ---- rights: draft and inspection as the user hausmeister ----------------------
// paths of prepareRights, also used by the tests with temp folders.
function rightsPaths() {
  return {
    home: HOME_DIR, work: WORK_DIR, claudeMd: path.join(WORK_DIR, 'CLAUDE.md'), wissen: WISSEN, gitDir: git.GIT_DIR, config: git.WORK,
    private: [OPTIONS_FILE, STATE_FILE, runner.baselineFile],
  };
}
function prepareRights(user = perms.lookupUser(), { paths = rightsPaths(), fsx } = {}) {
  runner.runAs = user;
  if (!user) {
    console.log(`[hausmeister] user ${perms.RUN_USER} not found, drafts run as ${process.getuid ? process.getuid() : '?'}`);
    runner.beforeUnprivileged = null;
    return [];
  }
  const lines = perms.prepare(user, paths, { fsx });
  for (const l of lines) console.log(`[hausmeister] ${l}`);
  // A login in the terminal (root) or a root implementation leaves files of root in /data/home.
  runner.beforeUnprivileged = () => perms.chownTree(paths.home, user.uid, user.gid, fsx);
  console.log(`[hausmeister] drafts and inspections run as ${user.name} (uid ${user.uid}), implementations as root`);
  return lines;
}

// ---- terminal (ttyd, root, only through the board) --------------------------------
// No Supervisor token in the terminal; ha-api, ha-read and cfg-git go through the local proxy with
// a write token of its own. No start files from /data/home (the draft user can write there).
function terminalEnv(base, proxyUrl, token) {
  return childEnv(base, { HM_PROXY_URL: proxyUrl, HM_PROXY_TOKEN: token, HM_LANG: i18n.language(), INPUTRC: '/etc/inputrc', HISTFILE: '/data/.terminal_history' });
}
function terminalArgs() {
  return ['-p', String(TTYD_PORT), '-i', '127.0.0.1', '-b', '/terminal', '-W', '-w', WORK_DIR, '-d', '3', '-t', 'fontSize=14', '-t', 'titleFixed=Hausmeister',
    'bash', '--noprofile', '--rcfile', TERMINAL_RC, '-i'];
}
async function startTerminal({ spawnFn = spawn, restartMs = 3000 } = {}) {
  const url = await proxy.ensure();
  const token = proxy.issue('write', 'terminal');
  const env = terminalEnv(process.env, url, token);
  const once = () => {
    const c = spawnFn('ttyd', terminalArgs(), { env, stdio: 'inherit' });
    c.on('error', (e) => console.error('[hausmeister] terminal:', e.message));
    c.on('exit', () => setTimeout(once, restartMs).unref());
    return c;
  };
  return { child: once(), env, token };
}
const fired = new Set();

// ---- sensors -------------------------------------------------------------
async function publish() {
  const count = (s) => store.data.tickets.filter((t) => s.includes(t.state)).length;
  const waiting = count(['entwurf', 'rueckfrage', 'umgesetzt', 'pruefen', 'fehler']);
  const last = store.data.runs[0];
  await ha.setSensor('sensor.hausmeister_wartet_auf_dich', waiting, {
    friendly_name: tr('sensor_name.waiting'), icon: 'mdi:account-hard-hat', unit_of_measurement: 'Tickets',
    entwurf: count(['entwurf']), rueckfrage: count(['rueckfrage']), abnehmen: count(['umgesetzt', 'pruefen']), fehler: count(['fehler']),
  });
  await ha.setSensor('sensor.hausmeister_offen', count(['neu', 'entwerfen', 'entwurf', 'rueckfrage', 'umsetzen', 'in_arbeit', 'umgesetzt', 'pruefen', 'fehler']), {
    friendly_name: tr('sensor_name.open'), icon: 'mdi:clipboard-list', unit_of_measurement: 'Tickets',
    in_arbeit: runner.current ? `#${runner.current.id}` : null, naechster_lauf: L.nextRun(opts.run_times, new Date()),
    letzter_lauf: last ? last.at : null, letzter_lauf_ergebnis: last ? (last.note || tr('sensor_name.run_tickets', { n: last.tickets.length })) : null,
    vorschlaege_offen: (store.data.suggestions || []).filter((x) => x.state === 'offen').length,
    angemeldet: runner.loggedIn(), schritt: runner.current ? runner.current.step : null,
    kontingent_prozent: store.data.quota && store.data.quota.utilization != null ? Math.round(store.data.quota.utilization * 100) : null,
    kontingent_fenster: store.data.quota ? store.data.quota.window : null,
  });
}
runner.onChange = () => { publish().catch(() => {}); };

// ---- limits for tickets from outside (todo list, events) ---------------------
let intakeTimes = [];
let rateNotified = false;
function intakeAllowed(what) {
  const r = policy.rateTake(intakeTimes, Date.now(), MAX_INTAKE_PER_HOUR);
  intakeTimes = r.times;
  if (r.ok) { rateNotified = false; return true; }
  console.error(`[hausmeister] more than ${MAX_INTAKE_PER_HOUR} new tickets in one hour, discarded: ${what}`);
  if (!rateNotified) {
    rateNotified = true;
    ha.notify(tr('rate.title'), tr('rate.text', { max: MAX_INTAKE_PER_HOUR }), { service: opts.notify_service, id: 'hausmeister_limit', url: opts.panel_url }).catch(() => {});
  }
  return false;
}

// Immediate implementation from outside (prefix in the todo list, mode "sofort" in an event)
// only with the option; otherwise the ticket becomes a draft with a note.
function outsideState(immediate, fallback) {
  if (!immediate) return { state: fallback, direct: false, note: false };
  if (opts.allow_immediate_from_outside) return { state: 'umsetzen', direct: true, note: false };
  return { state: 'entwerfen', direct: false, note: true };
}
function noteImmediateIgnored(t) {
  store.comment(t, ACTOR.caretaker, tr('intake.immediate_ignored'));
}

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
    if (!intakeWarned) console.error(`[hausmeister] todo list ${opts.intake_todo} not readable: ${e.message}`);
    intakeWarned = true;
    return;
  }
  const now = [];
  for (const it of items.filter((i) => i.status === 'needs_action')) {
    const p = L.parseIntake(it.summary);
    const remove = async (label) => {
      try {
        await ha.core('POST', '/services/todo/remove_item', { entity_id: opts.intake_todo, item: it.uid || it.summary });
      } catch (e) { console.error(`[hausmeister] todo item not removed (${label}):`, e.message); }
    };
    if (!intakeAllowed(`todo "${p.title}"`)) { await remove('limit'); continue; }
    const s = outsideState(p.immediate, opts.auto_draft ? 'entwerfen' : 'neu');
    const t = store.create({ title: p.title, text: it.description || '', by: ACTOR.todo, source: 'todo', state: s.state, direct: s.direct });
    if (s.note) noteImmediateIgnored(t);
    if (s.direct) now.push(t.id);
    await remove(`#${t.id}`);
    console.log(`[hausmeister] ticket #${t.id} from the todo list: ${t.title}`);
  }
  if (now.length) runner.kick(now, ACTOR.todo, { checkQuota: true });
  if (items.length) publish().catch(() => {});
}

// ---- events: buttons in push notifications, tickets from automations -------
// Users of Home Assistant (config/auth/list) and our own user, cached for a minute.
const deps = {
  listUsers: () => ha.ws('config/auth/list'),
  currentUser: () => ha.ws('auth/current_user'),
};
let usersCache = { at: 0, list: null };
async function users() {
  if (usersCache.list && Date.now() - usersCache.at < 60000) return usersCache.list;
  try { usersCache = { at: Date.now(), list: await deps.listUsers() }; } catch (e) { console.error('[hausmeister] users not readable:', e.message); return usersCache.list || []; }
  return usersCache.list;
}
let ownId;
async function ownUserId() {
  if (ownId === undefined) { try { ownId = (await deps.currentUser()).id || null; } catch { return null; } }
  return ownId;
}
function resetAuthCache() { usersCache = { at: 0, list: null }; ownId = undefined; }

// Only events from an active admin count; events of our own user (Claude through the proxy) never.
async function eventSender(ev) {
  const uid = ev.context && ev.context.user_id;
  if (uid && uid === await ownUserId()) return { ok: false, why: 'own user' };
  const u = uid ? (await users()).find((x) => x.id === uid) : null;
  if (!policy.isActiveAdmin(u)) return { ok: false, why: uid ? `user ${uid} is not an active admin` : 'no user in the context' };
  return { ok: true, name: u.name || ACTOR.phone };
}

async function onEvent(ev) {
  if (ev.event_type !== 'mobile_app_notification_action' && ev.event_type !== 'hausmeister_neues_ticket') return;
  // Buttons of other apps and automations are none of our business.
  if (ev.event_type === 'mobile_app_notification_action' && !/^HAUSMEISTER_/.test(String(ev.data && ev.data.action))) return;
  const sender = await eventSender(ev);
  if (!sender.ok) { console.error(`[hausmeister] ${ev.event_type} ignored: ${sender.why}`); return; }
  if (ev.event_type === 'mobile_app_notification_action') {
    const a = L.parseNotifyAction(ev.data && ev.data.action);
    if (!a) return;
    const by = sender.name;
    let t;
    try { t = store.get(a.id); } catch { console.error(`[hausmeister] notification action for unknown ticket ${a.id}`); return; }
    const good = a.nonce && t.notify_nonce && a.nonce.length === t.notify_nonce.length
      && crypto.timingSafeEqual(Buffer.from(a.nonce), Buffer.from(t.notify_nonce));
    if (!good) { console.error(`[hausmeister] #${t.id}: notification action ${a.key} ignored, ${a.nonce ? 'outdated' : 'without'} nonce`); return; }
    try {
      const text = ev.data.reply_text;
      const to = L.applyAction(t, a.key, text);
      if (text && String(text).trim()) t.comments.push({ at: store.now(), by, text: String(text).trim() });
      if (a.key === 'sofort' && t.state !== 'umsetzen') t.direct = t.state !== 'entwurf';
      else if (a.key === 'umsetzen') t.direct = false;
      t.notify_nonce = null; // one button press per notification
      store.move(t, to, by, tr('history.via_notification', { action: L.actionLabel(a.key) }));
      if (L.ACTIONS[a.key].immediate) runner.kick([t.id], by, { checkQuota: true });
      console.log(`[hausmeister] #${t.id}: ${a.key} from the notification of ${by}`);
    } catch (e) {
      await ha.notify(tr('notify.ticket_short', { id: t.id }), tr('notify.not_done', { message: e.message }), { service: opts.notify_service, id: `hausmeister_${t.id}` });
    }
    publish().catch(() => {});
  } else if (ev.event_type === 'hausmeister_neues_ticket') {
    const d = ev.data || {};
    const mode = d.modus || d.mode || (opts.auto_draft ? 'entwurf' : 'sammeln');
    const base = { entwurf: 'entwerfen', sofort: 'entwerfen', sammeln: 'neu' }[mode];
    if (!base) { console.error(`[hausmeister] hausmeister_neues_ticket: unknown mode ${mode}`); return; }
    if (!intakeAllowed(`event "${d.titel || d.title}"`)) return;
    const s = outsideState(mode === 'sofort', base);
    const t = store.create({ title: d.titel || d.title, text: d.text || '', by: d.von || ACTOR.automation, source: 'event', state: s.state, direct: s.direct });
    if (s.note) noteImmediateIgnored(t);
    if (s.direct) runner.kick([t.id], ACTOR.automation, { checkQuota: true });
    console.log(`[hausmeister] ticket #${t.id} from an event: ${t.title}`);
    publish().catch(() => {});
  }
}

// ---- schedule --------------------------------------------------------------
function maybeInspection(key) {
  const [day, time] = key.split(' ');
  if (time !== opts.run_times[0] || !L.inspectionDue(opts.inspection_day, new Date())) return;
  if (store.data.tickets.some((t) => t.kind === 'rundgang' && t.created.slice(0, 10) === day)) return;
  const t = store.create({ title: tr('inspect.title_scheduled', { day }), text: tr('inspect.text_scheduled'), by: ACTOR.schedule, source: 'rundgang', state: 'entwerfen', kind: 'rundgang' });
  console.log(`[hausmeister] inspection #${t.id} created`);
}

async function tick() {
  for (const key of L.dueTimes(opts.run_times, new Date(), fired)) {
    fired.add(key);
    maybeInspection(key);
    console.log(`[hausmeister] scheduled run ${key}`);
    runner.cycle(`${REASON.schedule} ${key.split(' ')[1]}`).then(() => publish()).catch((e) => console.error(e));
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
  return String(req.headers['x-remote-user-display-name'] || req.headers['x-remote-user-name'] || ACTOR.unknown);
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e6) { reject(new Error(tr('err.too_large'))); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error(tr('err.no_json'))); } });
  });
}

function view(t, full) {
  const base = { id: t.id, title: t.title, state: t.state, state_label: L.stateLabel(t.state), updated: t.updated, created: t.created, created_by: t.created_by, source: t.source, kind: t.kind || 'ticket', direct: !!t.direct };
  if (!full) return { ...base, summary: (t.results[t.results.length - 1] || {}).summary || '' };
  return { ...t, ...base, actions: L.actionsFor(t), can_rollback: !!(t.snapshot && t.snapshot.post && ['umgesetzt', 'pruefen', 'erledigt', 'fehler'].includes(t.state)) };
}

function proxyTtyd(req, res) {
  const p = http.request({ host: '127.0.0.1', port: TTYD_PORT, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  p.on('error', () => send(res, 502, tr('err.terminal_unreachable'), 'text/plain; charset=utf-8'));
  req.pipe(p);
}

const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

async function route(req, res) {
  // Only the ingress gateway of the Supervisor (and loopback); other add-ons in the
  // internal network reach port 8099 as well.
  if (!policy.ingressAllowed(req.socket && req.socket.remoteAddress)) {
    console.error(`[hausmeister] request from ${req.socket && req.socket.remoteAddress} refused`);
    return send(res, 403, { error: tr('err.forbidden') });
  }
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (p.startsWith('/terminal')) return proxyTtyd(req, res);
  if (req.method === 'GET' && STATIC[p]) {
    const f = path.join(PUBLIC, STATIC[p]);
    return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)]);
  }
  try {
    if (req.method === 'GET' && p === '/api/i18n') {
      return send(res, 200, { lang: i18n.language(), locale: i18n.locale(), dict: i18n.boardDict() });
    }
    if (req.method === 'GET' && p === '/api/state') {
      return send(res, 200, {
        tickets: store.data.tickets.map((t) => view(t, false)).sort((a, b) => b.updated.localeCompare(a.updated)),
        runs: store.data.runs.slice(0, 30).map((r) => ({ ...r, reason_label: L.reasonLabel(r.reason), by_label: L.actorLabel(r.by) })), busy: runner.busy, current: runner.current && { ...runner.current, steps: runner.current.steps.slice(-15) }, logged_in: runner.loggedIn(),
        suggestions: (store.data.suggestions || []).slice().reverse(), kategorien: L.categories(),
        inspecting: store.data.tickets.some((t) => t.kind === 'rundgang' && ['entwerfen', 'in_arbeit'].includes(t.state)),
        quota: store.data.quota || null, max_quota_percent: opts.max_quota_percent, quota_blocked: runner.quotaBlocked(), watchdog: store.data.watchdog || null,
        next_run: L.nextRun(opts.run_times, new Date()), options: { run_times: opts.run_times, auto_draft: opts.auto_draft, intake_todo: opts.intake_todo },
        states: L.states(), lang: i18n.language(),
        actors: Object.fromEntries(Object.values(ACTOR).map((a) => [a, L.actorLabel(a)])),
        quiet_actors: [ACTOR.todo, ACTOR.automation, ACTOR.schedule, ACTOR.unknown], schedule_actor: ACTOR.schedule,
      });
    }
    let m = /^\/api\/tickets\/(\d+)$/.exec(p);
    if (req.method === 'GET' && m) return send(res, 200, view(store.get(m[1]), true));
    if (req.method === 'POST' && p === '/api/tickets') {
      const b = await readBody(req);
      const mode = b.mode || (b.draft === false ? 'sammeln' : 'entwurf');
      if (!['entwurf', 'sofort', 'sammeln'].includes(mode)) throw new Error(tr('err.unknown_mode', { mode }));
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
        if (!String(b.text || '').trim()) throw new Error(tr('err.comment_empty'));
        store.comment(t, who(req), b.text);
      } else if (m[2] === 'edit') {
        // A draft belongs to the text it was made for; approving it after an edit would
        // implement something else than what was written.
        if (t.state === 'entwurf') throw new Error(tr('err.edit_draft'));
        if (!['neu', 'rueckfrage', 'fehler'].includes(t.state)) throw new Error(tr('err.edit_locked'));
        if (b.title !== undefined) { if (!String(b.title).trim()) throw new Error(tr('err.title_missing')); t.title = String(b.title).trim().slice(0, 200); }
        if (b.text !== undefined) t.text = String(b.text);
        store.touch(t);
      } else if (m[2] === 'rollback') {
        await runner.rollback(t, who(req));
      } else {
        if (t.state === 'in_arbeit') throw new Error(tr('err.ticket_busy'));
        const to = L.applyAction(t, b.action, b.comment);
        if (b.comment && String(b.comment).trim()) t.comments.push({ at: store.now(), by: who(req), text: String(b.comment).trim() });
        // Implementing an approved draft vs. planning and implementing in one go.
        if (b.action === 'sofort' && t.state !== 'umsetzen') t.direct = t.state !== 'entwurf';
        else if (b.action === 'umsetzen' || b.action === 'entwerfen') t.direct = false;
        store.move(t, to, who(req), L.actionLabel(b.action));
        if (L.ACTIONS[b.action].immediate) runner.kick([t.id], who(req));
      }
      publish().catch(() => {});
      return send(res, 200, view(t, true));
    }
    if (req.method === 'POST' && p === '/api/run') {
      if (runner.busy) throw new Error(tr('err.run_busy'));
      runner.cycle(REASON.manual, who(req)).then(() => publish()).catch((e) => console.error(e));
      return send(res, 200, { started: true });
    }
    if (req.method === 'POST' && p === '/api/inspect') {
      if (store.data.tickets.some((t) => t.kind === 'rundgang' && ['entwerfen', 'in_arbeit'].includes(t.state))) throw new Error(tr('err.inspect_busy'));
      const t = store.create({ title: tr('inspect.title_manual', { date: new Date().toLocaleDateString(i18n.locale()) }), text: tr('inspect.text_manual'), by: who(req), source: 'rundgang', state: 'entwerfen', kind: 'rundgang' });
      runner.kick([t.id], who(req));
      publish().catch(() => {});
      return send(res, 200, { started: true, id: t.id });
    }
    m = /^\/api\/suggestions\/(\d+)$/.exec(p);
    if (req.method === 'POST' && m) {
      const x = store.suggestion(m[1]);
      const b = await readBody(req);
      if (b.action === 'ablehnen' || b.action === 'wieder' || b.action === 'erledigt') {
        if (b.action !== 'wieder' && x.state !== 'offen') throw new Error(tr('err.suggestion_decided'));
        if (b.action === 'wieder' && !['abgelehnt', 'erledigt'].includes(x.state)) throw new Error(tr('err.suggestion_restore'));
        x.state = b.action === 'wieder' ? 'offen' : b.action === 'ablehnen' ? 'abgelehnt' : 'erledigt';
        x.decided = store.now();
        x.decided_by = who(req);
        store.save();
        return send(res, 200, x);
      }
      if (!['entwurf', 'sofort', 'sammeln'].includes(b.action)) throw new Error(tr('err.unknown_action', { action: b.action }));
      if (x.state !== 'offen') throw new Error(tr('err.suggestion_decided'));
      const text = [x.text, x.reason ? tr('suggestion.reason_in_ticket', { reason: x.reason }) : ''].filter(Boolean).join('\n\n');
      const state = { entwurf: 'entwerfen', sofort: 'umsetzen', sammeln: 'neu' }[b.action];
      const t = store.create({ title: x.title, text, by: who(req), source: 'rundgang', state, direct: b.action === 'sofort' });
      Object.assign(x, { state: 'uebernommen', ticket: t.id, decided: store.now(), decided_by: who(req) });
      store.save();
      if (b.action === 'sofort') runner.kick([t.id], who(req));
      publish().catch(() => {});
      return send(res, 200, { suggestion: x, ticket: t.id });
    }
    if (req.method === 'POST' && p === '/api/cancel') return send(res, 200, { cancelled: runner.cancel() });
    if (req.method === 'GET' && p === '/api/backups') return send(res, 200, await git.log(50));
    return send(res, 404, { error: tr('err.not_found') });
  } catch (e) {
    return send(res, 400, { error: e.message });
  }
}

const server = http.createServer((req, res) => { route(req, res).catch((e) => send(res, 500, { error: e.message })); });

// WebSocket of the terminal (ttyd) through ingress.
function onUpgrade(req, sock, head) {
  if (!policy.ingressAllowed(req.socket && req.socket.remoteAddress)) {
    console.error(`[hausmeister] terminal connection from ${req.socket && req.socket.remoteAddress} refused`);
    sock.destroy();
    return;
  }
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
}
server.on('upgrade', onUpgrade);

async function main() {
  await git.init();
  await proxy.ensure();
  try { prepareRights(); } catch (e) { console.error('[hausmeister] rights:', e.message); }
  await startTerminal();
  try { const self = await ha.sup('GET', '/addons/self/info'); opts.panel_url = `/${self.slug}`; } catch { /* outside the Supervisor */ }
  server.listen(PORT, () => console.log(`[hausmeister] board on port ${PORT}, runs at ${opts.run_times.join(', ')}`));
  await ha.waitForCore();
  await applyLanguage();
  writeRuntimeFiles();
  console.log(`[hausmeister] language ${i18n.language()} (option ${opts.language})`);
  await publish().catch(() => {});
  await runner.backup(REASON.start);
  ha.subscribe(['mobile_app_notification_action', 'hausmeister_neues_ticket'], (ev) => { onEvent(ev).catch((e) => console.error('[hausmeister] event:', e.message)); });
  setInterval(() => { tick().catch((e) => console.error(e)); }, 30000);
  setInterval(() => { intake().catch((e) => console.error(e)); }, 60000);
  setInterval(() => {
    // The language of Home Assistant can change at any time.
    applyLanguage().then((changed) => { if (changed) writeRuntimeFiles(); }).catch(() => {});
    publish().catch(() => {});
  }, 15 * 60000);
  intake().catch(() => {});
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = {
  route, onUpgrade, store, runner, proxy, opts, onEvent, deps, resetAuthCache, intake, maybeInspection, applyLanguage, writeRuntimeFiles, exportWissen,
  prepareRights, rightsPaths, terminalEnv, terminalArgs, startTerminal,
};
