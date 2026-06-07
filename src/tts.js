/**
 * tts.js — Text-to-Speech
 *
 * Priority: ElevenLabs (if ELEVENLABS_API_KEY set) → macOS say / OS fallback
 *
 * KEY FIXES vs original:
 * 1. EL_KEY read lazily (not at module load) — survives dotenv timing
 * 2. Header: x-api-key (not xi-api-key — changed mid-2024)
 * 3. Model: eleven_turbo_v2_5 (eleven_monolingual_v1 is retired)
 * 4. node-fetch: uses arrayBuffer() not .buffer() — works with v2 AND v3
 * 5. Proper error logging so you can see exactly what EL returns
 */

const { exec }  = require("child_process");
const fs        = require("fs-extra");
const path      = require("path");
const os        = require("os");

const RATE = process.env.JARVIS_VOICE_RATE || "175";

// Voice IDs — override in .env if you want different voices
const EL_VOICES = {
  JARVIS: process.env.ELEVENLABS_VOICE_JARVIS || "onwK4e9ZLuTAKqWW03F9",
  FRIDAY: process.env.ELEVENLABS_VOICE_FRIDAY || "21m00Tcm4TlvDq8ikWAM",
  ULTRON: process.env.ELEVENLABS_VOICE_ULTRON || "AZnzlk1XvdvUeBnXmlld",
};

const MAC_VOICES = {
  JARVIS: process.env.JARVIS_VOICE || "Daniel",
  FRIDAY: process.env.FRIDAY_VOICE || "Moira",
  ULTRON: process.env.ULTRON_VOICE || "Alex",
};

let proc = null;

// ── Strip markdown / JSON / special chars before speaking ────────────────────
function clean(text) {
  return (text || "")
    .replace(/\{[^{}]{0,400}\}/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`[^`]*`/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/https?:\/\/\S+/g, "link")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[<>]/g, "")
    .replace(/\n+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/[^\x00-\x7E]/g, " ")
    .trim()
    .substring(0, 600);
}

// ── Main entry ────────────────────────────────────────────────────────────────
async function speak(text, personality = "JARVIS") {
  if (!text) return;
  stopSpeaking();
  const t = clean(text);
  if (!t) return;

  // Read key lazily so dotenv timing never matters
  const key = process.env.ELEVENLABS_API_KEY;

  if (key && key.trim()) {
    try {
      await speakEL(t, personality, key.trim());
      return; // success — don't fall through
    } catch (e) {
      console.error("[TTS] ElevenLabs failed:", e.message, "→ falling back to OS TTS");
    }
  }

  // OS fallback
  try {
    await speakOS(t, personality);
  } catch (e) {
    console.error("[TTS] OS TTS also failed:", e.message);
  }
}

// ── ElevenLabs TTS ────────────────────────────────────────────────────────────
async function speakEL(text, personality, key) {
  // Require node-fetch inside the function — avoids issues if module not yet loaded
  const fetch = require("node-fetch");
  const voiceId = EL_VOICES[personality] || EL_VOICES.JARVIS;

  const voiceSettings = {
    JARVIS: { stability: 0.55, similarity_boost: 0.80, style: 0.20, use_speaker_boost: true },
    FRIDAY: { stability: 0.60, similarity_boost: 0.75, style: 0.30, use_speaker_boost: true },
    ULTRON: { stability: 0.38, similarity_boost: 0.88, style: 0.78, use_speaker_boost: true },
  };

  console.log(`[TTS] ElevenLabs → voice=${voiceId} personality=${personality} text="${text.slice(0, 60)}..."`);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method:  "POST",
    headers: {
      "Accept":        "audio/mpeg",
      "Content-Type":  "application/json",
      "x-api-key":     key,          // ← correct header (xi-api-key was retired 2024)
    },
    body: JSON.stringify({
      text,
      model_id:       "eleven_turbo_v2_5",   // ← eleven_monolingual_v1 is retired
      voice_settings: voiceSettings[personality] || voiceSettings.JARVIS,
    }),
  });

  if (!res.ok) {
    // Always read the body — EL returns useful JSON error messages
    let errBody = "";
    try { errBody = await res.text(); } catch {}
    throw new Error(`HTTP ${res.status} — ${errBody.slice(0, 300)}`);
  }

  // FIX: use arrayBuffer() — works with node-fetch v2 AND v3
  // (.buffer() only exists on v2 and silently fails or errors on v3)
  let audioData;
  try {
    audioData = Buffer.from(await res.arrayBuffer());
  } catch {
    // v2 fallback if arrayBuffer not available
    audioData = await res.buffer();
  }

  if (!audioData || audioData.length < 512) {
    throw new Error(`Empty audio returned (${audioData?.length ?? 0} bytes) — check voice ID and API key`);
  }

  console.log(`[TTS] ElevenLabs returned ${audioData.length} bytes of audio`);

  const tmp = path.join(os.tmpdir(), `jarvis_el_${Date.now()}.mp3`);
  await fs.writeFile(tmp, audioData);

  return new Promise((resolve, reject) => {
    const player = process.platform === "darwin" ? "afplay" : "mpg123 -q";
    proc = exec(`${player} "${tmp}"`, (err) => {
      proc = null;
      fs.remove(tmp).catch(() => {});
      if (err && err.signal !== "SIGTERM") {
        reject(new Error(`Audio playback failed: ${err.message}`));
      } else {
        resolve();
      }
    });
    proc.on("error", (e) => {
      proc = null;
      fs.remove(tmp).catch(() => {});
      reject(e);
    });
  });
}

// ── OS TTS (macOS say / Windows SAPI / Linux espeak) ─────────────────────────
async function speakOS(text, personality) {
  const esc = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g,  '\\"')
    .replace(/'/g,  "\\'")
    .replace(/[`$]/g, "");

  if (process.platform === "darwin") {
    const v = MAC_VOICES[personality] || MAC_VOICES.JARVIS;
    return new Promise((resolve) => {
      proc = exec(`say -v "${v}" -r ${RATE} "${esc}"`, (err) => {
        proc = null;
        if (err && err.signal !== "SIGTERM") {
          exec(`say -r ${RATE} "${esc}"`, () => resolve()); // voice not found — try default
        } else {
          resolve();
        }
      });
    });
  }

  if (process.platform === "win32") {
    const ps = text.replace(/'/g, "''");
    return new Promise((resolve) => {
      proc = exec(
        `powershell -Command "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate=2; $s.Speak('${ps}')"`,
        () => { proc = null; resolve(); }
      );
    });
  }

  // Linux
  return new Promise((resolve) => {
    proc = exec(`espeak "${esc}" --speed=${RATE} 2>/dev/null || true`, () => {
      proc = null;
      resolve();
    });
  });
}

// ── Stop speaking immediately ─────────────────────────────────────────────────
function stopSpeaking() {
  if (proc) {
    try { proc.kill("SIGTERM"); } catch {}
    proc = null;
  }
  if (process.platform === "darwin") {
    exec("pkill -f 'say ' 2>/dev/null; pkill -f afplay 2>/dev/null; true").catch(() => {});
  }
}

module.exports = { speak, stopSpeaking };
