# Hausmeister

The add-on keeps a small ticket board for your Home Assistant and lets Claude Code work on the
tickets in two steps: first a draft, then, after your approval, the implementation.

You need a Claude subscription (Pro or Max) or an Anthropic API key. Each run uses your quota.

## Installation

1. Add this repository to the add-on store and install **Hausmeister**.
2. Start it and open **Hausmeister** in the sidebar (admins only).
3. Tab **Anmeldung**: type `claude`, then `/login`, choose the subscription login, open the link,
   paste the code back into the terminal, then `/exit`. The login is stored in the add-on
   (`/data/home/.claude`) and is excluded from Home Assistant backups, so after restoring a backup
   you log in again.
4. Optional: create a todo list named **Hausmeister** (Settings → Devices & services → Add
   integration → Local To-do). Its entity must match the option `intake_todo` (default
   `todo.hausmeister`).

## How a ticket moves

| State | What happens |
| --- | --- |
| Neu | Collected, nothing happens. |
| Entwurf angefordert | On the next run Claude looks at the system **read only** and writes a draft. |
| Entwurf liegt vor | You read it. "Claude soll umsetzen" approves it, a comment plus "Claude soll entwerfen" asks for a new draft. |
| Rückfrage | Claude needs an answer. Answer in the comment field. |
| Umsetzung freigegeben | On the next run Claude implements exactly the approved draft. |
| Umgesetzt | Check it and press "Abnehmen" or "Nachbessern" (with a comment). |
| Umgesetzt, Wächter melden etwas | The watches found something. Check, roll back or ask for a fix. |

**Sofort umsetzen** skips the approval of a draft and starts right away instead of waiting for the
next run: choose it when creating a ticket, press it on a ticket, or start a todo item with
`sofort:` or `!` (for example "sofort: Flurlicht auf 30 % dimmen"). Claude then plans and implements
in one go. For risky changes (deleting, larger rebuilds, safety functions, heating, batteries,
inverters) or unclear goals it does not change anything and asks back with its plan instead.
Snapshots, backup, watches and rollback work as usual. Pressed on a ticket with a draft, it
implements that draft immediately.

Runs start at the configured times. Without queued tickets Claude is not started at all.
"Jetzt ausführen" starts a run right away.

## Safety

- **Drafts** run with read-only tools: files can be read, Home Assistant can only be queried
  through `ha-read` (read-only WebSocket commands and GET requests).
- **Implementations** may edit files and use the Home Assistant API. The rules Claude gets
  (`app/prompt/regeln.md`) forbid rewriting whole files, editing `.storage` directly, switching
  devices, touching add-ons, updates, users or secrets, and require a configuration check before
  any reload or restart.
- Before each implementation: a git snapshot of `/config` (separate repository in the add-on's
  data; databases, logs, auth files, model folders such as `ollama/`, media and files larger than
  20 MB are excluded, the registries in `.storage` are always included) and, unless turned off, a partial HA backup
  without the database.
- After each implementation the watches compare the system with the state before: configuration
  check, YAML and dashboard files that shrank by more than 30 % or disappeared, entities that
  vanished or became unavailable (checked twice, to ignore restarts).
- **Zurückrollen** restores the files the implementation changed. Files that integrations rewrite on their own (Zigbee2MQTT state, login data of integrations, registries, event logs) are listed apart and never restored. If dashboards or helpers in
  `.storage` are affected, Home Assistant Core is stopped for the restore and started again,
  otherwise it is restarted after a successful configuration check. Changes made only through the
  API (for example to a device in the registry) are listed in the report and have to be undone by hand.
- The board and the terminal are only available to Home Assistant admins.

Rules are a strong guideline for the model, not a sandbox. The add-on has write access to your
configuration and the `manager` role on the Supervisor. Approve only drafts you understand.

## Notifications with buttons

With `notify_service` set to a mobile app (for example `notify.mobile_app_phone`), each
notification carries buttons: for a draft "Jetzt umsetzen", "Beim nächsten Lauf" and
"Verwerfen", for a question "Antworten" (with a text field), after an implementation "Passt" and
"Nachbessern" (with a text field), after an error "Erneut versuchen". Tapping the notification
opens the board.

## Usage quota

Claude Code reports how much of the subscription is used. The board shows the highest window
(five hours or seven days). Above `max_quota_percent` (default 80) scheduled runs are skipped until
that window resets, so the subscription stays available for other work. Immediate tickets still run.

## Watches between runs

On every scheduled run the add-on also compares the configuration and the entities with the
previous run, independent of tickets: YAML and dashboard files that shrank by more than 30 % or
disappeared, and ten or more vanished entities, raise a notification and a banner on the board.
After an implementation, new errors in the Home Assistant log are listed in the report.

## Suggestions ("Was würde ich anpassen?")

The tab **Vorschläge** lists what the caretaker would change in your house: errors, security,
energy, comfort, cleanup and maintenance, each with a reason taken from your installation, benefit
and effort. Things a person has to do on site (a battery, a device) are marked "machst du selbst".
For each suggestion: "Als Ticket" (draft), "Sofort umsetzen", "Nur merken" or "Nicht nötig".
Declined and taken suggestions are not proposed again.

Suggestions come from an inspection (read only): press "Jetzt umschauen", or set `inspection_day`
(a weekday or `taeglich`) to run one with the first run of that day.

## Tickets from automations

Fire the event `hausmeister_neues_ticket` with `titel`, optional `text`, optional `modus`
(`entwurf`, `sofort`, `sammeln`) and optional `von`:

```yaml
action: event.fire
data:
  event_type: hausmeister_neues_ticket
  event_data:
    titel: Luftfeuchte im Keller seit drei Tagen über 70 %
    text: Bitte prüfen, ob der Entfeuchter läuft und eine Warnung einrichten.
    modus: entwurf
```

## Where things are

- Tickets: `/share/hausmeister/tickets/` (one Markdown file per ticket), state in the add-on data.
- Knowledge about your house that Claude keeps: `/share/hausmeister/WISSEN.md`. You can edit it.
- Snapshots: tab **Sicherungen**; in the terminal `cfg-git log`.

## Sensors

- `sensor.hausmeister_wartet_auf_dich`: tickets that need you (draft, question, acceptance, error).
- `sensor.hausmeister_offen`: all open tickets, with next run and result of the last run.

The sensors are recreated by the add-on after a restart of Home Assistant (within 15 minutes).

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `run_times` | 11:00, 16:00 | Times of the runs. |
| `auto_draft` | true | New tickets from the todo list are drafted on the next run. |
| `max_tickets_per_run` | 5 | Upper limit per run. |
| `run_timeout_minutes` | 30 | Time limit per ticket. |
| `backup_before_change` | true | Partial HA backup before each implementation. |
| `intake_todo` | todo.hausmeister | Todo list for new tickets, empty turns it off. |
| `notify_service` | | e.g. `notify.mobile_app_phone`. |
| `model` | | e.g. `sonnet`, empty uses the default. |
| `max_quota_percent` | 80 | Scheduled runs pause above this subscription usage, 0 turns it off. |
| `max_backup_gb` | 2 | No HA backup before a change when the config folder is larger; the git snapshot still runs. |
| `inspection_day` | aus | Inspection for suggestions: `aus`, `taeglich` or a weekday (`mo` … `so`). |
