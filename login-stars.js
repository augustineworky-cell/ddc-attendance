/* login-stars.js - Staffly phone login: night sky behind the PIN card.
   Falling twinkling stars, a Milky Way band (painted once), bright stars, shooting stars
   in bursts, and two mountain ridges that sit just above the login card.
   Plain 2D canvas, runs only while the login screen is visible. To remove: delete the
   <script> tag in index.html (the canvas is created here). */
(function () {
  var view = document.getElementById('loginView');
  if (!view) return;
  var cv = document.createElement('canvas');
  cv.className = 'login-sky'; cv.setAttribute('aria-hidden', 'true');
  view.insertBefore(cv, view.firstChild);
  var g = cv.getContext('2d');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* v93: lighter sky on budget phones (fewer stars, lower resolution) */
  var lite = (navigator.hardwareConcurrency || 4) <= 4 || (navigator.deviceMemory || 4) <= 3;
  var gauss = function () { return Math.random() + Math.random() + Math.random() - 1.5; };
  var W = 0, H = 0, dpr = 1, mw = null, r1 = [], r2 = [], ridgeY = 0, stars = [], bright = [];

  function ridge(base, amp, seed) { var pts = []; for (var x = 0; x <= W + 6; x += 6) pts.push([x, base - amp * (0.55 * Math.sin(x / 70 + seed) + 0.3 * Math.sin(x / 29 + seed * 2.1) + 0.15 * Math.sin(x / 11 + seed * 3.7))]); return pts; }

  function paintMilky() {
    mw = document.createElement('canvas'); mw.width = W * dpr; mw.height = (H + 200) * dpr;
    var m = mw.getContext('2d'); m.scale(dpr, dpr);
    var ax = 0.42, ay = -0.91, L = Math.max(H, 700) * 1.07, x0 = W * 0.2, y0 = H + 60, i, t, o, x, y;
    m.filter = 'blur(18px)';
    for (i = 0; i < (lite ? 150 : 260); i++) { t = Math.random() * 1.3 - 0.15; o = gauss() * 42; x = x0 + ax * t * L - ay * o; y = y0 + ay * t * L + ax * o; m.globalAlpha = 0.012 + Math.random() * 0.022; m.fillStyle = '#e8ecf5'; m.beginPath(); m.ellipse(x, y, 30 + Math.random() * 45, 14 + Math.random() * 20, -1.14, 0, 6.283); m.fill(); }
    m.filter = 'blur(6px)';
    for (i = 0; i < 70; i++) { t = Math.random() * 1.2; o = gauss() * 14; x = x0 + ax * t * L - ay * o; y = y0 + ay * t * L + ax * o; m.globalAlpha = 0.10; m.fillStyle = '#000'; m.beginPath(); m.ellipse(x, y, 30 + Math.random() * 40, 6 + Math.random() * 8, -1.14, 0, 6.283); m.fill(); }
    m.filter = 'none';
    for (i = 0; i < (lite ? 1800 : 3400); i++) { t = Math.random() * 1.3 - 0.15; o = gauss() * 40; x = x0 + ax * t * L - ay * o; y = y0 + ay * t * L + ax * o; m.globalAlpha = 0.15 + Math.random() * 0.45; m.fillStyle = '#fff'; var sz = Math.random() < 0.85 ? 0.7 : 1.3; m.fillRect(x, y, sz, sz); }
  }

  function layout() {
    var w = innerWidth, h = innerHeight;
    if (w === W && h === H && mw) return place();
    W = w; H = h; dpr = Math.min(devicePixelRatio || 1, lite ? 1.5 : 2);
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    var n = Math.round((lite ? 240 : 420) * (W * H) / (390 * 844));
    stars = []; for (var i = 0; i < n; i++) { var z = Math.random(); stars.push({ x: Math.random() * W, y: Math.random() * H, z: z, r: 0.3 + z * z * 1.4, sp: 2 + z * 12, ph: Math.random() * 6.28, tw: 0.6 + Math.random() * 2.2 }); }
    paintMilky(); place();
  }
  function place() {
    var card = view.querySelector('.login-card'), top = card ? card.getBoundingClientRect().top : 0;
    var y = Math.round(top > 120 ? top - 6 : H * 0.6);
    if (y === ridgeY && bright.length) return;
    ridgeY = y;
    r1 = ridge(ridgeY - 28, 26, 1.2); r2 = ridge(ridgeY, 20, 3.9);
    bright = []; for (var i = 0; i < 14; i++) bright.push({ x: Math.random() * W, y: Math.random() * (ridgeY - 40), ph: Math.random() * 6.28, tw: 0.5 + Math.random() });
  }

  var shots = [], next = 0.5, t = 0, last = 0, on = false;
  function burst() {
    var ang = (198 + Math.random() * 14) * Math.PI / 180, vx = Math.cos(ang), vy = -Math.sin(ang);
    var n = Math.random() < 0.45 ? 2 + (Math.random() < 0.35 ? 1 : 0) : 1;
    var bx = W * (0.4 + Math.random() * 0.7), by = -30 + Math.random() * Math.min(220, ridgeY * 0.4);
    for (var i = 0; i < n; i++) shots.push({ x: bx + i * 26, y: by + i * 46, vx: vx, vy: vy, sp: 420 + Math.random() * 240, len: 150 + Math.random() * 120, life: -i * (0.12 + Math.random() * 0.2), max: 1.0 + Math.random() * 0.5 });
  }
  function glow(x, y, r, a) { var hg = g.createRadialGradient(x, y, 0, x, y, r); hg.addColorStop(0, 'rgba(255,255,255,' + a + ')'); hg.addColorStop(0.28, 'rgba(255,255,255,' + a * 0.35 + ')'); hg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = hg; g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); }

  function frame(now) {
    if (!on) return;
    var dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt;
    g.globalAlpha = 1; g.clearRect(0, 0, W, H);
    g.drawImage(mw, 0, -100 - Math.sin(t * 0.05) * 20, W, H + 200);
    g.fillStyle = '#fff';
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      if (!reduce) { s.y += s.sp * dt; if (s.y > H + 2) { s.y = -2; s.x = Math.random() * W; } }
      g.globalAlpha = (0.3 + 0.7 * s.z) * (0.55 + 0.45 * Math.sin(t * s.tw + s.ph));
      g.beginPath(); g.arc(s.x, s.y, s.r, 0, 6.283); g.fill();
    }
    g.globalAlpha = 1;
    for (i = 0; i < bright.length; i++) { var b = bright[i]; glow(b.x, b.y, 9, 0.6 + 0.4 * Math.sin(t * b.tw + b.ph)); }
    if (!reduce && (next -= dt) <= 0) { burst(); next = 0.8 + Math.random() * 1.4; }
    g.lineCap = 'round';
    for (i = shots.length - 1; i >= 0; i--) {
      var sh = shots[i]; sh.life += dt; if (sh.life < 0) continue;
      sh.x += sh.vx * sh.sp * dt; sh.y += sh.vy * sh.sp * dt;
      var k = sh.life / sh.max; if (k >= 1) { shots.splice(i, 1); continue; }
      var f = k < 0.12 ? k / 0.12 : 1 - Math.max(0, (k - 0.55) / 0.45);
      var tx = sh.x - sh.vx * sh.len, ty = sh.y - sh.vy * sh.len;
      var gr = g.createLinearGradient(sh.x, sh.y, tx, ty);
      gr.addColorStop(0, 'rgba(255,255,255,' + f + ')'); gr.addColorStop(0.25, 'rgba(225,232,255,' + 0.45 * f + ')'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = gr;
      g.globalAlpha = 0.18; g.lineWidth = 6; g.beginPath(); g.moveTo(sh.x, sh.y); g.lineTo(tx, ty); g.stroke();
      g.globalAlpha = 1; g.lineWidth = 2.2; g.beginPath(); g.moveTo(sh.x, sh.y); g.lineTo(tx, ty); g.stroke();
      glow(sh.x, sh.y, 12, f);
    }
    var hz = g.createRadialGradient(W / 2, ridgeY, 0, W / 2, ridgeY, 300); hz.addColorStop(0, 'rgba(255,255,255,.10)'); hz.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hz; g.fillRect(0, 0, W, H);
    [[r1, '#0b0b0b'], [r2, '#030303']].forEach(function (p) { g.fillStyle = p[1]; g.beginPath(); g.moveTo(0, H); p[0].forEach(function (q) { g.lineTo(q[0], q[1]); }); g.lineTo(W, H); g.closePath(); g.fill(); });
    requestAnimationFrame(frame);
  }

  function visible() { return view.offsetParent !== null || getComputedStyle(view).display !== 'none' && view.classList.contains('active'); }
  function check() {
    var want = visible() && !document.hidden;
    if (want && !on) { layout(); on = true; last = performance.now(); requestAnimationFrame(frame); }
    else if (!want && on) on = false;
  }
  addEventListener('resize', function () { if (on) layout(); });
  document.addEventListener('visibilitychange', check);
  new MutationObserver(check).observe(view, { attributes: true, attributeFilter: ['class', 'style'] });
  setInterval(check, 1500);   // card position settles after fonts / name load
  setInterval(function () { if (on) place(); }, 3000);
  check();
})();
