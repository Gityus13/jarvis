// Builds a fresh, fully-faked browser console (jsdom): fake microphone/recognizer, speakers, <audio>, permissions API,
// tab visibility, WebSocket and server. Used by the tests that need a clean page each time.
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const pub = path.join(__dirname, "..", "..", "public");
const html = fs.readFileSync(path.join(pub, "index.html"), "utf8").replace(/<script src="[^"]+"><\/script>/g, "").replace(/<link[^>]*>/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createConsole(opts = {}) {
  const dom = new JSDOM(html, { url: "http://localhost:3000/", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  const c = { w, sleep, recognizers: [], sockets: [], sent: [], spoken: [], playCalls: [], fetched: [], errors: [],
              hidden: false, permission: opts.permission === undefined ? "granted" : opts.permission,
              kokoro: opts.kokoro || "unavailable", ttsOk: !!opts.ttsOk, playImpl: () => Promise.resolve(), utterance: null };

  if (opts.userAgent) Object.defineProperty(w.navigator, "userAgent", { configurable: true, get: () => opts.userAgent });

  // ── tab visibility ──
  Object.defineProperty(w.document, "hidden", { configurable: true, get: () => c.hidden });
  c.setHidden = (h) => { c.hidden = h; w.document.dispatchEvent(new w.Event("visibilitychange")); };

  // ── microphone / speech recognition ──
  class FakeSR {
    constructor() { this.started = false; c.recognizers.push(this); }
    start() { this.started = true; setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { this.stopped = true; } abort() { this.aborted = true; }
    emit(list) {
      const results = list.map((r) => { const a = [{ transcript: r.t }]; a.isFinal = !!r.final; return a; });
      this.onresult && this.onresult({ resultIndex: 0, results });
    }
    fail(error) { this.onerror && this.onerror({ error }); }
  }
  w.SpeechRecognition = FakeSR; w.webkitSpeechRecognition = FakeSR;
  c.live = () => c.recognizers.filter((r) => r.started && !r.aborted);
  Object.defineProperty(w.navigator, "permissions", { configurable: true, value: opts.noPermissionsApi ? undefined : { query: async () => ({ state: c.permission }) } });
  w.navigator.mediaDevices = { getUserMedia: () => Promise.reject(new Error("no mic in tests")) };

  // ── network ──
  class FakeWS { constructor(u) { this.url = u; this.readyState = 1; c.sockets.push(this); c.socket = this; setTimeout(() => this.onopen && this.onopen(), 5); } send(d) { c.sent.push(JSON.parse(d)); } close() {} }
  w.WebSocket = FakeWS;
  c.fromServer = (m) => c.socket.onmessage({ data: JSON.stringify(m) });
  const json = (o) => ({ ok: true, status: 200, json: async () => o });
  w.fetch = async (u) => {
    c.fetched.push(String(u));
    if (u.includes("/api/tts")) return c.ttsOk ? { ok: true, status: 200, blob: async () => new w.Blob(["x"], { type: "audio/wav" }) } : { ok: false, status: 501, json: async () => ({}) };
    if (u.includes("/api/status")) return json({ ollama: { running: true, modelFound: true }, model: "m", tts: { kokoro: c.kokoro, elevenlabs: false, voices: {}, kokoroInfo: { pct: 40 } } });
    if (u.includes("/api/telemetry")) return json({ cpu: 5, cpuHist: [5], mem: { used: 1, total: 2, pct: 50, hist: [50] }, disk: null, battery: null, procs: [], net: { ms: 10, ok: true }, load: [0, 0, 0], uptime: 1, cores: 1, host: "h", platform: "p", node: "v", t: 1 });
    if (u.includes("/api/intel")) return json({ weather: { ok: false }, markets: { ok: false }, news: { ok: false }, tech: { ok: false } });
    if (u.includes("/api/diagnostics")) return json([{ label: "Core", status: "ok", detail: "x" }]);
    if (u.includes("/api/commands")) return json([]);
    return { ok: false, status: 404, json: async () => ({}) };
  };

  // ── speakers: system voice + <audio> element ──
  w.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  w.speechSynthesis = { getVoices: () => [], speak(u) { c.utterance = u; c.spoken.push(u.text); }, cancel() { c.utterance = null; } };
  c.endSystemVoice = () => { const u = c.utterance; c.utterance = null; u && u.onend && u.onend(); };
  w.HTMLMediaElement.prototype.play = function () { c.playCalls.push({ el: this, src: this.src }); return c.playImpl(this); };
  w.HTMLMediaElement.prototype.pause = function () {};
  let n = 0; w.URL.createObjectURL = () => "blob:fake-" + ++n; w.URL.revokeObjectURL = () => {};

  // ── misc ──
  w.requestAnimationFrame = () => 0;
  const noop = new Proxy(function () {}, { get: () => noop, apply: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => noop;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.Notification = opts.notification || undefined;
  w.addEventListener("error", (e) => c.errors.push(e.message));
  for (const f of ["core", "voice", "app"]) w.eval(fs.readFileSync(path.join(pub, "js", f + ".js"), "utf8"));

  c.$ = (id) => w.document.getElementById(id);
  c.key = (type, code, extra = {}) => w.document.dispatchEvent(new w.KeyboardEvent(type, { code, key: extra.key || code, bubbles: true, ...extra }));
  c.init = (extra = {}) => c.fromServer({ type: "init", sessionId: "abc", personality: "JARVIS", personalities: ["JARVIS", "FRIDAY", "ULTRON"], message: "Good evening. Online.", user: "Tester", profiles: { JARVIS: { name: "J.A.R.V.I.S.", tag: "TIC" }, FRIDAY: { name: "F.R.I.D.A.Y.", tag: "FRU" }, ULTRON: { name: "ULTRON", tag: "CLE" } }, ...extra });
  /** press a key (skips the boot animation, and is the user gesture that unlocks audio), wait until the console is live */
  c.enter = async () => {
    await sleep(250); c.init(); c.key("keydown", "KeyA");
    for (let i = 0; i < 80 && !c.$("app").classList.contains("live"); i++) await sleep(100);
    await sleep(100);
  };
  /** wait until cond() is true (polls; generous timeout so slow CI runners don't flake) */
  c.until = async (cond, ms = 10000) => {
    const t0 = Date.now();
    while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out waiting for: " + String(cond)); await sleep(40); }
  };
  c.close = () => w.close();
  return c;
}

module.exports = { createConsole, sleep };
