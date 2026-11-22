# Hausmeister

**Wünsche und Probleme im Smart Home aufschreiben, Claude Code kümmert sich darum, du gibst frei.**

Der Hausmeister ist ein Home-Assistant-Add-on mit einem kleinen Ticket-Board. Tickets kommen über eine
To-do-Liste (auch per Sprache), das Board oder eine Automation. Zu festen Zeiten schaut sich
[Claude Code](https://docs.claude.com/en/docs/claude-code/overview) die Installation an, schreibt einen
Entwurf und setzt ihn erst um, wenn du ihn freigibst. Vorher wird gesichert, danach prüfen Wächter,
ob etwas kaputtgegangen ist, und mit einem Knopf ist alles wieder zurückgerollt.

Alles läuft im Add-on auf deinem Home-Assistant-Rechner, auch die Anmeldung bei Claude. Es braucht
keinen weiteren Rechner.

> The user interface is German. A short English summary is at the end.

![Ticket-Board](https://raw.githubusercontent.com/andreashergert1984/homeassistant-addons/main/hausmeister-ha-addon/images/board.png)

## Was es kann

- **Tickets von überall:** To-do-Liste „Hausmeister“ (auch per Assist), Board in der Seitenleiste, Ereignis
  `hausmeister_neues_ticket` aus Automationen.
- **Erst Entwurf, dann Umsetzung:** Im Entwurf darf Claude nur lesen. Geändert wird erst nach „Claude soll umsetzen“.
- **Sofort umsetzen**, wenn es schnell gehen soll: ohne Entwurfsfreigabe und ohne auf den Zeitplan zu warten.
  Bei riskanten Dingen fragt Claude trotzdem nach.
- **Sicherung vor jeder Änderung:** Schnappschuss der Konfiguration und eine HA-Teilsicherung ohne Datenbank.
- **Wächter:** Konfigurationsprüfung, geschrumpfte oder gelöschte Dateien, verschwundene oder nicht mehr
  verfügbare Entitäten, neue Fehler im Log. Auch zwischen den Läufen, wenn etwas anderes etwas kaputt macht.
- **Zurückrollen** mit einem Knopf.
- **Push-Meldungen mit Knöpfen:** freigeben, abnehmen, nachbessern oder eine Rückfrage beantworten, direkt
  aus der Benachrichtigung auf dem Handy.
- **Live-Fortschritt:** Du siehst, was Claude gerade tut.
- **Kontingentschutz:** Der Hausmeister liest die Auslastung deines Claude-Abos mit und pausiert geplante
  Läufe ab einer Grenze, damit für deine andere Arbeit genug übrig bleibt.
- **Rundgang (optional):** einmal pro Woche oder täglich nach Problemen suchen und Tickets vorschlagen.
- **Doku je Ticket** als Markdown unter `/share/hausmeister/tickets/`, dazu eine Wissensdatei über dein Haus.

## So sieht es aus

| Entwurf zum Freigeben | Neues Ticket |
| --- | --- |
| ![Entwurf](https://raw.githubusercontent.com/andreashergert1984/homeassistant-addons/main/hausmeister-ha-addon/images/entwurf.png) | ![Neues Ticket](https://raw.githubusercontent.com/andreashergert1984/homeassistant-addons/main/hausmeister-ha-addon/images/neues-ticket.png) |

**Auf dem Handy** (hier im dunklen Modus): Übersicht mit Kennzahlen und eine Rückfrage von Claude. Die Antwort
geht über das Feld im Ticket oder direkt aus der Push-Meldung.

<p>
<img src="https://raw.githubusercontent.com/andreashergert1984/homeassistant-addons/main/hausmeister-ha-addon/images/handy-liste.png" alt="Ticketliste auf dem Handy" width="260">
&nbsp;
<img src="https://raw.githubusercontent.com/andreashergert1984/homeassistant-addons/main/hausmeister-ha-addon/images/handy-rueckfrage.png" alt="Rückfrage auf dem Handy" width="260">
</p>

Die Bilder zeigen erfundene Beispieltickets.

## Voraussetzungen

- Home Assistant OS oder Supervised (Add-ons), amd64 oder aarch64.
- Ein Claude-Abo (Pro oder Max) oder ein Anthropic-API-Schlüssel. Jeder Lauf verbraucht Kontingent.
  Steht nichts an, wird Claude gar nicht gestartet.

## Installation

1. In Home Assistant: **Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories**, diese Adresse eintragen:
   `https://github.com/andreashergert1984/homeassistant-addons`
2. **Hausmeister** installieren. Das Image wird auf deinem Rechner gebaut, das dauert ein paar Minuten.
3. Im Reiter **Info** „In der Seitenleiste anzeigen“ einschalten und das Add-on starten.
4. Optional: unter **Einstellungen → Geräte & Dienste → Integration hinzufügen → Lokale To-do-Liste** eine
   Liste namens **Hausmeister** anlegen (`todo.hausmeister`).

## Bei Claude anmelden

1. In der Seitenleiste **Hausmeister** öffnen, Reiter **Anmeldung**.
2. Im Terminal `claude` eingeben, dann `/login`.
3. „Claude account with subscription“ wählen, den Link im Browser öffnen, den Code zurück ins Terminal kopieren.
4. Mit `/exit` beenden. Oben im Board steht jetzt „Claude angemeldet“.

Die Anmeldung liegt im Add-on und ist aus den Home-Assistant-Sicherungen ausgenommen (die landen oft in der
Cloud). Nach dem Wiederherstellen einer Sicherung meldest du dich einmal neu an.

## Benutzen

**Ticket anlegen**, zum Beispiel auf die To-do-Liste „Hausmeister“: „Flurlicht nachts nur gedimmt einschalten“.
Beim nächsten Lauf schreibt Claude einen Entwurf, du bekommst eine Meldung.

**Entwurf lesen und entscheiden:**

| Knopf | Wirkung |
| --- | --- |
| Claude soll umsetzen | wird beim nächsten Lauf umgesetzt |
| Sofort umsetzen | wird jetzt umgesetzt |
| Claude soll entwerfen | neuer Entwurf, deinen Kommentar vorher ins Feld schreiben |
| Verwerfen | Ticket schließen |

**Nach der Umsetzung:** „Abnehmen, passt“, „Nachbessern“ mit Kommentar oder „Zurückrollen“.

**Sofort umsetzen von unterwegs:** einen Eintrag mit `sofort:` oder `!` beginnen, zum Beispiel
„sofort: Weihnachtsbeleuchtung ab 17 Uhr einschalten“.

**Ticket aus einer Automation:**

```yaml
action: event.fire
data:
  event_type: hausmeister_neues_ticket
  event_data:
    titel: Luftfeuchte im Keller seit drei Tagen über 70 %
    text: Bitte prüfen, ob der Entfeuchter läuft, und eine Warnung einrichten.
    modus: entwurf   # entwurf, sofort oder sammeln
```

**Sensoren für Dashboards:** `sensor.hausmeister_wartet_auf_dich` (Tickets, die dich brauchen) und
`sensor.hausmeister_offen` (alle offenen, mit nächstem Lauf, Kontingent und aktuellem Schritt).

## Einstellungen

| Option | Vorgabe | Bedeutung |
| --- | --- | --- |
| `run_times` | 11:00, 16:00 | Zeiten der Läufe |
| `auto_draft` | an | neue Tickets gleich entwerfen |
| `max_tickets_per_run` | 5 | höchstens so viele Tickets je Lauf |
| `run_timeout_minutes` | 30 | Zeitgrenze je Ticket |
| `backup_before_change` | an | HA-Teilsicherung vor jeder Umsetzung |
| `intake_todo` | todo.hausmeister | To-do-Liste für neue Tickets, leer schaltet aus |
| `notify_service` | | Push-Dienst, z. B. `notify.mobile_app_mein_handy` |
| `model` | | z. B. `sonnet` oder `opus`, leer = Vorgabe von Claude Code |
| `max_quota_percent` | 80 | geplante Läufe pausieren über dieser Abo-Auslastung, 0 = aus |
| `inspection_day` | aus | Rundgang: `aus`, `taeglich` oder `mo` … `so` |

## Sicherheit, ehrlich gesagt

- Claude bekommt feste Regeln: keine Datei komplett neu schreiben, `.storage` nur über die API ändern,
  keine Geräte schalten, keine Add-ons, Updates, Benutzer oder Geheimnisse anfassen, vor jedem Neustart die
  Konfiguration prüfen. Im Entwurf sind Schreibwerkzeuge technisch gesperrt.
- In der Umsetzung hat das Add-on Schreibzugriff auf die Konfiguration und die Supervisor-Rolle `manager`.
  Die Regeln sind eine starke Vorgabe für das Modell, aber keine Sandbox. **Gib nur Entwürfe frei, die du
  verstehst.** Für „Sofort umsetzen“ gilt das erst recht.
- Board und Terminal sind nur für Home-Assistant-Admins sichtbar.
- Sicherungen: eigener Git-Verlauf der Konfiguration (ohne Datenbanken, Logs, Anmeldedaten, Modellordner und
  Dateien über 20 MB) und, wenn eingeschaltet, eine HA-Teilsicherung vor jeder Umsetzung.

Ausführliche Doku: [DOCS.md](DOCS.md). Änderungen: [CHANGELOG.md](CHANGELOG.md).

## English summary

Hausmeister ("caretaker") is a Home Assistant add-on with a small ticket board. Claude Code, logged in
inside the add-on, drafts a change for each ticket (read only), and implements it after you approve it,
or immediately if you choose so. Every change is preceded by a configuration snapshot and a partial HA
backup and followed by watches (config check, shrunk files, vanished or unavailable entities, new log
errors). One click rolls it back. Notifications have action buttons, the board shows live progress, and
scheduled runs pause when your Claude subscription usage is above a limit. The UI is German.
