'use strict';
// Board of the Hausmeister add-on. All URLs are relative because the page runs behind ingress.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null;
let openId = null;

// Texts come from the server (GET api/i18n) in the active language; t() fills {placeholders}.
let I18N = { lang: 'en', locale: 'en-GB', dict: {} };
function t(key, vars) {
  const text = Object.prototype.hasOwnProperty.call(I18N.dict, key) ? I18N.dict[key] : key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : text;
}
async function loadI18n() {
  I18N = await api('api/i18n');
  document.documentElement.lang = I18N.lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  for (const attr of ['placeholder', 'title', 'aria-label']) {
    document.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => { el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`))); });
  }
}

const GROUPS = [
  { key: 'waiting', states: ['rueckfrage', 'pruefen', 'fehler', 'entwurf', 'umgesetzt'] },
  { key: 'queue', states: ['in_arbeit', 'umsetzen', 'entwerfen'] },
  { key: 'collected', states: ['neu'] },
  { key: 'closed', states: ['erledigt', 'zurueckgerollt', 'verworfen'], closed: true },
];
const TONE = { rueckfrage: 'warn', pruefen: 'bad', fehler: 'bad', entwurf: 'warn', umgesetzt: 'warn', erledigt: 'ok', in_arbeit: 'info', umsetzen: 'info', entwerfen: 'info' };

// Small Material Design icons (Apache 2.0), inline so nothing is loaded from outside.
const ICON = {
  todo: 'M3 5h2v2H3zm4 0h14v2H7zM3 11h2v2H3zm4 0h14v2H7zm-4 6h2v2H3zm4 0h14v2H7z',
  board: 'M20.71 7.04c.39-.39.39-1.04 0-1.41l-2.34-2.34c-.37-.39-1.02-.39-1.41 0l-1.84 1.83 3.75 3.75M3 17.25V21h3.75L17.81 9.93l-3.75-3.75z',
  event: 'M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73A2 2 0 0 1 10 4a2 2 0 0 1 2-2M7.5 13A2.5 2.5 0 0 0 5 15.5 2.5 2.5 0 0 0 7.5 18a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 7.5 13m9 0a2.5 2.5 0 0 0-2.5 2.5 2.5 2.5 0 0 0 2.5 2.5 2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z',
  rundgang: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14',
  bolt: 'M11 15H6l7-14v8h5l-7 14z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
  fehler: 'M13 13h-2V7h2m0 10h-2v-2h2M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2',
  sicherheit: 'M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11z',
  energie: 'M11 15H6l7-14v8h5l-7 14z',
  komfort: 'M12 3 2 12h3v8h6v-6h2v6h6v-8h3z',
  aufraeumen: 'M19 4h-3.5l-1-1h-5l-1 1H5v2h14M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6z',
  wartung: 'M22.7 19 13.6 9.9c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4',
};
const SOURCE = { todo: ['todo', 'source.todo'], board: ['board', 'source.board'], event: ['event', 'source.event'], rundgang: ['rundgang', 'source.rundgang'] };
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(I18N.locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return t('time.just_now');
  if (s < 3600) return t('time.minutes_ago', { n: Math.round(s / 60) });
  if (s < 86400) return t('time.hours_ago', { n: Math.round(s / 3600) });
  if (s < 7 * 86400) { const d = Math.round(s / 86400); return d === 1 ? t('time.yesterday') : t('time.days_ago', { n: d }); }
  return fmt(iso);
}

// Small, safe Markdown: escapes first, then code blocks, inline code, bold, headings, lists.
function md(src) {
  const blocks = [];
  let s = esc(src).replace(/```[a-z]*\n?([\s\S]*?)```/g, (_, c) => { blocks.push(c); return `\u0000${blocks.length - 1}\u0000`; });
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let list = false;
  for (const line of s.split('\n')) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line) || /^\s*\d+\.\s+(.*)$/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${li[1]}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (h) out.push(`<h3>${h[2]}</h3>`);
    else if (line.trim()) out.push(`<p>${line}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => `<pre>${blocks[i]}</pre>`);
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---- small UX helpers --------------------------------------------------------
// Open <details> survive the periodic re-render (otherwise they snap shut every 15 s).
const openDetails = new Set();
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.tagName === 'DETAILS' && d.dataset.k) { if (d.open) openDetails.add(d.dataset.k); else openDetails.delete(d.dataset.k); }
}, true);
function restoreDetails(root) {
  root.querySelectorAll('details[data-k]').forEach((d) => { if (openDetails.has(d.dataset.k)) d.open = true; });
}

// Unsent comments per ticket survive the re-render.
const drafts = {};

function toast(msg, tone = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, tone === 'bad' ? 6000 : 3500);
}

// Runs an action from a button: disables it meanwhile, shows errors as a toast.
async function act(btn, fn, okMsg) {
  if (btn.disabled) return;
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.classList.add('busy');
  try {
    await fn();
    if (okMsg) toast(okMsg, 'ok');
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.classList.remove('busy'); btn.innerHTML = label; }
  }
}

// Dictionary texts may mark commands with backticks.
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>');
const chip = (x) => `<span class="chip ${TONE[x.state] || ''}">${esc(x.state_label)}</span>`;
// Stored names like the schedule or the todo list are identifiers; the server sends their labels.
const actor = (name) => (state && state.actors && state.actors[name]) || name;
function source(x) {
  if (x.kind === 'rundgang') return `<span class="src">${svg('rundgang')}${esc(t('source.rundgang'))}</span>`;
  const [icon, label] = SOURCE[x.source] || SOURCE.board;
  const who = x.created_by && !(state.quiet_actors || []).includes(x.created_by) ? ` · ${esc(actor(x.created_by))}` : '';
  return `<span class="src">${svg(icon)}${esc(t(label))}${who}</span>`;
}

function renderTop() {
  const s = state;
  $('#sub').textContent = s.logged_in ? t('top.next_run', { when: s.next_run }) : t('top.not_logged_in');
  const queued = s.tickets.filter((x) => x.state === 'entwerfen' || x.state === 'umsetzen').length;
  const cur = s.current ? s.current.id : '';
  $('#topactions').innerHTML = s.busy
    ? `<button id="cancel" class="danger" title="${esc(t('top.cancel_title', { id: cur }))}">${esc(t('top.cancel'))}</button>`
    : `<button id="runnow" class="primary" ${queued ? '' : 'disabled'} title="${esc(queued ? t('top.run_title', { n: queued }) : t('top.run_empty'))}">${svg('bolt').replace('<svg', '<svg style="width:16px;height:16px;fill:currentColor;vertical-align:-3px"')} <span class="runlabel">${esc(t('top.run'))}${queued ? ` (${queued})` : ''}</span></button>`;
  if ($('#runnow')) $('#runnow').onclick = (e) => act(e.currentTarget, async () => { await api('api/run', {}); await load(); }, t('toast.run_started'));
  if ($('#cancel')) $('#cancel').onclick = (e) => { if (confirm(t('confirm.cancel', { id: cur }))) act(e.currentTarget, async () => { await api('api/cancel', {}); await load(); }, t('toast.cancelled')); };
}

function renderLive() {
  const c = state.current;
  const login = !state.logged_in ? `<div class="box ask"><strong>${esc(t('live.not_logged_in'))}</strong> ${esc(t('live.login_hint'))}</div>` : '';
  const wd = state.watchdog && (Date.now() - new Date(state.watchdog.at).getTime()) < 3 * 86400000
    ? `<div class="box alarm"><strong>${esc(t('live.watchdog', { when: ago(state.watchdog.at) }))}</strong><ul>${state.watchdog.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><span class="meta">${esc(t('live.watchdog_hint'))}</span></div>` : '';
  // In the open ticket the detail shows the live steps itself; no second strip with a "View" button.
  const here = c && openId === c.id && !$('#detail').hidden;
  const live = c && !here ? `<div class="live"><span class="pulse"></span><div class="txt"><b>${esc(t('live.working', { id: c.id, phase: t(c.phase === 'umsetzen' ? 'phase.impl' : 'phase.draft') }))}</b><span>${esc(c.step || '')}</span></div><button data-open="${c.id}">${esc(t('live.view'))}</button></div>` : '';
  $('#live').innerHTML = login + wd + live;
  document.querySelectorAll('#live [data-open]').forEach((b) => { b.onclick = () => openTicket(Number(b.dataset.open)); });
}

function renderStats() {
  const all = state.tickets;
  const count = (st) => all.filter((x) => st.includes(x.state)).length;
  const week = all.filter((x) => x.state === 'erledigt' && Date.now() - new Date(x.updated).getTime() < 7 * 86400000).length;
  const q = state.quota && state.quota.utilization != null ? Math.round(state.quota.utilization * 100) : null;
  const qTone = state.quota_blocked ? 'bad' : q >= 60 ? 'warn' : '';
  const qTitle = q == null ? t('stats.quota_unknown') : t(state.quota.resetsAt ? 'stats.quota_title_reset' : 'stats.quota_title', { window: state.quota.window, max: state.max_quota_percent, reset: state.quota.resetsAt ? new Date(state.quota.resetsAt * 1000).toLocaleString(I18N.locale) : '' });
  const wait = count(GROUPS[0].states);
  $('#stats').innerHTML = [
    `<div class="stat ${wait ? 'warn' : ''}"><div class="n">${wait}</div><div class="l">${esc(t('stats.waiting'))}</div></div>`,
    `<div class="stat"><div class="n">${count(GROUPS[1].states)}</div><div class="l">${esc(t('stats.queue'))}</div></div>`,
    `<div class="stat"><div class="n">${week}</div><div class="l">${esc(t('stats.done_week'))}</div></div>`,
    `<div class="stat" title="${esc(qTitle)}"><div class="n">${q == null ? '–' : `${q} %`}</div><div class="l">${esc(t(state.quota_blocked ? 'stats.quota_paused' : 'stats.quota'))}</div><div class="bar"><span class="${qTone}" style="width:${q || 0}%"></span></div></div>`,
  ].join('');
}

function renderList() {
  const html = GROUPS.map((g) => {
    const items = state.tickets.filter((x) => g.states.includes(x.state));
    if (!items.length) return '';
    const cards = items.map((x) => `<div class="card ${TONE[x.state] || ''}" data-id="${x.id}">
      <div class="t"><span class="id">#${x.id}</span><span>${esc(x.title)}</span></div>
      <div class="row">${chip(x)}${x.direct && ['umsetzen', 'in_arbeit'].includes(x.state) ? `<span class="chip info">${svg('bolt')}${esc(t('chip.now'))}</span>` : ''}${source(x)}<span class="meta">${ago(x.updated)}</span></div>
      ${x.summary ? `<div class="sum">${esc(x.summary)}</div>` : ''}</div>`).join('');
    const head = `<div class="ghead">${esc(t(`group.${g.key}`))}<span class="count">${items.length}</span></div>`;
    return g.closed ? `<details class="group" data-k="list-${g.key}"><summary>${head}</summary>${cards}</details>` : `<div class="group">${head}${cards}</div>`;
  }).join('');
  $('#list').innerHTML = html || `<div class="empty"><svg class="logo" viewBox="0 0 24 24"><path d="${ICON.check}"/></svg><div><strong>${esc(t('list.empty'))}</strong></div><div class="hint">${esc(t('list.empty_hint'))}</div></div>`;
  document.querySelectorAll('.card').forEach((c) => { c.onclick = () => openTicket(Number(c.dataset.id)); });
  restoreDetails($('#list'));
}

// Progress of a ticket: collected, draft, approval, implementation, acceptance.
function stepper(tk) {
  const steps = ['intake', 'draft', 'approval', 'impl', 'acceptance'].map((k) => t(`stepper.${k}`));
  const phase = tk.state === 'in_arbeit' ? (tk.phase === 'umsetzen' ? 'umsetzen' : 'entwerfen') : tk.state;
  const at = { neu: [0, 'now'], entwerfen: [1, 'now'], rueckfrage: [tk.phase === 'umsetzen' ? 3 : 1, 'wait'], entwurf: [2, 'wait'], umsetzen: [3, 'now'], fehler: [tk.phase === 'umsetzen' ? 3 : 1, 'wait'], umgesetzt: [4, 'wait'], pruefen: [4, 'wait'], erledigt: [5, ''] }[phase];
  if (!at) return '';
  const skip = tk.direct;
  return `<div class="stepper">${steps.map((name, i) => {
    let cls = i < at[0] ? 'done' : i === at[0] ? at[1] : '';
    if (skip && (i === 1 || i === 2) && i !== at[0]) cls = 'skip';
    const mark = cls === 'done' ? '✓' : String(i + 1);
    return `<div class="st ${cls}"><div class="c">${mark}</div><div class="l">${esc(name)}</div></div>`;
  }).join('')}</div>${at[0] < 5 ? `<div class="stepnow">${esc(t('stepper.now', { n: at[0] + 1, step: steps[at[0]] }))}</div>` : ''}`;
}

function resultItem(r) {
  const title = t(r.phase === 'umsetzen' ? 'phase.impl' : r.phase === 'rueckrollung' ? 'phase.rollback' : 'phase.draft');
  const alarm = r.watch && r.watch.length;
  const tone = alarm || r.kind === 'fehler' ? 'bad' : r.kind === 'rueckfrage' ? 'warn' : r.kind === 'umgesetzt' || r.kind === 'zurueckgerollt' ? 'ok' : '';
  const files = [...new Set([...(r.changed || []), ...(r.api || [])])];
  return `<div class="tl ${tone}"><div class="box ${alarm ? 'alarm' : ''}">
    <div class="head"><strong>${esc(title)}</strong><span class="meta">${fmt(r.at)}${r.turns ? ` · ${esc(t('result.turns', { n: r.turns }))}` : ''}</span></div>
    ${r.summary ? `<div class="lead">${esc(r.summary)}</div>` : ''}
    ${r.question ? `<div class="box ask"><strong>${esc(t('result.question'))}</strong> ${esc(r.question)}</div>` : ''}
    ${r.details ? `<div class="md">${md(r.details)}</div>` : ''}
    ${r.test ? `<h3>${esc(t('result.test'))}</h3><div class="md">${md(r.test)}</div>` : ''}
    ${files.length ? `<div class="files">${files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>` : ''}
    ${r.changed_by_itself && r.changed_by_itself.length ? `<details data-k="noise-${esc(r.at)}"><summary>${esc(t('result.by_itself', { n: r.changed_by_itself.length }))}</summary><div class="files">${r.changed_by_itself.map((f) => `<code>${esc(f)}</code>`).join('')}</div></details>` : ''}
    ${alarm ? `<h3>${esc(t('result.watch'))}</h3><ul>${r.watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${r.log_errors && r.log_errors.length ? `<h3>${esc(t('result.log_errors'))}</h3><p class="meta">${esc(t('result.log_errors_hint'))}</p><ul>${r.log_errors.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${r.created && r.created.length ? `<p>${esc(t('result.created'))} ${r.created.map((id) => `<a href="#" data-open="${id}">#${id}</a>`).join(', ')}</p>` : ''}
    ${r.suggestions ? `<p>${esc(t('result.suggestions', { n: r.suggestions.length }))}</p>` : ''}
    ${r.message ? `<p class="meta">${esc(t('result.message', { message: r.message }))}</p>` : ''}
    ${r.backup_error ? `<p class="meta">${esc(t('result.backup_error', { message: r.backup_error }))}</p>` : ''}
    ${r.steps && r.steps.length ? `<details data-k="steps-${esc(r.at)}"><summary>${esc(t('result.steps', { n: r.steps.length }))}</summary><ol class="steps">${r.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
  </div></div>`;
}

const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

async function openTicket(id, fromHistory) {
  if (!fromHistory && openId !== id) { try { history.pushState({ ticket: id }, ''); } catch { /* sandboxed */ } }
  openId = id;
  const tk = await api(`api/tickets/${id}`);
  const last = tk.results[tk.results.length - 1];
  const needs = tk.actions.some((a) => a.comment);
  const primary = (k) => k === 'umsetzen' || k === 'abnehmen' || k === 'antworten' || (k === 'sofort' && !tk.actions.some((a) => a.key === 'umsetzen') && tk.state !== 'rueckfrage');
  const running = state.current && state.current.id === tk.id;
  $('#detail').innerHTML = `<button class="back">← ${esc(t('detail.back'))}</button>
    <div class="dhead">
      <h2><span class="meta">#${tk.id}</span> ${esc(tk.title)}</h2>
      <div class="row">${chip(tk)}${tk.direct ? `<span class="chip info">${svg('bolt')}${esc(t('chip.now'))}</span>` : ''}${source(tk)}<span class="meta">${esc(t('detail.created', { when: ago(tk.created) }))}</span></div>
      ${tk.text ? `<div class="desc md">${md(tk.text)}</div>` : ''}
      ${tk.kind === 'rundgang' ? '' : stepper(tk)}
    </div>
    ${tk.state === 'rueckfrage' && last && last.question ? `<div class="box ask"><strong>${esc(t('detail.claude_asks'))}</strong> ${esc(last.question)}<div class="meta">${esc(t('detail.answer_hint'))}</div></div>` : ''}
    ${running ? `<div class="live"><span class="pulse"></span><div class="txt"><b>${esc(t('detail.working'))}</b><span>${esc(state.current.step || '')}</span></div></div><ol class="steps">${state.current.steps.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ol>` : ''}
    ${tk.actions.length || tk.can_rollback || !running ? `<div class="box composer">
      <textarea id="comment" rows="2" placeholder="${esc(t(needs ? 'detail.comment_needed_ph' : 'detail.comment_ph'))}"></textarea>
      <div class="row"><div class="actionbar"> ${tk.actions.map((a) => `<button data-a="${a.key}" ${a.comment ? 'data-needs="1"' : ''} class="${primary(a.key) ? 'primary' : a.key === 'sofort' ? 'soft' : a.key === 'verwerfen' ? 'danger' : ''}">${esc(a.label)}</button>`).join('')}
        ${tk.can_rollback ? `<button id="rollback" class="danger">${esc(t('detail.rollback'))}</button>` : ''}</div>
        ${tk.state === 'rueckfrage' ? '' : `<button id="addcomment">${esc(t('detail.comment_only'))}</button>`}</div>
    </div>` : ''}
    ${tk.comments.length ? `<div class="sec">${esc(t('detail.comments'))}</div>${tk.comments.map((c) => `<div class="comment"><div class="avatar">${esc(initials(actor(c.by)))}</div><div class="bubble"><div class="meta">${esc(actor(c.by))} · ${ago(c.at)}</div>${esc(c.text)}</div></div>`).join('')}` : ''}
    ${tk.results.length ? `<div class="sec">${esc(t('detail.work'))}</div><div class="timeline">${[...tk.results].reverse().map(resultItem).join('')}</div>` : ''}
    <details data-k="history"><summary>${esc(t('detail.history'))}</summary><table>${tk.history.map((h) => `<tr><td>${fmt(h.at)}</td><td>${esc(actor(h.by))}</td><td>${esc(state.states[h.to] || h.to)}${h.note ? `<br><span class="meta">${esc(h.note)}</span>` : ''}</td></tr>`).join('')}</table></details>`;
  $('#list').hidden = true;
  $('#stats').hidden = true;
  $('#detail').hidden = false;
  renderLive();
  $('#detail .back').onclick = closeTicket;
  document.querySelectorAll('#detail [data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openTicket(Number(a.dataset.open)); }; });
  document.querySelectorAll('#detail [data-a]').forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.a;
      if (b.disabled) return;
      if (a === 'sofort' && !confirm(t(tk.state === 'entwurf' || tk.state === 'umsetzen' ? 'confirm.now_draft' : 'confirm.now_direct'))) return;
      if (a === 'umsetzen' && !confirm(t('confirm.approve'))) return;
      if (a === 'verwerfen' && !confirm(t('confirm.discard'))) return;
      await act(b, async () => { await api(`api/tickets/${id}/action`, { action: a, comment: $('#comment') ? $('#comment').value : '' }); delete drafts[id]; await load(); await openTicket(id); }, t(`toast.action.${a}`));
    };
  });
  const ta = $('#comment');
  const sync = () => {
    const has = !!(ta && ta.value.trim());
    document.querySelectorAll('#detail [data-a]').forEach((b) => { if (b.dataset.needs) { b.disabled = !has; b.title = has ? '' : t('detail.needs_text'); } });
    if ($('#addcomment')) $('#addcomment').disabled = !has;
  };
  if (ta) {
    ta.value = drafts[id] || '';
    ta.oninput = () => { drafts[id] = ta.value; sync(); };
    sync();
  }
  if ($('#addcomment')) $('#addcomment').onclick = (e) => act(e.currentTarget, async () => { await api(`api/tickets/${id}/comment`, { text: ta.value }); delete drafts[id]; await openTicket(id); }, t('toast.comment_saved'));
  restoreDetails($('#detail'));
  if ($('#rollback')) {
    $('#rollback').onclick = async () => {
      if (!confirm(t('confirm.rollback'))) return;
      await act($('#rollback'), async () => { await api(`api/tickets/${id}/rollback`, {}); await load(); await openTicket(id); }, t('toast.rolled_back'));
    };
  }
}

// Back button of the browser or the HA app closes the ticket instead of the panel.
window.addEventListener('popstate', (e) => {
  if (e.state && e.state.ticket) openTicket(e.state.ticket, true).catch(() => {});
  else if (openId) closeTicket();
});

function closeTicket() { openId = null; $('#detail').hidden = true; $('#list').hidden = false; $('#stats').hidden = false; if (state) renderLive(); }

const BENEFIT = { hoch: 0, mittel: 1, gering: 2 };
const EFFORT = { klein: 0, mittel: 1, gross: 2 };

function renderSuggestions() {
  const all = state.suggestions || [];
  const open = all.filter((x) => x.state === 'offen').sort((a, b) => (BENEFIT[a.benefit] - BENEFIT[b.benefit]) || (EFFORT[a.effort] - EFFORT[b.effort]));
  const done = all.filter((x) => x.state !== 'offen');
  const c = $('#sugcount');
  c.hidden = !open.length;
  c.textContent = open.length;
  $('#inspectbox').innerHTML = state.inspecting
    ? `<div class="live" style="margin:0"><span class="pulse"></span><div class="txt"><b>${esc(t('sug.inspecting'))}</b><span>${esc(t('sug.inspecting_hint'))}</span></div></div>`
    : `<button id="inspect" class="primary big">${svg('rundgang').replace('<svg', '<svg style="width:18px;height:18px;fill:currentColor;vertical-align:-4px"')} ${esc(t('sug.inspect'))}</button>`;
  if ($('#inspect')) {
    $('#inspect').onclick = async () => {
      if (!confirm(t('confirm.inspect'))) return;
      await act($('#inspect'), async () => { await api('api/inspect', {}); await load(); }, t('toast.inspecting'));
    };
  }
  const card = (x, decided) => {
    const cat = state.kategorien[x.category] || x.category;
    const tone = x.benefit === 'hoch' ? 'ok' : '';
    const btn = (cls, a, key) => `<button class="${cls}" data-sug="${a}">${esc(t(key))}</button>`;
    const after = x.state === 'uebernommen' ? `<span class="chip ok">${svg('check')}${esc(t('sug.as_ticket_chip'))} <a href="#" data-open="${x.ticket}">#${x.ticket}</a></span>`
      : x.state === 'abgelehnt' ? `<span class="chip">${esc(t('sug.declined_chip'))}</span> ${btn('ghost', 'wieder', 'sug.restore')}`
        : x.state === 'erledigt' ? `<span class="chip ok">${svg('check')}${esc(t('sug.done_chip'))}</span> ${btn('ghost', 'wieder', 'sug.restore')}` : '';
    const buttons = x.manual
      ? btn('primary', 'erledigt', 'sug.done') + btn('ghost', 'sammeln', 'sug.keep_ticket') + btn('ghost', 'ablehnen', 'sug.decline')
      : btn('primary', 'entwurf', 'sug.as_ticket') + btn('soft', 'sofort', 'sug.now') + btn('ghost', 'sammeln', 'sug.keep') + btn('ghost', 'ablehnen', 'sug.decline');
    return `<div class="sug cat-${esc(x.category)} ${decided ? 'done-sug' : ''}" data-id="${x.id}">
      <div class="ic">${svg(ICON[x.category] ? x.category : 'wartung')}</div>
      <div class="body"><div class="t">${esc(x.title)}</div>
      <div class="row"><span class="chip">${esc(cat)}</span><span class="chip ${tone}">${esc(t('sug.benefit', { level: t(`level.${x.benefit}`) }))}</span><span class="chip">${esc(t('sug.effort', { level: t(`level.${x.effort}`) }))}</span>${x.manual ? `<span class="chip warn">${esc(t('sug.manual'))}</span>` : ''}<span class="meta">${ago(x.created)}</span></div>
      ${x.text ? `<div class="md">${md(x.text)}</div>` : ''}
      ${x.reason ? `<div class="why"><strong>${esc(t('sug.why'))}</strong> ${esc(x.reason)}</div>` : ''}
      <div class="actionbar">${decided ? after : buttons}</div>
    </div></div>`;
  };
  $('#suggestions').innerHTML = (open.length ? open.map((x) => card(x, false)).join('')
    : `<div class="empty"><svg class="logo" viewBox="0 0 24 24"><path d="${ICON.check}"/></svg><div><strong>${esc(t('sug.empty'))}</strong></div><div class="hint">${esc(t('sug.empty_hint'))}</div></div>`)
    + (done.length ? `<details class="group" data-k="sug-done"><summary><div class="ghead">${esc(t('sug.decided'))}<span class="count">${done.length}</span></div></summary>${done.map((x) => card(x, true)).join('')}</details>` : '');
  document.querySelectorAll('#suggestions [data-sug]').forEach((b) => {
    b.onclick = async () => {
      const id = b.closest('.sug').dataset.id;
      const a = b.dataset.sug;
      if (a === 'sofort' && !confirm(t('confirm.sug_now'))) return;
      await act(b, async () => {
        const r = await api(`api/suggestions/${id}`, { action: a });
        await load();
        if (r.ticket && a !== 'sammeln') { showTab('tickets'); await openTicket(r.ticket); }
      }, t(`toast.sug.${a}`));
    };
  });
  restoreDetails($('#suggestions'));
  document.querySelectorAll('#suggestions [data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); showTab('tickets'); openTicket(Number(a.dataset.open)); }; });
}

function renderRuns() {
  const kind = (k) => (I18N.dict[`kind.${k}`] !== undefined ? t(`kind.${k}`) : k);
  $('#runs').innerHTML = `<h2>${esc(t('runs.heading'))}</h2>${state.runs.length ? `<table><tr><th>${esc(t('table.when'))}</th><th>${esc(t('table.reason'))}</th><th>${esc(t('runs.result'))}</th></tr>${state.runs.map((r) => `<tr><td>${fmt(r.at)}</td><td>${esc(r.reason_label || r.reason)}${r.by && r.by !== state.schedule_actor ? `<br><span class="meta">${esc(r.by_label || r.by)}</span>` : ''}</td><td>${r.tickets.map((x) => `<a href="#" data-open="${x.id}">#${x.id}</a> ${esc(t(x.phase === 'umsetzen' ? 'phase.impl' : 'phase.draft'))}: ${esc(kind(x.kind))}`).join('<br>')}${r.note ? `<span class="meta">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</table>` : `<p class="hint">${esc(t('runs.empty'))}</p>`}`;
  document.querySelectorAll('#runs [data-open]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); showTab('tickets'); openTicket(Number(a.dataset.open)); };
  });
}

async function renderBackups() {
  try {
    const list = await api('api/backups');
    $('#backups').innerHTML = list.length ? `<table><tr><th>${esc(t('table.when'))}</th><th>${esc(t('table.reason'))}</th><th></th></tr>${list.map((b) => `<tr><td>${fmt(b.at)}</td><td>${esc(b.msg)}</td><td class="meta">${esc(b.id.slice(0, 8))}</td></tr>`).join('')}</table>` : `<p class="hint">${esc(t('backups.empty'))}</p>`;
  } catch (e) { $('#backups').textContent = e.message; }
}

function renderLogin() {
  $('#loginhint').innerHTML = state.logged_in
    ? `<h2>${esc(t('login.heading'))}</h2><p>${esc(t('login.ok'))}</p>`
    : `<h2>${esc(t('login.heading_todo'))}</h2><ol><li>${inline(t('login.step1'))}</li><li>${inline(t('login.step2'))}</li><li>${inline(t('login.step3'))}</li></ol>`;
  if (!$('#term').src) $('#term').src = 'terminal/';
}

let offline = false;
async function load() {
  try {
    state = await api('api/state');
    if (offline) { offline = false; toast(t('toast.online'), 'ok'); }
  } catch (e) {
    if (!offline) { offline = true; toast(t('toast.offline', { message: e.message }), 'bad'); }
    throw e;
  }
  // The language follows Home Assistant and can change while the board is open.
  if (state.lang && state.lang !== I18N.lang) await loadI18n();
  renderTop();
  renderLive();
  renderStats();
  renderList();
  renderRuns();
  renderSuggestions();
}

function showTab(tab) {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== `tab-${tab}`; });
  $('#fab').hidden = tab === 'neu';
  if (tab === 'sicherungen') renderBackups();
  if (tab === 'anmeldung') renderLogin();
  if (tab === 'tickets') closeTicket();
}
document.querySelectorAll('nav button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
$('#fab').onclick = () => { showTab('neu'); $('#newform').elements.title.focus(); };

$('#newform').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    if (f.elements.mode.value === 'sofort' && !confirm(t('confirm.new_now'))) return;
    const created = await api('api/tickets', { title: f.elements.title.value, text: f.elements.text.value, mode: f.elements.mode.value });
    f.reset();
    await load();
    showTab('tickets');
    await openTicket(created.id);
  } catch (err) { toast(err.message, 'bad'); }
};

loadI18n().catch(() => {}).then(load).catch((e) => { $('#list').textContent = e.message; });
// Refresh: every 4 s while Claude works (live steps), otherwise every 15 s.
function refresh() {
  const next = () => setTimeout(refresh, state && state.busy ? 4000 : 15000);
  if (document.hidden) { next(); return; }
  load().then(() => { if (openId && !$('#detail').hidden && !document.activeElement.matches('textarea')) return openTicket(openId); return null; }).catch(() => {}).finally(next);
}
setTimeout(refresh, 4000);
