#!/usr/bin/env node
'use strict';
// Command line access to Home Assistant for Claude.
// Called as "ha-read" (read only, used while drafting) or "ha-api" (read and write).

const path = require('path');
const ha = require('../lib/ha');

const MODE = process.env.HA_TOOL_MODE || (path.basename(process.argv[1]).includes('read') ? 'read' : 'write');

const READ_WS = [
  /^get_(states|config|services|panels)$/, /\/list$/, /^lovelace\/(config|resources)$/, /^search\/related$/,
  /^history\/history_during_period$/, /^logbook\/get_events$/,
  /^recorder\/(statistics_during_period|list_statistic_ids|get_statistics_metadata)$/, /^energy\/get_prefs$/,
  /^manifest\/(list|get)$/, /^config_entries\/get$/, /^auth\/current_user$/, /^todo\/item\/list$/,
  /^config\/(entity|device)_registry\/get$/, /^system_health\/info$/,
];

function usage() {
  const common = [
    'ha-read states [muster]        Zustände, optional gefiltert (Teilstring oder Domain wie "light.")',
    'ha-read state <entity_id>      Zustand mit Attributen',
    'ha-read get <pfad>             REST GET, z. B. /config/automation/config/<id>',
    'ha-read ws <typ> [json]        WebSocket-Befehl (nur lesende Befehle)',
    'ha-read template <vorlage>     Jinja-Vorlage auswerten',
    'ha-read log [zeilen]           Log von Home Assistant Core (Vorgabe 200 Zeilen)',
    'ha-read check                  Konfiguration prüfen',
  ];
  const write = [
    'ha-api ws <typ> [json]         beliebiger WebSocket-Befehl',
    'ha-api rest <METHODE> <pfad> [json]',
    'ha-api reload <domain>         z. B. automation, script, template, core, all',
    'ha-api restart                 prüft die Konfiguration und startet Core neu',
  ];
  console.error([...common, ...(MODE === 'write' ? write : [])].join('\n'));
  process.exit(2);
}

function parseJson(s) {
  if (s === undefined) return {};
  try { return JSON.parse(s); } catch { console.error('Kein gültiges JSON:', s); process.exit(2); }
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
      if (MODE === 'read' && !READ_WS.some((r) => r.test(a[0]))) { console.error(`"${a[0]}" ist im Entwurf nicht erlaubt (nur lesende Befehle).`); process.exit(3); }
      return out(await ha.ws(a[0], parseJson(a[1])));
    }
    case 'rest': {
      if (MODE === 'read') { console.error('Im Entwurf nicht erlaubt.'); process.exit(3); }
      if (a.length < 2) usage();
      return out(await ha.core(a[0].toUpperCase(), a[1].startsWith('/') ? a[1] : `/${a[1]}`, a[2] === undefined ? undefined : parseJson(a[2])));
    }
    case 'reload': {
      if (MODE === 'read') { console.error('Im Entwurf nicht erlaubt.'); process.exit(3); }
      const d = a[0];
      if (!d) usage();
      const svc = d === 'core' ? 'homeassistant/reload_core_config' : d === 'all' ? 'homeassistant/reload_all' : `${d}/reload`;
      await ha.core('POST', `/services/${svc}`, {});
      return out(`neu geladen: ${svc}`);
    }
    case 'restart': {
      if (MODE === 'read') { console.error('Im Entwurf nicht erlaubt.'); process.exit(3); }
      const c = await ha.checkConfig();
      if (!c || c.result !== 'valid') { out(c); console.error('Konfiguration ungültig, kein Neustart.'); process.exit(4); }
      await ha.sup('POST', '/core/restart', undefined, { timeoutMs: 600000 }).catch(() => null);
      const ok = await ha.waitForCore();
      return out(ok ? 'Core neu gestartet und erreichbar' : 'Core nach 10 Minuten noch nicht erreichbar');
    }
    default: usage();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
