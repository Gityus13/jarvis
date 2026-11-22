const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let active = null;

function binaryPath() {
  return process.env.JARVIS_NATIVE_DICTATION ||
    path.join(process.cwd(), "resources", "macos-dictation");
}

function available() {
  const p = binaryPath();
  return process.platform === "darwin" && !!p && fs.existsSync(p);
}

function start() {
  if (!available()) return Promise.resolve({ ok: false, reason: "Native macOS dictation helper unavailable. Reinstall Jarvis.app; it could not find its signed dictation helper." });
  if (active) return Promise.resolve(status());

  let child;
  try {
    child = spawn(binaryPath(), [], { stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    return Promise.resolve({ ok: false, reason: `Could not launch dictation helper: ${e.message}` });
  }

  active = { child, text: "", interim: "", error: "", stopped: false };
  const consume = (data) => {
    const lines = String(data).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.text !== undefined) {
          active.text = event.final ? event.text : active.text;
          active.interim = event.final ? "" : event.text;
        }
        if (event.error) active.error = event.error;
      } catch {
        if (!line.startsWith("{")) active.error = line;
      }
    }
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  child.on("exit", (code, signal) => {
    if (!active || active.child !== child) return;
    if (code !== 0 && signal !== "SIGTERM" && !active.error) active.error = `Dictation helper exited with code ${code}`;
  });
  child.on("error", (error) => {
    if (!active || active.child !== child) return;
    active.error = `Could not launch dictation helper: ${error.message}`;
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };
    const timer = setTimeout(() => {
      if (active?.error) finish({ ok: false, reason: active.error });
      else if (active?.child?.exitCode !== null) finish({ ok: false, reason: "Native dictation helper exited before it became ready" });
      else finish({ ok: true, text: "", interim: "", running: true });
    }, 1000);
    const probe = setInterval(() => {
      if (!active || settled) { clearInterval(probe); return; }
      if (active.error) finish({ ok: false, reason: active.error });
      else if (active.text !== "" || active.interim !== "" || active.child.exitCode === null) {
        clearInterval(probe);
        finish({ ok: true, text: active.text, interim: active.interim, running: true });
      }
    }, 50);
  });
}

function status() {
  if (!active) return { ok: true, running: false, text: "", interim: "" };
  return {
    ok: !active.error,
    running: !!active.child && active.child.exitCode === null,
    text: active.text,
    interim: active.interim,
    error: active.error,
  };
}

function stop() {
  if (!active) return status();
  active.stopped = true;
  try { active.child.kill("SIGTERM"); } catch {}
  const result = status();
  if (!result.text && result.interim) result.text = result.interim;
  setTimeout(() => {
    if (active?.stopped) active = null;
  }, 100);
  return result;
}

module.exports = { available, start, status, stop };
