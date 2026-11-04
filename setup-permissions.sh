#!/bin/bash
# J.A.R.V.I.S. — macOS Permissions Setup (FIXED)
# ─────────────────────────────────────────────────────────────────────────────
# THE KEY FIX: macOS grants permissions to the BINARY, not the terminal app.
# Since JARVIS runs via `node`, you must add your NODE BINARY to each panel —
# not just "Terminal". This script finds node for you and shows the exact path.
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     J.A.R.V.I.S. — macOS Permissions Setup (v2 FIXED)       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── Find node binary ──────────────────────────────────────────────────────────
NODE_PATH=$(which node 2>/dev/null)
if [ -z "$NODE_PATH" ]; then
  # Try common locations (nvm, Homebrew, Volta, system)
  for p in \
    "$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -1)/bin/node" \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node" \
    "/usr/bin/node"; do
    if [ -f "$p" ]; then NODE_PATH="$p"; break; fi
  done
fi

if [ -z "$NODE_PATH" ]; then
  echo "❌  Could not find node binary. Install Node.js first: https://nodejs.org"
  exit 1
fi

# Resolve symlinks (important — macOS needs the REAL path for permissions)
NODE_REAL=$(readlink -f "$NODE_PATH" 2>/dev/null || python3 -c "import os; print(os.path.realpath('$NODE_PATH'))" 2>/dev/null || echo "$NODE_PATH")

echo "✅  Found node at: $NODE_PATH"
echo "    Real path:     $NODE_REAL"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  HOW TO ADD node TO EACH PERMISSION PANEL:"
echo ""
echo "  1. When the panel opens, look for 'node' in the list"
echo "  2. If NOT listed: click the [+] button"
echo "  3. In the file picker, press Cmd+Shift+G (Go to folder)"
echo "  4. Paste this path and click Open:"
echo ""
echo "     $NODE_REAL"
echo ""
echo "  5. Find node in the list → toggle the switch ON"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Copy node path to clipboard for convenience
echo "$NODE_REAL" | pbcopy 2>/dev/null && echo "  📋  Node path copied to clipboard!"
echo ""

# ── Helper: open a panel and wait ────────────────────────────────────────────
open_panel() {
  local step="$1"
  local label="$2"
  local url="$3"
  local note="$4"

  echo "▶  Step ${step} — ${label}"
  [ -n "$note" ] && echo "   ${note}"
  echo "   Opening panel in 2 seconds... (Cmd+Shift+G → paste path → toggle ON)"
  sleep 2
  open "$url"
  echo ""
  read -rp "   ✓ Done? Press Enter to continue... "
  echo ""
}

# ── 1. Accessibility — REQUIRED for robotjs keyboard/mouse ───────────────────
open_panel "1/7" "Accessibility  (keyboard & mouse control)" \
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" \
  "→ Add node binary, toggle ON. Required for all keyboard/mouse commands."

# ── 2. Automation — REQUIRED for AppleScript (Calendar, Messages, Finder) ────
echo "▶  Step 2/7 — Automation  (Calendar, Messages, Finder, System Events)"
echo "   After adding node, you'll see sub-checkboxes:"
echo "   Toggle ON: Finder ✓  Calendar ✓  System Events ✓  Messages ✓"
echo "   Opening panel in 2 seconds..."
sleep 2
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"
echo ""
read -rp "   ✓ Done? Press Enter to continue... "
echo ""

# ── 3. Calendars ─────────────────────────────────────────────────────────────
open_panel "3/7" "Calendars  (read & add events)" \
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars" \
  "→ Add node binary, toggle ON. This is what makes 'What's on my calendar' work."

# ── 4. Contacts ──────────────────────────────────────────────────────────────
open_panel "4/7" "Contacts  (send iMessages by name)" \
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Contacts"

# ── 5. Full Disk Access ───────────────────────────────────────────────────────
open_panel "5/7" "Full Disk Access  (read/write files anywhere)" \
  "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" \
  "→ Click [+], navigate to node binary, add it."

# ── 6. Screen Recording ───────────────────────────────────────────────────────
open_panel "6/7" "Screen Recording  (screenshots)" \
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

# ── 7. Input Monitoring (Sonoma+) ─────────────────────────────────────────────
open_panel "7/7" "Input Monitoring  (global hotkeys / space bar)" \
  "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent" \
  "→ macOS Sonoma needs this for robotjs global key listening."

# ── Verification ─────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     All permissions configured!                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Node binary that needs permissions:"
echo "  $NODE_REAL"
echo ""
echo "  Quick test commands (paste in Terminal):"
echo ""
echo "  # Test Calendar access:"
echo "  osascript -e 'tell application \"Calendar\" to get name of calendars'"
echo ""
echo "  # Test Accessibility (robotjs):"
echo "  osascript -e 'tell application \"System Events\" to key code 0'"
echo ""
echo "  # Start JARVIS:"
echo "  npm start"
echo "  # Open Chrome → http://localhost:3000"
echo ""
echo "  ⚠  After granting permissions, RESTART the server (npm start)"
echo "     macOS permission grants only take effect on next launch."
echo ""
echo "  💡 If Calendar still fails:"
echo "     1. Open Calendar.app manually first (makes it register with macOS)"
echo "     2. Try: osascript -e 'tell application \"Calendar\" to get name of calendars'"
echo "     3. macOS will prompt → click Allow"
echo ""
