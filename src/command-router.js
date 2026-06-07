// Fast pre-routing — avoids AI round-trip for simple commands
const EXACT = {
  "screenshot": { action: "screenshot" }, "take a screenshot": { action: "screenshot" },
  "battery": { action: "get_battery" }, "battery status": { action: "get_battery" },
  "what's my battery": { action: "get_battery" }, "check battery": { action: "get_battery" },
  "volume up": { action: "system", command: "volume_up" }, "turn volume up": { action: "system", command: "volume_up" },
  "volume down": { action: "system", command: "volume_down" }, "turn volume down": { action: "system", command: "volume_down" },
  "mute": { action: "system", command: "mute" }, "mute audio": { action: "system", command: "mute" },
  "unmute": { action: "system", command: "unmute" },
  "lock screen": { action: "lock_screen" }, "lock": { action: "lock_screen" }, "lock the screen": { action: "lock_screen" },
  "sleep": { action: "sleep" },
  "empty trash": { action: "empty_trash" }, "empty the trash": { action: "empty_trash" },
  "clipboard": { action: "get_clipboard" }, "what's in my clipboard": { action: "get_clipboard" },
  "calendar": { action: "get_calendar" }, "my schedule": { action: "get_calendar" }, "today's events": { action: "get_calendar" },
  "wifi": { action: "get_wifi" }, "wifi status": { action: "get_wifi" },
  "what time is it": { action: "get_time" }, "current time": { action: "get_time" },
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
  "escape": { action: "key_press", key: "escape" },
  "press escape": { action: "key_press", key: "escape" },
  "press enter": { action: "key_press", key: "enter" },
};

function routeCommand(input) {
  const n = input.toLowerCase().trim().replace(/[?!.,]$/, "");
  if (EXACT[n]) return EXACT[n];

  // Open app
  let m = n.match(/^(?:open|launch|start)\s+(.+)$/);
  if (m) return { action: "open_app", app: m[1].trim() };

  // Close/quit
  m = n.match(/^(?:close|quit|exit)\s+(.+)$/);
  if (m) return { action: "close_app", app: m[1].trim() };

  // Search
  m = n.match(/^(?:search|google|look up|find)\s+(?:for\s+)?(.+)$/);
  if (m) return { action: "search_web", query: m[1].trim() };

  // Type text
  m = n.match(/^type\s+(.+)$/);
  if (m) return { action: "type_text", text: m[1].trim() };

  // Key press
  m = n.match(/^press\s+(.+)$/);
  if (m) return { action: "key_press", key: m[1].trim() };

  // Move mouse
  m = n.match(/^move mouse to (\d+)[, ]+(\d+)$/);
  if (m) return { action: "move_mouse", x: parseInt(m[1]), y: parseInt(m[2]) };

  // Scroll
  m = n.match(/^scroll\s+(up|down)\s+(\d+)$/);
  if (m) return { action: "scroll", direction: m[1], amount: parseInt(m[2]) };

  // Create folder
  m = n.match(/create\s+(?:a\s+)?(?:new\s+)?folder\s+(?:called|named)?\s*(.+)/);
  if (m) return { action: "create_folder", path: `~/Desktop/${m[1].trim().replace(/^(?:called|named)\s+/i, "")}` };

  // Copy to clipboard
  m = n.match(/copy\s+(.+?)\s+to\s+clipboard/);
  if (m) return { action: "set_clipboard", text: m[1].trim() };

  // Run shortcut
  m = n.match(/^(?:run|trigger|execute)\s+(?:shortcut\s+)?(.+)$/);
  if (m) return { action: "run_shortcut", name: m[1].trim() };

  // Window snap
  m = n.match(/^(?:snap|move|put)\s+(.+?)\s+(?:to\s+)?(?:the\s+)?left$/);
  if (m) return { action: "window_left", app: m[1].trim() };
  m = n.match(/^(?:snap|move|put)\s+(.+?)\s+(?:to\s+)?(?:the\s+)?right$/);
  if (m) return { action: "window_right", app: m[1].trim() };
  m = n.match(/^(?:fullscreen|full screen|maximize)\s+(.+)$/);
  if (m) return { action: "window_fullscreen", app: m[1].trim() };

  // Open URL
  m = n.match(/^(?:open|go to|visit)\s+(https?:\/\/\S+)$/);
  if (m) return { action: "open_url", url: m[1].trim() };

  return null;
}

module.exports = { routeCommand };
