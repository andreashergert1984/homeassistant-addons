# Hausmeister

Smart home tickets that [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) works on after you approve them.
Everything runs inside this add-on on your Home Assistant host, including the Claude login.

- Collect wishes and problems on the todo list "Hausmeister" (also by voice) or on the board in the sidebar.
- At fixed times Claude writes a **draft** (read only). Nothing changes until you press **"Claude soll umsetzen"**.
- Before every change: snapshot of the configuration and a partial HA backup. Afterwards three watches
  check the configuration, shrunk or deleted files and entities that vanished or became unavailable.
- One click rolls an implementation back.

The user interface is in German. See [DOCS.md](DOCS.md).
