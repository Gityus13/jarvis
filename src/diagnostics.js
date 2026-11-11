// Self-diagnostics — shows exactly what works and what doesn't (with the fix).
const os = require("os");
const fs = require("fs-extra");
const path = require("path");
const fetch = require("node-fetch");
const mac = require("./mac-control");
const kokoro = require("./kokoro");
const tts = require("./tts");
const web = require("./skills/web");
const { checkOllama } = require("./ollama");

const IS_MAC = process.platform === "darwin";
const ok   = (id, label, detail) => ({ id, label, status: "ok", detail });
const warn = (id, label, detail, fix) => ({ id, label, status: "warn", detail, fix });
const fail = (id, label, detail, fix) => ({ id, label, status: "fail", detail, fix });

async function runAll(model) {
  const out = [];
  const tasks = [];
  const add = (fn) => tasks.push(fn().catch((e) => fail("err", "Check failed", e.message)));

  out.push(ok("server", "Core server", `Node ${process.version} · ${os.type()} ${os.release()}`));

  add(async () => {
    const o = await checkOllama(model);
    if (!o.running) return fail("ollama", "AI engine (Ollama)", "Not running", "Run in a terminal: ollama serve");
    if (!o.modelFound) return fail("model", "Language model", `${model} is not installed`, `Run: ollama pull ${model}   (cloud models: ollama signin)`);
    return ok("ollama", "AI engine (Ollama)", `${model} ready`);
  });

  add(async () => {
    const t0 = Date.now();
    try {
      const r = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { timeout: 5000 });
      return r.ok ? ok("net", "Internet", `${Date.now() - t0} ms`) : warn("net", "Internet", `HTTP ${r.status}`, "Check your connection");
    } catch { return warn("net", "Internet", "Offline", "Weather, news, markets and translate need internet. Speech recognition does too."); }
  });

  add(async () => {
    const [w, n] = await Promise.allSettled([web.weatherData(), web.headlines("world", 1)]);
    const parts = [w.status === "fulfilled" ? "weather" : null, n.status === "fulfilled" ? "news" : null].filter(Boolean);
    if (parts.length === 2) return ok("intel", "Intel feeds", `weather · news · ${w.value.place}`);
    if (parts.length === 1) return warn("intel", "Intel feeds", `only ${parts[0]} responded`, "Try again in a minute");
    return warn("intel", "Intel feeds", "No data", "Needs internet. Say: set my city to <your city>");
  });

  const k = kokoro.info();
  const kd = k.pct != null && k.pct < 100 ? `downloading model ${k.pct}%${k.totalMB ? ` (${k.loadedMB}/${k.totalMB} MB)` : ""}` : "starting up";
  out.push(
    k.state === "ready" ? ok("voice", "Voice engine", `Kokoro neural voice · first line in ${k.warmMs} ms`)
    : tts.elAvailable() ? ok("voice", "Voice engine", "ElevenLabs")
    : k.state === "loading" ? warn("voice", "Voice engine", `Kokoro ${kd} — system voice until it's ready`, "First run only. Leave JARVIS running; progress is also printed in the terminal.")
    : k.error && !/not installed|disabled/.test(k.error) ? warn("voice", "Voice engine", `Kokoro failed: ${k.error}`, k.hint)
    : warn("voice", "Voice engine", "System voice (browser)", k.error && /disabled/.test(k.error) ? "Kokoro is off in .env" : "For a better voice: npm i kokoro-js, then restart")
  );

  if (mac.hasRobot()) out.push(ok("robot", "Keyboard / mouse control", "robotjs loaded"));
  else out.push(warn("robot", "Keyboard / mouse control", "robotjs not installed", IS_MAC ? "Run: xcode-select --install   then: npm install" : "Run: npm install"));

  if (IS_MAC) {
    add(async () => {
      try { await mac.as('return "ok"', 5000); } catch { return fail("applescript", "AppleScript", "osascript failed", "Run: bash setup-permissions.sh"); }
      const acc = await mac.checkAccessibility();
      return acc ? ok("access", "Accessibility permission", "granted")
        : fail("access", "Accessibility permission", "Not granted — typing, key presses and clicks will silently do nothing",
               "System Settings → Privacy & Security → Accessibility → add Terminal (or iTerm / VS Code), whichever runs node");
    });
  }

  try { const f = require("./paths").DATA; fs.ensureDirSync(f); fs.accessSync(f, fs.constants.W_OK); out.push(ok("store", "Memory store", "writable")); }
  catch { out.push(fail("store", "Memory store", "data/ is not writable", "Check folder permissions")); }

  return out.concat(await Promise.all(tasks));
}

module.exports = { runAll };
