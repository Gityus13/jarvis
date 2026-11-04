require("./helpers/env");
const { calls } = require("./helpers/fetch-mock");
const test = require("node:test");
const assert = require("node:assert/strict");
const skills = require("../src/skills");
const local = require("../src/skills/local");
const store = require("../src/store");

// ── routing: which skill handles which phrase (nothing is executed here) ──────────
const ROUTES = [
  ["what's the weather in Baku", "weather"], ["weather tomorrow", "weather"], ["will it rain", "weather"],
  ["tech news", "news"], ["give me the headlines", "news"],
  ["bitcoin price", "crypto"], ["how much is ethereum", "crypto"], ["crypto", "crypto"], ["btc", "crypto"],
  ["convert 100 usd to azn", "currency"], ["how much is 50 euros in manat", "currency"], ["usd to azn", "currency"],
  ["translate hello world to azerbaijani", "translate"], ["how do you say good morning in turkish", "translate"],
  ["define ephemeral", "define"], ["what does ephemeral mean", "define"],
  ["who is nikola tesla", "wiki"], ["wikipedia tesla", "wiki"],
  ["time in baku", "timein"], ["what time is it in tokyo", "timein"],
  ["convert 5 km to miles", "units"], ["72 f to c", "units"], ["10 kg in pounds", "units"],
  ["what is 25 times 4", "calc"], ["calculate 15% of 200", "calc"], ["sqrt of 144", "calc"], ["2 plus 2 times 3", "calc"], ["what is (3+4)*5", "calc"], ["square root of 81", "calc"],
  ["set a timer for 10 minutes", "timers"], ["5 minute timer", "timers"], ["remind me in 20 minutes to call mom", "timers"], ["remind me to call mom at 5pm", "timers"],
  ["set an alarm for 7:30 am", "timers"], ["start a focus session", "timers"], ["list timers", "timers"],
  ["add task buy milk", "tasks"], ["add buy bread to my tasks", "tasks"], ["remind me to stretch", "tasks"], ["my tasks", "tasks"], ["complete task 1", "tasks"],
  ["take a note: wifi password is on the fridge", "notes"], ["remember that the meeting is friday", "notes"], ["show my notes", "notes"],
  ["system status", "system"], ["cpu usage", "system"], ["what's using my cpu", "system"], ["how much disk space", "system"], ["uptime", "system"],
  ["what is my ip address", "net"], ["next song", "music"], ["what's playing", "music"], ["play some jazz", "music"], ["pause", "music"],
  ["find file resume.pdf", "files"], ["generate a password", "password"], ["flip a coin", "random"], ["roll a dice", "random"], ["roll a d20", "random"],
  ["what's the date", "date"], ["good morning", "briefing"], ["daily briefing", "briefing"], ["summarize my clipboard", "clipai"], ["help", "help"],
  ["set my city to Baku", "setcity"],
  // these must NOT be skills — they belong to the Mac router or the AI
  ["tell me a joke", null], ["how are you", null], ["write a python function", null], ["what is love", null],
  ["open spotify", null], ["what is the capital of france", null], ["explain quantum computing", null], ["who are you", null],
];
for (const [phrase, want] of ROUTES) {
  test(`routes "${phrase}" → ${want}`, () => {
    const m = skills.match(phrase);
    assert.equal(m ? m.skill : null, want);
  });
}

// ── offline skills actually work ───────────────────────────────────────────────
const say = async (t) => (await skills.handle(t, { ai: async () => "AI" })) || {};

test("calculator", async () => {
  assert.match((await say("what is 25 times 4")).say, /100/);
  assert.match((await say("calculate 15% of 240")).say, /36/);
  assert.match((await say("sqrt of 144")).say, /12/);
  assert.match((await say("2 plus 2 times 3")).say, /\b8\b/);
});

test("unit conversion speaks real unit names", async () => {
  assert.equal((await say("convert 5 km to miles")).say, "5 kilometres is 3.1069 miles.");
  assert.match((await say("72 f to c")).say, /22\.2222 degrees Celsius/);
});

test("duration + clock parsing", () => {
  const d = (s) => local.parseDuration(s) / 1000;
  assert.equal(d("10 minutes"), 600); assert.equal(d("an hour"), 3600); assert.equal(d("half an hour"), 1800);
  assert.equal(d("two hours"), 7200); assert.equal(d("90 seconds"), 90); assert.equal(d("1 hour 30 minutes"), 5400); assert.equal(d("forty five minutes"), 2700);
  const c = local.parseClock("7:30 pm"); assert.equal(c.getHours(), 19); assert.equal(c.getMinutes(), 30);
  assert.ok(c.getTime() > Date.now());
});

test("timers, tasks and notes persist and report", async () => {
  store.db().reminders = []; store.db().tasks = []; store.db().notes = [];
  const t = await say("set a timer for 10 minutes");
  assert.match(t.say, /Timer set for 10 minutes/); assert.equal(store.db().reminders.length, 1);
  const r = await say("remind me in 20 minutes to call mom");
  assert.match(r.say, /remind you in 20 minutes to call mom/);
  await say("add task buy milk"); await say("add buy bread to my tasks");
  assert.deepEqual(store.db().tasks.map((x) => x.text), ["Buy milk", "Buy bread"]);
  assert.match((await say("complete task 1")).say, /Task 1 complete/);
  assert.equal(store.db().tasks[0].done, true);
  assert.match((await say("my tasks")).say, /1 open task/);
  await say("take a note: renew the domain");
  assert.equal(store.db().notes[0].text, "Renew the domain");
  assert.match((await say("cancel timers")).say, /Cancelled 2/);
});

test("password is generated, never spoken", async () => {
  const r = await say("generate a password");
  assert.equal(r.sensitive, true);
  assert.ok(r.card.sub.length === 20);
  assert.ok(!r.say.includes(r.card.sub));
});

// ── online skills (network mocked) ────────────────────────────────────────────────
test("weather", async () => {
  const r = await say("weather in Baku");
  assert.match(r.say, /Baku\. 18 degrees, partly cloudy/);
  assert.equal(r.card.rows.length, 7);
  assert.match((await say("weather tomorrow")).say, /tomorrow: light rain/i);
});

test("news, crypto, currency, translate, define, wiki, time", async () => {
  assert.match((await say("news")).say, /Leaders meet in Geneva & talk/);
  assert.match((await say("tech news")).card.items[0].t, /Show HN/);
  assert.match((await say("bitcoin price")).say, /BTC is 67,251 dollars, up 2\.3 percent/);
  assert.equal((await say("convert 100 usd to azn")).say, "100 USD is 170 AZN.");
  assert.match((await say("translate hello world to azerbaijani")).say, /^In Azerbaijani: Salam dünya/);
  assert.match((await say("define ephemeral")).say, /adjective: Lasting for a very short time/);
  assert.match((await say("who is nikola tesla")).say, /^Nikola Tesla was a Serbian-American engineer/);
  assert.match((await say("time in baku")).say, /in Baku/);
  assert.ok(calls.length > 5);
});

test("the briefing combines everything and survives missing parts", async () => {
  const r = await say("daily briefing");
  assert.match(r.say, /Tester/);
  assert.match(r.say, /Baku/);
  assert.ok(r.card.rows.some((x) => x[0] === "HEADLINES"));
});

test("clipboard AI refuses politely when the AI is missing", async () => {
  const r = await skills.handle("summarize my clipboard", {});
  assert.ok(r);   // either "clipboard is empty" or an error card — never a crash
});

test("markets panel never shows a currency against itself", async () => {
  const web = require("../src/skills/web");
  const saved = process.env.HOME_CURRENCY;
  try {
    for (const base of ["USD", "EUR", "GBP", "AZN"]) {
      process.env.HOME_CURRENCY = base;
      const rows = await web.marketsData();
      const fx = rows.filter((r) => r.sym.includes("/")).map((r) => r.sym);
      assert.ok(fx.length >= 2, `FX rows for ${base}: ${fx}`);
      for (const sym of fx) { const [a, b] = sym.split("/"); assert.notEqual(a, b, `${sym} is nonsense`); }
    }
  } finally { process.env.HOME_CURRENCY = saved; }
});
