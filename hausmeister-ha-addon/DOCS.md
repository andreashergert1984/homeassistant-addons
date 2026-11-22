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
- **Zurückrollen** restores the files the implementation changed. If dashboards or helpers in
  `.storage` are affected, Home Assistant Core is stopped for the restore and started again,
  otherwise it is restarted after a successful configuration check. Changes made only through the
  API (for example to a device in the registry) are listed in the report and have to be undone by hand.
- The board and the terminal are only available to Home Assistant admins.

Rules are a strong guideline for the model, not a sandbox. The add-on has write access to your
configuration and the `manager` role on the Supervisor. Approve only drafts you understand.

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
