// Example plugin — say "plugin test" to see it work. Copy this file to make your own.
//
//   name     unique id (shown in /api/plugins and the server log)
//   matches  (text) → true when this plugin should handle what you said (optional: omit to never auto-match)
//   execute  async (text, { ws, session }) → string to speak/show, or falsy for "no reply"
//
// Plugins run BEFORE the built-in skills and the AI, so they can override anything.
module.exports = {
  name: "example",
  matches: (text) => /^plugin test$/i.test(text.trim()),
  execute: async () => "Plugin system online.",
};
