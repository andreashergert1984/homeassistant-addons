// Pantry terminal: scan page and small API in front of Yuvomi's pantry API.
// No dependencies besides node. Reached through HA ingress only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TERMINAL_PORT || 8099);
const YUVOMI = process.env.YUVOMI_URL || 'http://127.0.0.1:3000';
const TOKEN = process.env.YUVOMI_API_TOKEN || '';
const OFF_ENABLED = process.env.OFF_LOOKUP !== 'false';
const STORE = process.env.TERMINAL_STORE || '/data/terminal.json';
const ALLOW_ANY = process.env.TERMINAL_ALLOW_ANY === '1';
// HA ingress proxy address; loopback for the add-on's own health checks.
const ALLOWED = new Set(['172.30.32.2', '127.0.0.1', '::1', '::ffff:172.30.32.2', '::ffff:127.0.0.1']);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

// ---------- persistence ----------
let store = { products: {}, tiles: [], nextTile: 1 };
try { store = { ...store, ...JSON.parse(fs.readFileSync(STORE, 'utf8')) }; } catch { /* first start */ }
function save() {
  const tmp = STORE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 1));
  fs.renameSync(tmp, STORE);
}

// ---------- Yuvomi ----------
async function yv(method, p, body) {
  const r = await fetch(YUVOMI + '/api/v1' + p, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || ('Yuvomi ' + r.status)), { status: r.status });
  return j;
}
const pantry = () => yv('GET', '/pantry');

const same = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
function batchesOf(items, prod) {
  return items.filter((i) => same(i.name, prod.name) && i.unit === (prod.unit || 'pcs'));
}
// First to expire goes first; batches without a date last.
function fefo(list) {
  return [...list].sort((a, b) => (a.expires_on || '9999') < (b.expires_on || '9999') ? -1 : (a.expires_on || '9999') > (b.expires_on || '9999') ? 1 : a.id - b.id);
}
const total = (list) => Math.round(list.reduce((s, i) => s + Number(i.quantity), 0) * 100) / 100;

function resolve(key) {
  if (key.startsWith('tile:')) {
    const t = store.tiles.find((x) => 'tile:' + x.id === key);
    return t ? { key, ...t } : null;
  }
  const p = store.products[key];
  return p ? { key, ...p } : null;
}

// ---------- Open Food Facts ----------
const offMiss = new Set();
async function offLookup(ean) {
  if (!OFF_ENABLED || !/^\d{8,14}$/.test(ean) || offMiss.has(ean)) return null;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_de,brands,quantity`, {
      headers: { 'User-Agent': 'YuvomiPantryTerminal/1.0 (Home Assistant add-on)' },
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    if (j.status !== 1) { offMiss.add(ean); return null; }
    const p = j.product || {};
    const nm = (p.product_name_de || p.product_name || '').trim();
    if (!nm) { offMiss.add(ean); return null; }
    const name = [p.brands ? p.brands.split(',')[0].trim() : '', nm, p.quantity || ''].filter(Boolean)
      .filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i).join(' ');
    return { name };
  } catch { return null; }
}

// ---------- operations (undo) ----------
const ops = new Map();
let opSeq = 1;
function remember(op) {
  op.id = opSeq++;
  ops.set(op.id, op);
  if (ops.size > 50) ops.delete(ops.keys().next().value);
  return op.id;
}

const daysFromNow = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 864e5);

async function opIn({ key, quantity, expires_on, location_id }) {
  const prod = resolve(key);
  if (!prod) throw Object.assign(new Error('Artikel unbekannt.'), { status: 404 });
  const q = Number(quantity) || 1;
  const loc = location_id === undefined ? (prod.location_id ?? null) : location_id;
  const { data: items } = await pantry();
  const hit = batchesOf(items, prod).find((i) => (i.expires_on || null) === (expires_on || null) && (i.location_id ?? null) === (loc ?? null));
  let op;
  if (hit) {
    await yv('PATCH', '/pantry/' + hit.id, { quantity: Number(hit.quantity) + q });
    op = { type: 'in', patched: { id: hit.id, before: Number(hit.quantity) } };
  } else {
    const { data } = await yv('POST', '/pantry', {
      name: prod.name, unit: prod.unit || 'pcs', quantity: q, expires_on: expires_on || null,
      location_id: loc, ...(prod.category ? { category: prod.category } : {}),
    });
    op = { type: 'in', created: data.id };
  }
  if (expires_on && key.indexOf('tile:') !== 0 && store.products[key]) {
    store.products[key].shelf_days = Math.max(0, daysFromNow(expires_on));
    save();
  } else if (expires_on && key.startsWith('tile:')) {
    const t = store.tiles.find((x) => 'tile:' + x.id === key);
    if (t) { t.shelf_days = Math.max(0, daysFromNow(expires_on)); save(); }
  }
  const after = total(batchesOf((await pantry()).data, prod));
  return { id: remember(op), message: `+${q} ${prod.name}`, total: after };
}

// Takes from the chosen batch first (batch_id), otherwise first to expire first.
async function opOut({ key, quantity, batch_id }) {
  const prod = resolve(key);
  if (!prod) throw Object.assign(new Error('Artikel unbekannt.'), { status: 404 });
  let need = Number(quantity) || 1;
  const { data: items } = await pantry();
  const list = fefo(batchesOf(items, prod).filter((i) => Number(i.quantity) > 0));
  if (!list.length) return { ok: false, message: `${prod.name}: nicht im Bestand`, total: 0 };
  const chosen = list.findIndex((b) => b.id === Number(batch_id));
  if (chosen > 0) list.unshift(...list.splice(chosen, 1));
  const before = list.map((b) => ({ id: b.id, q: Number(b.quantity), exp: b.expires_on }));
  const touched = [], taken = [];
  for (const b of list) {
    if (need <= 0) break;
    const take = Math.min(need, Number(b.quantity));
    const left = Math.round((Number(b.quantity) - take) * 100) / 100;
    const othersLeft = list.some((o) => o.id !== b.id && Number(o.quantity) > 0 && !touched.some((t) => t.item.id === o.id && t.deleted));
    if (left === 0 && othersLeft) {
      await yv('DELETE', '/pantry/' + b.id);
      touched.push({ item: b, deleted: true });
    } else {
      await yv('PATCH', '/pantry/' + b.id, { quantity: left });
      touched.push({ item: b, before: Number(b.quantity) });
    }
    taken.push({ q: take, exp: b.expires_on });
    need -= take;
  }
  const after = total(batchesOf((await pantry()).data, prod));
  return {
    ok: true, id: remember({ type: 'out', touched, key }), message: `-${total(taken.map((x) => ({ quantity: x.q })))} ${prod.name}`,
    total: after, short: need > 0 ? need : 0, taken, before,
  };
}

async function opCount({ key, total: target }) {
  const prod = resolve(key);
  if (!prod) throw Object.assign(new Error('Artikel unbekannt.'), { status: 404 });
  const t = Number(target);
  if (!(t >= 0)) throw Object.assign(new Error('Ungültige Menge.'), { status: 400 });
  const { data: items } = await pantry();
  const list = fefo(batchesOf(items, prod));
  const cur = total(list);
  if (t === cur) return { id: null, message: `${prod.name}: ${cur} stimmt`, total: cur };
  if (t > cur) {
    const last = list[list.length - 1];
    if (last) {
      await yv('PATCH', '/pantry/' + last.id, { quantity: Number(last.quantity) + (t - cur) });
      return { id: remember({ type: 'in', patched: { id: last.id, before: Number(last.quantity) } }), message: `${prod.name}: ${cur} → ${t}`, total: t };
    }
    const { data } = await yv('POST', '/pantry', { name: prod.name, unit: prod.unit || 'pcs', quantity: t, location_id: prod.location_id ?? null, ...(prod.category ? { category: prod.category } : {}) });
    return { id: remember({ type: 'in', created: data.id }), message: `${prod.name}: 0 → ${t}`, total: t };
  }
  const r = await opOut({ key, quantity: cur - t });
  return { ...r, message: `${prod.name}: ${cur} → ${t}` };
}

// remap: a batch that was emptied and deleted comes back under a new id.
async function opUndo(id) {
  const op = ops.get(Number(id));
  if (!op) throw Object.assign(new Error('Nicht mehr rückgängig zu machen.'), { status: 404 });
  const remap = {};
  if (op.type === 'in') {
    if (op.created) await yv('DELETE', '/pantry/' + op.created).catch(() => {});
    else await yv('PATCH', '/pantry/' + op.patched.id, { quantity: op.patched.before });
  } else {
    for (const t of op.touched) {
      if (t.deleted) {
        const b = t.item;
        const { data } = await yv('POST', '/pantry', { name: b.name, unit: b.unit, quantity: Number(b.quantity), expires_on: b.expires_on, location_id: b.location_id, category: b.category, min_quantity: b.min_quantity, notes: b.notes });
        remap[b.id] = data.id;
      } else {
        await yv('PATCH', '/pantry/' + t.item.id, { quantity: t.before });
      }
    }
  }
  ops.delete(op.id);
  return { ok: true, remap };
}

// Books a taken-out scan again with another quantity or batch.
async function opCorrect({ id, quantity, batch_id }) {
  const op = ops.get(Number(id));
  if (!op || op.type !== 'out' || !op.key) throw Object.assign(new Error('Nicht mehr zu ändern.'), { status: 404 });
  const { remap } = await opUndo(id);
  return opOut({ key: op.key, quantity, batch_id: remap[batch_id] ?? batch_id });
}

// ---------- HTTP ----------
function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e5) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolveBody(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });
}
function safeProduct(b) {
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('Name fehlt.'), { status: 400 });
  return {
    name,
    unit: ['pcs', 'g', 'kg', 'ml', 'l', 'pkg', 'can', 'bottle', 'jar', 'bag'].includes(b.unit) ? b.unit : 'pcs',
    location_id: b.location_id ? Number(b.location_id) : null,
    ...(b.category ? { category: String(b.category) } : {}),
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOW_ANY && !ALLOWED.has(req.socket.remoteAddress)) return send(res, 403, { error: 'forbidden' });
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.replace(/\/+/g, '/');

    if (p.startsWith('/api/')) {
      if (!TOKEN) return send(res, 503, { error: 'Kein API-Token gesetzt. In den Add-on-Optionen "api_token" eintragen.', setup: true });
      if (req.method === 'GET' && p === '/api/boot') {
        const list = await pantry();
        return send(res, 200, { locations: list.locations, categories: list.categories.map((c) => c.name), tiles: store.tiles, off: OFF_ENABLED });
      }
      if (req.method === 'GET' && p === '/api/lookup') {
        const key = url.searchParams.get('key') || '';
        let prod = resolve(key);
        let suggestion = null;
        if (!prod) suggestion = await offLookup(key);
        let stock = null;
        if (prod) {
          const list = batchesOf((await pantry()).data, prod);
          stock = { total: total(list), batches: fefo(list).map((b) => ({ q: Number(b.quantity), exp: b.expires_on })) };
        }
        return send(res, 200, { known: !!prod, product: prod, suggestion, stock });
      }
      const body = req.method === 'POST' ? await readBody(req) : {};
      if (req.method === 'POST' && p === '/api/product') {
        const key = String(body.key || '');
        if (!/^\d{4,14}$/.test(key)) return send(res, 400, { error: 'Ungültiger Code.' });
        store.products[key] = { ...safeProduct(body), shelf_days: store.products[key]?.shelf_days ?? null };
        save();
        return send(res, 200, { product: resolve(key) });
      }
      if (req.method === 'POST' && p === '/api/tiles') {
        const t = { id: store.nextTile++, ...safeProduct(body), shelf_days: null };
        store.tiles.push(t);
        save();
        return send(res, 200, { tile: t });
      }
      if (req.method === 'POST' && p === '/api/tiles/delete') {
        store.tiles = store.tiles.filter((t) => t.id !== Number(body.id));
        save();
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/in') return send(res, 200, await opIn(body));
      if (req.method === 'POST' && p === '/api/out') return send(res, 200, await opOut(body));
      if (req.method === 'POST' && p === '/api/count') return send(res, 200, await opCount(body));
      if (req.method === 'POST' && p === '/api/undo') return send(res, 200, await opUndo(body.id));
      if (req.method === 'POST' && p === '/api/correct') return send(res, 200, await opCorrect(body));
      return send(res, 404, { error: 'not found' });
    }

    // static
    let file = p === '/' ? '/index.html' : p;
    let root = path.join(HERE, 'public');
    if (file === '/vendor/zxing.js') { root = path.join(HERE, 'node_modules/@zxing/library/umd'); file = '/index.min.js'; }
    const full = path.normalize(path.join(root, file));
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(full).pipe(res);
  } catch (e) {
    send(res, e.status && e.status < 500 ? e.status : 502, { error: e.message });
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`[terminal] listening on ${PORT}, yuvomi ${YUVOMI}, token ${TOKEN ? 'set' : 'MISSING'}`));
