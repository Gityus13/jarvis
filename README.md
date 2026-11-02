# J.A.R.V.I.S. — Tactical Intelligence Core

A private AI command console that runs on **your** machine: local LLM (Ollama), voice in / voice out,
live intel feeds, real system telemetry, and full Mac control. No cloud accounts. No API keys required.

![console](demo.png)

## Quick start

```bash
# 1. AI engine (once)
brew install ollama && ollama serve          # other OS: https://ollama.com
ollama pull llama3.2                         # or any model, then set OLLAMA_MODEL in .env

# 2. JARVIS
cp .env.example .env                         # set USER_NAME, HOME_CITY, model …
npm install
npm start
```

Open **http://localhost:3000** in **Chrome** (voice needs Chrome/Edge + the `localhost` address).
macOS permissions (keyboard, screenshots, calendar): `bash setup-permissions.sh`.

Optional neural voice: `npm i kokoro-js` — used automatically when installed (~90 MB model, downloaded once).

## The console

| Area | What it shows (all real data) |
|---|---|
| **Core** (centre) | Animated core that reacts to state: standby · listening (your mic level) · processing (radar sweep) · responding |
| **Telemetry** (left) | Live CPU / memory / disk / battery / network latency with sparklines, top processes, host info |
| **Intel** (right) | Weather, markets (crypto + FX), headlines (world / tech), tasks, timers with live countdowns, notes |
| **Feed** (centre) | Conversation, executed actions and result cards |
| **SYSTEMS** | Self-diagnostics: what works, what doesn't, and the exact fix |
| **COMMANDS** (`Ctrl+K`) | Searchable index of everything JARVIS can do |

Three operating modes — **JARVIS** (composed, dry), **FRIDAY** (fast, direct), **ULTRON** (cold, clinical) —
each with its own colour, voice and tone. Switch with the top bar, or say *"switch to Friday"*.

## Voice

* Say **"Hey Jarvis"** (also *Friday*, *Ultron*) — fuzzy matched, so *"Travis"* / *"jar vis"* work too.
  Say the command in the same breath (*"Jarvis, what's the weather"*) or wait for the acknowledgement.
* Or **hold SPACE** (or the mic button), speak, release.
* JARVIS never listens while it is speaking, so it can't hear itself.
* Voice output order: **Kokoro** (if installed) → **ElevenLabs** (if key set) → your system voice.

## What you can say

| | |
|---|---|
| **Briefing** | "daily briefing" · "good morning" — time, weather, tasks, calendar, top headline |
| **Weather** | "weather" · "weather in Tokyo" · "will it rain tomorrow" |
| **News** | "news" · "tech news" · "business news" · "science news" · "sport news" |
| **Markets** | "bitcoin price" · "crypto" · "convert 100 usd to azn" · "50 euros in manat" |
| **Knowledge** | "who is Nikola Tesla" · "define ephemeral" · "time in Tokyo" |
| **Translate** | "translate good morning to Azerbaijani" · "how do you say thank you in Turkish" |
| **Timers** | "timer for 10 minutes" · "remind me in 20 minutes to call mom" · "remind me at 5pm to …" · "alarm for 7:30" · "focus session" |
| **Tasks / notes** | "add task buy milk" · "my tasks" · "complete task 2" · "take a note: …" · "show my notes" |
| **System** | "system status" · "what's using my CPU" · "disk space" · "battery" · "wifi" · "my IP address" |
| **Music** | "play" · "pause" · "next song" · "what's playing" (Spotify / Apple Music) |
| **Files** | "find file resume.pdf" (click a result to open) · "create a folder called Projects" |
| **Clipboard AI** | "summarize my clipboard" · "fix my clipboard" · "translate my clipboard to Turkish" |
| **Utilities** | "calculate 15% of 240" · "convert 5 km to miles" · "generate a password" · "flip a coin" · "roll a d20" |
| **Mac control** | "open Spotify" · "close Chrome" · "screenshot" · "volume up" · "lock screen" · "snap Safari to the left" · "type …" · "press command shift 4" |
| **Anything else** | Goes to the local AI — it can also call every skill above on its own |

Timers, reminders and alarms keep running if you close the page and fire a spoken alert when you return.

## Free services used (no keys, no accounts)

Open-Meteo (weather + geocoding) · ipwho.is (location, IP) · CoinGecko (crypto) · open.er-api.com (FX rates) ·
BBC RSS + Hacker News (headlines) · Wikipedia · dictionaryapi.dev · MyMemory (translation).
Everything degrades gracefully offline — the console tells you what's unavailable instead of failing silently.

## Troubleshooting

Open **SYSTEMS** in the top bar — it checks the AI engine, microphone, speech recognition, internet,
keyboard/mouse control and macOS Accessibility permission, and prints the fix for anything that's off.

* **Mic not hearing you:** use Chrome at `http://localhost:3000`, allow the microphone. While waiting for the wake word
  the centre of the console shows `HEARD: "…"` — if that never changes, the mic isn't reaching Chrome.
  Chrome's speech recognition needs internet.
* **Typing / clicking does nothing:** grant **Accessibility** to the app that runs `node` (Terminal / iTerm / VS Code) in
  System Settings → Privacy & Security.
* **Calendar says access denied:** System Settings → Privacy → Calendars (and Automation) → allow your `node` binary.

## Configuration (`.env`)

`OLLAMA_MODEL`, `USER_NAME`, `HOME_CITY`, `HOME_CURRENCY`, `UNITS`, `ELEVENLABS_API_KEY`, `KOKORO_*`,
`JARVIS_VOICE` / `FRIDAY_VOICE` / `ULTRON_VOICE`, `PORT`, `HOST`, `ALLOWED_HOSTS` — see `.env.example`.

## Security

JARVIS can type, click and run apps on your computer, so it is locked down: it only listens on `127.0.0.1`, rejects any
WebSocket/API request whose `Origin`/`Host` isn't localhost (a random website can't drive your Mac), never builds shell
commands from text, limits file actions to your home folder, and never speaks or stores generated passwords.
**Never expose port 3000 to the internet.** For LAN use set `HOST=0.0.0.0` and `ALLOWED_HOSTS=<your-ip>`.

## Project layout

```
server.js                 HTTP + WebSocket server, request flow
src/skills/               web.js (online skills) · local.js (offline skills) · index.js (router, briefing)
src/mac-control.js        macOS / keyboard / mouse control (no shell injection)
src/telemetry.js          real CPU / memory / disk / battery / process sampling
src/diagnostics.js        self-checks behind the SYSTEMS panel
src/personalities.js      the three operating modes
src/store.js              tasks · notes · reminders (data/jarvis-data.json)
public/                   console UI: core.js (visual) · voice.js (speech) · app.js (UI)
plugins/                  drop-in extensions: export { name, matches(text), execute(text) }
```

MIT licensed.
