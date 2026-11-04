require("./helpers/env");
process.env.KOKORO_STALL_MS = "400";
process.env.KOKORO_SYNTH_MS = "300";
process.env.KOKORO_RETRY_MS = "3600000";
const test = require("node:test");
const assert = require("node:assert/strict");
const kokoro = require("../src/kokoro");

const wav = () => new Uint8Array(100).buffer;
const engine = (generate) => ({ voices: { bm_george: 1, bf_emma: 1, am_onyx: 1, am_michael: 1 }, generate });
const importer = (from_pretrained) => async (name) => {
  if (name === "@huggingface/transformers") return { env: {} };
  if (name === "kokoro-js") return { KokoroTTS: { from_pretrained } };
  throw new Error("unexpected import " + name);
};
const notInstalled = () => { const e = new Error("Cannot find package 'kokoro-js' imported from src/kokoro.js"); e.code = "ERR_MODULE_NOT_FOUND"; throw e; };

test("not installed → unavailable with the exact fix", async () => {
  kokoro._reset(async () => notInstalled());
  assert.equal(kokoro.status(), "idle");
  await kokoro.load();
  const i = kokoro.info();
  assert.equal(i.state, "unavailable"); assert.match(i.error, /not installed/); assert.match(i.hint, /npm i kokoro-js/);
});

test("KOKORO=off disables it", async () => {
  kokoro._reset(importer(async () => engine(async () => ({ toWav: wav }))));
  process.env.KOKORO = "off";
  await kokoro.load();
  delete process.env.KOKORO;
  assert.equal(kokoro.status(), "unavailable"); assert.match(kokoro.info().error, /disabled/);
});

test("happy path: progress → warm-up → ready → speaks", async () => {
  const seen = [];
  kokoro._reset(importer(async (model, o) => {
    o.progress_callback({ status: "progress", file: "model.onnx", loaded: 50e6, total: 100e6 });
    seen.push(kokoro.info().pct);
    o.progress_callback({ status: "progress", file: "model.onnx", loaded: 100e6, total: 100e6 });
    return engine(async (text, opts) => { seen.push(opts.voice); return { toWav: wav }; });
  }));
  assert.equal(kokoro.status(), "idle");
  const p = kokoro.load();
  assert.equal(kokoro.status(), "loading");
  await p;
  const i = kokoro.info();
  assert.equal(i.state, "ready"); assert.equal(i.pct, 100); assert.equal(typeof i.warmMs, "number");
  assert.equal(seen[0], 50);                                   // progress was visible while loading
  const buf = await kokoro.synth("Hello there", "FRIDAY");
  assert.ok(Buffer.isBuffer(buf)); assert.equal(seen[seen.length - 1], "bf_emma");   // per-personality voice
});

test("bad voice override in .env falls back to the default voice", async () => {
  let voice;
  kokoro._reset(importer(async () => engine(async (t, o) => { voice = o.voice; return { toWav: wav }; })));
  process.env.KOKORO_VOICE_ULTRON = "not_a_voice"; process.env.KOKORO_VOICE_FRIDAY = "am_michael";
  await kokoro.load();
  await kokoro.synth("x", "ULTRON"); assert.equal(voice, "am_onyx");
  await kokoro.synth("x", "FRIDAY"); assert.equal(voice, "am_michael");
  delete process.env.KOKORO_VOICE_ULTRON; delete process.env.KOKORO_VOICE_FRIDAY;
});

test("model loads but can't run → NOT ready, with a hint", async () => {
  kokoro._reset(importer(async () => engine(async () => { throw new Error("Non-zero status code returned while running Slice node"); })));
  await kokoro.load();
  assert.equal(kokoro.status(), "unavailable"); assert.match(kokoro.info().hint, /kokoro-test/);
});

test("a stalled download gives up instead of showing 'loading' forever", async () => {
  kokoro._reset(importer(() => new Promise(() => {})));
  const t0 = Date.now();
  await kokoro.load();
  assert.ok(Date.now() - t0 < 3000);
  const i = kokoro.info();
  assert.equal(i.state, "unavailable"); assert.match(i.error, /stalled/); assert.match(i.hint, /HF_ENDPOINT/); assert.equal(i.retries, 1);   // retry scheduled
});

test("network error → hint mentions the mirror", async () => {
  kokoro._reset(importer(async () => { throw new TypeError("fetch failed"); }));
  await kokoro.load();
  assert.match(kokoro.info().hint, /huggingface\.co/);
});

test("ONNX runtime failure → hint mentions Node 22", async () => {
  kokoro._reset(importer(async () => { throw new Error("dlopen(onnxruntime_binding.node): image not found"); }));
  await kokoro.load();
  assert.match(kokoro.info().hint, /Node 22/);
});

test("a hung generation times out; 3 failures in a row switch to the system voice", async () => {
  let n = 0;
  kokoro._reset(importer(async () => engine(async () => { if (++n === 1) return { toWav: wav }; return new Promise(() => {}); })));   // warm-up ok, then hangs
  await kokoro.load(); assert.equal(kokoro.status(), "ready");
  for (let i = 0; i < 3; i++) await assert.rejects(kokoro.synth("hi"), /timed out/);
  assert.equal(kokoro.status(), "unavailable"); assert.match(kokoro.info().error, /keeps failing/);
});

test("one failed line does not disable Kokoro", async () => {
  let n = 0;
  kokoro._reset(importer(async () => engine(async () => { n++; if (n === 2) throw new Error("boom"); return { toWav: wav }; })));
  await kokoro.load();
  await assert.rejects(kokoro.synth("a"), /boom/);
  assert.equal(kokoro.status(), "ready");
  assert.ok(Buffer.isBuffer(await kokoro.synth("b")));      // and it recovers
});
