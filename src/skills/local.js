// Local skills — work offline: calculator, unit conversion, timers/reminders/alarms,
// tasks, notes, system stats, music control, file search, password generator, dice.

const os      = require("os");
const path    = require("path");
const crypto  = require("crypto");
const store   = require("../store");
const tele    = require("../telemetry");
const mac     = require("../mac-control");

const IS_MAC = process.platform === "darwin";

// ═════════════════════════════════════════════════════════════════════════════
// CALCULATOR  (own parser — never eval)
// ═════════════════════════════════════════════════════════════════════════════
const FUNCS = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log };

function normMath(s) {
  return s.toLowerCase()
    .replace(/,(?=\d{3}\b)/g, "")
    .replace(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s*of\s*(\d+(?:\.\d+)?)/g, "($1/100*$2)")
    .replace(/(?:square root|sqrt) of\s*(\d+(?:\.\d+)?)/g, "sqrt($1)")
    .replace(/(\d+(?:\.\d+)?)\s*squared/g, "($1^2)")
    .replace(/(\d+(?:\.\d+)?)\s*cubed/g, "($1^3)")
    .replace(/\bto the power of\b|\braised to\b/g, "^")
    .replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-")
    .replace(/\b(?:times|multiplied by)\b|×/g, "*").replace(/(?<=\d)\s*x\s*(?=\d)/g, "*")
    .replace(/\b(?:divided by|over)\b|÷/g, "/")
    .replace(/\bmod(?:ulo)?\b/g, "%")
    .replace(/\bpi\b/g, String(Math.PI));
}

function evalMath(src) {
  const toks = src.match(/\d+(?:\.\d+)?|[a-z]+|[-+*/^%()]/g);
  if (!toks || toks.join("") !== src.replace(/\s+/g, "")) throw new Error("bad");
  let i = 0;
  const peek = () => toks[i], next = () => toks[i++];
  function primary() {
    const t = next();
    if (t === undefined) throw new Error("bad");
    if (/^\d/.test(t)) return parseFloat(t);
    if (t === "(") { const v = expr(); if (next() !== ")") throw new Error("bad"); return v; }
    if (FUNCS[t]) { if (next() !== "(") throw new Error("bad"); const v = expr(); if (next() !== ")") throw new Error("bad"); return FUNCS[t](v); }
    if (t === "e") return Math.E;
    throw new Error("bad");
  }
  function unary() { if (peek() === "-") { next(); return -unary(); } if (peek() === "+") { next(); return unary(); } return primary(); }
  function power() { const b = unary(); if (peek() === "^") { next(); return Math.pow(b, power()); } return b; }
  function term() { let v = power(); while (peek() === "*" || peek() === "/" || peek() === "%") { const o = next(), r = power(); v = o === "*" ? v * r : o === "/" ? v / r : v % r; } return v; }
  function expr() { let v = term(); while (peek() === "+" || peek() === "-") { const o = next(), r = term(); v = o === "+" ? v + r : v - r; } return v; }
  const v = expr();
  if (i !== toks.length) throw new Error("bad");
  return v;
}

function matchCalc(t) {
  let s = t.replace(/^(?:what(?:'s| is)|calculate|compute|how much is|solve|math|equals?)\s+/, "").replace(/\s*(?:=|equals)\??$/, "");
  s = normMath(s);
  if (!/[\d)]/.test(s)) return null;
  const stripped = s.replace(/sqrt|abs|round|floor|ceil|sin|cos|tan|log|ln|\be\b/g, "");
  if (!/^[\d\s+\-*/^().%]+$/.test(stripped)) return null;
  if (!/[+\-*/^%]|sqrt|abs|round|floor|ceil|sin|cos|tan|log|ln/.test(s.replace(/^-/, ""))) return null;
  return { expr: s.replace(/\s+/g, "") };
}

function calc({ expr }) {
  let v;
  try { v = evalMath(expr); } catch { throw new Error("I couldn't parse that calculation."); }
  if (!Number.isFinite(v)) throw new Error("That doesn't have a finite answer.");
  const out = Math.abs(v) >= 1e15 || (Math.abs(v) < 1e-6 && v !== 0) ? v.toExponential(6) : String(+v.toFixed(8));
  return { say: `The answer is ${out}.`, card: { title: "CALCULATOR", sub: out, rows: [["EXPRESSION", expr]] } };
}

// ═════════════════════════════════════════════════════════════════════════════
// UNITS
// ═════════════════════════════════════════════════════════════════════════════
const UNITS = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, ft: 0.3048, in: 0.0254, yd: 0.9144 },
  mass:   { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523, t: 1000 },
  volume: { l: 1, ml: 0.001, gal: 3.785411784, cup: 0.2365882365, floz: 0.0295735296 },
  speed:  { ms: 1, kmh: 0.2777778, mph: 0.44704, kn: 0.5144444 },
  data:   { b: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12 },
};
const ALIAS = {
  meter: "m", meters: "m", metre: "m", metres: "m", m: "m", kilometer: "km", kilometers: "km", kilometre: "km", kilometres: "km", km: "km",
  centimeter: "cm", centimeters: "cm", cm: "cm", millimeter: "mm", millimeters: "mm", mm: "mm", mile: "mi", miles: "mi", mi: "mi",
  foot: "ft", feet: "ft", ft: "ft", inch: "in", inches: "in", in: "in", yard: "yd", yards: "yd", yd: "yd",
  kilogram: "kg", kilograms: "kg", kg: "kg", kilo: "kg", kilos: "kg", gram: "g", grams: "g", g: "g", pound: "lb", pounds: "lb", lb: "lb", lbs: "lb",
  ounce: "oz", ounces: "oz", oz: "oz", ton: "t", tons: "t", tonne: "t", tonnes: "t",
  liter: "l", liters: "l", litre: "l", litres: "l", l: "l", milliliter: "ml", milliliters: "ml", ml: "ml", gallon: "gal", gallons: "gal", gal: "gal", cup: "cup", cups: "cup",
  kmh: "kmh", kph: "kmh", "km/h": "kmh", mph: "mph", knots: "kn", knot: "kn", "m/s": "ms",
  byte: "b", bytes: "b", kb: "kb", kilobytes: "kb", mb: "mb", megabytes: "mb", gb: "gb", gigabytes: "gb", tb: "tb", terabytes: "tb",
  c: "c", celsius: "c", centigrade: "c", f: "f", fahrenheit: "f", k: "k", kelvin: "k",
};
const unitKey = (w) => ALIAS[String(w).trim().toLowerCase().replace(/^degrees?\s+/, "").replace(/°/g, "")] || null;

function matchUnits(t) {
  const m = t.replace(/^(?:how (?:many|much) is|what(?:'s| is))\s+/, "").match(/^(?:convert\s+)?(-?\d[\d.,]*)\s*([a-z°/]+(?:\s[a-z]+)?)\s+(?:to|in|into|as)\s+([a-z°/]+(?:\s[a-z]+)?)$/);
  if (!m) return null;
  const from = unitKey(m[2]), to = unitKey(m[3]);
  if (!from || !to) return null;
  return { n: parseFloat(m[1].replace(/,/g, "")), from, to };
}

const SPOKEN = { m: "metres", km: "kilometres", cm: "centimetres", mm: "millimetres", mi: "miles", ft: "feet", in: "inches", yd: "yards",
  kg: "kilograms", g: "grams", lb: "pounds", oz: "ounces", t: "tonnes", l: "litres", ml: "millilitres", gal: "gallons", cup: "cups", floz: "fluid ounces",
  ms: "metres per second", kmh: "kilometres per hour", mph: "miles per hour", kn: "knots", b: "bytes", kb: "kilobytes", mb: "megabytes", gb: "gigabytes", tb: "terabytes",
  c: "degrees Celsius", f: "degrees Fahrenheit", k: "kelvin" };

function convert({ n, from, to }) {
  const temp = ["c", "f", "k"];
  let out;
  if (temp.includes(from) && temp.includes(to)) {
    const c = from === "c" ? n : from === "f" ? (n - 32) * 5 / 9 : n - 273.15;
    out = to === "c" ? c : to === "f" ? c * 9 / 5 + 32 : c + 273.15;
  } else {
    const cat = Object.keys(UNITS).find((k) => UNITS[k][from] && UNITS[k][to]);
    if (!cat) throw new Error("Those units don't convert into each other.");
    out = (n * UNITS[cat][from]) / UNITS[cat][to];
  }
  const f = (v) => String(+v.toFixed(4));
  return { say: `${f(n)} ${SPOKEN[from]} is ${f(out)} ${SPOKEN[to]}.`, card: { title: "CONVERT", sub: `${f(n)} ${from.toUpperCase()} → ${f(out)} ${to.toUpperCase()}` } };
}

// ═════════════════════════════════════════════════════════════════════════════
// TIMERS · REMINDERS · ALARMS
// ═════════════════════════════════════════════════════════════════════════════
const NUMW = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, sixty: 60, ninety: 90 };
const NUMRE = "\\d+(?:\\.\\d+)?|" + Object.keys(NUMW).sort((a, b) => b.length - a.length).join("|");

function parseDuration(s) {
  s = String(s).toLowerCase().replace(/-/g, " ")
    .replace(/an hour and a half/g, "90 minutes").replace(/half an hour|half hour/g, "30 minutes")
    .replace(/a quarter of an hour|quarter hour/g, "15 minutes")
    .replace(/forty five/g, "45").replace(/twenty five/g, "25").replace(/thirty five/g, "35");
  const re = new RegExp(`(${NUMRE})\\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\\b`, "g");
  let ms = 0, m, found = false;
  while ((m = re.exec(s))) {
    const n = NUMW[m[1]] ?? parseFloat(m[1]);
    const u = m[2][0];
    ms += n * (u === "h" ? 3600e3 : u === "m" ? 60e3 : 1e3);
    found = true;
  }
  return found ? ms : null;
}

function parseClock(s) {
  const m = String(s).toLowerCase().trim().match(/^(?:at\s+)?(\d{1,2})(?:[:.\s](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (!m) return null;
  let h = +m[1], mi = m[2] ? +m[2] : 0;
  const ap = m[3] && m[3][0];
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23 || mi > 59) return null;
  const d = new Date(); d.setHours(h, mi, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

const fmtDur = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} hour${h === 1 ? "" : "s"}${r ? ` ${r} minute${r === 1 ? "" : "s"}` : ""}`;
};
const fmtClock = (d) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

function addReminder(kind, at, label) {
  const r = { id: store.nextId(), kind, at, label, created: Date.now() };
  store.db().reminders.push(r);
  store.save();
  return r;
}

let notifier = () => {};
const setNotifier = (fn) => { notifier = fn; };

function tick() {
  const db = store.db(), now = Date.now();
  const due = db.reminders.filter((r) => r.at <= now);
  if (!due.length) return;
  db.reminders = db.reminders.filter((r) => r.at > now);
  store.save();
  due.forEach((r) => notifier(r, now - r.at > 60000));
}
let ticking = null;
function startScheduler() { if (!ticking) { ticking = setInterval(tick, 1000); ticking.unref && ticking.unref(); tick(); } }

function matchTimer(t) {
  let m;
  if ((m = t.match(/^(?:cancel|stop|clear|delete|remove)\s+(?:all\s+|my\s+|the\s+)*(timers?|alarms?|reminders?)$/))) return { op: "cancel" };
  if (/^(?:list |show |what(?:'s| are| is) )?(?:my |the |active |any )*(?:timers?|alarms?|reminders?)(?: left| set| running)?$/.test(t) || /^how much time(?: is)? left$/.test(t)) return { op: "list" };

  if ((m = t.match(/^remind me (?:in|after) (.+?) (?:to|that|about) (.+)$/))) { const ms = parseDuration(m[1]); if (ms) return { op: "remind", ms, label: m[2] }; }
  if ((m = t.match(/^remind me (?:to|about|that) (.+?) (?:in|after) (.+)$/)))  { const ms = parseDuration(m[2]); if (ms) return { op: "remind", ms, label: m[1] }; }
  if ((m = t.match(/^remind me (?:at|by) (.+?) (?:to|that|about) (.+)$/)))     { const d = parseClock(m[1]); if (d) return { op: "remindAt", at: d.getTime(), label: m[2] }; }
  if ((m = t.match(/^remind me (?:to|about|that) (.+?) (?:at|by) (\d.*)$/)))   { const d = parseClock(m[2]); if (d) return { op: "remindAt", at: d.getTime(), label: m[1] }; }

  if ((m = t.match(/\balarm\b(?:\s+(?:for|at))?\s*(.*)$/))) { const d = parseClock(m[1]); if (d) return { op: "alarm", at: d.getTime() }; }
  if (/\b(?:focus|pomodoro)\b/.test(t) && !/\btimer\b/.test(t)) {
    const ms = parseDuration(t) || 25 * 60e3;
    return { op: "timer", ms, label: "Focus session" };
  }
  if (/\b(?:timer|countdown)\b/.test(t)) { const ms = parseDuration(t); if (ms) return { op: "timer", ms, label: "Timer" }; }
  return null;
}

function timerSkill(a) {
  const db = store.db();
  if (a.op === "cancel") {
    const n = db.reminders.length;
    db.reminders = []; store.save();
    return { say: n ? `Cancelled ${n} ${n === 1 ? "item" : "items"}.` : "Nothing was running.", card: { title: "TIMERS", sub: n ? "Cleared" : "None active" }, refresh: "data" };
  }
  if (a.op === "list") {
    const list = db.reminders.slice().sort((x, y) => x.at - y.at);
    if (!list.length) return { say: "No active timers or reminders.", card: { title: "TIMERS", sub: "None active" } };
    return {
      say: list.slice(0, 3).map((r) => `${r.label || r.kind}, in ${fmtDur(r.at - Date.now())}`).join(". ") + ".",
      card: { title: "TIMERS", rows: list.map((r) => [(r.label || r.kind).toUpperCase(), `in ${fmtDur(r.at - Date.now())} · ${fmtClock(new Date(r.at))}`]) },
    };
  }
  if (a.op === "timer")    { const r = addReminder("timer", Date.now() + a.ms, a.label); return { say: `${a.label === "Timer" ? "Timer" : a.label} set for ${fmtDur(a.ms)}.`, card: { title: a.label.toUpperCase(), sub: fmtDur(a.ms), rows: [["ENDS", fmtClock(new Date(r.at))]] }, refresh: "data" }; }
  if (a.op === "remind")   { const r = addReminder("reminder", Date.now() + a.ms, a.label); return { say: `I'll remind you in ${fmtDur(a.ms)} to ${a.label}.`, card: { title: "REMINDER", sub: a.label, rows: [["AT", fmtClock(new Date(r.at))]] }, refresh: "data" }; }
  if (a.op === "remindAt") { const r = addReminder("reminder", a.at, a.label); return { say: `I'll remind you at ${fmtClock(new Date(a.at))} to ${a.label}.`, card: { title: "REMINDER", sub: a.label, rows: [["AT", fmtClock(new Date(r.at))]] }, refresh: "data" }; }
  if (a.op === "alarm")    { const r = addReminder("alarm", a.at, "Alarm"); const tomorrow = new Date(a.at).getDate() !== new Date().getDate(); return { say: `Alarm set for ${fmtClock(new Date(a.at))}${tomorrow ? " tomorrow" : ""}.`, card: { title: "ALARM", sub: fmtClock(new Date(r.at)) }, refresh: "data" }; }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// TASKS & NOTES
// ═════════════════════════════════════════════════════════════════════════════
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function matchTasks(t, raw) {
  let m;
  const orig = (re) => raw.match(re);
  if ((m = orig(/^(?:add|create|new)\s+(?:a\s+)?(?:task|todo|to-do)\s*[:,-]?\s*(.+)$/i))) return { op: "add", text: m[1] };
  if ((m = orig(/^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:my\s+)?(?:tasks?|to-?do(?: list)?)$/i))) return { op: "add", text: m[1] };
  if ((m = orig(/^remind me (?:to|about|that)\s+(.+)$/i))) return { op: "add", text: m[1] };
  if ((m = t.match(/^(?:complete|finish|done with|check off|tick|mark)\s+(?:task\s+)?(?:number\s+)?(\d+)(?:\s+(?:as\s+)?(?:done|complete|completed))?$/))) return { op: "done", n: +m[1] };
  if ((m = t.match(/^task\s+(\d+)\s+(?:is\s+)?(?:done|complete|completed)$/))) return { op: "done", n: +m[1] };
  if ((m = t.match(/^(?:delete|remove)\s+task\s+(?:number\s+)?(\d+)$/))) return { op: "del", n: +m[1] };
  if (/^clear\s+(?:all\s+)?(?:completed|finished|done)\s+tasks$/.test(t)) return { op: "clearDone" };
  if (/^(?:list |show |read |what(?:'s| are| is) )?(?:my |the |all )*(?:tasks|to-?dos?|to-?do list|task list)(?: today| list)?$/.test(t)) return { op: "list" };
  return null;
}

function tasksSkill(a) {
  const db = store.db();
  const list = () => db.tasks.map((x, i) => [`${i + 1}${x.done ? " ✓" : ""}`, x.text]);
  if (a.op === "add") { db.tasks.push({ id: store.nextId(), text: cap(a.text.trim()), done: false, created: Date.now() }); store.save(); return { say: `Task added: ${a.text.trim()}.`, card: { title: "TASKS", sub: `${db.tasks.filter((x) => !x.done).length} open`, rows: list() }, refresh: "data" }; }
  if (a.op === "done" || a.op === "del") {
    const x = db.tasks[a.n - 1];
    if (!x) return { say: `There's no task ${a.n}.`, card: { title: "TASKS", rows: list() } };
    if (a.op === "done") x.done = true; else db.tasks.splice(a.n - 1, 1);
    store.save();
    return { say: a.op === "done" ? `Task ${a.n} complete.` : `Task ${a.n} removed.`, card: { title: "TASKS", sub: `${db.tasks.filter((y) => !y.done).length} open`, rows: list() }, refresh: "data" };
  }
  if (a.op === "clearDone") { db.tasks = db.tasks.filter((x) => !x.done); store.save(); return { say: "Completed tasks cleared.", refresh: "data", card: { title: "TASKS", rows: list() } }; }
  const open = db.tasks.filter((x) => !x.done);
  return {
    say: !db.tasks.length ? "Your task list is empty." : `You have ${open.length} open ${open.length === 1 ? "task" : "tasks"}. ` + open.slice(0, 4).map((x) => x.text).join(". ") + ".",
    card: { title: "TASKS", sub: `${open.length} open`, rows: list() },
  };
}

function matchNotes(t, raw) {
  let m;
  if ((m = raw.match(/^(?:take|make|save|write|add|jot)\s+(?:down\s+)?(?:a\s+)?note\s*[:,-]?\s*(?:that\s+)?(.+)$/i))) return { op: "add", text: m[1] };
  if ((m = raw.match(/^note\s*[:,-]\s*(.+)$/i))) return { op: "add", text: m[1] };
  if ((m = raw.match(/^remember\s+(?:that\s+)?(.+)$/i)) && !/^remember me\b/i.test(raw)) return { op: "add", text: m[1] };
  if (/^(?:show|read|list|what(?:'s| are| is))?\s*(?:my |the |all )*notes$/.test(t)) return { op: "list" };
  if ((m = t.match(/^(?:delete|remove)\s+note\s+(?:number\s+)?(\d+)$/))) return { op: "del", n: +m[1] };
  if (/^(?:clear|delete)\s+(?:all\s+)?(?:my\s+)?notes$/.test(t)) return { op: "clear" };
  return null;
}

function notesSkill(a) {
  const db = store.db();
  const rows = () => db.notes.map((x, i) => [String(i + 1), x.text]);
  if (a.op === "add") { db.notes.push({ id: store.nextId(), text: cap(a.text.trim()), at: Date.now() }); store.save(); return { say: "Noted.", card: { title: "NOTE SAVED", sub: a.text.trim() }, refresh: "data" }; }
  if (a.op === "del") { if (!db.notes[a.n - 1]) return { say: `There's no note ${a.n}.` }; db.notes.splice(a.n - 1, 1); store.save(); return { say: `Note ${a.n} deleted.`, refresh: "data" }; }
  if (a.op === "clear") { db.notes = []; store.save(); return { say: "All notes cleared.", refresh: "data" }; }
  return {
    say: db.notes.length ? `You have ${db.notes.length} ${db.notes.length === 1 ? "note" : "notes"}. Latest: ${db.notes[db.notes.length - 1].text}` : "You have no notes.",
    card: { title: "NOTES", rows: rows() },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// SYSTEM
// ═════════════════════════════════════════════════════════════════════════════
function systemSkill({ what }) {
  const s = tele.snapshot();
  const rows = [
    ["CPU", `${s.cpu}% · ${s.cores} cores`],
    ["MEMORY", `${tele.gb(s.mem.used)} / ${tele.gb(s.mem.total)} GB (${s.mem.pct}%)`],
    ...(s.disk ? [["DISK", `${tele.gb(s.disk.used)} / ${tele.gb(s.disk.total)} GB (${s.disk.pct}%)`]] : []),
    ...(s.battery ? [["BATTERY", `${s.battery.pct}% · ${s.battery.state}`]] : []),
    ["UPTIME", tele.dur(s.uptime)],
    ["LOAD", s.load.join(" · ")],
  ];
  if (what === "procs") {
    const p = s.procs.slice(0, 5);
    return { say: p.length ? "Top processes: " + p.map((x) => `${x.name} ${x.cpu.toFixed(0)} percent`).join(", ") + "." : "I couldn't read the process list.", card: { title: "TOP PROCESSES", rows: p.map((x) => [x.name.toUpperCase(), `${x.cpu.toFixed(1)}% CPU · ${x.mem.toFixed(1)}% MEM`]) } };
  }
  const say = {
    cpu: `CPU is at ${s.cpu} percent.`,
    mem: `Memory: ${tele.gb(s.mem.used)} of ${tele.gb(s.mem.total)} gigabytes in use, ${s.mem.pct} percent.`,
    disk: s.disk ? `Disk is ${s.disk.pct} percent full, ${tele.gb(s.disk.total - s.disk.used)} gigabytes free.` : "I can't read the disk on this system.",
    uptime: `Up for ${tele.dur(s.uptime)}.`,
  }[what] || `CPU ${s.cpu} percent. Memory ${s.mem.pct} percent.${s.disk ? ` Disk ${s.disk.pct} percent.` : ""}${s.battery ? ` Battery ${s.battery.pct} percent.` : ""} Uptime ${tele.dur(s.uptime)}.`;
  return { say, card: { title: "SYSTEM STATUS", sub: `${s.host} · ${s.platform}`, rows } };
}

// ═════════════════════════════════════════════════════════════════════════════
// MUSIC (macOS — Spotify or Apple Music)
// ═════════════════════════════════════════════════════════════════════════════
async function player() {
  for (const app of ["Spotify", "Music"]) {
    try { if ((await mac.as(`application "${app}" is running`)) === "true") return app; } catch {}
  }
  return null;
}

async function musicSkill({ op, query }) {
  if (!IS_MAC) throw new Error("Music control only works on macOS.");
  let app = await player();
  if (!app && (op === "play" || op === "toggle")) {
    const target = (await mac.as(`try\n  tell application "Finder" to return exists application file id "com.spotify.client"\nend try`).catch(() => "false")) === "true" ? "Spotify" : "Music";
    await mac.run("open", ["-a", target]);
    await new Promise((r) => setTimeout(r, 2500));
    app = target;
  }
  if (!app) return { say: "No music player is running." };
  if (op === "search") {
    await mac.run("open", [`https://open.spotify.com/search/${encodeURIComponent(query)}`]);
    return { say: `I can control playback but not pick tracks directly. Opening a search for ${query}.`, card: { title: "MUSIC", sub: `Search: ${query}` } };
  }
  const cmd = { play: "play", pause: "pause", toggle: "playpause", next: "next track", prev: "previous track" }[op];
  if (cmd) { await mac.as(`tell application "${app}" to ${cmd}`); }
  let now = "";
  try { now = await mac.as(`tell application "${app}"\n  return (name of current track) & " — " & (artist of current track)\nend tell`); } catch {}
  const label = { play: "Playing", pause: "Paused", toggle: "Toggled", next: "Next track", prev: "Previous track", now: "Now playing" }[op];
  return { say: op === "pause" ? "Paused." : now ? `${label}: ${now}.` : `${label}.`, card: { title: `MUSIC · ${app.toUpperCase()}`, sub: now || label } };
}

function matchMusic(t) {
  if (/^(?:play|resume)(?: the)? (?:music|song|songs|spotify|playlist)?$/.test(t) || t === "resume" || t === "play") return { op: "play" };
  if (/^(?:pause|stop)(?: the)? (?:music|song|spotify|playback)?$/.test(t) || t === "pause") return { op: "pause" };
  if (/^(?:next|skip)(?: (?:the )?(?:song|track))?$/.test(t) || t === "skip") return { op: "next" };
  if (/^(?:previous|last|back)(?: (?:the )?(?:song|track))?$/.test(t) || t === "go back a song") return { op: "prev" };
  if (/^(?:what(?:'s| is) (?:this song|playing|the song)|what song is this|now playing|current song)$/.test(t)) return { op: "now" };
  const m = t.match(/^play (.{2,})$/);
  if (m && !/^(?:the )?(?:music|song|songs|spotify)$/.test(m[1])) return { op: "search", query: m[1].replace(/\s+on spotify$/, "") };
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// FILE SEARCH
// ═════════════════════════════════════════════════════════════════════════════
async function filesSkill({ query }) {
  const home = os.homedir();
  let out = "";
  if (IS_MAC) out = await mac.run("mdfind", ["-onlyin", home, "-name", query], { timeout: 15000 }).catch(() => "");
  else if (process.platform === "linux") out = await mac.run("find", [home, "-maxdepth", "5", "-iname", `*${query}*`, "-not", "-path", "*/.*", "-not", "-path", "*/node_modules/*"], { timeout: 15000 }).catch(() => "");
  else throw new Error("File search isn't supported on this system.");
  const list = out.split("\n").map((s) => s.trim()).filter((p) => p && !/\/Library\/|\/\.|node_modules/.test(p)).slice(0, 8);
  if (!list.length) return { say: `I found nothing matching ${query}.`, card: { title: "FILE SEARCH", sub: `No results for "${query}"` } };
  return {
    say: `Found ${list.length} ${list.length === 1 ? "match" : "matches"} for ${query}. The first is ${path.basename(list[0])}.`,
    card: { title: "FILE SEARCH", sub: `"${query}"`, items: list.map((p) => ({ t: path.basename(p), m: p.replace(home, "~"), cmd: `open file ${p}` })) },
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════════
async function passwordSkill({ len = 20 }) {
  len = Math.max(8, Math.min(64, len));
  const set = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_=+?";
  let pw = "";
  for (let i = 0; i < len; i++) pw += set[crypto.randomInt(set.length)];
  let copied = false;
  try { await mac.setClipboard(pw); copied = true; } catch {}
  return { say: `Password generated${copied ? " and copied to your clipboard" : ""}. I won't read it aloud.`, card: { title: "PASSWORD", sub: pw, rows: [["LENGTH", String(len)], ["CLIPBOARD", copied ? "copied" : "unavailable"]] }, sensitive: true };
}

function randomSkill({ kind, a, b }) {
  if (kind === "coin") { const r = crypto.randomInt(2) ? "Heads" : "Tails"; return { say: `${r}.`, card: { title: "COIN", sub: r } }; }
  if (kind === "dice") { const sides = a || 6, r = crypto.randomInt(sides) + 1; return { say: `Rolled ${r} on a ${sides}-sided die.`, card: { title: `D${sides}`, sub: String(r) } }; }
  const lo = Math.min(a, b), hi = Math.max(a, b), r = lo + crypto.randomInt(hi - lo + 1);
  return { say: `${r}.`, card: { title: "RANDOM", sub: String(r), rows: [["RANGE", `${lo}–${hi}`]] } };
}

function matchRandom(t) {
  let m;
  if (/^(?:flip|toss)\s+(?:a\s+)?coin$/.test(t)) return { kind: "coin" };
  if ((m = t.match(/^roll\s+(?:a\s+)?(?:d|die|dice|(\d+)\s*sided\s*die)?\s*(\d+)?$/))) return { kind: "dice", a: +(m[2] || m[1] || 6) };
  if ((m = t.match(/^(?:pick|choose|give me)\s+(?:a\s+)?(?:random\s+)?number\s+(?:between|from)\s+(\d+)\s+(?:and|to)\s+(\d+)$/))) return { kind: "range", a: +m[1], b: +m[2] };
  return null;
}

function dateSkill() {
  const n = new Date();
  const d = n.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  const start = new Date(n.getFullYear(), 0, 0), day = Math.floor((n - start) / 864e5);
  return { say: `Today is ${d}.`, card: { title: "DATE", sub: d, rows: [["DAY OF YEAR", String(day)], ["TIME", n.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })]] } };
}

module.exports = {
  matchCalc, calc, matchUnits, convert,
  matchTimer, timerSkill, setNotifier, startScheduler, parseDuration, parseClock, fmtDur,
  matchTasks, tasksSkill, matchNotes, notesSkill,
  systemSkill, matchMusic, musicSkill, filesSkill, passwordSkill, matchRandom, randomSkill, dateSkill,
};
