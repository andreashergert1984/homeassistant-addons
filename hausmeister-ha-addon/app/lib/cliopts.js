'use strict';
// Built-in filters of ha-read and ha-api, so drafts get by without jq, grep, head or wc
// (0.8.2: the shell of a draft opens no files). Pure functions, tested without Home Assistant.

// Splits the arguments into positional ones and the options --count, --json, --fields a,b and
// --pick <path>. Returns { pos, count, json, fields, pick } or { error } for a broken option.
function parseOpts(argv) {
  const o = { pos: [], count: false, json: false, fields: null, pick: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a;
    const inline = a.startsWith('--') && eq > 0 ? a.slice(eq + 1) : undefined;
    const value = () => {
      const v = inline !== undefined ? inline : argv[++i];
      if (v === undefined || v === '') return null;
      return v;
    };
    if (name === '--count') o.count = true;
    else if (name === '--json') o.json = true;
    else if (name === '--fields') {
      const v = value();
      if (v === null) return { error: '--fields' };
      o.fields = v.split(',').map((f) => f.trim()).filter(Boolean);
      if (!o.fields.length) return { error: '--fields' };
    } else if (name === '--pick') {
      const v = value();
      if (v === null) return { error: '--pick' };
      o.pick = v;
    } else o.pos.push(a);
  }
  return o;
}

// Path like "data.0.entity_id", "attributes.friendly_name" or "*.entity_id" ("*" maps over the
// entries of a list or the values of an object; [n] is the same as .n). Missing parts give undefined.
function splitPath(p) {
  return String(p).replace(/\[(\d+|\*)\]/g, '.$1').split('.').filter((x) => x !== '');
}
function pick(value, p) {
  const parts = Array.isArray(p) ? p : splitPath(p);
  if (!parts.length) return value;
  const [head, ...rest] = parts;
  if (value === null || value === undefined) return undefined;
  if (head === '*') {
    const items = Array.isArray(value) ? value : typeof value === 'object' ? Object.values(value) : [];
    return items.map((v) => pick(v, rest));
  }
  if (typeof value !== 'object') return undefined;
  return pick(value[head], rest);
}

// Only the given fields (dotted paths allowed) of an object, under their full path as key.
function selectFields(obj, fields) {
  const r = {};
  for (const f of fields) r[f] = pick(obj, f);
  return r;
}

const cell = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// Shapes a result according to the options: --pick first, then --fields (on a list of objects or
// one object), then --count (number of entries of a list, keys of an object, 1 otherwise).
// Returns a string for the output; text is the default, --json gives JSON.
function shape(value, o) {
  let v = o.pick ? pick(value, o.pick) : value;
  if (o.fields) v = Array.isArray(v) ? v.map((x) => selectFields(x, o.fields)) : (v && typeof v === 'object' ? selectFields(v, o.fields) : v);
  if (o.count) {
    const n = Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : v === undefined ? 0 : 1;
    return String(n);
  }
  if (o.json) return JSON.stringify(v === undefined ? null : v, null, 1);
  if (o.fields && Array.isArray(v)) return v.map((x) => o.fields.map((f) => cell(x[f])).join('\t')).join('\n');
  if (o.fields && v && typeof v === 'object') return o.fields.map((f) => cell(v[f])).join('\t');
  if (typeof v === 'string') return v;
  if (v === undefined) return '';
  if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) return v.map(cell).join('\n');
  return JSON.stringify(v, null, 1);
}

// ha-read states [pattern]: substring of the entity_id (e.g. "light." for a domain). Without
// options the known lines "entity_id<TAB>state<TAB>friendly_name".
function states(list, pattern, o) {
  const hit = list.filter((s) => !pattern || s.entity_id.includes(pattern));
  if (!o.count && !o.json && !o.fields && !o.pick) return hit.map((s) => `${s.entity_id}\t${s.state}\t${s.attributes.friendly_name || ''}`).join('\n');
  return shape(hit, o);
}

module.exports = { parseOpts, pick, selectFields, shape, states };
