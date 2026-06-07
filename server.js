require("dotenv").config();
const express  = require("express");
const http     = require("http");
const WS       = require("ws");
const path     = require("path");
const cors     = require("cors");
const fs       = require("fs-extra");
const os       = require("os");
const { v4: uuid } = require("uuid");

const { streamOllama, checkOllama } = require("./src/ollama");
const { executeMacCommand }         = require("./src/mac-control");
const { speak, stopSpeaking }       = require("./src/tts");
const { routeCommand }              = require("./src/command-router");
const { loadPlugins }               = require("./src/plugin-loader");
const { logger }                    = require("./src/logger");
const { getMemory, saveMemory }     = require("./src/memory");
const { PERSONALITIES, getPersonality } = require("./src/personalities");

const app    = express();
const server = http.createServer(app);
const wss    = new WS.Server({ server });

const PORT  = process.env.PORT || 3000;
const MODEL = process.env.OLLAMA_MODEL || "llama3.2";

fs.ensureDirSync(path.join(__dirname, "data"));
fs.ensureDirSync(path.join(__dirname, "logs"));

const plugins = loadPlugins(path.join(__dirname, "plugins"));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── Sessions ──────────────────────────────────────────────────────────────────
const sessions = new Map();

function getSession(id) {
  if (!sessions.has(id)) {
    const mem = getMemory(id);
    sessions.set(id, { history: mem.history || [], personality: mem.personality || "JARVIS", ws: null });
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
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`[^`]*`/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function toDesktop(content, ext = "txt") {
  const name = `jarvis_${Date.now()}.${ext}`;
  const fp   = path.join(os.homedir(), "Desktop", name);
  await fs.writeFile(fp, content, "utf8");
  return { name, fp };
}

const LARGE_RE = [
  /write\s+(an?|a long|me a)\b/i, /\bessay\b/i, /\breport\b/i, /\bstory\b/i,
  /\barticle\b/i, /\bscript for\b/i, /explain.{1,20}in detail/i, /write.{1,20}paragraph/i,
];
const isLarge = t => LARGE_RE.some(r => r.test(t));

// ─── WebSocket ─────────────────────────────────────────────────────────────────
wss.on("connection", ws => {
  const sid = uuid();
  const sess = getSession(sid);
  sess.ws = ws;
  logger.info(`Connected: ${sid}`);

  safe(ws, {
    type: "init", sessionId: sid,
    personality: sess.personality,
    personalities: Object.keys(PERSONALITIES),
    message: getPersonality(sess.personality).greeting,
  });

  ws.on("message", async raw => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "ping") { safe(ws, { type: "pong" }); return; }

    if (msg.type === "stop_speaking") { stopSpeaking(); return; }

    if (msg.type === "set_personality") {
      const key = msg.personality;
      if (!PERSONALITIES[key]) return;
      sess.personality = key;
      saveMemory(sid, { history: sess.history, personality: key });
      const p = getPersonality(key);
      safe(ws, { type: "personality_changed", personality: key, greeting: p.switchMessage });
      speak(p.switchMessage, key).catch(() => {});
      return;
    }

    if (msg.type === "export_chat") {
      const fmt = msg.format || "txt";
      const content = fmt === "json"
        ? JSON.stringify(sess.history, null, 2)
        : sess.history.map(m => `[${m.role.toUpperCase()}] ${m.content}`).join("\n\n");
      try { const { name } = await toDesktop(content, fmt); safe(ws, { type: "export_done", filename: name }); }
      catch (e) { safe(ws, { type: "error", message: "Export failed: " + e.message }); }
      return;
    }

    if (msg.type === "text_input" || msg.type === "voice_input") {
      const text = (msg.text || "").trim();
      if (!text) return;

      safe(ws, { type: "user_message", text });
      logger.info(`[${sess.personality}] USER: ${text}`);

      // Plugins
      for (const plugin of plugins) {
        if (plugin.matches?.(text)) {
          try {
            const r = await plugin.execute(text, { ws, session: sess });
            if (r) { safe(ws, { type: "jarvis_response", text: r }); speak(r, sess.personality).catch(() => {}); }
          } catch (e) { logger.error("Plugin: " + e.message); }
          return;
        }
      }

      // Direct command routing (no AI needed)
      const direct = routeCommand(text);
      if (direct) {
        safe(ws, { type: "action_start", action: direct });
        try {
          const r = await executeMacCommand(direct);
          safe(ws, { type: "action_done", action: direct, result: r || "Done" });
        } catch (e) { safe(ws, { type: "action_error", error: e.message }); }
      }

      // Build history
      sess.history.push({ role: "user", content: text });
      if (sess.history.length > 40) sess.history.splice(0, 2);

      // AI
      try {
        safe(ws, { type: "thinking", state: true });

        const p = getPersonality(sess.personality);
        const history = isLarge(text)
          ? [...sess.history.slice(0, -1), {
              role: "user",
              content: text + `\n\n[SYSTEM: Large request. Reply with ONLY: {"action":"write_file","content_prompt":"${text.replace(/"/g, '\\"').replace(/\n/g, " ")}","filetype":"txt"} then ONE short spoken line. No full content in chat.]`
            }]
          : sess.history;

        let full = "", action = null, jsonFound = false, firstChunk = true;

        safe(ws, { type: "stream_start" });

        for await (const chunk of streamOllama(MODEL, p.systemPrompt, history)) {
          full += chunk;

          // Extract JSON action once buffer has enough text
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

        safe(ws, { type: "stream_end" });

        // Execute action if found
        if (action?.action === "write_file" && action.content_prompt) {
          safe(ws, { type: "action_start", action: { action: "write_file" } });
          try {
            let fc = "";
            for await (const c of streamOllama(MODEL, "Write the full requested content. No preamble.", [{ role: "user", content: action.content_prompt }])) fc += c;
            const { name } = await toDesktop(fc, action.filetype || "txt");
            safe(ws, { type: "action_done", action, result: `Saved to Desktop: ${name}` });
          } catch (e) { safe(ws, { type: "action_error", error: e.message }); }
        } else if (action && action.action && action.action !== "none") {
          safe(ws, { type: "action_start", action });
          try {
            const r = await executeMacCommand(action);
            safe(ws, { type: "action_done", action, result: r || "Done" });
          } catch (e) { safe(ws, { type: "action_error", error: e.message }); }
        }

        // Speak and store
        const speech = stripJSON(full);
        if (speech) {
          sess.history.push({ role: "assistant", content: speech });
          saveMemory(sid, { history: sess.history, personality: sess.personality });
          logger.info(`[${sess.personality}] JARVIS: ${speech.slice(0, 100)}`);
          speak(speech, sess.personality).catch(() => {});
        }

      } catch (err) {
        safe(ws, { type: "thinking", state: false });
        safe(ws, { type: "stream_end" });
        const errMsg = `System error: ${err.message}`;
        safe(ws, { type: "jarvis_response", text: errMsg });
        logger.error("AI error: " + err.message);
      }
    }
  });

  ws.on("close", () => {
    saveMemory(sid, { history: sess.history, personality: sess.personality });
    sessions.delete(sid);
    logger.info(`Disconnected: ${sid}`);
  });
  ws.on("error", e => logger.error("WS: " + e.message));
});

// ─── REST API ──────────────────────────────────────────────────────────────────
app.get("/api/status", async (_, res) => {
  const ollama = await checkOllama(MODEL);
  res.json({
    status: "online", model: MODEL,
    uptime: Math.floor(process.uptime()),
    sessions: sessions.size,
    plugins: plugins.map(p => p.name),
    ollama,
    personalities: Object.keys(PERSONALITIES),
    tts: { elevenlabs: !!process.env.ELEVENLABS_API_KEY, platform: process.platform },
  });
});

app.post("/api/command", async (req, res) => {
  const { text, personality = "JARVIS" } = req.body;
  if (!text) return res.status(400).json({ error: "No text" });
  try {
    const p = getPersonality(personality);
    let out = "";
    for await (const c of streamOllama(MODEL, p.systemPrompt, [{ role: "user", content: text }])) out += c;
    res.json({ response: out, personality });
  } catch (e) { res.status(500).json({ error: e.message }); }
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
server.listen(PORT, () => {
  logger.info(`JARVIS online — port ${PORT}`);
console.log(`\n  ╔══════════════════════════════════════════════════════╗`);
console.log(`  ║  J.A.R.V.I.S. v3  →  http://localhost:${PORT}       ║`);
console.log(`  ║  Model: ${MODEL.padEnd(42)}║`);
console.log(`  ║  Plugins: ${String(plugins.length).padEnd(40)}║`);
console.log(`  ╚══════════════════════════════════════════════════════╝\n`);
});
