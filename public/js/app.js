/**
 * J.A.R.V.I.S. v3.0 — Frontend
 *
 * Speech works in two phases:
 *   PHASE 1 — Always listening for wake word ("Hey JARVIS" / "Hey FRIDAY" / "Ultron")
 *   PHASE 2 — After wake word: listens for your command, auto-sends on silence
 *
 * Manual override: hold mic button or SPACE to speak instantly without wake word.
 */
(function () {
  "use strict";

  // ── State ────────────────────────────────────────────────────────────────────
  const S = {
    ws: null, connected: false,
    personality: "JARVIS", sessionId: null,
    thinking: false, streaming: false,
    streamEl: null, streamBuf: "",
    listening: false,
    phase: "idle", // idle | wakeword | command | manual
    wakeWordEnabled: true,
    autoSend: true,
    micBlocked: false,
    voiceNames: null,
    reconnectDelay: 1000,
  };

  // Remembered settings
  function loadPref(k, def) { try { var v = localStorage.getItem("jarvis_" + k); return v === null ? def : v === "1"; } catch (e) { return def; } }
  function savePref(k, v)   { try { localStorage.setItem("jarvis_" + k, v ? "1" : "0"); } catch (e) {} }
  S.wakeWordEnabled = loadPref("wake", true);
  S.autoSend        = loadPref("autosend", true);

  // Stable id → the server keeps your memory across reloads/reconnects
  function clientId() {
    try {
      var id = localStorage.getItem("jarvis_cid");
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
           : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
        localStorage.setItem("jarvis_cid", id);
      }
      return id;
    } catch (e) { return "anon" + Math.random().toString(36).slice(2, 14); }
  }

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const D = {
    chat: $("chat-container"), input: $("text-input"),
    sendBtn: $("send-btn"), micBtn: $("mic-btn"),
    arcCanvas: $("arcCanvas"), arcStatus: $("arc-status"), arcHint: $("arc-hint"),
    waveCanvas: $("waveCanvas"), bgCanvas: $("bgCanvas"), clock: $("clock"),
    cmdLog: $("cmd-log"), actionText: $("action-text"), footerStat: $("footer-status"),
    toasts: $("toast-container"),
    settingsBtn: $("settings-btn"), settingsPanel: $("settings-panel"),
    settingsOverlay: $("settings-overlay"), settingsClose: $("settings-close-btn"),
    wakeToggle: $("wake-word-toggle"),
    exportTxt: $("export-txt-btn"), exportJson: $("export-json-btn"),
    sessionDisp: $("session-id-display"), ttsModeDisp: $("tts-mode-display"),
    ollamaDisp: $("ollama-status-display"),
    initGreet: $("initial-greeting"), initSender: $("initial-sender"),
    statWsFill: $("stat-ws"), statWsVal: $("stat-ws-val"),
    statAiFill: $("stat-ai"), statAiVal: $("stat-ai-val"),
    statVoFill: $("stat-voice"), statVoVal: $("stat-voice-val"),
    wakeWordStat: $("wake-word-stat"),
    dotWs: $("dot-ws"), dotAi: $("dot-ai"), dotVo: $("dot-voice"),
  };

  // ════════════════════════════════════════════════════════════════════════════
  // WEBSOCKET
  // ════════════════════════════════════════════════════════════════════════════
  let _reconTimer = null;

  function connectWS() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    try { S.ws = new WebSocket(proto + "//" + location.host + "/?cid=" + encodeURIComponent(clientId())); }
    catch { scheduleRecon(); return; }

    S.ws.onopen = function () {
      S.connected = true;
      S.reconnectDelay = 1000;
      setStat("ws", 100, "ONLINE");
      setDot("ws", true);
      setFooter("ONLINE");
      toast("Connected", "success");
      addLog("» WebSocket connected", "init");
      if (S.wakeWordEnabled) scheduleWakeWord(800);
    };

    S.ws.onclose = function () {
      S.connected = false;
      S.thinking = false;
      S.streaming = false;          // otherwise the mic stays dead after a dropped connection
      S.streamEl = null; S.streamBuf = "";
      rmEl("thinking-msg");
      if (S.phase === "command" || S.phase === "manual" || S.phase === "activating") { stopAllRec(); S.phase = "idle"; setListening(false); }
      setStat("ws", 0, "OFFLINE");
      setStat("ai", 0, "OFFLINE");
      setDot("ws", false);
      setFooter("OFFLINE");
      addLog("» Connection lost — reconnecting…", "error");
      scheduleRecon();
    };

    S.ws.onerror = function () {};

    S.ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      onMsg(m);
    };

  }

  // one keep-alive timer (it used to add another one on every reconnect)
  setInterval(function () {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) S.ws.send(JSON.stringify({ type: "ping" }));
  }, 20000);

  // Safety net: if the mic ever ends up idle for no reason, bring wake-word listening back
  setInterval(function () {
    if (S.wakeWordEnabled && S.connected && !S.micBlocked && S.phase === "idle" &&
        !S.thinking && !S.streaming && !speaking) scheduleWakeWord(100);
  }, 4000);

  function scheduleRecon() {
    clearTimeout(_reconTimer);
    _reconTimer = setTimeout(connectWS, Math.min(S.reconnectDelay, 10000));
    S.reconnectDelay = Math.min(S.reconnectDelay * 1.5, 10000);
  }

  function wsSend(obj) {
    if (S.ws && S.ws.readyState === WebSocket.OPEN) {
      S.ws.send(JSON.stringify(obj));
      return true;
    }
    toast("Not connected to server", "error");
    return false;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // MESSAGE HANDLER
  // ════════════════════════════════════════════════════════════════════════════
  function onMsg(m) {
    switch (m.type) {

      case "init":
        S.sessionId = m.sessionId;
        S.personality = m.personality || "JARVIS";
        if (D.sessionDisp) D.sessionDisp.textContent = m.sessionId.slice(0, 8) + "…";
        setPersonalityUI(S.personality);
        setStat("ai", 92, "ONLINE");
        if (m.message) {
          if (D.initGreet)  D.initGreet.textContent  = m.message;
          if (D.initSender) D.initSender.textContent = pName(S.personality);
          ttsSpeak(m.message);
        }
        fetchStatus();
        if (S.wakeWordEnabled) scheduleWakeWord(1200);
        break;

      case "pong": break;

      case "user_message":
        addMsg("user", m.text);
        addLog("» " + m.text.slice(0, 40), "user");
        break;

      case "thinking":
        setThinking(m.state);
        break;

      case "stream_start":
        S.streaming = true;
        S.streamBuf = "";
        rmEl("thinking-msg");
        S.streamEl = addMsg("jarvis", "");
        if (S.streamEl) S.streamEl.classList.add("stream-cursor");
        setStat("ai", 100, "PROCESSING");
        setArc("PROCESSING");
        break;

      case "stream_chunk":
        if (S.streamEl) {
          S.streamBuf += (m.text || "");
          var el = S.streamEl.querySelector(".msg-text");
          // hide the {"action":…} JSON while it streams (even a half-finished one)
          if (el) {
            el.textContent = S.streamBuf.replace(/\{[^{}]{0,400}\}/g, "").replace(/\{[^}]*$/, "").replace(/```(?:json)?/g, "").trimStart();
            scrollChat();
          }
        }
        break;

      case "stream_end":
        S.streaming = false;
        if (S.streamEl) {
          S.streamEl.classList.remove("stream-cursor");
          var el2 = S.streamEl.querySelector(".msg-text");
          if (el2) {
            var cleaned = S.streamBuf
              .replace(/\{[^{}]{0,400}\}/g, "")
              .replace(/\{[^}]*$/, "")
              .replace(/```(?:json)?/g, "")
              .replace(/\s{2,}/g, " ")
              .trim();
            if (cleaned) { el2.textContent = cleaned; ttsSpeak(cleaned, true); }
            else if (S.streamEl.parentNode) S.streamEl.parentNode.removeChild(S.streamEl);   // no empty "…" bubble
          }
          S.streamEl = null;
        }
        S.streamBuf = "";
        setStat("ai", 92, "ONLINE");
        setArc("STANDBY");
        // Resume listening after AI responds
        if (S.wakeWordEnabled && S.phase !== "manual") {
          setTimeout(function () { scheduleWakeWord(600); }, 300);
        }
        break;

      case "jarvis_response":
        if (m.text) { addMsg("jarvis", m.text); ttsSpeak(m.text, true); }
        if (S.wakeWordEnabled && S.phase !== "manual") {
          setTimeout(function () { scheduleWakeWord(600); }, 300);
        }
        break;

      case "action_start":
        var lbl = aLabel(m.action);
        if (D.actionText) D.actionText.textContent = lbl;
        addLog("⚡ " + lbl, "action");
        addMsg("action", "⚡ " + lbl);
        setArc("EXECUTING");
        break;

      case "action_done":
        if (m.result) { addMsg("action", "✓ " + m.result); toast(m.result, "success"); }
        setArc("STANDBY");
        break;

      case "action_error":
        addMsg("action", "✗ " + m.error);
        toast("Error: " + m.error, "error");
        setArc("STANDBY");
        break;

      case "personality_changed":
        S.personality = m.personality;
        setPersonalityUI(m.personality);
        if (m.greeting) { addMsg("jarvis", m.greeting); ttsSpeak(m.greeting); }
        toast("Switched to " + m.personality, "success");
        break;

      case "export_done":
        toast("Exported: " + m.filename, "success");
        break;

      case "error":
        toast(m.message || "Unknown error", "error");
        setThinking(false);
        if (S.wakeWordEnabled && S.phase !== "manual") scheduleWakeWord(600);
        break;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // TTS — Kokoro / ElevenLabs (from the server) → otherwise the normal browser voice
  //
  // The mic is NEVER opened while Jarvis is talking (it used to transcribe its own
  // "Yes, sir?" as your command). Anything that wants the mic calls whenQuiet().
  // ════════════════════════════════════════════════════════════════════════════
  var SYN = window.speechSynthesis;
  var voices = [];
  var serverTTSOff = false;           // server said "nothing available" → stop asking, use browser voice
  var kAudio = null, kCtrl = null, kReq = 0;
  var speaking = false;
  var speechQ = [];                   // queued lines (e.g. an action result after the AI's sentence)
  var speechWaiters = [];             // callbacks waiting for silence
  var quietTimer = null, speakGuard = null;

  function loadVoices() { if (SYN) voices = SYN.getVoices(); }
  loadVoices();
  if (SYN) SYN.onvoiceschanged = loadVoices;

  // ── Silence tracking ─────────────────────────────────────────────────────────
  function whenQuiet(fn) {
    if (speechWaiters.indexOf(fn) < 0) speechWaiters.push(fn);
    pumpWaiters();
  }
  function pumpWaiters() {
    clearTimeout(quietTimer);
    if (speaking) return;
    // small tail so the speaker's last sound doesn't leak into the mic
    quietTimer = setTimeout(function () {
      if (speaking) return;
      var w = speechWaiters.splice(0);
      for (var i = 0; i < w.length; i++) { try { w[i](); } catch (e) { console.warn(e); } }
    }, 350);
  }

  function finishSpeech(id) {
    if (id !== kReq) return;          // a newer line already took over
    clearTimeout(speakGuard);
    kAudio = null;
    speaking = false;
    if (speechQ.length) { playSpeech(speechQ.shift()); return; }
    pumpWaiters();
  }

  // Stops everything that's speaking (Kokoro audio, in-flight request, browser voice, queue)
  function stopSpeech() {
    kReq++;                           // invalidate pending requests/callbacks
    clearTimeout(speakGuard);
    speechQ = [];
    if (kCtrl)  { try { kCtrl.abort(); } catch (e) {} kCtrl = null; }
    if (kAudio) { try { kAudio.pause(); } catch (e) {} kAudio = null; }
    if (SYN) SYN.cancel();
    speaking = false;
    pumpWaiters();
  }

  function speechText(text) {
    var clean = String(text || "")
      .replace(/\{[^{}]{0,400}\}/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`[^`]*`/g, "")
      .replace(/#{1,6}\s/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/\n+/g, " ")
      .replace(/\.{2,}/g, ".")
      .trim();
    if (!clean) return "";

    // Summarize if too long: whole sentences, max 200 chars
    if (clean.length > 200) {
      var sents = clean.match(/[^.!?]+[.!?]+/g) || [];
      var summ = "";
      for (var i = 0; i < sents.length; i++) {
        if ((summ + sents[i]).length > 200) break;
        summ += sents[i].trim() + " ";
      }
      clean = summ.trim() || clean.slice(0, 200);
    }
    return clean;
  }

  // queue=true → wait for whatever is speaking now (used for action results)
  function ttsSpeak(text, queue) {
    var clean = speechText(text);
    if (!clean) return;
    if (queue && speaking) { speechQ.push(clean); return; }
    stopSpeech();
    playSpeech(clean);
  }

  function playSpeech(clean) {
    speaking = true;
    // never leave the wake-word mic open while Jarvis talks (it would hear itself)
    if (S.phase === "wakeword") { stopAllRec(); S.phase = "idle"; }
    var id = ++kReq;
    if (serverTTSOff || !window.fetch || !window.AbortController) { speakBrowser(clean, id); return; }
    speakServer(clean, id);
  }

  // Ask the server for Kokoro/ElevenLabs audio. ANY problem (not installed, still loading,
  // error, timeout, autoplay blocked) → fall back to the normal browser voice.
  function speakServer(clean, id) {
    var ctrl = kCtrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);

    fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, personality: S.personality }),
      signal: ctrl.signal
    })
      .then(function (r) {
        if (r.status === 501) serverTTSOff = true;    // permanently unavailable on this server
        if (!r.ok) throw new Error("tts " + r.status);
        return r.blob();
      })
      .then(function (blob) {
        clearTimeout(timer);
        if (id !== kReq) return;                      // a newer message took over
        var url = URL.createObjectURL(blob);
        var a = kAudio = new Audio(url);
        var done = function () { URL.revokeObjectURL(url); finishSpeech(id); };
        a.onended = done;
        a.onerror = function () { URL.revokeObjectURL(url); if (id === kReq) speakBrowser(clean, id); };
        clearTimeout(speakGuard);
        speakGuard = setTimeout(done, 60000);         // never get stuck "speaking"
        return a.play();
      })
      .catch(function () {
        clearTimeout(timer);
        if (id === kReq) speakBrowser(clean, id);     // still the latest request → normal voice
      });
  }

  function pickVoice(p) {
    if (!voices.length) return null;
    var pref = (S.voiceNames && S.voiceNames[p] || "").toLowerCase();
    var v = null;
    if (pref) v = voices.find(function (x) { return x.name.toLowerCase().indexOf(pref) !== -1 && x.lang.indexOf("en") === 0; });
    if (v) return v;
    if (p === "JARVIS") {
      return voices.find(function (x) { return /daniel/i.test(x.name) && x.lang.indexOf("en") === 0; })
          || voices.find(function (x) { return /uk.*male|google uk.*male/i.test(x.name); })
          || voices.find(function (x) { return x.lang === "en-GB"; })
          || voices.find(function (x) { return x.lang.indexOf("en") === 0; });
    }
    if (p === "FRIDAY") {
      return voices.find(function (x) { return /moira|karen|samantha|fiona/i.test(x.name); })
          || voices.find(function (x) { return x.lang.indexOf("en") === 0; });
    }
    return voices.find(function (x) { return /alex|fred|ralph/i.test(x.name); })
        || voices.find(function (x) { return x.lang === "en-US"; })
        || voices.find(function (x) { return x.lang.indexOf("en") === 0; });
  }

  function speakBrowser(clean, id) {
    if (!SYN || !clean) { finishSpeech(id); return; }
    if (voices.length === 0) loadVoices();
    var p = S.personality;
    var utt = new SpeechSynthesisUtterance(clean);
    utt.rate   = p === "ULTRON" ? 0.85 : p === "FRIDAY" ? 1.05 : 0.93;
    utt.pitch  = p === "ULTRON" ? 0.6  : p === "FRIDAY" ? 1.1  : 1.0;
    utt.volume = 1;
    var v = pickVoice(p);
    if (v) { utt.voice = v; utt.lang = v.lang; }

    var done = function () { finishSpeech(id); };
    utt.onend = done;
    utt.onerror = done;
    // Chrome sometimes never fires onend — don't let that freeze the mic forever
    clearTimeout(speakGuard);
    speakGuard = setTimeout(done, Math.min(30000, 3000 + clean.length * 110));
    SYN.speak(utt);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SPEECH RECOGNITION — TWO-PHASE SYSTEM
  //
  // Phase 1 (wakeword): continuous listening for "Hey JARVIS" / "Hey FRIDAY" / "Ultron".
  //   Fuzzy matching (it hears "Travis", "jar vis", "Jervis"…) and it also catches a command
  //   said in the SAME breath: "Jarvis open Spotify" runs immediately.
  // Phase 2 (command): after the wake word, listens for your command, sends on silence.
  // Manual: hold the mic button / SPACE → speak → release (waits for the last words).
  //
  // The mic stays CLOSED while Jarvis is speaking, so it can't hear itself.
  // ════════════════════════════════════════════════════════════════════════════
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var SR_LANG = "en-US";

  var gen = 0;                        // bumps whenever recognizers are replaced → stale events are ignored
  var wakeRec = null, cmdRec = null, manRec = null;
  var _wakeTimer = null, _silTimer = null, _idleTimer = null, _settleTimer = null, _manTimer = null;
  var cmdFinal = "", cmdInterim = "";
  var manFinal = "", manInterim = "", manStopping = false;
  var netFails = 0;

  var WAKE = {
    JARVIS: { name: "jarvis", anywhere: true  },
    FRIDAY: { name: "friday", anywhere: false },   // "friday" is a normal word → only at the start or after "hey"
    ULTRON: { name: "ultron", anywhere: true  },
  };
  var PREFIX = { hey: 1, hi: 1, ok: 1, okay: 1, yo: 1, hello: 1, hay: 1, hei: 1, a: 1 };
  var ACKS = { JARVIS: "Yes, sir?", FRIDAY: "Yeah, boss?", ULTRON: "State your purpose." };

  function lev(a, b) {
    var m = a.length, n = b.length, i, j;
    if (!m) return n; if (!n) return m;
    var prev = [], cur = [];
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
      }
      var t = prev; prev = cur; cur = t;
    }
    return prev[n];
  }

  // → { personality, end } (end = index in text just after the wake word) or null
  function findWake(text) {
    var re = /[A-Za-z0-9']+/g, toks = [], m;
    while ((m = re.exec(text))) toks.push({ w: m[0].toLowerCase().replace(/'/g, ""), end: m.index + m[0].length });
    var keys = Object.keys(WAKE);
    keys.sort(function (a, b) { return (b === S.personality) - (a === S.personality); });   // current personality first

    for (var t = 0; t < toks.length; t++) {
      var prefixed = t > 0 && PREFIX[toks[t - 1].w] === 1;
      var cands = [{ w: toks[t].w, end: toks[t].end }];
      if (t + 1 < toks.length) cands.push({ w: toks[t].w + toks[t + 1].w, end: toks[t + 1].end });   // "jar vis"
      for (var k = 0; k < keys.length; k++) {
        var W = WAKE[keys[k]];
        if (!(W.anywhere || prefixed || t === 0)) continue;
        for (var c = 0; c < cands.length; c++) {
          if (cands[c].w.length < 4) continue;
          var maxD = prefixed ? 2 : 1;               // "hey travis" is fine, bare "travis" isn't
          if (lev(cands[c].w, W.name) <= maxD) return { personality: keys[k], end: cands[c].end };
        }
      }
    }
    return null;
  }

  function newRec(continuous, alts) {
    var r = new SR();
    r.lang = SR_LANG;
    r.continuous = continuous;
    r.interimResults = true;
    r.maxAlternatives = alts || 1;
    return r;
  }

  function hint(t) { if (D.arcHint) D.arcHint.textContent = t; }

  function micProblem(ev) {
    var e = ev && ev.error;
    if (e === "not-allowed" || e === "service-not-allowed") {
      S.micBlocked = true;
      toast("Microphone blocked — click the 🔒 in the address bar and allow the mic, then reload", "error");
      setStat("voice", 0, "BLOCKED"); setListening(false); S.phase = "idle"; hint("MIC BLOCKED");
      return true;
    }
    if (e === "audio-capture") {
      S.micBlocked = true;
      toast("No microphone found", "error");
      setStat("voice", 0, "NO MIC"); setListening(false); S.phase = "idle"; hint("NO MIC FOUND");
      return true;
    }
    if (e === "network") {
      netFails++;
      if (netFails === 1 || netFails % 6 === 0) toast("Speech recognition needs internet (Chrome sends audio to Google)", "warning");
    }
    return false;
  }

  // ── Phase 1: Wake word ───────────────────────────────────────────────────────
  function scheduleWakeWord(delay) {
    if (!SR || !S.wakeWordEnabled || !S.connected || S.micBlocked) return;
    if (S.phase === "command" || S.phase === "manual" || S.phase === "activating") return;
    clearTimeout(_wakeTimer);
    var backoff = netFails > 2 ? Math.min(1000 * netFails, 8000) : 0;
    _wakeTimer = setTimeout(function () { whenQuiet(startWakePhase); }, (delay || 300) + backoff);
  }

  function startWakePhase() {
    if (!SR || !S.wakeWordEnabled || !S.connected || S.micBlocked) return;
    if (S.phase === "command" || S.phase === "manual" || S.phase === "activating") return;
    if (S.thinking || S.streaming) { scheduleWakeWord(800); return; }

    stopAllRec();
    S.phase = "wakeword";
    setArc("STANDBY");
    hint('SAY: "HEY ' + S.personality + '"');
    setStat("voice", 60, "WAKE WORD");
    setDot("vo", true);

    var g = gen, handled = false, pending = null;
    var rec = wakeRec = newRec(true, 5);

    function fire() {
      if (handled || g !== gen || !pending) return;
      handled = true;
      wakeDetected(pending.p, pending.rest);
    }

    rec.onresult = function (ev) {
      if (g !== gen || handled) return;
      netFails = 0;
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        var res = ev.results[i], hit = null;
        for (var j = 0; j < res.length && !hit; j++) {          // check every alternative
          var h = findWake(res[j].transcript);
          if (h) hit = { p: h.personality, rest: res[j].transcript.slice(h.end).replace(/^[\s,.:;!?\-]+/, "").trim() };
        }
        if (!hit) { hint('HEARD: "' + res[0].transcript.trim().slice(-36) + '"'); continue; }
        pending = hit;
        clearTimeout(_settleTimer);
        if (res.isFinal) fire();
        else _settleTimer = setTimeout(fire, 1100);              // give "Jarvis open Spotify" time to finish
      }
    };

    rec.onerror = function (ev) {
      if (g !== gen) return;
      micProblem(ev);                                           // no-speech / aborted → onend restarts
    };

    rec.onend = function () {
      if (g !== gen) return;
      if (pending && !handled) { fire(); return; }
      if (S.phase === "wakeword") scheduleWakeWord(250);        // Chrome ends sessions on its own — just restart
    };

    try { rec.start(); }
    catch (e) { scheduleWakeWord(600); }
  }

  function wakeDetected(personality, rest) {
    stopAllRec();
    S.phase = "activating";
    setArc("ACTIVATED");
    hint("WAKE WORD DETECTED");
    addLog("» Wake word: " + personality, "init");

    var switching = personality !== S.personality;
    if (switching) wsSend({ type: "set_personality", personality: personality });

    // Command said in the same breath → run it right away
    if (rest && rest.length > 1) { S.phase = "idle"; sendCommand(rest); return; }

    if (!switching) ttsSpeak(ACKS[personality] || "Yes?");      // (the switch greeting is the ack otherwise)
    // Open the mic only after the acknowledgement has finished playing
    whenQuiet(function () { if (S.phase === "activating") startCommandPhase(); });
  }

  // ── Phase 2: Command ─────────────────────────────────────────────────────────
  function startCommandPhase() {
    if (!SR || !S.connected) return;
    stopAllRec();
    S.phase = "command";
    cmdFinal = ""; cmdInterim = "";

    var g = gen, heard = false;
    var rec = cmdRec = newRec(true, 1);

    rec.onstart = function () {
      if (g !== gen) return;
      setListening(true);
      setArc("LISTENING");
      hint("SPEAK NOW…");
      if (D.input) D.input.placeholder = "Listening…";
    };

    rec.onresult = function (ev) {
      if (g !== gen) return;
      heard = true; netFails = 0;
      cmdInterim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) cmdFinal += ev.results[i][0].transcript + " ";
        else cmdInterim = ev.results[i][0].transcript;
      }
      if (D.input) D.input.value = (cmdFinal + cmdInterim).trim();

      var last = ev.results[ev.results.length - 1];
      clearTimeout(_idleTimer);
      clearTimeout(_silTimer);
      _silTimer = setTimeout(finishCommand, last.isFinal ? 1000 : 1800);   // silence = done speaking
    };

    rec.onerror = function (ev) { if (g === gen) micProblem(ev); };
    rec.onend   = function ()   { if (g === gen) finishCommand(); };       // never lose what you already said

    // Nothing said at all → go back to wake word
    _idleTimer = setTimeout(function () { if (g === gen && !heard) finishCommand(); }, 8000);

    try { rec.start(); }
    catch (e) { stopCommandPhase(); scheduleWakeWord(600); }
  }

  function finishCommand() {
    clearTimeout(_silTimer); clearTimeout(_idleTimer);
    if (S.phase !== "command") return;
    var t = (cmdFinal + cmdInterim).trim();
    cmdFinal = ""; cmdInterim = "";
    if (!t) { stopCommandPhase(); scheduleWakeWord(400); return; }
    if (S.autoSend) { sendCommand(t); return; }
    // auto-send OFF: leave the text in the box so you can edit it, press Enter to send
    stopAllRec(); S.phase = "idle"; setListening(false); setArc("STANDBY");
    if (D.input) { D.input.value = t; D.input.placeholder = "Type a command…"; D.input.focus(); }
  }

  function stopCommandPhase() {
    S.phase = "idle";
    stopAllRec();
    setListening(false);
    setArc("STANDBY");
    if (D.input) { D.input.value = ""; D.input.placeholder = "Type a command…"; }
  }

  // ── Manual mode (hold button / space) ────────────────────────────────────────
  function startManual() {
    if (!SR) { toast("Speech recognition unavailable — use Chrome", "error"); return; }
    if (S.micBlocked) { toast("Microphone is blocked — allow it in the address bar and reload", "error"); return; }
    if (S.thinking || S.streaming) return;
    if (S.phase === "manual") return;

    stopSpeech();                       // talking over Jarvis interrupts him
    stopAllRec();
    S.phase = "manual";
    manFinal = ""; manInterim = ""; manStopping = false;

    var g = gen;
    var rec = manRec = newRec(true, 1);

    rec.onstart = function () {
      if (g !== gen) return;
      setListening(true);
      setArc("LISTENING");
      hint("HOLD & SPEAK…");
      if (D.input) D.input.placeholder = "Listening…";
    };

    rec.onresult = function (ev) {
      if (g !== gen) return;
      manInterim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) manFinal += ev.results[i][0].transcript + " ";
        else manInterim = ev.results[i][0].transcript;
      }
      if (D.input) D.input.value = (manFinal + manInterim).trim();
    };

    rec.onerror = function (ev) { if (g === gen) micProblem(ev); };
    rec.onend   = function ()   { if (g === gen && manStopping) finishManual(); };

    try { rec.start(); }
    catch (e) { S.phase = "idle"; setListening(false); scheduleWakeWord(500); }
  }

  // Releasing the button: ask Chrome to finish, then WAIT for its final words.
  // (Sending instantly used to cut off the last word or two of every command.)
  function stopManual() {
    if (S.phase !== "manual" || manStopping) return;
    manStopping = true;
    hint("PROCESSING…");
    try { if (manRec) manRec.stop(); } catch (e) {}
    clearTimeout(_manTimer);
    _manTimer = setTimeout(finishManual, 1500);   // safety net if onend never comes
  }

  function finishManual() {
    if (!manStopping) return;
    manStopping = false;
    clearTimeout(_manTimer);
    var t = (manFinal + manInterim).trim() || (D.input ? D.input.value.trim() : "");
    stopAllRec();
    S.phase = "idle";
    setListening(false);
    setArc("STANDBY");
    if (D.input) { D.input.placeholder = "Type a command…"; D.input.value = ""; }
    if (t) sendCommand(t);
    else scheduleWakeWord(400);
  }

  function stopAllRec() {
    gen++;                                        // every handler of the old recognizers becomes a no-op
    clearTimeout(_wakeTimer); clearTimeout(_silTimer); clearTimeout(_idleTimer);
    clearTimeout(_settleTimer); clearTimeout(_manTimer);
    [wakeRec, cmdRec, manRec].forEach(function (r) {
      if (!r) return;
      r.onresult = r.onend = r.onerror = r.onstart = null;
      try { r.abort(); } catch (e) {}
    });
    wakeRec = cmdRec = manRec = null;
  }

  function initSpeech() {
    if (!SR) {
      toast("Speech recognition not available — use Chrome", "warning");
      setStat("voice", 20, "UNSUPPORTED");
      hint("VOICE UNSUPPORTED — USE CHROME");
      return;
    }
    if (!window.isSecureContext) toast("Open JARVIS at http://localhost:3000 — the mic needs localhost or https", "warning");
    setStat("voice", 75, "READY");
    setDot("vo", true);
    if (D.ttsModeDisp) D.ttsModeDisp.textContent = "Browser voice";
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUBMIT COMMAND
  // ════════════════════════════════════════════════════════════════════════════
  function sendCommand(text) {
    if (!text || !text.trim()) return;
    stopSpeech();
    stopCommandPhase();                 // clean up listeners — restarts after the AI replies

    if (!S.connected) {
      toast("Not connected to server", "error");
      scheduleWakeWord(1000);
      return;
    }

    if (!wsSend({ type: "text_input", text: text.trim() })) { scheduleWakeWord(1000); return; }
    if (D.input) D.input.value = "";
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ARC REACTOR CANVAS
  // ════════════════════════════════════════════════════════════════════════════
  var arc = { ctx: null, t: 0, rings: [], particles: [] };

  function initArc() {
    var c = D.arcCanvas;
    if (!c) return;
    arc.ctx = c.getContext("2d");
    arc.rings = [
      { r: 120, spd: 0.3,  off: 0, dash: 12 },
      { r: 100, spd: -0.5, off: 1, dash: 8  },
      { r: 80,  spd: 0.8,  off: 2, dash: 6  },
      { r: 60,  spd: -1.2, off: 3, dash: 4  },
    ];
    for (var i = 0; i < 20; i++) {
      arc.particles.push({
        a: Math.random() * Math.PI * 2,
        r: 40 + Math.random() * 90,
        spd: (Math.random() - 0.5) * 0.02,
        sz: 1 + Math.random() * 2,
      });
    }
    (function loop() { requestAnimationFrame(loop); drawArc(); })();
  }

  function drawArc() {
    var c = D.arcCanvas;
    if (!c || !arc.ctx) return;
    var ctx = arc.ctx, W = c.width, H = c.height, cx = W / 2, cy = H / 2;
    var accent = getCSS("--accent") || "#00d4ff";
    var active = S.thinking || S.streaming || S.listening || S.phase === "wakeword";
    var sm = active ? 2.5 : 1;
    arc.t += 0.016 * sm;
    ctx.clearRect(0, 0, W, H);

    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 50);
    g.addColorStop(0, accent + "55"); g.addColorStop(1, "transparent");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 50, 0, Math.PI * 2); ctx.fill();

    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    ctx.shadowColor = accent; ctx.shadowBlur = active ? 18 : 12;
    ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = accent + "77"; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(cx - 14, cy); ctx.lineTo(cx + 14, cy);
    ctx.moveTo(cx, cy - 14); ctx.lineTo(cx, cy + 14);
    ctx.stroke();

    arc.rings.forEach(function (ring) {
      ring.off += ring.spd * 0.01 * sm;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ring.off);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
      ctx.shadowColor = accent; ctx.shadowBlur = active ? 10 : 6;
      var seg = (Math.PI * 2 * ring.r) / (ring.dash * 2);
      ctx.setLineDash([seg, seg]);
      ctx.beginPath(); ctx.arc(0, 0, ring.r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.shadowBlur = 0; ctx.restore();
    });

    arc.particles.forEach(function (p) {
      p.a += p.spd * sm;
      var x = cx + Math.cos(p.a) * p.r, y = cy + Math.sin(p.a) * p.r;
      var al = Math.max(0, Math.min(255, (0.3 + Math.sin(arc.t + p.a) * 0.5) * 255));
      ctx.fillStyle = accent + Math.floor(al).toString(16).padStart(2, "0");
      ctx.shadowColor = accent; ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(x, y, p.sz, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // AUDIO WAVEFORM
  // ════════════════════════════════════════════════════════════════════════════
  var waveCtx = null, analyser = null;

  function initWaveform() {
    var c = D.waveCanvas;
    if (!c || waveCtx) return;
    waveCtx = c.getContext("2d");
    var dataArr = null;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        var aC = new (window.AudioContext || window.webkitAudioContext)();
        analyser = aC.createAnalyser();
        analyser.fftSize = 256;
        aC.createMediaStreamSource(stream).connect(analyser);
        dataArr = new Uint8Array(analyser.frequencyBinCount);
      }).catch(function () {});

    (function loop() {
      requestAnimationFrame(loop);
      var W = c.width, H = c.height;
      var accent = getCSS("--accent") || "#00d4ff";
      waveCtx.clearRect(0, 0, W, H);
      waveCtx.lineWidth = 1.5;

      if (analyser && dataArr) {
        analyser.getByteTimeDomainData(dataArr);
        waveCtx.strokeStyle = accent;
        waveCtx.shadowColor = accent; waveCtx.shadowBlur = 5;
        waveCtx.beginPath();
        for (var i = 0; i < dataArr.length; i++) {
          var y = (dataArr[i] / 128.0) * (H / 2);
          i === 0 ? waveCtx.moveTo(0, y) : waveCtx.lineTo(i * (W / dataArr.length), y);
        }
        waveCtx.stroke(); waveCtx.shadowBlur = 0;
      } else {
        var t = Date.now() * 0.001;
        var amp = S.listening ? 10 : 3;
        waveCtx.strokeStyle = accent + "55";
        waveCtx.beginPath();
        for (var x = 0; x < W; x++) {
          var y2 = H / 2 + Math.sin(x * 0.05 + t) * amp;
          x === 0 ? waveCtx.moveTo(x, y2) : waveCtx.lineTo(x, y2);
        }
        waveCtx.stroke();
      }
    })();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BACKGROUND HEX GRID
  // ════════════════════════════════════════════════════════════════════════════
  function initBg() {
    var c = D.bgCanvas;
    if (!c) return;
    var ctx = c.getContext("2d");
    function resize() { c.width = innerWidth; c.height = innerHeight; }
    resize(); window.addEventListener("resize", resize);

    var hexes = [];
    for (var i = 0; i < 40; i++) {
      hexes.push({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        r: 20 + Math.random() * 40, a: 0.02 + Math.random() * 0.06,
        spd: (Math.random() - 0.5) * 0.3,
      });
    }

    (function loop() {
      requestAnimationFrame(loop);
      var accent = getCSS("--accent") || "#00d4ff";
      ctx.clearRect(0, 0, c.width, c.height);
      hexes.forEach(function (h) {
        h.y += h.spd;
        if (h.y > c.height + 60) h.y = -60;
        if (h.y < -60) h.y = c.height + 60;
        ctx.globalAlpha = h.a; ctx.strokeStyle = accent; ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
          var ang = Math.PI / 3 * i - Math.PI / 6;
          var px = h.x + h.r * Math.cos(ang), py = h.y + h.r * Math.sin(ang);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    })();
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CLOCK
  // ════════════════════════════════════════════════════════════════════════════
  function initClock() {
    function tick() {
      var n = new Date();
      if (D.clock) D.clock.textContent = pad(n.getHours()) + ":" + pad(n.getMinutes()) + ":" + pad(n.getSeconds());
    }
    tick(); setInterval(tick, 1000);
  }
  function pad(n) { return String(n).padStart(2, "0"); }

  // ════════════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ════════════════════════════════════════════════════════════════════════════
  function addMsg(role, text) {
    if (!D.chat) return null;
    var w = document.createElement("div");
    w.className = "chat-message " + (role === "user" ? "user-msg" : role === "action" ? "action-msg" : "jarvis-msg");
    var l = document.createElement("span"); l.className = "chat-sender";
    l.textContent = role === "user" ? "YOU" : role === "action" ? "SYSTEM" : pName(S.personality);
    var b = document.createElement("div"); b.className = "msg-text"; b.textContent = text;
    w.appendChild(l); w.appendChild(b); D.chat.appendChild(w);
    scrollChat(); return w;
  }

  function scrollChat() { if (D.chat) D.chat.scrollTop = D.chat.scrollHeight; }

  function rmEl(id) { var e = document.getElementById(id); if (e) e.remove(); }

  function addLog(text, type) {
    if (!D.cmdLog) return;
    var d = document.createElement("div");
    d.className = "log-item " + (type || "init"); d.textContent = text;
    D.cmdLog.appendChild(d);
    var all = D.cmdLog.querySelectorAll(".log-item");
    if (all.length > 30) all[0].remove();
    D.cmdLog.scrollTop = D.cmdLog.scrollHeight;
  }

  function toast(msg, type) {
    if (!D.toasts) return;
    var t = document.createElement("div");
    t.className = "toast " + (type || "info"); t.textContent = msg;
    D.toasts.appendChild(t);
    setTimeout(function () {
      t.style.animation = "toast-out 0.3s ease forwards";
      setTimeout(function () { t.remove(); }, 300);
    }, 3500);
  }

  function setStat(name, pct, lbl) {
    var fk = "stat" + cap(name) + "Fill", vk = "stat" + cap(name) + "Val";
    if (D[fk]) D[fk].style.setProperty("--pct", pct + "%");
    if (D[vk]) D[vk].textContent = lbl;
  }

  function setDot(name, on) {
    var key = "dot" + (name === "voice" || name === "vo" ? "Vo" : cap(name));
    if (D[key]) D[key].classList.toggle("dim", !on);
  }

  function setThinking(on) {
    S.thinking = on;
    if (on) {
      setArc("THINKING"); setStat("ai", 100, "THINKING");
      if (!S.streamEl) {
        var d = addMsg("jarvis", "");
        if (d) {
          var p = d.querySelector(".msg-text");
          if (p) {
            p.innerHTML = '<span class="thinking-dots"><span>●</span><span>●</span><span>●</span></span>';
            d.id = "thinking-msg";
          }
        }
      }
    } else {
      rmEl("thinking-msg");
      setStat("ai", 92, "ONLINE");
    }
  }

  function setListening(on) {
    S.listening = on;
    if (D.micBtn) {
      D.micBtn.classList.toggle("listening", on);
      D.micBtn.classList.remove("processing");
    }
    setDot("vo", on);
    setStat("voice", on ? 100 : 75, on ? "ACTIVE" : "READY");
  }

  function setArc(status) { if (D.arcStatus) D.arcStatus.textContent = status; }
  function setFooter(s) { if (D.footerStat) D.footerStat.textContent = "STATUS: " + s; }

  function setPersonalityUI(p) {
    document.documentElement.setAttribute("data-personality", p);
    document.querySelectorAll(".mode-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.personality === p);
    });
    document.querySelectorAll(".personality-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.personality === p);
    });
    var el = document.getElementById("active-personality-name");
    if (el) el.textContent = pName(p);
    var ww = document.querySelector(".wake-word-highlight");
    if (ww) ww.textContent = p === "JARVIS" ? '"Hey JARVIS"' : p === "FRIDAY" ? '"Hey FRIDAY"' : '"Ultron"';
  }

  function pName(p) {
    return p === "JARVIS" ? "J.A.R.V.I.S." : p === "FRIDAY" ? "F.R.I.D.A.Y." : "U.L.T.R.O.N.";
  }

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function getCSS(v) {
    return getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  }

  function aLabel(a) {
    if (!a) return "Action";
    var m = {
      open_app: "Opening " + (a.app || "app"),
      close_app: "Closing " + (a.app || "app"),
      search_web: "Searching: " + (a.query || "…"),
      screenshot: "Taking screenshot",
      get_battery: "Checking battery",
      system: a.command || "System command",
      lock_screen: "Locking screen", sleep: "Sleeping",
      get_calendar: "Reading calendar",
      add_calendar: "Adding event: " + (a.title || "…"),
      get_clipboard: "Reading clipboard", set_clipboard: "Writing clipboard",
      create_folder: "Creating folder",
      run_shortcut: "Running: " + (a.name || "…"),
      write_file: "Saving to Desktop",
      window_left: "Snap left: " + (a.app || ""),
      window_right: "Snap right: " + (a.app || ""),
      window_fullscreen: "Fullscreen: " + (a.app || ""),
      send_message: "Message to " + (a.to || "…"),
      open_url: "Opening URL",
      type_text: "Typing: " + (a.text ? a.text.slice(0, 20) : "…"),
      move_mouse: "Mouse → (" + a.x + ", " + a.y + ")",
      click_mouse: "Clicking " + (a.button || "left"),
      double_click: "Double-clicking",
      right_click: "Right-clicking",
      scroll: "Scrolling " + (a.direction || "down"),
      key_press: "Key: " + (a.key || ""),
    };
    return m[a.action] || a.action || "Action";
  }

  function pollTTS() {
    fetch("/api/status").then(function (r) { return r.json(); }).then(function (d) {
      var t = d.tts || {};
      if (t.kokoro === "unavailable" && !t.elevenlabs) serverTTSOff = true;
      if (D.ttsModeDisp) D.ttsModeDisp.textContent = t.kokoro === "ready" ? "Kokoro ✓"
        : t.kokoro === "loading" ? (t.elevenlabs ? "ElevenLabs ✓ (Kokoro loading…)" : "Browser voice (Kokoro loading…)")
        : t.elevenlabs ? "ElevenLabs ✓" : "Browser voice";
      if (t.kokoro === "loading") setTimeout(pollTTS, 5000);
    }).catch(function () {});
  }

  function fetchStatus() {
    fetch("/api/status").then(function (r) { return r.json(); }).then(function (d) {
      if (D.ollamaDisp) {
        D.ollamaDisp.textContent = !d.ollama || !d.ollama.running
          ? "Ollama OFFLINE — run: ollama serve"
          : !d.ollama.modelFound
          ? d.model + " NOT FOUND — run: ollama pull " + d.model
          : d.model + " ✓";
      }
      var t = d.tts || {};
      if (t.voices) S.voiceNames = t.voices;
      if (t.kokoro === "unavailable" && !t.elevenlabs) serverTTSOff = true;
      if (D.ttsModeDisp) {
        D.ttsModeDisp.textContent = t.kokoro === "ready" ? "Kokoro ✓"
          : t.kokoro === "loading" ? (t.elevenlabs ? "ElevenLabs ✓ (Kokoro loading…)" : "Browser voice (Kokoro loading…)")
          : t.elevenlabs ? "ElevenLabs ✓"
          : "Browser voice";
      }
      if (t.kokoro === "loading") setTimeout(pollTTS, 5000);   // re-check until it's ready
      if (!d.ollama || !d.ollama.running)
        toast("⚠ Ollama not running — start: ollama serve", "error");
      else if (!d.ollama.modelFound)
        toast("⚠ Model not found — run: ollama pull " + d.model, "warning");
    }).catch(function () {
      if (D.ollamaDisp) D.ollamaDisp.textContent = "Server unreachable";
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EVENT LISTENERS
  // ════════════════════════════════════════════════════════════════════════════
  function initEvents() {
    // Type + send
    if (D.sendBtn) D.sendBtn.addEventListener("click", function () {
      var t = D.input && D.input.value.trim();
      if (t) sendCommand(t);
    });
    if (D.input) D.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        var t = D.input.value.trim();
        if (t) sendCommand(t);
      }
    });

    // Mic button — hold to speak
    if (D.micBtn) {
      D.micBtn.addEventListener("mousedown",  function (e) { e.preventDefault(); startManual(); });
      D.micBtn.addEventListener("mouseup",    stopManual);
      D.micBtn.addEventListener("mouseleave", function () { if (S.phase === "manual") stopManual(); });
      D.micBtn.addEventListener("touchstart", function (e) { e.preventDefault(); startManual(); }, { passive: false });
      D.micBtn.addEventListener("touchend",   stopManual);
    }

    // Space — hold to speak
    var spaceDown = false;
    window.addEventListener("keydown", function (e) {
      if (e.code === "Space" && !e.repeat && document.activeElement !== D.input) {
        e.preventDefault(); spaceDown = true; startManual();
      }
    });
    window.addEventListener("keyup", function (e) {
      if (e.code === "Space" && spaceDown) {
        e.preventDefault(); spaceDown = false; stopManual();
      }
    });

    // Quick command buttons
    document.querySelectorAll(".quick-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.cmd) sendCommand(b.dataset.cmd);
      });
    });

    // Personality switch
    document.querySelectorAll(".mode-btn, .personality-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.dataset.personality && b.dataset.personality !== S.personality) {
          wsSend({ type: "set_personality", personality: b.dataset.personality });
        }
        if (b.classList.contains("personality-btn")) closeSettings();
      });
    });

    // Settings panel
    if (D.settingsBtn) D.settingsBtn.addEventListener("click", function () {
      if (D.settingsPanel)  D.settingsPanel.classList.add("open");
      if (D.settingsOverlay) D.settingsOverlay.classList.add("active");
    });
    function closeSettings() {
      if (D.settingsPanel)  D.settingsPanel.classList.remove("open");
      if (D.settingsOverlay) D.settingsOverlay.classList.remove("active");
    }
    if (D.settingsClose)   D.settingsClose.addEventListener("click", closeSettings);
    if (D.settingsOverlay) D.settingsOverlay.addEventListener("click", closeSettings);

    // Settings → UI (they're remembered between visits)
    if (D.wakeToggle) D.wakeToggle.checked = S.wakeWordEnabled;
    if (D.wakeWordStat) D.wakeWordStat.textContent = S.wakeWordEnabled ? "ON" : "OFF";
    var autoSendToggle = document.getElementById("auto-send-toggle");
    if (autoSendToggle) {
      autoSendToggle.checked = S.autoSend;
      autoSendToggle.addEventListener("change", function (e) {
        S.autoSend = e.target.checked;
        savePref("autosend", S.autoSend);
        toast("Auto-send " + (S.autoSend ? "on" : "off — press Enter to send"), "success");
      });
    }

    // Wake word toggle
    if (D.wakeToggle) D.wakeToggle.addEventListener("change", function (e) {
      S.wakeWordEnabled = e.target.checked;
      savePref("wake", S.wakeWordEnabled);
      if (D.wakeWordStat) D.wakeWordStat.textContent = S.wakeWordEnabled ? "ON" : "OFF";
      if (S.wakeWordEnabled) {
        scheduleWakeWord(400);
      } else {
        stopAllRec();
        S.phase = "idle";
        setListening(false);
        setArc("STANDBY");
        if (D.arcHint) D.arcHint.textContent = "WAKE WORD OFF";
      }
      toast("Wake word " + (S.wakeWordEnabled ? "enabled" : "disabled"), "success");
    });

    // Export
    if (D.exportTxt)  D.exportTxt.addEventListener("click",  function () { wsSend({ type: "export_chat", format: "txt" }); });
    if (D.exportJson) D.exportJson.addEventListener("click", function () { wsSend({ type: "export_chat", format: "json" }); });

    // Start waveform on first user interaction (browser autoplay policy)
    var startWave = function () { initWaveform(); };
    document.addEventListener("click",   startWave, { once: true });
    document.addEventListener("keydown", startWave, { once: true });
    document.addEventListener("touchstart", startWave, { once: true });
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BOOT
  // ════════════════════════════════════════════════════════════════════════════
  function init() {
    initBg();
    initArc();
    initClock();
    initSpeech();
    initEvents();
    connectWS();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();
