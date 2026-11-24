## 0.8.1

Drafts and inspections run as their own user.

- Drafts and inspections run as the unprivileged user `hausmeister` (uid 1001) instead of root. They can read the configuration, but cannot write it, cannot read `secrets.yaml`, the add-on options, the ticket store or the snapshot repository, and cannot read the environment of other processes. Implementations after approval still run as root and write the configuration as before.
- On start the add-on sets `secrets.yaml` to 0600 (owner stays root, Home Assistant still reads it) and notes this once in the log. Nothing else in the configuration folder changes; the login files in `.storage` are only checked, and a warning is logged if one is readable for others.
- `/data/home` (the login of Claude) belongs to `hausmeister`, so the login and its token refresh work in every phase. It is handed over again before each draft, also after a login in the terminal.
- `cfg-git` runs through the local proxy of the add-on: the server runs git as root with the same argument checks, the draft user needs no access to the snapshots. `secrets.yaml` (in every folder), `.storage/auth*` and `.storage/core.config_entries` are excluded by pathspec from `log`, `diff`, `show` and `ls-files`, also without a path.
- The terminal is started by the add-on without the Supervisor token; `ha-api`, `ha-read` and `cfg-git` there use the local proxy with a write token of the terminal. The shell no longer reads start files from `/data/home`.
- Claude is started with `--setting-sources project --strict-mcp-config`: settings, hooks and MCP servers from `/data/home` are ignored, so a draft cannot plant anything that runs in an implementation as root. git of the add-on ignores the global git configuration.
- The ticket store is written with mode 0600; the add-on starts with `umask 022`.

## 0.8.0

Security hardening.

- Board, API and terminal only answer the ingress of Home Assistant (and loopback). Other add-ons in the internal network get 403, terminal connections are closed.
- Claude no longer gets the Supervisor token. `ha-read` and `ha-api` go through a local proxy in the add-on with a random token per Claude call: drafts and inspections only read (GET, a fixed list of WebSocket commands, template, configuration check, core log); implementations may write, but never reach the Supervisor API, `hassio.*`, `shell_command.*`, `homeassistant.stop`, `config/auth*`, `auth/*` or the events of the add-on. Paths with `..` or encoded dots are refused. `ha-api restart` now uses the service `homeassistant.restart`.
- `ha-read ws` uses an exact allowlist; `config/auth/list` and `application_credentials/*` are no longer readable. A JSON payload can no longer replace the command type.
- `cfg-git` is a Node script that checks every argument: only `log`, `diff`, `show`, `status`, `ls-files`, `blame`; no `--output` (also abbreviated), `-o`, `-O`, `-c`, `--ext-diff`, `--textconv`, `--exec-path`, `--git-dir`, `--work-tree`, `--config*`, `--no-index`, no paths to `secrets.yaml` or the auth files. Always `--no-ext-diff`/`--no-textconv`, no system or global git configuration.
- Tools for Claude: `cat`, `sort` and `uniq` are gone from drafts (Read is enough); WebFetch only for home-assistant.io, community.home-assistant.io, github.com and raw.githubusercontent.com in every phase. Closed in every phase: `secrets.yaml`, `.storage/auth*`, `.storage/core.config_entries`, the login of Claude, the snapshot repository, `/proc`, `/app`, and `curl`, `wget`, `nc`.
- New option `allow_immediate_from_outside` (default off): only then do `sofort:`, `now:` and `!` in the todo list and `modus: sofort` in `hausmeister_neues_ticket` implement right away. Otherwise the ticket gets a draft and a note.
- Events (`hausmeister_neues_ticket`, notification buttons) only count from an active admin; events of the add-on's own user are ignored. Notification buttons carry a random nonce per notification that is stored at the ticket and used once; buttons of older notifications, including all from before 0.8.0, no longer work.
- At most 10 new tickets per hour from the todo list and events; more are discarded with a log line and one notification. Immediate runs from the todo list, events and notification buttons respect the quota limit.
- YAML files, dashboards, automations, scripts and scenes are never learned as files that change on their own, so a rollback always covers them.
- A ticket with a draft can no longer be edited (the draft belongs to the text); comment and ask for a new draft instead.
- Knowledge file: the main copy is now `/data/wissen.md`; `/share/hausmeister/WISSEN.md` is only an export and is overwritten. An existing file there is taken over once on the first start.
- Claude's session transcripts (`home/.claude/projects`) are left out of HA backups.

## 0.7.0

- German and English: the board, error messages, notifications with their buttons, ticket documents, sensor names, backup names and the helpers for Claude are available in both languages. Date and time follow the language.
- New option `language`: `auto` (default) follows the language of Home Assistant, other languages become English; `de` or `en` set it. A change in Home Assistant takes effect after at most 15 minutes.
- Claude writes drafts, questions, suggestions and reports in the configured language; the rules exist as `regeln.de.md` and `regeln.en.md`, content and safety rules are unchanged.
- `inspection_day` also understands `off`, `daily` and `mon` to `sun` (new default `off`); the German values still work.
- Todo items starting with `now:` are implemented right away, like `sofort:` and `!`.
- Existing tickets, suggestions and runs continue unchanged; texts already saved stay in their language.
- README and DOCS in English, the German text is in README.de.md and at the end of DOCS.md.
- Changelog and screenshots in English.

## 0.6.0

- Expanded sections (Done, Steps, History, Decided) stay open when the board refreshes automatically.
- Comments you have started are no longer lost on refresh.
- "Send answer" and "Ask for a fix" are disabled until the field contains something; for a question there is no longer a "Comment only" that would leave the question open.
- Feedback as a short toast instead of an error dialog; buttons show that they are working and cannot be pressed twice.
- "Run now" shows how many tickets are waiting and is disabled without a queue; "Cancel run" names the ticket.
- The back button in the browser and in the HA app closes the ticket instead of the panel.
- Notice when the connection is lost; inspection tickets without a progress bar; long commands wrap.

## 0.5.3

- In an open ticket Claude is currently working on, the top bar with "View" is gone; the steps are shown in the ticket.

## 0.5.2

- Rolling back only resets the files of the implementation. Files that integrations constantly rewrite on the side (Zigbee2MQTT state, integration credentials, registries, event logs) are shown separately and never reset; the caretaker also learns such files from the backups between runs.
- HA backup before an implementation as a background job of the Supervisor with polling (before, the request aborted after five minutes with "fetch failed").

## 0.5.1

- No HA backup before an implementation if the configuration folder is larger than max_backup_gb (default 2 GB); a partial backup always contains the whole folder and then takes very long. The Git backup still runs.
- The board also shows the preparation of an implementation (reading the state, Git backup, HA backup) instead of just "starting".

## 0.5.0

- New tab "Suggestions": what would I change? Errors, security, energy, comfort, cleanup, maintenance, each with reason, benefit and effort. Take over as a ticket, implement right away, keep or decline; declined ones do not come back. Manual work is marked "you do it yourself".
- "Look around now" starts an inspection right away; the regular inspection fills the suggestions instead of creating tickets directly.
- Input fields in normal font.

## 0.4.0

- New design: key figures at the top (waiting for you, in progress, done, quota), cards with colour bar, origin and relative time, live bar while Claude is working.
- Ticket with progress bar (intake, draft, approval, implementation, acceptance), results as a timeline, comments as speech bubbles.
- Mode as selection cards when creating a ticket, floating plus button on the phone, dark mode reworked.

## 0.3.1

- The question is at the top of the ticket, "Send answer" is highlighted; tab bar without scroll bar on the phone.
- README with pictures and instructions.

## 0.3.0

- Push notifications with buttons (Implement now, Discard, Answer, All good, Ask for a fix, Try again); tapping opens the board.
- Live progress: the board shows what Claude is doing right now; every report contains the steps.
- Quota protection: usage of the subscription visible, scheduled runs pause above the limit (default 80 %).
- Watchdog between runs (shrunk files, many vanished entities) and new errors in the HA log after an implementation.
- Tickets from automations via the event hausmeister_neues_ticket.
- Optional inspection (weekday or daily): read only, up to five suggestions as new tickets.

## 0.2.0

- Implement right away: when creating a ticket, as a button in the ticket or via a todo item starting with "sofort:" or "!". Starts immediately without waiting for the schedule; without a draft Claude plans and implements in one run and asks first for risky changes. Other waiting tickets stay on the schedule.

## 0.1.3

- Draft: more read-only commands allowed (echo, cat, sort, uniq, cut, tr, date, printf), the rules name the allowed commands explicitly.

## 0.1.2

- The backup skips model folders (ollama), media, ESPHome builds and files over 20 MB; registries in .storage are always backed up.
- Sensors appear right after the start, not only after the first backup.

## 0.1.1

- Base image directly in the Dockerfile (build.yaml removed) so that the Supervisor builds the image.

## 0.1.0

- First version: ticket board in the sidebar, intake from the todo list, runs at fixed times with a pre-check, read-only draft, implementation after approval, Git backup and HA partial backup before every implementation, three watchdogs, roll back, login via the terminal in the add-on, Claude Code 2.1.326.
