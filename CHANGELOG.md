# Changelog

## 4.0.9
**Listening and conversational routing rebuilt.** Jarvis now captures a native
dictation command after the wake word, sends that exact text through the
offline conversation/unit skills or local AI, and no longer falls through into
unrelated conversions for questions such as "how are you". AI-generated
clipboard actions are normalized at both routing and server execution boundaries.

## 4.0.8
**Clipboard action alias and native dictation startup fixed.** AI-generated
`system.command=get_clipboard` actions are normalized to the real clipboard
action instead of producing an unknown system command. Native dictation startup
now reports exact permission/helper failures, and the app bundle declares
macOS Microphone and Speech Recognition usage descriptions.

## 4.0.7
**Native voice and startup fixed.** Jarvis.app starts a locally installed
Ollama server automatically, offers Ollama setup in the app menu, and uses
Apple's native on-device macOS dictation instead of Google speech recognition.
Accessibility and Calendar diagnostics now refer to Jarvis.app instead of Node
or Terminal.

## 4.0.6
**macOS installation repaired.** The macOS ARM64 app bundle is ad-hoc signed
during packaging to prevent macOS from reporting a damaged unsigned app. The
release workflow is retry-safe and documents the `Open Anyway` fallback for
downloads that retain Gatekeeper quarantine metadata.

## 4.0.5
**Desktop voice listening fixed.** Jarvis now asks macOS for microphone access
on startup, keeps the microphone stream warm for speech level/meters, and
retries microphone access through the Jarvis menu and MIC control. Electron
voice recognition remains available on macOS ARM64, with graceful blocked/
missing-device errors.

## 4.0.4
**DMG release publishing corrected.** macOS builds disable electron-builder's
implicit GitHub publishing; the workflow explicitly uploads the unsigned DMG
to the tagged GitHub release.

## 4.0.3
**Desktop branding corrected.** The macOS application, executable, bundle
identifier, DMG, menus, and user plugin directory now use **Jarvis**. The
GitHub repository remains `Gityus13/jarviis`.

## 4.0.2
**Packaged macOS plugin paths fixed.** The app now reads bundled plugins from
the application resources and creates/loads user plugins under
`app.getPath("userData")/plugins` instead of trying to write inside `app.asar`.
Missing, unreadable, and invalid plugins are skipped safely; user plugins may
override bundled plugins with the same name.

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
