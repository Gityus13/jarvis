# J.A.R.V.I.S. v3.0

> *"Good day, sir. All systems online."*

A fully local Iron Man AI assistant with wake-word detection, streaming AI responses, voice output, and complete Mac control via keyboard, mouse, and AppleScript. Runs entirely on your machine — no cloud required.

<p align="center">
  <img src="https://your-image-url.jpg" alt="JARVIS Interface Demo" width="80%">
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-3.0-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/status-active-success?style=for-the-badge">
  <img src="https://img.shields.io/badge/Node.js-18%2B-green?style=for-the-badge&logo=nodedotjs">
  <img src="https://img.shields.io/badge/Ollama-local-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey?style=for-the-badge&logo=apple">
  <br>
  <img src="https://img.shields.io/badge/Mac%20Control-Full-red?style=for-the-badge">
  <img src="https://img.shields.io/badge/wake--word-Hey%20JARVIS-ff69b4?style=for-the-badge">
  <img src="https://img.shields.io/badge/TTS-ElevenLabs%20%7C%20macOS-9cf?style=for-the-badge">
  <img src="https://img.shields.io/badge/WebSocket-✅-blue?style=for-the-badge">
  <img src="https://img.shields.io/badge/RAG-enabled-green?style=for-the-badge">
  <br>
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge">
  <img src="https://img.shields.io/github/stars/Gityus13/jarvis?style=for-the-badge&logo=github">
  <img src="https://img.shields.io/github/forks/Gityus13/jarvis?style=for-the-badge&logo=github">
  <img src="https://img.shields.io/github/issues/Gityus13/jarvis?style=for-the-badge&logo=github">
  <img src="https://img.shields.io/github/repo-size/Gityus13/jarvis?style=for-the-badge">
  <img src="https://img.shields.io/github/last-commit/Gityus13/jarvis?style=for-the-badge">
</p>

---

## Features

### AI
- **Streaming responses** — words appear one by one as JARVIS thinks
- **3 personalities** — J.A.R.V.I.S., F.R.I.D.A.Y., U.L.T.R.O.N.
- **Conversation memory** — history saved to disk, survives restarts
- **Large file output** — essays, code, reports saved to Desktop automatically

### Voice
- **Two-phase wake word** — say "Hey JARVIS" → JARVIS activates → then speak your command
- **Always listening** — passive wake word detection runs in background
- **Browser TTS** — speaks every response (summarizes long answers)
- **ElevenLabs support** — premium realistic voice (optional API key)
- **macOS say fallback** — Daniel/Moira/Alex voices per personality

### Mac Control (real OS-level)
- **Keyboard** — type text, press any key combo (Cmd+C, Cmd+Tab, etc.)
- **Mouse** — move, click, double-click, right-click, scroll anywhere on screen
- **Apps** — open/close any app by name
- **System** — volume, battery, WiFi, lock screen, sleep, empty trash
- **Files** — create folders, move to trash, open files
- **Clipboard** — read and write
- **Calendar** — read today's events, add new events
- **Messages** — send iMessages
- **Screenshots** — saves to Desktop
- **Window management** — snap left/right, fullscreen (requires Rectangle app)
- **Shortcuts** — trigger any macOS Shortcut by name
- **Web** — search Google, open URLs

### UI
- Iron Man HUD with animated arc reactor
- Real-time audio waveform
- Hex grid background
- 3 personality color themes
- Toast notifications
- Command log
- Settings panel
- Export conversation to .txt or .json

---

## Requirements

- **macOS** (Ventura or later recommended — Windows/Linux partially supported)
- **Node.js** v18+
- **Ollama** — [download](https://ollama.com)
- **Google Chrome** — required for Web Speech API (voice recognition)
- **Rectangle** (optional) — for window snapping: [rectangleapp.com](https://rectangleapp.com)

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/Gityus13/jarvis.git
cd jarvis
npm install
```

> **Note:** `npm install` compiles `@jitsi/robotjs` for native keyboard/mouse control.
> You need Xcode Command Line Tools on Mac: `xcode-select --install`

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env` — at minimum set your Ollama model:

```env
OLLAMA_MODEL=gpt-oss:120b-cloud
```

### 3. Start Ollama

```bash
# In a separate terminal:
ollama serve
ollama pull gpt-oss:120b-cloud
```

### 4. Start JARVIS

```bash
npm start
```

### 5. Open in Chrome

```
http://localhost:3000
```

Allow microphone when Chrome asks.

---

## How to Talk to JARVIS

| Method | What to do |
|--------|-----------|
| **Wake word** | Say "Hey JARVIS" → wait for "Yes, sir?" → speak your command |
| **Hold mic button** | Click and hold the mic icon → speak → release |
| **Hold SPACE** | Hold spacebar → speak → release |
| **Type** | Type in the input box → Enter |
| **Quick buttons** | Click any button in the right panel |

**Wake words:**
- `Hey JARVIS` or `JARVIS` → activates J.A.R.V.I.S.
- `Hey FRIDAY` or `FRIDAY` → switches to F.R.I.D.A.Y.
- `Ultron` or `Hey Ultron` → switches to U.L.T.R.O.N.

---

## Example Commands

```
"Open Chrome"
"Search for best restaurants in Baku"
"Take a screenshot"
"What's my battery?"
"Volume up"
"Mute"
"Lock the screen"
"What's on my calendar today?"
"Add meeting at 3pm called Standup"
"Copy hello world to clipboard"
"Type Hello World"
"Press Cmd+Tab"
"Move mouse to 500 300"
"Click"
"Scroll down"
"Snap Chrome to the left"
"Fullscreen Spotify"
"Send John a message: I'll be late"
"Write me an essay about AI"
"Create a folder called Projects"
"What's in my clipboard?"
```

---

## Voice Setup

**macOS (built-in, free):**
```bash
# List available voices:
say -v '?'
# Set in .env:
JARVIS_VOICE=Daniel
FRIDAY_VOICE=Moira
ULTRON_VOICE=Alex
```

**ElevenLabs (premium, realistic):**
1. Get a free API key at [elevenlabs.io](https://elevenlabs.io)
2. Add to `.env`: `ELEVENLABS_API_KEY=your_key_here`
3. Restart

---

## Permissions (macOS) — Full Access Setup

macOS blocks apps by default. Run the included script to open every panel:

```bash
bash setup-permissions.sh
```

Or grant manually — open **System Settings → Privacy & Security** and toggle ON for **Terminal** (and/or **node**) in each section:

| Permission | Required for | Where |
|-----------|-------------|-------|
| **Microphone** | Voice input in Chrome | Chrome will ask automatically |
| **Accessibility** | Keyboard/mouse control (robotjs) | Privacy → Accessibility |
| **Automation → Finder** | File operations, trash | Privacy → Automation |
| **Automation → Calendar** | Reading/adding events | Privacy → Automation |
| **Automation → Messages** | Sending iMessages | Privacy → Automation |
| **Automation → System Events** | Key presses, window control | Privacy → Automation |
| **Calendars** | Direct calendar access | Privacy → Calendars |
| **Contacts** | Looking up contacts by name | Privacy → Contacts |
| **Full Disk Access** | Reading/writing any file | Privacy → Full Disk Access |
| **Screen Recording** | Taking screenshots | Privacy → Screen Recording |

**If Terminal is not listed in a panel:**
1. Click **+**
2. Press **Cmd+Shift+G**
3. Paste the path from `which node` (e.g. `/usr/local/bin/node`)
4. Click Open, toggle ON

**After granting permissions**, macOS will ask again the first time each feature runs — click **Allow**.

**Quick links** (paste in Terminal):
```bash
# Open each permission panel directly:
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

---

## Plugin System

Drop a `.js` file into `/plugins/`:

```js
module.exports = {
  name: "Weather",
  description: "Gets weather info",

  matches(input) {
    return /\b(weather|temperature|forecast)\b/i.test(input);
  },

  async execute(input, { ws, session }) {
    // fetch an API, run shell commands, anything
    return "It's 24°C and sunny in Baku.";
  }
};
```

Restart server — JARVIS auto-loads all `.js` files in `/plugins`.

---

## REST API

```bash
# Status
GET  /api/status

# Send a command
POST /api/command
{"text": "Open Chrome", "personality": "JARVIS"}

# List personalities
GET  /api/personalities

# List plugins
GET  /api/plugins

# View logs
GET  /api/logs
```

---

## Project Structure

```
jarvis/
├── server.js              # WebSocket + REST server
├── .env.example           # Configuration template
├── src/
│   ├── ollama.js          # Streaming Ollama client
│   ├── personalities.js   # JARVIS / FRIDAY / ULTRON prompts
│   ├── mac-control.js     # Full Mac automation + robotjs
│   ├── tts.js             # ElevenLabs + macOS say TTS
│   ├── command-router.js  # Fast command pre-processing
│   ├── memory.js          # Conversation persistence
│   ├── logger.js          # Logging
│   └── plugin-loader.js   # Auto plugin loader
├── public/
│   ├── index.html         # Iron Man HUD
│   ├── css/style.css      # Themes + animations
│   └── js/app.js          # Frontend: voice, WebSocket, arc reactor
└── plugins/               # Drop .js plugins here
```

---

## Built With

- [Ollama](https://ollama.com) — Local LLM inference
- [robotjs](https://github.com/jitsi/robotjs) — Native keyboard/mouse control
- [ElevenLabs](https://elevenlabs.io) — Premium TTS (optional)
- [Express](https://expressjs.com) + [ws](https://github.com/websockets/ws) — Server
- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API) — Voice recognition
- macOS `say` + AppleScript + `osascript` — Mac automation

---

## Security

JARVIS runs on `localhost` only. **Never expose port 3000 to the internet** — it has full keyboard, mouse, and Mac control.

---

*Built by [Gityus13](https://github.com/Gityus13) · Powered by Ollama · Iron Man aesthetic*

<div align="center">
  
```text
██████╗ ██╗████████╗██╗   ██╗██╗   ██╗███████╗     ██╗██████╗ 
██╔════╝ ██║╚══██╔══╝╚██╗ ██╔╝██║   ██║██╔════╝    ███║╚════██╗
██║  ███╗██║   ██║    ╚████╔╝ ██║   ██║███████╗    ╚██║ █████╔╝
██║   ██║██║   ██║     ╚██╔╝  ██║   ██║╚════██║     ██║ ╚═══██╗
╚██████╔╝██║   ██║      ██║   ╚██████╔╝███████║     ██║██████╔╝
 ╚═════╝ ╚═╝   ╚═╝      ╚═╝    ╚═════╝ ╚══════╝     ╚═╝╚═════╝ 


     ██╗ █████╗ ██████╗ ██╗   ██╗██╗███████╗
     ██║██╔══██╗██╔══██╗██║   ██║██║██╔════╝
     ██║███████║██████╔╝██║   ██║██║███████╗
██   ██║██╔══██║██╔══██╗╚██╗ ██╔╝██║╚════██║
╚█████╔╝██║  ██║██║  ██║ ╚████╔╝ ██║███████║
 ╚════╝ ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚═╝╚══════╝
