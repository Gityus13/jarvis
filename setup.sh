#!/usr/bin/env bash
# J.A.R.V.I.S. — one-command setup for macOS / Linux.   Usage:  ./setup.sh
set -e
cd "$(dirname "$0")"

b() { printf "\033[1m%s\033[0m\n" "$*"; }
ok() { printf "  \033[32m✓\033[0m %s\n" "$*"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
ask() { if [ -t 0 ]; then read -r -p "  $1 [Y/n] " a; [[ -z "$a" || "$a" =~ ^[Yy] ]]; else return 0; fi; }

b "J.A.R.V.I.S. setup"

# 1 ── Node
if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js is required (v18 or newer, v22 LTS recommended)."
  echo "  macOS:  brew install node@22      Linux: https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then echo "  Node $(node -v) is too old — need v18+."; exit 1; fi
ok "Node $(node -v)"
[ "$NODE_MAJOR" -ge 24 ] && warn "Node 24+ is very new; if voice or keyboard control misbehave, use Node 22 LTS."

# 2 ── dependencies
b "Installing dependencies…"
npm install --no-audit --no-fund
ok "dependencies installed"
node -e "try{require('@jitsi/robotjs');console.log('  \x1b[32m✓\x1b[0m keyboard/mouse control available')}catch(e){console.log('  \x1b[33m!\x1b[0m keyboard/mouse control unavailable (typing/clicking disabled). macOS: xcode-select --install, then npm install')}"
[ -d node_modules/kokoro-js ] && ok "Kokoro neural voice installed (model downloads on first start)" || warn "Kokoro voice not installed — system voice will be used (npm i kokoro-js to add it)"

# 3 ── config
if [ ! -f .env ]; then cp .env.example .env; ok "created .env (edit it: your name, city, model)"; else ok ".env already exists"; fi
MODEL=$(grep -E '^OLLAMA_MODEL=' .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//')
MODEL=${MODEL:-llama3.2}

# 4 ── Ollama
b "AI engine (Ollama)…"
if ! command -v ollama >/dev/null 2>&1; then
  warn "Ollama not found. Install it: macOS  brew install ollama   ·   Linux  curl -fsSL https://ollama.com/install.sh | sh"
else
  ok "Ollama installed"
  if ! curl -fs -m 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
    warn "Ollama isn't running — start it in another terminal:  ollama serve"
  elif ollama list 2>/dev/null | grep -q "^${MODEL%%:*}"; then
    ok "model ${MODEL} is installed"
  elif [[ "$MODEL" == *cloud* ]]; then
    warn "${MODEL} is a cloud model — run once:  ollama signin"
  else
    ask "Download model ${MODEL} now?" && ollama pull "$MODEL" || warn "Skipped. Later: ollama pull ${MODEL}"
  fi
fi

# 5 ── macOS permissions
if [ "$(uname)" = "Darwin" ] && [ -f setup-permissions.sh ]; then
  b "macOS permissions…"
  ask "Run the permissions helper (Accessibility, Automation, Calendar)?" && bash setup-permissions.sh || warn "Skipped. Later: bash setup-permissions.sh"
fi

b "Done."
echo "  Start:      npm start        then open  http://localhost:3000  in Chrome"
echo "  Check:      npm run doctor   (or the SYSTEMS button in the UI)"
