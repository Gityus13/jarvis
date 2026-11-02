/* ═════════════════════════════════════════════════════════════════════════════
   JARVIS CONSOLE — UI controller
   ═════════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }
  function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function hms(d) { d = d || new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }

  // ── preferences ──────────────────────────────────────────────────────────────
  function pref(k, def) { try { var v = localStorage.getItem("jarvis_" + k); return v === null ? def : v === "1"; } catch (e) { return def; } }
  function setPref(k, v) { try { localStorage.setItem("jarvis_" + k, v ? "1" : "0"); } catch (e) {} }
  function clientId() {
    try {
      var id = localStorage.getItem("jarvis_cid");
      if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12); localStorage.setItem("jarvis_cid", id); }
      return id;
    } catch (e) { return "anon" + Math.random().toString(36).slice(2, 14); }
  }

  var S = {
    ws: null, connected: false, reconnect: 1000,
    mode: "JARVIS", user: "sir", profiles: {}, voiceNames: null, greeting: "", greeted: false,
    thinking: false, streaming: false, streamEl: null, streamBuf: "",
    data: { tasks: [], notes: [], reminders: [] }, intel: null, feedTab: "news",
    wake: pref("wake", true), auto: pref("autosend", true), sfx: pref("sfx", true),
    hist: [], histIdx: -1, listening: false, phase: "idle", booted: false, status: null, tele: null,
  };

  // ── sounds (tiny WebAudio blips) ─────────────────────────────────────────────
  var actx = null;
  function beep(freq, dur, when, vol, type) {
    if (!S.sfx) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + (when || 0);
      o.type = type || "square"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  }
  var sfx = {
    wake: function () { beep(740, 0.07, 0, 0.05); beep(1110, 0.09, 0.08, 0.05); },
    send: function () { beep(520, 0.05, 0, 0.035); },
    alert: function () { for (var i = 0; i < 4; i++) beep(1040, 0.12, i * 0.22, 0.07); },
    err: function () { beep(160, 0.18, 0, 0.06, "sawtooth"); },
    boot: function () { beep(300, 0.05, 0, 0.03); },
  };

  // ── toasts ───────────────────────────────────────────────────────────────────
  function toast(msg, type) {
    var t = h("div", "toast " + (type || ""), msg);
    $("toasts").appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 350); }, type === "error" ? 6500 : 3800);
    while ($("toasts").children.length > 4) $("toasts").firstChild.remove();
  }

  // ═══════════════════════════════ FEED ═══════════════════════════════
  var feed;
  function scrollFeed(force) {
    var near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 140;
    if (force || near) feed.scrollTop = feed.scrollHeight;
  }
  function addLine(kind, label, text, extra) {
    var ln = h("div", "ln " + kind + (extra ? " " + extra : ""));
    ln.appendChild(h("time", null, hms()));
    ln.appendChild(h("b", null, label));
    var p = h("p", null, text || "");
    ln.appendChild(p);
    feed.appendChild(ln);
    while (feed.children.length > 260) feed.firstChild.remove();
    scrollFeed(true);
    return ln;
  }
  var aiLabel = function () { return (S.profiles[S.mode] && S.profiles[S.mode].name || S.mode).replace(/\./g, ""); };

  function renderCard(c) {
    var d = h("div", "card" + (c.tone === "bad" ? " bad" : ""));
    d.appendChild(h("div", "ch", c.title || ""));
    if (c.sub) d.appendChild(h("div", "cs", c.sub));
    if (c.rows && c.rows.length) {
      var dl = h("dl", "cr");
      c.rows.forEach(function (r) { dl.appendChild(h("dt", null, r[0] == null ? "" : String(r[0]))); dl.appendChild(h("dd", null, r[1] == null ? "" : String(r[1]))); });
      d.appendChild(dl);
    }
    if (c.body) d.appendChild(h("p", "cb", c.body));
    if (c.items && c.items.length) {
      var ul = h("ul", "ci");
      c.items.forEach(function (it) {
        var li = h("li");
        li.appendChild(h("span", null, it.t || ""));
        if (it.m) li.appendChild(h("small", null, it.m));
        li.addEventListener("click", function () {
          if (it.u) window.open(it.u, "_blank", "noopener");
          else if (it.cmd) sendCommand(it.cmd);
        });
        ul.appendChild(li);
      });
      d.appendChild(ul);
    }
    feed.appendChild(d);
    scrollFeed(true);
  }

  // ═══════════════════════════════ WEBSOCKET ═══════════════════════════════
  function wsSend(o) {
    if (S.ws && S.ws.readyState === 1) { S.ws.send(JSON.stringify(o)); return true; }
    return false;
  }

  function connect() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    try { S.ws = new WebSocket(proto + "//" + location.host + "/?cid=" + encodeURIComponent(clientId())); }
    catch (e) { setTimeout(connect, S.reconnect); return; }
    S.ws.onopen = function () { S.connected = true; S.reconnect = 1000; chips(); };
    S.ws.onclose = function () {
      S.connected = false; S.thinking = false; S.streaming = false; S.streamEl = null; S.streamBuf = "";
      Voice.cancel(); chips(); sync();
      setTimeout(connect, S.reconnect); S.reconnect = Math.min(S.reconnect * 1.6, 10000);
    };
    S.ws.onerror = function () {};
    S.ws.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
  }
  setInterval(function () { if (S.ws && S.ws.readyState === 1) S.ws.send('{"type":"ping"}'); }, 20000);

  function applyMode(k) {
    S.mode = k;
    document.documentElement.setAttribute("data-mode", k);
    var rgb = getComputedStyle(document.documentElement).getPropertyValue("--acc-rgb").trim();
    Core.setColor(rgb);
    var p = S.profiles[k];
    if (p) { $("brand-name").textContent = p.name; $("brand-tag").textContent = p.tag; document.title = p.name + " · " + p.tag; }
    Array.prototype.forEach.call($("modes").children, function (b) { b.classList.toggle("on", b.dataset.k === k); });
    sync();
  }

  function onMsg(m) {
    switch (m.type) {
      case "init":
        S.user = m.user || "sir"; S.profiles = m.profiles || {}; S.greeting = m.message || "";
        buildModes(m.personalities || Object.keys(S.profiles));
        applyMode(m.personality || "JARVIS");
        fetchStatus();
        if (!S.linked) { S.linked = true; addLine("sys", "CORE", "Link established · " + (S.profiles[m.personality] ? S.profiles[m.personality].name : m.personality) + " online"); addLine("ai", aiLabel(), S.greeting); }
        if (S.booted && !S.greeted) { S.greeted = true; Voice.speak(S.greeting); }
        Voice.kick(1500);
        break;
      case "user_message": addLine("usr", S.user === "sir" ? "YOU" : S.user.toUpperCase(), m.text); break;
      case "thinking": S.thinking = !!m.state; sync(); break;
      case "stream_start":
        S.streaming = true; S.streamBuf = "";
        S.streamEl = addLine("ai", aiLabel(), "", "cur"); sync(); break;
      case "stream_chunk":
        if (S.streamEl) {
          S.streamBuf += m.text || "";
          S.streamEl.lastChild.textContent = S.streamBuf.replace(/\{[^{}]{0,400}\}/g, "").replace(/\{[^}]*$/, "").replace(/```(?:json)?/g, "").replace(/^\s+/, "");
          scrollFeed();
        } break;
      case "stream_end": {
        S.streaming = false; S.thinking = false;
        if (S.streamEl) {
          S.streamEl.classList.remove("cur");
          var cleaned = S.streamBuf.replace(/\{[^{}]{0,400}\}/g, "").replace(/\{[^}]*$/, "").replace(/```(?:json)?/g, "").replace(/\s{2,}/g, " ").trim();
          if (cleaned) { S.streamEl.lastChild.textContent = cleaned; Voice.speak(cleaned, true); }
          else S.streamEl.remove();
          S.streamEl = null;
        }
        sync(); Voice.kick(700); break;
      }
      case "jarvis_response":
        S.thinking = false; addLine("ai", aiLabel(), m.text); Voice.speak(m.text, true); sync(); Voice.kick(700); break;
      case "card": renderCard(m.card); break;
      case "action_start": addLine("sys", "EXEC", "▸ " + describe(m.action)); break;
      case "action_done": addLine("sys", "DONE", m.result || "OK", "ok"); sfx.send(); break;
      case "action_error": addLine("sys", "FAIL", m.error || "Failed", "err"); sfx.err(); break;
      case "personality_changed":
        applyMode(m.personality); addLine("sys", "MODE", (S.profiles[m.personality] ? S.profiles[m.personality].name : m.personality) + " engaged"); addLine("ai", aiLabel(), m.greeting); Voice.speak(m.greeting); sfx.wake(); Core.pulse(); break;
      case "data": S.data = m.data; renderData(); break;
      case "alert":
        addLine("ai", m.title || "ALERT", m.text, "alert"); sfx.alert(); Core.alert(1800); Voice.speak(m.text); toast(m.text, "warning");
        if (window.Notification && Notification.permission === "granted") { try { new Notification("JARVIS", { body: m.text }); } catch (e) {} }
        break;
      case "refresh": loadIntel(); break;
      case "ui": if (m.open === "palette") openOverlay("palette"); break;
      case "error": toast(m.message || "Error", "error"); S.thinking = false; S.streaming = false; sync(); Voice.kick(600); break;
      case "export_done": toast("Exported to Desktop: " + m.filename, "success"); break;
    }
  }

  function describe(a) {
    if (!a) return "…";
    var parts = [a.action];
    ["app", "url", "query", "text", "key", "command", "path", "name", "title"].forEach(function (k) { if (a[k]) parts.push(String(a[k]).slice(0, 60)); });
    return parts.join(" · ");
  }

  function sendCommand(text) {
    text = String(text || "").trim();
    if (!text) return;
    Voice.stop(); Voice.cancel();
    if (!S.connected) { toast("Not connected to the core — retrying…", "error"); Voice.kick(1500); return; }
    if (S.hist[S.hist.length - 1] !== text) S.hist.push(text);
    S.histIdx = -1;
    wsSend({ type: "text_input", text: text });
    $("input").value = ""; $("stage-text").textContent = "";
    sfx.send();
  }

  // ═══════════════════════════════ MODES / CORE STATE ═══════════════════════════════
  function buildModes(keys) {
    var nav = $("modes"); nav.innerHTML = "";
    keys.forEach(function (k) {
      var b = h("button", null, k); b.dataset.k = k;
      b.addEventListener("click", function () { if (k !== S.mode) wsSend({ type: "set_personality", personality: k }); });
      nav.appendChild(b);
    });
  }

  function sync() {
    var st = "standby", label = "STANDBY", hint;
    var ph = Voice.phase();
    if (!S.connected) { st = "offline"; label = "OFFLINE"; hint = "CORE LINK LOST — RECONNECTING"; }
    else if (S.thinking || S.streaming) { st = "thinking"; label = "PROCESSING"; hint = "WORKING"; }
    else if (Voice.isSpeaking()) { st = "speaking"; label = "RESPONDING"; hint = "VOICE OUTPUT"; }
    else if (ph === "command" || ph === "manual") { st = "listening"; label = "LISTENING"; }
    else if (ph === "activating") { st = "listening"; label = "ACKNOWLEDGED"; hint = "STAND BY"; }
    if (Core.getState() !== st) Core.setState(st);
    setText($("state-label"), label);
    if (hint) setText($("state-hint"), hint);
    else if (st === "standby") setText($("state-hint"), Voice.micBlocked() ? "MIC BLOCKED — ALLOW IT IN THE ADDRESS BAR" : S.wake && Voice.supported() ? 'SAY "HEY ' + S.mode + '"  ·  OR HOLD SPACE' : "HOLD SPACE TO SPEAK");
    $("mic").classList.toggle("live", ph === "manual" || ph === "command");
    chips();
  }
  setInterval(function () { Core.setLevel(Voice.level()); sync(); }, 100);

  function chip(id, cls, title) { var e = $(id), c = "chip " + cls; if (e.className !== c) e.className = c; if (title && e.title !== title) e.title = title; }
  function chips() {
    var s = S.status, ph = Voice.phase();
    if (!S.connected) chip("chip-ai", "bad", "Core offline");
    else if (!s) chip("chip-ai", "", "");
    else chip("chip-ai", s.ollama && s.ollama.running ? (s.ollama.modelFound ? "ok" : "wn") : "bad", s.ollama && s.ollama.running ? (s.ollama.modelFound ? "Model: " + s.model : "Model not installed: " + s.model) : "Ollama is not running");
    var n = S.tele && S.tele.net;
    chip("chip-net", n ? (n.ok ? (n.ms > 400 ? "wn" : "ok") : "bad") : "", n && n.ms ? n.ms + " ms" : "");
    var t = s && s.tts;
    chip("chip-voice", t ? (t.kokoro === "ready" || t.elevenlabs ? "ok" : "wn") : "", t ? (t.kokoro === "ready" ? "Kokoro neural voice" : t.elevenlabs ? "ElevenLabs" : "System voice") : "");
    chip("chip-mic", !Voice.supported() ? "bad" : Voice.micBlocked() ? "bad" : (ph === "command" || ph === "manual") ? "act" : ph === "wakeword" ? "ok" : "", Voice.supported() ? "" : "Speech recognition needs Chrome");
  }

  function fetchStatus() {
    return fetch("/api/status").then(function (r) { return r.json(); }).then(function (d) {
      S.status = d; S.voiceNames = d.tts && d.tts.voices;
      if (d.tts && d.tts.kokoro === "unavailable" && !d.tts.elevenlabs) Voice.setServerTTSOff(true);
      if (d.tts && d.tts.kokoro === "loading") setTimeout(fetchStatus, 5000);
      var el = $("cfg-voice");
      if (el) el.textContent = d.tts.kokoro === "ready" ? "Kokoro neural voice" : d.tts.kokoro === "loading" ? "Kokoro loading — system voice for now" : d.tts.elevenlabs ? "ElevenLabs" : "System voice (npm i kokoro-js for a neural voice)";
      chips();
    }).catch(function () {});
  }
  setInterval(fetchStatus, 20000);

  // ═══════════════════════════════ TELEMETRY ═══════════════════════════════
  function gb(n) { return (n / 1073741824).toFixed(1); }
  function dur(s) { var d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return (d ? d + "d " : "") + (hh ? hh + "h " : "") + m + "m"; }
  function bar(id, pct, warnAt, badAt) {
    var el = $(id); el.style.width = Math.max(0, Math.min(100, pct)) + "%";
    el.parentNode.className = "bar" + (pct >= badAt ? " bad" : pct >= warnAt ? " warn" : "");
  }
  function spark(cv, arr) {
    if (!cv || !arr || arr.length < 2) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2), w = cv.clientWidth, hh = cv.clientHeight;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr); }
    var c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hh);
    var rgb = getComputedStyle(document.documentElement).getPropertyValue("--acc-rgb").trim();
    var step = w / 59, x0 = w - (arr.length - 1) * step;
    c.beginPath();
    arr.forEach(function (v, i) { var x = x0 + i * step, y = hh - 2 - (v / 100) * (hh - 4); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.strokeStyle = "rgb(" + rgb + ")"; c.lineWidth = 1.3; c.stroke();
    c.lineTo(w, hh); c.lineTo(x0, hh); c.closePath();
    var g = c.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, "rgba(" + rgb + ",.3)"); g.addColorStop(1, "rgba(" + rgb + ",0)");
    c.fillStyle = g; c.fill();
  }
  function flash(el) { el.classList.remove("fl"); }

  function renderTele(t) {
    S.tele = t;
    $("v-cpu").textContent = t.cpu + "%"; bar("b-cpu", t.cpu, 70, 90); spark($("sp-cpu"), t.cpuHist);
    $("v-mem").textContent = gb(t.mem.used) + " / " + gb(t.mem.total) + " GB"; bar("b-mem", t.mem.pct, 80, 92); spark($("sp-mem"), t.mem.hist);
    if (t.disk) { $("v-disk").textContent = t.disk.pct + "% · " + gb(t.disk.total - t.disk.used) + " GB free"; bar("b-disk", t.disk.pct, 85, 95); } else $("v-disk").textContent = "n/a";
    if (t.battery) {
      var chg = /charg|plug|ac/.test(t.battery.state);
      $("v-batt").textContent = t.battery.pct + "% · " + t.battery.state.toUpperCase();
      var b = $("b-batt"); b.style.width = t.battery.pct + "%"; b.parentNode.className = "bar" + (!chg && t.battery.pct < 20 ? " bad" : !chg && t.battery.pct < 35 ? " warn" : "");
    } else { $("v-batt").textContent = "AC POWER"; $("b-batt").style.width = "100%"; $("b-batt").parentNode.className = "bar"; }
    if (t.net && t.net.ok) { $("v-net").textContent = t.net.ms + " ms"; bar("b-net", Math.min(100, t.net.ms / 5), 60, 85); } else { $("v-net").textContent = "OFFLINE"; bar("b-net", 100, 0, 0); }

    var pl = $("procs"); pl.innerHTML = "";
    (t.procs || []).slice(0, 5).forEach(function (p) { var li = h("li"); li.appendChild(h("span", null, p.name)); li.appendChild(h("b", p.cpu > 30 ? "hot" : "", p.cpu.toFixed(1) + "%")); pl.appendChild(li); });
    if (!t.procs || !t.procs.length) pl.appendChild(h("li", "empty", "NO DATA"));
    $("host-name").textContent = t.host;
    var hl = $("host"); hl.innerHTML = "";
    [["OS", t.platform], ["CORES", String(t.cores)], ["UPTIME", dur(t.uptime)], ["LOAD", t.load.join("  ")], ["NODE", t.node]].forEach(function (r) { var li = h("li"); li.appendChild(h("span", null, r[0])); li.appendChild(h("b", null, r[1])); hl.appendChild(li); });
    chips();
  }
  function pollTele() {
    if (document.hidden) return;
    fetch("/api/telemetry").then(function (r) { return r.json(); }).then(renderTele).catch(function () {});
  }

  // ═══════════════════════════════ INTEL ═══════════════════════════════
  function off(el, txt) { el.innerHTML = ""; el.appendChild(h(el.tagName === "UL" ? "li" : "div", "off", txt)); }

  function renderIntel(d) {
    S.intel = d;
    var w = d.weather, box = $("p-weather");
    if (w.ok) {
      var x = w.data, wind = /F/.test(x.unit) ? "mph" : "km/h";
      $("w-place").textContent = x.place + (x.country ? ", " + x.country : "");
      box.innerHTML = "";
      var main = h("div", "wx-main"), big = h("b", null, String(x.now.t)); big.appendChild(h("sup", null, "°"));
      var side = h("div"); side.appendChild(h("span", "wx-c", x.now.text.toUpperCase()));
      var sm = h("small", null, "FEELS " + x.now.feels + "°  ·  HUM " + x.now.hum + "%"); sm.appendChild(document.createElement("br")); sm.appendChild(document.createTextNode("WIND " + x.now.wind + " " + wind)); sm.appendChild(document.createElement("br")); sm.appendChild(document.createTextNode("HIGH " + x.days[0].hi + "°  ·  LOW " + x.days[0].lo + "°"));
      side.appendChild(sm); main.appendChild(big); main.appendChild(side); box.appendChild(main);
      var days = h("div", "wx-days");
      x.days.slice(1, 4).forEach(function (dd) {
        var c = h("div"); c.appendChild(h("small", null, dd.d.toUpperCase())); c.appendChild(h("b", null, dd.hi + "°/" + dd.lo + "°"));
        c.appendChild(h("span", (dd.rain || 0) >= 40 ? "rain" : "", (dd.rain || 0) + "% RAIN")); days.appendChild(c);
      });
      box.appendChild(days);
    } else { $("w-place").textContent = "OFFLINE"; off(box, "NO WEATHER DATA"); }

    var mk = $("p-markets");
    if (d.markets.ok) {
      mk.innerHTML = "";
      d.markets.data.forEach(function (r) {
        var li = h("li"); li.appendChild(h("span", "sym", r.sym)); li.appendChild(h("b", null, r.p));
        li.appendChild(h("em", r.ch == null ? "" : r.ch >= 0 ? "up" : "dn", r.ch == null ? "—" : (r.ch >= 0 ? "▲ " : "▼ ") + Math.abs(r.ch).toFixed(2) + "%")); mk.appendChild(li);
      });
    } else off(mk, "NO MARKET DATA");
    renderNews();
  }
  function renderNews() {
    var d = S.intel, ul = $("p-news"); if (!d) return;
    var src = d[S.feedTab];
    if (!src || !src.ok) { off(ul, "NO FEED DATA"); return; }
    ul.innerHTML = "";
    src.data.forEach(function (n) {
      var li = h("li"), a = h("a", null, n.t); if (n.u) { a.href = n.u; a.target = "_blank"; a.rel = "noopener"; }
      li.appendChild(a); if (n.m) li.appendChild(h("small", null, n.m)); ul.appendChild(li);
    });
  }
  function loadIntel() { fetch("/api/intel").then(function (r) { return r.json(); }).then(renderIntel).catch(function () {}); }

  // ═══════════════════════════════ TASKS / NOTES / TIMERS ═══════════════════════════════
  function renderData() {
    var d = S.data, ul = $("p-tasks");
    ul.innerHTML = "";
    d.tasks.forEach(function (t) {
      var li = h("li", t.done ? "done" : "");
      var ck = h("button", "ck"); ck.title = "Toggle"; ck.addEventListener("click", function () { wsSend({ type: "task_toggle", id: t.id }); });
      var rm = h("button", "rm", "×"); rm.title = "Delete"; rm.addEventListener("click", function () { wsSend({ type: "task_delete", id: t.id }); });
      li.appendChild(ck); li.appendChild(h("span", null, t.text)); li.appendChild(rm); ul.appendChild(li);
    });
    if (!d.tasks.length) ul.appendChild(h("li", "empty", "NO TASKS — SAY “ADD TASK …”"));
    $("t-count").textContent = d.tasks.filter(function (t) { return !t.done; }).length + " OPEN";

    var nl = $("p-notes"); nl.innerHTML = "";
    d.notes.slice(-4).reverse().forEach(function (n) {
      var li = h("li"), rm = h("button", "rm", "×"); rm.addEventListener("click", function () { wsSend({ type: "note_delete", id: n.id }); });
      li.appendChild(h("span", null, n.text)); li.appendChild(rm); nl.appendChild(li);
    });
    if (!d.notes.length) nl.appendChild(h("li", "empty", "NO NOTES — SAY “TAKE A NOTE …”"));
    $("n-count").textContent = String(d.notes.length);
    renderTimers();
  }
  function fmtLeft(ms) { if (ms < 0) ms = 0; var s = Math.ceil(ms / 1000), hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ":" + pad(m) : pad(m)) + ":" + pad(ss); }
  function renderTimers() {
    var ul = $("p-timers"), list = (S.data.reminders || []).slice().sort(function (a, b) { return a.at - b.at; });
    $("tm-count").textContent = String(list.length);
    if (ul.children.length !== list.length || ul.dataset.sig !== list.map(function (r) { return r.id; }).join()) {
      ul.dataset.sig = list.map(function (r) { return r.id; }).join(); ul.innerHTML = "";
      list.forEach(function (r) {
        var li = h("li"); li.dataset.at = r.at;
        li.appendChild(h("span", null, (r.label || r.kind).toUpperCase())); li.appendChild(h("b", null, fmtLeft(r.at - Date.now())));
        var rm = h("button", "rm", "×"); rm.addEventListener("click", function () { wsSend({ type: "reminder_cancel", id: r.id }); }); li.appendChild(rm); ul.appendChild(li);
      });
      if (!list.length) ul.appendChild(h("li", "empty", "NONE ACTIVE — SAY “SET A TIMER FOR 10 MINUTES”"));
    } else Array.prototype.forEach.call(ul.children, function (li) { if (li.dataset.at) { var left = li.dataset.at - Date.now(); li.lastChild.previousSibling.textContent = fmtLeft(left); li.classList.toggle("soon", left < 10000); } });
  }
  setInterval(renderTimers, 1000);

  // ═══════════════════════════════ OVERLAYS ═══════════════════════════════
  var overlays = ["palette", "systems", "config"];
  function anyOverlay() { return overlays.some(function (o) { return !$(o).hidden; }); }
  function closeOverlays() { overlays.forEach(function (o) { $(o).hidden = true; }); }
  function openOverlay(o) {
    closeOverlays(); $(o).hidden = false;
    if (o === "palette") { $("pal-in").value = ""; loadPalette(); setTimeout(function () { $("pal-in").focus(); }, 30); }
    if (o === "systems") runDiag($("diag-list"), $("diag-sum"));
    if (o === "config") { $("cfg-wake").checked = S.wake; $("cfg-auto").checked = S.auto; $("cfg-sfx").checked = S.sfx; fetchStatus(); }
  }

  // palette
  var catalog = null, palSel = 0, palItems = [];
  function loadPalette() { if (catalog) return renderPalette(); fetch("/api/commands").then(function (r) { return r.json(); }).then(function (c) { catalog = c; renderPalette(); }).catch(function () { $("pal-list").textContent = "Couldn't load commands."; }); }
  function renderPalette() {
    var q = $("pal-in").value.trim().toLowerCase(), box = $("pal-list"); box.innerHTML = ""; palItems = [];
    var cat = null;
    (catalog || []).filter(function (c) { return !q || (c.cmd + " " + c.desc + " " + c.cat).toLowerCase().indexOf(q) !== -1; }).forEach(function (c) {
      if (c.cat !== cat) { cat = c.cat; box.appendChild(h("div", "pc", cat)); }
      var d = h("div", "pi"), b = h("b", null, c.cmd.trim()); d.appendChild(b); d.appendChild(h("small", null, c.desc));
      var idx = palItems.length; d.dataset.i = idx; palItems.push(c);
      d.addEventListener("click", function () { runPalette(c, false); });
      d.addEventListener("mousemove", function () { palSel = idx; markPal(); });
      box.appendChild(d);
    });
    if (!palItems.length) box.appendChild(h("div", "pc", "NO MATCHES — PRESS ENTER TO SEND AS TEXT"));
    palSel = 0; markPal();
  }
  function markPal() { Array.prototype.forEach.call($("pal-list").querySelectorAll(".pi"), function (e) { e.classList.toggle("sel", +e.dataset.i === palSel); if (+e.dataset.i === palSel) e.scrollIntoView({ block: "nearest" }); }); }
  function runPalette(c, edit) {
    closeOverlays();
    if (edit || /\s$/.test(c.cmd)) { $("input").value = c.cmd; $("input").focus(); } else sendCommand(c.cmd);
  }

  // diagnostics
  function clientChecks() {
    var out = [];
    out.push(window.SpeechRecognition || window.webkitSpeechRecognition ? { label: "Speech recognition (browser)", status: "ok", detail: "available" } : { label: "Speech recognition (browser)", status: "fail", detail: "Not supported in this browser", fix: "Open JARVIS in Google Chrome or Microsoft Edge" });
    out.push(window.isSecureContext ? { label: "Secure context", status: "ok", detail: location.origin } : { label: "Secure context", status: "fail", detail: "The mic only works on localhost or https", fix: "Open http://localhost:" + location.port });
    out.push(S.connected ? { label: "Console link (WebSocket)", status: "ok", detail: "connected" } : { label: "Console link (WebSocket)", status: "fail", detail: "disconnected", fix: "Is the server running? npm start" });
    out.push(window.speechSynthesis ? { label: "Speech output (browser)", status: "ok", detail: (speechSynthesis.getVoices().length || "?") + " system voices" } : { label: "Speech output (browser)", status: "warn", detail: "not available" });
    return out;
  }
  function micPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(null);
    return navigator.permissions.query({ name: "microphone" }).then(function (p) {
      return p.state === "granted" ? { label: "Microphone permission", status: "ok", detail: "granted" }
        : p.state === "prompt" ? { label: "Microphone permission", status: "warn", detail: "not asked yet — Chrome will prompt on first use", fix: "Click the mic button once and press Allow" }
        : { label: "Microphone permission", status: "fail", detail: "blocked", fix: "Click the lock icon in the address bar → Microphone → Allow, then reload" };
    }).catch(function () { return null; });
  }
  function gatherDiag() {
    return Promise.all([fetch("/api/diagnostics").then(function (r) { return r.json(); }).catch(function () { return [{ label: "Core server", status: "fail", detail: "no answer", fix: "Run: npm start" }]; }), micPermission()]).then(function (a) {
      var list = a[0]; if (!Array.isArray(list)) list = [];
      var cc = clientChecks(); if (a[1]) cc.splice(2, 0, a[1]);
      return list.concat(cc);
    });
  }
  function renderDiag(list, box, sum) {
    box.innerHTML = "";
    list.forEach(function (d) {
      var r = h("div", "dg"); r.appendChild(h("div", "st " + d.status, d.status === "ok" ? "ONLINE" : d.status === "warn" ? "DEGRADED" : "OFFLINE"));
      var c = h("div"); c.appendChild(h("b", null, d.label)); if (d.detail) c.appendChild(h("small", null, d.detail)); if (d.fix) c.appendChild(h("div", "fix", d.fix));
      r.appendChild(c); box.appendChild(r);
    });
    var bad = list.filter(function (d) { return d.status !== "ok"; }).length;
    if (sum) sum.textContent = bad ? bad + " OF " + list.length + " NEED ATTENTION" : "ALL " + list.length + " SYSTEMS NOMINAL";
  }
  function runDiag(box, sum) { box.innerHTML = ""; box.appendChild(h("div", "off", "RUNNING CHECKS…")); return gatherDiag().then(function (l) { renderDiag(l, box, sum); return l; }); }

  // ═══════════════════════════════ BOOT ═══════════════════════════════
  function boot() {
    var log = $("boot-log"), fast = false, skipped = false, entered = false;
    function skip() { skipped = true; fast = true; }
    function line(html, ms) { log.insertAdjacentHTML("beforeend", html + "\n"); sfx.boot(); return sleep(fast ? 8 : ms); }
    function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
    var onKey = function (e) { if (!entered && log.dataset.ready) { enter(); } else skip(); };
    document.addEventListener("keydown", onKey); document.addEventListener("pointerdown", onKey);

    function enter() {
      if (entered) return; entered = true;
      document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onKey);
      Voice.unlock();
      $("boot").classList.add("out"); setTimeout(function () { $("boot").remove(); }, 700);
      $("app").classList.remove("pre"); $("app").classList.add("live"); $("right").classList.add("live");
      S.booted = true;
      if (S.greeting && !S.greeted) { S.greeted = true; Voice.speak(S.greeting); }
      pollTele(); loadIntel(); Voice.kick(2500);
      if (window.innerWidth > 1020) setTimeout(function () { $("input").focus(); }, 600);
    }

    (async function () {
      var d = new Date();
      await line('<span class="hd">J.A.R.V.I.S.</span>', 120);
      await line('<span class="ac">TACTICAL INTELLIGENCE CORE</span>  ·  BUILD 4.0.' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()), 160);
      await line("", 60);
      var diag = gatherDiag();
      await line("MOUNTING CORE …………………… <span class='ok'>OK</span>", 130);
      await line("LOADING OPERATING MODES …… <span class='ok'>OK</span>", 110);
      await line("STARTING SELF-DIAGNOSTICS", 220);
      var list = await diag;
      for (var i = 0; i < list.length; i++) {
        var x = list[i], tag = x.status === "ok" ? "<span class='ok'>[ OK ]</span>" : x.status === "warn" ? "<span class='wn'>[WARN]</span>" : "<span class='fl'>[FAIL]</span>";
        await line(tag + " " + esc(x.label.toUpperCase()).padEnd(34, " ") + " <span style='color:#5c6670'>" + esc(x.detail || "") + "</span>", 85);
      }
      var bad = list.filter(function (z) { return z.status !== "ok"; }).length;
      await line("", 120);
      await line(bad ? "<span class='wn'>" + bad + " SYSTEM" + (bad > 1 ? "S" : "") + " DEGRADED</span> — OPEN “SYSTEMS” FOR FIXES" : "<span class='ok'>ALL SYSTEMS NOMINAL</span>", 260);
      await line("", 80);
      var active = navigator.userActivation && navigator.userActivation.hasBeenActive;
      if (active || skipped) { await sleep(fast ? 50 : 350); enter(); return; }
      log.dataset.ready = "1";
      await line('<span class="ac">▌ PRESS ANY KEY TO ENTER</span>', 0);
      $("boot-skip").textContent = "";
      setTimeout(function () { if (!entered) enter(); }, 14000);     // enter without voice if nobody presses
    })();
  }

  // ═══════════════════════════════ WIRING ═══════════════════════════════
  function init() {
    feed = $("feed");
    Core.init($("core"));

    Voice.init({
      mode: function () { return S.mode; },
      voiceNames: function () { return S.voiceNames; },
      connected: function () { return S.connected; },
      busy: function () { return S.thinking || S.streaming; },
      send: sendCommand,
      switchMode: function (k) { wsSend({ type: "set_personality", personality: k }); },
      ui: {
        phase: function (p) { S.phase = p; if (p === "idle" || p === "wakeword") { $("stage-text").textContent = ""; } sync(); },
        hint: function (t) { $("state-hint").textContent = t; },
        interim: function (t) { $("stage-text").textContent = t ? "“" + t + "”" : ""; },
        heard: function (t) { $("stage-text").textContent = "HEARD: " + t.slice(-48).toUpperCase(); },
        listening: function (b) { S.listening = b; sync(); },
        toast: toast,
        wake: function (p) { sfx.wake(); Core.pulse(); $("state-hint").textContent = "WAKE WORD: " + p; },
        fill: function (t) { $("input").value = t; $("input").focus(); },
        speaking: function () { sync(); },
      },
    });
    Voice.setWake(S.wake); Voice.setAutoSend(S.auto);

    $("cmd").addEventListener("submit", function (e) { e.preventDefault(); sendCommand($("input").value); });
    $("input").addEventListener("keydown", function (e) {
      if (e.key === "ArrowUp" && S.hist.length) { e.preventDefault(); S.histIdx = S.histIdx < 0 ? S.hist.length - 1 : Math.max(0, S.histIdx - 1); $("input").value = S.hist[S.histIdx]; }
      else if (e.key === "ArrowDown" && S.histIdx >= 0) { e.preventDefault(); S.histIdx++; $("input").value = S.histIdx >= S.hist.length ? (S.histIdx = -1, "") : S.hist[S.histIdx]; }
    });

    var mic = $("mic"), held = false;
    mic.addEventListener("pointerdown", function (e) { e.preventDefault(); held = true; Voice.unlock(); Voice.holdStart(); try { mic.setPointerCapture(e.pointerId); } catch (x) {} });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach(function (ev) { mic.addEventListener(ev, function () { if (held) { held = false; Voice.holdEnd(); } }); });

    var spaceDown = false;
    document.addEventListener("keydown", function (e) {
      Voice.unlock();
      var ae = document.activeElement, isInput = !!ae && /^(INPUT|TEXTAREA)$/.test(ae.tagName);
      // SPACE talks unless you're actually typing (an empty command box counts as "not typing")
      var typing = isInput && !(ae === $("input") && $("input").value === "");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); anyOverlay() && !$("palette").hidden ? closeOverlays() : openOverlay("palette"); return; }
      if (e.key === "Escape") { if (anyOverlay()) closeOverlays(); else { Voice.stop(); Voice.cancel(); Voice.kick(400); } return; }
      if (!$("palette").hidden) {
        if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palItems.length - 1, palSel + 1); markPal(); }
        else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(0, palSel - 1); markPal(); }
        else if (e.key === "Enter") { e.preventDefault(); if (palItems[palSel]) runPalette(palItems[palSel], false); else { var v = $("pal-in").value.trim(); closeOverlays(); sendCommand(v); } }
        else if (e.key === "Tab") { e.preventDefault(); if (palItems[palSel]) runPalette(palItems[palSel], true); }
        return;
      }
      if (anyOverlay() || typing) return;
      if (e.code === "Space" && !e.repeat && !spaceDown) { e.preventDefault(); spaceDown = true; Voice.holdStart(); }
      else if (e.key === "/" && !isInput) { e.preventDefault(); $("input").focus(); }
    });
    document.addEventListener("keyup", function (e) { if (e.code === "Space" && spaceDown) { spaceDown = false; Voice.holdEnd(); } });
    document.addEventListener("pointerdown", function () { Voice.unlock(); }, { once: true });
    $("pal-in").addEventListener("input", renderPalette);

    $("btn-palette").addEventListener("click", function () { openOverlay("palette"); });
    $("btn-systems").addEventListener("click", function () { openOverlay("systems"); });
    $("btn-config").addEventListener("click", function () { openOverlay("config"); });
    $("diag-run").addEventListener("click", function () { runDiag($("diag-list"), $("diag-sum")); });
    overlays.forEach(function (o) { $(o).addEventListener("pointerdown", function (e) { if (e.target === $(o) || e.target.hasAttribute("data-close")) closeOverlays(); }); });

    $("cfg-wake").addEventListener("change", function (e) { S.wake = e.target.checked; setPref("wake", S.wake); Voice.setWake(S.wake); sync(); toast("Wake word " + (S.wake ? "enabled" : "disabled")); });
    $("cfg-auto").addEventListener("change", function (e) { S.auto = e.target.checked; setPref("autosend", S.auto); Voice.setAutoSend(S.auto); toast(S.auto ? "Voice commands send automatically" : "Voice commands wait for Enter"); });
    $("cfg-sfx").addEventListener("change", function (e) { S.sfx = e.target.checked; setPref("sfx", S.sfx); });
    $("cfg-city-form").addEventListener("submit", function (e) { e.preventDefault(); var v = $("cfg-city").value.trim(); if (v) { closeOverlays(); sendCommand("set my city to " + v); } });
    $("cfg-export").addEventListener("click", function () { wsSend({ type: "export_chat", format: "txt" }); });
    $("cfg-clear").addEventListener("click", function () { feed.innerHTML = ""; closeOverlays(); });

    $("task-form").addEventListener("submit", function (e) { e.preventDefault(); var v = $("task-in").value.trim(); if (v) { wsSend({ type: "task_add", text: v }); $("task-in").value = ""; } });
    Array.prototype.forEach.call(document.querySelectorAll(".tabs button"), function (b) {
      b.addEventListener("click", function () { S.feedTab = b.dataset.feed; Array.prototype.forEach.call(b.parentNode.children, function (x) { x.classList.toggle("on", x === b); }); renderNews(); });
    });

    function clock() { var n = new Date(); $("clock-t").textContent = hms(n); $("clock-d").textContent = n.toLocaleDateString("en-US", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase().replace(/,/g, ""); }
    clock(); setInterval(clock, 1000);
    setInterval(pollTele, 2000);
    setInterval(loadIntel, 10 * 60 * 1000);
    window.addEventListener("resize", function () { if (S.tele) renderTele(S.tele); });

    renderData();
    connect();
    boot();
  }

  window.JV = { S: S, send: sendCommand };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
