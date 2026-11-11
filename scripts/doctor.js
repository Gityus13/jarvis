#!/usr/bin/env node
/**
 * npm run doctor
 * The same self-checks as the SYSTEMS panel, in the terminal. Paste the output into a GitHub issue.
 */
require("dotenv").config();
const os = require("os");
const kokoro = require("../src/kokoro");
const diagnostics = require("../src/diagnostics");

const c = { ok: "\x1b[32m", warn: "\x1b[33m", fail: "\x1b[31m", dim: "\x1b[90m", off: "\x1b[0m" };
const tag = { ok: "[ OK ]", warn: "[WARN]", fail: "[FAIL]" };

(async () => {
  const model = process.env.OLLAMA_MODEL || "llama3.2";
  console.log(`\nJARVIS doctor — Node ${process.version} · ${os.type()} ${os.release()} ${process.arch}\n`);
  await Promise.race([kokoro.load(), new Promise((r) => setTimeout(r, 6000))]);   // give the optional voice a moment
  const list = await diagnostics.runAll(model);
  for (const d of list) {
    console.log(`${c[d.status]}${tag[d.status]}${c.off} ${d.label}${d.detail ? `${c.dim}  ${d.detail}${c.off}` : ""}`);
    if (d.fix) console.log(`       ${c.warn}fix:${c.off} ${d.fix}`);
  }
  const bad = list.filter((d) => d.status === "fail").length, warn = list.filter((d) => d.status === "warn").length;
  console.log(`\n${bad ? c.fail : c.ok}${list.length - bad - warn} ok · ${warn} warnings · ${bad} failures${c.off}\n`);
  process.exit(bad ? 1 : 0);
})();
