// HTTP helper for the free, key-less APIs: caching, timeout, stale-cache fallback.
const fetch = require("node-fetch");

const cache = new Map();
const UA = "JARVIS-TIC/4.0 (personal assistant)";

async function http(url, { ttl = 0, timeout = 8000, json = true, headers = {} } = {}) {
  const hit = cache.get(url);
  if (ttl && hit && Date.now() - hit.t < ttl) return hit.v;

  let res;
  try {
    res = await fetch(url, { timeout, headers: { "User-Agent": UA, Accept: json ? "application/json" : "*/*", ...headers } });
  } catch {
    if (hit) return hit.v;                       // offline → serve the last good answer
    const e = new Error("I can't reach the internet right now.");
    e.offline = true;
    throw e;
  }
  if (!res.ok) {
    if (hit) return hit.v;
    throw new Error(`The service answered ${res.status}.`);
  }
  const v = json ? await res.json() : await res.text();
  if (ttl) cache.set(url, { t: Date.now(), v });
  return v;
}

const enc = encodeURIComponent;
module.exports = { http, enc };
