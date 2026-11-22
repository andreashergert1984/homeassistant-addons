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

const READ_TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Bash(ha-read:*)', 'Bash(cfg-git:*)', 'Bash(jq:*)', 'Bash(grep:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(wc:*)', 'Bash(ls:*)'];
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

function promptFor(t, phase) {
  const parts = [`Ticket #${t.id}: ${t.title}`, '', t.text || '(keine Beschreibung)', ''];
  if (t.comments.length) parts.push('Kommentare:', ...t.comments.map((c) => `- ${c.at} ${c.by}: ${c.text}`), '');
  const last = [...t.results].reverse().find((r) => r.phase === 'entwerfen' && r.kind === 'entwurf');
  if (phase === 'entwerfen') {
    parts.push('Aufgabe: ENTWURF. Untersuche die Lage nur lesend und beschreibe genau, was du ändern würdest. Ändere nichts.');
    if (last) parts.push('', 'Es gibt schon einen Entwurf; überarbeite ihn anhand der Kommentare:', last.details || '');
  } else {
    parts.push('Aufgabe: UMSETZUNG des freigegebenen Entwurfs. Halte dich an den Entwurf und an die Regeln. Wenn die Lage nicht mehr zum Entwurf passt, Status rueckfrage.');
    parts.push('', 'Freigegebener Entwurf:', last ? last.details : '(kein Entwurf gespeichert, dann rueckfrage)');
    const prev = [...t.results].reverse().find((r) => r.phase === 'umsetzen');
    if (prev) parts.push('', 'Frühere Umsetzung dieses Tickets:', prev.details || prev.message || '', 'Die Kommentare danach beschreiben, was nachzubessern ist.');
  }
  return parts.join('\n');
}

function runClaude(args, timeoutMs, onSpawn) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd: WORK_DIR, env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    if (onSpawn) onSpawn(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
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
  }

  loggedIn() {
    const home = process.env.HOME || '/data/home';
    return fs.existsSync(path.join(home, '.claude', '.credentials.json')) || !!process.env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.ANTHROPIC_API_KEY;
  }

  async backup(reason) {
    try { return await git.snapshot(`Sicherung (${reason})`); } catch (e) { console.error('[hausmeister] Sicherung:', e.message); return null; }
  }

  async cycle(reason, by = 'Zeitplan') {
    if (this.busy) return { skipped: 'läuft schon' };
    this.busy = true;
    const run = { at: new Date().toISOString(), reason, by, tickets: [], note: '' };
    try {
      run.backup = await this.backup(reason);
      const queue = L.pickQueue(this.store.data.tickets, this.opts.max_tickets_per_run);
      if (!queue.length) { run.note = 'nichts zu tun'; return run; }
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
    }
  }

  async process(t, phase) {
    const s = this.store;
    this.current = { id: t.id, phase, since: new Date().toISOString() };
    s.move(t, 'in_arbeit', 'Hausmeister', phase === 'entwerfen' ? 'Entwurf läuft' : 'Umsetzung läuft');
    if (this.onChange) this.onChange();
    const result = { at: new Date().toISOString(), phase };
    let before = null;
    try {
      const args = ['-p', promptFor(t, phase), '--output-format', 'json', '--json-schema', JSON.stringify(L.RESULT_SCHEMA),
        '--add-dir', git.WORK, '--add-dir', SHARE];
      if (this.opts.model) args.push('--model', this.opts.model);
      if (t.session_id) args.push('--resume', t.session_id);
      if (phase === 'entwerfen') {
        args.push('--permission-mode', 'default', '--allowedTools', ...READ_TOOLS, '--disallowedTools', 'Edit', 'Write', 'NotebookEdit');
      } else {
        before = await watchSnapshot();
        result.pre = await git.snapshot(`vor #${t.id} ${t.title}`);
        if (this.opts.backup_before_change) {
          try {
            await ha.sup('POST', '/backups/new/partial', { name: `Hausmeister vor #${t.id}`, homeassistant: true, homeassistant_exclude_database: true }, { timeoutMs: 30 * 60000 });
          } catch (e) { result.backup_error = e.message; }
        }
        args.push('--permission-mode', 'acceptEdits', '--allowedTools', ...WRITE_TOOLS);
      }
      const proc = await runClaude(args, this.opts.run_timeout_minutes * 60000, (c) => { this.child = c; });
      this.child = null;
      const r = proc.signal ? { kind: 'fehler', message: `abgebrochen nach ${this.opts.run_timeout_minutes} Minuten` } : L.interpretResult(phase, proc.stdout || proc.stderr);
      if (r.session_id) t.session_id = r.session_id;
      Object.assign(result, { kind: r.kind, message: r.message, cost: r.cost, turns: r.turns, denied: r.denied });
      if (r.out) Object.assign(result, { summary: r.out.zusammenfassung, details: r.out.details, question: r.out.frage, files: r.out.geaenderte_dateien || [], api: r.out.ha_aenderungen || [], test: r.out.test });

      if (phase === 'umsetzen') {
        await sleep(20000); // HA writes .storage with a delay
        await ha.waitForCore();
        result.post = await git.snapshot(`nach #${t.id} ${t.title}`);
        result.changed = (await git.changedFiles(result.pre, result.post)).map((f) => f.file);
        result.watch = await this.watch(before);
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

  async tell(t, to, result) {
    const msgs = {
      entwurf: 'Entwurf liegt vor, bitte ansehen und freigeben.',
      rueckfrage: `Rückfrage: ${result.question || ''}`,
      umgesetzt: 'Umgesetzt, bitte abnehmen.',
      pruefen: `Umgesetzt, aber die Wächter melden: ${(result.watch || []).join('; ')}`,
      fehler: `Fehler: ${result.message || ''}`,
    };
    if (!msgs[to]) return;
    await ha.notify(`Hausmeister #${t.id}: ${t.title}`, `${msgs[to]}\n\n${result.summary || ''}`.trim(), { service: this.opts.notify_service, id: `hausmeister_${t.id}` });
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
