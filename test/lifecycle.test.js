// Real-world browser behaviour that used to break: switching tabs, Safari-style audio locking,
// and starting up while the neural voice is still loading. (Waits poll for conditions — no flaky fixed sleeps.)
const test = require("node:test");
const assert = require("node:assert/strict");
const { createConsole, sleep } = require("./helpers/console");

const SILENT = /^data:audio\/wav/;
const BLOB = (p) => /^blob:/.test(p.src);

// ═══════════════════════════ microphone vs. tab switching ═══════════════════════════
test("leaving the tab releases the mic and coming back resumes it — never 'blocked'", async () => {
  const c = createConsole();
  try {
    await c.enter(); c.endSystemVoice(); await c.until(() => c.live().length === 1);

    c.setHidden(true); await sleep(100);
    assert.equal(c.live().length, 0, "mic released while the tab is hidden");
    await sleep(4500);                                             // the 4-second watchdog must NOT start listening in a hidden tab
    assert.equal(c.live().length, 0, "nothing starts listening in the background");

    c.setHidden(false); await c.until(() => c.live().length === 1);
    assert.equal(c.live().length, 1, "listening resumes by itself when you return");
    assert.doesNotMatch(c.$("state-hint").textContent, /BLOCKED/);
    assert.notEqual(c.$("chip-mic").className, "chip bad");
  } finally { c.close(); }
});

test("a 'not-allowed' error from a backgrounded tab is NOT treated as a blocked microphone", async () => {
  const c = createConsole({ permission: "granted" });
  try {
    await c.enter(); c.endSystemVoice(); await c.until(() => c.live().length === 1);
    const rec = c.live()[0];
    c.hidden = true;                                               // browsers error the recognizer BEFORE the visibility event reaches us
    rec.fail("not-allowed"); await sleep(200);
    assert.equal(c.w.Voice.micBlocked(), false);
    c.setHidden(false); await c.until(() => c.live().length === 1);
    assert.equal(c.w.Voice.micBlocked(), false);
    assert.equal(c.live().length, 1, "recovered without a reload");
  } finally { c.close(); }
});

test("a session that worked and then gets 'not-allowed' in the foreground retries before giving up", async () => {
  const c = createConsole({ permission: "granted" });
  try {
    await c.enter(); c.endSystemVoice(); await c.until(() => c.live().length === 1);
    c.live()[0].emit([{ t: "hello there", final: true }]);         // proves the mic works
    c.live()[0].fail("not-allowed"); await sleep(100);
    await c.until(() => c.live().length === 1);
    assert.equal(c.w.Voice.micBlocked(), false, "transient: the permission is still granted");
    assert.equal(c.live().length, 1, "listening restarted");
  } finally { c.close(); }
});

test("a REAL block is detected via the permissions API, explained, and fixable by clicking the MIC indicator", async () => {
  const c = createConsole({ permission: "denied" });
  try {
    await c.enter(); c.endSystemVoice(); await c.until(() => c.live().length === 1);
    c.live()[0].fail("not-allowed"); await c.until(() => c.w.Voice.micBlocked());
    assert.equal(c.w.Voice.micBlocked(), true);
    assert.match(c.$("state-hint").textContent, /MIC BLOCKED.*RETRY/);
    assert.match(c.$("toasts").textContent, /lock icon/);

    c.permission = "granted";                                      // the user allowed it in the address bar
    c.$("chip-mic").click(); await c.until(() => c.live().length === 1);
    assert.equal(c.w.Voice.micBlocked(), false, "no reload needed");
    assert.equal(c.live().length, 1);
  } finally { c.close(); }
});

test("without a permissions API (Safari), blocking needs repeated foreground failures", async () => {
  const c = createConsole({ noPermissionsApi: true });
  try {
    await c.enter(); c.endSystemVoice(); await c.until(() => c.live().length === 1);
    c.live()[0].fail("not-allowed");
    await c.until(() => c.live().length === 1);                    // it retried by itself
    assert.equal(c.w.Voice.micBlocked(), false, "one failure is not a verdict");
    c.live()[0].fail("not-allowed");
    await c.until(() => c.live().length === 1);
    c.live()[0].fail("not-allowed");
    await c.until(() => c.w.Voice.micBlocked());
    assert.equal(c.w.Voice.micBlocked(), true, "three in a row is");
  } finally { c.close(); }
});

test("blocked mic recovers on its own when the user fixes the permission and returns to the tab", async () => {
  const c = createConsole({ permission: "denied" });
  try {
    await c.enter(); c.endSystemVoice(); await c.until(() => c.live().length === 1);
    c.live()[0].fail("not-allowed"); await c.until(() => c.w.Voice.micBlocked());
    c.setHidden(true); c.permission = "granted"; c.setHidden(false); await c.until(() => c.live().length === 1);
    assert.equal(c.w.Voice.micBlocked(), false);
    assert.equal(c.live().length, 1);
  } finally { c.close(); }
});

// ═══════════════════════════ neural voice playback ═══════════════════════════
test("audio is unlocked inside the boot key press and ONE element plays every Kokoro line (Safari rule)", async () => {
  const c = createConsole({ kokoro: "ready", ttsOk: true });
  try {
    await c.enter(); await c.until(() => c.playCalls.some(BLOB));
    assert.ok(c.playCalls.length >= 1 && SILENT.test(c.playCalls[0].src), "silent clip played inside the gesture to unlock audio");
    const unlockEl = c.playCalls[0].el;

    assert.ok(c.playCalls.filter(BLOB).length >= 1, "greeting went through /api/tts → neural audio");
    assert.deepEqual(c.spoken, [], "the system voice was NOT used");
    assert.ok(c.playCalls.every((p) => p.el === unlockEl), "every line reuses the unlocked element — a new Audio() would be blocked in Safari");
    assert.ok(c.fetched.some((u) => u.includes("/api/tts")));
  } finally { c.close(); }
});

test("long lines play as two chunks back-to-back on the same element", async () => {
  const c = createConsole({ kokoro: "ready", ttsOk: true });
  try {
    await c.enter(); await c.until(() => c.playCalls.some(BLOB));
    const el = c.playCalls[0].el;
    el.onended(); await sleep(500);                                // let the greeting finish first (new lines queue behind speech)
    c.fetched.length = 0; c.playCalls.length = 0;
    const long = "Good evening. All systems are nominal and every subsystem has reported in on schedule. Your calendar is clear for the next two hours and the weather outside is mild.";
    c.fromServer({ type: "jarvis_response", text: long }); await c.until(() => c.playCalls.length === 1);
    assert.equal(c.fetched.filter((u) => u.includes("/api/tts")).length, 2, "split into two requests so speech starts sooner");
    assert.equal(c.playCalls.length, 1, "first chunk is playing");
    el.onended(); await c.until(() => c.playCalls.length === 2);
    assert.equal(c.playCalls.length, 2, "second chunk follows");
    assert.ok(c.playCalls.every((p) => p.el === el));
    el.onended(); await sleep(100);
    assert.equal(c.spoken.length, 0);
  } finally { c.close(); }
});

test("if the browser still blocks audio: fall back to the system voice, say why, and re-arm on the next click", async () => {
  const c = createConsole({ kokoro: "ready", ttsOk: true });
  try {
    c.playImpl = (el) => (/^blob:/.test(el.src) && !c.allowReal) ? Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" })) : Promise.resolve();
    await c.enter(); await c.until(() => c.spoken.includes("Good evening. Online."));
    assert.ok(c.spoken.includes("Good evening. Online."), "greeting still got spoken (system voice)");
    assert.match(c.$("toasts").textContent, /click anywhere/i);

    c.allowReal = true; c.endSystemVoice();                        // the user clicks → audio unlocks
    c.w.document.dispatchEvent(new c.w.Event("click", { bubbles: true })); await sleep(200);
    c.playCalls.length = 0; c.spoken.length = 0;
    c.fromServer({ type: "jarvis_response", text: "Back on the neural voice." }); await c.until(() => c.playCalls.some(BLOB));
    assert.ok(c.playCalls.some(BLOB) && c.spoken.length === 0, "next line uses Kokoro again");
  } finally { c.close(); }
});

test("startup while Kokoro is still loading: the greeting WAITS for the neural voice instead of using the Mac voice", async () => {
  const c = createConsole({ kokoro: "loading", ttsOk: true });
  try {
    setTimeout(() => { c.kokoro = "ready"; }, 1300);              // model finishes loading shortly after the page opens
    await c.enter(); await sleep(400);
    assert.deepEqual(c.spoken, [], "not spoken with the system voice while the neural voice is loading");
    assert.match(c.$("state-hint").textContent, /LOADING VOICE/);
    await c.until(() => c.playCalls.some(BLOB));
    assert.deepEqual(c.spoken, [], "…and never with the system voice afterwards");
    assert.ok(c.playCalls.some(BLOB), "greeting played with Kokoro once it was ready");
  } finally { c.close(); }
});

test("with no neural voice available the greeting is spoken immediately (no waiting)", async () => {
  const c = createConsole({ kokoro: "unavailable" });
  try {
    await c.enter(); await c.until(() => c.spoken.includes("Good evening. Online."), 3000);
    assert.ok(c.spoken.includes("Good evening. Online."));
  } finally { c.close(); }
});

// ═══════════════════════════ connection & alerts while away ═══════════════════════════
test("coming back to a dropped connection reconnects immediately (once), instead of waiting out the back-off", async () => {
  const c = createConsole();
  try {
    await c.enter(); await sleep(300);
    const before = c.sockets.length;
    c.setHidden(true); c.socket.readyState = 3; c.socket.onclose(); await sleep(100);
    c.setHidden(false); await sleep(60);                            // far sooner than the 1 s back-off timer
    assert.equal(c.sockets.length, before + 1, "reconnected right away");
    await sleep(1400);
    assert.equal(c.sockets.length, before + 1, "the pending back-off timer did not open a second socket");
  } finally { c.close(); }
});

test("a timer alert while you're on another tab flashes the page title and notifies; the title is restored on return", async () => {
  const shown = [];
  class N { constructor(t, o) { shown.push(o.body); } static get permission() { return "granted"; } }
  const c = createConsole({ notification: N });
  try {
    await c.enter(); await sleep(300);
    const title = c.w.document.title;
    c.setHidden(true);
    c.fromServer({ type: "alert", kind: "timer", title: "TIMER", text: "Timer complete." }); await sleep(100);
    assert.match(c.w.document.title, /^● Timer complete/);
    assert.deepEqual(shown, ["Timer complete."]);
    c.setHidden(false); await sleep(50);
    assert.equal(c.w.document.title, title);
  } finally { c.close(); }
});

test("SYSTEMS tells you when Safari is the weak link (and says how to fix it)", async () => {
  const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const c = createConsole({ userAgent: SAFARI });
  try {
    await c.enter(); await sleep(200);
    c.$("btn-systems").click(); await c.until(() => /Safari/.test(c.$("diag-list").textContent));
    assert.match(c.$("diag-list").textContent, /Browser/);
    assert.match(c.$("diag-list").textContent, /Chrome or Edge/);
  } finally { c.close(); }
  const d = createConsole({ userAgent: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" });
  try {
    await d.enter(); await sleep(200);
    d.$("btn-systems").click(); await d.until(() => /Chromium-based/.test(d.$("diag-list").textContent));
    assert.match(d.$("diag-list").textContent, /Chromium-based/);
  } finally { d.close(); }
});
