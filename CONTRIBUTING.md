# Contributing

Thanks for helping make JARVIS better! 

## Setup
```bash
git clone https://github.com/Gityus13/jarvis.git && cd jarvis
npm install
npm test            # 140+ tests, no internet / Ollama / microphone needed
npm run doctor      # checks your own install
```

## Where things live
| Want to add… | Edit |
|---|---|
| A voice/text **skill** (weather-style) | `src/skills/web.js` (online) or `local.js` (offline), register it in `src/skills/index.js`, add an example to `src/catalog.js` |
| A **Mac action** | `src/mac-control.js` (use `execFile`, never build shell strings) + a rule in `src/command-router.js` |
| A **personality** | `src/personalities.js` and the `[data-mode]` colours in `public/css/style.css` |
| Something small and personal | a **plugin** — see `plugins/README.md`; no core changes needed |

## Rules of the road
* **Free and key-less.** New online features must work without an account or API key.
* **Security first.** JARVIS controls a computer: no `exec` with interpolated strings, validate URLs/paths, keep the Origin/Host checks.
* **Fail loudly and kindly.** Network or permission problems should produce a clear message (and a fix in `src/diagnostics.js`), never a silent no-op.
* **Tests.** `test/helpers/fetch-mock.js` fakes every web API; `test/server.test.js` runs the real server against a fake Ollama.
* Keep the UI dependency-free (plain JS, no build step).

Open an issue first for big changes. Use the bug template and paste `npm run doctor`.
