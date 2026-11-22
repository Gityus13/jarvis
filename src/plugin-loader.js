const path = require("path");
const fs   = require("fs-extra");

function ensurePluginDirectory(dir) {
  if (!dir) return false;
  try {
    fs.ensureDirSync(dir);
    fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
    return true;
  } catch (e) {
    console.error(`[Plugin] Cannot prepare plugin directory ${dir}: ${e.message}`);
    return false;
  }
}

function readPluginDirectory(dir) {
  if (!dir) return [];
  try {
    return fs.readdirSync(dir).filter(f => f.endsWith(".js"));
  } catch (e) {
    if (!["ENOENT", "ENOTDIR"].includes(e.code)) {
      console.error(`[Plugin] Cannot read plugin directory ${dir}: ${e.message}`);
    }
    return [];
  }
}

function loadPlugins(directories, options = {}) {
  const dirs = (Array.isArray(directories) ? directories : [directories])
    .filter(Boolean);
  const uniqueDirs = [...new Set(dirs.map(dir => path.resolve(dir)))];
  const writableDirs = options.ensureDirs
    ? (Array.isArray(options.ensureDirs) ? options.ensureDirs : [options.ensureDirs])
    : [];

  for (const dir of writableDirs) ensurePluginDirectory(dir);

  const plugins = [];
  const byName = new Map();

  for (const dir of uniqueDirs) {
    for (const f of readPluginDirectory(dir)) {
      try {
        const p = path.join(dir, f);
        delete require.cache[require.resolve(p)];
        const plugin = require(p);
        if (plugin.name && typeof plugin.execute === "function") {
          byName.set(plugin.name, plugin);
          console.log(`[Plugin] Loaded: ${plugin.name}`);
        } else {
          console.error(`[Plugin] Failed ${f}: plugin must export name and execute`);
        }
      } catch (e) {
        console.error(`[Plugin] Failed ${f}: ${e.message}`);
      }
    }
  }

  plugins.push(...byName.values());
  return plugins;
}

module.exports = { loadPlugins, ensurePluginDirectory, readPluginDirectory };
