/**
 * Mac Control — AppleScript + robotjs keyboard/mouse automation
 *
 * SECURITY: nothing here builds shell strings from user/AI text. Everything goes
 * through execFile (no shell) or AppleScript strings that are escaped with asq().
 */

const { execFile } = require("child_process");
const path         = require("path");
const os           = require("os");
const fs           = require("fs");

const PLATFORM = process.platform;
const IS_MAC   = PLATFORM === "darwin";
const IS_WIN   = PLATFORM === "win32";

// Load robotjs — optional, graceful fallback if not installed
let robot = null;
try {
  robot = require("@jitsi/robotjs");
  robot.setMouseDelay(5);
  robot.setKeyboardDelay(10);
} catch (e) {
  console.warn("[MacControl] robotjs not available — keyboard/mouse control disabled. Run: npm install");
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a program WITHOUT a shell. Resolves with trimmed stdout. */
function run(file, args = [], { timeout = 12000, input, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file, args,
      { timeout, maxBuffer: 5 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(String(stderr || err.message || "").trim() || err.message);
          e.stderr = String(stderr || "");
          e.code   = err.code;
          return reject(e);
        }
        resolve(String(stdout).trim());
      }
    );
    child.on("error", () => {}); // ENOENT is reported through the callback
    try { child.stdin.end(input == null ? undefined : String(input)); } catch {}
  });
}

/** Escape text for use inside an AppleScript "string literal" */
const asq = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");

async function as(script, timeout = 15000) {
  if (!IS_MAC) throw new Error("AppleScript only on macOS");
  return run("osascript", ["-e", script], { timeout });
}

/** PowerShell with the argument passed through an env var (no quoting problems) */
function ps(script, arg = "") {
  return run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { JARVIS_ARG: String(arg) } });
}

/** Resolve a path and make sure it stays inside the user's home folder */
function homePath(fp) {
  const home = os.homedir();
  const exp  = path.resolve(String(fp).replace(/^~(?=$|[\\/])/, home));
  if (exp !== home && !exp.startsWith(home + path.sep)) throw new Error("I can only touch files inside your home folder");
  return exp;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

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
    case "get_time":          return getTime();
    case "send_message":      return sendMessage(action.to, action.message);
    case "get_screen_size":   return JSON.stringify(getScreenSize());
    case "none":
    default:                  return null;
  }
}

function getTime() {
  const n = new Date();
  return `It's ${n.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} on ${n.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}.`;
}

// ─── App control ───────────────────────────────────────────────────────────────
const APP_ALIASES = {
  "chrome": "Google Chrome", "google chrome": "Google Chrome", "brave": "Brave Browser", "edge": "Microsoft Edge", "arc": "Arc",
  "safari": "Safari", "firefox": "Firefox",
  "whatsapp": "WhatsApp", "telegram": "Telegram", "signal": "Signal",
  "spotify": "Spotify", "music": "Music", "vlc": "VLC",
  "terminal": "Terminal", "iterm": "iTerm2", "iterm2": "iTerm2", "warp": "Warp",
  "vscode": "Visual Studio Code", "vs code": "Visual Studio Code", "visual studio code": "Visual Studio Code",
  "code": "Visual Studio Code", "cursor": "Cursor", "xcode": "Xcode",
  "slack": "Slack", "discord": "Discord", "zoom": "zoom.us", "teams": "Microsoft Teams",
  "mail": "Mail", "messages": "Messages", "facetime": "FaceTime",
  "notes": "Notes", "calendar": "Calendar", "reminders": "Reminders", "clock": "Clock", "maps": "Maps",
  "finder": "Finder", "photos": "Photos", "preview": "Preview", "calculator": "Calculator",
  "settings": "System Settings", "system settings": "System Settings", "system preferences": "System Preferences",
  "activity monitor": "Activity Monitor", "app store": "App Store",
  "pages": "Pages", "numbers": "Numbers", "keynote": "Keynote",
  "word": "Microsoft Word", "excel": "Microsoft Excel", "powerpoint": "Microsoft PowerPoint",
  "notion": "Notion", "figma": "Figma", "sketch": "Sketch", "obsidian": "Obsidian", "docker": "Docker",
  "1password": "1Password", "alfred": "Alfred", "claude": "Claude", "chatgpt": "ChatGPT",
};

function cleanAppName(name) {
  return String(name || "").trim()
    .replace(/^(?:the|my|up|a)\s+/i, "")
    .replace(/\s+(?:app|application|please)$/i, "")
    .trim();
}
const resolveApp = (name) => APP_ALIASES[cleanAppName(name).toLowerCase()] || cleanAppName(name);

async function openApp(name) {
  const app = resolveApp(name);
  if (!app) throw new Error("No app name");
  if (IS_MAC) {
    try { await run("open", ["-a", app]); }
    catch { throw new Error(`I couldn't find an app called "${app}"`); }
  } else if (IS_WIN) {
    if (!/^[\w .\-+]+$/.test(app)) throw new Error("Invalid app name");
    await run("cmd", ["/c", "start", "", app]);
  } else {
    if (!/^[\w.\-]+$/.test(app)) throw new Error("Invalid app name");
    await run("sh", ["-c", `nohup "${app.toLowerCase()}" >/dev/null 2>&1 &`]);
  }
  return `Opened ${app}`;
}

async function closeApp(name) {
  const app = resolveApp(name);
  if (!app) throw new Error("No app name");
  if (IS_MAC) {
    const q = asq(app);
    const r = await as(`if application "${q}" is running then\n  tell application "${q}" to quit\n  return "closed"\nelse\n  return "not running"\nend if`);
    return r === "closed" ? `Closed ${app}` : `${app} isn't running`;
  }
  if (IS_WIN) {
    if (!/^[\w .\-+]+$/.test(app)) throw new Error("Invalid app name");
    await run("taskkill", ["/IM", `${app}.exe`, "/F"]);
  } else {
    await run("pkill", ["-f", app]);
  }
  return `Closed ${app}`;
}

// ─── Web ───────────────────────────────────────────────────────────────────────
async function searchWeb(query) {
  if (!query) throw new Error("Nothing to search for");
  await openURL(`https://www.google.com/search?q=${encodeURIComponent(query)}`);
  return `Searching for ${query}`;
}

function normUrl(u) {
  u = String(u || "").trim();
  if (!u) throw new Error("No URL");
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  let x;
  try { x = new URL(u); } catch { throw new Error("That doesn't look like a valid link"); }
  if (!/^https?:$/.test(x.protocol)) throw new Error("Only http and https links are allowed");
  return x.href;
}

async function openURL(url) {
  const href = normUrl(url);
  if (IS_MAC) await run("open", [href]);
  else if (IS_WIN) await ps("Start-Process -FilePath $env:JARVIS_ARG", href);
  else await run("xdg-open", [href]);
  return `Opened ${href}`;
}

// ─── Screenshot ────────────────────────────────────────────────────────────────
async function screenshot() {
  const name = `jarvis_${Date.now()}.png`;
  const dir  = path.join(os.homedir(), "Desktop");
  fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, name);

  if (IS_MAC) {
    await run("screencapture", ["-x", fp]);
  } else if (IS_WIN) {
    await ps(
      "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; " +
      "$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); " +
      "$g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0,0,0,0,$bmp.Size); $bmp.Save($env:JARVIS_ARG)", fp
    );
  } else {
    await run("sh", ["-c", `import -window root "$JARVIS_ARG" 2>/dev/null || scrot "$JARVIS_ARG"`], { env: { JARVIS_ARG: fp } });
  }
  if (!fs.existsSync(fp)) throw new Error("Screenshot failed — on macOS allow Screen Recording for node in System Settings → Privacy");
  return `Screenshot saved to Desktop: ${name}`;
}

// ─── Battery ───────────────────────────────────────────────────────────────────
async function getBattery() {
  try {
    if (IS_MAC) {
      const out = await run("pmset", ["-g", "batt"]);
      const pct = out.match(/(\d+)%/)?.[1];
      if (!pct) return "No battery found — this looks like a desktop Mac, sir.";
      const st = out.match(/;\s*(charging|discharging|charged|finishing charge)/i)?.[1]?.toLowerCase()
              || (out.includes("AC Power") ? "plugged in" : "on battery");
      return `Battery: ${pct}% (${st})`;
    }
    if (IS_WIN) {
      const out = await ps("(Get-CimInstance Win32_Battery).EstimatedChargeRemaining");
      return out ? `Battery: ${out}%` : "No battery found";
    }
    const out = await run("sh", ["-c", "cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || acpi -b 2>/dev/null || echo unknown"]);
    return out === "unknown" ? "Battery status unavailable" : `Battery: ${out}%`;
  } catch { return "Battery status unavailable"; }
}

// ─── System commands ───────────────────────────────────────────────────────────
async function sysCmd(cmd, val) {
  if (IS_MAC) {
    const getVol = async () => { const n = parseInt(await as("output volume of (get volume settings)"), 10); return Number.isNaN(n) ? 50 : n; };
    if (cmd === "volume_up" || cmd === "volume_down") {
      const v = clamp((await getVol()) + (cmd === "volume_up" ? 10 : -10), 0, 100);
      await as(`set volume output volume ${v}\nset volume without output muted`);
      return `Volume ${v}%`;
    }
    if (cmd === "volume_set") { const v = clamp(Number(val) || 50, 0, 100); await as(`set volume output volume ${v}`); return `Volume set to ${v}%`; }
    if (cmd === "mute")   { await as("set volume with output muted");    return "Muted"; }
    if (cmd === "unmute") { await as("set volume without output muted"); return "Unmuted"; }
  } else if (IS_WIN) {
    const key = { volume_up: 175, volume_down: 174, mute: 173 }[cmd];
    if (key) { await ps(`(New-Object -COM WScript.Shell).SendKeys([char]${key})`); return cmd.replace("_", " "); }
  } else {
    const map = {
      volume_up:   "amixer -D pulse sset Master 10%+ 2>/dev/null || pactl set-sink-volume @DEFAULT_SINK@ +10%",
      volume_down: "amixer -D pulse sset Master 10%- 2>/dev/null || pactl set-sink-volume @DEFAULT_SINK@ -10%",
      mute:        "amixer -D pulse sset Master mute 2>/dev/null || pactl set-sink-mute @DEFAULT_SINK@ 1",
      unmute:      "amixer -D pulse sset Master unmute 2>/dev/null || pactl set-sink-mute @DEFAULT_SINK@ 0",
    };
    if (map[cmd]) { await run("sh", ["-c", map[cmd]]); return `${cmd} done`; }
  }
  throw new Error(`Unknown system command: ${cmd}`);
}

// ─── robotjs keyboard/mouse ────────────────────────────────────────────────────
async function typeText(text) {
  text = String(text ?? "");
  if (!text) throw new Error("Nothing to type");
  const ascii = /^[\x20-\x7E\t\n]*$/.test(text);

  // robotjs can't type non-ASCII (ə ı ş ğ ö ü ç …) — use AppleScript for those
  if (robot && ascii) {
    robot.typeString(text);
  } else if (IS_MAC) {
    await as(`tell application "System Events" to keystroke "${asq(text)}"`);
  } else if (robot) {
    robot.typeString(text);
  } else {
    throw new Error("robotjs not installed. Run: npm install");
  }
  return `Typed: ${text.slice(0, 30)}${text.length > 30 ? "…" : ""}`;
}

function getScreenSize() {
  if (robot) { try { return robot.getScreenSize(); } catch {} }
  return { width: 1920, height: 1080 }; // safe default
}

function needRobot() {
  if (!robot) throw new Error("robotjs not installed — run: npm install, then grant Accessibility to node");
}

function moveMouse(x, y) {
  needRobot();
  if (x == null || y == null || Number.isNaN(Number(x)) || Number.isNaN(Number(y))) throw new Error("x and y required");
  const { width, height } = getScreenSize();
  const cx = clamp(Number(x), 0, width - 1);
  const cy = clamp(Number(y), 0, height - 1);
  robot.moveMouse(cx, cy);
  return `Mouse moved to (${cx}, ${cy}) — screen is ${width}x${height}`;
}

function clickMouse(button = "left") {
  needRobot();
  const b = ["left", "right", "middle"].includes(button) ? button : "left";
  robot.mouseClick(b);
  return `Clicked ${b}`;
}

function doubleClick() { needRobot(); robot.mouseClick("left", true); return "Double-clicked"; }
function rightClick()  { needRobot(); robot.mouseClick("right");      return "Right-clicked"; }

function scroll(direction = "down", amount = 3) {
  needRobot();
  const amt = clamp(Number(amount) || 3, 1, 50);
  robot.scrollMouse(0, direction === "up" ? amt : -amt);
  return `Scrolled ${direction === "up" ? "up" : "down"} by ${amt}`;
}

// ── Key combos: "cmd+c", "command c", "ctrl shift t", "page down", "escape" … ──
const MODS = {
  cmd: "command", command: "command", "⌘": "command", meta: "command", super: "command",
  ctrl: "control", control: "control",
  alt: "alt", option: "alt", opt: "alt",
  shift: "shift",
};
const KEY_NAMES = {
  esc: "escape", escape: "escape", enter: "enter", return: "enter",
  del: "delete", delete: "delete", backspace: "backspace", "back space": "backspace",
  space: "space", spacebar: "space", tab: "tab",
  up: "up", "up arrow": "up", down: "down", "down arrow": "down",
  left: "left", "left arrow": "left", right: "right", "right arrow": "right",
  home: "home", end: "end", "page up": "pageup", pageup: "pageup", "page down": "pagedown", pagedown: "pagedown",
};
const MAC_KEYCODE = { enter: 36, tab: 48, space: 49, backspace: 51, delete: 117, escape: 53, left: 123, right: 124, down: 125, up: 126, home: 115, end: 119, pageup: 116, pagedown: 121 };

function parseCombo(combo) {
  const tokens = String(combo || "").toLowerCase().replace(/\+/g, " ").split(/\s+/).filter(Boolean);
  const mods = [];
  const rest = [];
  for (const t of tokens) {
    if (MODS[t]) { const m = (!IS_MAC && MODS[t] === "command") ? "control" : MODS[t]; if (!mods.includes(m)) mods.push(m); }
    else rest.push(t);
  }
  let key = rest.join(" ");
  key = KEY_NAMES[key] || key;
  if (!key) throw new Error("No key specified");
  const ok = key.length === 1 || /^f([1-9]|1[0-2])$/.test(key) || Object.values(KEY_NAMES).includes(key);
  if (!ok) throw new Error(`I don't know the key "${key}"`);
  return { key, mods };
}

async function keyPress(combo) {
  if (!combo) throw new Error("No key specified");
  const { key, mods } = parseCombo(combo);

  if (robot) {
    robot.keyTap(key, mods);
    return `Key pressed: ${combo}`;
  }

  if (IS_MAC) {
    const using = mods.map((m) => ({ command: "command down", control: "control down", alt: "option down", shift: "shift down" }[m]));
    const mod   = using.length ? ` using {${using.join(", ")}}` : "";
    const what  = MAC_KEYCODE[key] != null ? `key code ${MAC_KEYCODE[key]}` : `keystroke "${asq(key)}"`;
    await as(`tell application "System Events" to ${what}${mod}`);
    return `Key pressed: ${combo}`;
  }
  throw new Error("robotjs not installed. Run: npm install");
}

// ─── Screen / system ───────────────────────────────────────────────────────────
async function lockScreen() {
  if (IS_MAC) {
    const cgs = "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession";
    if (fs.existsSync(cgs)) await run(cgs, ["-suspend"]);
    else await as(`tell application "System Events" to keystroke "q" using {control down, command down}`); // works on modern macOS
  } else if (IS_WIN) {
    await run("rundll32.exe", ["user32.dll,LockWorkStation"]);
  } else {
    await run("sh", ["-c", "gnome-screensaver-command -l 2>/dev/null || xdg-screensaver lock 2>/dev/null || loginctl lock-session"]);
  }
  return "Screen locked";
}

async function sleepMac() {
  if (IS_MAC) await run("pmset", ["sleepnow"]);
  else if (IS_WIN) await run("rundll32.exe", ["powrprof.dll,SetSuspendState", "0,1,0"]);
  else await run("systemctl", ["suspend"]);
  return "Going to sleep";
}

async function emptyTrash() {
  if (!IS_MAC) return "Trash emptying only supported on macOS";
  await as(`tell application "Finder" to empty trash`);
  return "Trash emptied";
}

async function getWifi() {
  try {
    if (IS_MAC) {
      let dev = "en0";
      try {
        const hp = await run("networksetup", ["-listallhardwareports"]);
        const m  = hp.match(/Hardware Port: (?:Wi-Fi|AirPort)\s*\nDevice: (\w+)/);
        if (m) dev = m[1];
      } catch {}
      try {
        const o = await run("networksetup", ["-getairportnetwork", dev]);
        const m = o.match(/Network:\s*(.+)$/m);
        if (m) return `Connected to: ${m[1].trim()}`;
      } catch {}
      try { // newer macOS hides the name from networksetup
        const o = await run("ipconfig", ["getsummary", dev]);
        const m = o.match(/\sSSID : (.+)/);
        if (m && !/redacted/i.test(m[1])) return `Connected to: ${m[1].trim()}`;
      } catch {}
      try {
        if (await run("ipconfig", ["getifaddr", dev])) return "Connected to Wi-Fi (macOS is hiding the network name)";
      } catch {}
      return "Wi-Fi is not connected";
    }
    if (IS_WIN) {
      const out = await run("netsh", ["wlan", "show", "interfaces"]);
      const m = out.match(/^\s*SSID\s+:\s+(.+)$/m);
      return m ? `Connected to: ${m[1].trim()}` : "Wi-Fi is not connected";
    }
    const out = await run("sh", ["-c", "iwgetid -r 2>/dev/null || nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes' | cut -d: -f2"]);
    return out ? `Connected to: ${out}` : "Wi-Fi is not connected";
  } catch { return "WiFi info unavailable"; }
}

// ─── Clipboard ─────────────────────────────────────────────────────────────────
async function getClipboard() {
  let out = "";
  if (IS_MAC)      out = await run("pbpaste");
  else if (IS_WIN) out = await ps("Get-Clipboard");
  else             out = await run("sh", ["-c", "xclip -o -selection clipboard 2>/dev/null || xsel -b 2>/dev/null"]).catch(() => "");
  return out ? `Clipboard: ${out.slice(0, 200)}` : "Clipboard is empty";
}

async function setClipboard(text) {
  if (!text) throw new Error("No text");
  if (IS_MAC)      await run("pbcopy", [], { input: text });
  else if (IS_WIN) await ps("Set-Clipboard -Value $env:JARVIS_ARG", text);
  else             await run("sh", ["-c", "xclip -selection clipboard"], { input: text });
  return "Copied to clipboard";
}

// ─── Files ─────────────────────────────────────────────────────────────────────
async function createFolder(fp) {
  if (!fp) throw new Error("No path");
  const exp = homePath(fp);
  fs.mkdirSync(exp, { recursive: true });
  try {
    if (IS_MAC) await run("open", ["-R", exp]);          // reveal the new folder in Finder
    else if (IS_WIN) await run("explorer", [exp]).catch(() => {});
    else await run("xdg-open", [path.dirname(exp)]);
  } catch {}
  return `Folder "${path.basename(exp)}" created`;
}

async function moveToTrash(fp) {
  if (!fp) throw new Error("No path");
  if (!IS_MAC) throw new Error("Trash only on macOS");
  const exp = homePath(fp);
  if (!fs.existsSync(exp)) throw new Error("That file doesn't exist");
  await as(`tell application "Finder" to move POSIX file "${asq(exp)}" to trash`);
  return `Moved to trash: ${path.basename(exp)}`;
}

async function openFile(fp) {
  if (!fp) throw new Error("No path");
  const exp = homePath(fp);
  if (!fs.existsSync(exp)) throw new Error("That file doesn't exist");
  if (IS_MAC) await run("open", [exp]);
  else if (IS_WIN) await ps("Start-Process -FilePath $env:JARVIS_ARG", exp);
  else await run("xdg-open", [exp]);
  return `Opened ${path.basename(exp)}`;
}

// ─── Calendar ──────────────────────────────────────────────────────────────────
// macOS gives the Calendar/Automation permission to the BINARY running osascript (node):
// add your node binary in System Settings → Privacy → Calendars AND Automation → node → Calendar.
function calendarDenied(e) {
  const msg = (e.stderr || e.message || "").toLowerCase();
  return msg.includes("not allowed") || msg.includes("authorization") || msg.includes("1743") || msg.includes("not authorised");
}

async function getCalendar() {
  if (!IS_MAC) return "Calendar only on macOS";

  // icalBuddy (optional, no permission dialog)
  try {
    const out = await run("icalBuddy", ["-n", "eventsToday"]);
    if (out) return out.replace(/\x1b\[[0-9;]*m/g, "");
  } catch {}

  const script = [
    'tell application "Calendar"',
    '  set todayEvents to ""',
    '  set startOfDay to current date',
    '  set time of startOfDay to 0',
    '  set endOfDay to startOfDay + 86399',
    '  repeat with aCal in calendars',
    '    try',
    '      repeat with ev in (every event of aCal whose start date >= startOfDay and start date <= endOfDay)',
    '        set todayEvents to todayEvents & (summary of ev) & " at " & (time string of (start date of ev)) & linefeed',
    '      end repeat',
    '    end try',
    '  end repeat',
    '  if todayEvents is "" then return "No events today"',
    '  return todayEvents',
    'end tell',
  ].join("\n");

  try {
    return (await as(script, 25000)) || "No events today";
  } catch (e) {
    if (calendarDenied(e)) {
      return "Calendar access denied. Fix: System Settings → Privacy → Calendars → add your node binary (run: which node). Also Automation → node → Calendar → ON.";
    }
    throw e;
  }
}

/** "today" | "tomorrow" | "monday" | "2026-10-30" | "October 30" + "3pm" | "15:30" | "3:00 PM" → Date */
function parseWhen(dateStr, timeStr) {
  const now = new Date();
  let d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ds = String(dateStr || "today").toLowerCase().trim();

  if (ds === "tomorrow") d.setDate(d.getDate() + 1);
  else if (ds && ds !== "today") {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const wd = days.findIndex((w) => ds.includes(w));
    if (wd >= 0) {
      let diff = (wd - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      d.setDate(d.getDate() + diff);
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(ds)) {
      const [y, m, dd] = ds.split("-").map(Number);
      d = new Date(y, m - 1, dd);
    } else {
      const p = new Date(ds);
      if (!Number.isNaN(p.getTime())) {
        d = new Date(p.getFullYear() < now.getFullYear() ? now.getFullYear() : p.getFullYear(), p.getMonth(), p.getDate());
        if (p.getFullYear() < now.getFullYear() && d < new Date(now.getFullYear(), now.getMonth(), now.getDate())) d.setFullYear(d.getFullYear() + 1);
      }
    }
  }

  let h = 12, mi = 0;
  const ts = String(timeStr || "").toLowerCase().trim();
  if (ts === "noon") { h = 12; }
  else if (ts === "midnight") { h = 0; }
  else {
    const m = ts.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
    if (m) {
      h = parseInt(m[1], 10); mi = m[2] ? parseInt(m[2], 10) : 0;
      const ap = m[3] ? m[3][0] : null;
      if (ap === "p" && h < 12) h += 12;
      if (ap === "a" && h === 12) h = 0;
    }
  }
  d.setHours(clamp(h, 0, 23), clamp(mi, 0, 59), 0, 0);
  return d;
}

async function addCalendar(title, date, time) {
  if (!title) throw new Error("No title");
  if (!IS_MAC) return "Calendar only on macOS";
  const when = parseWhen(date, time);

  const script = [
    'set d to current date',
    'set day of d to 1',
    `set year of d to ${when.getFullYear()}`,
    `set month of d to ${when.getMonth() + 1}`,
    `set day of d to ${when.getDate()}`,
    `set hours of d to ${when.getHours()}`,
    `set minutes of d to ${when.getMinutes()}`,
    'set seconds of d to 0',
    'set e to d + 3600',
    'tell application "Calendar"',
    '  tell (first calendar whose writable is true)',
    `    make new event with properties {summary:"${asq(title)}", start date:d, end date:e}`,
    '  end tell',
    'end tell',
    'return "ok"',
  ].join("\n");

  try {
    await as(script, 25000);
    return `Added "${title}" to your calendar for ${when.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  } catch (e) {
    if (calendarDenied(e)) return "Calendar access denied — grant your node binary access in System Settings → Privacy → Calendars";
    throw new Error(`Couldn't add the event: ${(e.message || "").split("\n")[0].slice(0, 120)}`);
  }
}

// ─── Shortcuts / Messaging ─────────────────────────────────────────────────────
async function runShortcut(name) {
  if (!name) throw new Error("No shortcut name");
  if (!IS_MAC) return "Shortcuts only on macOS";
  try {
    await run("shortcuts", ["run", String(name)], { timeout: 60000 });
    return `Shortcut "${name}" executed`;
  } catch {
    return `Shortcut "${name}" failed — make sure it exists in the Shortcuts app`;
  }
}

async function sendMessage(to, msg) {
  if (!to || !msg) throw new Error("Missing to or message");
  if (!IS_MAC) throw new Error("iMessage only on macOS");
  try {
    await as([
      'tell application "Messages"',
      '  set svc to 1st service whose service type = iMessage',
      `  set b to buddy "${asq(to)}" of svc`,
      `  send "${asq(msg)}" to b`,
      'end tell',
    ].join("\n"));
    return `iMessage sent to ${to}`;
  } catch (e) {
    if (calendarDenied(e)) return "Messages access denied. Run: bash setup-permissions.sh — grant Automation → node → Messages.";
    // Fallback: open Messages pre-filled (needs a phone number or email)
    try { await run("open", [`imessage://${encodeURIComponent(to)}?body=${encodeURIComponent(msg)}`]); }
    catch { await run("open", ["-a", "Messages"]); }
    return `Opened Messages to ${to} — press send (use their phone number or email so it can send automatically)`;
  }
}

// ─── Window management ─────────────────────────────────────────────────────────
async function focusApp(app) {
  if (!app) return;
  try { await run("open", ["-a", resolveApp(app)]); await sleep(450); } catch {}
}

async function windowSnap(app, side) {
  if (!IS_MAC) return "Window snap only on macOS";
  await focusApp(app); // snap acts on the FRONT window, so bring the target app forward first
  try {
    await run("open", ["-g", `rectangle://execute-action?name=${side === "left" ? "left-half" : "right-half"}`]);
    return `Snapped ${app || "window"} ${side}`;
  } catch {
    return "Install the Rectangle app for window snapping: https://rectangleapp.com";
  }
}

async function windowFullscreen(app) {
  if (!IS_MAC) return "Window control only on macOS";
  await focusApp(app);
  await as(`tell application "System Events" to keystroke "f" using {command down, control down}`);
  return `${app ? resolveApp(app) : "Window"} fullscreen toggled`;
}

module.exports = {
  executeMacCommand, getScreenSize,
  _internal: { parseCombo, parseWhen, asq, homePath, normUrl, cleanAppName },
};
