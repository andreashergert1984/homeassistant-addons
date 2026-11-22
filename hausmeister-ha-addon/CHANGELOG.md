## 0.5.1

- Keine HA-Sicherung vor einer Umsetzung, wenn der Konfigurationsordner größer als max_backup_gb ist (Vorgabe 2 GB); eine Teilsicherung enthält immer den ganzen Ordner und dauert dann sehr lange. Die Git-Sicherung läuft weiter.
- Das Board zeigt auch die Vorbereitung einer Umsetzung (Zustand lesen, Git-Sicherung, HA-Sicherung) statt nur „startet“.

## 0.5.0

- Neuer Reiter „Vorschläge“: Was würde ich anpassen? Fehler, Sicherheit, Energie, Komfort, Aufräumen, Wartung, je mit Begründung, Nutzen und Aufwand. Übernehmen als Ticket, sofort umsetzen, merken oder ablehnen; Abgelehntes kommt nicht wieder. Handarbeit ist als „machst du selbst“ markiert.
- „Jetzt umschauen“ startet einen Rundgang sofort; der regelmäßige Rundgang füllt die Vorschläge statt direkt Tickets anzulegen.
- Eingabefelder in normaler Schrift.

## 0.4.0

- Neues Design: Kennzahlen oben (wartet auf dich, in Arbeit, erledigt, Kontingent), Karten mit Farbstreifen, Herkunft und relativer Zeit, Live-Streifen während Claude arbeitet.
- Ticket mit Fortschrittsleiste (Eingang, Entwurf, Freigabe, Umsetzung, Abnahme), Ergebnisse als Zeitleiste, Kommentare als Sprechblasen.
- Modus beim Anlegen als Auswahlkarten, schwebender Plus-Knopf auf dem Handy, dunkler Modus überarbeitet.

## 0.3.1

- Rückfrage steht oben im Ticket, „Antwort senden“ ist hervorgehoben; Reiterleiste ohne Scrollbalken auf dem Handy.
- README mit Bildern und Anleitung.

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
