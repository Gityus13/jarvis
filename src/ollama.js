const fetch = require("node-fetch");
const BASE  = process.env.OLLAMA_URL || "http://localhost:11434";

async function* streamOllama(model, systemPrompt, messages) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      stream: true,
      options: { temperature: 0.7, top_p: 0.9, num_predict: 2048 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);

  let buf = "";
  for await (const chunk of res.body) {
    buf += chunk.toString("utf8");
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const ln of lines) {
      if (!ln.trim()) continue;
      try {
        const p = JSON.parse(ln);
        if (p.message?.content) yield p.message.content;
        if (p.done) return;
        if (p.error) throw new Error(p.error);
      } catch (e) {
        if (e.message && !e.message.startsWith("Unexpected token")) throw e;
      }
    }
  }
  if (buf.trim()) {
    try { const p = JSON.parse(buf); if (p.message?.content) yield p.message.content; } catch {}
  }
}

async function checkOllama(model) {
  try {
    const res  = await fetch(`${BASE}/api/tags`);
    const data = await res.json();
    const models = data.models || [];
    const base = model.split(":")[0].toLowerCase();
    const found = models.some(m => m.name === model || m.name.toLowerCase().startsWith(base));
    return { running: true, modelFound: found, available: models.map(m => m.name) };
  } catch {
    return { running: false, modelFound: false, available: [] };
  }
}

module.exports = { streamOllama, checkOllama };
