const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");
const {
  loadPlugins,
  ensurePluginDirectory,
  readPluginDirectory,
} = require("../src/plugin-loader");

test("plugin loader creates a writable user directory recursively", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-plugin-"));
  const pluginDir = path.join(root, "nested", "plugins");

  assert.equal(ensurePluginDirectory(pluginDir), true);
  assert.equal(fs.statSync(pluginDir).isDirectory(), true);
  fs.removeSync(root);
});

test("plugin loader treats missing directories as empty and logs plugin failures", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-plugin-"));
  const missing = path.join(root, "missing");
  const pluginDir = path.join(root, "plugins");

  fs.ensureDirSync(pluginDir);
  fs.writeFileSync(path.join(pluginDir, "bad.js"), "throw new Error('broken plugin')");

  assert.deepEqual(readPluginDirectory(missing), []);
  assert.equal(loadPlugins(pluginDir).length, 0);
  fs.removeSync(root);
});

test("plugin loader treats an ENOTDIR plugin path as empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-plugin-"));
  const appAsar = path.join(root, "app.asar");
  fs.writeFileSync(appAsar, "not a real archive");

  assert.deepEqual(readPluginDirectory(path.join(appAsar, "plugins")), []);
  assert.deepEqual(loadPlugins(path.join(appAsar, "plugins")), []);
  fs.removeSync(root);
});

test("user plugins load and override bundled plugins with the same name", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-plugin-"));
  const bundled = path.join(root, "bundled");
  const user = path.join(root, "user");
  fs.ensureDirSync(bundled);
  fs.ensureDirSync(user);

  fs.writeFileSync(path.join(bundled, "example.js"), [
    "module.exports = {",
    "  name: 'example',",
    "  matches: () => true,",
    "  execute: async () => 'bundled'",
    "};",
  ].join("\n"));
  fs.writeFileSync(path.join(user, "example.js"), [
    "module.exports = {",
    "  name: 'example',",
    "  matches: () => true,",
    "  execute: async () => 'user'",
    "};",
  ].join("\n"));

  const plugins = loadPlugins([bundled, user]);
  assert.equal(plugins.length, 1);
  assert.equal(await plugins[0].execute(), "user");
  fs.removeSync(root);
});

test("invalid plugin modules are skipped without breaking other plugins", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-plugin-"));
  fs.writeFileSync(path.join(root, "invalid.js"), "module.exports = { name: 'invalid' };");
  fs.writeFileSync(path.join(root, "valid.js"), [
    "module.exports = {",
    "  name: 'valid',",
    "  execute: async () => 'ok'",
    "};",
  ].join("\n"));

  const plugins = loadPlugins(root);
  assert.deepEqual(plugins.map(plugin => plugin.name), ["valid"]);
  fs.removeSync(root);
});
