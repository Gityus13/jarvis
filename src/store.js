// Tiny persistent store (data/jarvis-data.json) — tasks, notes, reminders, settings.
const fs   = require("fs-extra");
const path = require("path");

const FILE = path.join(require("./paths").DATA, "jarvis-data.json");
let db = { tasks: [], notes: [], reminders: [], settings: {}, nextId: 1 };
let timer = null;

try { db = { ...db, ...fs.readJsonSync(FILE) }; } catch {}

function save() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    try {
      fs.ensureDirSync(path.dirname(FILE));
      fs.writeJsonSync(FILE + ".tmp", db);
      fs.moveSync(FILE + ".tmp", FILE, { overwrite: true });
    } catch {}
  }, 120);
}

const nextId = () => db.nextId++;
const snapshot = () => ({ tasks: db.tasks, notes: db.notes.slice(-30), reminders: db.reminders, settings: db.settings });

module.exports = { db: () => db, save, nextId, snapshot };
