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
    reconnectDelay: 1000,
  };

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
    try { S.ws = new WebSocket(proto + "//" + location.host); }
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

    setInterval(function () {
      if (S.ws && S.ws.readyState === WebSocket.OPEN) {
        S.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);
  }

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
          if (el) { el.textContent += (m.text || ""); scrollChat(); }
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
              .replace(/\s{2,}/g, " ")
              .trim();
            el2.textContent = cleaned || "…";
            if (cleaned) ttsSpeak(cleaned);
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
        if (m.text) { addMsg("jarvis", m.text); ttsSpeak(m.text); }
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
        break;
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // BROWSER TTS — summarizes long text, picks personality voice
  // ════════════════════════════════════════════════════════════════════════════
  var SYN = window.speechSynthesis;
  var voices = [];

  function loadVoices() {
    if (SYN) voices = SYN.getVoices();
  }
  loadVoices();
  if (SYN) SYN.onvoiceschanged = loadVoices;

  function ttsSpeak(text) {
    if (!SYN || !text) return;

    var clean = text
      .replace(/\{[^{}]{0,400}\}/g, "")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/`[^`]*`/g, "")
      .replace(/#{1,6}\s/g, "")
      .replace(/https?:\/\/\S+/g, "link")
      .replace(/\n+/g, " ")
      .replace(/\.{2,}/g, ".")
      .trim();

    if (!clean) return;

    // Summarize if too long: first 2 sentences, max 200 chars
    if (clean.length > 200) {
      var sents = clean.match(/[^.!?]+[.!?]+/g) || [];
      var summ = "";
      for (var i = 0; i < sents.length; i++) {
        if ((summ + sents[i]).length > 200) break;
        summ += sents[i].trim() + " ";
      }
      clean = summ.trim() || clean.slice(0, 200);
    }

    SYN.cancel();
    if (voices.length === 0) loadVoices();

    var utt = new SpeechSynthesisUtterance(clean);
    var p = S.personality;
    utt.rate   = p === "ULTRON" ? 0.85 : p === "FRIDAY" ? 1.05 : 0.93;
    utt.pitch  = p === "ULTRON" ? 0.6  : p === "FRIDAY" ? 1.1  : 1.0;
    utt.volume = 1;

    if (voices.length > 0) {
      var v = null;
      if (p === "JARVIS") {
        v = voices.find(function (x) { return /daniel/i.test(x.name) && x.lang.startsWith("en"); })
         || voices.find(function (x) { return /uk.*male|google uk.*male/i.test(x.name); })
         || voices.find(function (x) { return x.lang === "en-GB"; })
         || voices.find(function (x) { return x.lang.startsWith("en"); });
      } else if (p === "FRIDAY") {
        v = voices.find(function (x) { return /moira|karen|samantha|fiona/i.test(x.name); })
         || voices.find(function (x) { return x.lang.startsWith("en"); });
      } else {
        v = voices.find(function (x) { return /alex|fred|ralph/i.test(x.name); })
         || voices.find(function (x) { return x.lang === "en-US"; })
         || voices.find(function (x) { return x.lang.startsWith("en"); });
      }
      if (v) utt.voice = v;
    }
    SYN.speak(utt);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SPEECH RECOGNITION — TWO-PHASE SYSTEM
  //
  // Phase 1 (wakeword): Low-profile, single-utterance recognition
  //   Detects "Hey JARVIS", "Hey FRIDAY", "Ultron" etc.
  //   On detection → plays ack tone → starts Phase 2
  //
  // Phase 2 (command): Continuous recognition with silence detection
  //   Listens for your full command
  //   2s silence → sends command → returns to Phase 1
  //
  // Manual (hold): Bypasses Phase 1 entirely
  //   Hold mic/space → speak → release → sends immediately
  // ════════════════════════════════════════════════════════════════════════════
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  // Phase 1 state
  var wakeRec   = null;
  var _wakeTimer = null;

  // Phase 2 state
  var cmdRec    = null;
  var cmdFinal  = "";
  var cmdInterim = "";
  var _silTimer  = null;

  // Manual state
  var manRec    = null;
  var manFinal  = "";
  var manInterim = "";

  var WAKE_WORDS = {
    JARVIS: ["hey jarvis", "jarvis"],
    FRIDAY: ["hey friday", "friday"],
    ULTRON: ["ultron", "hey ultron"],
  };

  // ── Phase 1: Wake word ───────────────────────────────────────────────────────
  function scheduleWakeWord(delay) {
    if (!SR || !S.wakeWordEnabled || !S.connected) return;
    if (S.phase === "command" || S.phase === "manual") return;
    clearTimeout(_wakeTimer);
    _wakeTimer = setTimeout(startWakePhase, delay || 350);
  }

  function startWakePhase() {
    if (!SR || !S.wakeWordEnabled || !S.connected) return;
    if (S.phase === "command" || S.phase === "manual") return;

    stopAllRec();
    S.phase = "wakeword";
    setArc("STANDBY");
    if (D.arcHint) D.arcHint.textContent = 'SAY: "HEY JARVIS"';
    setStat("voice", 60, "WAKE WORD");
    setDot("vo", true);

    wakeRec = new SR();
    wakeRec.continuous     = false;
    wakeRec.interimResults = false;
    wakeRec.lang           = "en-US";
    wakeRec.maxAlternatives = 3;

    wakeRec.onresult = function (ev) {
      // Check all alternatives for wake word
      for (var i = 0; i < ev.results.length; i++) {
        for (var j = 0; j < ev.results[i].length; j++) {
          var heard = ev.results[i][j].transcript.toLowerCase().trim();
          for (var personality in WAKE_WORDS) {
            var words = WAKE_WORDS[personality];
            for (var k = 0; k < words.length; k++) {
              if (heard === words[k] || heard.indexOf(words[k]) !== -1) {
                wakeDetected(personality);
                return;
              }
            }
          }
        }
      }
    };

    wakeRec.onerror = function (ev) {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
        toast("Microphone blocked — allow mic in Chrome settings", "error");
        setStat("voice", 0, "BLOCKED");
        setListening(false);
        return;
      }
      // no-speech / aborted / network → just restart
      if (S.phase === "wakeword") scheduleWakeWord(400);
    };

    wakeRec.onend = function () {
      if (S.phase === "wakeword") scheduleWakeWord(200);
    };

    try { wakeRec.start(); }
    catch (e) {
      setTimeout(function () { try { if (wakeRec) wakeRec.start(); } catch (e2) {} }, 500);
    }
  }

  function wakeDetected(personality) {
    if (personality !== S.personality) {
      wsSend({ type: "set_personality", personality: personality });
    }
    var ack = personality === "ULTRON" ? "State your purpose."
            : personality === "FRIDAY" ? "Yeah, boss?"
            : "Yes, sir?";
    ttsSpeak(ack);
    setArc("ACTIVATED");
    if (D.arcHint) D.arcHint.textContent = "WAKE WORD DETECTED";
    addLog("» Wake word: " + personality, "init");
    // Start command phase after brief pause so TTS starts
    setTimeout(startCommandPhase, 700);
  }

  // ── Phase 2: Command ─────────────────────────────────────────────────────────
  function startCommandPhase() {
    if (!SR || !S.connected) return;
    stopAllRec();
    S.phase   = "command";
    cmdFinal  = "";
    cmdInterim = "";

    cmdRec = new SR();
    cmdRec.continuous     = true;
    cmdRec.interimResults = true;
    cmdRec.lang           = "en-US";
    cmdRec.maxAlternatives = 1;

    cmdRec.onstart = function () {
      setListening(true);
      setArc("LISTENING");
      if (D.arcHint) D.arcHint.textContent = "SPEAK NOW…";
      if (D.input)   D.input.placeholder   = "Listening…";
    };

    cmdRec.onresult = function (ev) {
      cmdInterim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) cmdFinal += ev.results[i][0].transcript + " ";
        else cmdInterim = ev.results[i][0].transcript;
      }
      if (D.input) D.input.value = (cmdFinal + cmdInterim).trim();

      // Reset silence timer on every word heard
      clearTimeout(_silTimer);
      _silTimer = setTimeout(function () {
        var t = (cmdFinal + cmdInterim).trim();
        if (t) {
          cmdFinal = ""; cmdInterim = "";
          if (D.input) D.input.value = "";
          sendCommand(t);
        } else {
          stopCommandPhase();
          scheduleWakeWord(500);
        }
      }, 2000); // 2s of silence = done speaking
    };

    cmdRec.onspeechend = function () {
      // Speech stopped — fire faster
      clearTimeout(_silTimer);
      _silTimer = setTimeout(function () {
        var t = (cmdFinal + cmdInterim).trim();
        if (t) {
          cmdFinal = ""; cmdInterim = "";
          if (D.input) D.input.value = "";
          sendCommand(t);
        } else {
          stopCommandPhase();
          scheduleWakeWord(500);
        }
      }, 800);
    };

    cmdRec.onerror = function (ev) {
      if (ev.error === "not-allowed") { toast("Mic blocked", "error"); return; }
      stopCommandPhase();
      scheduleWakeWord(600);
    };

    cmdRec.onend = function () {
      if (S.phase === "command") {
        stopCommandPhase();
        scheduleWakeWord(500);
      }
    };

    try { cmdRec.start(); }
    catch (e) {
      setTimeout(function () { try { if (cmdRec) cmdRec.start(); } catch (e2) {} }, 300);
    }
  }

  function stopCommandPhase() {
    clearTimeout(_silTimer);
    S.phase = "idle";
    setListening(false);
    setArc("STANDBY");
    if (D.input) { D.input.value = ""; D.input.placeholder = "Type a command…"; }
    stopAllRec();
  }

  // ── Manual mode (hold button/space) ─────────────────────────────────────────
  function startManual() {
    if (!SR) { toast("Speech recognition unavailable", "error"); return; }
    if (S.thinking || S.streaming) return;

    stopAllRec();
    S.phase    = "manual";
    manFinal   = "";
    manInterim = "";

    manRec = new SR();
    manRec.continuous     = true;
    manRec.interimResults = true;
    manRec.lang           = "en-US";
    manRec.maxAlternatives = 1;

    manRec.onstart = function () {
      setListening(true);
      setArc("LISTENING");
      if (D.arcHint) D.arcHint.textContent = "HOLD & SPEAK…";
      if (D.input)   D.input.placeholder   = "Listening…";
    };

    manRec.onresult = function (ev) {
      manInterim = "";
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) manFinal += ev.results[i][0].transcript + " ";
        else manInterim = ev.results[i][0].transcript;
      }
      if (D.input) D.input.value = (manFinal + manInterim).trim();
    };

    manRec.onerror = function (ev) {
      if (ev.error !== "aborted") console.warn("Manual rec:", ev.error);
    };

    manRec.onend = function () {};

    try { manRec.start(); }
    catch (e) {
      setTimeout(function () { try { if (manRec) manRec.start(); } catch (e2) {} }, 200);
    }
  }

  function stopManual() {
    var t = (manFinal + manInterim).trim() || (D.input ? D.input.value.trim() : "");
    S.phase = "idle";
    setListening(false);
    setArc("STANDBY");
    if (D.input) { D.input.placeholder = "Type a command…"; D.input.value = ""; }

    try { if (manRec) manRec.stop(); } catch (e) {}
    manRec = null;

    if (t) sendCommand(t);
    else if (S.wakeWordEnabled && S.connected) setTimeout(function () { scheduleWakeWord(500); }, 200);
  }

  function stopAllRec() {
    clearTimeout(_wakeTimer);
    clearTimeout(_silTimer);
    try { if (wakeRec) wakeRec.stop(); } catch (e) {} wakeRec = null;
    try { if (cmdRec)  cmdRec.stop();  } catch (e) {} cmdRec  = null;
    try { if (manRec)  manRec.stop();  } catch (e) {} manRec  = null;
  }

  function initSpeech() {
    if (!SR) {
      toast("Speech recognition not available — use Chrome", "warning");
      setStat("voice", 20, "UNSUPPORTED");
      return;
    }
    setStat("voice", 75, "READY");
    setDot("vo", true);
    if (D.ttsModeDisp) D.ttsModeDisp.textContent = "Browser Speech API";
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SUBMIT COMMAND
  // ════════════════════════════════════════════════════════════════════════════
  function sendCommand(text) {
    if (!text || !text.trim()) return;
    if (SYN) SYN.cancel();

    stopCommandPhase(); // clean up listeners — will restart after AI replies

    if (!S.connected) {
      toast("Not connected to server", "error");
      scheduleWakeWord(1000);
      return;
    }

    wsSend({ type: "text_input", text: text.trim() });
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

  function fetchStatus() {
    fetch("/api/status").then(function (r) { return r.json(); }).then(function (d) {
      if (D.ollamaDisp) {
        D.ollamaDisp.textContent = !d.ollama || !d.ollama.running
          ? "Ollama OFFLINE — run: ollama serve"
          : !d.ollama.modelFound
          ? d.model + " NOT FOUND — run: ollama pull " + d.model
          : d.model + " ✓";
      }
      if (D.ttsModeDisp) {
        D.ttsModeDisp.textContent = d.tts && d.tts.elevenlabs ? "ElevenLabs ✓"
          : d.tts && d.tts.platform === "darwin" ? "macOS say + Browser"
          : d.tts && d.tts.platform === "win32"  ? "Windows SAPI + Browser"
          : "Browser Speech API";
      }
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

    // Wake word toggle
    if (D.wakeToggle) D.wakeToggle.addEventListener("change", function (e) {
      S.wakeWordEnabled = e.target.checked;
      if (D.wakeWordStat) D.wakeWordStat.textContent = S.wakeWordEnabled ? "ON" : "OFF";
      if (S.wakeWordEnabled) {
        scheduleWakeWord(400);
      } else {
        clearTimeout(_wakeTimer);
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
