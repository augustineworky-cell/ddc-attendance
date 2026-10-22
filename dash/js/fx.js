/* =====================================================================
   fx.js - Durga Puja particle layer (sparks rising + marigold petals drifting)

   Why it is smooth:
   - ONE canvas, ONE requestAnimationFrame loop, ~40 sprites in total
   - sprites are pre-rendered once, each frame is just drawImage()
   - no blur, no shadow, no blend modes
   - time based (dt), so speed is the same on 30 / 60 / 144 Hz screens
   - pauses when the tab is hidden, stops for "reduce motion"
   - measures its own frame time; on a slow PC it halves the particles,
     and on a very slow one it switches everything to "lite" (still pictures)
   Switch on/off with the flower button in the top bar (same button as the petals).
   ===================================================================== */
(function () {
  'use strict';
  var root = document.documentElement;
  var cv = document.getElementById('fx');
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext('2d', { alpha: true });
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, dpr = 1;
  var parts = [], raf = 0, last = 0, running = false;
  var level = 2;                   // 2 = full, 1 = half, 0 = lite (no particles)
  var measure = { n: 0, sum: 0, done: false };

  /* ---------- sprites, drawn once ---------- */
  function sprite(size, draw) {
    var c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size); return c;
  }
  var SPARK = sprite(48, function (g, s) {
    var r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,250,215,1)'); r.addColorStop(0.25, 'rgba(255,205,95,.95)');
    r.addColorStop(0.6, 'rgba(255,125,35,.35)'); r.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  });
  function petal(a, b) {
    return sprite(40, function (g, s) {
      g.translate(s / 2, s / 2);
      var gr = g.createLinearGradient(-s / 4, -s / 2, s / 4, s / 2);
      gr.addColorStop(0, a); gr.addColorStop(1, b);
      g.fillStyle = gr; g.beginPath();
      g.moveTo(0, -s * 0.46);
      g.bezierCurveTo(s * 0.42, -s * 0.18, s * 0.34, s * 0.34, 0, s * 0.46);
      g.bezierCurveTo(-s * 0.34, s * 0.34, -s * 0.42, -s * 0.18, 0, -s * 0.46);
      g.fill();
      g.strokeStyle = 'rgba(140,60,0,.25)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, -s * 0.38); g.lineTo(0, s * 0.38); g.stroke();
    });
  }
  var PETALS = [petal('#ffd86b', '#f29a1a'), petal('#ffbe4a', '#e2750b'), petal('#ff9f43', '#d9480f'), petal('#ffe49a', '#f0a730')];

  /* ---------- particles ---------- */
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function spawnSpark(p, initial) {
    p.kind = 0; p.img = SPARK;
    p.size = rnd(8, 22) * (W < 700 ? 0.8 : 1);
    p.x = rnd(0, W); p.y = initial ? rnd(0, H) : H + p.size;
    p.vy = -rnd(28, 70);                  // px per second (up)
    p.vx = rnd(-8, 14);
    p.wob = rnd(10, 34); p.wf = rnd(0.4, 1.1); p.ph = rnd(0, 6.28);
    p.life = rnd(0.55, 0.95);             // max alpha
    p.tw = rnd(1.5, 3.5);                 // flicker speed
    p.rot = 0; p.vr = 0;
  }
  function spawnPetal(p, initial) {
    p.kind = 1; p.img = PETALS[(Math.random() * PETALS.length) | 0];
    p.size = rnd(14, 26) * (W < 700 ? 0.8 : 1);
    p.x = rnd(-20, W); p.y = initial ? rnd(-20, H) : -p.size;
    p.vy = rnd(22, 48); p.vx = rnd(8, 26);
    p.wob = rnd(18, 46); p.wf = rnd(0.3, 0.8); p.ph = rnd(0, 6.28);
    p.life = rnd(0.7, 0.95); p.tw = 0;
    p.rot = rnd(0, 6.28); p.vr = rnd(-1.2, 1.2);
  }
  function build() {
    var sparks = level === 2 ? 26 : 12, petals = level === 2 ? 12 : 5;
    if (W < 700) { sparks = Math.round(sparks * 0.6); petals = Math.round(petals * 0.6); }
    parts = [];
    var i, p;
    for (i = 0; i < sparks; i++) { p = { t: 0 }; spawnSpark(p, true); parts.push(p); }
    for (i = 0; i < petals; i++) { p = { t: 0 }; spawnPetal(p, true); parts.push(p); }
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  /* ---------- the loop ---------- */
  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = (now - last) / 1000; last = now;
    if (dt <= 0) return;
    if (dt > 0.1) dt = 0.1;               // after a pause: do not jump
    adapt(dt * 1000);
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      p.t += dt;
      p.y += p.vy * dt;
      p.x += (p.vx + Math.sin(p.t * p.wf * 2 + p.ph) * p.wob * 0.5) * dt;
      var a;
      if (p.kind === 0) {                 // spark: fade in low, fade out high, flicker
        var k = p.y / H;                  // 1 bottom -> 0 top
        a = p.life * Math.min(1, (1 - k) * 6 + 0.0) * Math.min(1, k * 3.2 + 0.25);
        a *= 0.72 + 0.28 * Math.sin(p.t * p.tw + p.ph);
        if (p.y < -p.size || p.x > W + 30) spawnSpark(p, false);
        if (a <= 0.01) continue;
        ctx.globalAlpha = a;
        ctx.drawImage(p.img, p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {                            // petal: flips as it falls
        p.rot += p.vr * dt;
        if (p.y > H + p.size || p.x > W + 40) { spawnPetal(p, false); continue; }
        var flip = Math.abs(Math.cos(p.t * p.wf * 2.4 + p.ph));
        var edge = Math.min(1, p.y / 80, (H - p.y) / 120 + 0.3);
        ctx.globalAlpha = Math.max(0, p.life * edge);
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(0.35 + 0.65 * flip, 1);
        ctx.drawImage(p.img, -p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* measure ~2 s after start; step down once if the device cannot keep up */
  function adapt(ms) {
    if (measure.done) return;
    if (ms > 100) return;                 // ignore pauses
    measure.n++; measure.sum += ms;
    if (measure.n < 90) return;
    var avg = measure.sum / measure.n;
    measure = { n: 0, sum: 0, done: false };
    if (avg > 38 && level > 0) { level = 0; measure.done = true; lite(true); stop(); ctx.clearRect(0, 0, W, H); }
    else if (avg > 24 && level === 2) { level = 1; build(); }
    else measure.done = true;
  }
  function lite(on) { root.classList.toggle('fx-lite', !!on); }

  function start() {
    if (running || reduce || level === 0 || document.hidden) return;
    if (root.dataset.theme !== 'durga' || root.classList.contains('fx-off')) return;
    running = true; last = performance.now(); raf = requestAnimationFrame(frame);
  }
  function stop() { running = false; cancelAnimationFrame(raf); }

  /* ---------- wiring ---------- */
  var btn = document.getElementById('petalBtn');
  function sync() {
    var on = !btn || btn.getAttribute('aria-pressed') !== 'false';
    root.classList.toggle('fx-off', !on);
    if (on) start(); else { stop(); ctx.clearRect(0, 0, W, H); }
  }
  document.addEventListener('visibilitychange', function () {
    root.classList.toggle('tab-hidden', document.hidden);
    if (document.hidden) stop(); else start();
  });
  new MutationObserver(function () { if (root.dataset.theme === 'durga') start(); else stop(); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  if (btn) new MutationObserver(sync).observe(btn, { attributes: true, attributeFilter: ['aria-pressed'] });
  var rt = 0;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(resize, 200); });

  resize(); sync();
  window.DCC_FX = { start: start, stop: stop, level: function () { return level; } };
})();
