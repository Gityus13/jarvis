const path = require("path");
const fs   = require("fs-extra");

const DATA_DIR   = path.join(__dirname, "../data");
const GLOBAL_MEM = path.join(DATA_DIR, "memory.json");
const MAX_MSGS   = 100;
const safeId     = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "x";

fs.ensureDirSync(DATA_DIR);

// Old random-session files used to pile up forever — drop anything untouched for 30 days
try {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (!/^s_.+\.json$/.test(f)) continue;
    const fp = path.join(DATA_DIR, f);
    if (fs.statSync(fp).mtimeMs < cutoff) fs.removeSync(fp);
  }
} catch {}

function getMemory(id = "global") {
  const f = id === "global" ? GLOBAL_MEM : path.join(DATA_DIR, `s_${safeId(id)}.json`);
  try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  return { history: [], personality: "JARVIS" };
}

function saveMemory(id = "global", data) {
  const f = id === "global" ? GLOBAL_MEM : path.join(DATA_DIR, `s_${safeId(id)}.json`);
  try {
    if (data.history?.length > MAX_MSGS) data.history = data.history.slice(-MAX_MSGS);
    data.lastSaved = new Date().toISOString();
    fs.writeFileSync(f, JSON.stringify(data, null, 2));
  } catch (e) { console.error("[Memory] Save failed:", e.message); }
}

function clearMemory(id = "global") {
  const f = id === "global" ? GLOBAL_MEM : path.join(DATA_DIR, `s_${safeId(id)}.json`);
  try { fs.removeSync(f); } catch {}
}

module.exports = { getMemory, saveMemory, clearMemory };
