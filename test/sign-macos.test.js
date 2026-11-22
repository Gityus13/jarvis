const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("macOS ad-hoc signing hook exists and is a valid module", () => {
  const hook = path.join(__dirname, "..", "scripts", "sign-macos.js");
  assert.equal(fs.existsSync(hook), true);
  assert.equal(typeof require(hook), "function");
});
