#!/usr/bin/env node
'use strict';
// Command line access to Home Assistant for Claude.
// Called as "ha-read" (read only, used while drafting) or "ha-api" (read and write).
// Under Claude it talks to the local proxy of the server (HM_PROXY_URL), which enforces the
// same rules again; the SUPERVISOR_TOKEN is not available there.

const path = require('path');
const ha = require('../lib/ha');
const i18n = require('../lib/i18n');
const policy = require('../lib/policy');

// Language of the server that started Claude (HM_LANG), English otherwise.
i18n.setLanguage(process.env.HM_LANG || 'en');
const tr = i18n.t;

const MODE = process.env.HA_TOOL_MODE || (path.basename(process.argv[1]).includes('read') ? 'read' : 'write');


function usage() {
  const common = ['states', 'state', 'get', 'ws', 'template', 'log', 'check'].map((k) => tr(`cli.usage.${k}`));
  const write = ['ws_write', 'rest', 'reload', 'restart'].map((k) => tr(`cli.usage.${k}`));
  console.error([...common, ...(MODE === 'write' ? write : [])].join('\n'));
  process.exit(2);
}

function parseJson(s) {
  if (s === undefined) return {};
  try { return JSON.parse(s); } catch { console.error(tr('cli.invalid_json', { json: s })); process.exit(2); }
}

// Paths below /api: no traversal (checked again by the proxy).
function apiPath(raw) {
  const p = raw.startsWith('/') ? raw : `/${raw}`;
  if (policy.corePath(`/core/api${p}`) === null) { console.error(tr('cli.path_not_allowed', { path: raw })); process.exit(3); }
  return p;
}

const out = (v) => process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  switch (cmd) {
    case 'states': {
      const list = await ha.core('GET', '/states');
      const f = a[0];
      return out(list.filter((s) => !f || s.entity_id.includes(f)).map((s) => `${s.entity_id}\t${s.state}\t${s.attributes.friendly_name || ''}`).join('\n'));
    }
    case 'state': if (!a[0]) usage(); return out(await ha.core('GET', apiPath(`/states/${a[0]}`)));
    case 'get': if (!a[0]) usage(); return out(await ha.core('GET', apiPath(a[0])));
    case 'template': if (!a[0]) usage(); return out(await ha.core('POST', '/template', { template: a.join(' ') }, { text: true }));
    case 'log': {
      const n = Number(a[0] || 200);
      const txt = await ha.coreLog();
      return out(String(txt).split('\n').slice(-n).join('\n'));
    }
    case 'check': return out(await ha.checkConfig());
    case 'ws': {
      if (!a[0]) usage();
      if (MODE === 'read' && !policy.readWsAllowed(a[0])) { console.error(tr('cli.ws_not_allowed', { type: a[0] })); process.exit(3); }
      return out(await ha.ws(a[0], parseJson(a[1])));
    }
    case 'rest': {
      if (MODE === 'read') { console.error(tr('cli.not_in_draft')); process.exit(3); }
      if (a.length < 2) usage();
      return out(await ha.core(a[0].toUpperCase(), apiPath(a[1]), a[2] === undefined ? undefined : parseJson(a[2])));
    }
    case 'reload': {
      if (MODE === 'read') { console.error(tr('cli.not_in_draft')); process.exit(3); }
      const d = a[0];
      if (!d) usage();
      const svc = d === 'core' ? 'homeassistant/reload_core_config' : d === 'all' ? 'homeassistant/reload_all' : `${d}/reload`;
      await ha.core('POST', `/services/${svc}`, {});
      return out(tr('cli.reloaded', { service: svc }));
    }
    case 'restart': {
      if (MODE === 'read') { console.error(tr('cli.not_in_draft')); process.exit(3); }
      const c = await ha.checkConfig();
      if (!c || c.result !== 'valid') { out(c); console.error(tr('cli.config_invalid')); process.exit(4); }
      // Through the core service (the Supervisor API is closed for Claude); on Home Assistant OS
      // the hassio integration hands it to the Supervisor. The call ends when Core goes down.
      await ha.core('POST', '/services/homeassistant/restart', {}, { timeoutMs: 600000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 15000));
      const ok = await ha.waitForCore();
      return out(ok ? tr('cli.restarted') : tr('cli.not_reachable'));
    }
    default: usage();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
