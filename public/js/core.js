/* ═════════════════════════════════════════════════════════════════════════════
   CORE — the animated centrepiece. Everything reacts to real state:
   standby (slow drift) · listening (mic level) · thinking (radar sweep) · speaking (pulse)
   ═════════════════════════════════════════════════════════════════════════════ */
window.Core = (function () {
  var cv, ctx, W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R = 0;
  var rgb = [255, 106, 19];
  var state = "standby", target = 0, lv = 0, spin = 1, sweepOn = 0, sweep = 0;
  var alertUntil = 0, t = 0, last = 0, lastDraw = 0;
  var eb = null;                       // per-edge brightness bucket (batched drawing)
  var N = 230, pts = [], edges = [];
  var BARS = 96;

  function col(a, c) { c = c || rgb; return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }

  function build() {
    var i, j, y, r, th;
    for (i = 0; i < N; i++) {
      y = 1 - (i / (N - 1)) * 2; r = Math.sqrt(1 - y * y); th = i * 2.399963;
      pts.push({ x: Math.cos(th) * r, y: y, z: Math.sin(th) * r, sx: 0, sy: 0, sz: 0 });
    }
    for (i = 0; i < N; i++) for (j = i + 1; j < N; j++) {
      var dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z;
      if (dx * dx + dy * dy + dz * dz < 0.125) edges.push([i, j]);
    }
  }

  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);   // retina at 2x quadruples fill cost for no visible gain here
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx = W / 2; cy = H / 2; R = Math.min(W * 0.42, H * 0.385);
  }

  function arc(r, a0, a1, w, color) {
    ctx.beginPath(); ctx.arc(cx, cy, r, a0, a1); ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    if (!ctx || !W || document.hidden) { last = ts; lastDraw = ts; return; }
    // 30 fps on standby, 45 fps while something is happening — saves a lot of GPU / battery
    var every = (state === "standby" || state === "offline") ? 33 : 22;
    if (ts - lastDraw < every) return;
    lastDraw = ts;
    var dt = Math.min(0.08, (ts - last) / 1000 || 0.033); last = ts; t += dt;

    // state → motion
    var tSpin = { standby: 1, listening: 1.6, thinking: 3.4, speaking: 2, offline: 0.3 }[state] || 1;
    spin += (tSpin - spin) * Math.min(1, dt * 3);
    sweepOn += ((state === "thinking" ? 1 : 0) - sweepOn) * Math.min(1, dt * 4);
    var tgt = state === "thinking" ? 0.22 + 0.12 * Math.sin(t * 7) : target;
    lv += (tgt - lv) * Math.min(1, dt * 12);
    sweep += dt * 2.6;

    var alert = ts < alertUntil;
    var C = alert ? [255, 50, 40] : rgb;
    var pulse = 1 + lv * 0.07 + Math.sin(t * 1.8) * 0.008;

    ctx.clearRect(0, 0, W, H);

    // soft glow
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.2);
    g.addColorStop(0, col(0.16 + lv * 0.22, C)); g.addColorStop(0.55, col(0.04, C)); g.addColorStop(1, col(0, C));
    ctx.fillStyle = g; ctx.fillRect(cx - R * 1.25, cy - R * 1.25, R * 2.5, R * 2.5);   // only where the glow is visible

    // horizontal reference lines + ticks
    ctx.lineWidth = 1; ctx.strokeStyle = col(0.22, C);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(cx - R * 1.08, cy); ctx.moveTo(cx + R * 1.08, cy); ctx.lineTo(W, cy); ctx.stroke();
    ctx.strokeStyle = col(0.35, C); ctx.beginPath();
    for (var k = 0; k < 14; k++) {
      var d = R * 1.08 + k * 11, h2 = k % 4 === 0 ? 6 : 3;
      ctx.moveTo(cx - d, cy - h2); ctx.lineTo(cx - d, cy + h2); ctx.moveTo(cx + d, cy - h2); ctx.lineTo(cx + d, cy + h2);
    }
    ctx.stroke();

    // outer ring + rotating ticks
    arc(R, 0, 6.2832, 1, col(0.3, C));
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.04 * spin);
    ctx.beginPath();
    for (var i = 0; i < 120; i++) {
      var a = (i / 120) * 6.2832, l = i % 10 === 0 ? 13 : i % 5 === 0 ? 8 : 4;
      ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R - l), Math.sin(a) * (R - l));
    }
    ctx.lineWidth = 1; ctx.strokeStyle = col(0.55, C); ctx.stroke(); ctx.restore();

    // compass labels
    ctx.font = "500 9px 'IBM Plex Mono', monospace"; ctx.fillStyle = col(0.6, C); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("000", cx, cy - R - 12); ctx.fillText("180", cx, cy + R + 12);
    ctx.fillText("090", cx + R + 18, cy); ctx.fillText("270", cx - R - 18, cy);

    // spectrum bars
    var r0 = R * 0.8;
    ctx.beginPath();
    for (i = 0; i < BARS; i++) {
      var ang = (i / BARS) * 6.2832 - 1.5708;
      var n = 0.5 + 0.5 * Math.sin(i * 0.72 + t * 3.1) * Math.sin(i * 0.29 - t * 2.3);
      var amp = 0.05 + lv * (0.35 + 0.65 * n) + (state === "standby" ? 0.04 * n : 0);
      var len = 2 + amp * R * 0.2;
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * (r0 + len), cy + Math.sin(ang) * (r0 + len));
    }
    ctx.lineWidth = 2; ctx.strokeStyle = col(0.75, C); ctx.stroke();

    // segmented arcs
    var rs = R * 0.7;
    arc(rs, 0, 6.2832, 1, col(0.18, C));
    arc(rs, t * 0.5 * spin, t * 0.5 * spin + 1.15, 3, col(0.95, C));
    arc(rs, -t * 0.8 * spin + 2.2, -t * 0.8 * spin + 2.9, 3, col(0.7, C));
    arc(rs, t * 0.3 * spin + 4.1, t * 0.3 * spin + 4.45, 3, col(0.9, C));
    ctx.save(); ctx.setLineDash([2, 7]); arc(R * 0.6, -t * 0.25 * spin, -t * 0.25 * spin + 6.2832, 1, col(0.45, C)); ctx.restore();

    // wire sphere
    var ay = t * 0.3 * spin, ax = 0.42, cY = Math.cos(ay), sY = Math.sin(ay), cX = Math.cos(ax), sX = Math.sin(ax);
    var SR = R * 0.46 * pulse;
    for (i = 0; i < N; i++) {
      var p = pts[i];
      var x2 = p.x * cY + p.z * sY, z2 = -p.x * sY + p.z * cY;
      var y3 = p.y * cX - z2 * sX, z3 = p.y * sX + z2 * cX;
      p.sx = cx + x2 * SR; p.sy = cy + y3 * SR; p.sz = z3;
    }
    // draw in 4 brightness buckets: 4 strokes instead of ~500
    if (!eb) eb = new Int8Array(edges.length);
    for (i = 0; i < edges.length; i++) {
      var dz = (pts[edges[i][0]].sz + pts[edges[i][1]].sz) * 0.25 + 0.5;       // 0..1
      eb[i] = dz < 0.25 ? 0 : dz < 0.5 ? 1 : dz < 0.75 ? 2 : 3;
    }
    var bk, e2;
    ctx.lineWidth = 0.7;
    for (bk = 0; bk < 4; bk++) {
      ctx.beginPath();
      for (i = 0; i < edges.length; i++) if (eb[i] === bk) { e2 = edges[i]; ctx.moveTo(pts[e2[0]].sx, pts[e2[0]].sy); ctx.lineTo(pts[e2[1]].sx, pts[e2[1]].sy); }
      ctx.strokeStyle = col(0.05 + bk * 0.07, C); ctx.stroke();
    }
    for (bk = 0; bk < 4; bk++) {
      var ds = 0.8 + bk * 0.5 + lv * 0.8;
      ctx.beginPath();
      for (i = 0; i < N; i++) {
        var q = pts[i], fb = Math.min(3, Math.floor((q.sz + 1) * 2));
        if (fb === bk) ctx.rect(q.sx - ds / 2, q.sy - ds / 2, ds, ds);
      }
      ctx.fillStyle = col(0.25 + bk * 0.25, C); ctx.fill();
    }

    // radar sweep (thinking)
    if (sweepOn > 0.02 && ctx.createConicGradient) {
      var cg = ctx.createConicGradient(sweep, cx, cy);
      cg.addColorStop(0, col(0, C)); cg.addColorStop(0.82, col(0, C)); cg.addColorStop(1, col(0.38 * sweepOn, C));
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, R * 0.97, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = col(0.9 * sweepOn, C); ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(sweep) * R * 0.97, cy + Math.sin(sweep) * R * 0.97); ctx.stroke();
    }

    // core point
    var cg2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.1);
    cg2.addColorStop(0, col(0.95, [255, 255, 255])); cg2.addColorStop(0.25, col(0.7 + lv * 0.3, C)); cg2.addColorStop(1, col(0, C));
    ctx.fillStyle = cg2; ctx.beginPath(); ctx.arc(cx, cy, R * 0.1, 0, 6.2832); ctx.fill();

    // brackets around the ring
    ctx.strokeStyle = col(0.7, C); ctx.lineWidth = 1.5;
    var b = R + 26, L = 14;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (s2) {
      var x = cx + s2[0] * b * 1.0, y = cy + s2[1] * Math.min(b, H / 2 - 8);
      ctx.beginPath(); ctx.moveTo(x - s2[0] * L, y); ctx.lineTo(x, y); ctx.lineTo(x, y - s2[1] * L); ctx.stroke();
    });
  }

  return {
    init: function (canvas) {
      cv = canvas; ctx = cv.getContext("2d");
      build(); resize();
      if (window.ResizeObserver) new ResizeObserver(resize).observe(cv.parentNode); else window.addEventListener("resize", resize);
      requestAnimationFrame(frame);
    },
    setState: function (s) { state = s; },
    getState: function () { return state; },
    setLevel: function (v) { target = Math.max(0, Math.min(1, v || 0)); },
    setColor: function (s) { var p = String(s).split(",").map(function (x) { return parseInt(x, 10); }); if (p.length === 3 && p.every(function (n) { return !isNaN(n); })) rgb = p; },
    alert: function (ms) { alertUntil = performance.now() + (ms || 1400); lv = 1; },
    pulse: function () { lv = Math.max(lv, 0.9); },
  };
})();
