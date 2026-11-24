'use strict';
// Access to Home Assistant Core and the Supervisor from inside the add-on.
// The server uses the SUPERVISOR_TOKEN that the Supervisor injects (homeassistant_api / hassio_api).
// The helpers for Claude (ha-read, ha-api) never see that token: they get HM_PROXY_URL and a
// one-time HM_PROXY_TOKEN and talk to the local proxy of the server (lib/proxy.js).

const i18n = require('./i18n');

const CORE = process.env.HA_CORE_URL || 'http://supervisor/core/api';
const CORE_WS = process.env.HA_CORE_WS || 'ws://supervisor/core/websocket';
const SUP = process.env.HA_SUPERVISOR_URL || 'http://supervisor';
const PROXY = process.env.HM_PROXY_URL || '';

function token() {
  const t = PROXY ? process.env.HM_PROXY_TOKEN : process.env.SUPERVISOR_TOKEN;
  if (!t) throw new Error(i18n.t('err.no_token'));
  return t;
}

// Plain forwarding for the proxy: status and body as they are.
async function raw(base, method, path, bodyText, { timeoutMs = 60000 } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN || ''}`, 'Content-Type': 'application/json' },
    body: bodyText === undefined || bodyText === '' || method === 'GET' || method === 'HEAD' ? undefined : bodyText,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') || 'application/json' };
}

async function request(base, method, path, body, { text = false, timeoutMs = 60000 } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${raw.slice(0, 300)}`);
  if (text) return raw;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

const core = (method, path, body, opts) => request(PROXY ? `${PROXY}/core/api` : CORE, method, path, body, opts);

async function sup(method, path, body, opts) {
  if (PROXY) throw new Error(i18n.t('err.proxy_no_supervisor'));
  const r = await request(SUP, method, path, body, opts);
  if (r && typeof r === 'object' && 'result' in r) {
    if (r.result !== 'ok') throw new Error(`Supervisor ${path}: ${r.message || r.result}`);
    return r.data;
  }
  return r;
}

// One WebSocket command per connection: simple and robust against core restarts.
function ws(type, payload = {}, { timeoutMs = 60000 } = {}) {
  if (PROXY) return request(PROXY, 'POST', '/ws', { type, payload }, { timeoutMs });
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(CORE_WS);
    const timer = setTimeout(() => { try { sock.close(); } catch { /* ignore */ } reject(new Error(i18n.t('err.ws_timeout', { type }))); }, timeoutMs);
    const done = (fn, v) => { clearTimeout(timer); try { sock.close(); } catch { /* ignore */ } fn(v); };
    sock.onerror = () => done(reject, new Error(i18n.t('err.ws_failed', { type })));
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: token() }));
      else if (m.type === 'auth_invalid') done(reject, new Error(i18n.t('err.ws_auth')));
      else if (m.type === 'auth_ok') sock.send(JSON.stringify({ ...payload, id: 1, type }));
      else if (m.id === 1 && m.type === 'result') {
        if (m.success) done(resolve, m.result);
        else done(reject, new Error(`WS ${type}: ${m.error && (m.error.message || m.error.code)}`));
      }
    };
  });
}

// Long-lived event subscription with reconnect (core restarts, network).
function subscribe(eventTypes, onEvent) {
  let stopped = false;
  let sock = null;
  const connect = () => {
    if (stopped) return;
    let id = 0;
    sock = new WebSocket(CORE_WS);
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: token() }));
      else if (m.type === 'auth_ok') for (const t of eventTypes) sock.send(JSON.stringify({ id: ++id, type: 'subscribe_events', event_type: t }));
      else if (m.type === 'event' && m.event) { try { onEvent(m.event); } catch (e) { console.error('[hausmeister] event:', e.message); } }
    };
    sock.onclose = () => { if (!stopped) setTimeout(connect, 10000); };
    sock.onerror = () => { try { sock.close(); } catch { /* reconnect via onclose */ } };
  };
  connect();
  return () => { stopped = true; try { sock.close(); } catch { /* ignore */ } };
}

// Log of Home Assistant Core (Supervisor), through the proxy for the helpers.
function coreLog() {
  return PROXY ? request(PROXY, 'GET', '/hm/log', undefined, { text: true }) : sup('GET', '/core/logs', undefined, { text: true });
}

async function coreReachable() {
  try { await core('GET', '/', undefined, { timeoutMs: 5000 }); return true; } catch { return false; }
}

async function waitForCore(maxMs = 10 * 60000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    if (await coreReachable()) return true;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function states() {
  const list = await core('GET', '/states');
  return Object.fromEntries(list.map((s) => [s.entity_id, s.state]));
}

async function checkConfig() {
  return core('POST', '/config/core/check_config');
}

// Persistent notification plus optional push; actions become buttons in the mobile app.
async function notify(title, message, { service, id, actions, url } = {}) {
  try {
    await core('POST', '/services/persistent_notification/create', { title, message, notification_id: id || 'hausmeister' });
  } catch (e) { console.error('[hausmeister] notification failed:', e.message); }
  if (service) {
    const [domain, name] = service.split('.');
    const data = { tag: id || 'hausmeister', group: 'hausmeister' };
    if (url) Object.assign(data, { url, clickAction: url });
    if (actions && actions.length) data.actions = actions;
    try { await core('POST', `/services/${domain}/${name}`, { title, message, data }); } catch (e) { console.error(`[hausmeister] ${service} failed:`, e.message); }
  }
}

async function setSensor(entityId, state, attributes) {
  try { await core('POST', `/states/${entityId}`, { state, attributes }); } catch (e) { console.error(`[hausmeister] ${entityId}:`, e.message); }
}

module.exports = { core, sup, ws, raw, coreLog, CORE, SUP, subscribe, states, checkConfig, notify, setSensor, waitForCore, coreReachable };
