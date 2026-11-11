// Where JARVIS keeps its files. Override with JARVIS_DATA_DIR / JARVIS_LOG_DIR (used by the tests).
const path = require("path");
const ROOT = path.join(__dirname, "..");
module.exports = {
  ROOT,
  DATA: process.env.JARVIS_DATA_DIR || path.join(ROOT, "data"),
  LOGS: process.env.JARVIS_LOG_DIR  || path.join(ROOT, "logs"),
};
