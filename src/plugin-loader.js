const path = require("path");
const fs   = require("fs-extra");

function loadPlugins(dir) {
  fs.ensureDirSync(dir);
  const plugins = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".js"))) {
    try {
      const p = path.join(dir, f);
      delete require.cache[require.resolve(p)];
      const plugin = require(p);
      if (plugin.name && typeof plugin.execute === "function") {
        plugins.push(plugin);
        console.log(`[Plugin] Loaded: ${plugin.name}`);
      }
    } catch (e) { console.error(`[Plugin] Failed ${f}: ${e.message}`); }
  }
  return plugins;
}

module.exports = { loadPlugins };
