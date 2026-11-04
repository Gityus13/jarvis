require("./helpers/env");
const test = require("node:test");
const assert = require("node:assert/strict");
const { routeCommand } = require("../src/command-router");

const CASES = [
  ["Open Spotify.", { action: "open_app", app: "Spotify" }],
  ["open the calculator app", { action: "open_app", app: "calculator" }],
  ["can you open chrome please", { action: "open_app", app: "chrome" }],
  ["open https://github.com/Gityus13", { action: "open_url", url: "https://github.com/Gityus13" }],
  ["open youtube dot com", { action: "open_url", url: "youtube.com" }],
  ["open file /Users/x/Documents/My Resume.pdf", { action: "open_file", path: "/Users/x/Documents/My Resume.pdf" }],
  ["type Hello World from Baku", { action: "type_text", text: "Hello World from Baku" }],          // keeps capitals
  ["Create a folder called Projects", { action: "create_folder", path: "~/Desktop/Projects" }],       // keeps capitals
  ["copy Hello There to clipboard", { action: "set_clipboard", text: "Hello There" }],
  ["search for best pizza in Baku", { action: "search_web", query: "best pizza in Baku" }],
  ["press command shift 4", { action: "key_press", key: "command shift 4" }],
  ["run shortcut Morning", { action: "run_shortcut", name: "Morning" }],
  ["snap safari to the left", { action: "window_left", app: "safari" }],
  ["close spotify", { action: "close_app", app: "spotify" }],
  ["screenshot", { action: "screenshot" }], ["volume up", { action: "system", command: "volume_up" }], ["whats my battery", { action: "get_battery" }],
  ["Jarvis open slack", { action: "open_app", app: "slack" }],
];
for (const [phrase, want] of CASES) test(`"${phrase}"`, () => assert.deepEqual(routeCommand(phrase), want));

// sentences that merely START with a command word must go to the AI, not be hijacked
for (const phrase of ["find out why the sky is blue", "start by explaining relativity to me please", "run a test of the system", "tell me a joke", "what time is it in Tokyo"])
  test(`not hijacked: "${phrase}"`, () => assert.equal(routeCommand(phrase), null));

test("folder names can't escape the Desktop", () => {
  const r = routeCommand("create folder My Stuff/../../x");
  const name = r.path.replace("~/Desktop/", "");
  assert.ok(!/[\\/]/.test(name), r.path);          // a single folder name: no separators, so no traversal
});
