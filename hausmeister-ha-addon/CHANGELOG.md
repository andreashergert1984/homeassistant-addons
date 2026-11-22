## 0.1.2

- Sicherung lässt Modellordner (ollama), Medien, ESPHome-Builds und Dateien über 20 MB aus; Registries in .storage werden immer gesichert.
- Sensoren erscheinen gleich nach dem Start, nicht erst nach der ersten Sicherung.

## 0.1.1

- Basisimage direkt im Dockerfile (build.yaml entfernt), damit der Supervisor das Image baut.

## 0.1.0

- Erste Version: Ticket-Board in der Seitenleiste, Übernahme aus der To-do-Liste, Läufe zu festen Zeiten mit Vorprüfung, Entwurf nur lesend, Umsetzung nach Freigabe, Git-Sicherung und HA-Teilsicherung vor jeder Umsetzung, drei Wächter, Zurückrollen, Anmeldung über das Terminal im Add-on, Claude Code 2.1.326.
