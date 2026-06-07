const path = require("path");
const fs   = require("fs-extra");

const DATA_DIR   = path.join(__dirname, "../data");
const GLOBAL_MEM = path.join(DATA_DIR, "memory.json");
const MAX_MSGS   = 100;

fs.ensureDirSync(DATA_DIR);

function getMemory(id = "global") {
  const f = id === "global" ? GLOBAL_MEM : path.join(DATA_DIR, `s_${id}.json`);
  try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  return { history: [], personality: "JARVIS" };
}

function saveMemory(id = "global", data) {
  const f = id === "global" ? GLOBAL_MEM : path.join(DATA_DIR, `s_${id}.json`);
  try {
    if (data.history?.length > MAX_MSGS) data.history = data.history.slice(-MAX_MSGS);
    data.lastSaved = new Date().toISOString();
    fs.writeFileSync(f, JSON.stringify(data, null, 2));
  } catch (e) { console.error("[Memory] Save failed:", e.message); }
}

function clearMemory(id = "global") {
  const f = id === "global" ? GLOBAL_MEM : path.join(DATA_DIR, `s_${id}.json`);
  try { fs.removeSync(f); } catch {}
}

module.exports = { getMemory, saveMemory, clearMemory };
