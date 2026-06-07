/**
 * Mac Control — AppleScript + robotjs keyboard/mouse automation
 * robotjs gives real keyboard/mouse control at the OS level.
 */

const { exec }     = require("child_process");
const { promisify } = require("util");
const path         = require("path");
const os           = require("os");

const execAsync = promisify(exec);
const PLATFORM  = process.platform;

// Load robotjs — optional, graceful fallback if not installed
let robot = null;
try {
  robot = require("@jitsi/robotjs");
  robot.setMouseDelay(5);
  robot.setKeyboardDelay(10);
} catch (e) {
  console.warn("[MacControl] robotjs not available — keyboard/mouse control disabled. Run: npm install");
}

// ─── Shell helpers ─────────────────────────────────────────────────────────────
async function sh(cmd, timeout = 12000) {
  const { stdout } = await execAsync(cmd, { timeout });
  return stdout.trim();
}

async function as(script) {
  if (PLATFORM !== "darwin") throw new Error("AppleScript only on macOS");
  const { stdout } = await execAsync(`osascript -e ${JSON.stringify(script)}`);
  return stdout.trim();
}

// ─── Main router ───────────────────────────────────────────────────────────────
async function executeMacCommand(action) {
  if (!action || !action.action) return null;
  switch (action.action) {
    case "open_app":          return openApp(action.app);
    case "close_app":         return closeApp(action.app);
    case "search_web":        return searchWeb(action.query);
    case "open_url":          return openURL(action.url);
    case "screenshot":        return screenshot();
    case "get_battery":       return getBattery();
    case "system":            return sysCmd(action.command, action.value);
    case "type_text":         return typeText(action.text);
    case "move_mouse":        return moveMouse(action.x, action.y);
    case "click_mouse":       return clickMouse(action.button || "left");
    case "double_click":      return doubleClick();
    case "right_click":       return rightClick();
    case "scroll":            return scroll(action.direction, action.amount);
    case "key_press":         return keyPress(action.key);
    case "lock_screen":       return lockScreen();
    case "sleep":             return sleepMac();
    case "empty_trash":       return emptyTrash();
    case "get_wifi":          return getWifi();
    case "get_clipboard":     return getClipboard();
    case "set_clipboard":     return setClipboard(action.text);
    case "create_folder":     return createFolder(action.path);
    case "move_to_trash":     return moveToTrash(action.path);
    case "open_file":         return openFile(action.path);
    case "get_calendar":      return getCalendar();
    case "add_calendar":      return addCalendar(action.title, action.date, action.time);
    case "run_shortcut":      return runShortcut(action.name);
    case "window_left":       return windowSnap(action.app, "left");
    case "window_right":      return windowSnap(action.app, "right");
    case "window_fullscreen": return windowFullscreen(action.app);
    case "get_time":          return new Date().toLocaleString();
    case "send_message":      return sendMessage(action.to, action.message);
    case "get_screen_size":   return JSON.stringify(getScreenSize());
    case "none":
    default:                  return null;
  }
}

// ─── App control ───────────────────────────────────────────────────────────────
const APP_ALIASES = {
  "chrome": "Google Chrome", "google chrome": "Google Chrome",
  "safari": "Safari", "firefox": "Firefox",
  "whatsapp": "WhatsApp", "telegram": "Telegram",
  "spotify": "Spotify", "music": "Music",
  "terminal": "Terminal", "iterm": "iTerm2", "iterm2": "iTerm2", "warp": "Warp",
  "vscode": "Visual Studio Code", "vs code": "Visual Studio Code", "code": "Visual Studio Code", "cursor": "Cursor",
  "slack": "Slack", "discord": "Discord", "zoom": "Zoom",
  "mail": "Mail", "messages": "Messages", "facetime": "FaceTime",
  "notes": "Notes", "calendar": "Calendar", "reminders": "Reminders",
  "finder": "Finder", "photos": "Photos",
  "settings": "System Settings", "system settings": "System Settings",
  "system preferences": "System Preferences",
  "app store": "App Store", "xcode": "Xcode",
  "notion": "Notion", "figma": "Figma", "sketch": "Sketch",
  "1password": "1Password", "alfred": "Alfred",
};

async function openApp(name) {
  if (!name) throw new Error("No app name");
  const resolved = APP_ALIASES[name.toLowerCase()] || name;
  if (PLATFORM === "darwin") await sh(`open -a "${resolved}" 2>/dev/null || open "${resolved}" 2>/dev/null`);
  else if (PLATFORM === "win32") await execAsync(`start "" "${resolved}"`).catch(() => {});
  else await sh(`xdg-open "${resolved}" 2>/dev/null || true`);
  return `Opened ${resolved}`;
}

async function closeApp(name) {
  if (!name) throw new Error("No app name");
  if (PLATFORM === "darwin") {
    await as(`tell application "${name}" to quit`);
  } else if (PLATFORM === "win32") {
    await execAsync(`taskkill /IM "${name}.exe" /F`).catch(() => {});
  } else {
    await sh(`pkill -f "${name}" || true`);
  }
  return `Closed ${name}`;
}

// ─── Web ───────────────────────────────────────────────────────────────────────
async function searchWeb(query) {
  return openURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
}

async function openURL(url) {
  if (!url) throw new Error("No URL");
  if (PLATFORM === "darwin") await sh(`open "${url}"`);
  else if (PLATFORM === "win32") await execAsync(`start "${url}"`).catch(() => {});
  else await sh(`xdg-open "${url}" 2>/dev/null || true`);
  return `Opened ${url}`;
}

// ─── Screenshot ────────────────────────────────────────────────────────────────
async function screenshot() {
  const ts  = Date.now();
  const fp  = path.join(os.homedir(), "Desktop", `jarvis_${ts}.png`);
  if (PLATFORM === "darwin") {
    await sh(`screencapture "${fp}"`);
  } else if (PLATFORM === "win32") {
    await execAsync(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $bmp=New-Object System.Drawing.Bitmap([System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width,[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height); $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $bmp.Save('${fp}')"`).catch(() => {});
  } else {
    await sh(`import -window root "${fp}" 2>/dev/null || scrot "${fp}" 2>/dev/null || true`);
  }
  return `Screenshot saved: jarvis_${ts}.png`;
}

// ─── Battery ───────────────────────────────────────────────────────────────────
async function getBattery() {
  try {
    if (PLATFORM === "darwin") {
      const out = await sh("pmset -g batt");
      const pct = out.match(/(\d+)%/)?.[1];
      const status = out.includes("AC Power") ? "charging" : "on battery";
      return pct ? `Battery: ${pct}% (${status})` : out;
    } else if (PLATFORM === "win32") {
      const out = await execAsync(`powershell -Command "(Get-WmiObject Win32_Battery).EstimatedChargeRemaining"`);
      return `Battery: ${out.stdout.trim()}%`;
    } else {
      const out = await sh(`cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || acpi -b 2>/dev/null || echo unknown`);
      return `Battery: ${out}`;
    }
  } catch { return "Battery status unavailable"; }
}

// ─── System commands ───────────────────────────────────────────────────────────
async function sysCmd(cmd, val) {
  if (PLATFORM === "darwin") {
    const map = {
      volume_up:   `set volume output volume (output volume of (get volume settings) + 10)`,
      volume_down: `set volume output volume (output volume of (get volume settings) - 10)`,
      mute:        `set volume with output muted`,
      unmute:      `set volume without output muted`,
    };
    if (cmd === "volume_set") { await as(`set volume output volume ${val || 50}`); return `Volume set to ${val || 50}`; }
    if (map[cmd]) { await as(map[cmd]); return `${cmd} done`; }
  } else if (PLATFORM === "win32") {
    if (cmd === "volume_up")   { await execAsync(`powershell -c "(New-Object -COM WScript.Shell).SendKeys([char]175)"`); return "Volume up"; }
    if (cmd === "volume_down") { await execAsync(`powershell -c "(New-Object -COM WScript.Shell).SendKeys([char]174)"`); return "Volume down"; }
    if (cmd === "mute")        { await execAsync(`powershell -c "(New-Object -COM WScript.Shell).SendKeys([char]173)"`); return "Muted"; }
  } else {
    const map = {
      volume_up:   "amixer -D pulse sset Master 10%+ 2>/dev/null || pactl set-sink-volume @DEFAULT_SINK@ +10%",
      volume_down: "amixer -D pulse sset Master 10%- 2>/dev/null || pactl set-sink-volume @DEFAULT_SINK@ -10%",
      mute:        "amixer -D pulse sset Master mute 2>/dev/null || pactl set-sink-mute @DEFAULT_SINK@ 1",
      unmute:      "amixer -D pulse sset Master unmute 2>/dev/null || pactl set-sink-mute @DEFAULT_SINK@ 0",
    };
    if (map[cmd]) { await sh(map[cmd] + " || true"); return `${cmd} done`; }
  }
  throw new Error(`Unknown system command: ${cmd}`);
}

// ─── robotjs keyboard/mouse ────────────────────────────────────────────────────
function typeText(text) {
  if (!robot) {
    // Fallback: AppleScript keystroke
    if (PLATFORM === "darwin") {
      return as(`tell application "System Events" to keystroke "${text.replace(/"/g, '\\"')}"`);
    }
    throw new Error("robotjs not installed. Run: npm install");
  }
  robot.typeString(text);
  return `Typed: ${text.slice(0, 30)}${text.length > 30 ? "…" : ""}`;
}

function getScreenSize() {
  if (robot) {
    try { return robot.getScreenSize(); } catch {}
  }
  return { width: 1920, height: 1080 }; // safe default
}

function moveMouse(x, y) {
  if (!robot) throw new Error("robotjs not installed — run: npm install, then grant Accessibility to node");
  if (x == null || y == null) throw new Error("x and y required");
  const { width, height } = getScreenSize();
  // Clamp to actual screen bounds
  const cx = Math.max(0, Math.min(Number(x), width  - 1));
  const cy = Math.max(0, Math.min(Number(y), height - 1));
  robot.moveMouse(cx, cy);
  return `Mouse moved to (${cx}, ${cy}) — screen is ${width}x${height}`;
}

function clickMouse(button = "left") {
  if (!robot) throw new Error("robotjs not installed");
  robot.mouseClick(button);
  return `Clicked ${button}`;
}

function doubleClick() {
  if (!robot) throw new Error("robotjs not installed");
  robot.mouseClick("left", true);
  return "Double-clicked";
}

function rightClick() {
  if (!robot) throw new Error("robotjs not installed");
  robot.mouseClick("right");
  return "Right-clicked";
}

function scroll(direction = "down", amount = 3) {
  if (!robot) throw new Error("robotjs not installed");
  const amt = Number(amount) || 3;
  robot.scrollMouse(0, direction === "down" ? -amt : amt);
  return `Scrolled ${direction} by ${amt}`;
}

// Key mapping — convert natural names to robotjs keys
const KEY_MAP = {
  "cmd+c": ["c", ["command"]], "cmd+v": ["v", ["command"]],
  "cmd+z": ["z", ["command"]], "cmd+x": ["x", ["command"]],
  "cmd+a": ["a", ["command"]], "cmd+s": ["s", ["command"]],
  "cmd+tab": ["tab", ["command"]], "cmd+space": ["space", ["command"]],
  "cmd+w": ["w", ["command"]], "cmd+q": ["q", ["command"]],
  "cmd+r": ["r", ["command"]], "cmd+t": ["t", ["command"]],
  "cmd+l": ["l", ["command"]], "cmd+n": ["n", ["command"]],
  "cmd+shift+3": ["3", ["command", "shift"]], "cmd+shift+4": ["4", ["command", "shift"]],
  "ctrl+c": ["c", ["control"]], "ctrl+v": ["v", ["control"]],
  "ctrl+z": ["z", ["control"]], "ctrl+a": ["a", ["control"]],
  "alt+tab": ["tab", ["alt"]], "alt+f4": ["f4", ["alt"]],
  "escape": ["escape", []], "enter": ["enter", []], "return": ["return", []],
  "space": ["space", []], "backspace": ["backspace", []], "delete": ["delete", []],
  "tab": ["tab", []], "up": ["up", []], "down": ["down", []], "left": ["left", []], "right": ["right", []],
  "f1": ["f1", []], "f2": ["f2", []], "f3": ["f3", []], "f4": ["f4", []], "f5": ["f5", []],
};

async function keyPress(combo) {
  if (!combo) throw new Error("No key specified");
  const low = combo.toLowerCase().trim();

  if (robot) {
    const mapped = KEY_MAP[low];
    if (mapped) {
      robot.keyTap(mapped[0], mapped[1]);
    } else {
      // Single key
      robot.keyTap(low);
    }
    return `Key pressed: ${combo}`;
  }

  // Fallback: AppleScript (Mac only)
  if (PLATFORM === "darwin") {
    const ascript = buildAppleScriptKey(combo);
    if (ascript) { await as(ascript); return `Key pressed: ${combo}`; }
  }
  throw new Error("robotjs not installed. Run: npm install");
}

function buildAppleScriptKey(combo) {
  const lower = combo.toLowerCase();
  const mods  = [];
  let key     = lower;
  if (lower.includes("cmd"))   { mods.push("command down"); key = key.replace(/cmd\+?/g, ""); }
  if (lower.includes("ctrl"))  { mods.push("control down"); key = key.replace(/ctrl\+?/g, ""); }
  if (lower.includes("shift")) { mods.push("shift down");   key = key.replace(/shift\+?/g, ""); }
  if (lower.includes("alt"))   { mods.push("option down");  key = key.replace(/alt\+?/g, ""); }
  key = key.replace(/\+/g, "").trim();
  if (!key) return null;
  const modStr = mods.length ? ` using {${mods.join(", ")}}` : "";
  return `tell application "System Events" to keystroke "${key}"${modStr}`;
}

// ─── Screen / system ───────────────────────────────────────────────────────────
async function lockScreen() {
  if (PLATFORM === "darwin") {
    await sh(`/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend 2>/dev/null || true`);
  } else if (PLATFORM === "win32") {
    await execAsync("rundll32.exe user32.dll,LockWorkStation");
  } else {
    await sh("gnome-screensaver-command -l 2>/dev/null || xdg-screensaver lock 2>/dev/null || true");
  }
  return "Screen locked";
}

async function sleepMac() {
  if (PLATFORM === "darwin") await sh("pmset sleepnow");
  else if (PLATFORM === "win32") await execAsync("rundll32.exe powrprof.dll,SetSuspendState 0,1,0");
  else await sh("systemctl suspend 2>/dev/null || true");
  return "Going to sleep";
}

async function emptyTrash() {
  if (PLATFORM === "darwin") { await as(`tell application "Finder" to empty trash`); return "Trash emptied"; }
  return "Trash emptying only supported on macOS";
}

async function getWifi() {
  try {
    if (PLATFORM === "darwin") {
      const out = await sh(`/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I 2>/dev/null || networksetup -getairportnetwork en0`);
      const m = out.match(/SSID:\s*(.+)/);
      return m ? `Connected to: ${m[1].trim()}` : out;
    } else if (PLATFORM === "win32") {
      const out = await execAsync("netsh wlan show interfaces");
      const m = out.stdout.match(/SSID\s+:\s+(.+)/);
      return m ? `Connected to: ${m[1].trim()}` : "WiFi info unavailable";
    } else {
      const out = await sh("iwgetid -r 2>/dev/null || nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2 || echo unknown");
      return `Connected to: ${out}`;
    }
  } catch { return "WiFi info unavailable"; }
}

// ─── Clipboard ─────────────────────────────────────────────────────────────────
async function getClipboard() {
  if (PLATFORM === "darwin") {
    const r = await as("the clipboard");
    return r ? `Clipboard: ${r.slice(0, 200)}` : "Clipboard is empty";
  } else if (PLATFORM === "win32") {
    const out = await execAsync(`powershell -Command "Get-Clipboard"`);
    return `Clipboard: ${out.stdout.trim().slice(0, 200)}`;
  } else {
    const out = await sh("xclip -o 2>/dev/null || xsel -o 2>/dev/null || echo empty");
    return `Clipboard: ${out.slice(0, 200)}`;
  }
}

async function setClipboard(text) {
  if (!text) throw new Error("No text");
  if (PLATFORM === "darwin") {
    await as(`set the clipboard to "${text.replace(/"/g, '\\"')}"`);
  } else if (PLATFORM === "win32") {
    await execAsync(`powershell -Command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`)
  } else {
    await sh(`echo "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard 2>/dev/null || true`);
  }
  return "Copied to clipboard";
}

// ─── Files ─────────────────────────────────────────────────────────────────────
async function createFolder(fp) {
  if (!fp) throw new Error("No path");
  const exp = fp.replace(/^~/, os.homedir());
  await sh(`mkdir -p "${exp}"`);
  openURL(`file://${path.dirname(exp)}`).catch(() => {});
  return `Folder "${path.basename(exp)}" created`;
}

async function moveToTrash(fp) {
  if (!fp) throw new Error("No path");
  if (PLATFORM !== "darwin") throw new Error("Trash only on macOS");
  const exp = fp.replace(/^~/, os.homedir());
  await as(`tell application "Finder" to move POSIX file "${exp}" to trash`);
  return `Moved to trash: ${path.basename(exp)}`;
}

async function openFile(fp) {
  if (!fp) throw new Error("No path");
  const exp = fp.replace(/^~/, os.homedir());
  if (PLATFORM === "darwin") await sh(`open "${exp}"`);
  else if (PLATFORM === "win32") await execAsync(`start "" "${exp}"`);
  else await sh(`xdg-open "${exp}" 2>/dev/null || true`);
  return `Opened ${path.basename(exp)}`;
}

// ─── Calendar (FIXED — uses .scpt temp file, not osascript -e) ───────────────
// Root cause of "no app needs calendar access": macOS assigns the permission to
// the BINARY calling osascript (node), not Terminal. You must add your node binary
// to System Settings → Privacy → Calendars AND Automation → node → Calendar.

async function getCalendar() {
  if (PLATFORM !== "darwin") return "Calendar only on macOS";

  // Try icalBuddy first — no permission dialog needed
  try {
    const out = await sh(`which icalBuddy 2>/dev/null && icalBuddy -n -f eventsToday 2>/dev/null || true`);
    if (out && out.trim() && out.trim() !== "No events today") return out.trim();
  } catch {}

  // Use a .scpt temp file to avoid shell-escaping issues
  const { writeFileSync, unlinkSync, existsSync } = require("fs");
  const tmp = path.join(os.tmpdir(), "jarvis_cal_get.scpt");
  const script = [
    'tell application "Calendar"',
    '  activate',
    '  set todayEvents to ""',
    '  set today to current date',
    '  set startOfDay to today - (time of today)',
    '  set endOfDay to startOfDay + 86399',
    '  repeat with aCal in calendars',
    '    repeat with ev in (every event of aCal whose start date >= startOfDay and start date <= endOfDay)',
    '      set todayEvents to todayEvents & (summary of ev) & " at " & (time string of (start date of ev)) & linefeed',
    '    end repeat',
    '  end repeat',
    '  if todayEvents is "" then',
    '    return "No events today"',
    '  end if',
    '  return todayEvents',
    'end tell',
  ].join("\n");

  try {
    writeFileSync(tmp, script, "utf8");
    const { stdout } = await execAsync(`osascript "${tmp}"`, { timeout: 15000 });
    return stdout.trim() || "No events today";
  } catch (e) {
    const msg = (e.stderr || e.message || "").toLowerCase();
    if (msg.includes("not allowed") || msg.includes("authorization") || msg.includes("1743")) {
      return "Calendar access denied.\nFix: System Settings → Privacy → Calendars → add node binary\nAlso: Automation → node → Calendar → ON\n(Run: which node — to find the path)";
    }
    throw e;
  } finally {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  }
}

async function addCalendar(title, date, time) {
  if (!title) throw new Error("No title");
  if (PLATFORM !== "darwin") return "Calendar only on macOS";
  const dateStr = (date || "today");
  const timeStr = (time || "12:00 PM");
  const safeTitle = title.replace(/"/g, "'");

  const { writeFileSync, unlinkSync, existsSync } = require("fs");
  const tmp = path.join(os.tmpdir(), "jarvis_cal_add.scpt");
  const script = [
    'tell application "Calendar"',
    '  activate',
   `  set newDate to date "${dateStr} ${timeStr}"`,
    '  set endDate to newDate + 3600',
    '  tell calendar "Home"',
   `    make new event with properties {summary:"${safeTitle}", start date:newDate, end date:endDate}`,
    '  end tell',
    '  reload calendars',
    'end tell',
    'return "done"',
  ].join("\n");

  try {
    writeFileSync(tmp, script, "utf8");
    await execAsync(`osascript "${tmp}"`, { timeout: 15000 });
    return `Event "${title}" added to Calendar`;
  } catch (e) {
    const msg = (e.stderr || e.message || "").toLowerCase();
    if (msg.includes("not allowed") || msg.includes("1743")) {
      return "Calendar access denied — grant node binary access in System Settings → Calendars";
    }
    await sh(`open -a Calendar`).catch(() => {});
    return `Opened Calendar — please add "${title}" at ${timeStr} manually`;
  } finally {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
  }
}

// ─── Shortcuts / Messaging ─────────────────────────────────────────────────────
async function runShortcut(name) {
  if (!name) throw new Error("No shortcut name");
  if (PLATFORM !== "darwin") return "Shortcuts only on macOS";
  try {
    await sh(`shortcuts run "${name}" 2>/dev/null`);
    return `Shortcut "${name}" executed`;
  } catch (e) {
    return `Shortcut "${name}" failed — make sure it exists in the Shortcuts app`;
  }
}

async function sendMessage(to, msg) {
  if (!to || !msg) throw new Error("Missing to or message");
  if (PLATFORM !== "darwin") throw new Error("iMessage only on macOS");
  // Try AppleScript iMessage first — triggers permission prompt
  try {
    const script = `
      tell application "Messages"
        activate
        set targetService to first service whose service type = iMessage
        set targetBuddy to buddy "${to}" of targetService
        send "${msg.replace(/"/g, '\\"')}" to targetBuddy
      end tell`;
    await as(script);
    return `iMessage sent to ${to}`;
  } catch (e) {
    if (e.message && e.message.includes("not allowed")) {
      return "Messages access denied. Run: bash setup-permissions.sh — grant Automation > Terminal > Messages.";
    }
    // Fallback: open Messages pre-filled via URL scheme
    const encoded = encodeURIComponent(msg);
    await sh(`open "imessage://${encodeURIComponent(to)}?body=${encoded}" 2>/dev/null || open -a Messages`);
    return `Opened Messages to ${to} — send manually`;
  }
}

// ─── Window management ─────────────────────────────────────────────────────────
async function windowSnap(app, side) {
  if (PLATFORM !== "darwin") return "Window snap only on macOS";
  try {
    await sh(`open -g "rectangle://execute-action?name=${side === "left" ? "left-half" : "right-half"}"`);
    return `Snapped ${side}`;
  } catch {
    return "Install Rectangle app for window snapping: https://rectangleapp.com";
  }
}

async function windowFullscreen(app) {
  if (PLATFORM !== "darwin") return "Window control only on macOS";
  if (app) await as(`tell application "${app}" to activate`);
  await as(`tell application "System Events" to keystroke "f" using {command down, control down}`);
  return `${app || "Window"} fullscreen toggled`;
}

module.exports = { executeMacCommand, getScreenSize };
