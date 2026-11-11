// Real system telemetry for the HUD (nothing here is faked).
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const fetch = require("node-fetch");

const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
const HIST = 60;

const state = {
  cpu: 0, cpuHist: [], memHist: [],
  disk: null, battery: null, procs: [], net: { ms: null, ok: null },
};

function run(file, args, timeout = 4000) {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { timeout, maxBuffer: 1024 * 1024 }, (err, out) => resolve(err ? "" : String(out)));
    } catch { resolve(""); }
  });
}

// ── CPU % (delta between samples) ─────────────────────────────────────────────
let prev = os.cpus();
function sampleCpu() {
  const cur = os.cpus();
  let idle = 0, total = 0;
  cur.forEach((c, i) => {
    const p = prev[i] || c;
    const dIdle = c.times.idle - p.times.idle;
    const dTotal = Object.values(c.times).reduce((a, b) => a + b, 0) - Object.values(p.times).reduce((a, b) => a + b, 0);
    idle += dIdle; total += dTotal;
  });
  prev = cur;
  state.cpu = total > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - idle / total)))) : 0;
  push(state.cpuHist, state.cpu);
  const mem = memInfo();
  push(state.memHist, mem.pct);
}

function push(arr, v) { arr.push(v); if (arr.length > HIST) arr.shift(); }

function memInfo() {
  const total = os.totalmem();
  let free = os.freemem();
  // macOS reports almost all RAM as "used" (file cache) — use vm_stat to get a realistic number
  if (state._macFree != null) free = state._macFree;
  const used = Math.max(0, total - free);
  return { total, used, pct: Math.round((used / total) * 100) };
}

async function sampleMacMem() {
  if (!IS_MAC) return;
  const out = await run("vm_stat", []);
  const page = parseInt((out.match(/page size of (\d+)/) || [])[1], 10) || 4096;
  const get = (k) => parseInt(((out.match(new RegExp(k + ":\\s+(\\d+)")) || [])[1]), 10) || 0;
  const avail = (get("Pages free") + get("Pages inactive") + get("Pages speculative") + get("Pages purgeable")) * page;
  if (avail > 0) state._macFree = avail;
}

// ── Slower things: disk, battery, processes, latency ──────────────────────────
async function sampleDisk() {
  if (IS_WIN) return;
  const out = await run("df", ["-k", os.homedir()]);
  const line = out.trim().split("\n")[1];
  if (!line) return;
  const f = line.trim().split(/\s+/);
  // df columns: Filesystem 1K-blocks Used Available Capacity ...
  const total = parseInt(f[1], 10) * 1024, avail = parseInt(f[3], 10) * 1024;
  if (!total) return;
  // On APFS "Used" excludes other volumes — compute from total/avail so it matches Finder
  state.disk = { total, used: total - avail, pct: Math.round(((total - avail) / total) * 100) };
}

async function sampleBattery() {
  if (IS_MAC) {
    const out = await run("pmset", ["-g", "batt"]);
    const pct = (out.match(/(\d+)%/) || [])[1];
    if (!pct) { state.battery = null; return; }
    const st = (out.match(/;\s*(charging|discharging|charged|finishing charge)/i) || [])[1];
    state.battery = { pct: +pct, state: (st || (out.includes("AC Power") ? "plugged" : "battery")).toLowerCase() };
  } else if (process.platform === "linux") {
    const out = (await run("cat", ["/sys/class/power_supply/BAT0/capacity"])).trim();
    const st = (await run("cat", ["/sys/class/power_supply/BAT0/status"])).trim().toLowerCase();
    state.battery = out ? { pct: +out, state: st || "unknown" } : null;
  }
}

async function sampleProcs() {
  if (IS_WIN) return;
  const args = IS_MAC ? ["-Aro", "pid,pcpu,pmem,comm"] : ["-Ao", "pid,pcpu,pmem,comm", "--sort=-pcpu"];
  const out = await run("ps", args);
  state.procs = out.trim().split("\n").slice(1, 7).map((l) => {
    const m = l.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/);
    return m ? { pid: +m[1], cpu: +m[2], mem: +m[3], name: path.basename(m[4]).slice(0, 24) } : null;
  }).filter(Boolean);
}

async function sampleNet() {
  const t0 = Date.now();
  try {
    const r = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { timeout: 4000 });
    state.net = { ms: r.ok ? Date.now() - t0 : null, ok: r.ok };
  } catch { state.net = { ms: null, ok: false }; }
}

let started = false;
function start() {
  if (started) return;
  started = true;
  sampleCpu();
  const fast = setInterval(sampleCpu, 2000);
  const slow = setInterval(() => { sampleMacMem(); sampleProcs(); }, 5000);
  const slower = setInterval(() => { sampleDisk(); sampleBattery(); sampleNet(); }, 20000);
  [fast, slow, slower].forEach((t) => t.unref && t.unref());
  sampleMacMem(); sampleProcs(); sampleDisk(); sampleBattery(); sampleNet();
}

function snapshot() {
  const mem = memInfo();
  return {
    cpu: state.cpu, cpuHist: state.cpuHist,
    mem: { ...mem, hist: state.memHist },
    disk: state.disk, battery: state.battery, procs: state.procs, net: state.net,
    load: os.loadavg().map((n) => +n.toFixed(2)),
    uptime: os.uptime(), cores: os.cpus().length,
    host: os.hostname(), platform: `${os.type()} ${os.release()}`, node: process.version,
    t: Date.now(),
  };
}

const gb = (n) => (n / 1024 ** 3).toFixed(1);
const dur = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(" "); };

module.exports = { start, snapshot, gb, dur };
