# Plugins

Drop a `.js` file in this folder and restart JARVIS — it is loaded automatically.

```js
// plugins/coffee.js
module.exports = {
  name: "coffee",
  matches: (text) => /\bcoffee\b/i.test(text),
  execute: async (text, { ws, session }) => {
    // call any API, run any code …
    return "Brewing. Estimated four minutes.";   // spoken + shown. Return nothing for a silent plugin.
  },
};
```

| Field | Meaning |
|---|---|
| `name` | Unique id (required) |
| `matches(text)` | Return `true` to handle this message |
| `execute(text, ctx)` | `ctx.ws` is the WebSocket, `ctx.session` has `history` and `personality`. Return a string to answer |

Plugins run **before** built-in skills and the AI. A plugin that throws is logged and skipped.
`example.js` is a working template (say "plugin test").
