# Hausmeister

The add-on keeps a small ticket board for your Home Assistant and lets Claude Code work on the
tickets in two steps: first a draft, then, after your approval, the implementation.

You need a Claude subscription (Pro or Max) or an Anthropic API key. Each run uses your quota.

Deutsch: siehe [Abschnitt „Deutsch“](#deutsch) am Ende.

## Language

Board, notifications, ticket documents and Claude's texts (drafts, questions, suggestions, reports)
are available in English and German. The option `language` decides: `auto` (default) follows the
language of Home Assistant (German or English, any other language falls back to English), `de` or
`en` sets it. A change of the Home Assistant language is picked up within 15 minutes. Texts that are
already stored (old reports, comments, history notes) stay in the language they were written in.

## Installation

1. Add this repository to the add-on store and install **Hausmeister**.
2. Start it and open **Hausmeister** in the sidebar (admins only).
3. Tab **Login**: type `claude`, then `/login`, choose the subscription login, open the link,
   paste the code back into the terminal, then `/exit`. The login is stored in the add-on
   (`/data/home/.claude`) and is excluded from Home Assistant backups, so after restoring a backup
   you log in again.
4. Optional: create a todo list named **Hausmeister** (Settings → Devices & services → Add
   integration → Local To-do). Its entity must match the option `intake_todo` (default
   `todo.hausmeister`).

## How a ticket moves

| State | What happens |
| --- | --- |
| New | Collected, nothing happens. |
| Draft requested | On the next run Claude looks at the system **read only** and writes a draft. |
| Draft ready | You read it. "Ask Claude to implement" approves it, a comment plus "Ask Claude for a draft" asks for a new draft. |
| Question | Claude needs an answer. Answer in the comment field. |
| Implementation approved | On the next run Claude implements exactly the approved draft. |
| Implemented, please accept | Check it and press "Accept, all good" or "Ask for a fix" (with a comment). |
| Implemented, watches report something | The watches found something. Check, roll back or ask for a fix. |

**Implement now** skips the approval of a draft and starts right away instead of waiting for the
next run: choose it when creating a ticket, press it on a ticket, or start a todo item with
`now:`, `sofort:` or `!` (for example "now: dim the hallway light to 30 %"). Claude then plans and
implements in one go. For risky changes (deleting, larger rebuilds, safety functions, heating,
batteries, inverters) or unclear goals it does not change anything and asks back with its plan
instead. Snapshots, backup, watches and rollback work as usual. Pressed on a ticket with a draft, it
implements that draft immediately.

Runs start at the configured times. Without queued tickets Claude is not started at all.
"Run now" starts a run right away.

## Safety

- **Drafts** run with read-only tools: files can be read, Home Assistant can only be queried
  through `ha-read` (read-only WebSocket commands and GET requests).
- **Implementations** may edit files and use the Home Assistant API. The rules Claude gets
  (`app/prompt/regeln.en.md`, German `regeln.de.md`) forbid rewriting whole files, editing
  `.storage` directly, switching devices, touching add-ons, updates, users or secrets, and require a
  configuration check before any reload or restart.
- Before each implementation: a git snapshot of `/config` (separate repository in the add-on's
  data; databases, logs, auth files, model folders such as `ollama/`, media and files larger than
  20 MB are excluded, the registries in `.storage` are always included) and, unless turned off, a
  partial HA backup without the database.
- After each implementation the watches compare the system with the state before: configuration
  check, YAML and dashboard files that shrank by more than 30 % or disappeared, entities that
  vanished or became unavailable (checked twice, to ignore restarts).
- **Roll back** restores the files the implementation changed. Files that integrations rewrite on
  their own (Zigbee2MQTT state, login data of integrations, registries, event logs) are listed apart
  and never restored. If dashboards or helpers in `.storage` are affected, Home Assistant Core is
  stopped for the restore and started again, otherwise it is restarted after a successful
  configuration check. Changes made only through the API (for example to a device in the registry)
  are listed in the report and have to be undone by hand.
- The board and the terminal are only available to Home Assistant admins.

Rules are a strong guideline for the model, not a sandbox. The add-on has write access to your
configuration and the `manager` role on the Supervisor. Approve only drafts you understand.

## Notifications with buttons

With `notify_service` set to a mobile app (for example `notify.mobile_app_phone`), each
notification carries buttons: for a draft "Implement now", "On the next run" and "Discard", for a
question "Answer" (with a text field), after an implementation "All good" and "Ask for a fix" (with
a text field), after an error "Try again". Tapping the notification opens the board.

## Usage quota

Claude Code reports how much of the subscription is used. The board shows the highest window
(five hours or seven days). Above `max_quota_percent` (default 80) scheduled runs are skipped until
that window resets, so the subscription stays available for other work. Immediate tickets still run.

## Watches between runs

On every scheduled run the add-on also compares the configuration and the entities with the
previous run, independent of tickets: YAML and dashboard files that shrank by more than 30 % or
disappeared, and ten or more vanished entities, raise a notification and a banner on the board.
After an implementation, new errors in the Home Assistant log are listed in the report.

## Suggestions ("What would I change?")

The tab **Suggestions** lists what the caretaker would change in your house: errors, security,
energy, comfort, cleanup and maintenance, each with a reason taken from your installation, benefit
and effort. Things a person has to do on site (a battery, a device) are marked "you do it yourself".
For each suggestion: "As ticket" (draft), "Implement now", "Just keep" or "Not needed".
Declined and taken suggestions are not proposed again.

Suggestions come from an inspection (read only): press "Look around now", or set `inspection_day`
(a weekday or `daily`) to run one with the first run of that day.

## Tickets from automations

Fire the event `hausmeister_neues_ticket` with `titel`, optional `text`, optional `modus`
(`entwurf` for a draft, `sofort` to implement now, `sammeln` to collect) and optional `von`.
The field names are the same in every language:

```yaml
action: event.fire
data:
  event_type: hausmeister_neues_ticket
  event_data:
    titel: Humidity in the basement above 70 % for three days
    text: Please check whether the dehumidifier runs and set up a warning.
    modus: entwurf
```

## Where things are

- Tickets: `/share/hausmeister/tickets/` (one Markdown file per ticket), state in the add-on data.
- Knowledge about your house that Claude keeps: `/share/hausmeister/WISSEN.md`. You can edit it.
- Snapshots: tab **Backups**; in the terminal `cfg-git log`.

## Sensors

- `sensor.hausmeister_wartet_auf_dich`: tickets that need you (draft, question, acceptance, error).
- `sensor.hausmeister_offen`: all open tickets, with next run and result of the last run.

Entity IDs and attribute names stay the same in every language; the friendly names follow the
language. The sensors are recreated by the add-on after a restart of Home Assistant (within 15 minutes).

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
| `inspection_day` | off | Inspection for suggestions: `off`, `daily` or a weekday (`mon` … `sun`). The German values `aus`, `taeglich` and `mo` … `so` still work. |
| `language` | auto | `auto` follows Home Assistant, `de` German, `en` English. |

## Deutsch

Das Add-on führt ein kleines Ticket-Board für dein Home Assistant und lässt Claude Code die Tickets
in zwei Schritten bearbeiten: erst ein Entwurf, dann, nach deiner Freigabe, die Umsetzung.

Du brauchst ein Claude-Abo (Pro oder Max) oder einen Anthropic-API-Schlüssel. Jeder Lauf verbraucht
Kontingent.

### Sprache

Board, Meldungen, Ticketdokumente und Claudes Texte (Entwürfe, Rückfragen, Vorschläge, Berichte)
gibt es auf Deutsch und Englisch. Die Option `language` entscheidet: `auto` (Vorgabe) folgt der
Sprache von Home Assistant (Deutsch oder Englisch, jede andere Sprache wird Englisch), `de` oder `en`
legt sie fest. Stellst du Home Assistant um, merkt das Add-on es innerhalb von 15 Minuten. Schon
gespeicherte Texte (alte Berichte, Kommentare, Verlaufsnotizen) bleiben in ihrer Sprache.

### Installation

1. Dieses Repository im Add-on-Store hinzufügen und **Hausmeister** installieren.
2. Starten und **Hausmeister** in der Seitenleiste öffnen (nur für Admins).
3. Reiter **Anmeldung**: `claude` eingeben, dann `/login`, die Anmeldung mit Abo wählen, den Link
   öffnen, den Code zurück ins Terminal kopieren, dann `/exit`. Die Anmeldung liegt im Add-on
   (`/data/home/.claude`) und ist aus den Home-Assistant-Sicherungen ausgenommen; nach dem
   Wiederherstellen einer Sicherung meldest du dich neu an.
4. Optional: eine To-do-Liste namens **Hausmeister** anlegen (Einstellungen → Geräte & Dienste →
   Integration hinzufügen → Lokale To-do-Liste). Die Entität muss zur Option `intake_todo` passen
   (Vorgabe `todo.hausmeister`).

### So läuft ein Ticket

| Zustand | Was passiert |
| --- | --- |
| Neu | Gesammelt, es passiert nichts. |
| Entwurf angefordert | Beim nächsten Lauf schaut sich Claude das System **nur lesend** an und schreibt einen Entwurf. |
| Entwurf liegt vor | Du liest ihn. „Claude soll umsetzen“ gibt ihn frei, ein Kommentar plus „Claude soll entwerfen“ fordert einen neuen Entwurf an. |
| Rückfrage | Claude braucht eine Antwort. Antworte im Kommentarfeld. |
| Umsetzung freigegeben | Beim nächsten Lauf setzt Claude genau den freigegebenen Entwurf um. |
| Umgesetzt, bitte abnehmen | Prüfen und „Abnehmen, passt“ oder „Nachbessern“ (mit Kommentar) drücken. |
| Umgesetzt, Wächter melden etwas | Die Wächter haben etwas gefunden. Prüfen, zurückrollen oder nachbessern lassen. |

**Sofort umsetzen** überspringt die Freigabe eines Entwurfs und startet gleich, statt auf den
nächsten Lauf zu warten: beim Anlegen wählen, am Ticket drücken oder einen To-do-Eintrag mit
`sofort:`, `now:` oder `!` beginnen (zum Beispiel „sofort: Flurlicht auf 30 % dimmen“). Claude plant
und setzt dann in einem Zug um. Bei riskanten Änderungen (Löschen, größere Umbauten,
Schutzfunktionen, Heizung, Akkus, Wechselrichter) oder unklarem Ziel ändert es nichts und fragt mit
seinem Plan zurück. Sicherungen, Wächter und Zurückrollen gelten wie immer. An einem Ticket mit
Entwurf gedrückt, setzt es genau diesen Entwurf sofort um.

Läufe starten zu den eingestellten Zeiten. Steht nichts an, wird Claude gar nicht gestartet.
„Jetzt ausführen“ startet sofort einen Lauf.

### Sicherheit

- **Entwürfe** laufen mit lesenden Werkzeugen: Dateien lesen, Home Assistant nur über `ha-read`
  abfragen (lesende WebSocket-Befehle und GET-Anfragen).
- **Umsetzungen** dürfen Dateien ändern und die Home-Assistant-API nutzen. Die Regeln für Claude
  (`app/prompt/regeln.de.md`, englisch `regeln.en.md`) verbieten, ganze Dateien neu zu schreiben,
  `.storage` direkt zu ändern, Geräte zu schalten, Add-ons, Updates, Benutzer oder Geheimnisse
  anzufassen, und verlangen vor jedem Neuladen oder Neustart eine Konfigurationsprüfung.
- Vor jeder Umsetzung: ein Git-Schnappschuss von `/config` (eigenes Repository in den Add-on-Daten;
  ohne Datenbanken, Logs, Anmeldedateien, Modellordner wie `ollama/`, Medien und Dateien über
  20 MB, die Registries in `.storage` immer dabei) und, wenn nicht ausgeschaltet, eine
  HA-Teilsicherung ohne Datenbank.
- Nach jeder Umsetzung vergleichen die Wächter das System mit dem Stand vorher:
  Konfigurationsprüfung, YAML- und Dashboard-Dateien, die um mehr als 30 % geschrumpft oder
  verschwunden sind, Entitäten, die verschwunden oder nicht mehr verfügbar sind (zweimal geprüft,
  damit Neustarts nicht zählen).
- **Zurückrollen** setzt die Dateien der Umsetzung zurück. Dateien, die Integrationen nebenbei
  ständig neu schreiben (Zigbee2MQTT-Zustand, Anmeldedaten von Integrationen, Registries,
  Ereignisprotokolle), werden getrennt angezeigt und nie zurückgesetzt. Sind Dashboards oder Helfer
  in `.storage` betroffen, wird Home Assistant Core dafür gestoppt und wieder gestartet, sonst nach
  erfolgreicher Prüfung neu gestartet. Änderungen nur über die API (zum Beispiel an einem Gerät in
  der Registry) stehen im Bericht und müssen von Hand zurückgenommen werden.
- Board und Terminal sind nur für Home-Assistant-Admins da.

Die Regeln sind eine starke Vorgabe für das Modell, keine Sandbox. Das Add-on hat Schreibzugriff
auf deine Konfiguration und die Rolle `manager` beim Supervisor. Gib nur Entwürfe frei, die du
verstehst.

### Benachrichtigungen mit Knöpfen

Ist `notify_service` auf eine Handy-App gesetzt (zum Beispiel `notify.mobile_app_handy`), hat jede
Meldung Knöpfe: beim Entwurf „Jetzt umsetzen“, „Beim nächsten Lauf“ und „Verwerfen“, bei einer
Rückfrage „Antworten“ (mit Textfeld), nach einer Umsetzung „Passt“ und „Nachbessern“ (mit
Textfeld), nach einem Fehler „Erneut versuchen“. Ein Tipp auf die Meldung öffnet das Board.

### Kontingent

Claude Code meldet, wie viel vom Abo verbraucht ist. Das Board zeigt das höchste Fenster (fünf
Stunden oder sieben Tage). Über `max_quota_percent` (Vorgabe 80) fallen geplante Läufe aus, bis das
Fenster erneuert ist, damit das Abo für anderes frei bleibt. Sofort-Tickets laufen trotzdem.

### Wächter zwischen den Läufen

Bei jedem geplanten Lauf vergleicht das Add-on auch ohne Ticket die Konfiguration und die
Entitäten mit dem vorigen Lauf: YAML- und Dashboard-Dateien, die um mehr als 30 % geschrumpft oder
verschwunden sind, und zehn oder mehr verschwundene Entitäten lösen eine Meldung und einen Hinweis
im Board aus. Nach einer Umsetzung stehen neue Fehler im Home-Assistant-Log im Bericht.

### Vorschläge („Was würde ich anpassen?“)

Der Reiter **Vorschläge** zeigt, was der Hausmeister an deinem Haus ändern würde: Fehler,
Sicherheit, Energie, Komfort, Aufräumen und Wartung, je mit Begründung aus deiner Installation,
Nutzen und Aufwand. Was ein Mensch vor Ort tun muss (Batterie, Gerät), ist als „machst du selbst“
markiert. Pro Vorschlag: „Als Ticket“ (Entwurf), „Sofort umsetzen“, „Nur merken“ oder „Nicht
nötig“. Abgelehnte und übernommene Vorschläge kommen nicht wieder.

Vorschläge entstehen bei einem Rundgang (nur lesend): „Jetzt umschauen“ drücken oder
`inspection_day` setzen (ein Wochentag oder `daily`), dann läuft er mit dem ersten Lauf des Tages.

### Tickets aus Automationen

Das Ereignis `hausmeister_neues_ticket` mit `titel`, optional `text`, optional `modus` (`entwurf`,
`sofort`, `sammeln`) und optional `von` auslösen:

```yaml
action: event.fire
data:
  event_type: hausmeister_neues_ticket
  event_data:
    titel: Luftfeuchte im Keller seit drei Tagen über 70 %
    text: Bitte prüfen, ob der Entfeuchter läuft, und eine Warnung einrichten.
    modus: entwurf
```

### Wo was liegt

- Tickets: `/share/hausmeister/tickets/` (eine Markdown-Datei je Ticket), der Zustand in den
  Add-on-Daten.
- Wissen über dein Haus, das Claude pflegt: `/share/hausmeister/WISSEN.md`. Du kannst es bearbeiten.
- Sicherungen: Reiter **Sicherungen**; im Terminal `cfg-git log`.

### Sensoren

- `sensor.hausmeister_wartet_auf_dich`: Tickets, die dich brauchen (Entwurf, Rückfrage, Abnahme, Fehler).
- `sensor.hausmeister_offen`: alle offenen Tickets, mit nächstem Lauf und Ergebnis des letzten Laufs.

Entitäts-IDs und Attributnamen sind in jeder Sprache gleich, die Anzeigenamen folgen der Sprache.
Nach einem Neustart von Home Assistant legt das Add-on die Sensoren innerhalb von 15 Minuten neu an.

### Einstellungen

| Option | Vorgabe | Bedeutung |
| --- | --- | --- |
| `run_times` | 11:00, 16:00 | Zeiten der Läufe. |
| `auto_draft` | true | Neue Tickets aus der To-do-Liste bekommen beim nächsten Lauf einen Entwurf. |
| `max_tickets_per_run` | 5 | Höchstens so viele Tickets je Lauf. |
| `run_timeout_minutes` | 30 | Zeitgrenze je Ticket. |
| `backup_before_change` | true | HA-Teilsicherung vor jeder Umsetzung. |
| `intake_todo` | todo.hausmeister | To-do-Liste für neue Tickets, leer schaltet aus. |
| `notify_service` | | z. B. `notify.mobile_app_handy`. |
| `model` | | z. B. `sonnet`, leer = Vorgabe. |
| `max_quota_percent` | 80 | Geplante Läufe pausieren über dieser Abo-Auslastung, 0 schaltet aus. |
| `max_backup_gb` | 2 | Keine HA-Sicherung vor einer Änderung, wenn der Konfigurationsordner größer ist; die Git-Sicherung läuft trotzdem. |
| `inspection_day` | off | Rundgang für Vorschläge: `off`, `daily` oder ein Wochentag (`mon` … `sun`). Die deutschen Werte `aus`, `taeglich` und `mo` … `so` gelten weiter. |
| `language` | auto | `auto` folgt Home Assistant, `de` Deutsch, `en` Englisch. |
