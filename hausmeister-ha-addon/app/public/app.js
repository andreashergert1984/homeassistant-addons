'use strict';
// Board of the Hausmeister add-on. All URLs are relative because the page runs behind ingress.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null;
let openId = null;

const GROUPS = [
  { title: 'Wartet auf dich', states: ['rueckfrage', 'pruefen', 'fehler', 'entwurf', 'umgesetzt'] },
  { title: 'In der Schlange', states: ['in_arbeit', 'umsetzen', 'entwerfen'] },
  { title: 'Neu', states: ['neu'] },
  { title: 'Abgeschlossen', states: ['erledigt', 'zurueckgerollt', 'verworfen'], closed: true },
];
const TONE = { rueckfrage: 'warn', pruefen: 'bad', fehler: 'bad', entwurf: 'warn', umgesetzt: 'warn', erledigt: 'ok' };

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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

function badge(t) { return `<span class="badge ${TONE[t.state] || ''}">${esc(t.state_label)}</span>`; }

function renderStatus() {
  const s = state;
  const cur = s.current ? `läuft gerade: #${s.current.id} (${s.current.phase === 'umsetzen' ? 'Umsetzung' : 'Entwurf'})` : '';
  $('#status').innerHTML = [
    s.logged_in ? '<span class="badge ok">Claude angemeldet</span>' : '<span class="badge bad">Claude nicht angemeldet</span>',
    `<span>Nächster Lauf: ${esc(s.next_run)}</span>`,
    cur ? `<span class="badge warn">${esc(cur)}</span>` : '',
    `<button id="runnow" ${s.busy ? 'disabled' : ''}>Jetzt ausführen</button>`,
    s.busy ? '<button id="cancel" class="danger">Lauf abbrechen</button>' : '',
  ].join(' ');
  $('#runnow').onclick = async () => { try { await api('api/run', {}); await load(); } catch (e) { alert(e.message); } };
  if ($('#cancel')) $('#cancel').onclick = async () => { if (confirm('Den laufenden Claude-Aufruf abbrechen?')) { await api('api/cancel', {}); await load(); } };
}

function renderList() {
  const html = GROUPS.map((g) => {
    const items = state.tickets.filter((t) => g.states.includes(t.state));
    if (!items.length) return '';
    const cards = items.map((t) => `<div class="card" data-id="${t.id}"><div class="t">#${t.id} ${esc(t.title)}</div><div class="s">${badge(t)} ${fmt(t.updated)}${t.summary ? ` · ${esc(t.summary)}` : ''}</div></div>`).join('');
    return g.closed ? `<details class="group"><summary>${g.title} (${items.length})</summary>${cards}</details>` : `<div class="group"><h2>${g.title} (${items.length})</h2>${cards}</div>`;
  }).join('');
  $('#list').innerHTML = html || '<p class="hint">Noch keine Tickets. Lege eins an oder schreib es auf die To-do-Liste „Hausmeister“.</p>';
  document.querySelectorAll('.card').forEach((c) => { c.onclick = () => openTicket(Number(c.dataset.id)); });
}

function resultBox(r) {
  const title = r.phase === 'umsetzen' ? 'Umsetzung' : r.phase === 'rueckrollung' ? 'Rückrollung' : 'Entwurf';
  const alarm = r.watch && r.watch.length;
  return `<div class="box ${alarm ? 'alarm' : ''}"><div class="meta">${title} vom ${fmt(r.at)} · ${esc(r.kind)}${r.turns ? ` · ${r.turns} Schritte` : ''}</div>
    ${r.summary ? `<p><strong>${esc(r.summary)}</strong></p>` : ''}
    ${r.question ? `<p class="badge warn">Rückfrage</p><p>${esc(r.question)}</p>` : ''}
    ${r.details ? `<div class="md">${md(r.details)}</div>` : ''}
    ${r.test ? `<h3>So prüfst du es</h3><div class="md">${md(r.test)}</div>` : ''}
    ${r.changed && r.changed.length ? `<p class="meta">Geänderte Dateien laut Sicherung: ${esc(r.changed.join(', '))}</p>` : ''}
    ${r.api && r.api.length ? `<p class="meta">Über die API geändert: ${esc(r.api.join(', '))}</p>` : ''}
    ${alarm ? `<h3>Wächter</h3><ul>${r.watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${r.message ? `<p class="meta">Meldung: ${esc(r.message)}</p>` : ''}
    ${r.backup_error ? `<p class="meta">HA-Sicherung vorher nicht möglich: ${esc(r.backup_error)}</p>` : ''}</div>`;
}

async function openTicket(id) {
  openId = id;
  const t = await api(`api/tickets/${id}`);
  const results = [...t.results].reverse().map(resultBox).join('');
  const comments = t.comments.map((c) => `<div class="box"><div class="meta">${esc(c.by)} · ${fmt(c.at)}</div>${esc(c.text)}</div>`).join('');
  const needs = t.actions.some((a) => a.comment);
  $('#detail').innerHTML = `<button class="back">← Zur Liste</button>
    <h2>#${t.id} ${esc(t.title)}</h2><div>${badge(t)} <span class="meta">angelegt ${fmt(t.created)} von ${esc(t.created_by)}</span></div>
    ${t.text ? `<div class="box md">${md(t.text)}</div>` : ''}
    <div class="actions">${t.actions.map((a) => `<button data-a="${a.key}" class="${a.key === 'umsetzen' || a.key === 'abnehmen' ? 'primary' : a.key === 'verwerfen' ? 'danger' : ''}">${esc(a.label)}</button>`).join('')}
      ${t.can_rollback ? '<button id="rollback" class="danger">Zurückrollen</button>' : ''}</div>
    <label>${needs ? 'Kommentar (für Antwort und Nachbessern nötig)' : 'Kommentar'}<textarea id="comment" rows="3"></textarea></label>
    <button id="addcomment">Nur kommentieren</button>
    ${results ? `<h2>Ergebnisse</h2>${results}` : ''}
    ${comments ? `<h2>Kommentare</h2>${comments}` : ''}
    <details><summary>Verlauf</summary><table>${t.history.map((h) => `<tr><td>${fmt(h.at)}</td><td>${esc(h.by)}</td><td>${esc(state.states[h.to] || h.to)}${h.note ? `<br><span class="meta">${esc(h.note)}</span>` : ''}</td></tr>`).join('')}</table></details>`;
  $('#list').hidden = true;
  $('#detail').hidden = false;
  $('#detail .back').onclick = closeTicket;
  document.querySelectorAll('#detail [data-a]').forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'umsetzen' && !confirm('Claude setzt den Entwurf beim nächsten Lauf um. Vorher wird gesichert. Freigeben?')) return;
      if (a === 'verwerfen' && !confirm('Ticket verwerfen?')) return;
      try { await api(`api/tickets/${id}/action`, { action: a, comment: $('#comment').value }); await load(); await openTicket(id); } catch (e) { alert(e.message); }
    };
  });
  $('#addcomment').onclick = async () => { try { await api(`api/tickets/${id}/comment`, { text: $('#comment').value }); await openTicket(id); } catch (e) { alert(e.message); } };
  if ($('#rollback')) {
    $('#rollback').onclick = async () => {
      if (!confirm('Die Dateien, die diese Umsetzung geändert hat, auf den Stand davor zurücksetzen? Dafür wird Home Assistant neu gestartet (bei Dashboards und Helfern kurz gestoppt).')) return;
      try { await api(`api/tickets/${id}/rollback`, {}); await load(); await openTicket(id); } catch (e) { alert(e.message); }
    };
  }
}

function closeTicket() { openId = null; $('#detail').hidden = true; $('#list').hidden = false; }

function renderRuns() {
  $('#runs').innerHTML = state.runs.length ? `<table><tr><th>Zeit</th><th>Anlass</th><th>Ergebnis</th></tr>${state.runs.map((r) => `<tr><td>${fmt(r.at)}</td><td>${esc(r.reason)}${r.by && r.by !== 'Zeitplan' ? ` (${esc(r.by)})` : ''}</td><td>${r.tickets.map((x) => `#${x.id} ${esc(x.phase === 'umsetzen' ? 'Umsetzung' : 'Entwurf')}: ${esc(x.kind)}`).join('<br>')}${r.note ? `<span class="meta">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</table>` : '<p class="hint">Noch keine Läufe.</p>';
}

async function renderBackups() {
  try {
    const list = await api('api/backups');
    $('#backups').innerHTML = `<table>${list.map((b) => `<tr><td>${fmt(b.at)}</td><td>${esc(b.msg)}</td><td class="meta">${esc(b.id.slice(0, 8))}</td></tr>`).join('')}</table>`;
  } catch (e) { $('#backups').textContent = e.message; }
}

function renderLogin() {
  $('#loginhint').innerHTML = state.logged_in
    ? '<p>Claude ist angemeldet. Das Terminal brauchst du nur, um die Anmeldung zu erneuern oder etwas nachzusehen.</p>'
    : '<p><strong>Anmelden:</strong> im Terminal unten <code>claude</code> eingeben, dann <code>/login</code>, „Claude account with subscription“ wählen, den Link im Browser öffnen, den Code zurück ins Terminal kopieren. Danach mit <code>/exit</code> beenden.</p>';
  if (!$('#term').src) $('#term').src = 'terminal/';
}

async function load() {
  state = await api('api/state');
  renderStatus();
  renderList();
  renderRuns();
}

document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('main > section').forEach((s) => { s.hidden = s.id !== `tab-${b.dataset.tab}`; });
    if (b.dataset.tab === 'sicherungen') renderBackups();
    if (b.dataset.tab === 'anmeldung') renderLogin();
    if (b.dataset.tab === 'tickets') closeTicket();
  };
});

$('#newform').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const t = await api('api/tickets', { title: f.elements.title.value, text: f.elements.text.value, draft: f.elements.draft.checked });
    f.reset();
    await load();
    document.querySelector('nav button[data-tab="tickets"]').click();
    await openTicket(t.id);
  } catch (err) { alert(err.message); }
};

load().catch((e) => { $('#list').textContent = e.message; });
setInterval(() => { if (!document.hidden) load().then(() => { if (openId && !$('#detail').hidden && !document.activeElement.matches('textarea')) openTicket(openId); }).catch(() => {}); }, 15000);
