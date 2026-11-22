'use strict';
// Access to Home Assistant Core and the Supervisor from inside the add-on.
// Uses the SUPERVISOR_TOKEN that the Supervisor injects (homeassistant_api / hassio_api).

const CORE = process.env.HA_CORE_URL || 'http://supervisor/core/api';
const CORE_WS = process.env.HA_CORE_WS || 'ws://supervisor/core/websocket';
const SUP = process.env.HA_SUPERVISOR_URL || 'http://supervisor';

function token() {
  const t = process.env.SUPERVISOR_TOKEN;
  if (!t) throw new Error('SUPERVISOR_TOKEN fehlt (läuft das nicht als Add-on?)');
  return t;
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

const core = (method, path, body, opts) => request(CORE, method, path, body, opts);

async function sup(method, path, body, opts) {
  const r = await request(SUP, method, path, body, opts);
  if (r && typeof r === 'object' && 'result' in r) {
    if (r.result !== 'ok') throw new Error(`Supervisor ${path}: ${r.message || r.result}`);
    return r.data;
  }
  return r;
}

// One WebSocket command per connection: simple and robust against core restarts.
function ws(type, payload = {}, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(CORE_WS);
    const timer = setTimeout(() => { try { sock.close(); } catch { /* ignore */ } reject(new Error(`WS ${type}: Zeitüberschreitung`)); }, timeoutMs);
    const done = (fn, v) => { clearTimeout(timer); try { sock.close(); } catch { /* ignore */ } fn(v); };
    sock.onerror = () => done(reject, new Error(`WS ${type}: Verbindung fehlgeschlagen`));
    sock.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'auth_required') sock.send(JSON.stringify({ type: 'auth', access_token: token() }));
      else if (m.type === 'auth_invalid') done(reject, new Error('WS: Anmeldung abgelehnt'));
      else if (m.type === 'auth_ok') sock.send(JSON.stringify({ id: 1, type, ...payload }));
      else if (m.id === 1 && m.type === 'result') {
        if (m.success) done(resolve, m.result);
        else done(reject, new Error(`WS ${type}: ${m.error && (m.error.message || m.error.code)}`));
      }
    };
  });
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

async function notify(title, message, { service, id } = {}) {
  try {
    await core('POST', '/services/persistent_notification/create', { title, message, notification_id: id || 'hausmeister' });
  } catch (e) { console.error('[hausmeister] Benachrichtigung fehlgeschlagen:', e.message); }
  if (service) {
    const [domain, name] = service.split('.');
    try { await core('POST', `/services/${domain}/${name}`, { title, message }); } catch (e) { console.error(`[hausmeister] ${service} fehlgeschlagen:`, e.message); }
  }
}

async function setSensor(entityId, state, attributes) {
  try { await core('POST', `/states/${entityId}`, { state, attributes }); } catch (e) { console.error(`[hausmeister] ${entityId}:`, e.message); }
}

module.exports = { core, sup, ws, states, checkConfig, notify, setSensor, waitForCore, coreReachable };
