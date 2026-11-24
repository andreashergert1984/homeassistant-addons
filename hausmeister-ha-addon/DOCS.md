# Hausmeister

The add-on keeps a small ticket board for your Home Assistant and lets Claude Code work on the
tickets in two steps: first a draft, then, after your approval, the implementation.

You need a Claude subscription (Pro or Max) or an Anthropic Console account (API billing, also chosen
at `/login`). Each run uses your quota.

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
`now:`, `sofort:` or `!` (for example "now: dim the hallway light to 30 %"; the todo prefixes only
work with the option `allow_immediate_from_outside`, otherwise such an item gets a draft first).
Claude then plans and implements in one go. For risky changes (deleting, larger rebuilds, safety functions, heating,
batteries, inverters) or unclear goals it does not change anything and asks back with its plan
instead. Snapshots, backup, watches and rollback work as usual. Pressed on a ticket with a draft, it
implements that draft immediately.

Runs start at the configured times. Without queued tickets Claude is not started at all.
"Run now" starts a run right away.

## Security, honestly

What the add-on does to protect your installation:

- **Only through Home Assistant:** board, API and terminal answer only the ingress gateway of the
  Supervisor (checked by IP address) and loopback; other add-ons in the internal network get 403. The
  panel is only available to Home Assistant admins.
- **Drafts and inspections as a user of their own:** they run as the user `hausmeister` (uid 1001), not
  as root. That user cannot write the configuration and cannot read the add-on options, the ticket state
  or the snapshot repository. Its shell is restricted to `ha-read`, `cfg-git`, `echo`, `printf` and
  `date`; `ha-read` and `cfg-git` go through a local proxy in the add-on, and `ha-read` only reads (GET
  requests, a fixed list of WebSocket commands, templates, the configuration check, the Core log). Files
  are read only with Claude's Read, Grep and Glob tools; the writing tools are blocked.
- **Deny rules in every phase:** `secrets.yaml` (in every folder), `.storage/auth*`,
  `.storage/core.config_entries` and `.storage/*credential*` (for example `application_credentials`),
  the login of Claude, the snapshot repository, `/proc` and the add-on code are closed for reading and
  editing; `curl`, `wget` and `nc` are closed in the shell. `cfg-git` checks every argument (no options
  that write files or run programs), leaves these files out of every diff, log and listing and refuses
  them when they are named.
- **No Supervisor token for Claude:** neither Claude nor the terminal gets it. Each Claude call gets a
  token of its own for the proxy: read only in drafts and inspections; in an implementation it may also
  write, but never reaches the Supervisor API, the services `hassio.*`, `shell_command.*` and
  `homeassistant.stop`, users and logins, credentials of integrations, `execute_script` or the events
  of the add-on.
- **Internet:** web search, and WebFetch only for home-assistant.io, community.home-assistant.io,
  github.com and raw.githubusercontent.com.
- **From outside the board** (todo list, event `hausmeister_neues_ticket`, notification buttons): only
  active admins count, events of the add-on's own user are ignored. Each notification carries a random
  one-time code; a button works once and only on the latest notification of a ticket. At most 10 new
  tickets per hour. Immediate implementation from the todo list or an event only with the option
  `allow_immediate_from_outside`, otherwise the ticket gets a draft first.
- **Quota limit:** above `max_quota_percent` scheduled runs and immediate tickets from outside the board
  wait until the usage window resets.
- **Backup, watches, rollback:** before every implementation a git snapshot of the configuration (in
  `/data/configgit`, only root reads it, not part of HA backups) and, if turned on and the folder is not
  larger than `max_backup_gb`, a partial HA backup without the database. Afterwards the watches check the
  configuration, shrunk or deleted files and vanished or unavailable entities; "Roll back" sets the
  changed files back.
- **File rights:** the add-on does not change rights in the configuration folder of Home Assistant. (The
  only exception was a one-time repair in 0.8.2 that set `secrets.yaml` back to 0644 after 0.8.1 had made
  it 0600.)

What remains:

- **The implementation after your approval runs as root with a full shell.** It has to, to change
  `configuration.yaml` and the other files. Technically it can therefore reach everything in the
  container, including the Supervisor token (for example from the environment of the add-on process,
  with the role `manager`) and the network (for example with `python3` or `node` instead of `curl`).
  What protects you there is your approval of the draft, the rules for Claude, and the watches and
  rollback afterwards. **Only approve drafts you understand.** "Implement now" skips that approval, so
  use it only for small, clear tasks.
- **Prompt injection:** Claude reads texts from your installation (entity names, attributes, files, log
  lines, the knowledge file, comments). Such a text can contain instructions that steer Claude. A draft
  cannot change anything, but it can propose something harmful. Read drafts before you approve them.
- **The deny rules depend on Claude Code.** Home Assistant writes `secrets.yaml` and
  `.storage/core.config_entries` readable for all local users (0644), so the draft user could read them
  at file level; what keeps drafts away is the permission check of Claude Code and the restricted shell.
- **The terminal** in the board is a root shell for admins. It has no Supervisor token, but as root it
  could get it the same way as an implementation.
- **The snapshots contain `secrets.yaml`** and the credential stores of integrations, because a rollback
  needs them. They stay in `/data/configgit`, which is excluded from HA backups.

## Rules, watches and rollback in detail

- **Rules for Claude** (`app/prompt/regeln.en.md`, German `regeln.de.md`): never rewrite whole files,
  do not edit `.storage` directly (dashboards, automations, helpers and registries only through the
  API), do not switch devices, do not touch add-ons, updates, users or secrets, check the configuration
  before any reload or restart. These are instructions to the model; only the points listed above under
  security are enforced technically.
- **Watches after an implementation** compare the system with the state before: configuration check,
  YAML and dashboard files that shrank by more than 30 % or disappeared, entities that vanished or became
  unavailable (checked twice, to ignore restarts). New errors in the Home Assistant log are listed in the
  report as a hint.
- **Roll back** restores the files the implementation changed. Files that integrations rewrite on their
  own (Zigbee2MQTT state, login data of integrations, registries, event logs) are listed apart and never
  restored. If files in `.storage` are affected, Home Assistant Core is stopped for the restore and
  started again, otherwise it is restarted after a successful configuration check. Changes made only
  through the API (for example to a device in the registry) are listed in the report and have to be
  undone by hand.
- The Supervisor role `manager` of the add-on is the smallest role that covers backups, their jobs and
  stopping and starting Core.

## Updating from a version before 0.8

- Buttons in notifications from before 0.8.0 no longer work (they carry no one-time code). Use the board
  or the buttons of the next notification.
- Todo items starting with `sofort:`, `now:` or `!` and `modus: sofort` in events now give a draft,
  unless you turn on the option `allow_immediate_from_outside`.
- The event `hausmeister_neues_ticket` only counts with the user of an active admin. Automations triggered
  by a sensor run without a user; let them add an item to the todo list instead (`todo.add_item` on
  `todo.hausmeister`).
- The knowledge file is now `/data/wissen.md` inside the add-on (edit it in the terminal of the board).
  An existing `/share/hausmeister/WISSEN.md` is taken over once; after that the file in `/share` is only
  an export that is overwritten on start and after every run.

## Notifications with buttons

With `notify_service` set to a mobile app (for example `notify.mobile_app_phone`), each
notification carries buttons: for a draft "Implement now", "On the next run" and "Discard", for a
question "Answer" (with a text field), after an implementation "All good" and "Ask for a fix" (with
a text field; when the watches report something only "Ask for a fix"), after an error "Try again". Tapping the notification opens the board. Buttons only
count when pressed by an active Home Assistant admin and only on the latest notification of a ticket;
buttons of notifications from before 0.8.0 no longer work.

## Usage quota

Claude Code reports how much of the subscription is used. The board shows the highest window
(five hours or seven days). Above `max_quota_percent` (default 80) scheduled runs are skipped until
that window resets, so the subscription stays available for other work. Immediate tickets and "Run
now" from the board still run; immediate runs from the todo list, events and notification buttons
respect the limit.

## Watches between runs

On every scheduled run and on "Run now" the add-on also compares the configuration and the entities
with the previous run, independent of tickets: YAML files and files in `.storage` such as dashboards that shrank by more than 30 % or
disappeared, and ten or more vanished entities, raise a notification and a banner on the board.
After an implementation, new errors in the Home Assistant log are listed in the report.

## Suggestions ("What would I change?")

The tab **Suggestions** lists what the caretaker would change in your house: errors, security,
energy, comfort, cleanup and maintenance, each with a reason taken from your installation, benefit
and effort. Things a person has to do on site (a battery, a device) are marked "you do it yourself".
For each suggestion: "As ticket" (draft), "Implement now", "Just keep" or "Not needed"; for things
you do yourself "Done", "Keep as ticket" or "Not needed". Declined and taken suggestions are not
proposed again; "Bring back" restores a declined or done one.

Suggestions come from an inspection (read only): press "Look around now", or set `inspection_day`
(a weekday or `daily`) to run one with the run at the first configured run time of that day.

## Tickets from automations

Fire the event `hausmeister_neues_ticket` with `titel`, optional `text`, optional `modus`
(`entwurf` for a draft, `sofort` to implement now, `sammeln` to collect; without it `auto_draft`
decides between `entwurf` and `sammeln`) and optional `von`. The field names are the same in every
language (`title` and `mode` work as well):

```yaml
action: event.fire
data:
  event_type: hausmeister_neues_ticket
  event_data:
    titel: Humidity in the basement above 70 % for three days
    text: Please check whether the dehumidifier runs and set up a warning.
    modus: entwurf
```

The event only counts when it carries the user of an active admin, for example when it is fired
through the REST or WebSocket API with an admin's token. Automations triggered by a sensor run
without a user; for them add an item to the todo list instead (`todo.add_item` on
`todo.hausmeister`). `modus: sofort` implements right away only with `allow_immediate_from_outside`,
otherwise it creates a draft. At most 10 new tickets per hour come in from the todo list and events.

## Where things are

- Tickets: `/share/hausmeister/tickets/` (one Markdown file per ticket), state in the add-on data.
- Knowledge about your house that Claude keeps: `/data/wissen.md` inside the add-on (edit it in the
  terminal of the board). `/share/hausmeister/WISSEN.md` is a copy for reading and is overwritten on
  start and after every run; on the update to 0.8.0 an existing file there is taken over once.
- Snapshots: tab **Backups**; in the terminal `cfg-git log`. Separate repository `/data/configgit`
  (the HA config folder never becomes a repository). Left out: databases, logs, `deps/`, `tts/`,
  `backups/`, the login stores of Home Assistant (`.storage/auth`, `auth_provider.homeassistant`,
  `http.auth`), model folders such as `ollama/`, media, archives, images and files over 20 MB; the
  registries and dashboards in `.storage` are always included.

## Sensors

- `sensor.hausmeister_wartet_auf_dich`: tickets that need you (draft, question, acceptance, error).
- `sensor.hausmeister_offen`: all open tickets, with next run and result of the last run.

Entity IDs and attribute names stay the same in every language; the friendly names follow the
language. The sensors are recreated by the add-on after a restart of Home Assistant (within 15 minutes).

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `run_times` | 11:00, 16:00 | Times of the runs. |
| `auto_draft` | true | New tickets from the todo list and events without `modus` are drafted on the next run; off: only collected. |
| `max_tickets_per_run` | 5 | Upper limit per run. |
| `run_timeout_minutes` | 30 | Time limit per ticket. |
| `backup_before_change` | true | Partial HA backup before each implementation. |
| `intake_todo` | todo.hausmeister | Todo list for new tickets, empty turns it off. |
| `notify_service` | | e.g. `notify.mobile_app_phone`. |
| `model` | | e.g. `sonnet`, empty uses the default. |
| `max_quota_percent` | 80 | Scheduled runs and immediate tickets from outside the board pause above this subscription usage, 0 turns it off. |
| `max_backup_gb` | 2 | No HA backup before a change when the config folder is larger; the git snapshot still runs. |
| `inspection_day` | off | Inspection for suggestions: `off`, `daily` or a weekday (`mon` … `sun`). The German values `aus`, `taeglich` and `mo` … `so` still work. |
| `language` | auto | `auto` follows Home Assistant (German or English, otherwise English), `de` German, `en` English. |
| `allow_immediate_from_outside` | false | `sofort:`/`now:`/`!` in the todo list and `modus: sofort` in the event implement right away. Off: a draft first. The board and notification buttons are not affected. |

## Deutsch

Das Add-on führt ein kleines Ticket-Board für dein Home Assistant und lässt Claude Code die Tickets
in zwei Schritten bearbeiten: erst ein Entwurf, dann, nach deiner Freigabe, die Umsetzung.

Du brauchst ein Claude-Abo (Pro oder Max) oder ein Anthropic-Console-Konto (Abrechnung über die API,
ebenfalls bei `/login` wählbar). Jeder Lauf verbraucht Kontingent.

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
`sofort:`, `now:` oder `!` beginnen (zum Beispiel „sofort: Flurlicht auf 30 % dimmen“; die
To-do-Präfixe wirken nur mit der Option `allow_immediate_from_outside`, sonst bekommt der Eintrag
zuerst einen Entwurf). Claude plant und setzt dann in einem Zug um. Bei riskanten Änderungen (Löschen, größere Umbauten,
Schutzfunktionen, Heizung, Akkus, Wechselrichter) oder unklarem Ziel ändert es nichts und fragt mit
seinem Plan zurück. Sicherungen, Wächter und Zurückrollen gelten wie immer. An einem Ticket mit
Entwurf gedrückt, setzt es genau diesen Entwurf sofort um.

Läufe starten zu den eingestellten Zeiten. Steht nichts an, wird Claude gar nicht gestartet.
„Jetzt ausführen“ startet sofort einen Lauf.

### Sicherheit, ehrlich gesagt

Was das Add-on zum Schutz deiner Installation tut:

- **Nur über Home Assistant:** Board, API und Terminal antworten nur dem Ingress-Gateway des Supervisors
  (Prüfung der IP-Adresse) und Loopback; andere Add-ons im internen Netz bekommen 403. Das Panel gibt es
  nur für Home-Assistant-Admins.
- **Entwürfe und Rundgänge als eigener Benutzer:** Sie laufen als Benutzer `hausmeister` (uid 1001),
  nicht als root. Dieser Benutzer kann die Konfiguration nicht schreiben und die Add-on-Optionen, den
  Ticketzustand und das Sicherungs-Repository nicht lesen. Seine Shell ist eingeschränkt auf `ha-read`,
  `cfg-git`, `echo`, `printf` und `date`; `ha-read` und `cfg-git` laufen über einen lokalen Proxy im
  Add-on, und `ha-read` liest nur (GET-Anfragen, eine feste Liste von WebSocket-Befehlen, Vorlagen, die
  Konfigurationsprüfung, das Core-Log). Dateien liest Claude nur mit den Werkzeugen Read, Grep und Glob;
  die Schreibwerkzeuge sind gesperrt.
- **Sperrregeln in jeder Phase:** `secrets.yaml` (in jedem Ordner), `.storage/auth*`,
  `.storage/core.config_entries` und `.storage/*credential*` (zum Beispiel `application_credentials`),
  die Anmeldung von Claude, das Sicherungs-Repository, `/proc` und der Code des Add-ons sind zum Lesen
  und Bearbeiten gesperrt; `curl`, `wget` und `nc` sind in der Shell gesperrt. `cfg-git` prüft jedes
  Argument (keine Optionen, die Dateien schreiben oder Programme starten), lässt diese Dateien in jedem
  Diff, Log und jeder Liste aus und lehnt sie ab, wenn sie genannt werden.
- **Kein Supervisor-Token für Claude:** Weder Claude noch das Terminal bekommen es. Jeder Claude-Aufruf
  bekommt ein eigenes Token für den Proxy: im Entwurf und Rundgang nur lesend; in der Umsetzung auch
  schreibend, aber nie an die Supervisor-API, die Dienste `hassio.*`, `shell_command.*` und
  `homeassistant.stop`, Benutzer und Anmeldungen, Anmeldedaten von Integrationen, `execute_script` oder
  die Ereignisse des Add-ons.
- **Internet:** Websuche, und WebFetch nur für home-assistant.io, community.home-assistant.io,
  github.com und raw.githubusercontent.com.
- **Von außerhalb des Boards** (To-do-Liste, Ereignis `hausmeister_neues_ticket`, Knöpfe in Meldungen):
  Es zählen nur aktive Admins, Ereignisse des eigenen Benutzers des Add-ons werden ignoriert. Jede
  Meldung trägt einen zufälligen Einmal-Code; ein Knopf wirkt einmal und nur an der neuesten Meldung
  eines Tickets. Höchstens 10 neue Tickets je Stunde. Sofort-Umsetzung aus der To-do-Liste oder per
  Ereignis nur mit der Option `allow_immediate_from_outside`, sonst bekommt das Ticket zuerst einen
  Entwurf.
- **Kontingentgrenze:** Über `max_quota_percent` warten geplante Läufe und Sofort-Tickets von außerhalb
  des Boards, bis das Fenster erneuert ist.
- **Sicherung, Wächter, Zurückrollen:** Vor jeder Umsetzung ein Git-Schnappschuss der Konfiguration (in
  `/data/configgit`, nur root liest ihn, nicht in HA-Sicherungen) und, wenn eingeschaltet und der Ordner
  nicht größer als `max_backup_gb` ist, eine HA-Teilsicherung ohne Datenbank. Danach prüfen die Wächter
  Konfiguration, geschrumpfte oder gelöschte Dateien und verschwundene oder nicht mehr verfügbare
  Entitäten; „Zurückrollen“ setzt die geänderten Dateien zurück.
- **Dateirechte:** Das Add-on ändert keine Rechte im Konfigurationsordner von Home Assistant. (Einzige
  Ausnahme war eine einmalige Reparatur in 0.8.2, die `secrets.yaml` wieder auf 0644 gesetzt hat,
  nachdem 0.8.1 sie auf 0600 gestellt hatte.)

Was bleibt:

- **Die Umsetzung nach deiner Freigabe läuft als root mit voller Shell.** Das muss sie, um
  `configuration.yaml` und die anderen Dateien zu ändern. Technisch kommt sie damit an alles im
  Container, auch an das Supervisor-Token (zum Beispiel über die Umgebung des Add-on-Prozesses, mit der
  Rolle `manager`) und ans Netzwerk (zum Beispiel mit `python3` oder `node` statt `curl`). Schutz bieten
  dort deine Freigabe des Entwurfs, die Regeln für Claude und danach Wächter und Zurückrollen. **Gib nur
  Entwürfe frei, die du verstehst.** „Sofort umsetzen“ überspringt diese Freigabe, also nur für kleine,
  klare Aufgaben nutzen.
- **Prompt-Injection:** Claude liest Texte aus deiner Installation (Entitätsnamen, Attribute, Dateien,
  Logzeilen, die Wissensdatei, Kommentare). So ein Text kann Anweisungen enthalten, die Claude lenken.
  Ein Entwurf kann nichts ändern, aber etwas Schädliches vorschlagen. Lies Entwürfe, bevor du sie
  freigibst.
- **Die Sperrregeln hängen an Claude Code.** Home Assistant schreibt `secrets.yaml` und
  `.storage/core.config_entries` für alle lokalen Benutzer lesbar (0644), der Entwurfsbenutzer könnte sie
  auf Dateiebene also lesen; Entwürfe hält die Rechteprüfung von Claude Code zusammen mit der
  eingeschränkten Shell davon fern.
- **Das Terminal** im Board ist eine root-Shell für Admins. Es hat kein Supervisor-Token, käme als root
  aber genauso daran wie eine Umsetzung.
- **Die Schnappschüsse enthalten `secrets.yaml`** und die Anmeldedaten von Integrationen, weil das
  Zurückrollen sie braucht. Sie bleiben in `/data/configgit`, das aus HA-Sicherungen ausgenommen ist.

### Regeln, Wächter und Zurückrollen im Einzelnen

- **Regeln für Claude** (`app/prompt/regeln.de.md`, englisch `regeln.en.md`): keine ganzen Dateien neu
  schreiben, `.storage` nicht direkt ändern (Dashboards, Automationen, Helfer und Registries nur über die
  API), keine Geräte schalten, keine Add-ons, Updates, Benutzer oder Geheimnisse anfassen, vor jedem
  Neuladen oder Neustart die Konfiguration prüfen. Das sind Anweisungen an das Modell; technisch
  erzwungen ist nur, was oben unter Sicherheit steht.
- **Wächter nach einer Umsetzung** vergleichen das System mit dem Stand vorher: Konfigurationsprüfung,
  YAML- und Dashboard-Dateien, die um mehr als 30 % geschrumpft oder verschwunden sind, Entitäten, die
  verschwunden oder nicht mehr verfügbar sind (zweimal geprüft, damit Neustarts nicht zählen). Neue
  Fehler im Home-Assistant-Log stehen als Hinweis im Bericht.
- **Zurückrollen** setzt die Dateien der Umsetzung zurück. Dateien, die Integrationen nebenbei ständig
  neu schreiben (Zigbee2MQTT-Zustand, Anmeldedaten von Integrationen, Registries,
  Ereignisprotokolle), werden getrennt angezeigt und nie zurückgesetzt. Sind Dateien in `.storage`
  betroffen, wird Home Assistant Core dafür gestoppt und wieder gestartet, sonst nach erfolgreicher
  Prüfung neu gestartet. Änderungen nur über die API (zum Beispiel an einem Gerät in der Registry)
  stehen im Bericht und müssen von Hand zurückgenommen werden.
- Die Supervisor-Rolle `manager` des Add-ons ist die kleinste Rolle, die Sicherungen, deren Jobs und
  das Stoppen und Starten von Core abdeckt.

### Update von einer Version vor 0.8

- Knöpfe in Meldungen von vor 0.8.0 wirken nicht mehr (sie tragen keinen Einmal-Code). Nutze das Board
  oder die Knöpfe der nächsten Meldung.
- To-do-Einträge, die mit `sofort:`, `now:` oder `!` beginnen, und `modus: sofort` in Ereignissen ergeben
  jetzt einen Entwurf, außer du schaltest die Option `allow_immediate_from_outside` ein.
- Das Ereignis `hausmeister_neues_ticket` zählt nur mit dem Benutzer eines aktiven Admins. Automationen,
  die ein Sensor auslöst, laufen ohne Benutzer; lass sie stattdessen einen Eintrag in die To-do-Liste
  schreiben (`todo.add_item` auf `todo.hausmeister`).
- Die Wissensdatei ist jetzt `/data/wissen.md` im Add-on (im Terminal des Boards bearbeiten). Eine
  vorhandene `/share/hausmeister/WISSEN.md` wird einmal übernommen; danach ist die Datei in `/share` nur
  noch ein Export, der beim Start und nach jedem Lauf überschrieben wird.

### Benachrichtigungen mit Knöpfen

Ist `notify_service` auf eine Handy-App gesetzt (zum Beispiel `notify.mobile_app_handy`), hat jede
Meldung Knöpfe: beim Entwurf „Jetzt umsetzen“, „Beim nächsten Lauf“ und „Verwerfen“, bei einer
Rückfrage „Antworten“ (mit Textfeld), nach einer Umsetzung „Passt“ und „Nachbessern“ (mit
Textfeld; melden die Wächter etwas, nur „Nachbessern“), nach einem Fehler „Erneut versuchen“. Ein Tipp auf die Meldung öffnet das Board. Knöpfe
zählen nur, wenn ein aktiver Home-Assistant-Admin sie drückt, und nur an der neuesten Meldung eines
Tickets; Knöpfe aus Meldungen von vor 0.8.0 wirken nicht mehr.

### Kontingent

Claude Code meldet, wie viel vom Abo verbraucht ist. Das Board zeigt das höchste Fenster (fünf
Stunden oder sieben Tage). Über `max_quota_percent` (Vorgabe 80) fallen geplante Läufe aus, bis das
Fenster erneuert ist, damit das Abo für anderes frei bleibt. Sofort-Tickets und „Jetzt ausführen“ aus
dem Board laufen trotzdem; Sofort-Läufe aus der To-do-Liste, aus Ereignissen und von Knöpfen halten
die Grenze ein.

### Wächter zwischen den Läufen

Bei jedem geplanten Lauf und bei „Jetzt ausführen“ vergleicht das Add-on auch ohne Ticket die
Konfiguration und die Entitäten mit dem vorigen Lauf: YAML-Dateien und Dateien in `.storage` wie
Dashboards, die um mehr als 30 % geschrumpft oder
verschwunden sind, und zehn oder mehr verschwundene Entitäten lösen eine Meldung und einen Hinweis
im Board aus. Nach einer Umsetzung stehen neue Fehler im Home-Assistant-Log im Bericht.

### Vorschläge („Was würde ich anpassen?“)

Der Reiter **Vorschläge** zeigt, was der Hausmeister an deinem Haus ändern würde: Fehler,
Sicherheit, Energie, Komfort, Aufräumen und Wartung, je mit Begründung aus deiner Installation,
Nutzen und Aufwand. Was ein Mensch vor Ort tun muss (Batterie, Gerät), ist als „machst du selbst“
markiert. Pro Vorschlag: „Als Ticket“ (Entwurf), „Sofort umsetzen“, „Nur merken“ oder „Nicht
nötig“; bei Dingen, die du selbst machst, „Erledigt“, „Als Ticket merken“ oder „Nicht nötig“.
Abgelehnte und übernommene Vorschläge kommen nicht wieder; „Zurückholen“ holt einen abgelehnten oder
erledigten zurück.

Vorschläge entstehen bei einem Rundgang (nur lesend): „Jetzt umschauen“ drücken oder
`inspection_day` setzen (ein Wochentag oder `daily`), dann läuft er mit dem Lauf zur ersten
eingestellten Laufzeit des Tages.

### Tickets aus Automationen

Das Ereignis `hausmeister_neues_ticket` mit `titel`, optional `text`, optional `modus` (`entwurf`,
`sofort`, `sammeln`; ohne `modus` entscheidet `auto_draft` zwischen `entwurf` und `sammeln`) und
optional `von` auslösen (`title` und `mode` gehen auch):

```yaml
action: event.fire
data:
  event_type: hausmeister_neues_ticket
  event_data:
    titel: Luftfeuchte im Keller seit drei Tagen über 70 %
    text: Bitte prüfen, ob der Entfeuchter läuft, und eine Warnung einrichten.
    modus: entwurf
```

Das Ereignis zählt nur, wenn es den Benutzer eines aktiven Admins trägt, zum Beispiel ausgelöst über
die REST- oder WebSocket-API mit dem Token eines Admins. Automationen, die ein Sensor auslöst, laufen
ohne Benutzer; dafür besser einen Eintrag in die To-do-Liste schreiben (`todo.add_item` auf
`todo.hausmeister`). `modus: sofort` setzt nur mit `allow_immediate_from_outside` sofort um, sonst
entsteht ein Entwurf. Aus To-do-Liste und Ereignissen kommen höchstens 10 neue Tickets je Stunde.

### Wo was liegt

- Tickets: `/share/hausmeister/tickets/` (eine Markdown-Datei je Ticket), der Zustand in den
  Add-on-Daten.
- Wissen über dein Haus, das Claude pflegt: `/data/wissen.md` im Add-on (im Terminal des Boards
  bearbeiten). `/share/hausmeister/WISSEN.md` ist eine Kopie zum Lesen und wird beim Start und nach
  jedem Lauf überschrieben; beim Update auf 0.8.0 wird eine vorhandene Datei dort einmal übernommen.
- Sicherungen: Reiter **Sicherungen**; im Terminal `cfg-git log`. Eigenes Repository `/data/configgit`
  (der HA-Konfigurationsordner wird nie selbst zum Repository). Ausgelassen: Datenbanken, Logs,
  `deps/`, `tts/`, `backups/`, die Anmeldespeicher von Home Assistant (`.storage/auth`,
  `auth_provider.homeassistant`, `http.auth`), Modellordner wie `ollama/`, Medien, Archive, Bilder und
  Dateien über 20 MB; die Registries und Dashboards in `.storage` sind immer dabei.

### Sensoren

- `sensor.hausmeister_wartet_auf_dich`: Tickets, die dich brauchen (Entwurf, Rückfrage, Abnahme, Fehler).
- `sensor.hausmeister_offen`: alle offenen Tickets, mit nächstem Lauf und Ergebnis des letzten Laufs.

Entitäts-IDs und Attributnamen sind in jeder Sprache gleich, die Anzeigenamen folgen der Sprache.
Nach einem Neustart von Home Assistant legt das Add-on die Sensoren innerhalb von 15 Minuten neu an.

### Einstellungen

| Option | Vorgabe | Bedeutung |
| --- | --- | --- |
| `run_times` | 11:00, 16:00 | Zeiten der Läufe. |
| `auto_draft` | true | Neue Tickets aus der To-do-Liste und Ereignisse ohne `modus` bekommen beim nächsten Lauf einen Entwurf; aus: nur gesammelt. |
| `max_tickets_per_run` | 5 | Höchstens so viele Tickets je Lauf. |
| `run_timeout_minutes` | 30 | Zeitgrenze je Ticket. |
| `backup_before_change` | true | HA-Teilsicherung vor jeder Umsetzung. |
| `intake_todo` | todo.hausmeister | To-do-Liste für neue Tickets, leer schaltet aus. |
| `notify_service` | | z. B. `notify.mobile_app_handy`. |
| `model` | | z. B. `sonnet`, leer = Vorgabe. |
| `max_quota_percent` | 80 | Geplante Läufe und Sofort-Tickets von außerhalb des Boards pausieren über dieser Abo-Auslastung, 0 schaltet aus. |
| `max_backup_gb` | 2 | Keine HA-Sicherung vor einer Änderung, wenn der Konfigurationsordner größer ist; die Git-Sicherung läuft trotzdem. |
| `inspection_day` | off | Rundgang für Vorschläge: `off`, `daily` oder ein Wochentag (`mon` … `sun`). Die deutschen Werte `aus`, `taeglich` und `mo` … `so` gelten weiter. |
| `language` | auto | `auto` folgt Home Assistant (Deutsch oder Englisch, sonst Englisch), `de` Deutsch, `en` Englisch. |
| `allow_immediate_from_outside` | false | `sofort:`/`now:`/`!` in der To-do-Liste und `modus: sofort` im Ereignis setzen sofort um. Aus: zuerst ein Entwurf. Board und Knöpfe in Meldungen sind nicht betroffen. |
