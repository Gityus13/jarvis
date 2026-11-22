const test = require("node:test");
const assert = require("node:assert/strict");
const native = require("../src/native-dictation");

test("native dictation reports unavailable safely outside macOS", () => {
  assert.equal(typeof native.available(), "boolean");
  assert.equal(native.available(), false);
  assert.deepEqual(native.status(), { ok: true, running: false, text: "", interim: "" });
});
