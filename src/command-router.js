// Fast pre-routing — avoids an AI round-trip for simple commands.
// Matching is done on a cleaned copy of what you said, but text you want TYPED / COPIED /
// used as a folder name keeps its original capitalisation.

const strip = (s) => s.toLowerCase().replace(/['’]/g, "");

const EXACT_RAW = {
  "screenshot": { action: "screenshot" }, "take a screenshot": { action: "screenshot" }, "take screenshot": { action: "screenshot" },
  "battery": { action: "get_battery" }, "battery status": { action: "get_battery" }, "battery level": { action: "get_battery" },
  "whats my battery": { action: "get_battery" }, "check battery": { action: "get_battery" }, "how much battery do i have": { action: "get_battery" },
  "volume up": { action: "system", command: "volume_up" }, "turn volume up": { action: "system", command: "volume_up" }, "turn it up": { action: "system", command: "volume_up" }, "louder": { action: "system", command: "volume_up" },
  "volume down": { action: "system", command: "volume_down" }, "turn volume down": { action: "system", command: "volume_down" }, "turn it down": { action: "system", command: "volume_down" }, "quieter": { action: "system", command: "volume_down" },
  "mute": { action: "system", command: "mute" }, "mute audio": { action: "system", command: "mute" },
  "unmute": { action: "system", command: "unmute" },
  "lock screen": { action: "lock_screen" }, "lock": { action: "lock_screen" }, "lock the screen": { action: "lock_screen" }, "lock my screen": { action: "lock_screen" },
  "sleep": { action: "sleep" }, "go to sleep": { action: "sleep" },
  "empty trash": { action: "empty_trash" }, "empty the trash": { action: "empty_trash" },
  "clipboard": { action: "get_clipboard" }, "whats in my clipboard": { action: "get_clipboard" }, "read clipboard": { action: "get_clipboard" },
  "calendar": { action: "get_calendar" }, "my schedule": { action: "get_calendar" }, "todays events": { action: "get_calendar" }, "whats on my calendar": { action: "get_calendar" },
  "wifi": { action: "get_wifi" }, "wifi status": { action: "get_wifi" }, "whats my wifi": { action: "get_wifi" },
  "what time is it": { action: "get_time" }, "current time": { action: "get_time" }, "whats the time": { action: "get_time" }, "what is the time": { action: "get_time" }, "time": { action: "get_time" },
  "scroll down": { action: "scroll", direction: "down", amount: 5 },
  "scroll up": { action: "scroll", direction: "up", amount: 5 },
  "click": { action: "click_mouse", button: "left" },
  "right click": { action: "right_click" },
  "double click": { action: "double_click" },
  "copy": { action: "key_press", key: "cmd+c" },
  "paste": { action: "key_press", key: "cmd+v" },
  "undo": { action: "key_press", key: "cmd+z" },
  "select all": { action: "key_press", key: "cmd+a" },
  "save": { action: "key_press", key: "cmd+s" },
  "escape": { action: "key_press", key: "escape" }, "press escape": { action: "key_press", key: "escape" },
  "press enter": { action: "key_press", key: "enter" },
};
const EXACT = {};
for (const [k, v] of Object.entries(EXACT_RAW)) EXACT[strip(k)] = v;

const DOMAIN = /^(?:https?:\/\/\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)$/i;

// "youtube dot com" → "youtube.com"
const fixDots = (s) => s.replace(/\s+dot\s+(com|org|net|io|az|dev|app|ai|co|edu|gov|ru|tr|uk|de)\b/gi, ".$1");

function tidy(input) {
  let s = String(input || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:hey |ok |okay )?(?:jarvis|friday|ultron)\b[\s,.:!-]*/i, "");           // leftover wake word
  for (let i = 0; i < 2; i++) s = s.replace(/^(?:please|can you|could you|would you|will you|i want you to|i need you to)\s+/i, "");
  s = s.replace(/\s+(?:please|for me|right now|now)$/i, "");
  s = s.replace(/[?!.,;:]+$/, "").trim();
  return s;
}

const appName = (x) => x.trim().replace(/^(?:the|my|up|a)\s+/i, "").replace(/\s+(?:app|application)$/i, "").trim();
const shortName = (x) => x && x.split(/\s+/).length <= 3;   // longer = probably a sentence for the AI, not an app

function routeCommand(input) {
  const s = tidy(input);
  if (!s) return null;
  const n = strip(s);
  if (EXACT[n]) return { ...EXACT[n] };

  let m;

  // Open / go to URL or website  (must be checked BEFORE "open app")
  m = fixDots(s).match(/^(?:open|go to|visit|launch|browse to)\s+(\S+)$/i);
  if (m && DOMAIN.test(m[1])) return { action: "open_url", url: m[1] };

  // Open app
  m = s.match(/^(?:open|launch|start)\s+(.+)$/i);
  if (m) { const app = appName(m[1]); if (app && shortName(app)) return { action: "open_app", app }; }

  // Close / quit app
  m = s.match(/^(?:close|quit|exit)\s+(.+)$/i);
  if (m) { const app = appName(m[1]); if (app && shortName(app)) return { action: "close_app", app }; }

  // Web search
  m = s.match(/^(?:search(?:\s+(?:google|the web|online))?(?:\s+for)?|google|look up)\s+(.+)$/i);
  if (m) return { action: "search_web", query: m[1].trim() };

  // Type text (keeps your capitalisation)
  m = s.match(/^type\s+(.+)$/i);
  if (m) return { action: "type_text", text: m[1] };

  // Key press
  m = s.match(/^press\s+(.+)$/i);
  if (m) return { action: "key_press", key: m[1].trim() };

  // Move mouse
  m = n.match(/^move (?:the )?mouse to (\d+)[, ]+(\d+)$/);
  if (m) return { action: "move_mouse", x: parseInt(m[1], 10), y: parseInt(m[2], 10) };

  // Scroll
  m = n.match(/^scroll\s+(up|down)\s+(\d+)$/);
  if (m) return { action: "scroll", direction: m[1], amount: parseInt(m[2], 10) };

  // Create folder (keeps capitalisation; strips anything that could escape Desktop)
  m = s.match(/^(?:create|make|new)\s+(?:a\s+)?(?:new\s+)?folder(?:\s+(?:called|named))?\s+(.+)$/i);
  if (m) {
    const name = m[1].trim().replace(/[\\/:*?"<>|]/g, "").replace(/^\.+/, "").trim();
    if (name) return { action: "create_folder", path: `~/Desktop/${name}` };
  }

  // Copy text to clipboard
  m = s.match(/^copy\s+(.+?)\s+to\s+(?:the\s+)?clipboard$/i);
  if (m) return { action: "set_clipboard", text: m[1].trim() };

  // Run shortcut (needs the word "shortcut" so normal sentences starting with "run" go to the AI)
  m = s.match(/^(?:run|trigger|execute)\s+(?:the\s+)?shortcut\s+(.+)$/i) || s.match(/^(?:run|trigger|execute)\s+(?:the\s+)?(.+?)\s+shortcut$/i);
  if (m) return { action: "run_shortcut", name: m[1].trim() };

  // Window snap / fullscreen
  m = s.match(/^(?:snap|move|put)\s+(.+?)\s+(?:to\s+)?(?:the\s+)?left$/i);
  if (m) return { action: "window_left", app: appName(m[1]) };
  m = s.match(/^(?:snap|move|put)\s+(.+?)\s+(?:to\s+)?(?:the\s+)?right$/i);
  if (m) return { action: "window_right", app: appName(m[1]) };
  m = s.match(/^(?:fullscreen|full screen|maximize)\s+(.+)$/i);
  if (m) return { action: "window_fullscreen", app: appName(m[1]) };

  return null;
}

module.exports = { routeCommand };
