'use strict';
// Board of the Hausmeister add-on. All URLs are relative because the page runs behind ingress.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null;
let openId = null;

const GROUPS = [
  { title: 'Wartet auf dich', states: ['rueckfrage', 'pruefen', 'fehler', 'entwurf', 'umgesetzt'] },
  { title: 'In Arbeit und in der Schlange', states: ['in_arbeit', 'umsetzen', 'entwerfen'] },
  { title: 'Gesammelt', states: ['neu'] },
  { title: 'Abgeschlossen', states: ['erledigt', 'zurueckgerollt', 'verworfen'], closed: true },
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
const SOURCE = { todo: ['todo', 'To-do-Liste'], board: ['board', 'Board'], event: ['event', 'Automation'], rundgang: ['rundgang', 'Rundgang'] };
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON[k]}"/></svg>`;

function fmt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  if (s < 7 * 86400) { const d = Math.round(s / 86400); return d === 1 ? 'gestern' : `vor ${d} Tagen`; }
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

const chip = (t) => `<span class="chip ${TONE[t.state] || ''}">${esc(t.state_label)}</span>`;
function source(t) {
  if (t.kind === 'rundgang') return `<span class="src">${svg('rundgang')}Rundgang</span>`;
  const [icon, label] = SOURCE[t.source] || SOURCE.board;
  const who = t.created_by && !['To-do-Liste', 'Automation', 'Zeitplan', 'Rundgang', 'unbekannt'].includes(t.created_by) ? ` · ${esc(t.created_by)}` : '';
  return `<span class="src">${svg(icon)}${label}${who}</span>`;
}

function renderTop() {
  const s = state;
  $('#sub').textContent = s.logged_in ? `Nächster Lauf ${s.next_run}` : 'Claude ist nicht angemeldet';
  $('#topactions').innerHTML = s.busy
    ? '<button id="cancel" class="danger">Abbrechen</button>'
    : `<button id="runnow" class="primary" title="Alles, was ansteht, jetzt bearbeiten">${svg('bolt').replace('<svg', '<svg style="width:16px;height:16px;fill:currentColor;vertical-align:-3px"')} <span class="runlabel">Jetzt ausführen</span></button>`;
  if ($('#runnow')) $('#runnow').onclick = async () => { try { await api('api/run', {}); await load(); } catch (e) { alert(e.message); } };
  if ($('#cancel')) $('#cancel').onclick = async () => { if (confirm('Den laufenden Claude-Aufruf abbrechen?')) { await api('api/cancel', {}); await load(); } };
}

function renderLive() {
  const c = state.current;
  const login = !state.logged_in ? '<div class="box ask"><strong>Claude ist nicht angemeldet.</strong> Im Reiter „Anmeldung“ einloggen, sonst bleiben die Tickets liegen.</div>' : '';
  const wd = state.watchdog && (Date.now() - new Date(state.watchdog.at).getTime()) < 3 * 86400000
    ? `<div class="box alarm"><strong>Wächter ${ago(state.watchdog.at)}</strong><ul>${state.watchdog.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul><span class="meta">Nicht durch den Hausmeister verursacht. Prüfen, ob es gewollt war.</span></div>` : '';
  const live = c ? `<div class="live"><span class="pulse"></span><div class="txt"><b>Claude arbeitet an #${c.id} (${c.phase === 'umsetzen' ? 'Umsetzung' : 'Entwurf'})</b><span>${esc(c.step || 'startet')}</span></div><button data-open="${c.id}">Ansehen</button></div>` : '';
  $('#live').innerHTML = login + wd + live;
  document.querySelectorAll('#live [data-open]').forEach((b) => { b.onclick = () => openTicket(Number(b.dataset.open)); });
}

function renderStats() {
  const t = state.tickets;
  const count = (st) => t.filter((x) => st.includes(x.state)).length;
  const week = t.filter((x) => x.state === 'erledigt' && Date.now() - new Date(x.updated).getTime() < 7 * 86400000).length;
  const q = state.quota && state.quota.utilization != null ? Math.round(state.quota.utilization * 100) : null;
  const qTone = state.quota_blocked ? 'bad' : q >= 60 ? 'warn' : '';
  const qTitle = q == null ? 'Wird nach dem nächsten Lauf angezeigt' : `Auslastung des Abos (${state.quota.window}), geplante Läufe pausieren ab ${state.max_quota_percent} %${state.quota.resetsAt ? `, erneuert ${new Date(state.quota.resetsAt * 1000).toLocaleString('de-DE')}` : ''}`;
  const wait = count(GROUPS[0].states);
  $('#stats').innerHTML = [
    `<div class="stat ${wait ? 'warn' : ''}"><div class="n">${wait}</div><div class="l">warten auf dich</div></div>`,
    `<div class="stat"><div class="n">${count(GROUPS[1].states)}</div><div class="l">in Arbeit oder Schlange</div></div>`,
    `<div class="stat"><div class="n">${week}</div><div class="l">erledigt in 7 Tagen</div></div>`,
    `<div class="stat" title="${esc(qTitle)}"><div class="n">${q == null ? '–' : `${q} %`}</div><div class="l">Kontingent${state.quota_blocked ? ', Läufe pausiert' : ''}</div><div class="bar"><span class="${qTone}" style="width:${q || 0}%"></span></div></div>`,
  ].join('');
}

function renderList() {
  const html = GROUPS.map((g) => {
    const items = state.tickets.filter((t) => g.states.includes(t.state));
    if (!items.length) return '';
    const cards = items.map((t) => `<div class="card ${TONE[t.state] || ''}" data-id="${t.id}">
      <div class="t"><span class="id">#${t.id}</span><span>${esc(t.title)}</span></div>
      <div class="row">${chip(t)}${t.direct && ['umsetzen', 'in_arbeit'].includes(t.state) ? `<span class="chip info">${svg('bolt')}sofort</span>` : ''}${source(t)}<span class="meta">${ago(t.updated)}</span></div>
      ${t.summary ? `<div class="sum">${esc(t.summary)}</div>` : ''}</div>`).join('');
    const head = `<div class="ghead">${g.title}<span class="count">${items.length}</span></div>`;
    return g.closed ? `<details class="group"><summary>${head}</summary>${cards}</details>` : `<div class="group">${head}${cards}</div>`;
  }).join('');
  $('#list').innerHTML = html || `<div class="empty"><svg class="logo" viewBox="0 0 24 24"><path d="${ICON.check}"/></svg><div><strong>Alles erledigt.</strong></div><div class="hint">Neue Wünsche auf die To-do-Liste „Hausmeister“ schreiben oder hier anlegen.</div></div>`;
  document.querySelectorAll('.card').forEach((c) => { c.onclick = () => openTicket(Number(c.dataset.id)); });
}

// Progress of a ticket: collected, draft, approval, implementation, acceptance.
function stepper(t) {
  const steps = ['Eingang', 'Entwurf', 'Freigabe', 'Umsetzung', 'Abnahme'];
  const phase = t.state === 'in_arbeit' ? (t.phase === 'umsetzen' ? 'umsetzen' : 'entwerfen') : t.state;
  const at = { neu: [0, 'now'], entwerfen: [1, 'now'], rueckfrage: [t.phase === 'umsetzen' ? 3 : 1, 'wait'], entwurf: [2, 'wait'], umsetzen: [3, 'now'], fehler: [t.phase === 'umsetzen' ? 3 : 1, 'wait'], umgesetzt: [4, 'wait'], pruefen: [4, 'wait'], erledigt: [5, ''] }[phase];
  if (!at) return '';
  const skip = t.direct;
  return `<div class="stepper">${steps.map((name, i) => {
    let cls = i < at[0] ? 'done' : i === at[0] ? at[1] : '';
    if (skip && (i === 1 || i === 2) && i !== at[0]) cls = 'skip';
    const mark = cls === 'done' ? '✓' : String(i + 1);
    return `<div class="st ${cls}"><div class="c">${mark}</div><div class="l">${name}</div></div>`;
  }).join('')}</div>${at[0] < 5 ? `<div class="stepnow">Schritt ${at[0] + 1} von 5: ${steps[at[0]]}</div>` : ''}`;
}

function resultItem(r) {
  const title = r.phase === 'umsetzen' ? 'Umsetzung' : r.phase === 'rueckrollung' ? 'Rückrollung' : 'Entwurf';
  const alarm = r.watch && r.watch.length;
  const tone = alarm || r.kind === 'fehler' ? 'bad' : r.kind === 'rueckfrage' ? 'warn' : r.kind === 'umgesetzt' || r.kind === 'zurueckgerollt' ? 'ok' : '';
  const files = [...new Set([...(r.changed || []), ...(r.api || [])])];
  return `<div class="tl ${tone}"><div class="box ${alarm ? 'alarm' : ''}">
    <div class="head"><strong>${title}</strong><span class="meta">${fmt(r.at)}${r.turns ? ` · ${r.turns} Schritte` : ''}</span></div>
    ${r.summary ? `<div class="lead">${esc(r.summary)}</div>` : ''}
    ${r.question ? `<div class="box ask"><strong>Rückfrage:</strong> ${esc(r.question)}</div>` : ''}
    ${r.details ? `<div class="md">${md(r.details)}</div>` : ''}
    ${r.test ? `<h3>So prüfst du es</h3><div class="md">${md(r.test)}</div>` : ''}
    ${files.length ? `<div class="files">${files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>` : ''}
    ${r.changed_by_itself && r.changed_by_itself.length ? `<details><summary>Von Integrationen nebenbei geändert, wird nicht zurückgerollt (${r.changed_by_itself.length})</summary><div class="files">${r.changed_by_itself.map((f) => `<code>${esc(f)}</code>`).join('')}</div></details>` : ''}
    ${alarm ? `<h3>Wächter</h3><ul>${r.watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${r.log_errors && r.log_errors.length ? `<h3>Neue Fehler im HA-Log</h3><p class="meta">Prüfen, ob sie zur Änderung gehören.</p><ul>${r.log_errors.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
    ${r.created && r.created.length ? `<p>Neue Tickets aus dem Rundgang: ${r.created.map((id) => `<a href="#" data-open="${id}">#${id}</a>`).join(', ')}</p>` : ''}
    ${r.suggestions ? `<p>${r.suggestions.length} neue Vorschläge, siehe Reiter „Vorschläge“.</p>` : ''}
    ${r.message ? `<p class="meta">Meldung: ${esc(r.message)}</p>` : ''}
    ${r.backup_error ? `<p class="meta">HA-Sicherung vorher nicht möglich: ${esc(r.backup_error)}</p>` : ''}
    ${r.steps && r.steps.length ? `<details><summary>Was Claude getan hat (${r.steps.length} Schritte)</summary><ol class="steps">${r.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></details>` : ''}
  </div></div>`;
}

const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase();

async function openTicket(id) {
  openId = id;
  const t = await api(`api/tickets/${id}`);
  const last = t.results[t.results.length - 1];
  const needs = t.actions.some((a) => a.comment);
  const primary = (k) => k === 'umsetzen' || k === 'abnehmen' || k === 'antworten' || (k === 'sofort' && !t.actions.some((a) => a.key === 'umsetzen') && t.state !== 'rueckfrage');
  const running = state.current && state.current.id === t.id;
  $('#detail').innerHTML = `<button class="back">← Alle Tickets</button>
    <div class="dhead">
      <h2><span class="meta">#${t.id}</span> ${esc(t.title)}</h2>
      <div class="row">${chip(t)}${t.direct ? `<span class="chip info">${svg('bolt')}sofort</span>` : ''}${source(t)}<span class="meta">angelegt ${ago(t.created)}</span></div>
      ${t.text ? `<div class="desc md">${md(t.text)}</div>` : ''}
      ${stepper(t)}
    </div>
    ${t.state === 'rueckfrage' && last && last.question ? `<div class="box ask"><strong>Claude fragt:</strong> ${esc(last.question)}<div class="meta">Antwort unten eintragen und „Antwort senden“ drücken.</div></div>` : ''}
    ${running ? `<div class="live"><span class="pulse"></span><div class="txt"><b>Claude arbeitet gerade</b><span>${esc(state.current.step || '')}</span></div></div><ol class="steps">${state.current.steps.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ol>` : ''}
    ${t.actions.length || t.can_rollback || !running ? `<div class="box composer">
      <textarea id="comment" rows="2" placeholder="${needs ? 'Antwort oder was anders sein soll' : 'Kommentar (optional)'}"></textarea>
      <div class="row"><div class="actionbar">${t.actions.map((a) => `<button data-a="${a.key}" class="${primary(a.key) ? 'primary' : a.key === 'sofort' ? 'soft' : a.key === 'verwerfen' ? 'danger' : ''}">${esc(a.label)}</button>`).join('')}
        ${t.can_rollback ? '<button id="rollback" class="danger">Zurückrollen</button>' : ''}</div>
        <button id="addcomment">Nur kommentieren</button></div>
    </div>` : ''}
    ${t.comments.length ? `<div class="sec">Kommentare</div>${t.comments.map((c) => `<div class="comment"><div class="avatar">${esc(initials(c.by))}</div><div class="bubble"><div class="meta">${esc(c.by)} · ${ago(c.at)}</div>${esc(c.text)}</div></div>`).join('')}` : ''}
    ${t.results.length ? `<div class="sec">Verlauf der Arbeit</div><div class="timeline">${[...t.results].reverse().map(resultItem).join('')}</div>` : ''}
    <details><summary>Alle Zustandswechsel</summary><table>${t.history.map((h) => `<tr><td>${fmt(h.at)}</td><td>${esc(h.by)}</td><td>${esc(state.states[h.to] || h.to)}${h.note ? `<br><span class="meta">${esc(h.note)}</span>` : ''}</td></tr>`).join('')}</table></details>`;
  $('#list').hidden = true;
  $('#stats').hidden = true;
  $('#detail').hidden = false;
  $('#detail .back').onclick = closeTicket;
  document.querySelectorAll('#detail [data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); openTicket(Number(a.dataset.open)); }; });
  document.querySelectorAll('#detail [data-a]').forEach((b) => {
    b.onclick = async () => {
      const a = b.dataset.a;
      if (a === 'sofort' && !confirm(t.state === 'entwurf' || t.state === 'umsetzen'
        ? 'Claude setzt den Entwurf jetzt sofort um. Vorher wird gesichert. Los?'
        : 'Claude plant und setzt jetzt sofort um, ohne dass du vorher einen Entwurf siehst. Vorher wird gesichert, danach prüfen die Wächter. Los?')) return;
      if (a === 'umsetzen' && !confirm('Claude setzt den Entwurf beim nächsten Lauf um. Vorher wird gesichert. Freigeben?')) return;
      if (a === 'verwerfen' && !confirm('Ticket verwerfen?')) return;
      try { await api(`api/tickets/${id}/action`, { action: a, comment: $('#comment') ? $('#comment').value : '' }); await load(); await openTicket(id); } catch (e) { alert(e.message); }
    };
  });
  if ($('#addcomment')) $('#addcomment').onclick = async () => { try { await api(`api/tickets/${id}/comment`, { text: $('#comment').value }); await openTicket(id); } catch (e) { alert(e.message); } };
  if ($('#rollback')) {
    $('#rollback').onclick = async () => {
      if (!confirm('Die Dateien, die diese Umsetzung geändert hat, auf den Stand davor zurücksetzen? Dafür wird Home Assistant neu gestartet (bei Dashboards und Helfern kurz gestoppt).')) return;
      try { await api(`api/tickets/${id}/rollback`, {}); await load(); await openTicket(id); } catch (e) { alert(e.message); }
    };
  }
}

function closeTicket() { openId = null; $('#detail').hidden = true; $('#list').hidden = false; $('#stats').hidden = false; }

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
    ? '<div class="live" style="margin:0"><span class="pulse"></span><div class="txt"><b>Schaut sich gerade um</b><span>Das dauert ein paar Minuten.</span></div></div>'
    : `<button id="inspect" class="primary big">${svg('rundgang').replace('<svg', '<svg style="width:18px;height:18px;fill:currentColor;vertical-align:-4px"')} Jetzt umschauen</button>`;
  if ($('#inspect')) {
    $('#inspect').onclick = async () => {
      if (!confirm('Der Hausmeister schaut sich jetzt die ganze Installation an (nur lesend). Das braucht einige Minuten und etwas Kontingent. Los?')) return;
      try { await api('api/inspect', {}); await load(); } catch (e) { alert(e.message); }
    };
  }
  const card = (x, decided) => {
    const cat = state.kategorien[x.category] || x.category;
    const tone = x.benefit === 'hoch' ? 'ok' : '';
    const after = x.state === 'uebernommen' ? `<span class="chip ok">${svg('check')}als Ticket <a href="#" data-open="${x.ticket}">#${x.ticket}</a></span>`
      : x.state === 'abgelehnt' ? '<span class="chip">nicht nötig</span> <button class="ghost" data-sug="wieder">Zurückholen</button>'
        : x.state === 'erledigt' ? `<span class="chip ok">${svg('check')}selbst erledigt</span> <button class="ghost" data-sug="wieder">Zurückholen</button>` : '';
    const buttons = x.manual
      ? '<button class="primary" data-sug="erledigt">Erledigt</button><button class="ghost" data-sug="sammeln">Als Ticket merken</button><button class="ghost" data-sug="ablehnen">Nicht nötig</button>'
      : '<button class="primary" data-sug="entwurf">Als Ticket</button><button class="soft" data-sug="sofort">Sofort umsetzen</button><button class="ghost" data-sug="sammeln">Nur merken</button><button class="ghost" data-sug="ablehnen">Nicht nötig</button>';
    return `<div class="sug cat-${esc(x.category)} ${decided ? 'done-sug' : ''}" data-id="${x.id}">
      <div class="ic">${svg(ICON[x.category] ? x.category : 'wartung')}</div>
      <div class="body"><div class="t">${esc(x.title)}</div>
      <div class="row"><span class="chip">${esc(cat)}</span><span class="chip ${tone}">Nutzen ${esc(x.benefit)}</span><span class="chip">Aufwand ${esc(x.effort)}</span>${x.manual ? '<span class="chip warn">machst du selbst</span>' : ''}<span class="meta">${ago(x.created)}</span></div>
      ${x.text ? `<div class="md">${md(x.text)}</div>` : ''}
      ${x.reason ? `<div class="why"><strong>Warum:</strong> ${esc(x.reason)}</div>` : ''}
      <div class="actionbar">${decided ? after : buttons}</div>
    </div></div>`;
  };
  $('#suggestions').innerHTML = (open.length ? open.map((x) => card(x, false)).join('')
    : `<div class="empty"><svg class="logo" viewBox="0 0 24 24"><path d="${ICON.check}"/></svg><div><strong>Keine offenen Vorschläge.</strong></div><div class="hint">„Jetzt umschauen“ starten oder im Rundgang regelmäßig suchen lassen (Einstellung inspection_day).</div></div>`)
    + (done.length ? `<details class="group"><summary><div class="ghead">Entschieden<span class="count">${done.length}</span></div></summary>${done.map((x) => card(x, true)).join('')}</details>` : '');
  document.querySelectorAll('#suggestions [data-sug]').forEach((b) => {
    b.onclick = async () => {
      const id = b.closest('.sug').dataset.id;
      const a = b.dataset.sug;
      if (a === 'sofort' && !confirm('Claude plant und setzt diesen Vorschlag jetzt um, ohne Entwurf zur Freigabe. Vorher wird gesichert, danach prüfen die Wächter. Los?')) return;
      try {
        const r = await api(`api/suggestions/${id}`, { action: a });
        await load();
        if (r.ticket && a !== 'sammeln') { showTab('tickets'); await openTicket(r.ticket); }
      } catch (e) { alert(e.message); }
    };
  });
  document.querySelectorAll('#suggestions [data-open]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); showTab('tickets'); openTicket(Number(a.dataset.open)); }; });
}

function renderRuns() {
  const kind = { entwurf: 'Entwurf fertig', umgesetzt: 'umgesetzt', rueckfrage: 'Rückfrage', fehler: 'Fehler', kontingent: 'Kontingent erschöpft', anmeldung: 'Anmeldung fehlt' };
  $('#runs').innerHTML = `<h2>Läufe</h2>${state.runs.length ? `<table><tr><th>Wann</th><th>Anlass</th><th>Ergebnis</th></tr>${state.runs.map((r) => `<tr><td>${fmt(r.at)}</td><td>${esc(r.reason)}${r.by && r.by !== 'Zeitplan' ? `<br><span class="meta">${esc(r.by)}</span>` : ''}</td><td>${r.tickets.map((x) => `<a href="#" data-open="${x.id}">#${x.id}</a> ${esc(x.phase === 'umsetzen' ? 'Umsetzung' : 'Entwurf')}: ${esc(kind[x.kind] || x.kind)}`).join('<br>')}${r.note ? `<span class="meta">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}</table>` : '<p class="hint">Noch keine Läufe.</p>'}`;
  document.querySelectorAll('#runs [data-open]').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); showTab('tickets'); openTicket(Number(a.dataset.open)); };
  });
}

async function renderBackups() {
  try {
    const list = await api('api/backups');
    $('#backups').innerHTML = list.length ? `<table><tr><th>Wann</th><th>Anlass</th><th></th></tr>${list.map((b) => `<tr><td>${fmt(b.at)}</td><td>${esc(b.msg)}</td><td class="meta">${esc(b.id.slice(0, 8))}</td></tr>`).join('')}</table>` : '<p class="hint">Noch keine Sicherung.</p>';
  } catch (e) { $('#backups').textContent = e.message; }
}

function renderLogin() {
  $('#loginhint').innerHTML = state.logged_in
    ? '<h2>Anmeldung</h2><p>Claude ist angemeldet. Das Terminal brauchst du nur, um die Anmeldung zu erneuern oder etwas nachzusehen.</p>'
    : '<h2>Bei Claude anmelden</h2><ol><li>Im Terminal unten <code>claude</code> eingeben, dann <code>/login</code>.</li><li>„Claude account with subscription“ wählen und den Link im Browser öffnen.</li><li>Den Code zurück ins Terminal kopieren, dann mit <code>/exit</code> beenden.</li></ol>';
  if (!$('#term').src) $('#term').src = 'terminal/';
}

async function load() {
  state = await api('api/state');
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
    if (f.elements.mode.value === 'sofort' && !confirm('Claude plant und setzt sofort um, ohne Entwurf zur Freigabe. Vorher wird gesichert, danach prüfen die Wächter. Los?')) return;
    const t = await api('api/tickets', { title: f.elements.title.value, text: f.elements.text.value, mode: f.elements.mode.value });
    f.reset();
    await load();
    showTab('tickets');
    await openTicket(t.id);
  } catch (err) { alert(err.message); }
};

load().catch((e) => { $('#list').textContent = e.message; });
// Refresh: every 4 s while Claude works (live steps), otherwise every 15 s.
function refresh() {
  const next = () => setTimeout(refresh, state && state.busy ? 4000 : 15000);
  if (document.hidden) { next(); return; }
  load().then(() => { if (openId && !$('#detail').hidden && !document.activeElement.matches('textarea')) return openTicket(openId); return null; }).catch(() => {}).finally(next);
}
setTimeout(refresh, 4000);
