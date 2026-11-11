// End-to-end: starts the REAL server as a child process against a fake Ollama and talks to it
// over WebSocket/HTTP exactly like the browser does. No internet, no real model needed.
require("./helpers/env");
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const net = require("net");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const WS = require("ws");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); });

let child, port, ollama, chats = 0, base;

// ── fake Ollama ──────────────────────────────────────────────────────────────
function startOllama() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }));
      if (req.url === "/api/chat") {
        let b = ""; req.on("data", (d) => (b += d));
        req.on("end", async () => {
          chats++;
          const last = JSON.parse(b).messages.slice(-1)[0].content;
          res.writeHead(200, { "Content-Type": "application/x-ndjson" });
          const out = /delegate/i.test(last) ? ['{"action":"skill","text":"what is 2 plus 2"} ', "On it."]
                    : /slow/i.test(last)     ? ["thinking ", "slowly ", "now"]
                    : ["Hello there, ", "sir. Əla gün!"];                                   // non-ASCII must survive streaming
          for (const c of out) { res.write(JSON.stringify({ message: { content: c }, done: false }) + "\n"); await sleep(/slow/i.test(last) ? 350 : 40); }
          res.write(JSON.stringify({ done: true }) + "\n"); res.end();
        });
        return;
      }
      res.statusCode = 404; res.end("{}");
    }).listen(0, "127.0.0.1", () => resolve(srv));
  });
}

async function connect({ origin = `http://localhost:${port}`, cid } = {}) {
  return new Promise((resolve) => {
    const ws = new WS(`ws://127.0.0.1:${port}/${cid ? "?cid=" + cid : ""}`, { origin });
    const log = [];
    ws.on("message", (d) => log.push(JSON.parse(d)));
    ws.on("open", () => resolve({ ws, log, ok: true }));
    ws.on("error", () => resolve({ ok: false }));
    ws.on("unexpected-response", (_, r) => resolve({ ok: false, status: r.statusCode }));
  });
}
const say = async (c, text, wait = 500) => { c.log.length = 0; c.ws.send(JSON.stringify({ type: "text_input", text })); await sleep(wait); return c.log.slice(); };
const types = (l) => l.map((m) => m.type);
const get = (p) => fetch(`${base}${p}`).then((r) => r.json());

test.before(async () => {
  ollama = await startOllama();
  port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", KOKORO: "off", ELEVENLABS_API_KEY: "", OLLAMA_MODEL: "llama3.2", OLLAMA_URL: `http://127.0.0.1:${ollama.address().port}`, HOME_CITY: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(`${base}/api/status`)).ok) return; } catch {} await sleep(150); }
  throw new Error("server did not start");
});
test.after(() => { child && child.kill(); ollama && ollama.close(); });

test("security: foreign Origin / Host are refused (a random website can't drive your Mac)", async () => {
  const evil = await connect({ origin: "http://evil.example" });
  assert.equal(evil.ok, false, "WebSocket from another origin must be rejected");
  const post = await fetch(`${base}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://evil.example" }, body: "{}" });
  assert.equal(post.status, 403);
  const rebind = await new Promise((res) => { const q = http.request({ host: "127.0.0.1", port, path: "/api/status", headers: { Host: "evil.com" } }, (r) => { r.resume(); res(r.statusCode); }); q.end(); });
  assert.equal(rebind, 403, "DNS-rebinding Host header must be refused");
  const good = await connect();
  assert.equal(good.ok, true); good.ws.close();
});

test("init: modes, profiles and stored data arrive on connect", async () => {
  const c = await connect(); await sleep(250);
  const init = c.log.find((m) => m.type === "init");
  assert.deepEqual(init.personalities, ["JARVIS", "FRIDAY", "ULTRON"]);
  assert.ok(init.profiles.JARVIS.name && init.message);
  assert.ok(c.log.some((m) => m.type === "data"));
  c.ws.close();
});

test("direct commands run ONCE and never touch the AI", async () => {
  const c = await connect(); await sleep(200);
  const before = chats;
  const l = await say(c, "what is the date");
  assert.deepEqual(types(l).filter((t) => t !== "card"), ["user_message", "jarvis_response"]);
  const l2 = await say(c, "what time is it");
  assert.ok(types(l2).includes("action_done") && types(l2).includes("jarvis_response"));
  assert.equal(chats, before, "no AI call for built-in commands");
  c.ws.close();
});

test("skills: calculator, units, tasks, notes — with cards and live data broadcasts", async () => {
  const c = await connect(); await sleep(200);
  let l = await say(c, "what is 25 times 4");
  assert.match(l.find((m) => m.type === "jarvis_response").text, /100/);
  assert.equal(l.find((m) => m.type === "card").card.title, "CALCULATOR");
  l = await say(c, "convert 5 km to miles");
  assert.match(l.find((m) => m.type === "jarvis_response").text, /3\.1069 miles/);
  l = await say(c, "add task ship the release");
  const d = l.filter((m) => m.type === "data").pop();
  assert.ok(d.data.tasks.some((t) => /Ship the release/.test(t.text)));
  const id = d.data.tasks.find((t) => /Ship the release/.test(t.text)).id;
  c.log.length = 0; c.ws.send(JSON.stringify({ type: "task_toggle", id })); await sleep(250);
  assert.equal(c.log.filter((m) => m.type === "data").pop().data.tasks.find((t) => t.id === id).done, true, "UI toggle reaches the server and is broadcast back");
  c.log.length = 0; c.ws.send(JSON.stringify({ type: "task_add", text: "from the inline box" })); await sleep(250);
  assert.ok(c.log.filter((m) => m.type === "data").pop().data.tasks.some((t) => /From the inline box/.test(t.text)));
  c.ws.close();
});

test("timers fire a spoken alert and can be cancelled from the UI", async () => {
  const c = await connect(); await sleep(200);
  await say(c, "set a timer for 2 seconds");
  c.log.length = 0; await sleep(3200);
  const alert = c.log.find((m) => m.type === "alert");
  assert.ok(alert, "alert broadcast when the timer ends");
  assert.match(alert.text, /complete/i);
  await say(c, "remind me in 10 minutes to stretch");
  const rem = c.log.filter((m) => m.type === "data").pop().data.reminders.find((r) => r.label === "stretch");
  assert.ok(rem);
  c.log.length = 0; c.ws.send(JSON.stringify({ type: "reminder_cancel", id: rem.id })); await sleep(250);
  assert.ok(!c.log.filter((m) => m.type === "data").pop().data.reminders.some((r) => r.id === rem.id));
  c.ws.close();
});

test("AI path: UTF-8 survives streaming, and the AI can delegate to a skill", async () => {
  const c = await connect(); await sleep(200);
  let l = await say(c, "hello", 900);
  assert.equal(l.filter((m) => m.type === "stream_chunk").map((m) => m.text).join(""), "Hello there, sir. Əla gün!");
  l = await say(c, "please delegate this", 1200);
  assert.ok(types(l).includes("stream_end"));
  assert.equal(l.find((m) => m.type === "card").card.title, "CALCULATOR", "AI emitted {action:'skill'} and the server ran it");
  c.ws.close();
});

test("busy lock: a second message while one is running is refused, not interleaved", async () => {
  const c = await connect(); await sleep(200);
  c.log.length = 0;
  c.ws.send(JSON.stringify({ type: "text_input", text: "slow please" }));
  c.ws.send(JSON.stringify({ type: "text_input", text: "and another" }));
  await sleep(1500);
  assert.ok(c.log.some((m) => m.type === "error" && /Still working/.test(m.message)));
  c.ws.close();
});

test("mode switch by voice command, and garbage input can't crash the server", async () => {
  const c = await connect(); await sleep(200);
  const l = await say(c, "switch to friday");
  assert.equal(l.find((m) => m.type === "personality_changed").personality, "FRIDAY");
  c.ws.send(JSON.stringify({ type: "text_input", text: 12345 }));
  c.ws.send("not json at all");
  c.ws.send(JSON.stringify({ type: "set_personality", personality: "__proto__" }));
  c.ws.send(JSON.stringify({ type: "task_toggle", id: "nope" }));
  await sleep(400);
  assert.equal((await fetch(`${base}/api/status`)).status, 200, "server still alive");
  c.ws.close();
});

test("memory is tied to the browser's client id (survives reconnects)", async () => {
  const cid = "test-client-" + Date.now();
  const a = await connect({ cid }); await sleep(200);
  await say(a, "hello", 700); a.ws.close(); await sleep(300);
  const b = await connect({ cid }); await sleep(250);
  assert.equal(b.log.find((m) => m.type === "init").sessionId, cid);
  assert.ok(fs.existsSync(path.join(process.env.JARVIS_DATA_DIR, `s_${cid}.json`)));
  b.ws.close();
});

test("REST: status, telemetry, commands, diagnostics, tts fallback", async () => {
  const s = await get("/api/status");
  assert.equal(s.ollama.running, true);
  assert.equal(s.tts.kokoro, "unavailable");
  const t = await get("/api/telemetry");
  assert.ok(t.cpu >= 0 && t.mem.total > 0 && t.cores > 0);
  assert.ok((await get("/api/commands")).length > 30);
  const d = await get("/api/diagnostics");
  assert.ok(d.find((x) => x.id === "server").status === "ok" && d.find((x) => x.id === "ollama").status === "ok");
  const tts = await fetch(`${base}/api/tts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
  assert.equal(tts.status, 501, "nothing available → the browser keeps its own voice");
});

test("the example plugin loads and answers", async () => {
  const c = await connect(); await sleep(200);
  const l = await say(c, "plugin test");
  assert.match(l.find((m) => m.type === "jarvis_response").text, /Plugin system online/);
  c.ws.close();
});
