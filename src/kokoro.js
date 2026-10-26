/**
 * kokoro.js — OPTIONAL local Kokoro TTS (via the kokoro-js npm package)
 *
 * Never throws at require-time and never needs to be installed:
 *   - kokoro-js missing / model download failed / KOKORO=off  → state "unavailable"
 *   - the browser then just keeps using its normal voice
 *
 * States: idle → loading → ready | unavailable
 *
 * .env (all optional):
 *   KOKORO=off                    disable Kokoro completely
 *   KOKORO_DTYPE=q8               q8 (default, ~90MB, fast) | fp32 (~300MB) | fp16 | q4
 *   KOKORO_VOICE_JARVIS=bm_george
 *   KOKORO_VOICE_FRIDAY=bf_emma
 *   KOKORO_VOICE_ULTRON=am_onyx
 */

const { logger } = require("./logger");

const MODEL = process.env.KOKORO_MODEL || "onnx-community/Kokoro-82M-v1.0-ONNX";
const DTYPE = process.env.KOKORO_DTYPE || "q8";

const DEFAULT_VOICES = { JARVIS: "bm_george", FRIDAY: "bf_emma", ULTRON: "am_onyx" };
const SPEEDS         = { JARVIS: 1.0,         FRIDAY: 1.05,      ULTRON: 0.9 };

let state    = "idle";           // idle | loading | ready | unavailable
let engine   = null;
let loading  = null;
let failures = 0;
let chain    = Promise.resolve(); // one generation at a time

const status = () => state;

// ── Load the model in the background (safe to call many times) ───────────────
function load() {
  if (loading) return loading;
  if (state === "ready" || state === "unavailable") return Promise.resolve();

  if (/^(off|false|0|no)$/i.test(process.env.KOKORO || "")) {
    state = "unavailable";
    logger.info("[Kokoro] disabled via KOKORO=off");
    return Promise.resolve();
  }

  state = "loading";
  loading = (async () => {
    try {
      const { KokoroTTS } = await import("kokoro-js"); // ESM → dynamic import works from CommonJS
      logger.info("[Kokoro] loading model (first run downloads ~90MB, then it's cached)...");
      engine = await KokoroTTS.from_pretrained(MODEL, { dtype: DTYPE, device: "cpu" });
      state = "ready";
      logger.info(`[Kokoro] ready (${DTYPE})`);
    } catch (e) {
      state = "unavailable";
      const missing = e.code === "ERR_MODULE_NOT_FOUND" || e.code === "MODULE_NOT_FOUND";
      logger.warn(
        missing
          ? "[Kokoro] kokoro-js not installed → using normal voice (run: npm i kokoro-js)"
          : `[Kokoro] couldn't start: ${e.message} → using normal voice`
      );
    } finally {
      loading = null;
    }
  })();
  return loading;
}

function voiceFor(personality) {
  const p   = DEFAULT_VOICES[personality] ? personality : "JARVIS";
  const env = process.env[`KOKORO_VOICE_${p}`];
  return env && engine?.voices?.[env] ? env : DEFAULT_VOICES[p];
}

// ── Text → WAV buffer ────────────────────────────────────────────────────────
function synth(text, personality = "JARVIS") {
  const run = async () => {
    if (state !== "ready") throw new Error("Kokoro not ready");
    const audio = await engine.generate(String(text).slice(0, 400), {
      voice: voiceFor(personality),
      speed: SPEEDS[personality] || 1.0,
    });
    failures = 0;
    return Buffer.from(audio.toWav());
  };

  const job = chain.then(run).catch((e) => {
    // 3 failures in a row → stop trying, everyone falls back to the normal voice
    if (++failures >= 3 && state === "ready") {
      state = "unavailable";
      logger.warn(`[Kokoro] failing repeatedly (${e.message}) → using normal voice`);
    }
    throw e;
  });
  chain = job.catch(() => {});
  return job;
}

module.exports = { load, synth, status };
