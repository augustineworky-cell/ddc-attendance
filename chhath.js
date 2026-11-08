/* chhath.js - Staffly phone app: temporary Chhath Puja look (v107).
 * ON from 10 Nov 2026 until the end of 16 Nov 2026 (India time), then switches itself off. No push needed to remove it.
 * Login: the night sky becomes a Chhath sunset over a river ghat - the sun sinking into the water, its reflection,
 *   floating diyas, devotees offering arghya with a soop, sugarcane, the far shore and the first stars of the evening.
 *   Drawn by login-stars.js through window.CH.draw (one canvas, same light/30 fps mode on phones).
 * After Punch Out: a sunset greeting (app.js calls window.stafflyChhathPunchOut if present).
 * Preview any day: add ?theme=chhath to the URL. To switch it off early: delete the chhath lines in index.html. */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('chhath')) return;
  const R = Math.random, TAU = 6.2832;
  const lite = () => document.documentElement.classList.contains('lite-gfx');

  /* ---------------- the scene ---------------- */
  function scene() {
    let W = 0, H = 0, hY = 0, key = '', stars = [], diyas = [], birds = [], shore = null, ghat = null, bg = null;

    function build(w, h, ridgeY) {
      W = w; H = h; hY = Math.max(120, ridgeY - 78); key = w + 'x' + h + 'x' + ridgeY;
      const L = lite();
      stars = []; for (let i = 0; i < (L ? 50 : 110); i++) { const y = Math.pow(R(), 1.8) * hY * 0.55; stars.push({ x: R() * W, y, r: .35 + R() * .9, ph: R() * TAU, tw: .6 + R() * 1.8, a: 1 - y / (hY * .55) }); }
      diyas = []; for (let i = 0; i < (L ? 7 : 12); i++) diyas.push(newDiya(true));
      birds = []; for (let i = 0; i < 5; i++) birds.push({ x: W * (.15 + R() * .4) + i * 16, y: hY * (.38 + R() * .12) + (i % 2) * 7, ph: R() * TAU, s: .8 + R() * .4 });
      bg = paintBg(); shore = paintShore(); ghat = paintGhat();
    }
    const canvas = (w, h) => { const c = document.createElement('canvas'); const d = lite() ? 1 : Math.min(devicePixelRatio || 1, 2); c.width = w * d; c.height = h * d; const x = c.getContext('2d'); x.scale(d, d); return [c, x]; };

    /* sky + water, painted once */
    function paintBg() {
      const [c, x] = canvas(W, H);
      const s = x.createLinearGradient(0, 0, 0, hY);
      s.addColorStop(0, '#0b0a1f'); s.addColorStop(.30, '#1c1638'); s.addColorStop(.52, '#4a2147');
      s.addColorStop(.70, '#93324a'); s.addColorStop(.84, '#d4553a'); s.addColorStop(.94, '#f08a3a'); s.addColorStop(1, '#ffb45a');
      x.fillStyle = s; x.fillRect(0, 0, W, hY + 1);
      /* thin evening clouds lit from below */
      for (let i = 0; i < 7; i++) {
        const cy = hY * (.56 + R() * .3), cx = R() * W, cw = 90 + R() * 160;
        const g = x.createLinearGradient(0, cy - 4, 0, cy + 4); g.addColorStop(0, 'rgba(255,170,120,0)'); g.addColorStop(.5, 'rgba(255,150,110,' + (.10 + R() * .12) + ')'); g.addColorStop(1, 'rgba(120,40,70,0)');
        x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, cw, 3 + R() * 3, 0, 0, TAU); x.fill();
      }
      /* sun glow on the sky */
      const sg = x.createRadialGradient(W / 2, hY, 0, W / 2, hY, Math.max(W, 420) * .75);
      sg.addColorStop(0, 'rgba(255,200,120,.55)'); sg.addColorStop(.25, 'rgba(255,150,80,.22)'); sg.addColorStop(1, 'rgba(255,120,60,0)');
      x.fillStyle = sg; x.fillRect(0, 0, W, hY);
      /* water */
      const w = x.createLinearGradient(0, hY, 0, H);
      w.addColorStop(0, '#b4553a'); w.addColorStop(.05, '#7a2f3c'); w.addColorStop(.22, '#3a1a33'); w.addColorStop(.55, '#140e1e'); w.addColorStop(1, '#06050b');
      x.fillStyle = w; x.fillRect(0, hY, W, H - hY);
      return c;
    }
    /* far shore: low trees and two temple shikharas */
    function paintShore() {
      const [c, x] = canvas(W, 60), base = 40;
      x.fillStyle = '#2a1222';
      x.beginPath(); x.moveTo(0, 60); x.lineTo(0, base);
      for (let px = 0; px <= W; px += 4) { const t = Math.sin(px / 23) * 2 + Math.sin(px / 7.3) * 1.4 + (Math.sin(px / 61) > .3 ? 5 + Math.sin(px / 5) * 2 : 0); x.lineTo(px, base - 3 - Math.max(0, t)); }
      x.lineTo(W, 60); x.closePath(); x.fill();
      [[W * .22, 20], [W * .8, 15]].forEach(([tx, th]) => {
        x.beginPath(); x.moveTo(tx - 10, base - 2); x.lineTo(tx - 10, base - 7); x.lineTo(tx - 6, base - 7);
        x.bezierCurveTo(tx - 6, base - th * .7, tx - 3, base - th, tx, base - th); x.bezierCurveTo(tx + 3, base - th, tx + 6, base - th * .7, tx + 6, base - 7);
        x.lineTo(tx + 10, base - 7); x.lineTo(tx + 10, base - 2); x.closePath(); x.fill();
        x.beginPath(); x.ellipse(tx, base - th - 1.2, 2.6, 1.3, 0, 0, TAU); x.fill();
        x.fillRect(tx - .5, base - th - 9, 1, 8); x.beginPath(); x.moveTo(tx + .5, base - th - 9); x.lineTo(tx + 6, base - th - 7.5); x.lineTo(tx + .5, base - th - 6); x.fill();
      });
      return c;
    }
    /* foreground: ghat steps + sugarcane (left), devotees offering arghya (right) */
    function paintGhat() {
      const gh = H - hY, [c, x] = canvas(W, gh + 160), y0 = 160;   // y0 = the waterline (hY) inside this layer
      x.fillStyle = '#07050a';
      /* steps going into the water */
      x.beginPath(); x.moveTo(0, y0 - 30);
      for (let i = 0; i < 5; i++) { const sx = 26 + i * 15, sy = y0 - 30 + i * 8; x.lineTo(sx, sy); x.lineTo(sx, sy + 8); }
      x.lineTo(108, y0 + 14); x.lineTo(0, y0 + 14); x.closePath(); x.fill();
      /* small diya on the top step */
      x.fillStyle = '#07050a'; x.beginPath(); x.ellipse(52, y0 - 18, 5, 2.2, 0, 0, TAU); x.fill();
      /* devotees standing in the river, soop raised to the sun */
      devotee(x, W * .64, y0 + 16, .78, true); devotee(x, W - 74, y0 + 34, 1.02, true); devotee(x, W - 34, y0 + 30, .9, false);
      return c;
    }
    function devotee(x, cx, wy, s, raised) {
      x.save(); x.translate(cx, wy); x.scale(s, s); x.fillStyle = '#07050a'; x.strokeStyle = '#07050a'; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(-8, 0); x.lineTo(-7.5, -18); x.quadraticCurveTo(-8, -28, -4.5, -31); x.lineTo(4.5, -31); x.quadraticCurveTo(8, -28, 7.5, -18); x.lineTo(8, 0); x.closePath(); x.fill();   // torso, saree
      x.beginPath(); x.moveTo(-4.5, -31); x.quadraticCurveTo(-11, -27, -10, -12); x.lineTo(-7, -14); x.closePath(); x.fill();                                                         // pallu
      x.beginPath(); x.arc(0, -36.5, 4.6, 0, TAU); x.fill(); x.beginPath(); x.ellipse(-1.6, -37.5, 5, 6, -.25, 0, TAU); x.fill();                                                    // head + veil
      if (raised) {
        x.lineWidth = 2.6;
        x.beginPath(); x.moveTo(-4, -29); x.quadraticCurveTo(-9, -40, -6, -51); x.stroke(); x.beginPath(); x.moveTo(4, -29); x.quadraticCurveTo(9, -40, 6, -51); x.stroke();      // arms up
        x.save(); x.translate(0, -53); x.rotate(-.12);
        x.beginPath(); x.moveTo(-13, 1); x.lineTo(13, 1); x.quadraticCurveTo(15, -4, 9, -6); x.lineTo(-9, -6); x.quadraticCurveTo(-15, -4, -13, 1); x.closePath(); x.fill();       // soop (winnowing basket)
        x.beginPath(); x.arc(-6, -7.5, 2.4, 0, TAU); x.arc(-1, -8.5, 2.8, 0, TAU); x.arc(4.5, -7.5, 2.3, 0, TAU); x.fill();                                                       // fruit + thekua
        x.lineWidth = 1.2; x.beginPath(); x.moveTo(8, -6); x.lineTo(12, -15); x.stroke();                                                                                       // a stick of sugarcane
        x.restore();
      } else {
        x.lineWidth = 2.6; x.beginPath(); x.moveTo(-4, -28); x.lineTo(-1.5, -20); x.lineTo(0, -24); x.stroke(); x.beginPath(); x.moveTo(4, -28); x.lineTo(1.5, -20); x.stroke();   // hands folded
      }
      x.restore();
    }
    /* sugarcane swaying in the evening breeze (drawn every frame, a few strokes only) */
    function cane(g, t) {
      const y0 = hY; g.save(); g.strokeStyle = '#07050a'; g.lineCap = 'round';
      [[14, -.10, 104, 0], [27, .04, 118, 1.7], [40, .16, 96, 3.1]].forEach(([bx, lean, hgt, ph]) => {
        const by = y0 - 30, sway = Math.sin(t * .9 + ph) * .035 + Math.sin(t * 2.3 + ph) * .008;
        const tx = bx + (lean + sway) * hgt, ty = by - hgt, mx = bx + (lean + sway * .3) * hgt * .5, my = by - hgt * .5;
        g.lineWidth = 2.6; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(mx, my, tx, ty); g.stroke();
        const at = (k) => { const u = 1 - k; return [u * u * bx + 2 * u * k * mx + k * k * tx, u * u * by + 2 * u * k * my + k * k * ty]; };
        g.lineWidth = 3.6; for (let n = 1; n < 7; n++) { const [nx, ny] = at(n / 7); g.beginPath(); g.moveTo(nx - 1.6, ny); g.lineTo(nx + 1.6, ny); g.stroke(); }
        g.lineWidth = 1.2;
        for (let l = 0; l < 7; l++) {
          const [lx, ly] = at(.62 + l * .055), side = l % 2 ? 1 : -1, len = 26 + (l % 3) * 9, fl = Math.sin(t * 1.8 + l * 1.3 + ph) * 3.5;
          g.beginPath(); g.moveTo(lx, ly); g.quadraticCurveTo(lx + side * len * .55 + sway * 40, ly - len * .55 + fl * .4, lx + side * len + sway * 60, ly + len * .25 + fl); g.stroke();
        }
      });
      g.restore();
    }
    /* slow rings spreading out around the devotees standing in the water */
    const RINGS = [[.64, 16, .78], [-74, 34, 1.02], [-34, 30, .9]];
    function rings(g, t) {
      g.save(); g.lineWidth = 1;
      RINGS.forEach(([px, dy, s], i) => {
        const cx = px < 1 ? W * px : W + px, cy = hY + dy;
        for (let k = 0; k < 2; k++) {
          const p = (t * .35 + i * .37 + k * .5) % 1, r = (12 + p * 16) * s;
          g.strokeStyle = 'rgba(255,170,110,' + (.38 * (1 - p)) + ')';
          g.beginPath(); g.ellipse(cx, cy + p * 2 * s, r, r * .17, 0, 0, TAU); g.stroke();
        }
      });
      g.restore();
    }
    function newDiya(first) {
      const lane = R();
      return { x: first ? R() * W : -20, lane, y: hY + 10 + lane * lane * 120, v: 3 + R() * 5, ph: R() * TAU, fl: R() * TAU, s: .55 + lane * .65 };
    }

    function sun(g, t) {
      const r = Math.min(46, W * .1), cx = W / 2, cy = hY + r * .32;
      g.save(); g.beginPath(); g.rect(0, 0, W, hY); g.clip();
      const halo = g.createRadialGradient(cx, cy, r * .6, cx, cy, r * 3.2); halo.addColorStop(0, 'rgba(255,190,110,.55)'); halo.addColorStop(1, 'rgba(255,150,80,0)');
      g.fillStyle = halo; g.beginPath(); g.arc(cx, cy, r * 3.2, 0, TAU); g.fill();
      const d = g.createRadialGradient(cx, cy - r * .3, r * .1, cx, cy, r); d.addColorStop(0, '#fff3cf'); d.addColorStop(.55, '#ffc66a'); d.addColorStop(1, '#ff8a3a');
      g.fillStyle = d; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.restore();
      /* reflection: a column of broken, shimmering streaks */
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0, y = hY + 2; y < H; i++) {
        const k = (y - hY) / (H - hY), wdt = r * (1.5 - k * .6) * (.55 + .45 * Math.sin(t * 1.6 + i * 1.7)) + Math.sin(t * .9 + i) * 6;
        g.globalAlpha = Math.max(0, (.5 - k * .55)) * (.6 + .4 * Math.sin(t * 2.3 + i * 2.1));
        g.fillStyle = i % 3 ? '#ffb45a' : '#ffe2a0';
        g.fillRect(cx - wdt / 2 + Math.sin(t * 1.1 + i * .8) * 5, y, wdt, 1.4 + k * 1.6);
        y += 3 + k * 6;
      }
      g.restore(); g.globalAlpha = 1;
    }
    function ripples(g, t) {
      g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,170,120,.14)'; g.lineWidth = 1;
      for (let i = 0; i < 18; i++) {
        const y = hY + 6 + Math.pow(i / 18, 1.6) * (H - hY), x = ((i * 97.3 + t * (8 + i)) % (W + 200)) - 100, len = 30 + (i % 5) * 18;
        g.globalAlpha = .5 - i / 40; g.beginPath(); g.moveTo(x, y); g.lineTo(x + len, y); g.stroke();
      }
      g.restore(); g.globalAlpha = 1;
    }
    function drawDiyas(g, t, dt) {
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < diyas.length; i++) {
        const d = diyas[i]; d.x += d.v * dt * d.s; if (d.x > W + 20) diyas[i] = newDiya(false);
        const y = d.y + Math.sin(t * 1.3 + d.ph) * 1.8 * d.s, s = d.s, fl = .75 + .25 * Math.sin(t * 9 + d.fl) * Math.sin(t * 5.3 + d.fl);
        const gl = g.createRadialGradient(d.x, y - 3 * s, 0, d.x, y - 3 * s, 16 * s); gl.addColorStop(0, 'rgba(255,190,100,' + .5 * fl + ')'); gl.addColorStop(1, 'rgba(255,170,90,0)');
        g.fillStyle = gl; g.fillRect(d.x - 16 * s, y - 19 * s, 32 * s, 32 * s);
        g.globalAlpha = .35 * fl; g.fillStyle = '#ffb45a'; g.fillRect(d.x - 1.2 * s, y + 2 * s, 2.4 * s, 10 * s);   // reflection
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        g.fillStyle = '#1a0d12'; g.beginPath(); g.ellipse(d.x, y, 6 * s, 2.2 * s, 0, 0, Math.PI); g.fill();      // leaf boat
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = 'rgba(255,214,140,' + fl + ')'; g.beginPath(); g.ellipse(d.x, y - 3 * s, 1.3 * s, 3 * s, 0, 0, TAU); g.fill();
      }
      g.restore(); g.globalAlpha = 1;
    }
    function drawBirds(g, t, dt) {
      g.save(); g.strokeStyle = 'rgba(20,10,20,.85)'; g.lineWidth = 1.3; g.lineCap = 'round';
      for (const b of birds) {
        b.x += 9 * dt; if (b.x > W + 30) b.x = -40 - R() * 60;
        const f = Math.sin(t * 6 * b.s + b.ph) * 3, w = 6 * b.s, by = b.y + Math.sin(t * .7 + b.ph) * 4;
        g.beginPath(); g.moveTo(b.x - w, by - f); g.quadraticCurveTo(b.x - w / 2, by - 2, b.x, by); g.quadraticCurveTo(b.x + w / 2, by - 2, b.x + w, by - f); g.stroke();
      }
      g.restore();
    }

    return function draw(g, dt, t, w, h, ridgeY) {
      if (w + 'x' + h + 'x' + ridgeY !== key) build(w, h, ridgeY);
      g.drawImage(bg, 0, 0, W, H);
      for (const s of stars) { g.globalAlpha = s.a * (.45 + .55 * Math.sin(t * s.tw + s.ph)); g.fillStyle = '#fff'; g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
      sun(g, t);
      g.drawImage(shore, 0, hY - 40, W, 60);
      ripples(g, t);
      drawDiyas(g, t, dt);
      drawBirds(g, t, dt);
      g.drawImage(ghat, 0, hY - 160, W, H - hY + 160);
      cane(g, t); rings(g, t);
    };
  }
  window.CH = { scene };

  /* ---------------- login: greeting + warm ring on the logo ---------------- */
  function decorateLogin() {
    const lv = document.getElementById('loginView');
    if (lv && !document.getElementById('chGreet')) {
      const d = document.createElement('div'); d.id = 'chGreet'; d.className = 'ch-greet'; d.setAttribute('aria-hidden', 'true');
      d.innerHTML = '<span class="ch-kicker">CHHATH MAHAPARV · 2026</span><span class="ch-title">छठ पूजा की शुभकामनाएँ</span><span class="ch-rule"></span>';
      lv.appendChild(d); place(); addEventListener('resize', place); setInterval(place, 1500);
    }
    const logo = document.querySelector('#loginView .brand-icon-wrapper'); if (logo) logo.classList.add('ch-logo');
  }
  function place() {
    const d = document.getElementById('chGreet'), lv = document.getElementById('loginView'), card = document.querySelector('#loginView .login-card'), ban = document.querySelector('#loginView .login-header-banner');
    if (!d || !lv || !card || !lv.classList.contains('active')) { if (d) d.style.display = 'none'; return; }
    const hb = ban ? ban.getBoundingClientRect().bottom : 0, sky = card.getBoundingClientRect().top - 150;   // keep to the dark upper sky, clear of the sun
    d.style.display = ''; const h = d.offsetHeight || 70;
    if (sky - hb < h + 12) { d.style.display = 'none'; return; }
    d.style.top = Math.round(hb + (sky - hb - h) / 2) + 'px';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateLogin); else decorateLogin();

  /* ---------------- after Punch Out: sunset greeting ---------------- */
  window.stafflyChhathPunchOut = function (info) {
    info = info || {};
    const first = String(info.name || '').trim().split(/\s+/)[0].replace(/[<>&"]/g, '');
    const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
    const el = document.createElement('div'); el.className = 'ch-po'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Chhath Puja greeting');
    el.innerHTML = '<canvas class="ch-po-sky" aria-hidden="true"></canvas><div class="ch-po-body">'
      + '<span class="ch-po-k">PUNCHED OUT · ' + now.toUpperCase() + '</span>'
      + '<h2 class="ch-po-h">Chhath Puja ki Shubhkamnayein' + (first ? ', ' + first : '') + '</h2><span class="ch-rule"></span>'
      + '<p class="ch-po-p">Thank you for today. May Chhathi Maiya and Surya Dev bless you and your family with health and happiness. From all of us at DCC.</p>'
      + (info.hours ? '<span class="ch-po-chip">' + String(info.hours).replace(/[<>&"]/g, '') + ' h today</span>' : '')
      + '</div><button type="button" class="ch-po-done">Done</button>';
    document.body.appendChild(el);
    const cv = el.querySelector('canvas'), g = cv.getContext('2d'), dpr = lite() ? 1 : Math.min(devicePixelRatio || 1, 2), draw = scene();
    let W = 0, H = 0;
    const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener('resize', size);
    let last = performance.now(), t = 0, on = true; const minGap = lite() ? 1000 / 30 : 0;
    (function frame(n) {
      if (!on) return;
      if (minGap && n - last < minGap) { requestAnimationFrame(frame); return; }
      const dt = Math.min((n - last) / 1000, .05); last = n; t += dt;
      draw(g, dt, t, W, H, Math.round(H * .5)); requestAnimationFrame(frame);
    })(last);
    const close = () => { if (!on) return; on = false; removeEventListener('resize', size); el.classList.add('out'); setTimeout(() => el.remove(), 350); };
    el.querySelector('.ch-po-done').addEventListener('click', close); setTimeout(close, 15000);
  };
})();
