// Every test file starts with this: isolated data dir, no real network.
const fs = require("fs");
const os = require("os");
const path = require("path");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-test-"));
process.env.JARVIS_DATA_DIR = path.join(dir, "data");
process.env.JARVIS_LOG_DIR = path.join(dir, "logs");
process.env.HOME_CITY = "Baku";
process.env.USER_NAME = "Tester";
module.exports = { dir };
