'use strict';
// One run: backup snapshot, then the queued tickets one after another.

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ha = require('./ha');
const git = require('./git');
const L = require('./logic');

const WORK_DIR = process.env.HM_WORK_DIR || '/data/work';
const SHARE = process.env.HM_SHARE_DIR || '/share/hausmeister';
const CLAUDE = process.env.HM_CLAUDE_BIN || 'claude';

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash(ha-read:*)', 'Bash(cfg-git:*)', 'Bash(jq:*)', 'Bash(grep:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(ls:*)',
  'Bash(echo:*)', 'Bash(printf:*)', 'Bash(cat:*)', 'Bash(sort:*)', 'Bash(uniq:*)', 'Bash(cut:*)', 'Bash(tr:*)', 'Bash(date:*)'];
const WRITE_TOOLS = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash'];

const SCALE = Number(process.env.HM_TIME_SCALE || 1); // tests shorten the waits
const sleep = (ms) => new Promise((r) => setTimeout(r, ms * SCALE));

function configFiles(dir = git.WORK) {
  const sizes = {};
  const add = (rel) => { try { const st = fs.statSync(path.join(dir, rel)); if (st.isFile()) sizes[rel] = st.size; } catch { /* gone */ } };
  try {
    for (const f of fs.readdirSync(dir)) if (/\.ya?ml$/.test(f)) add(f);
    for (const f of fs.readdirSync(path.join(dir, '.storage'))) if (/^(lovelace|core\.|automation|script|input_|counter|timer|schedule|person|zone|energy|template|group)/.test(f)) add(path.join('.storage', f));
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name);
        if (e.isDirectory()) walk(r); else if (/\.ya?ml$/.test(e.name)) add(r);
      }
    };
    for (const d of ['packages', 'automations', 'scripts', 'dashboards', 'blueprints']) if (fs.existsSync(path.join(dir, d))) walk(d);
  } catch (e) { console.error('[hausmeister] Dateigrößen:', e.message); }
  return sizes;
}

async function watchSnapshot() {
  return { states: await ha.states(), files: configFiles() };
}

function rundgangPrompt(skip) {
  return [
    'Aufgabe: RUNDGANG, Frage: Was würdest du an diesem Haus anpassen? Du gehst nur lesend durch die Installation. Ändere nichts.',
    'Schau dir an: offene Reparaturen (ha-read ws repairs/list_issues), Entitäten, die seit über 24 Stunden nicht verfügbar sind, Automationen und Skripte mit Fehlern in den letzten Ausführungen (ha-read ws trace/list), Warnungen und Fehler im Log (ha-read log 500), die Konfigurationsprüfung (ha-read check), schwache Batterien, Sicherheitslücken (offene Türen und Fenster ohne Meldung, abgeschaltete Alarme), Energie (Verbraucher, die unnötig laufen, Lastverschiebung, PV-Überschuss), Komfort (wiederkehrende Handgriffe, die eine Automation übernehmen könnte), Aufräumen (verwaiste Entitäten, ungenutzte Automationen und Helfer, doppelte Dinge).',
    'Liefere in vorschlaege höchstens zehn Vorschläge, die sich wirklich lohnen, je mit kategorie, nutzen, aufwand und einer begruendung mit Beleg aus der Installation. Was ein Mensch vor Ort tun muss (Batterie wechseln, Gerät prüfen), bekommt handarbeit true. Lieber wenige gute als viele. Nichts vorschlagen, was in WISSEN.md als bewusst so vermerkt ist.',
    skip.length ? `Diese Vorschläge gibt es schon oder sie wurden abgelehnt, nicht noch einmal vorschlagen:\n${skip.map((x) => `- ${x}`).join('\n')}` : '',
    'Fasse in details kurz zusammen, wie es um das Haus steht. Status entwurf.',
  ].filter(Boolean).join('\n');
}

function promptFor(t, phase, store) {
  if (t.kind === 'rundgang') return rundgangPrompt(store ? store.knownSuggestions() : []);
  const parts = [`Ticket #${t.id}: ${t.title}`, '', t.text || '(keine Beschreibung)', ''];
  if (t.comments.length) parts.push('Kommentare:', ...t.comments.map((c) => `- ${c.at} ${c.by}: ${c.text}`), '');
  const last = [...t.results].reverse().find((r) => r.phase === 'entwerfen' && r.kind === 'entwurf');
  if (phase === 'entwerfen') {
    parts.push('Aufgabe: ENTWURF. Untersuche die Lage nur lesend und beschreibe genau, was du ändern würdest. Ändere nichts.');
    if (last) parts.push('', 'Es gibt schon einen Entwurf; überarbeite ihn anhand der Kommentare:', last.details || '');
  } else if (t.direct) {
    parts.push('Aufgabe: SOFORT UMSETZEN. Ein Mensch hat das Ticket ohne vorherigen Entwurf zur Umsetzung freigegeben. Untersuche die Lage, plane und setze um. Halte dich an die Regeln.');
    parts.push('Wenn der Eingriff riskant ist (etwas löschen, größerer Umbau, Sicherheits- oder Schutzfunktionen, Heizung, Akkus, Wechselrichter) oder das Ziel unklar ist: nichts ändern, Status rueckfrage, und in details deinen Plan beschreiben, damit er freigegeben werden kann.');
    if (last) parts.push('', 'Vorhandener Entwurf (als Ausgangspunkt):', last.details || '');
    const prev = [...t.results].reverse().find((r) => r.phase === 'umsetzen');
    if (prev) parts.push('', 'Frühere Umsetzung dieses Tickets:', prev.details || prev.message || '', 'Die Kommentare danach beschreiben, was nachzubessern ist.');
  } else {
    parts.push('Aufgabe: UMSETZUNG des freigegebenen Entwurfs. Halte dich an den Entwurf und an die Regeln. Wenn die Lage nicht mehr zum Entwurf passt, Status rueckfrage.');
    parts.push('', 'Freigegebener Entwurf:', last ? last.details : '(kein Entwurf gespeichert, dann rueckfrage)');
    const prev = [...t.results].reverse().find((r) => r.phase === 'umsetzen');
    if (prev) parts.push('', 'Frühere Umsetzung dieses Tickets:', prev.details || prev.message || '', 'Die Kommentare danach beschreiben, was nachzubessern ist.');
  }
  return parts.join('\n');
}

function runClaude(args, timeoutMs, onSpawn, onLine) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd: WORK_DIR, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    if (onSpawn) onSpawn(child);
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout.on('data', (d) => {
      stdout += d;
      if (!onLine) return;
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const l of lines) { try { onLine(JSON.parse(l)); } catch { /* not a JSON line */ } }
    });
    child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    const timer = setTimeout(() => { child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 10000); }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: `${stderr}\n${e.message}` }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

class Runner {
  constructor(store, opts) {
    this.store = store;
    this.opts = opts;
    this.busy = false;
    this.current = null;
    this.child = null;
    this.pending = new Set();
    this.baselineFile = process.env.HM_BASELINE || '/data/baseline.json';
  }

  // Usage of the subscription as reported by Claude Code (rate_limit_event).
  setQuota(q) {
    if (!q) return;
    this.store.data.quota = { ...q, seen: new Date().toISOString() };
    this.store.save();
  }

  quotaBlocked() {
    return L.quotaBlocks(this.store.data.quota, this.opts.max_quota_percent, Math.floor(Date.now() / 1000));
  }

  // Compares the house with the state of the previous run, independent of tickets.
  async watchdog() {
    const now = await watchSnapshot();
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(this.baselineFile, 'utf8')); } catch { /* first run */ }
    fs.writeFileSync(this.baselineFile, JSON.stringify(now));
    if (!prev) return [];
    const w = L.compareWatch(prev, now);
    const reasons = [];
    if (w.shrunk.length) reasons.push(`Seit dem letzten Lauf geschrumpft oder gelöscht: ${w.shrunk.map((s) => `${s.file} (${s.before} → ${s.after} Byte)`).join(', ')}`);
    if (w.vanished.length >= (this.opts.watchdog_vanished_min || 10)) reasons.push(`Seit dem letzten Lauf ${w.vanished.length} Entitäten verschwunden, z. B. ${w.vanished.slice(0, 10).join(', ')}`);
    if (reasons.length) {
      this.store.data.watchdog = { at: new Date().toISOString(), reasons };
      this.store.save();
      await ha.notify('Hausmeister: Wächter', `${reasons.join('\n')}\n\nDas betrifft keine Hausmeister-Umsetzung. Prüfen, ob es gewollt war; Sicherungen gibt es im Reiter Sicherungen.`, { service: this.opts.notify_service, id: 'hausmeister_waechter', url: this.opts.panel_url });
    }
    return reasons;
  }

  loggedIn() {
    const home = process.env.HOME || '/data/home';
    return fs.existsSync(path.join(home, '.claude', '.credentials.json')) || !!process.env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.ANTHROPIC_API_KEY;
  }

  async backup(reason) {
    try { return await git.snapshot(`Sicherung (${reason})`); } catch (e) { console.error('[hausmeister] Sicherung:', e.message); return null; }
  }

  // Starts a run for these tickets right away, or right after the current run.
  kick(ids, by) {
    for (const id of ids) this.pending.add(id);
    if (!this.busy) {
      const only = [...this.pending];
      this.pending.clear();
      this.cycle('sofort', by, only).catch((e) => console.error(e));
    }
  }

  async cycle(reason, by = 'Zeitplan', only = null) {
    if (this.busy) return { skipped: 'läuft schon' };
    this.busy = true;
    const run = { at: new Date().toISOString(), reason, by, tickets: [], note: '' };
    try {
      run.backup = await this.backup(reason);
      if (!only) {
        try { run.watchdog = await this.watchdog(); } catch (e) { run.watchdog = [`Wächter: ${e.message}`]; }
      }
      const queue = L.pickQueue(this.store.data.tickets, this.opts.max_tickets_per_run, only);
      if (!queue.length) { run.note = 'nichts zu tun'; return run; }
      if (!only && by === 'Zeitplan' && this.quotaBlocked()) {
        const q = this.store.data.quota;
        run.note = `Kontingent bei ${Math.round(q.utilization * 100)} % (Grenze ${this.opts.max_quota_percent} %), geplanter Lauf ausgelassen bis ${q.resetsAt ? new Date(q.resetsAt * 1000).toLocaleString('de-DE') : 'zur Erneuerung'}`;
        return run;
      }
      if (!this.loggedIn()) {
        run.note = 'Claude ist nicht angemeldet';
        await ha.notify('Hausmeister', 'Claude ist nicht angemeldet. Bitte in der Seitenleiste unter Hausmeister, Anmeldung, einloggen.', { service: this.opts.notify_service, id: 'hausmeister_login' });
        return run;
      }
      for (const { t, phase } of queue) {
        if (t.state !== phase) continue;
        const r = await this.process(t, phase);
        run.tickets.push({ id: t.id, phase, kind: r.kind });
        if (r.kind === 'kontingent' || r.kind === 'anmeldung') { run.note = r.kind === 'kontingent' ? 'Kontingent erschöpft, Rest beim nächsten Lauf' : 'Anmeldung abgelaufen'; break; }
      }
      return run;
    } catch (e) {
      run.note = `Fehler: ${e.message}`;
      return run;
    } finally {
      this.busy = false;
      this.current = null;
      this.store.addRun(run);
      if (this.onChange) this.onChange();
      if (this.pending.size) setImmediate(() => this.kick([], 'sofort'));
    }
  }

  async process(t, phase) {
    const s = this.store;
    this.current = { id: t.id, phase, since: new Date().toISOString(), step: 'startet', steps: [] };
    s.move(t, 'in_arbeit', 'Hausmeister', phase === 'entwerfen' ? 'Entwurf läuft' : 'Umsetzung läuft');
    if (this.onChange) this.onChange();
    const result = { at: new Date().toISOString(), phase };
    let before = null;
    try {
      const args = ['-p', promptFor(t, phase, s), '--output-format', 'stream-json', '--verbose', '--json-schema', JSON.stringify(L.RESULT_SCHEMA),
        '--add-dir', git.WORK, '--add-dir', SHARE];
      if (this.opts.model) args.push('--model', this.opts.model);
      if (t.session_id) args.push('--resume', t.session_id);
      if (phase === 'entwerfen') {
        args.push('--permission-mode', 'default', '--allowedTools', ...READ_TOOLS, '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
      } else {
        before = await watchSnapshot();
        before.logSince = Date.now() / 1000;
        result.pre = await git.snapshot(`vor #${t.id} ${t.title}`);
        if (this.opts.backup_before_change) {
          try {
            await ha.sup('POST', '/backups/new/partial', { name: `Hausmeister vor #${t.id}`, homeassistant: true, homeassistant_exclude_database: true }, { timeoutMs: 30 * 60000 });
          } catch (e) { result.backup_error = e.message; }
        }
        args.push('--permission-mode', 'acceptEdits', '--allowedTools', ...WRITE_TOOLS);
      }
      const cur = this.current;
      const onLine = (m) => {
        if (m.type === 'rate_limit_event' && m.rate_limit_info) this.setQuota(L.quotaFrom(m.rate_limit_info));
        if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
          for (const c of m.message.content) {
            if (c.type !== 'tool_use') continue;
            cur.step = L.stepText(c.name, c.input);
            cur.steps.push({ at: new Date().toISOString(), text: cur.step });
            if (cur.steps.length > 200) cur.steps.shift();
          }
        }
      };
      const proc = await runClaude(args, this.opts.run_timeout_minutes * 60000, (c) => { this.child = c; }, onLine);
      this.child = null;
      result.steps = cur.steps.slice(-80).map((x) => x.text);
      const r = proc.signal ? { kind: 'fehler', message: `abgebrochen nach ${this.opts.run_timeout_minutes} Minuten` } : L.interpretResult(phase, proc.stdout || proc.stderr);
      if (r.session_id) t.session_id = r.session_id;
      Object.assign(result, { kind: r.kind, message: r.message, cost: r.cost, turns: r.turns, denied: r.denied });
      if (r.out) Object.assign(result, { summary: r.out.zusammenfassung, details: r.out.details, question: r.out.frage, files: r.out.geaenderte_dateien || [], api: r.out.ha_aenderungen || [], test: r.out.test });

      if (t.kind === 'rundgang' && r.kind === 'entwurf') {
        const added = s.addSuggestions(r.out.vorschlaege || [], t.id);
        result.suggestions = added.map((x) => x.id);
        t.results.push(result);
        s.move(t, 'erledigt', 'Hausmeister', `${added.length} neue Vorschläge`);
        if (added.length) await ha.notify('Hausmeister: Vorschläge', `${result.summary || ''}\n\n${added.length} neue Vorschläge, was ich anpassen würde.`.trim(), { service: this.opts.notify_service, id: 'hausmeister_vorschlaege', url: this.opts.panel_url });
        return r;
      }

      if (phase === 'umsetzen') {
        await sleep(20000); // HA writes .storage with a delay
        await ha.waitForCore();
        result.post = await git.snapshot(`nach #${t.id} ${t.title}`);
        result.changed = (await git.changedFiles(result.pre, result.post)).map((f) => f.file);
        result.watch = await this.watch(before);
        result.log_errors = await this.newLogErrors(before.logSince);
        t.snapshot = { pre: result.pre, post: result.post };
      }

      let to;
      if (r.kind === 'kontingent' || r.kind === 'anmeldung') to = phase;
      else if (r.kind === 'umgesetzt') to = result.watch && result.watch.length ? 'pruefen' : 'umgesetzt';
      else if (r.kind === 'entwurf' || r.kind === 'rueckfrage') to = r.kind;
      else to = (result.watch && result.watch.length) ? 'pruefen' : 'fehler';
      t.results.push(result);
      s.move(t, to, 'Hausmeister', result.summary || result.message);
      await this.tell(t, to, result);
      return r;
    } catch (e) {
      result.kind = 'fehler';
      result.message = e.message;
      t.results.push(result);
      s.move(t, 'fehler', 'Hausmeister', e.message);
      await this.tell(t, 'fehler', result);
      return { kind: 'fehler' };
    }
  }

  async watch(before) {
    const reasons = [];
    try {
      const check = await ha.checkConfig().catch((e) => ({ result: 'invalid', errors: e.message }));
      await sleep(60000);
      const first = L.compareWatch(before, await watchSnapshot());
      let w = first;
      if (first.vanished.length || first.unavailable.length) {
        await sleep(180000);
        w = L.confirmWatch(first, L.compareWatch(before, await watchSnapshot()));
      }
      reasons.push(...L.watchAlarm(w, check));
    } catch (e) { reasons.push(`Wächter konnten nicht prüfen: ${e.message}`); }
    return reasons;
  }

  // Errors in the HA log since the start of the implementation (shown as a hint, no alarm).
  async newLogErrors(since) {
    try {
      const list = await ha.ws('system_log/list');
      return list.filter((e) => ['ERROR', 'CRITICAL'].includes(e.level) && Number(e.timestamp) >= since)
        .slice(0, 10).map((e) => `${e.name}: ${[].concat(e.message || []).join(' ').slice(0, 200)}`);
    } catch { return []; }
  }

  async tell(t, to, result) {
    const msgs = {
      entwurf: 'Entwurf liegt vor, bitte ansehen und freigeben.',
      rueckfrage: `Rückfrage: ${result.question || ''}`,
      umgesetzt: 'Umgesetzt, bitte abnehmen.',
      pruefen: `Umgesetzt, aber die Wächter melden: ${(result.watch || []).join('; ')}`,
      fehler: `Fehler: ${result.message || ''}`,
    };
    if (!msgs[to]) return;
    await ha.notify(`Hausmeister #${t.id}: ${t.title}`, `${msgs[to]}\n\n${result.summary || ''}`.trim(), { service: this.opts.notify_service, id: `hausmeister_${t.id}`, actions: L.notifyActions(to, t.id), url: this.opts.panel_url });
  }

  async rollback(t, by) {
    if (this.busy) throw new Error('Gerade läuft ein Lauf, bitte danach zurückrollen');
    if (!t.snapshot || !t.snapshot.pre || !t.snapshot.post) throw new Error('Zu diesem Ticket gibt es keine Sicherung');
    this.busy = true;
    try {
      await git.snapshot(`vor Rückrollung #${t.id}`);
      const files = await git.changedFiles(t.snapshot.pre, t.snapshot.post);
      if (!files.length) throw new Error('Die Umsetzung hat keine Dateien geändert; Änderungen über die API bitte von Hand zurücknehmen (siehe Bericht)');
      const storage = files.some((f) => f.file.startsWith('.storage/') || (f.old || '').startsWith('.storage/'));
      if (storage) await ha.sup('POST', '/core/stop', undefined, { timeoutMs: 600000 });
      try {
        await git.restore(t.snapshot.pre, t.snapshot.post);
      } finally {
        if (storage) await ha.sup('POST', '/core/start', undefined, { timeoutMs: 600000 });
      }
      if (!storage) {
        const c = await ha.checkConfig();
        if (c && c.result === 'valid') await ha.sup('POST', '/core/restart', undefined, { timeoutMs: 600000 }).catch(() => null);
      }
      await ha.waitForCore();
      const post = await git.snapshot(`Rückrollung #${t.id}`);
      t.results.push({ at: new Date().toISOString(), phase: 'rueckrollung', kind: 'zurueckgerollt', summary: `Dateien auf den Stand vor der Umsetzung gesetzt: ${files.map((f) => f.file).join(', ')}`, post });
      this.store.move(t, 'zurueckgerollt', by, `${files.length} Datei(en) zurückgesetzt${storage ? ', Core dafür gestoppt und gestartet' : ''}`);
      return files;
    } finally { this.busy = false; }
  }

  cancel() {
    if (this.child) { this.child.kill('SIGTERM'); return true; }
    return false;
  }
}

module.exports = { Runner, promptFor, READ_TOOLS, WRITE_TOOLS, configFiles, interpret: L.interpretResult };
