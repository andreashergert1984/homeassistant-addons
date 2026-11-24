#!/usr/bin/env node
'use strict';
// Command line access to Home Assistant for Claude.
// Called as "ha-read" (read only, used while drafting) or "ha-api" (read and write).

const path = require('path');
const ha = require('../lib/ha');
const i18n = require('../lib/i18n');

// Language of the server that started Claude (HM_LANG), English otherwise.
i18n.setLanguage(process.env.HM_LANG || 'en');
const tr = i18n.t;

const MODE = process.env.HA_TOOL_MODE || (path.basename(process.argv[1]).includes('read') ? 'read' : 'write');

const READ_WS = [
  /^get_(states|config|services|panels)$/, /\/list$/, /^lovelace\/(config|resources)$/, /^search\/related$/,
  /^history\/history_during_period$/, /^logbook\/get_events$/,
  /^recorder\/(statistics_during_period|list_statistic_ids|get_statistics_metadata)$/, /^energy\/get_prefs$/,
  /^manifest\/(list|get)$/, /^config_entries\/get$/, /^auth\/current_user$/, /^todo\/item\/list$/,
  /^config\/(entity|device)_registry\/get$/, /^system_health\/info$/, /^repairs\/list_issues$/, /^trace\/get$/,
];

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

const out = (v) => process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}\n`);

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  switch (cmd) {
    case 'states': {
      const list = await ha.core('GET', '/states');
      const f = a[0];
      return out(list.filter((s) => !f || s.entity_id.includes(f)).map((s) => `${s.entity_id}\t${s.state}\t${s.attributes.friendly_name || ''}`).join('\n'));
    }
    case 'state': if (!a[0]) usage(); return out(await ha.core('GET', `/states/${a[0]}`));
    case 'get': if (!a[0]) usage(); return out(await ha.core('GET', a[0].startsWith('/') ? a[0] : `/${a[0]}`));
    case 'template': if (!a[0]) usage(); return out(await ha.core('POST', '/template', { template: a.join(' ') }, { text: true }));
    case 'log': {
      const n = Number(a[0] || 200);
      const txt = await ha.sup('GET', '/core/logs', undefined, { text: true });
      return out(String(txt).split('\n').slice(-n).join('\n'));
    }
    case 'check': return out(await ha.checkConfig());
    case 'ws': {
      if (!a[0]) usage();
      if (MODE === 'read' && !READ_WS.some((r) => r.test(a[0]))) { console.error(tr('cli.ws_not_allowed', { type: a[0] })); process.exit(3); }
      return out(await ha.ws(a[0], parseJson(a[1])));
    }
    case 'rest': {
      if (MODE === 'read') { console.error(tr('cli.not_in_draft')); process.exit(3); }
      if (a.length < 2) usage();
      return out(await ha.core(a[0].toUpperCase(), a[1].startsWith('/') ? a[1] : `/${a[1]}`, a[2] === undefined ? undefined : parseJson(a[2])));
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
      await ha.sup('POST', '/core/restart', undefined, { timeoutMs: 600000 }).catch(() => null);
      const ok = await ha.waitForCore();
      return out(ok ? tr('cli.restarted') : tr('cli.not_reachable'));
    }
    default: usage();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
