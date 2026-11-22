## 0.3.0

- Push-Benachrichtigungen mit Knöpfen (Jetzt umsetzen, Verwerfen, Antworten, Passt, Nachbessern, Erneut versuchen); Tippen öffnet das Board.
- Live-Fortschritt: das Board zeigt, was Claude gerade tut; jeder Bericht enthält die Schritte.
- Kontingentschutz: Auslastung des Abos sichtbar, geplante Läufe pausieren über der Grenze (Vorgabe 80 %).
- Wächter zwischen den Läufen (geschrumpfte Dateien, viele verschwundene Entitäten) und neue Fehler im HA-Log nach einer Umsetzung.
- Tickets aus Automationen über das Ereignis hausmeister_neues_ticket.
- Optionaler Rundgang (Wochentag oder täglich): nur lesend, bis zu fünf Vorschläge als neue Tickets.

## 0.2.0

- Sofort umsetzen: beim Anlegen, als Knopf im Ticket oder per To-do-Eintrag mit „sofort:“ oder „!“. Startet gleich, ohne auf den Zeitplan zu warten; ohne Entwurf plant und setzt Claude in einem Lauf um und fragt bei riskanten Änderungen nach. Andere wartende Tickets bleiben beim Zeitplan.

## 0.1.3

- Entwurf: weitere lesende Befehle erlaubt (echo, cat, sort, uniq, cut, tr, date, printf), Regeln nennen die erlaubten Befehle ausdrücklich.

## 0.1.2

- Sicherung lässt Modellordner (ollama), Medien, ESPHome-Builds und Dateien über 20 MB aus; Registries in .storage werden immer gesichert.
- Sensoren erscheinen gleich nach dem Start, nicht erst nach der ersten Sicherung.

## 0.1.1

- Basisimage direkt im Dockerfile (build.yaml entfernt), damit der Supervisor das Image baut.

## 0.1.0

- Erste Version: Ticket-Board in der Seitenleiste, Übernahme aus der To-do-Liste, Läufe zu festen Zeiten mit Vorprüfung, Entwurf nur lesend, Umsetzung nach Freigabe, Git-Sicherung und HA-Teilsicherung vor jeder Umsetzung, drei Wächter, Zurückrollen, Anmeldung über das Terminal im Add-on, Claude Code 2.1.326.
