'use strict';
// Ticket store: /data/state.json is the source of truth (atomic writes),
// /share/hausmeister/tickets/<nr>-<titel>.md is a readable copy for each ticket.

const fs = require('fs');
const path = require('path');
const { STATES, slug } = require('./logic');

class Store {
  constructor(file, docDir) {
    this.file = file;
    this.docDir = docDir;
    this.data = { next_id: 1, tickets: [], runs: [] };
    if (fs.existsSync(file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    // A restart in the middle of a run leaves tickets "in_arbeit": hand them back to the queue.
    for (const t of this.data.tickets) {
      if (t.state === 'in_arbeit') this._move(t, t.phase || 'entwerfen', 'Hausmeister', 'Lauf wurde unterbrochen (Neustart), Ticket wieder eingereiht');
    }
    this.save();
  }

  save() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  now() { return new Date().toISOString(); }

  get(id) {
    const t = this.data.tickets.find((x) => x.id === Number(id));
    if (!t) throw new Error(`Ticket ${id} gibt es nicht`);
    return t;
  }

  create({ title, text, by, state = 'neu', source = 'board', direct = false }) {
    title = String(title || '').trim();
    if (!title) throw new Error('Titel fehlt');
    const t = {
      id: this.data.next_id++, title: title.slice(0, 200), text: String(text || '').trim(), state,
      phase: ['entwerfen', 'umsetzen'].includes(state) ? state : null, created: this.now(), updated: this.now(), created_by: by || 'unbekannt', source,
      comments: [], history: [{ at: this.now(), to: state, by: by || 'unbekannt' }], results: [],
      session_id: null, snapshot: null, watch: null, direct: !!direct,
    };
    this.data.tickets.push(t);
    this.touch(t);
    return t;
  }

  _move(t, to, by, note) {
    t.history.push({ at: this.now(), from: t.state, to, by, note });
    t.state = to;
    if (to === 'entwerfen' || to === 'umsetzen') t.phase = to;
  }

  move(t, to, by, note) { this._move(t, to, by, note); this.touch(t); }

  comment(t, by, text) {
    t.comments.push({ at: this.now(), by, text: String(text).trim() });
    this.touch(t);
  }

  touch(t) {
    t.updated = this.now();
    this.save();
    this.writeDoc(t);
  }

  addRun(run) {
    this.data.runs.unshift(run);
    this.data.runs = this.data.runs.slice(0, 300);
    this.save();
  }

  writeDoc(t) {
    if (!this.docDir) return;
    try {
      fs.mkdirSync(this.docDir, { recursive: true });
      const name = `${String(t.id).padStart(4, '0')}-${slug(t.title)}.md`;
      for (const f of fs.readdirSync(this.docDir)) {
        if (f.startsWith(`${String(t.id).padStart(4, '0')}-`) && f !== name) fs.unlinkSync(path.join(this.docDir, f));
      }
      const lines = [`# #${t.id} ${t.title}`, '', `Zustand: ${STATES[t.state] || t.state}  `, `Angelegt: ${t.created} von ${t.created_by}`, ''];
      if (t.text) lines.push('## Beschreibung', '', t.text, '');
      for (const r of t.results) {
        lines.push(`## ${r.phase === 'umsetzen' ? 'Umsetzung' : 'Entwurf'} vom ${r.at} (${r.kind})`, '');
        if (r.summary) lines.push(r.summary, '');
        if (r.details) lines.push(r.details, '');
        if (r.question) lines.push(`**Rückfrage:** ${r.question}`, '');
        if (r.files && r.files.length) lines.push(`Geänderte Dateien: ${r.files.join(', ')}`, '');
        if (r.watch && r.watch.length) lines.push('**Wächter:**', ...r.watch.map((w) => `- ${w}`), '');
        if (r.message) lines.push(`Meldung: ${r.message}`, '');
      }
      if (t.comments.length) {
        lines.push('## Kommentare', '');
        for (const c of t.comments) lines.push(`- ${c.at} ${c.by}: ${c.text}`);
        lines.push('');
      }
      lines.push('## Verlauf', '', ...t.history.map((h) => `- ${h.at} ${h.by}: ${h.from ? `${h.from} → ` : ''}${h.to}${h.note ? ` (${h.note})` : ''}`), '');
      fs.writeFileSync(path.join(this.docDir, name), lines.join('\n'));
    } catch (e) {
      console.error('[hausmeister] Ticketdoku nicht geschrieben:', e.message);
    }
  }
}

module.exports = { Store };
