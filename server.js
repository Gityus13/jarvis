require("dotenv").config();
const express  = require("express");
const http     = require("http");
const WS       = require("ws");
const path     = require("path");
const fs       = require("fs-extra");
const os       = require("os");
const { v4: uuid } = require("uuid");

const { streamOllama, checkOllama } = require("./src/ollama");
const { executeMacCommand }         = require("./src/mac-control");
const tts                           = require("./src/tts");
const kokoro                        = require("./src/kokoro");
const { routeCommand }              = require("./src/command-router");
const { loadPlugins }               = require("./src/plugin-loader");
const { logger }                    = require("./src/logger");
const { getMemory, saveMemory }     = require("./src/memory");
const { PERSONALITIES, getPersonality } = require("./src/personalities");

const PORT  = process.env.PORT || 3000;
const HOST  = process.env.HOST || "127.0.0.1";   // localhost only by default (this thing controls your Mac!)
const MODEL = process.env.OLLAMA_MODEL || "llama3.2";

// ─── Security: only accept requests that really come from this machine ────────
// Without this, ANY website you visit could open ws://localhost:3000 and drive your
// keyboard/mouse (WebSockets ignore CORS). Also blocks DNS-rebinding.
// Need LAN access?  HOST=0.0.0.0  and  ALLOWED_HOSTS=192.168.1.20  in .env
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const EXTRA_HOSTS = (process.env.ALLOWED_HOSTS || "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
function hostName(h) {
  h = String(h || "").toLowerCase();
  return h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.split(":")[0];
}
const hostOk   = h => { const n = hostName(h); return LOCAL_HOSTS.has(n) || EXTRA_HOSTS.includes(n); };
const originOk = o => { if (!o) return true; try { return hostOk(new URL(o).host); } catch { return false; } };

const app    = express();
const server = http.createServer(app);
const wss    = new WS.Server({
  server,
  maxPayload: 1024 * 1024,
  verifyClient: ({ req }) => hostOk(req.headers.host) && originOk(req.headers.origin),
});

fs.ensureDirSync(path.join(__dirname, "data"));
fs.ensureDirSync(path.join(__dirname, "logs"));

const plugins = loadPlugins(path.join(__dirname, "plugins"));

// Kokoro voice (optional) — loads in the background, safe if not installed
kokoro.load();

app.use((req, res, next) => {
  if (!hostOk(req.headers.host) || !originOk(req.headers.origin)) return res.status(403).send("Forbidden");
  next();
});
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "public")));

// One bad action must never take the whole server down
process.on("unhandledRejection", e => logger.error("Unhandled rejection: " + (e?.stack || e)));
process.on("uncaughtException",  e => logger.error("Uncaught exception: " + (e?.stack || e)));

// ─── Sessions ──────────────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    const mem = getMemory(id);
    sessions.set(id, {
      history: Array.isArray(mem.history) ? mem.history : [],
      personality: PERSONALITIES[mem.personality] ? mem.personality : "JARVIS",
      ws: null, busy: false,
    });
  }
  return sessions.get(id);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function safe(ws, data) {
  try { if (ws?.readyState === WS.OPEN) ws.send(JSON.stringify(data)); } catch {}
}

function stripJSON(text) {
  return text
    .replace(/\{[^{}]{0,400}\}/g, "")
    .replace(/\{[^}]*$/, "")                 // half-finished JSON at the end
    .replace(/```(?:json)?/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`[^`]*`/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function toDesktop(content, ext = "txt") {
  const safeExt = /^[a-z0-9]{1,8}$/i.test(String(ext)) ? String(ext).toLowerCase() : "txt"; // no "../" tricks
  const dir  = path.join(os.homedir(), "Desktop");
  await fs.ensureDir(dir);
  const name = `jarvis_${Date.now()}.${safeExt}`;
  const fp   = path.join(dir, name);
  await fs.writeFile(fp, content, "utf8");
  return { name, fp };
}

const LARGE_RE = [
  /\b(write|draft|compose|create|generate|make)\b.{0,30}\b(essay|report|story|article|script|paragraphs?|letter|poem|blog|speech|document)\b/i,
  /\bwrite\s+(?:me\s+)?(?:an?|a long)\b/i,
  /explain.{1,20}in detail/i,
];
const isLarge = t => LARGE_RE.some(r => r.test(t));

const ACKS = {
  JARVIS: ["Right away, sir.", "Certainly, sir.", "Done, sir."],
  FRIDAY: ["On it, boss.", "Done, boss.", "You got it."],
  ULTRON: ["Done.", "As you wish.", "Executed."],
};
const ack = p => { const a = ACKS[p] || ACKS.JARVIS; return a[Math.floor(Math.random() * a.length)]; };

const isInfo = a => /^get_/.test(a);   // actions whose RESULT is the answer (battery, wifi, time, clipboard, calendar)

function friendly(e) {
  const m = String(e?.message || e || "");
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(m)) return "I can't reach Ollama. Start it with: ollama serve";
  if (/401|unauthorized/i.test(m))                              return `Ollama says unauthorized for ${MODEL}. If it's a cloud model, run: ollama signin`;
  if (/Ollama 404|not found/i.test(m))                          return `The model ${MODEL} isn't installed. Run: ollama pull ${MODEL}`;
  return m.replace(/\s+/g, " ").slice(0, 160);
}

// ─── Handle one user message ───────────────────────────────────────────────────
async function handleText(ws, sess, sid, text) {
  safe(ws, { type: "user_message", text });
  logger.info(`[${sess.personality}] USER: ${text}`);
  const persist = () => saveMemory(sid, { history: sess.history, personality: sess.personality });

  // Plugins
  for (const plugin of plugins) {
    if (plugin.matches?.(text)) {
      try {
        const r = await plugin.execute(text, { ws, session: sess });
        if (r) safe(ws, { type: "jarvis_response", text: r });
      } catch (e) { logger.error("Plugin: " + e.message); }
      return;
    }
  }

  sess.history.push({ role: "user", content: text });
  if (sess.history.length > 40) sess.history.splice(0, 2);

  // Direct command routing — runs the action ONCE and answers without the AI
  // (it used to ALSO ask the AI, which ran the same action a second time)
  const direct = routeCommand(text);
  if (direct) {
    safe(ws, { type: "action_start", action: direct });
    let line;
    try {
      const r = await executeMacCommand(direct);
      safe(ws, { type: "action_done", action: direct, result: r || "Done" });
      line = isInfo(direct.action) && r ? String(r) : (r && /denied|install/i.test(String(r)) ? String(r) : ack(sess.personality));
    } catch (e) {
      safe(ws, { type: "action_error", error: e.message });
      line = `I couldn't do that. ${friendly(e)}`;
    }
    sess.history.push({ role: "assistant", content: line });
    persist();
    safe(ws, { type: "jarvis_response", text: line });
    return;
  }

  // Large writing job — skip the AI "planning" round-trip, just write the file
  if (isLarge(text)) {
    const line = ({ JARVIS: "Certainly, sir. I'll write that up and save it to your Desktop.",
                    FRIDAY: "On it, boss. I'll write it up and drop it on your Desktop.",
                    ULTRON: "Writing it now." })[sess.personality] || "Writing it now.";
    safe(ws, { type: "jarvis_response", text: line });
    sess.history.push({ role: "assistant", content: line });
    safe(ws, { type: "action_start", action: { action: "write_file" } });
    try {
      let fc = "";
      for await (const c of streamOllama(MODEL, "Write the full requested content. No preamble.", [{ role: "user", content: text }], { numPredict: 4096 })) fc += c;
      if (!fc.trim()) throw new Error("The model returned nothing");
      const { name } = await toDesktop(fc, "txt");
      safe(ws, { type: "action_done", action: { action: "write_file" }, result: `Saved to Desktop: ${name}` });
    } catch (e) {
      safe(ws, { type: "action_error", error: friendly(e) });
    }
    persist();
    return;
  }

  // AI
  try {
    safe(ws, { type: "thinking", state: true });
    const p = getPersonality(sess.personality);
    let full = "", action = null, jsonFound = false, firstChunk = true;

    safe(ws, { type: "stream_start" });

    for await (const chunk of streamOllama(MODEL, p.systemPrompt, sess.history)) {
      full += chunk;

      if (!jsonFound) {
        const m = full.match(/\{[^{}]{2,400}\}/);
        if (m) {
          try {
            const parsed = JSON.parse(m[0]);
            if (parsed.action) { action = parsed; jsonFound = true; }
          } catch {}
        }
      }

      if (firstChunk) { safe(ws, { type: "thinking", state: false }); firstChunk = false; }
      safe(ws, { type: "stream_chunk", text: chunk });
    }

    safe(ws, { type: "thinking", state: false });
    safe(ws, { type: "stream_end" });

    // Speak and store FIRST so the voice line comes before any action result
    const speech = stripJSON(full);
    if (speech) {
      sess.history.push({ role: "assistant", content: speech });
      logger.info(`[${sess.personality}] JARVIS: ${speech.slice(0, 100)}`);
    }
    persist();

    // Execute action if found
    if (action?.action === "write_file" && action.content_prompt) {
      safe(ws, { type: "action_start", action: { action: "write_file" } });
      try {
        let fc = "";
        for await (const c of streamOllama(MODEL, "Write the full requested content. No preamble.", [{ role: "user", content: String(action.content_prompt) }], { numPredict: 4096 })) fc += c;
        const { name } = await toDesktop(fc, action.filetype || "txt");
        safe(ws, { type: "action_done", action, result: `Saved to Desktop: ${name}` });
      } catch (e) { safe(ws, { type: "action_error", error: friendly(e) }); }
    } else if (action && action.action && action.action !== "none") {
      safe(ws, { type: "action_start", action });
      try {
        const r = await executeMacCommand(action);
        safe(ws, { type: "action_done", action, result: r || "Done" });
        // The AI can't see action results — so read the answer out for "what's my battery"-type actions
        if (isInfo(action.action) && r) safe(ws, { type: "jarvis_response", text: String(r) });
      } catch (e) {
        safe(ws, { type: "action_error", error: e.message });
        safe(ws, { type: "jarvis_response", text: `That didn't work. ${friendly(e)}` });
      }
    }
  } catch (err) {
    safe(ws, { type: "thinking", state: false });
    safe(ws, { type: "stream_end" });
    safe(ws, { type: "jarvis_response", text: friendly(err) });
    logger.error("AI error: " + err.message);
  }
}

// ─── WebSocket ─────────────────────────────────────────────────────────────────
wss.on("connection", (ws, req) => {
  // The browser keeps a stable client id so memory survives reconnects/reloads
  // (it used to get a brand-new random session every time, so memory never loaded).
  let cid = null;
  try { cid = new URL(req.url, "http://x").searchParams.get("cid"); } catch {}
  const sid  = /^[A-Za-z0-9_-]{8,64}$/.test(cid || "") ? cid : uuid();
  const sess = getSession(sid);
  sess.ws = ws;
  logger.info(`Connected: ${sid.slice(0, 8)}`);

  safe(ws, {
    type: "init", sessionId: sid,
    personality: sess.personality,
    personalities: Object.keys(PERSONALITIES),
    message: getPersonality(sess.personality).greeting,
  });

  ws.on("message", async raw => {
    try {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ping") { safe(ws, { type: "pong" }); return; }
      if (msg.type === "stop_speaking") return;   // audio plays in the browser now

      if (msg.type === "set_personality") {
        const key = msg.personality;
        if (!PERSONALITIES[key]) return;
        sess.personality = key;
        saveMemory(sid, { history: sess.history, personality: key });
        safe(ws, { type: "personality_changed", personality: key, greeting: getPersonality(key).switchMessage });
        return;
      }

      if (msg.type === "export_chat") {
        const fmt = msg.format === "json" ? "json" : "txt";
        const content = fmt === "json"
          ? JSON.stringify(sess.history, null, 2)
          : sess.history.map(m => `[${String(m.role).toUpperCase()}] ${m.content}`).join("\n\n");
        try { const { name } = await toDesktop(content, fmt); safe(ws, { type: "export_done", filename: name }); }
        catch (e) { safe(ws, { type: "error", message: "Export failed: " + e.message }); }
        return;
      }

      if (msg.type === "text_input" || msg.type === "voice_input") {
        const text = String(msg.text ?? "").trim().slice(0, 4000);
        if (!text) return;
        if (sess.busy) { safe(ws, { type: "error", message: "Still working on your last request…" }); return; }
        sess.busy = true;
        try { await handleText(ws, sess, sid, text); }
        finally { sess.busy = false; }
      }
    } catch (e) {
      logger.error("WS handler: " + (e?.stack || e));
      safe(ws, { type: "error", message: friendly(e) });
    }
  });

  ws.on("close", () => {
    saveMemory(sid, { history: sess.history, personality: sess.personality });
    if (sess.ws === ws) sessions.delete(sid);   // don't drop the session if another tab is still using it
    logger.info(`Disconnected: ${sid.slice(0, 8)}`);
  });
  ws.on("error", e => logger.error("WS: " + e.message));
});

// ─── REST API ──────────────────────────────────────────────────────────────────
app.get("/api/status", async (_, res) => {
  const ollama = await checkOllama(MODEL);
  res.json({
    ollama, model: MODEL,
    tts: {
      elevenlabs: tts.elAvailable(),
      kokoro: kokoro.status(),
      platform: process.platform,
      voices: tts.voiceNames(),
    },
    plugins: plugins.map(p => p.name),
    uptime: Math.round(process.uptime()),
  });
});

// Text → audio for the BROWSER to play.
//   Kokoro (if ready) → ElevenLabs (if key set) → 501/503 → browser uses its normal voice
app.post("/api/tts", async (req, res) => {
  const { text, personality = "JARVIS" } = req.body || {};
  if (!text || typeof text !== "string") return res.status(400).json({ error: "No text" });
  const who = PERSONALITIES[personality] ? personality : "JARVIS";

  if (kokoro.status() === "ready") {
    try {
      const wav = await kokoro.synth(text, who);
      return res.set("Content-Type", "audio/wav").send(wav);
    } catch (e) {
      logger.error("Kokoro: " + e.message);
      // fall through to ElevenLabs / browser voice
    }
  }

  if (tts.elAvailable()) {
    try {
      const mp3 = await tts.synthElevenLabs(text, who);
      return res.set("Content-Type", "audio/mpeg").send(mp3);
    } catch (e) { logger.error("ElevenLabs: " + e.message); return res.status(502).json({ error: e.message }); }
  }

  const st = kokoro.status();
  if (st === "loading" || st === "idle") return res.status(503).json({ state: st });   // still loading → normal voice this time
  return res.status(501).json({ state: st });                                          // nothing available → browser stops asking
});

app.post("/api/command", async (req, res) => {
  const { text, personality = "JARVIS" } = req.body || {};
  if (!text || typeof text !== "string") return res.status(400).json({ error: "No text" });
  try {
    const p = getPersonality(personality);
    let out = "";
    for await (const c of streamOllama(MODEL, p.systemPrompt, [{ role: "user", content: text }])) out += c;
    res.json({ response: out, personality });
  } catch (e) { res.status(500).json({ error: friendly(e) }); }
});

app.get("/api/personalities", (_, res) =>
  res.json(Object.entries(PERSONALITIES).map(([k, p]) => ({ id: k, name: p.name, description: p.description, color: p.color }))));

app.get("/api/plugins", (_, res) =>
  res.json(plugins.map(p => ({ name: p.name, description: p.description || "" }))));

app.get("/api/logs", (_, res) => {
  const f = path.join(__dirname, "logs/jarvis.log");
  if (!fs.existsSync(f)) return res.json({ logs: [] });
  try { res.json({ logs: fs.readFileSync(f, "utf8").split("\n").filter(Boolean).slice(-100) }); }
  catch { res.json({ logs: [] }); }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  logger.info(`JARVIS online — ${HOST}:${PORT}`);
console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
console.log(`  ║  J.A.R.V.I.S. v3  →  http://localhost:${PORT}       ║`);
console.log(`  ║  Model: ${MODEL.padEnd(42)}║`);
console.log(`  ║  Plugins: ${String(plugins.length).padEnd(40)}║`);
console.log(`  ╚══════════════════════════════════════════════════════╝\n`);
});
