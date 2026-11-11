/**
 * kokoro.js — OPTIONAL local neural voice (Kokoro-82M via the kokoro-js package)
 *
 * Never throws at require-time and never needs to be installed. Every failure ends in
 * state "unavailable" WITH a human-readable reason + fix, and the console falls back to the
 * normal system voice. States:  idle → loading → ready | unavailable
 *
 * .env (all optional):
 *   KOKORO=off                 disable completely
 *   KOKORO_DTYPE=q8            q8 (default, ~90 MB) | fp32 (~300 MB) | fp16 | q4
 *   KOKORO_VOICE_JARVIS=bm_george   KOKORO_VOICE_FRIDAY=bf_emma   KOKORO_VOICE_ULTRON=am_onyx
 *   HF_ENDPOINT=https://hf-mirror.com   download the model from a mirror if huggingface.co is blocked
 *   KOKORO_STALL_MS=120000     give up if the download makes no progress for this long
 */

const path = require("path");
const fs   = require("fs-extra");
const { logger } = require("./logger");

const MODEL     = process.env.KOKORO_MODEL || "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE     = process.env.KOKORO_DTYPE || "q8";
const CACHE_DIR = path.join(require("./paths").DATA, "models");     // visible + writable (node_modules may not be)
const STALL_MS  = Number(process.env.KOKORO_STALL_MS) || 120000;
const SYNTH_MS  = Number(process.env.KOKORO_SYNTH_MS) || 20000;
const MAX_RETRIES = 3;

const DEFAULT_VOICES = { JARVIS: "bm_george", FRIDAY: "bf_emma", ULTRON: "am_onyx" };
const SPEEDS         = { JARVIS: 1.0,         FRIDAY: 1.05,      ULTRON: 0.9 };

const info = { state: "idle", error: null, hint: null, pct: null, loadedMB: null, totalMB: null, warmMs: null, retries: 0 };
let engine = null, loading = null, failures = 0, chain = Promise.resolve();

// Short lines repeat constantly (wake acknowledgements, "Done, sir.") — remember them so they play instantly.
const CACHE_MAX = 80, CACHE_TEXT_MAX = 140;
const cache = new Map();            // insertion-ordered → simple LRU
let inflight = 0;                   // real requests waiting/running (background warm-up yields to these)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let importer = (name) => import(name);            // overridable in tests

const status   = () => info.state;
const snapshot = () => ({ ...info });

const withTimeout = (p, ms, msg) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(msg)), ms);          // cleared as soon as p settles
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

function hintFor(e, missing) {
  const m = String((e && e.message) || e);
  if (missing) return "Run: npm i kokoro-js   then restart";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|stalled|network|certificate|socket|403|429|50\d/i.test(m))
    return "Can't download the voice model from huggingface.co. Check internet/VPN, or put HF_ENDPOINT=https://hf-mirror.com in .env and restart. (It retries automatically.)";
  if (/onnxruntime|dlopen|\.node\b|napi|Cannot find module|ERR_DLOPEN|Illegal instruction/i.test(m))
    return `The ONNX runtime failed to load on Node ${process.version}. Use Node 22 LTS (brew install node@22), then: rm -rf node_modules && npm install`;
  if (/warm-up|inference|tensor|Non-zero status|input/i.test(m))
    return "The model downloaded but couldn't run. Run: npm run kokoro-test   and read the error it prints.";
  return "Run: npm run kokoro-test   for the full error.";
}

// ── Load the model in the background (safe to call many times) ───────────────
function load() {
  if (loading) return loading;
  if (info.state === "ready" || info.state === "unavailable") return Promise.resolve();

  if (/^(off|false|0|no)$/i.test(process.env.KOKORO || "")) {
    info.state = "unavailable"; info.error = "disabled in .env (KOKORO=off)"; info.hint = null;
    logger.info("[Kokoro] disabled via KOKORO=off");
    return Promise.resolve();
  }

  info.state = "loading"; info.error = null; info.hint = null; info.pct = null;
  let stallTimer = null;

  loading = (async () => {
    try {
      // keep the model inside the project, and allow a mirror when huggingface.co is blocked
      try {
        const tf = await importer("@huggingface/transformers");
        if (tf.env) {
          fs.ensureDirSync(CACHE_DIR);
          tf.env.cacheDir = CACHE_DIR;
          if (process.env.HF_ENDPOINT) tf.env.remoteHost = process.env.HF_ENDPOINT.replace(/\/*$/, "/");
        }
      } catch {}

      const { KokoroTTS } = await importer("kokoro-js");
      logger.info(`[Kokoro] loading model (${DTYPE}) — first run downloads ~90 MB into data/models, then it's cached`);

      const files = {};
      let lastLogged = -10, lastProgress = Date.now();
      const onProgress = (p) => {
        lastProgress = Date.now();
        if (p && p.status === "progress" && p.file && p.total) {
          files[p.file] = { loaded: p.loaded, total: p.total };
          const vals = Object.values(files);
          const L = vals.reduce((a, b) => a + b.loaded, 0), T = vals.reduce((a, b) => a + b.total, 0);
          info.pct = Math.min(99, Math.round((100 * L) / T));
          info.loadedMB = Math.round(L / 1048576); info.totalMB = Math.round(T / 1048576);
          if (info.pct >= lastLogged + 10) { lastLogged = info.pct; logger.info(`[Kokoro] downloading model ${info.pct}% (${info.loadedMB}/${info.totalMB} MB)`); }
        }
      };
      const stalled = new Promise((_, rej) => {
        stallTimer = setInterval(() => {
          if (Date.now() - lastProgress > STALL_MS) rej(new Error(`model download stalled for ${Math.round(STALL_MS / 1000)}s`));
        }, 1000);
      });

      engine = await Promise.race([KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: "cpu", progress_callback: onProgress }), stalled]);
      clearInterval(stallTimer);

      // Prove it can actually SPEAK before calling it ready (this also warms the runtime so the first real line is fast)
      const t0 = Date.now();
      await withTimeout(engine.generate("Systems online.", { voice: DEFAULT_VOICES.JARVIS, speed: 1 }), 90000, "warm-up inference timed out");
      info.warmMs = Date.now() - t0;
      info.pct = 100; info.state = "ready"; info.retries = 0;
      logger.info(`[Kokoro] ready — first line generated in ${info.warmMs} ms`);
    } catch (e) {
      clearInterval(stallTimer);
      engine = null;
      const missing = !!e && (e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND") && /kokoro-js/.test(String(e.message));
      info.state = "unavailable";
      info.error = missing ? "kokoro-js is not installed" : String((e && e.message) || e).replace(/\s+/g, " ").slice(0, 300);
      info.hint = hintFor(e, missing);
      logger.warn(`[Kokoro] ${info.error} → using system voice. ${info.hint}`);
      if (!missing && /stalled|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|network/i.test(info.error) && info.retries < MAX_RETRIES) {
        info.retries++;
        const delay = Number(process.env.KOKORO_RETRY_MS) || 3 * 60 * 1000;
        const t = setTimeout(() => { info.state = "idle"; load(); }, delay);
        t.unref && t.unref();
        logger.info(`[Kokoro] will retry in ${Math.round(delay / 1000)}s (${info.retries}/${MAX_RETRIES})`);
      }
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function voiceFor(personality) {
  const p   = DEFAULT_VOICES[personality] ? personality : "JARVIS";
  const env = process.env[`KOKORO_VOICE_${p}`];
  return env && engine && engine.voices && engine.voices[env] ? env : DEFAULT_VOICES[p];
}

// ── Text → WAV buffer (one at a time; every job has a hard timeout) ──────────
function synth(text, personality = "JARVIS", { background = false } = {}) {
  const t = String(text).slice(0, 400);
  const cacheable = t.length <= CACHE_TEXT_MAX;
  const key = engine && cacheable ? `${voiceFor(personality)}|${SPEEDS[personality] || 1}|${t}` : null;
  if (key && cache.has(key)) { const hit = cache.get(key); cache.delete(key); cache.set(key, hit); return Promise.resolve(hit); }

  const run = async () => {
    if (info.state !== "ready") throw new Error("Kokoro not ready");
    const audio = await withTimeout(
      engine.generate(t, { voice: voiceFor(personality), speed: SPEEDS[personality] || 1.0 }),
      SYNTH_MS, "speech generation timed out"
    );
    failures = 0;
    const buf = Buffer.from(audio.toWav());
    if (key) { cache.set(key, buf); if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value); }
    return buf;
  };

  if (!background) inflight++;
  const job = chain.then(run).finally(() => { if (!background) inflight--; }).catch((e) => {
    // 3 failures in a row → stop trying; everyone falls back to the system voice
    if (++failures >= 3 && info.state === "ready") {
      info.state = "unavailable"; info.error = `speech generation keeps failing: ${e.message}`; info.hint = hintFor(e, false);
      logger.warn(`[Kokoro] ${info.error} → using system voice`);
    }
    throw e;
  });
  chain = job.catch(() => {});
  return job;
}

/** Generate the lines you hear most so they are instant later. Never delays a real request. Resolves with how many were prepared. */
async function prewarm(lines) {
  let n = 0;
  for (const l of lines) {
    while (inflight > 0) await sleep(200);
    if (info.state !== "ready") return n;
    try { await synth(l.text, l.personality, { background: true }); n++; } catch { return n; }
    await sleep(40);
  }
  return n;
}

function _reset(fn) {                              // test helper
  importer = fn || ((name) => import(name));
  engine = null; loading = null; failures = 0; chain = Promise.resolve(); cache.clear(); inflight = 0;
  Object.assign(info, { state: "idle", error: null, hint: null, pct: null, loadedMB: null, totalMB: null, warmMs: null, retries: 0 });
}

module.exports = { load, synth, prewarm, status, info: snapshot, _reset, _cacheSize: () => cache.size };
