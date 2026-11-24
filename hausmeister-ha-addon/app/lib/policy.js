'use strict';
// Security rules shared by the server, the local Home Assistant proxy and the helpers for Claude.
// Pure functions without I/O, covered by test/security.test.js.

// ---- network: the board only answers the ingress gateway of the Supervisor ----------------
const INGRESS_IP = '172.30.32.2';
function ingressAllowed(addr) {
  const a = String(addr || '').replace(/^::ffff:/i, '');
  return a === INGRESS_IP || a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

// ---- read-only WebSocket commands (exact names) ---------------------------------------------
const READ_WS = new Set([
  'get_states', 'get_config', 'get_services', 'get_panels',
  'lovelace/config', 'lovelace/resources', 'lovelace/dashboards/list',
  'search/related', 'history/history_during_period', 'logbook/get_events',
  'recorder/statistics_during_period', 'recorder/list_statistic_ids', 'recorder/get_statistics_metadata',
  'energy/get_prefs', 'manifest/list', 'manifest/get', 'config_entries/get', 'auth/current_user', 'todo/item/list',
  'config/entity_registry/list', 'config/entity_registry/get', 'config/device_registry/list', 'config/device_registry/get',
  'config/area_registry/list', 'config/floor_registry/list', 'config/label_registry/list', 'config/category_registry/list',
  'system_health/info', 'repairs/list_issues', 'system_log/list', 'trace/list', 'trace/get', 'blueprint/list',
  'person/list', 'zone/list', 'tag/list', 'schedule/list', 'counter/list', 'timer/list', 'input_boolean/list',
  'input_number/list', 'input_select/list', 'input_text/list', 'input_datetime/list', 'input_button/list',
  'assist_pipeline/pipeline/list',
]);
const readWsAllowed = (type) => READ_WS.has(String(type || ''));

// ---- write mode: what stays closed even during an implementation ----------------------------
const OUR_EVENTS = ['hausmeister_neues_ticket', 'mobile_app_notification_action'];
function serviceDenied(domain, service) {
  const d = String(domain || '').toLowerCase();
  const s = String(service || '').toLowerCase();
  return d === 'hassio' || d === 'shell_command' || (d === 'homeassistant' && s === 'stop');
}
function wsWriteDenied(type, payload = {}) {
  const t = String(type || '');
  if (/^(config\/auth|auth\/|supervisor\/|hassio\/|application_credentials\/)/.test(t)) return true;
  if (t === 'execute_script') return true;
  if (t === 'call_service') return serviceDenied(payload.domain, payload.service);
  if (t === 'fire_event') return OUR_EVENTS.includes(String(payload.event_type || ''));
  return false;
}

// Path below /core/api: plain, no traversal, no encoded dots or slashes. Returns the
// part after /core/api ("/states") or null.
function corePath(rawUrl) {
  const p = String(rawUrl || '').split('?')[0];
  if (!/^\/core\/api(\/|$)/.test(p)) return null;
  if (/%2e|%2f|%5c|\\|\/\/|(^|\/)\.\.?(\/|$)/i.test(p)) return null;
  let decoded;
  try { decoded = decodeURIComponent(p); } catch { return null; }
  if (decoded !== p && /(^|\/)\.\.?(\/|$)|\\/.test(decoded)) return null;
  return p.slice('/core/api'.length) || '/';
}

// Decision of the proxy for a REST call. mode: 'read' or 'write'.
function restAllowed(mode, method, sub) {
  const m = String(method || '').toUpperCase();
  const s = String(sub || '').toLowerCase();
  if (mode === 'read') return m === 'GET' || (m === 'POST' && (s === '/template' || s === '/config/core/check_config'));
  if (mode !== 'write') return false;
  if (/^\/hassio/.test(s)) return false;
  const svc = /^\/services\/([^/]+)\/([^/]+)$/.exec(s);
  if (svc && serviceDenied(svc[1], svc[2])) return false;
  const ev = /^\/events\/([^/]+)$/.exec(s);
  if (ev && OUR_EVENTS.includes(ev[1])) return false;
  return true;
}

// ---- cfg-git: read-only git with strict arguments --------------------------------------------
const CFG_GIT_SUBS = ['log', 'diff', 'show', 'status', 'ls-files', 'blame'];
// Long options that write files, run programs, read outside the snapshots or change the repository.
// Git accepts unique abbreviations ("--out=x"), so any prefix of these is refused as well.
const CFG_GIT_DENY_LONG = ['output', 'output-directory', 'ext-diff', 'textconv', 'exec-path', 'git-dir', 'work-tree',
  'config', 'config-env', 'no-index', 'open-files-in-pager', 'upload-pack', 'contents', 'namespace', 'super-prefix'];
// Short options that are refused (-o file, -O orderfile, -c).
const CFG_GIT_DENY_SHORT = new Set(['o', 'O', 'c']);
// Short options whose value follows directly ("-n5", "-Sfoo"): the rest of the cluster is a value.
const CFG_GIT_SHORT_VALUE = new Set(['n', 'S', 'G', 'L', 'M', 'C', 'B', 'l', 'U', 'X']);
// Files that stay closed for Claude, also through the snapshots.
// Credential stores of integrations (.storage/application_credentials and other *credential* files)
// count as secrets too (0.8.3).
const SECRET_PATHS = /(^|[/:])(secrets\.yaml|\.storage\/auth[^/]*|\.storage\/core\.config_entries|\.storage\/[^/]*credential[^/]*)$/;
const WITH_NO_EXT = ['log', 'diff', 'show', 'blame'];

// Pathspecs that keep secrets out of every diff, patch, listing and log, also when no path is given.
const CFG_GIT_EXCLUDES = [':(top,exclude,glob)**/secrets.yaml', ':(top,exclude,glob).storage/auth*', ':(top,exclude).storage/core.config_entries',
  ':(top,exclude,glob).storage/*credential*'];
const WITH_EXCLUDES = ['log', 'diff', 'show', 'ls-files'];
// Options that take the next argument as their value ("-n 5", "--author x"); needed to tell
// revisions and paths apart before "--".
const CFG_GIT_LONG_VALUE = ['author', 'committer', 'grep', 'since', 'until', 'after', 'before', 'max-count', 'skip', 'min-parents', 'max-parents',
  'diff-filter', 'format', 'date', 'encoding', 'exclude', 'decorate-refs', 'decorate-refs-exclude', 'ignore-matching-lines', 'rotate-to', 'skip-to'];
const CFG_GIT_SHORT_NEXT = new Set(['n', 'S', 'G', 'L', 'I']);

// Returns { ok: true, args } with the arguments for git after the subcommand, or { ok: false, reason }.
// isRev(arg) tells whether a positional argument before "--" is a revision (the caller asks git);
// everything else is a path and moves behind "--", followed by CFG_GIT_EXCLUDES.
function cfgGitArgs(argv, isRev = () => true) {
  const [sub, ...rest] = argv;
  if (!CFG_GIT_SUBS.includes(sub)) return { ok: false, reason: 'sub' };
  let paths = false;
  let value = false;
  const head = [];
  const pathArgs = [];
  for (const a of rest) {
    const s = String(a);
    if (SECRET_PATHS.test(s)) return { ok: false, reason: 'secret', arg: s };
    if (paths) { pathArgs.push(s); continue; }
    // A value that looks like an option is checked like one (refusing too much rather than too little).
    if (value) { value = false; if (!s.startsWith('-')) { head.push(s); continue; } }
    if (s === '--') { paths = true; continue; }
    if (s === '-' || !s.startsWith('-')) {
      if (sub === 'ls-files' || (WITH_EXCLUDES.includes(sub) && !isRev(s))) pathArgs.push(s); else head.push(s);
      continue;
    }
    head.push(s);
    if (s.startsWith('--')) {
      const name = s.slice(2).split('=')[0].toLowerCase();
      if (!name) return { ok: false, reason: 'option', arg: s };
      // Negations (--no-ext-diff) only turn things off, except --no-index (files outside the snapshots).
      const deny = name.startsWith('no-') ? ['no-index'] : CFG_GIT_DENY_LONG;
      if (deny.some((d) => d.startsWith(name) || name.startsWith(d))) return { ok: false, reason: 'option', arg: s };
      if (!s.includes('=') && CFG_GIT_LONG_VALUE.includes(name)) value = true;
      continue;
    }
    const cluster = s.slice(1);
    for (const [i, ch] of [...cluster].entries()) {
      if (CFG_GIT_DENY_SHORT.has(ch)) return { ok: false, reason: 'option', arg: s };
      if (CFG_GIT_SHORT_NEXT.has(ch) && i === cluster.length - 1) value = true;
      if (CFG_GIT_SHORT_VALUE.has(ch) || CFG_GIT_SHORT_NEXT.has(ch)) break;
    }
  }
  const safety = WITH_NO_EXT.includes(sub) ? (sub === 'blame' ? ['--no-textconv'] : ['--no-ext-diff', '--no-textconv']) : [];
  if (!WITH_EXCLUDES.includes(sub)) return { ok: true, args: [sub, ...safety, ...head, ...(paths ? ['--'] : []), ...pathArgs] };
  // --follow needs exactly one pathspec; that path was checked above.
  const follow = head.includes('--follow') && pathArgs.length === 1;
  return { ok: true, args: [sub, ...safety, ...head, '--', ...pathArgs, ...(follow ? [] : CFG_GIT_EXCLUDES)] };
}

// Environment for git: no system or global configuration, no pager, no inherited repository.
function cfgGitEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env || {})) if (!/^GIT_/.test(k) && k !== 'SUPERVISOR_TOKEN' && k !== 'HASSIO_TOKEN') out[k] = v;
  return { ...out, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
}

// ---- events from outside ---------------------------------------------------------------------
const isActiveAdmin = (u) => !!u && u.is_active !== false && !u.system_generated && (u.is_admin === true || (u.group_ids || []).includes('system-admin'));

// At most `max` new tickets per window from the todo list and events. Returns the kept times
// and whether one more is allowed (and then counted).
function rateTake(times, now, max = 10, windowMs = 3600000) {
  const kept = times.filter((t) => now - t < windowMs);
  if (kept.length >= max) return { ok: false, times: kept };
  return { ok: true, times: [...kept, now] };
}

module.exports = {
  INGRESS_IP, ingressAllowed, READ_WS, readWsAllowed, OUR_EVENTS, serviceDenied, wsWriteDenied, corePath, restAllowed,
  CFG_GIT_SUBS, CFG_GIT_EXCLUDES, cfgGitArgs, cfgGitEnv, SECRET_PATHS, isActiveAdmin, rateTake,
};
