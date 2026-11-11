/* ═════════════════════════════════════════════════════════════════════════════
   VOICE — speech output + two-phase speech recognition
   • Output: Kokoro / ElevenLabs from the server, else the normal browser voice.
   • The mic is NEVER open while JARVIS is speaking (it can't hear itself).
   • Wake word: fuzzy match, continuous, catches "Jarvis open Spotify" in one breath.
   • Hold-to-talk waits for your final words before sending.
   ═════════════════════════════════════════════════════════════════════════════ */
window.Voice = (function () {
  var env = null;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var SYN = window.speechSynthesis;

  // ── state ────────────────────────────────────────────────────────────────────
  var phase = "idle";                 // idle | wakeword | activating | command | manual
  var wakeOn = true, autoSend = true, micBlocked = false;
  var serverTTSOff = false;
  var micEverWorked = false, denyCount = 0, resumeTimer = null, lockedWarned = false;
  var UA = navigator.userAgent || "";
  var IS_CHROMIUM = /Chrome|Chromium|Edg\//.test(UA);
  var IS_SAFARI = /Safari/.test(UA) && !IS_CHROMIUM;
  var tabActive = function () { return !document.hidden; };

  function setPhase(p) { phase = p; env && env.ui && env.ui.phase && env.ui.phase(p); }
  function hint(t) { env && env.ui && env.ui.hint && env.ui.hint(t); }
  function toast(m, t) { env && env.ui && env.ui.toast && env.ui.toast(m, t); }

  // ═══════════════════════════════ OUTPUT ═══════════════════════════════
  var voices = [];
  var kAudio = null, kCtrl = null, kReq = 0;
  var player = null, playerUrl = null, unlocked = false;
  var speaking = false, speechQ = [], speechWaiters = [];
  var quietTimer = null, speakGuard = null;

  // ── ONE shared <audio> element, unlocked inside a real user gesture ──────────────
  // Safari (and Chrome without prior interaction) only allow play() from an element that was started in a click /
  // key press. A NEW Audio object created after an async fetch is blocked, which silently sent the first Kokoro
  // line to the system voice. One element, primed by the boot key press, stays allowed for every later line.
  var SILENT = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
  function getPlayer() {
    if (!player) { player = new Audio(); player.preload = "auto"; try { player.setAttribute("playsinline", ""); } catch (e) {} }
    return player;
  }
  function unlockAudio() {
    if (unlocked || speaking) return;
    try {
      var p = getPlayer();
      p.src = SILENT;
      var r = p.play();
      unlocked = true;
      // AbortError = real audio took over the element right after the unlock clip: still unlocked. Only a block re-arms.
      if (r && r.then) r.then(function () { p.pause(); }, function (err) { if (!err || err.name === "NotAllowedError") unlocked = false; });
      else p.pause();
    } catch (e) { unlocked = false; }
  }

  function loadVoices() { if (SYN) voices = SYN.getVoices(); }
  loadVoices();
  if (SYN) SYN.onvoiceschanged = loadVoices;

  function whenQuiet(fn) {
    if (speechWaiters.indexOf(fn) < 0) speechWaiters.push(fn);
    pumpWaiters();
  }
  function pumpWaiters() {
    clearTimeout(quietTimer);
    if (speaking) return;
    quietTimer = setTimeout(function () {          // tail so the last sound doesn't leak into the mic
      if (speaking) return;
      var w = speechWaiters.splice(0);
      for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) { console.warn(e); } }
    }, 350);
  }

  function finishSpeech(id) {
    if (id !== kReq) return;
    clearTimeout(speakGuard);
    kAudio = null; speaking = false;
    if (speechQ.length) { playSpeech(speechQ.shift()); return; }
    env && env.ui && env.ui.speaking && env.ui.speaking(false);
    pumpWaiters();
  }

  function stopSpeech() {
    kReq++;
    clearTimeout(speakGuard);
    speechQ = [];
    if (kCtrl)  { try { kCtrl.abort(); } catch (e) {} kCtrl = null; }
    if (player) { player.onended = player.onerror = null; try { player.pause(); } catch (e) {} }
    kAudio = null;
    if (SYN) SYN.cancel();
    var was = speaking;
    speaking = false;
    if (was) env && env.ui && env.ui.speaking && env.ui.speaking(false);
    pumpWaiters();
  }

  function speechText(text) {
    var clean = String(text || "")
      .replace(/\{[^{}]{0,400}\}/g, "").replace(/```[\s\S]*?```/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1").replace(/\*(.*?)\*/g, "$1").replace(/`[^`]*`/g, "")
      .replace(/#{1,6}\s/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "link")
      .replace(/[▲▼→←·•✓]/g, " ").replace(/\n+/g, " ").replace(/\.{2,}/g, ".").replace(/\s{2,}/g, " ").trim();
    if (!clean) return "";
    if (clean.length > 260) {                     // whole sentences, max 260 chars
      var sents = clean.match(/[^.!?]+[.!?]+/g) || [], summ = "";
      for (var i = 0; i < sents.length; i++) { if ((summ + sents[i]).length > 260) break; summ += sents[i].trim() + " "; }
      clean = summ.trim() || clean.slice(0, 260);
    }
    return clean;
  }

  function speak(text, queue) {
    var clean = speechText(text);
    if (!clean) return;
    if (queue && speaking) { speechQ.push(clean); return; }
    stopSpeech();
    playSpeech(clean);
  }

  function playSpeech(clean) {
    speaking = true;
    env && env.ui && env.ui.speaking && env.ui.speaking(true);
    if (phase === "wakeword") { stopAllRec(); setPhase("idle"); }   // never leave the mic open while talking
    var id = ++kReq;
    if (serverTTSOff || !window.fetch || !window.AbortController) { speakBrowser(clean, id); return; }
    speakServer(clean, id);
  }

  // Long lines are split in two: the first sentence starts playing while the server is still
  // generating the rest (neural TTS takes a few seconds per long line — silence feels broken).
  function splitForTTS(text) {
    if (text.length <= 110) return [text];
    var m = text.slice(0, 170).match(/^(.{40,}?[.!?])\s+(?=\S)/);
    var cut = m ? m[1].length : -1;
    if (cut < 0) { var sp = text.lastIndexOf(" ", 120); cut = sp > 50 ? sp : -1; }
    if (cut < 0 || text.length - cut < 25) return [text];
    return [text.slice(0, cut).trim(), text.slice(cut).trim()];
  }

  function fetchAudio(text, signal) {
    return fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text, personality: env.mode() }), signal: signal })
      .then(function (r) {
        if (r.status === 501) serverTTSOff = true;          // nothing available on this server → stop asking
        if (!r.ok) { if (env && env.ui && env.ui.ttsFallback) env.ui.ttsFallback(r.status); throw new Error("tts " + r.status); }   // 502/503 = this line only → system voice for it
        return r.blob();
      });
  }

  function speakServer(clean, id) {
    var parts = splitForTTS(clean);
    var ctrl = kCtrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    var reqs = parts.map(function (t) { return fetchAudio(t, ctrl.signal); });   // fired together; the server answers them in order
    reqs.forEach(function (p) { p.catch(function () {}); });                      // failures are handled where each part is played

    function play(i) {
      reqs[i].then(function (blob) {
        if (id !== kReq) return;
        if (i === 0) clearTimeout(timer);
        var url = URL.createObjectURL(blob), a = getPlayer(), old = playerUrl;
        var next = function () { a.onended = a.onerror = null; if (id !== kReq) return; if (i + 1 < parts.length) play(i + 1); else finishSpeech(id); };
        a.onended = next;
        a.onerror = function () { a.onended = a.onerror = null; if (id === kReq) speakBrowser(parts.slice(i).join(" "), id); };
        clearTimeout(speakGuard);
        speakGuard = setTimeout(next, 60000);
        kAudio = a; playerUrl = url;
        a.src = url;
        if (old) { try { URL.revokeObjectURL(old); } catch (e) {} }
        return a.play();
      }).catch(function (e) {
        clearTimeout(timer);
        if (e && e.name === "NotAllowedError") {      // browser still has the audio locked → re-arm on the next click / key press
          unlocked = false;
          if (!lockedWarned) { lockedWarned = true; toast("Browser blocked audio — click anywhere once to enable the neural voice", "warning"); }
        }
        if (id === kReq) speakBrowser(parts.slice(i).join(" "), id);   // anything wrong → the normal voice says the rest
      });
    }
    play(0);
  }

  function pickVoice(p) {
    if (!voices.length) return null;
    var names = (env.voiceNames && env.voiceNames()) || {};
    var pref = (names[p] || "").toLowerCase(), v = null;
    if (pref) v = voices.find(function (x) { return x.name.toLowerCase().indexOf(pref) !== -1 && x.lang.indexOf("en") === 0; });
    if (v) return v;
    var en = function (x) { return x.lang.indexOf("en") === 0; };
    if (p === "JARVIS") return voices.find(function (x) { return /daniel/i.test(x.name) && en(x); }) || voices.find(function (x) { return /uk.*male|google uk.*male/i.test(x.name); }) || voices.find(function (x) { return x.lang === "en-GB"; }) || voices.find(en);
    if (p === "FRIDAY") return voices.find(function (x) { return /moira|karen|samantha|fiona/i.test(x.name); }) || voices.find(en);
    return voices.find(function (x) { return /alex|fred|ralph/i.test(x.name); }) || voices.find(function (x) { return x.lang === "en-US"; }) || voices.find(en);
  }

  function speakBrowser(clean, id) {
    if (!SYN || !clean) { finishSpeech(id); return; }
    if (!voices.length) loadVoices();
    var p = env.mode();
    var utt = new SpeechSynthesisUtterance(clean);
    utt.rate = p === "ULTRON" ? 0.85 : p === "FRIDAY" ? 1.05 : 0.93;
    utt.pitch = p === "ULTRON" ? 0.6 : p === "FRIDAY" ? 1.1 : 1.0;
    utt.volume = 1;
    var v = pickVoice(p);
    if (v) { utt.voice = v; utt.lang = v.lang; }
    var done = function () { finishSpeech(id); };
    utt.onend = done; utt.onerror = done;
    clearTimeout(speakGuard);
    speakGuard = setTimeout(done, Math.min(35000, 3000 + clean.length * 110));   // Chrome sometimes never fires onend
    SYN.speak(utt);
  }

  // ═══════════════════════════════ MIC LEVEL ═══════════════════════════════
  var meter = { ctx: null, an: null, buf: null, started: false, lv: 0 };
  function ensureMeter() {
    if (meter.started || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    meter.started = true;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).then(function (stream) {
      var AC = window.AudioContext || window.webkitAudioContext;
      meter.ctx = new AC();
      var src = meter.ctx.createMediaStreamSource(stream);
      meter.an = meter.ctx.createAnalyser(); meter.an.fftSize = 512;
      src.connect(meter.an);
      meter.buf = new Uint8Array(meter.an.fftSize);
    }).catch(function () { /* mic permission handled by speech recognition itself */ });
  }
  function resumeMeter() { try { if (meter.ctx && meter.ctx.state === "suspended") meter.ctx.resume(); } catch (e) {} }
  function micLevel() {
    if (!meter.an) return 0.12 + 0.12 * Math.abs(Math.sin(Date.now() * 0.008));      // no meter (Safari): gentle idle motion
    meter.an.getByteTimeDomainData(meter.buf);
    var s = 0, n = meter.buf.length;
    for (var i = 0; i < n; i++) { var v = (meter.buf[i] - 128) / 128; s += v * v; }
    var rms = Math.min(1, Math.sqrt(s / n) * 5.5);
    meter.lv += (rms - meter.lv) * 0.4;
    return meter.lv;
  }
  function level() {
    if (speaking) { var t = Date.now(); return 0.32 + 0.4 * Math.abs(Math.sin(t * 0.011)) * (0.6 + 0.4 * Math.sin(t * 0.027)); }
    if (phase === "command" || phase === "manual") return micLevel();
    if (phase === "wakeword") return micLevel() * 0.45;
    return 0;
  }

  // ═══════════════════════════════ RECOGNITION ═══════════════════════════════
  var SR_LANG = "en-US";
  var gen = 0;
  var wakeRec = null, cmdRec = null, manRec = null;
  var _wakeTimer = null, _silTimer = null, _idleTimer = null, _settleTimer = null, _manTimer = null;
  var cmdFinal = "", cmdInterim = "", manFinal = "", manInterim = "", manStopping = false, netFails = 0;

  var WAKE = {
    JARVIS: { name: "jarvis", anywhere: true },
    FRIDAY: { name: "friday", anywhere: false },   // "friday" is a normal word → only first, or after "hey"
    ULTRON: { name: "ultron", anywhere: true },
  };
  var PREFIX = { hey: 1, hi: 1, ok: 1, okay: 1, yo: 1, hello: 1, hay: 1, hei: 1, a: 1 };
  var ACKS = { JARVIS: "Yes?", FRIDAY: "Yeah, boss?", ULTRON: "State your directive." };

  function lev(a, b) {
    var m = a.length, n = b.length, i, j;
    if (!m) return n; if (!n) return m;
    var prev = [], cur = [];
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  function findWake(text) {
    var re = /[A-Za-z0-9']+/g, toks = [], m;
    while ((m = re.exec(text))) toks.push({ w: m[0].toLowerCase().replace(/'/g, ""), end: m.index + m[0].length });
    var keys = Object.keys(WAKE), cur = env.mode();
    keys.sort(function (a, b) { return (b === cur) - (a === cur); });
    for (var t = 0; t < toks.length; t++) {
      var prefixed = t > 0 && PREFIX[toks[t - 1].w] === 1;
      var cands = [{ w: toks[t].w, end: toks[t].end }];
      if (t + 1 < toks.length) cands.push({ w: toks[t].w + toks[t + 1].w, end: toks[t + 1].end });
      for (var k = 0; k < keys.length; k++) {
        var W = WAKE[keys[k]];
        if (!(W.anywhere || prefixed || t === 0)) continue;
        for (var c = 0; c < cands.length; c++) {
          if (cands[c].w.length < 4) continue;
          if (lev(cands[c].w, W.name) <= (prefixed ? 2 : 1)) return { personality: keys[k], end: cands[c].end };
        }
      }
    }
    return null;
  }

  function newRec(continuous, alts) {
    var r = new SR();
    r.lang = SR_LANG; r.continuous = continuous; r.interimResults = true; r.maxAlternatives = alts || 1;
    return r;
  }

  function worked() { micEverWorked = true; denyCount = 0; }

  function checkPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve(null);
    try { return navigator.permissions.query({ name: "microphone" }).then(function (p) { return p.state; }, function () { return null; }); }
    catch (e) { return Promise.resolve(null); }
  }

  function hardBlock(code) {
    micBlocked = true;
    toast(code === "service-not-allowed" && IS_SAFARI
      ? "Safari can't use speech recognition: turn on Dictation in System Settings → Keyboard, or use Chrome"
      : "Microphone blocked — click the lock icon in the address bar and allow it, then click the MIC indicator to retry", "error");
    cancelListening(); hint("MIC BLOCKED — CLICK THE MIC INDICATOR TO RETRY");
  }

  function scheduleResume(ms) {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(function () { resumeTimer = null; if (tabActive() && !micBlocked) scheduleWake(200); }, ms);
  }

  // The user clicked the MIC indicator / mic button: verify the permission, then try again.
  function retryMic() {
    if (!env) return;
    checkPermission().then(function (state) {
      if (state === "denied") { toast("Still blocked — click the lock icon in the address bar, allow the microphone, then try again", "error"); return; }
      micBlocked = false; denyCount = 0; env.ui.listening(false); setPhase("idle"); hint("RETRYING MICROPHONE"); scheduleWake(200);
    });
  }

  function micProblem(ev) {
    var e = ev && ev.error;
    if (e === "not-allowed" || e === "service-not-allowed") {
      cancelListening();
      // Browsers raise "not-allowed" for a BACKGROUND tab, a tab that lost focus, or a session that already worked
      // just as readily as for a real permission block. Pause and try again when the tab is back; only call the mic
      // blocked once the permissions API (or repeated failures in the foreground) confirm it.
      if (!tabActive() || (micEverWorked && denyCount < 2)) { denyCount++; scheduleResume(1200); return true; }
      denyCount++;
      checkPermission().then(function (state) {
        if (state === "denied" || denyCount >= 3) hardBlock(e); else scheduleResume(1500);
      });
      return true;
    }
    if (e === "audio-capture") {
      micBlocked = true; toast("No microphone found", "error"); setPhase("idle"); hint("NO MICROPHONE"); env.ui.listening(false); return true;
    }
    if (e === "network") {
      netFails++;
      if (netFails === 1 || netFails % 6 === 0) toast("Speech recognition needs internet (Chrome uses Google's service)", "warning");
    }
    return false;
  }

  function canRun() { return SR && wakeOn && env.connected() && !micBlocked && tabActive(); }

  function scheduleWake(delay) {
    if (!canRun()) return;
    if (phase === "command" || phase === "manual" || phase === "activating") return;
    clearTimeout(_wakeTimer);
    var backoff = netFails > 2 ? Math.min(1000 * netFails, 8000) : 0;
    _wakeTimer = setTimeout(function () { whenQuiet(startWake); }, (delay || 300) + backoff);
  }

  function startWake() {
    if (!canRun()) return;
    if (phase === "command" || phase === "manual" || phase === "activating") return;
    if (env.busy()) { scheduleWake(800); return; }
    stopAllRec();
    setPhase("wakeword");
    hint('SAY "HEY ' + env.mode() + '"');

    var g = gen, handled = false, pending = null;
    var rec = wakeRec = newRec(true, 5);
    rec.onaudiostart = worked;

    function fire() { if (handled || g !== gen || !pending) return; handled = true; wakeDetected(pending.p, pending.rest); }

    rec.onresult = function (ev) {
      if (g !== gen || handled) return;
      netFails = 0; worked();
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i], hit = null;
        for (var j = 0; j < res.length && !hit; j++) {
          var h = findWake(res[j].transcript);
          if (h) hit = { p: h.personality, rest: res[j].transcript.slice(h.end).replace(/^[\s,.:;!?\-]+/, "").trim() };
        }
        if (!hit) { env.ui.heard(res[0].transcript.trim()); continue; }
        pending = hit;
        clearTimeout(_settleTimer);
        if (res.isFinal) fire(); else _settleTimer = setTimeout(fire, 1100);
      }
    };
    rec.onerror = function (ev) { if (g === gen) micProblem(ev); };
    rec.onend = function () {
      if (g !== gen) return;
      if (pending && !handled) { fire(); return; }
      if (phase === "wakeword") scheduleWake(250);
    };
    try { rec.start(); } catch (e) { scheduleWake(600); }
  }

  function wakeDetected(personality, rest) {
    stopAllRec();
    setPhase("activating");
    env.ui.wake(personality);
    var switching = personality !== env.mode();
    if (switching) env.switchMode(personality);
    if (rest && rest.length > 1) { setPhase("idle"); env.send(rest); return; }
    if (!switching) speak(ACKS[personality] || "Yes?");
    whenQuiet(function () { if (phase === "activating") startCommand(); });
  }

  function startCommand() {
    if (!SR || !env.connected()) return;
    stopAllRec();
    setPhase("command");
    cmdFinal = ""; cmdInterim = "";
    var g = gen, heard = false;
    var rec = cmdRec = newRec(true, 1);
    rec.onaudiostart = worked;

    rec.onstart = function () { if (g !== gen) return; env.ui.listening(true); hint("SPEAK NOW"); };
    rec.onresult = function (ev) {
      if (g !== gen) return;
      heard = true; netFails = 0; cmdInterim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) cmdFinal += ev.results[i][0].transcript + " "; else cmdInterim = ev.results[i][0].transcript;
      }
      env.ui.interim((cmdFinal + cmdInterim).trim());
      var last = ev.results[ev.results.length - 1];
      clearTimeout(_idleTimer); clearTimeout(_silTimer);
      _silTimer = setTimeout(finishCommand, last.isFinal ? 1000 : 1800);
    };
    rec.onerror = function (ev) { if (g === gen) micProblem(ev); };
    rec.onend = function () { if (g === gen) finishCommand(); };
    _idleTimer = setTimeout(function () { if (g === gen && !heard) finishCommand(); }, 8000);
    try { rec.start(); } catch (e) { cancelListening(); scheduleWake(600); }
  }

  function finishCommand() {
    clearTimeout(_silTimer); clearTimeout(_idleTimer);
    if (phase !== "command") return;
    var t = (cmdFinal + cmdInterim).trim();
    cmdFinal = cmdInterim = "";
    if (!t) { cancelListening(); scheduleWake(400); return; }
    if (autoSend) { env.send(t); return; }
    stopAllRec(); setPhase("idle"); env.ui.listening(false); env.ui.fill(t);     // review first, Enter to send
  }

  function startManual() {
    if (!SR) { toast("Speech recognition unavailable — use Chrome", "error"); return; }
    if (micBlocked) { retryMic(); return; }                    // verifies the permission, then retries (no reload needed)
    if (env.busy() || phase === "manual") return;
    stopSpeech(); stopAllRec();
    setPhase("manual");
    manFinal = manInterim = ""; manStopping = false;
    var g = gen, rec = manRec = newRec(true, 1);
    rec.onaudiostart = worked;
    rec.onstart = function () { if (g !== gen) return; env.ui.listening(true); hint("HOLD AND SPEAK"); };
    rec.onresult = function (ev) {
      if (g !== gen) return;
      manInterim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) manFinal += ev.results[i][0].transcript + " "; else manInterim = ev.results[i][0].transcript;
      }
      env.ui.interim((manFinal + manInterim).trim());
    };
    rec.onerror = function (ev) { if (g === gen) micProblem(ev); };
    rec.onend = function () { if (g === gen && manStopping) finishManual(); };
    try { rec.start(); } catch (e) { setPhase("idle"); env.ui.listening(false); scheduleWake(500); }
  }

  function stopManual() {
    if (phase !== "manual" || manStopping) return;
    manStopping = true; hint("PROCESSING");
    try { if (manRec) manRec.stop(); } catch (e) {}
    clearTimeout(_manTimer);
    _manTimer = setTimeout(finishManual, 1500);         // wait for Chrome's final words, but never forever
  }

  function finishManual() {
    if (!manStopping) return;
    manStopping = false; clearTimeout(_manTimer);
    var t = (manFinal + manInterim).trim();
    stopAllRec(); setPhase("idle"); env.ui.listening(false);
    if (t) env.send(t); else scheduleWake(400);
  }

  function stopAllRec() {
    gen++;
    clearTimeout(_wakeTimer); clearTimeout(_silTimer); clearTimeout(_idleTimer); clearTimeout(_settleTimer); clearTimeout(_manTimer);
    [wakeRec, cmdRec, manRec].forEach(function (r) {
      if (!r) return;
      r.onresult = r.onend = r.onerror = r.onstart = r.onaudiostart = null;
      try { r.abort(); } catch (e) {}
    });
    wakeRec = cmdRec = manRec = null;
  }

  function cancelListening() { stopAllRec(); setPhase("idle"); env.ui.listening(false); }

  // ── Leaving / returning to the tab ──────────────────────────────────────────────
  // Hidden tab → release the mic (browsers error the recognizer out anyway, which used to be mistaken for "blocked").
  // Back → resume by itself; if the mic was blocked, quietly re-check whether the user has since allowed it.
  function resumeAfterTab() {
    if (!env || document.hidden) return;
    resumeMeter();
    denyCount = 0;
    if (micBlocked) {
      checkPermission().then(function (state) { if (state !== "denied") { micBlocked = false; hint("MICROPHONE RESTORED"); scheduleWake(500); } });
      return;
    }
    if (phase === "idle") scheduleWake(600);
  }
  document.addEventListener("visibilitychange", function () {
    if (!env) return;
    if (document.hidden) { clearTimeout(resumeTimer); clearTimeout(_wakeTimer); if (phase !== "idle") cancelListening(); return; }
    resumeAfterTab();
  });
  window.addEventListener("focus", resumeAfterTab);

  // safety net: if the mic ends up idle for no reason, bring wake-word listening back
  setInterval(function () {
    if (env && canRun() && phase === "idle" && !env.busy() && !speaking) scheduleWake(100);
  }, 4000);

  return {
    init: function (e) { env = e; },
    speak: speak, stop: stopSpeech,
    isSpeaking: function () { return speaking; },
    phase: function () { return phase; },
    supported: function () { return !!SR; },
    micBlocked: function () { return micBlocked; },
    setWake: function (on) { wakeOn = !!on; if (!wakeOn) { if (phase === "wakeword" || phase === "activating") cancelListening(); } else scheduleWake(300); },
    setAutoSend: function (on) { autoSend = !!on; },
    setServerTTSOff: function (off) { serverTTSOff = !!off; },
    holdStart: startManual, holdEnd: stopManual,
    kick: scheduleWake, cancel: cancelListening,
    unlock: function () { unlockAudio(); if (IS_CHROMIUM) ensureMeter(); resumeMeter(); },
    retryMic: retryMic,
    isUnlocked: function () { return unlocked; },
    level: level,
  };
})();
