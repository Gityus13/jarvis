// Web skills — every service here is FREE and needs NO API key:
//   Open-Meteo (weather + geocoding) · ipwho.is · CoinGecko · open.er-api.com (FX) ·
//   BBC RSS + Hacker News · Wikipedia · dictionaryapi.dev · MyMemory (translate)

const { http, enc } = require("../net");
const store = require("../store");

const IMPERIAL = /^imperial$/i.test(process.env.UNITS || "");
const deg = IMPERIAL ? "°F" : "°C";
const windU = IMPERIAL ? "mph" : "km/h";
const r0 = (n) => Math.round(Number(n));

const WMO = {
  0: "Clear", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Freezing fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Rain showers", 81: "Rain showers", 82: "Violent showers", 85: "Snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm, hail", 99: "Thunderstorm, hail",
};
const wmo = (c) => WMO[c] || "Unknown";

// ── Places ────────────────────────────────────────────────────────────────────
async function place(name) {
  const g = await http(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(name)}&count=1&language=en&format=json`, { ttl: 864e5 });
  const r = g.results && g.results[0];
  if (!r) throw new Error(`I couldn't find a place called ${name}.`);
  return { name: r.name, country: r.country || "", lat: r.latitude, lon: r.longitude, tz: r.timezone };
}

async function home() {
  const city = store.db().settings.homeCity || process.env.HOME_CITY;
  if (city) return place(city);
  const ip = await http("https://ipwho.is/", { ttl: 36e5 });
  if (ip.success === false) throw new Error("I couldn't work out where you are. Say: set my city to Baku.");
  return { name: ip.city, country: ip.country, lat: ip.latitude, lon: ip.longitude, tz: ip.timezone && ip.timezone.id };
}

// ── Weather ───────────────────────────────────────────────────────────────────
async function forecast(p) {
  const units = IMPERIAL ? "&temperature_unit=fahrenheit&wind_speed_unit=mph" : "&wind_speed_unit=kmh";
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=4${units}`;
  return http(u, { ttl: 6e5 });
}

function dayName(iso, i) {
  if (i === 0) return "Today";
  if (i === 1) return "Tomorrow";
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

/** Structured weather for the HUD panel */
async function weatherData(cityName) {
  const p = cityName ? await place(cityName) : await home();
  const f = await forecast(p);
  const c = f.current, d = f.daily;
  return {
    place: p.name, country: p.country,
    now: { t: r0(c.temperature_2m), feels: r0(c.apparent_temperature), hum: r0(c.relative_humidity_2m), wind: r0(c.wind_speed_10m), text: wmo(c.weather_code), code: c.weather_code, day: c.is_day === 1 },
    days: d.time.map((t, i) => ({ d: dayName(t, i), hi: r0(d.temperature_2m_max[i]), lo: r0(d.temperature_2m_min[i]), text: wmo(d.weather_code[i]), rain: d.precipitation_probability_max[i] })),
    unit: deg,
  };
}

async function weather({ city, when } = {}) {
  const w = await weatherData(city);
  const t = w.days[0], tm = w.days[1];
  let say;
  if (when === "tomorrow") {
    say = `${w.place} tomorrow: ${tm.text.toLowerCase()}, high ${tm.hi}, low ${tm.lo}, ${tm.rain ?? 0} percent chance of rain.`;
  } else {
    say = `${w.place}. ${w.now.t} degrees, ${w.now.text.toLowerCase()}, feels like ${w.now.feels}. Wind ${w.now.wind} ${IMPERIAL ? "miles per hour" : "kilometres per hour"}. ` +
          `Today's high ${t.hi}, low ${t.lo}, ${t.rain ?? 0} percent chance of rain.`;
  }
  return {
    say,
    card: {
      title: `WEATHER · ${w.place.toUpperCase()}`, sub: `${w.now.t}${deg} · ${w.now.text}`,
      rows: [["FEELS", `${w.now.feels}${deg}`], ["HUMIDITY", `${w.now.hum}%`], ["WIND", `${w.now.wind} ${windU}`],
             ...w.days.map((x) => [x.d.toUpperCase(), `${x.hi}${deg} / ${x.lo}${deg} · ${x.text} · ${x.rain ?? 0}%`])],
    },
  };
}

// ── News ──────────────────────────────────────────────────────────────────────
const FEEDS = {
  world:    "https://feeds.bbci.co.uk/news/world/rss.xml",
  business: "https://feeds.bbci.co.uk/news/business/rss.xml",
  science:  "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
  sport:    "https://feeds.bbci.co.uk/sport/rss.xml",
};

const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function parseRSS(xml, n) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && out.length < n) {
    const t = (m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    const l = (m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1];
    if (t) out.push({ t: decode(t), u: l ? decode(l) : null });
  }
  return out;
}

async function headlines(topic = "world", n = 6) {
  if (topic === "tech") {
    const j = await http(`https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=${n}`, { ttl: 6e5 });
    return (j.hits || []).map((h) => ({ t: h.title, u: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, m: `${h.points} pts` }));
  }
  const xml = await http(FEEDS[topic] || FEEDS.world, { ttl: 6e5, json: false });
  return parseRSS(xml, n);
}

async function news({ topic = "world" } = {}) {
  const items = await headlines(topic, 6);
  if (!items.length) throw new Error("No headlines came back.");
  const label = { world: "WORLD", tech: "TECH · HACKER NEWS", business: "BUSINESS", science: "SCIENCE", sport: "SPORT" }[topic] || "WORLD";
  return {
    say: `Top ${label.toLowerCase().split(" ")[0]} headlines. ` + items.slice(0, 3).map((x, i) => `${i + 1}. ${x.t.replace(/[.!?]+$/, "")}.`).join(" "),
    card: { title: `NEWS · ${label}`, items: items.map((x) => ({ t: x.t, u: x.u, m: x.m })) },
  };
}

// ── Markets ───────────────────────────────────────────────────────────────────
const COINS = {
  bitcoin: ["bitcoin", "BTC"], btc: ["bitcoin", "BTC"], ethereum: ["ethereum", "ETH"], eth: ["ethereum", "ETH"], ether: ["ethereum", "ETH"],
  solana: ["solana", "SOL"], sol: ["solana", "SOL"], dogecoin: ["dogecoin", "DOGE"], doge: ["dogecoin", "DOGE"],
  xrp: ["ripple", "XRP"], ripple: ["ripple", "XRP"], bnb: ["binancecoin", "BNB"], cardano: ["cardano", "ADA"], ada: ["cardano", "ADA"],
  litecoin: ["litecoin", "LTC"], ltc: ["litecoin", "LTC"], toncoin: ["the-open-network", "TON"], ton: ["the-open-network", "TON"],
  tron: ["tron", "TRX"], polkadot: ["polkadot", "DOT"], avalanche: ["avalanche-2", "AVAX"], chainlink: ["chainlink", "LINK"],
};

const money = (n) => (n >= 100 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : n >= 1 ? n.toFixed(2) : n.toFixed(4));

async function coinPrices(ids) {
  const j = await http(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`, { ttl: 12e4 });
  return j;
}

async function crypto({ coins } = {}) {
  const list = (coins && coins.length ? coins : ["bitcoin", "ethereum", "solana"]).map((c) => COINS[c] || null).filter(Boolean);
  if (!list.length) throw new Error("I don't recognise that coin.");
  const j = await coinPrices(list.map((x) => x[0]));
  const rows = list.map(([id, sym]) => ({ sym, p: j[id] && j[id].usd, ch: j[id] && j[id].usd_24h_change })).filter((x) => x.p != null);
  if (!rows.length) throw new Error("No price data came back.");
  return {
    say: rows.map((x) => `${x.sym} is ${money(x.p)} dollars, ${x.ch >= 0 ? "up" : "down"} ${Math.abs(x.ch || 0).toFixed(1)} percent today.`).join(" "),
    card: { title: "CRYPTO · USD", rows: rows.map((x) => [x.sym, `$${money(x.p)}  ${x.ch >= 0 ? "▲" : "▼"} ${Math.abs(x.ch || 0).toFixed(2)}%`]) },
  };
}

const CUR = {
  dollar: "USD", dollars: "USD", usd: "USD", buck: "USD", bucks: "USD", euro: "EUR", euros: "EUR", eur: "EUR",
  manat: "AZN", manats: "AZN", azn: "AZN", lira: "TRY", liras: "TRY", try: "TRY", ruble: "RUB", rubles: "RUB", rub: "RUB",
  pound: "GBP", pounds: "GBP", gbp: "GBP", yen: "JPY", jpy: "JPY", yuan: "CNY", cny: "CNY", rmb: "CNY",
  rupee: "INR", rupees: "INR", inr: "INR", franc: "CHF", chf: "CHF", dirham: "AED", aed: "AED", tenge: "KZT", kzt: "KZT",
  lari: "GEL", gel: "GEL", won: "KRW", krw: "KRW", cad: "CAD", aud: "AUD", pln: "PLN", sek: "SEK", nok: "NOK", uah: "UAH", hryvnia: "UAH",
};
const curCode = (w) => CUR[String(w).toLowerCase()] || null;

async function rates() {
  const j = await http("https://open.er-api.com/v6/latest/USD", { ttl: 36e5 });
  if (!j.rates) throw new Error("Exchange rates are unavailable.");
  return j.rates;
}

async function currency({ amount = 1, from, to }) {
  const R = await rates();
  if (!R[from] || !R[to]) throw new Error(`I don't have rates for ${!R[from] ? from : to}.`);
  const out = (amount / R[from]) * R[to];
  const f = (n) => n.toLocaleString("en-US", { maximumFractionDigits: n < 10 ? 4 : 2 });
  return { say: `${f(amount)} ${from} is ${f(out)} ${to}.`, card: { title: "CURRENCY", sub: `${f(amount)} ${from} → ${f(out)} ${to}`, rows: [["RATE", `1 ${from} = ${f(R[to] / R[from])} ${to}`]] } };
}

/** Rows for the HUD markets panel */
async function marketsData() {
  const base = (process.env.HOME_CURRENCY || "AZN").toUpperCase();
  const [c, R] = await Promise.allSettled([coinPrices(["bitcoin", "ethereum", "solana"]), rates()]);
  const rows = [];
  if (c.status === "fulfilled") {
    for (const [id, sym] of [["bitcoin", "BTC"], ["ethereum", "ETH"], ["solana", "SOL"]]) {
      if (c.value[id]) rows.push({ sym, p: "$" + money(c.value[id].usd), ch: c.value[id].usd_24h_change });
    }
  }
  if (R.status === "fulfilled" && R.value[base]) {
    const r = R.value;
    rows.push({ sym: `USD/${base}`, p: r[base].toFixed(3), ch: null });
    if (r.EUR) rows.push({ sym: `EUR/${base}`, p: (r[base] / r.EUR).toFixed(3), ch: null });
  }
  if (!rows.length) throw new Error("offline");
  return rows;
}

// ── Translate / dictionary / wiki ─────────────────────────────────────────────
const LANGS = {
  azerbaijani: "az", azeri: "az", turkish: "tr", russian: "ru", english: "en", german: "de", french: "fr", spanish: "es", italian: "it",
  arabic: "ar", chinese: "zh-CN", japanese: "ja", korean: "ko", persian: "fa", farsi: "fa", portuguese: "pt", ukrainian: "uk",
  georgian: "ka", polish: "pl", dutch: "nl", hindi: "hi", greek: "el", hebrew: "he", swedish: "sv", czech: "cs",
};

async function translate({ text, lang }) {
  const code = LANGS[String(lang).toLowerCase()];
  if (!code) throw new Error(`I don't know the language ${lang}.`);
  const src = /[^\x00-\x7F]/.test(text) ? "Autodetect" : "en";
  const j = await http(`https://api.mymemory.translated.net/get?q=${enc(text)}&langpair=${src}|${code}`, { ttl: 36e5 });
  const out = j.responseData && j.responseData.translatedText;
  if (!out || /MYMEMORY WARNING|INVALID/i.test(out)) throw new Error("The translation service didn't answer properly.");
  const L = String(lang).charAt(0).toUpperCase() + String(lang).slice(1);
  return { say: `In ${L}: ${out}`, card: { title: `TRANSLATE · ${String(lang).toUpperCase()}`, sub: out, rows: [["SOURCE", text]] }, copy: out };
}

async function define({ word }) {
  let j;
  try { j = await http(`https://api.dictionaryapi.dev/api/v2/entries/en/${enc(word)}`, { ttl: 864e5 }); }
  catch (e) { if (e.offline) throw e; throw new Error(`I couldn't find a definition for ${word}.`); }
  const e = j[0], m = e.meanings && e.meanings[0], d = m && m.definitions && m.definitions[0];
  if (!d) throw new Error(`I couldn't find a definition for ${word}.`);
  return {
    say: `${e.word}, ${m.partOfSpeech}: ${d.definition}`,
    card: { title: `DEFINE · ${e.word.toUpperCase()}`, sub: e.phonetic || "", rows: [[m.partOfSpeech.toUpperCase(), d.definition], ...(d.example ? [["EXAMPLE", d.example]] : [])] },
  };
}

async function wiki({ query }) {
  const s = await http(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${enc(query)}&limit=1&format=json&origin=*`, { ttl: 864e5 });
  const title = s && s[1] && s[1][0];
  if (!title) throw new Error(`Wikipedia has nothing on ${query}.`);
  const j = await http(`https://en.wikipedia.org/api/rest_v1/page/summary/${enc(title.replace(/ /g, "_"))}`, { ttl: 864e5 });
  const ex = (j.extract || "").trim();
  if (!ex) throw new Error(`Wikipedia has nothing on ${query}.`);
  const sentences = ex.match(/[^.!?]+[.!?]+(\s|$)/g) || [ex];
  let say = "";
  for (const s2 of sentences) { if ((say + s2).length > 320) break; say += s2; }
  return {
    say: (say || ex.slice(0, 300)).trim(),
    card: { title: `WIKIPEDIA · ${j.title.toUpperCase()}`, sub: j.description || "", body: ex.slice(0, 600), items: [{ t: "Open article", u: j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page }] },
  };
}

// ── Time in a city / network ──────────────────────────────────────────────────
async function timeIn({ city }) {
  const p = await place(city);
  const now = new Date();
  const t = now.toLocaleTimeString("en-US", { timeZone: p.tz, hour: "numeric", minute: "2-digit" });
  const d = now.toLocaleDateString("en-US", { timeZone: p.tz, weekday: "long", month: "long", day: "numeric" });
  return { say: `It's ${t} in ${p.name}, ${d}.`, card: { title: `TIME · ${p.name.toUpperCase()}`, sub: t, rows: [["DATE", d], ["ZONE", p.tz || "—"]] } };
}

async function netInfo() {
  const t0 = Date.now();
  const ip = await http("https://ipwho.is/", { ttl: 0 });
  const ms = Date.now() - t0;
  if (ip.success === false) throw new Error("I couldn't read your network details.");
  return {
    say: `You're online. Public address ${ip.ip}, ${ip.city}, ${ip.country}, through ${ip.connection && ip.connection.isp ? ip.connection.isp : "an unknown provider"}. Round trip ${ms} milliseconds.`,
    card: { title: "NETWORK", rows: [["PUBLIC IP", ip.ip], ["LOCATION", `${ip.city}, ${ip.country}`], ["ISP", (ip.connection && ip.connection.isp) || "—"], ["LATENCY", `${ms} ms`]] },
  };
}

function setCity(name) {
  store.db().settings.homeCity = name;
  store.save();
  return place(name).then((p) => ({ say: `Home location set to ${p.name}, ${p.country}.`, card: { title: "HOME LOCATION", sub: `${p.name}, ${p.country}` }, refresh: "intel" }));
}

module.exports = {
  weather, weatherData, news, headlines, crypto, marketsData, currency, curCode, translate, define, wiki, timeIn, netInfo, setCity,
  COINS, LANGS, home,
};
