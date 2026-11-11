// Drives the REAL console (public/index.html + core/voice/app.js) in jsdom with a fake microphone,
// fake speakers and a fake server. Covers the voice behaviours that used to be broken:
// mic never listens to JARVIS itself, wake word + command in one breath, hold-to-talk waits for the last word…
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const pub = path.join(__dirname, "..", "public");
const html = fs.readFileSync(path.join(pub, "index.html"), "utf8").replace(/<script src="[^"]+"><\/script>/g, "").replace(/<link[^>]*>/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dom = new JSDOM(html, { url: "http://localhost:3000/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;

// ── fakes ────────────────────────────────────────────────────────────────────
const recognizers = [];
class FakeSR {
  constructor() { this.started = false; recognizers.push(this); }
  start() { this.started = true; setTimeout(() => this.onstart && this.onstart(), 0); }
  stop() { this.stopped = true; } abort() { this.aborted = true; }
  emit(list) {
    const results = list.map((r) => { const a = (Array.isArray(r.t) ? r.t : [r.t]).map((t) => ({ transcript: t })); a.isFinal = !!r.final; return a; });
    this.onresult && this.onresult({ resultIndex: 0, results });
  }
}
w.SpeechRecognition = FakeSR; w.webkitSpeechRecognition = FakeSR;

const sent = []; let socket;
class FakeWS { constructor(u) { this.url = u; this.readyState = 1; socket = this; setTimeout(() => this.onopen && this.onopen(), 5); } send(d) { sent.push(JSON.parse(d)); } close() {} }
w.WebSocket = FakeWS;
const fromServer = (m) => socket.onmessage({ data: JSON.stringify(m) });

const spoken = []; let utterance = null;
w.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
w.speechSynthesis = { getVoices: () => [], speak(u) { utterance = u; spoken.push(u.text); }, cancel() { utterance = null; } };
const finishSpeaking = () => { const u = utterance; utterance = null; u && u.onend && u.onend(); };

const api = {
  "/api/tts": { ok: false, status: 501, json: async () => ({}) },
  "/api/status": { ok: true, json: async () => ({ ollama: { running: true, modelFound: true }, model: "m", tts: { kokoro: "unavailable", elevenlabs: false, voices: { JARVIS: "Daniel" } } }) },
  "/api/telemetry": { ok: true, json: async () => ({ cpu: 42, cpuHist: [10, 20, 42], mem: { used: 8e9, total: 16e9, pct: 50, hist: [50, 50] }, disk: { used: 1, total: 4, pct: 25 }, battery: { pct: 64, state: "discharging" }, procs: [{ name: "node", cpu: 3.2, mem: 1 }], net: { ms: 80, ok: true }, load: [1, 1, 1], uptime: 5000, cores: 8, host: "mac", platform: "Darwin 24", node: "v22", t: 1 }) },
  "/api/intel": { ok: true, json: async () => ({ weather: { ok: false }, markets: { ok: false }, news: { ok: false }, tech: { ok: false } }) },
  "/api/diagnostics": { ok: true, json: async () => ([{ label: "Core server", status: "ok", detail: "x" }, { label: "Accessibility permission", status: "fail", detail: "Not granted", fix: "System Settings → Privacy" }]) },
  "/api/commands": { ok: true, json: async () => ([{ cat: "INTEL", cmd: "weather in London", desc: "Forecast" }, { cat: "DATA", cmd: "add task ", desc: "Add" }]) },
};
w.fetch = async (u) => { const k = Object.keys(api).find((x) => u.includes(x)); return k ? api[k] : { ok: false, status: 404, json: async () => ({}) }; };
w.requestAnimationFrame = () => 0;
const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
w.HTMLCanvasElement.prototype.getContext = () => noop;
w.HTMLElement.prototype.scrollIntoView = () => {};
w.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error("no mic in tests")) };
w.Notification = undefined;
w.HTMLMediaElement.prototype.play = () => Promise.resolve();      // jsdom has no media playback
w.HTMLMediaElement.prototype.pause = () => {};
w.URL.createObjectURL = () => "blob:test"; w.URL.revokeObjectURL = () => {};
const pageErrors = []; w.addEventListener("error", (e) => pageErrors.push(e.message));
for (const f of ["core", "voice", "app"]) w.eval(fs.readFileSync(path.join(pub, "js", f + ".js"), "utf8"));

const $ = (id) => w.document.getElementById(id);
const live = () => recognizers.filter((r) => r.started && !r.aborted);
const feed = () => Array.from($("feed").querySelectorAll(".ln, .card")).map((e) => e.textContent.replace(/\s+/g, " ").trim());
const key = (type, code, extra = {}) => w.document.dispatchEvent(new w.KeyboardEvent(type, { code, key: extra.key || code, bubbles: true, ...extra }));
const sentText = () => sent.filter((m) => m.type === "text_input").map((m) => m.text);

test("boot → enter → greeting is spoken, and the mic stays closed while it plays", async () => {
  await sleep(300);
  fromServer({ type: "init", sessionId: "abc", personality: "JARVIS", personalities: ["JARVIS", "FRIDAY", "ULTRON"], message: "Good evening. Online.", user: "Tester", profiles: { JARVIS: { name: "J.A.R.V.I.S.", tag: "TIC" }, FRIDAY: { name: "F.R.I.D.A.Y.", tag: "FRU" }, ULTRON: { name: "ULTRON", tag: "CLE" } } });
  await sleep(100);
  assert.equal($("modes").children.length, 3);
  assert.ok(feed().some((t) => /Link established/.test(t)) && feed().some((t) => /Good evening/.test(t)));
  key("keydown", "KeyA"); await sleep(2400); key("keydown", "Enter"); await sleep(1500);      // skip + enter the boot screen
  assert.ok($("app").classList.contains("live"));
  assert.ok(spoken.includes("Good evening. Online."), "greeting spoken with the browser voice (server voice unavailable)");
  assert.equal(live().length, 0, "mic closed while JARVIS talks");
  finishSpeaking(); await sleep(2800);
  assert.equal(live().length, 1, "wake-word listening starts after the greeting");
  assert.equal(live()[0].continuous, true);
});

test("'Hey Jarvis' + command in one breath, with fuzzy matching (Travis)", async () => {
  live()[0].emit([{ t: ["hey travis what's the weather in london", "hey jarvis what's the weather in london"], final: true }]);
  await sleep(300);
  assert.ok(sentText().some((t) => /weather in london/.test(t)));
});

test("replies are spoken and rendered; the mic only returns after speech ends", async () => {
  fromServer({ type: "jarvis_response", text: "London. 12 degrees.", skill: "weather" });
  fromServer({ type: "card", card: { title: "WEATHER · LONDON", sub: "12°C", rows: [["FEELS", "10"]], items: [{ t: "Open", u: "https://x" }, { t: "Run", m: "cmd", cmd: "news" }] } });
  await sleep(100);
  assert.ok(feed().some((t) => /London\. 12 degrees/.test(t)) && feed().some((t) => /WEATHER · LONDON/.test(t)));
  assert.equal(utterance && utterance.text, "London. 12 degrees.");
  assert.equal(live().length, 0);
  finishSpeaking(); await sleep(2800);
  assert.equal(live().length, 1);
  sent.length = 0; w.document.querySelectorAll(".ci li")[1].click();
  assert.ok(sentText().includes("news"), "clicking a card item runs its command");
});

test("bare wake word → acknowledgement → command mic opens only AFTER it finishes", async () => {
  fromServer({ type: "stream_end" }); await sleep(2800);
  const before = recognizers.length;
  live()[0].emit([{ t: "jarvis", final: true }]); await sleep(150);
  assert.equal(spoken[spoken.length - 1], "Yes?");
  await sleep(1300);
  assert.equal(recognizers.length, before, "command mic must NOT open while the acknowledgement plays (it used to transcribe itself)");
  finishSpeaking(); await sleep(700);
  assert.ok(recognizers.length > before && live().length === 1);
  sent.length = 0;
  const r = live()[0]; r.emit([{ t: "add task", final: false }]); await sleep(100); r.emit([{ t: "add task buy milk", final: true }]); await sleep(1300);
  assert.ok(sentText().includes("add task buy milk"), "full sentence sent on silence");
});

test("hold SPACE: waits for the recognizer's final words before sending", async () => {
  fromServer({ type: "jarvis_response", text: "Done." }); await sleep(50); finishSpeaking(); await sleep(800); sent.length = 0;
  key("keydown", "Space"); await sleep(150);
  const rec = recognizers[recognizers.length - 1]; rec.emit([{ t: "open", final: false }]);
  key("keyup", "Space"); await sleep(100);
  assert.ok(rec.stopped && sentText().length === 0, "asked to stop, nothing sent yet");
  rec.emit([{ t: "open spotify please", final: true }]); rec.onend(); await sleep(100);
  assert.ok(sentText().includes("open spotify please"), "the LAST words are included");
});

test("panels: tasks, timers, notes, alerts and their server messages", async () => {
  fromServer({ type: "data", data: { tasks: [{ id: 5, text: "Buy milk", done: false }, { id: 6, text: "Ship it", done: true }], notes: [{ id: 9, text: "Renew domain" }], reminders: [{ id: 7, kind: "timer", label: "Timer", at: Date.now() + 125000 }] } });
  assert.equal($("p-tasks").children.length, 2);
  assert.equal($("t-count").textContent, "1 OPEN");
  assert.match($("p-timers").textContent, /0?2:0\d/);
  sent.length = 0; $("p-tasks").querySelector(".ck").click(); $("p-timers").querySelector(".rm").click();
  assert.ok(sent.some((m) => m.type === "task_toggle" && m.id === 5) && sent.some((m) => m.type === "reminder_cancel" && m.id === 7));
  $("task-in").value = "call mom"; $("task-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  assert.ok(sent.some((m) => m.type === "task_add" && m.text === "call mom"));
  fromServer({ type: "alert", kind: "timer", title: "TIMER", text: "Timer complete." }); await sleep(100);
  assert.ok(feed().some((t) => /Timer complete/.test(t)) && utterance && utterance.text === "Timer complete.");
  finishSpeaking();
});

test("command palette, SYSTEMS diagnostics (with fixes) and config", async () => {
  key("keydown", "KeyK", { key: "k", ctrlKey: true }); await sleep(200);
  assert.ok(!$("palette").hidden && $("pal-list").querySelectorAll(".pi").length === 2);
  $("pal-in").value = "task"; $("pal-in").dispatchEvent(new w.Event("input"));
  assert.equal($("pal-list").querySelectorAll(".pi").length, 1);
  key("keydown", "Enter"); await sleep(100);
  assert.ok($("palette").hidden && $("input").value === "add task ", "commands ending in a space are placed in the box for you to finish");
  $("input").value = ""; $("btn-systems").click(); await sleep(300);
  assert.match($("diag-list").textContent, /Accessibility permission/);
  assert.match($("diag-list").textContent, /System Settings/, "the fix is shown next to the failure");
  assert.match($("diag-sum").textContent, /NEED ATTENTION/);
  key("keydown", "Escape"); assert.ok($("systems").hidden);
  $("btn-config").click(); $("cfg-wake").checked = false; $("cfg-wake").dispatchEvent(new w.Event("change")); await sleep(100);
  assert.equal(live().length, 0, "disabling the wake word stops listening");
  assert.equal(w.localStorage.getItem("jarvis_wake"), "0");
  key("keydown", "Escape");
});

test("mode switch re-themes the console; losing the connection shows OFFLINE", async () => {
  fromServer({ type: "personality_changed", personality: "ULTRON", greeting: "Ultron engaged." }); await sleep(100);
  assert.equal(w.document.documentElement.getAttribute("data-mode"), "ULTRON");
  assert.equal($("brand-name").textContent, "ULTRON");
  socket.readyState = 3; socket.onclose(); await sleep(250);
  assert.equal($("state-label").textContent, "OFFLINE");
});

test("no uncaught page errors", () => assert.deepEqual(pageErrors, []));

// the console runs timers/intervals — close the window so the test process can exit
test.after(() => w.close());
