const path = require("path");
const fs   = require("fs-extra");

const LOG_FILE = path.join(__dirname, "../logs/jarvis.log");
const MAX_SIZE = 5 * 1024 * 1024;

fs.ensureDirSync(path.dirname(LOG_FILE));

function write(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  process.stdout.write(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_SIZE) {
      fs.moveSync(LOG_FILE, LOG_FILE.replace(".log", `_${Date.now()}.log`));
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch {}
}

const logger = {
  info:  m => write("INFO",  m),
  warn:  m => write("WARN",  m),
  error: m => write("ERROR", m),
  debug: m => write("DEBUG", m),
};

module.exports = { logger };
