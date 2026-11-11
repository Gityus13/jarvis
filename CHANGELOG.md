# Changelog

## 4.0.1
**Neural voice now starts by itself.** The greeting waits (up to 9 s) for Kokoro when it is still loading instead of using the system voice; one shared `<audio>` element is unlocked by the boot key press, so Safari no longer silently blocks the first Kokoro lines; the "Kokoro unavailable" state recovers on its own and the page re-checks the engine whenever a line falls back. Short, repeated lines (wake acknowledgements, "Done, sir.") are cached and pre-generated in the background, so they play instantly.

**Switching tabs no longer breaks the microphone.** The mic is released while the tab is hidden and resumes when you return. A `not-allowed` error is verified against the permissions API instead of being assumed to mean "blocked" (browsers also raise it for background tabs), and a blocked mic can be retried by clicking the MIC indicator — no reload.

**Returning to the tab** reconnects immediately, refreshes telemetry/status/intel, and timer alerts that fire while you're elsewhere flash the page title (and can pop a desktop notification — enable in CONFIG).

Also: SYSTEMS warns when you are in Safari (and how to fix voice there); SPACE no longer clicks a focused button; Safari CSS prefixes; `test/lifecycle.test.js` (tab switching, audio locking, startup-while-loading) with a reusable browser harness.

## 4.0.0
**New console.** Tactical interface rebuilt from scratch: live telemetry, animated core, intel panels, command palette (`Ctrl+K`), boot diagnostics, SYSTEMS panel with fixes.

**Skills (all free, no keys):** daily briefing, weather, news, crypto + FX, translate, Wikipedia, dictionary, time zones, timers/reminders/alarms, tasks, notes, system status, music control, file search, clipboard AI, calculator, unit converter, password generator, dice.

**Voice:** rewritten speech engine — the mic never listens while JARVIS speaks, fuzzy wake word, command in the same breath, hold-to-talk waits for your last word. Kokoro neural voice with progress, stall detection, warm-up, mirror support and `npm run kokoro-test`; falls back to the system voice automatically.

**Fixes:** built-in commands no longer run twice; typed text keeps its capitalisation; calendar events work; memory persists across reconnects; non-ASCII text survives streaming; many Mac-control bugs.

**Security:** localhost-only server with Origin/Host checks (a website can no longer drive your Mac), no shell/AppleScript injection, URL and path validation.

**Project:** `npm test` (140+ tests), `npm run doctor`, `setup.sh`, plugin system, CI.
