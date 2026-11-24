'use strict';
// Local proxy between the helpers for Claude (ha-read, ha-api) and Home Assistant.
// Claude never gets the SUPERVISOR_TOKEN. Each Claude call gets a random token for its phase:
// "read" (draft, inspection) or "write" (implementation). The proxy only listens on 127.0.0.1
// and enforces lib/policy.js:
//   read:  GET below /core/api (plus template and configuration check), WebSocket allowlist, core log
//   write: /core/api and WebSocket without hassio.*, shell_command.*, homeassistant.stop,
//          config/auth*, auth/*, supervisor/*, our own events; never the Supervisor API.
//   both:  POST /hm/cfg-git runs cfg-git as root with the same argument checks (lib/cfggit.js),
//          so the draft user needs no access to /data/configgit.

const http = require('http');
const crypto = require('crypto');
const ha = require('./ha');
const policy = require('./policy');
const cfggit = require('./cfggit');

function createProxy(backend = {}) {
  const be = {
    core: (method, sub, bodyText) => ha.raw(ha.CORE, method, sub, bodyText),
    ws: (type, payload) => ha.ws(type, payload),
    log: () => ha.sup('GET', '/core/logs', undefined, { text: true }),
    cfgGit: (argv) => cfggit.run(argv),
    ...backend,
  };
  const tokens = new Map();
  let server = null;
  let url = '';

  const reply = (res, code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  const deny = (res, why) => { console.error(`[hausmeister] proxy refused: ${why}`); reply(res, 403, { message: `hausmeister proxy: ${why}` }); };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let b = '';
      req.on('data', (d) => { b += d; if (b.length > 5e6) { reject(new Error('too large')); req.destroy(); } });
      req.on('end', () => resolve(b));
      req.on('error', reject);
    });
  }

  async function handle(req, res) {
    const auth = /^Bearer (.+)$/.exec(String(req.headers.authorization || ''));
    const entry = auth && tokens.get(auth[1]);
    if (!entry) return reply(res, 401, { message: 'hausmeister proxy: unknown token' });
    const { mode } = entry;
    const method = String(req.method || 'GET').toUpperCase();
    const p = String(req.url || '').split('?')[0];
    const body = await readBody(req);

    if (p === '/ws' && method === 'POST') {
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch { return reply(res, 400, { message: 'no JSON' }); }
      const type = String(msg.type || '');
      const payload = msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload) ? msg.payload : {};
      const ok = mode === 'read' ? policy.readWsAllowed(type) : !policy.wsWriteDenied(type, payload);
      if (!ok) return deny(res, `${mode} ws ${type}`);
      try { return reply(res, 200, JSON.stringify(await be.ws(type, payload))); } catch (e) { return reply(res, 502, { message: e.message }); }
    }
    if (p === '/hm/log' && method === 'GET') {
      try { return reply(res, 200, String(await be.log()), 'text/plain; charset=utf-8'); } catch (e) { return reply(res, 502, { message: e.message }); }
    }
    if (p === '/hm/cfg-git' && method === 'POST') {
      let msg;
      try { msg = JSON.parse(body || '{}'); } catch { return reply(res, 400, { message: 'no JSON' }); }
      if (!Array.isArray(msg.args) || msg.args.some((a) => typeof a !== 'string')) return reply(res, 400, { message: 'args must be a list of strings' });
      try {
        const r = await be.cfgGit(msg.args);
        if (r.refused) console.error(`[hausmeister] proxy refused: cfg-git ${r.refused} ${r.arg || ''}`.trim());
        return reply(res, r.refused ? 403 : 200, r);
      } catch (e) { return reply(res, 502, { message: e.message }); }
    }
    const sub = policy.corePath(req.url);
    if (sub === null) return deny(res, `${mode} ${method} ${p}`);
    if (!policy.restAllowed(mode, method, sub)) return deny(res, `${mode} ${method} /core/api${sub}`);
    const query = String(req.url).includes('?') ? `?${String(req.url).split('?').slice(1).join('?')}` : '';
    try {
      const r = await be.core(method, sub + query, body);
      return reply(res, r.status, r.text, r.type);
    } catch (e) { return reply(res, 502, { message: e.message }); }
  }

  return {
    tokens,
    handle,
    // Starts listening on 127.0.0.1 (random port) if not yet; returns the base URL.
    async ensure() {
      if (url) return url;
      server = http.createServer((req, res) => { handle(req, res).catch((e) => reply(res, 500, { message: e.message })); });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      server.unref(); // never keeps the process alive on its own
      url = `http://127.0.0.1:${server.address().port}`;
      return url;
    },
    // A fresh token for one Claude call; revoke it when the call ends. The terminal gets one
    // write token for the lifetime of the server (who: 'terminal').
    issue(mode, who = 'claude') {
      const t = crypto.randomBytes(24).toString('hex');
      tokens.set(t, { mode: mode === 'write' ? 'write' : 'read', who, at: Date.now() });
      return t;
    },
    revoke(t) { tokens.delete(t); },
    close() { if (server) server.close(); server = null; url = ''; },
    get url() { return url; },
  };
}

module.exports = { createProxy };
