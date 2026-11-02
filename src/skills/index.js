// Skill router — turns natural phrases into results WITHOUT the AI (fast, reliable, offline-safe).
// handle(text, ctx) → { say, card?, copy?, sensitive?, refresh? } | null (not a skill → AI takes over)

const web   = require("./web");
const local = require("./local");
const mac   = require("../mac-control");
const store = require("../store");
const tele  = require("../telemetry");

const who = () => process.env.USER_NAME || "sir";

// ── Phrase clean-up ───────────────────────────────────────────────────────────
function clean(input) {
  let s = String(input || "").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:hey |ok |okay )?(?:jarvis|friday|ultron)\b[\s,.:!-]*/i, "");
  for (let i = 0; i < 2; i++) s = s.replace(/^(?:please|can you|could you|would you|will you|i want you to|i need you to|i would like you to)\s+/i, "");
  s = s.replace(/\s+(?:please|for me|right now)$/i, "").replace(/[?!.,;:]+$/, "").trim();
  return s;
}
const lower = (s) => s.toLowerCase().replace(/[’]/g, "'");

const TOPICS = { tech: "tech", technology: "tech", hacker: "tech", programming: "tech", business: "business", finance: "business", economy: "business", financial: "business", science: "science", sport: "sport", sports: "sport", football: "sport", soccer: "sport" };

// ── The skill table (order matters: specific → general) ───────────────────────
const SKILLS = [
  { name: "briefing",
    match: (t) => /^(?:daily |morning |evening |full )?(?:brief(?:ing)?|brief me|status report|sitrep|catch me up|what did i miss|what's going on|whats going on)$/.test(t) || /^good (?:morning|afternoon|evening)(?: .*)?$/.test(t) ? {} : null,
    run: (a, ctx) => briefing(ctx) },

  { name: "setcity",
    match: (t, raw) => { const m = raw.match(/^(?:set|change|update)\s+(?:my\s+)?(?:home\s+)?(?:city|location|town)\s+(?:to\s+)?(.+)$/i) || raw.match(/^i (?:live|am living|am based) in\s+(.+)$/i); return m ? { city: m[1].trim() } : null; },
    run: (a) => web.setCity(a.city) },

  { name: "timers",  match: (t) => local.matchTimer(t),  run: (a) => local.timerSkill(a) },
  { name: "tasks",   match: (t, raw) => local.matchTasks(t, raw), run: (a) => local.tasksSkill(a) },
  { name: "notes",   match: (t, raw) => local.matchNotes(t, raw), run: (a) => local.notesSkill(a) },

  { name: "weather",
    match: (t) => {
      if (!/\b(?:weather|forecast|temperature|raining|rain|umbrella|snowing|snow|how (?:hot|cold|warm) is it)\b/.test(t)) return null;
      const c = t.match(/\b(?:in|for|at)\s+([a-z][a-z .'-]*?)(?:\s+(?:today|tomorrow|tonight|now|this week|right now))?$/);
      const city = c && !/^(?:the )?(?:morning|evening|afternoon|night|general|fact|case)$/.test(c[1]) ? c[1].trim() : null;
      return { city, when: /\btomorrow\b/.test(t) ? "tomorrow" : "today" };
    },
    run: (a) => web.weather(a) },

  { name: "news",
    match: (t) => { if (!/\b(?:news|headlines)\b/.test(t)) return null; const w = t.split(/\s+/).find((x) => TOPICS[x]); return { topic: w ? TOPICS[w] : "world" }; },
    run: (a) => web.news(a) },

  { name: "currency",
    match: (t) => {
      const m = t.replace(/^(?:how much is|what(?:'s| is)|convert)\s+/, "").match(/^(\d[\d,.]*)?\s*([a-z]+)\s+(?:to|in|into)\s+([a-z]+)$/);
      if (!m) return null;
      const from = web.curCode(m[2]), to = web.curCode(m[3]);
      return from && to ? { amount: m[1] ? parseFloat(m[1].replace(/,/g, "")) : 1, from, to } : null;
    },
    run: (a) => web.currency(a) },

  { name: "crypto",
    match: (t) => {
      const words = t.split(/[^a-z]+/).filter(Boolean);
      const coins = [...new Set(words.filter((w) => web.COINS[w]))];
      const gen = /\b(?:crypto|cryptocurrency|coins)\b/.test(t);
      if (!coins.length && !gen) return null;
      if (!(gen || /\b(?:price|worth|value|cost|how much|rate|trading|doing|market)\b/.test(t) || words.length <= 2)) return null;
      return { coins };
    },
    run: (a) => web.crypto(a) },

  { name: "translate",
    match: (t, raw) => {
      const L = Object.keys(web.LANGS).join("|");
      let m = raw.match(/^translate\s+["“]?(.+?)["”]?\s+(?:to|into)\s+([a-z-]+)$/i)
           || raw.match(/^how (?:do you|do i|would you|can i) say\s+["“]?(.+?)["”]?\s+in\s+([a-z-]+)$/i)
           || raw.match(new RegExp(`^what(?:'s| is)\\s+["“]?(.+?)["”]?\\s+in\\s+(${L})$`, "i"));
      return m && web.LANGS[m[2].toLowerCase()] ? { text: m[1].trim(), lang: m[2].toLowerCase() } : null;
    },
    run: (a) => web.translate(a) },

  { name: "define",
    match: (t) => { const m = t.match(/^(?:define|definition of|meaning of|what is the meaning of|what is the definition of)\s+([a-z-]+)$/) || t.match(/^what does ([a-z-]+) mean$/); return m ? { word: m[1] } : null; },
    run: (a) => web.define(a) },

  { name: "wiki",
    match: (t, raw) => {
      let m = raw.match(/^(?:wikipedia|wiki)\s+(?:for\s+)?(.+)$/i);
      if (m) return { query: m[1].trim() };
      m = raw.match(/^(?:who (?:is|was|were)|tell me about)\s+(.+)$/i);
      return m && m[1].split(/\s+/).length <= 5 ? { query: m[1].trim(), soft: true } : null;
    },
    run: (a) => web.wiki(a) },

  { name: "timein",
    match: (t) => { const m = t.match(/^(?:what(?:'s| is) )?(?:the )?(?:current )?time (?:is it )?in ([a-z][a-z .'-]+)$/) || t.match(/^what time is it in ([a-z][a-z .'-]+)$/); return m ? { city: m[1].trim() } : null; },
    run: (a) => web.timeIn(a) },

  { name: "units",  match: (t) => local.matchUnits(t), run: (a) => local.convert(a) },
  { name: "calc",   match: (t) => local.matchCalc(t),  run: (a) => local.calc(a) },

  { name: "system",
    match: (t) => {
      if (/^(?:what(?:'s| is)\s+)?(?:using|eating|hogging) (?:my )?(?:cpu|memory|ram)|^(?:top |running )?processes$|^what(?:'s| is) (?:running|using my (?:cpu|ram|memory))$/.test(t)) return { what: "procs" };
      if (/^(?:system|computer|mac|pc|machine) (?:status|stats|health|report|info)$|^(?:status|diagnostics?|how(?:'s| is) (?:my |the )?(?:system|computer|mac))$|^system$/.test(t)) return { what: "all" };
      if (/^(?:cpu|processor)(?: (?:usage|load|status))?$|^how(?:'s| is) (?:my )?cpu$/.test(t)) return { what: "cpu" };
      if (/^(?:memory|ram)(?: (?:usage|status))?$|^how much (?:memory|ram)(?: am i using| is (?:used|free))?$/.test(t)) return { what: "mem" };
      if (/^(?:disk|storage)(?: (?:usage|space|status))?$|^how much (?:disk|storage)(?: space)?(?: is (?:left|free|used))?$|^(?:disk|storage) space$/.test(t)) return { what: "disk" };
      if (/^(?:uptime|how long (?:has|have) (?:my |the )?(?:computer|mac|pc|system) been (?:on|up|running))$/.test(t)) return { what: "uptime" };
      return null;
    },
    run: (a) => local.systemSkill(a) },

  { name: "net",
    match: (t) => /^(?:am i online|my ip(?: address)?|what(?:'s| is) my (?:public |external )?ip(?: address)?|network (?:status|info|check)|internet (?:status|check)|check (?:my )?(?:internet|network|connection)|ping|speed check)$/.test(t) ? {} : null,
    run: () => web.netInfo() },

  { name: "music", match: (t) => local.matchMusic(t), run: (a) => local.musicSkill(a) },

  { name: "files",
    match: (t, raw) => { const m = raw.match(/^(?:find|locate|search for|where(?:'s| is))\s+(?:my |the |a )?(?:file|files|document|doc|pdf|image|photo|folder)s?\s+(?:named |called |with )?["“]?(.+?)["”]?$/i) || raw.match(/^(?:find|locate)\s+(?:file\s+)?["“]?([\w. -]+\.\w{1,5})["”]?$/i); return m ? { query: m[1].trim() } : null; },
    run: (a) => local.filesSkill(a) },

  { name: "password",
    match: (t) => { const m = t.match(/^(?:generate|make|create|give me)\s+(?:me\s+)?(?:a\s+)?(?:new\s+)?(?:strong\s+|secure\s+|random\s+)*password(?:\s+(?:of|with)\s+(\d+)(?:\s+(?:characters|chars|letters))?)?$/); return m ? { len: m[1] ? +m[1] : 20 } : null; },
    run: (a) => local.passwordSkill(a) },

  { name: "random", match: (t) => local.matchRandom(t), run: (a) => local.randomSkill(a) },

  { name: "date",
    match: (t) => /^(?:what(?:'s| is) )?(?:the |today's )?(?:date|day)(?: today| is it)?$|^what day is it(?: today)?$|^today's date$/.test(t) ? {} : null,
    run: () => local.dateSkill() },

  { name: "clipai",
    match: (t) => {
      const m = t.match(/^(summarize|summarise|explain|fix|proofread|rewrite|shorten|improve|translate)\s+(?:my |the |what(?:'s| is) on my )?(?:clipboard|copied text)(?:\s+(?:to|into|in)\s+([a-z]+))?$/);
      return m ? { op: m[1], lang: m[2] } : null;
    },
    run: (a, ctx) => clipAI(a, ctx) },

  { name: "help",
    match: (t) => /^(?:help|what can you do|commands|capabilities|features|show commands|list commands)$/.test(t) ? {} : null,
    run: () => ({ say: "Opening the command index.", card: { title: "COMMAND INDEX", sub: "Press Ctrl+K any time" }, ui: "palette" }) },
];

// ── Clipboard AI ──────────────────────────────────────────────────────────────
async function clipAI({ op, lang }, ctx) {
  const text = (await mac.readClipboard()).trim();
  if (!text) return { say: "Your clipboard is empty." };
  if (!ctx.ai) throw new Error("The AI isn't available.");
  const task = {
    summarize: "Summarize the text in 2-4 concise sentences.", summarise: "Summarize the text in 2-4 concise sentences.",
    explain: "Explain the text clearly and briefly.", fix: "Fix spelling, grammar and punctuation. Keep the meaning and tone. Return ONLY the corrected text.",
    proofread: "Fix spelling, grammar and punctuation. Return ONLY the corrected text.", rewrite: "Rewrite the text to be clearer and more professional. Return ONLY the rewritten text.",
    shorten: "Shorten the text, keeping the key points. Return ONLY the shortened text.", improve: "Improve the writing. Return ONLY the improved text.",
    translate: `Translate the text into ${lang || "English"}. Return ONLY the translation.`,
  }[op];
  const out = (await ctx.ai(`You are a precise text tool. ${task} No preamble, no quotes.`, text.slice(0, 6000))).trim();
  if (!out) throw new Error("The AI returned nothing.");
  let copied = false;
  if (!["explain", "summarize", "summarise"].includes(op)) { try { await mac.setClipboard(out); copied = true; } catch {} }
  return { say: copied ? "Done. The result is on your clipboard." : out.slice(0, 280), card: { title: `CLIPBOARD · ${op.toUpperCase()}`, body: out.slice(0, 1200) }, sensitive: false };
}

// ── Briefing ──────────────────────────────────────────────────────────────────
async function briefing(ctx) {
  const now = new Date(), h = now.getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const parts = [`${part}, ${who()}.`, `It's ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} on ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`];
  const rows = [["TIME", now.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })]];

  const [w, n, cal] = await Promise.allSettled([
    web.weatherData(),
    web.headlines("world", 3),
    process.platform === "darwin" ? mac.executeMacCommand({ action: "get_calendar" }) : Promise.resolve(null),
  ]);

  if (w.status === "fulfilled") {
    const x = w.value, t = x.days[0];
    parts.push(`${x.place}: ${x.now.t} degrees and ${x.now.text.toLowerCase()}, high of ${t.hi}${(t.rain ?? 0) >= 40 ? `, ${t.rain} percent chance of rain` : ""}.`);
    rows.push(["WEATHER", `${x.place} · ${x.now.t}${x.unit} · ${x.now.text} · H${t.hi} L${t.lo}`]);
  } else rows.push(["WEATHER", "offline"]);

  const db = store.db();
  const open = db.tasks.filter((t) => !t.done);
  parts.push(open.length ? `You have ${open.length} open ${open.length === 1 ? "task" : "tasks"}${open[0] ? `, starting with ${open[0].text}` : ""}.` : "Your task list is clear.");
  rows.push(["TASKS", open.length ? `${open.length} open · ${open.slice(0, 3).map((t) => t.text).join(" · ")}` : "clear"]);

  if (db.reminders.length) {
    const next = db.reminders.slice().sort((a, b) => a.at - b.at)[0];
    parts.push(`Next up: ${next.label || next.kind} in ${local.fmtDur(next.at - Date.now())}.`);
    rows.push(["NEXT", `${next.label || next.kind} · ${local.fmtDur(next.at - Date.now())}`]);
  }

  if (cal.status === "fulfilled" && cal.value && !/No events|denied|access/i.test(String(cal.value))) {
    const first = String(cal.value).split("\n").filter(Boolean)[0];
    if (first) { parts.push(`On your calendar: ${first.replace(/•\s*/, "")}.`); rows.push(["CALENDAR", String(cal.value).split("\n").filter(Boolean).slice(0, 3).join(" · ")]); }
  }

  const bat = tele.snapshot().battery;
  if (bat && bat.pct <= 30 && !/charg|plug/.test(bat.state)) { parts.push(`Battery is at ${bat.pct} percent.`); rows.push(["BATTERY", `${bat.pct}% · ${bat.state}`]); }

  if (n.status === "fulfilled" && n.value.length) {
    parts.push(`Top headline: ${n.value[0].t.replace(/[.!?]+$/, "")}.`);
    n.value.forEach((x, i) => rows.push([i === 0 ? "HEADLINES" : "", x.t]));
  }
  return { say: parts.join(" "), card: { title: "DAILY BRIEFING", sub: `${part}, ${who()}`, rows } };
}

// ── Public API ────────────────────────────────────────────────────────────────
/** → result | null. Errors become friendly results; "soft" skills fall through to the AI instead. */
async function handle(input, ctx = {}) {
  const raw = clean(input);
  if (!raw) return null;
  const t = lower(raw);
  for (const sk of SKILLS) {
    let args;
    try { args = sk.match(t, raw); } catch { args = null; }
    if (!args) continue;
    try {
      const r = await sk.run(args, ctx);
      if (r) return { skill: sk.name, ...r };
    } catch (e) {
      if (args.soft) return null;
      return { skill: sk.name, say: e.message || "That didn't work.", error: true, card: { title: sk.name.toUpperCase(), sub: e.message, tone: "bad" } };
    }
  }
  return null;
}

module.exports = { handle, SKILLS: SKILLS.map((s) => s.name), briefing, clean };
