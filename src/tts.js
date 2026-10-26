/**
 * tts.js — ElevenLabs synthesis (optional)
 *
 * The BROWSER does all the playing (see POST /api/tts in server.js):
 *   Kokoro (if ready) → ElevenLabs (if ELEVENLABS_API_KEY set) → browser/system voice.
 * The server no longer plays audio itself — that used to cause two voices at once, and the
 * old server-side playback crashed on macOS (so ElevenLabs never actually worked there).
 */

const fetch = require("node-fetch");
const { logger } = require("./logger");

// Voice IDs — override in .env if you want different voices
const EL_VOICES = () => ({
  JARVIS: process.env.ELEVENLABS_VOICE_JARVIS || "onwK4e9ZLuTAKqWW03F9",
  FRIDAY: process.env.ELEVENLABS_VOICE_FRIDAY || "21m00Tcm4TlvDq8ikWAM",
  ULTRON: process.env.ELEVENLABS_VOICE_ULTRON || "AZnzlk1XvdvUeBnXmlld",
});

// Preferred BROWSER/system voice names (matched against speechSynthesis voices)
const voiceNames = () => ({
  JARVIS: process.env.JARVIS_VOICE || "Daniel",
  FRIDAY: process.env.FRIDAY_VOICE || "Moira",
  ULTRON: process.env.ULTRON_VOICE || "Alex",
});

let elDisabled = false; // set when the key is rejected, so we stop hammering the API

const elAvailable = () => !!process.env.ELEVENLABS_API_KEY && !elDisabled;

async function synthElevenLabs(text, personality = "JARVIS") {
  if (!elAvailable()) throw new Error("ElevenLabs not configured");
  const voiceId = EL_VOICES()[personality] || EL_VOICES().JARVIS;

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    timeout: 20000,
    headers: {
      "x-api-key": process.env.ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: String(text).slice(0, 600),
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  });

  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      elDisabled = true;
      logger.warn(`[ElevenLabs] key rejected (${res.status}) → using normal voice. ${body}`);
    }
    throw new Error(`ElevenLabs ${res.status}: ${body}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { elAvailable, synthElevenLabs, voiceNames };
