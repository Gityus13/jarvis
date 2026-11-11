// Replaces node-fetch with canned responses of the free APIs JARVIS uses (shapes match the real services).
const canned = (url) => {
  if (url.includes("geocoding-api")) return { results: [{ name: "Baku", country: "Azerbaijan", latitude: 40.4, longitude: 49.8, timezone: "Asia/Baku" }] };
  if (url.includes("api.open-meteo.com")) return { current: { temperature_2m: 18.4, apparent_temperature: 16.2, relative_humidity_2m: 61, weather_code: 2, wind_speed_10m: 14.3, is_day: 1 },
    daily: { time: ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"], weather_code: [2, 61, 3, 0], temperature_2m_max: [21, 17, 19, 22], temperature_2m_min: [14, 12, 11, 13], precipitation_probability_max: [10, 70, 20, 0] } };
  if (url.includes("ipwho.is")) return { success: true, ip: "1.2.3.4", city: "Baku", country: "Azerbaijan", latitude: 40.4, longitude: 49.8, timezone: { id: "Asia/Baku" }, connection: { isp: "TestNet" } };
  if (url.includes("coingecko")) return { bitcoin: { usd: 67250.5, usd_24h_change: 2.31 }, ethereum: { usd: 2610.2, usd_24h_change: -1.2 }, solana: { usd: 160.12, usd_24h_change: 0.4 } };
  if (url.includes("open.er-api")) return { result: "success", rates: { USD: 1, AZN: 1.7, EUR: 0.92, GBP: 0.79, TRY: 34.1 } };
  if (url.includes("hn.algolia")) return { hits: [{ title: "Show HN: Something cool", url: "https://example.dev", points: 321, objectID: "1" }, { title: "Rust 2.0", points: 200, objectID: "2" }] };
  if (url.includes("mymemory")) return { responseData: { translatedText: "Salam dünya" } };
  if (url.includes("dictionaryapi")) return [{ word: "ephemeral", phonetic: "/ɪˈfem(ə)rəl/", meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: "Lasting for a very short time.", example: "Fame is ephemeral." }] }] }];
  if (url.includes("action=opensearch")) return ["x", ["Nikola Tesla"], [""], [""]];
  if (url.includes("page/summary")) return { title: "Nikola Tesla", description: "Inventor", extract: "Nikola Tesla was a Serbian-American engineer. He is best known for AC power. He was born in 1856.", content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Nikola_Tesla" } } };
  return {};
};
const rss = `<rss><channel><item><title><![CDATA[Leaders meet in Geneva & talk]]></title><link>https://example.com/a</link></item><item><title>Second story</title><link>https://example.com/b</link></item></channel></rss>`;

const calls = [];
const fake = async (url) => { calls.push(String(url)); return { ok: true, status: 200, json: async () => canned(String(url)), text: async () => rss }; };
require.cache[require.resolve("node-fetch")] = { id: "node-fetch", filename: "node-fetch", loaded: true, exports: fake };
module.exports = { calls };
