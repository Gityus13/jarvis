require("./helpers/env");
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os");
const { _internal: m } = require("../src/mac-control");

test("key combos", () => {
  const mod = process.platform === "darwin" ? "command" : "control";
  assert.deepEqual(m.parseCombo("cmd+c"), { key: "c", mods: [mod] });
  assert.deepEqual(m.parseCombo("command shift 4"), { key: "4", mods: [mod, "shift"] });
  assert.deepEqual(m.parseCombo("page down"), { key: "pagedown", mods: [] });
  assert.deepEqual(m.parseCombo("Control Alt Delete"), { key: "delete", mods: ["control", "alt"] });
  assert.deepEqual(m.parseCombo("f5"), { key: "f5", mods: [] });
  assert.throws(() => m.parseCombo("banana"), /don't know the key/);
});

test("AppleScript strings are escaped (no injection)", () => {
  assert.equal(m.asq('he said "hi" \\ $(rm -rf ~)\nnew'), 'he said \\"hi\\" \\\\ $(rm -rf ~)\\nnew');
});

test("file actions stay inside the home folder", () => {
  assert.equal(m.homePath("~/Desktop/Projects"), require("path").join(os.homedir(), "Desktop", "Projects"));
  assert.throws(() => m.homePath("~/../../etc"), /home folder/);
  assert.throws(() => m.homePath("/etc/passwd"), /home folder/);
});

test("only http(s) links open", () => {
  assert.equal(m.normUrl("youtube.com"), "https://youtube.com/");
  assert.throws(() => m.normUrl("file:///etc/passwd"), /http/);
  assert.throws(() => m.normUrl("javascript:alert(1)"), /http/);
});

test("natural dates for the calendar", () => {
  const w = (d, t) => m.parseWhen(d, t);
  assert.equal(w("today", "3pm").getHours(), 15);
  assert.equal(w("tomorrow", "15:30").getMinutes(), 30);
  assert.equal(w("friday", "9:00 AM").getDay(), 5);
  assert.equal(w("2026-11-02", "12:05 am").getHours(), 0);
});

test("app names", () => assert.equal(m.cleanAppName("the spotify app"), "spotify"));
