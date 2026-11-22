const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const native = require("../src/native-dictation");

test("native dictation helper source and module are present", () => {
  const source = path.join(__dirname, "..", "scripts", "macos-dictation.swift");
  assert.equal(fs.existsSync(source), true);
  assert.equal(typeof native.available, "function");
  assert.equal(typeof native.start, "function");
  assert.equal(typeof native.stop, "function");
  assert.equal(native.available(), false);
});
