# Changelog

## 4.0.0
**New console.** Tactical interface rebuilt from scratch: live telemetry, animated core, intel panels, command palette (`Ctrl+K`), boot diagnostics, SYSTEMS panel with fixes.

**Skills (all free, no keys):** daily briefing, weather, news, crypto + FX, translate, Wikipedia, dictionary, time zones, timers/reminders/alarms, tasks, notes, system status, music control, file search, clipboard AI, calculator, unit converter, password generator, dice.

**Voice:** rewritten speech engine — the mic never listens while JARVIS speaks, fuzzy wake word, command in the same breath, hold-to-talk waits for your last word. Kokoro neural voice with progress, stall detection, warm-up, mirror support and `npm run kokoro-test`; falls back to the system voice automatically.

**Fixes:** built-in commands no longer run twice; typed text keeps its capitalisation; calendar events work; memory persists across reconnects; non-ASCII text survives streaming; many Mac-control bugs.

**Security:** localhost-only server with Origin/Host checks (a website can no longer drive your Mac), no shell/AppleScript injection, URL and path validation.

**Project:** `npm test` (140+ tests), `npm run doctor`, `setup.sh`, plugin system, CI.
