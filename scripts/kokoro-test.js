#!/usr/bin/env node
/**
 * npm run kokoro-test
 * Loads the Kokoro voice exactly like the server does, speaks a test line, saves it as a WAV
 * and plays it. If anything is wrong it prints the real error and how to fix it.
 */
require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const kokoro = require("../src/kokoro");

const line = (s = "") => process.stdout.write(s + "\n");

(async () => {
  line(`\nKokoro voice test — Node ${process.version} · ${process.platform}/${process.arch}`);
  if (parseInt(process.versions.node, 10) >= 24) line("  note: Node 24+ is very new. If the ONNX runtime fails to load, switch to Node 22 LTS.");
  line("  loading (first run downloads ~90 MB into data/models)…\n");

  const t0 = Date.now();
  const tick = setInterval(() => {
    const i = kokoro.info();
    process.stdout.write(`\r  ${i.state.padEnd(10)} ${i.pct != null ? i.pct + "%" : ""} ${i.totalMB ? `(${i.loadedMB}/${i.totalMB} MB)` : ""}      `);
  }, 400);
  await kokoro.load();
  clearInterval(tick);

  const info = kokoro.info();
  if (info.state !== "ready") {
    line(`\n\n✗ Kokoro is NOT working: ${info.error}`);
    if (info.hint) line(`  Fix: ${info.hint}`);
    line("\n  JARVIS keeps working with your system voice. Details are also in logs/jarvis.log\n");
    process.exit(1);
  }
  line(`\n\n✓ model loaded and running (${((Date.now() - t0) / 1000).toFixed(1)} s, first line ${info.warmMs} ms)\n`);

  for (const who of ["JARVIS", "FRIDAY", "ULTRON"]) {
    const text = { JARVIS: "Good evening. All systems nominal.", FRIDAY: "On it, boss. Ready when you are.", ULTRON: "State your directive." }[who];
    const t = Date.now();
    const wav = await kokoro.synth(text, who);
    const secs = (wav.length - 44) / (24000 * 2), took = (Date.now() - t) / 1000;
    const file = path.join(os.tmpdir(), `jarvis-kokoro-${who.toLowerCase()}.wav`);
    fs.writeFileSync(file, wav);
    line(`  ${who.padEnd(7)} ${secs.toFixed(1)} s of audio in ${took.toFixed(1)} s  (${(secs / took).toFixed(1)}× real time)  → ${file}`);
    if (who === "JARVIS") {
      const player = process.platform === "darwin" ? ["afplay", [file]] : process.platform === "linux" ? ["aplay", ["-q", file]] : null;
      if (player) await new Promise((r) => execFile(player[0], player[1], () => r()));
    }
  }
  line("\n✓ Kokoro works. Start JARVIS with: npm start\n");
  process.exit(0);
})().catch((e) => { line(`\n✗ ${e.stack || e}`); process.exit(1); });
