'use strict';
// One run: backup snapshot, then the queued tickets one after another.

const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const ha = require('./ha');
const git = require('./git');
const L = require('./logic');
const i18n = require('./i18n');

const tr = i18n.t;
const { ACTOR, REASON } = L;

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
  } catch (e) { console.error('[hausmeister] file sizes:', e.message); }
  return sizes;
}

async function watchSnapshot() {
  return { states: await ha.states(), files: configFiles() };
}

// Prompts come from the dictionary of the active language; the last line tells Claude
// in which language to write. Status values and field names stay the internal keys.
function rundgangPrompt(skip) {
  return [
    tr('prompt.inspection.task'),
    tr('prompt.inspection.look'),
    tr('prompt.inspection.deliver'),
    skip.length ? tr('prompt.inspection.skip', { list: skip.map((x) => `- ${x}`).join('\n') }) : '',
    tr('prompt.inspection.summary'),
    tr('prompt.language'),
  ].filter(Boolean).join('\n');
}

function promptFor(t, phase, store) {
  if (t.kind === 'rundgang') return rundgangPrompt(store ? store.knownSuggestions() : []);
  const parts = [tr('prompt.ticket', { id: t.id, title: t.title }), '', t.text || tr('prompt.no_description'), ''];
  if (t.comments.length) parts.push(tr('prompt.comments'), ...t.comments.map((c) => `- ${c.at} ${c.by}: ${c.text}`), '');
  const last = [...t.results].reverse().find((r) => r.phase === 'entwerfen' && r.kind === 'entwurf');
  const prev = [...t.results].reverse().find((r) => r.phase === 'umsetzen');
  if (phase === 'entwerfen') {
    parts.push(tr('prompt.draft.task'));
    if (last) parts.push('', tr('prompt.draft.revise'), last.details || '');
  } else if (t.direct) {
    parts.push(tr('prompt.direct.task'));
    parts.push(tr('prompt.direct.risky'));
    if (last) parts.push('', tr('prompt.direct.existing'), last.details || '');
    if (prev) parts.push('', tr('prompt.prev_impl'), prev.details || prev.message || '', tr('prompt.prev_impl_hint'));
  } else {
    parts.push(tr('prompt.impl.task'));
    parts.push('', tr('prompt.impl.approved'), last ? last.details : tr('prompt.impl.none'));
    if (prev) parts.push('', tr('prompt.prev_impl'), prev.details || prev.message || '', tr('prompt.prev_impl_hint'));
  }
  parts.push('', tr('prompt.language'));
  return parts.join('\n');
}

// Partial HA backup as a Supervisor background job, polled until done. A plain
// request is cut by the HTTP client after five minutes ("fetch failed").
async function haBackup(name, maxMs) {
  const r = await ha.sup('POST', '/backups/new/partial', { name, homeassistant: true, homeassistant_exclude_database: true, background: true });
  const job = r && r.job_id;
  if (!job) return;
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    const j = await ha.sup('GET', `/jobs/${job}`);
    if (j && j.done) {
      if (j.errors && j.errors.length) throw new Error(j.errors.map((e) => e.message).join('; '));
      return;
    }
    await sleep(10000);
  }
  throw new Error(tr('err.ha_backup_timeout', { min: Math.round(maxMs / 60000) }));
}

// Size of a folder in GB (du), null when it cannot be measured in time.
function folderSizeGb(dir) {
  return new Promise((resolve) => {
    execFile('du', ['-sb', dir], { timeout: 120000 }, (err, out) => {
      const n = Number(String(out || '').split(/\s/)[0]);
      resolve(err || !n ? null : n / 1e9);
    });
  });
}

function runClaude(args, timeoutMs, onSpawn, onLine) {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE, args, { cwd: WORK_DIR, env: { ...process.env, CI: '1', HM_LANG: i18n.language() }, stdio: ['ignore', 'pipe', 'pipe'] });
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

  // Files that changed between two run backups without any implementation in
  // between change on their own; they are remembered as volatile.
  async learnVolatile(backup) {
    const d = this.store.data;
    try {
      if (backup && d.last_backup && d.last_backup !== backup && !(d.last_impl && d.last_impl > d.last_backup_at)) {
        const files = (await git.changedFiles(d.last_backup, backup)).map((f) => f.file);
        d.volatile = [...new Set([...(d.volatile || []), ...files])].slice(-500);
      }
    } catch { /* history rewritten or first run */ }
    d.last_backup = backup;
    d.last_backup_at = new Date().toISOString();
    this.store.save();
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
    if (w.shrunk.length) reasons.push(tr('watchdog.shrunk', { files: L.shrunkList(w.shrunk) }));
    if (w.vanished.length >= (this.opts.watchdog_vanished_min || 10)) reasons.push(tr('watchdog.vanished', { n: w.vanished.length, list: w.vanished.slice(0, 10).join(', ') }));
    if (reasons.length) {
      this.store.data.watchdog = { at: new Date().toISOString(), reasons };
      this.store.save();
      await ha.notify(tr('watchdog.notify_title'), tr('watchdog.notify_text', { reasons: reasons.join('\n') }), { service: this.opts.notify_service, id: 'hausmeister_waechter', url: this.opts.panel_url });
    }
    return reasons;
  }

  loggedIn() {
    const home = process.env.HOME || '/data/home';
    return fs.existsSync(path.join(home, '.claude', '.credentials.json')) || !!process.env.CLAUDE_CODE_OAUTH_TOKEN || !!process.env.ANTHROPIC_API_KEY;
  }

  async backup(reason) {
    try { return await git.snapshot(tr('backup.run', { reason: L.reasonLabel(reason) })); } catch (e) { console.error('[hausmeister] snapshot:', e.message); return null; }
  }

  // Starts a run for these tickets right away, or right after the current run.
  kick(ids, by) {
    for (const id of ids) this.pending.add(id);
    if (!this.busy) {
      const only = [...this.pending];
      this.pending.clear();
      this.cycle(REASON.now, by, only).catch((e) => console.error(e));
    }
  }

  async cycle(reason, by = ACTOR.schedule, only = null) {
    if (this.busy) return { skipped: tr('run.busy') };
    this.busy = true;
    const run = { at: new Date().toISOString(), reason, by, tickets: [], note: '' };
    try {
      run.backup = await this.backup(reason);
      await this.learnVolatile(run.backup);
      if (!only) {
        try { run.watchdog = await this.watchdog(); } catch (e) { run.watchdog = [tr('watch.failed', { message: e.message })]; }
      }
      const queue = L.pickQueue(this.store.data.tickets, this.opts.max_tickets_per_run, only);
      if (!queue.length) { run.note = tr('run.nothing'); return run; }
      if (!only && by === ACTOR.schedule && this.quotaBlocked()) {
        const q = this.store.data.quota;
        run.note = tr('run.quota_skip', { pct: Math.round(q.utilization * 100), max: this.opts.max_quota_percent, until: q.resetsAt ? new Date(q.resetsAt * 1000).toLocaleString(i18n.locale()) : tr('run.quota_reset') });
        return run;
      }
      if (!this.loggedIn()) {
        run.note = tr('run.not_logged_in');
        await ha.notify(tr('notify.title'), tr('notify.not_logged_in'), { service: this.opts.notify_service, id: 'hausmeister_login' });
        return run;
      }
      for (const { t, phase } of queue) {
        if (t.state !== phase) continue;
        const r = await this.process(t, phase);
        run.tickets.push({ id: t.id, phase, kind: r.kind });
        if (r.kind === 'kontingent' || r.kind === 'anmeldung') { run.note = r.kind === 'kontingent' ? tr('run.quota_exhausted') : tr('run.login_expired'); break; }
      }
      return run;
    } catch (e) {
      run.note = tr('run.error', { message: e.message });
      return run;
    } finally {
      this.busy = false;
      this.current = null;
      this.store.addRun(run);
      if (this.onChange) this.onChange();
      if (this.pending.size) setImmediate(() => this.kick([], REASON.now));
    }
  }

  async process(t, phase) {
    const s = this.store;
    this.current = { id: t.id, phase, since: new Date().toISOString(), step: tr('step.starting'), steps: [] };
    s.move(t, 'in_arbeit', ACTOR.caretaker, phase === 'entwerfen' ? tr('history.draft_running') : tr('history.impl_running'));
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
        const cur0 = this.current;
        const say = (text) => { cur0.step = text; cur0.steps.push({ at: new Date().toISOString(), text }); if (this.onChange) this.onChange(); };
        say(tr('step.reading_before'));
        before = await watchSnapshot();
        before.logSince = Date.now() / 1000;
        this.store.data.last_impl = new Date().toISOString();
        say(tr('step.git_backup'));
        result.pre = await git.snapshot(tr('backup.before', { id: t.id, title: t.title }));
        if (this.opts.backup_before_change) {
          // A partial HA backup always contains the whole config folder. With model
          // files or media in it, that takes very long; the git snapshot covers the
          // configuration, so the HA backup is left out above the limit.
          const gb = await folderSizeGb(git.WORK);
          if (gb != null && gb > this.opts.max_backup_gb) {
            result.backup_error = tr('err.ha_backup_skipped', { gb: gb.toFixed(1), max: this.opts.max_backup_gb });
            say(tr('step.ha_backup_skipped'));
          } else {
            say(tr('step.ha_backup'));
            try {
              await haBackup(tr('backup.ha_name', { id: t.id }), 30 * 60000);
            } catch (e) { result.backup_error = e.message; }
          }
        }
        say(tr('step.claude_starts'));
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
      const r = proc.signal ? { kind: 'fehler', message: tr('run.timeout', { min: this.opts.run_timeout_minutes }) } : L.interpretResult(phase, proc.stdout || proc.stderr);
      if (r.session_id) t.session_id = r.session_id;
      Object.assign(result, { kind: r.kind, message: r.message, cost: r.cost, turns: r.turns, denied: r.denied });
      if (r.out) Object.assign(result, { summary: r.out.zusammenfassung, details: r.out.details, question: r.out.frage, files: r.out.geaenderte_dateien || [], api: r.out.ha_aenderungen || [], test: r.out.test });

      if (t.kind === 'rundgang' && r.kind === 'entwurf') {
        const added = s.addSuggestions(r.out.vorschlaege || [], t.id);
        result.suggestions = added.map((x) => x.id);
        t.results.push(result);
        s.move(t, 'erledigt', ACTOR.caretaker, tr('history.suggestions', { n: added.length }));
        if (added.length) await ha.notify(tr('notify.suggestions_title'), `${result.summary || ''}\n\n${tr('notify.suggestions_text', { n: added.length })}`.trim(), { service: this.opts.notify_service, id: 'hausmeister_vorschlaege', url: this.opts.panel_url });
        return r;
      }

      if (phase === 'umsetzen') {
        await sleep(20000); // HA writes .storage with a delay
        await ha.waitForCore();
        result.post = await git.snapshot(tr('backup.after', { id: t.id, title: t.title }));
        const all = (await git.changedFiles(result.pre, result.post)).map((f) => f.file);
        const learned = this.store.data.volatile || [];
        // Files Claude reported or the registries it changes through the API stay in; the rest that
        // integrations rewrite on their own is listed apart and never rolled back.
        const named = new Set((result.files || []).map((f) => String(f).replace(/^\/homeassistant\//, '')));
        result.changed = all.filter((f) => named.has(f) || !L.isVolatile(f, learned));
        result.changed_by_itself = all.filter((f) => !result.changed.includes(f));
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
      s.move(t, to, ACTOR.caretaker, result.summary || result.message);
      await this.tell(t, to, result);
      return r;
    } catch (e) {
      result.kind = 'fehler';
      result.message = e.message;
      t.results.push(result);
      s.move(t, 'fehler', ACTOR.caretaker, e.message);
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
    } catch (e) { reasons.push(tr('watch.failed', { message: e.message })); }
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
      entwurf: () => tr('notify.draft'),
      rueckfrage: () => tr('notify.question', { question: result.question || '' }),
      umgesetzt: () => tr('notify.done'),
      pruefen: () => tr('notify.check', { watch: (result.watch || []).join('; ') }),
      fehler: () => tr('notify.error', { message: result.message || '' }),
    };
    if (!msgs[to]) return;
    await ha.notify(tr('notify.ticket_title', { id: t.id, title: t.title }), `${msgs[to]()}\n\n${result.summary || ''}`.trim(), { service: this.opts.notify_service, id: `hausmeister_${t.id}`, actions: L.notifyActions(to, t.id), url: this.opts.panel_url });
  }

  async rollback(t, by) {
    if (this.busy) throw new Error(tr('err.rollback_busy'));
    if (!t.snapshot || !t.snapshot.pre || !t.snapshot.post) throw new Error(tr('err.no_snapshot'));
    this.busy = true;
    try {
      await git.snapshot(tr('backup.before_rollback', { id: t.id }));
      const impl = [...t.results].reverse().find((r) => r.post === t.snapshot.post) || {};
      const keep = impl.changed || null;
      const files = (await git.changedFiles(t.snapshot.pre, t.snapshot.post)).filter((f) => !keep || keep.includes(f.file));
      if (!files.length) throw new Error(tr('err.rollback_no_files'));
      const storage = files.some((f) => f.file.startsWith('.storage/') || (f.old || '').startsWith('.storage/'));
      if (storage) await ha.sup('POST', '/core/stop', undefined, { timeoutMs: 600000 });
      try {
        await git.restore(t.snapshot.pre, t.snapshot.post, files.map((f) => f.file));
      } finally {
        if (storage) await ha.sup('POST', '/core/start', undefined, { timeoutMs: 600000 });
      }
      if (!storage) {
        const c = await ha.checkConfig();
        if (c && c.result === 'valid') await ha.sup('POST', '/core/restart', undefined, { timeoutMs: 600000 }).catch(() => null);
      }
      await ha.waitForCore();
      const post = await git.snapshot(tr('backup.rollback', { id: t.id }));
      t.results.push({ at: new Date().toISOString(), phase: 'rueckrollung', kind: 'zurueckgerollt', summary: tr('rollback.summary', { files: files.map((f) => f.file).join(', ') }), post });
      this.store.move(t, 'zurueckgerollt', by, tr(storage ? 'rollback.note_storage' : 'rollback.note', { n: files.length }));
      return files;
    } finally { this.busy = false; }
  }

  cancel() {
    if (this.child) { this.child.kill('SIGTERM'); return true; }
    return false;
  }
}

module.exports = { Runner, promptFor, READ_TOOLS, WRITE_TOOLS, configFiles, interpret: L.interpretResult };
