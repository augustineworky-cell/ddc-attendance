/* chhath.js - Staffly phone app: temporary Chhath Puja look (v107).
 * ON from 9 Nov 2026 until the end of 16 Nov 2026 (India time), then switches itself off. No push needed to remove it.
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

    /* sky + water, painted once (soft, layered, a little haze - closer to a real photo than flat bands) */
    function paintBg() {
      const [c, x] = canvas(W, H);
      const s = x.createLinearGradient(0, 0, 0, hY);
      s.addColorStop(0, '#0a0a1c'); s.addColorStop(.22, '#16142f'); s.addColorStop(.42, '#33203f'); s.addColorStop(.58, '#5e2a45');
      s.addColorStop(.72, '#9a3c45'); s.addColorStop(.84, '#cf5f3c'); s.addColorStop(.93, '#ec8e45'); s.addColorStop(.985, '#ffbf6e'); s.addColorStop(1, '#ffd08a');
      x.fillStyle = s; x.fillRect(0, 0, W, hY + 1);
      /* long thin clouds, soft-edged, lit from below */
      x.filter = 'blur(' + (lite() ? 2 : 3) + 'px)';
      for (let i = 0; i < 9; i++) {
        const k = .5 + R() * .42, cy = hY * k, cx = R() * W, cw = 70 + R() * 190, ch = 2 + R() * 4;
        x.fillStyle = k > .8 ? 'rgba(255,175,120,' + (.12 + R() * .12) + ')' : 'rgba(150,60,90,' + (.18 + R() * .15) + ')';
        x.beginPath(); x.ellipse(cx, cy, cw, ch, 0, 0, TAU); x.fill();
        x.fillStyle = 'rgba(255,200,140,' + (k > .75 ? .18 : .06) + ')'; x.beginPath(); x.ellipse(cx, cy + ch * .7, cw * .8, 1.2, 0, 0, TAU); x.fill();
      }
      x.filter = 'none';
      /* sun glow spreading through the low sky */
      const sg = x.createRadialGradient(W / 2, hY, 0, W / 2, hY, Math.max(W, 420) * .8);
      sg.addColorStop(0, 'rgba(255,210,140,.6)'); sg.addColorStop(.18, 'rgba(255,160,90,.28)'); sg.addColorStop(.5, 'rgba(220,90,70,.08)'); sg.addColorStop(1, 'rgba(255,120,60,0)');
      x.fillStyle = sg; x.fillRect(0, 0, W, hY);
      /* water: the sky mirrored, a little darker */
      const w = x.createLinearGradient(0, hY, 0, H);
      w.addColorStop(0, '#d07a4a'); w.addColorStop(.03, '#a24a40'); w.addColorStop(.12, '#6a2c3c'); w.addColorStop(.3, '#36192f'); w.addColorStop(.6, '#160e1d'); w.addColorStop(1, '#07060c');
      x.fillStyle = w; x.fillRect(0, hY, W, H - hY);
      const wg = x.createRadialGradient(W / 2, hY, 0, W / 2, hY, W * .7); wg.addColorStop(0, 'rgba(255,170,100,.35)'); wg.addColorStop(1, 'rgba(255,140,80,0)');
      x.fillStyle = wg; x.fillRect(0, hY, W, H - hY);
      /* fine wave texture: thousands of tiny light/dark dashes, tighter towards the horizon */
      for (let i = 0; i < (lite() ? 900 : 2200); i++) {
        const k = Math.pow(R(), 1.7), y = hY + 1 + k * (H - hY), len = 3 + k * 26 + R() * 8, xx = R() * W;
        const near = Math.abs(xx - W / 2) / W;
        x.fillStyle = R() < .5 ? 'rgba(255,190,140,' + ((.10 - k * .08) * (1.4 - near)) + ')' : 'rgba(10,4,12,' + (.10 + k * .12) + ')';
        x.fillRect(xx, y, len, .6 + k * 1.2);
      }
      /* evening mist sitting on the water */
      const m = x.createLinearGradient(0, hY - 10, 0, hY + 26); m.addColorStop(0, 'rgba(255,190,150,0)'); m.addColorStop(.45, 'rgba(255,190,150,.16)'); m.addColorStop(1, 'rgba(255,190,150,0)');
      x.fillStyle = m; x.fillRect(0, hY - 10, W, 36);
      /* vignette */
      const v = x.createRadialGradient(W / 2, H * .45, Math.min(W, H) * .3, W / 2, H * .45, Math.max(W, H) * .75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
      x.fillStyle = v; x.fillRect(0, 0, W, H);
      return c;
    }
    /* far shore in two hazy layers (distant tree line + nearer bank), temples, and their soft reflection */
    function paintShore() {
      const [c, x] = canvas(W, 80), base = 40;
      const line = (seed, amp, lift) => { x.beginPath(); x.moveTo(0, base + 2); for (let px = 0; px <= W; px += 3) { const t = Math.sin(px / 19 + seed) * 1.6 + Math.sin(px / 6.1 + seed * 2) * 1.1 + Math.sin(px / 3.3 + seed) * .6 + (Math.sin(px / 53 + seed) > .2 ? amp + Math.sin(px / 4.4) * 1.8 : 0); x.lineTo(px, base - lift - Math.max(0, t)); } x.lineTo(W, base + 2); x.closePath(); x.fill(); };
      x.filter = 'blur(1.2px)'; x.fillStyle = 'rgba(122,52,62,.75)'; line(1.3, 7, 4);
      x.filter = 'blur(.5px)'; x.fillStyle = '#2b1220'; line(4.1, 4, 1);
      [[W * .22, 20], [W * .8, 15]].forEach(([tx, th]) => {
        x.beginPath(); x.moveTo(tx - 10, base - 2); x.lineTo(tx - 10, base - 7); x.lineTo(tx - 6, base - 7);
        x.bezierCurveTo(tx - 6, base - th * .7, tx - 3, base - th, tx, base - th); x.bezierCurveTo(tx + 3, base - th, tx + 6, base - th * .7, tx + 6, base - 7);
        x.lineTo(tx + 10, base - 7); x.lineTo(tx + 10, base - 2); x.closePath(); x.fill();
        x.beginPath(); x.ellipse(tx, base - th - 1.2, 2.6, 1.3, 0, 0, TAU); x.fill();
        x.fillRect(tx - .5, base - th - 9, 1, 8); x.beginPath(); x.moveTo(tx + .5, base - th - 9); x.lineTo(tx + 6, base - th - 7.5); x.lineTo(tx + .5, base - th - 6); x.fill();
      });
      x.filter = 'none';
      /* reflection of the shore: flipped, squashed, faded */
      x.save(); x.globalAlpha = .35; x.filter = 'blur(1.5px)'; x.translate(0, base * 2 + 1); x.scale(1, -.55); x.drawImage(c, 0, 0, c.width, c.height * base / 80, 0, base * .9, W, base); x.restore();
      x.filter = 'none';
      return c;
    }
    /* foreground: ghat steps + sugarcane (left), devotees offering arghya (right) */
    function paintGhat() {
      const gh = H - hY, [c, x] = canvas(W, gh + 160), y0 = 160;   // y0 = the waterline (hY) inside this layer
      x.fillStyle = '#0a060b';
      /* steps going into the water */
      x.beginPath(); x.moveTo(0, y0 - 30);
      for (let i = 0; i < 5; i++) { const sx = 26 + i * 15, sy = y0 - 30 + i * 8; x.lineTo(sx, sy); x.lineTo(sx, sy + 8); }
      x.lineTo(108, y0 + 14); x.lineTo(0, y0 + 14); x.closePath(); x.fill();
      /* small diya on the top step */
      x.fillStyle = '#07050a'; x.beginPath(); x.ellipse(52, y0 - 18, 5, 2.2, 0, 0, TAU); x.fill();
      /* devotees standing in the river, soop raised to the sun: warm rim light on the sun side, then a soft reflection */
      const people = [[W * .64, y0 + 16, .78, true], [W - 74, y0 + 34, 1.02, true], [W - 34, y0 + 30, .9, false]];
      people.forEach(([px, py, ps, up]) => { const dir = px > W / 2 ? -1 : 1; x.save(); x.translate(dir * .9, -.4); devotee(x, px, py, ps, up, 'rgba(255,170,100,.55)'); x.restore(); devotee(x, px, py, ps, up); });
      x.save(); x.globalAlpha = .28; x.filter = 'blur(1.6px)';
      people.forEach(([px, py, ps, up]) => { x.save(); x.translate(0, py * 2); x.scale(1, -.8); x.translate(0, py * .25); devotee(x, px, py, ps, up, '#1a0c16'); x.restore(); });
      x.restore(); x.filter = 'none';
      return c;
    }
    function devotee(x, cx, wy, s, raised, col) {
      col = col || '#0a060b'; x.save(); x.translate(cx, wy); x.scale(s, s); x.fillStyle = col; x.strokeStyle = col; x.lineCap = 'round'; x.lineJoin = 'round';
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
      const y0 = hY; g.save(); g.strokeStyle = '#0a060b'; g.lineCap = 'round';
      [[14, -.10, 104, 0], [27, .04, 118, 1.7], [40, .16, 96, 3.1]].forEach(([bx, lean, hgt, ph]) => {
        const by = y0 - 30, sway = Math.sin(t * .9 + ph) * .035 + Math.sin(t * 2.3 + ph) * .008;
        const tx = bx + (lean + sway) * hgt, ty = by - hgt, mx = bx + (lean + sway * .3) * hgt * .5, my = by - hgt * .5;
        g.lineWidth = 2.6; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(mx, my, tx, ty); g.stroke();
        const at = (k) => { const u = 1 - k; return [u * u * bx + 2 * u * k * mx + k * k * tx, u * u * by + 2 * u * k * my + k * k * ty]; };
        g.lineWidth = 3.6; for (let n = 1; n < 7; n++) { const [nx, ny] = at(n / 7); g.beginPath(); g.moveTo(nx - 1.6, ny); g.lineTo(nx + 1.6, ny); g.stroke(); }
        g.fillStyle = '#0a060b';
        for (let l = 0; l < 7; l++) {
          const [lx, ly] = at(.62 + l * .055), side = l % 2 ? 1 : -1, len = 26 + (l % 3) * 9, fl = Math.sin(t * 1.8 + l * 1.3 + ph) * 3.5;
          const cx1 = lx + side * len * .55 + sway * 40, cy1 = ly - len * .55 + fl * .4, ex = lx + side * len + sway * 60, ey = ly + len * .25 + fl;
          g.beginPath(); g.moveTo(lx, ly - 1.3); g.quadraticCurveTo(cx1, cy1 - 2.2, ex, ey); g.quadraticCurveTo(cx1, cy1 + 1.6, lx, ly + 1.3); g.closePath(); g.fill();
        }
      });
      g.restore();
    }
    /* slow rings spreading out around the devotees standing in the water */
    const RINGS = [[.64, 16, .78], [-74, 34, 1.02], [-34, 30, .9]];
    function rings(g, t) {
      g.save(); g.lineWidth = 1;
      RINGS.forEach(([px, dy, s], i) => {
        const cx = px > 0 && px < 1 ? W * px : W + px, cy = hY + dy;
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

    let sunImg = null;
    function paintSun(r) {
      const [c, x] = canvas(r * 8, r * 8), cx = r * 4, cy = r * 4;
      const halo = x.createRadialGradient(cx, cy, r * .5, cx, cy, r * 4); halo.addColorStop(0, 'rgba(255,200,130,.65)'); halo.addColorStop(.3, 'rgba(255,160,90,.22)'); halo.addColorStop(1, 'rgba(255,140,80,0)');
      x.fillStyle = halo; x.fillRect(0, 0, r * 8, r * 8);
      x.save(); x.translate(cx, cy); x.scale(1, .93);
      const d = x.createRadialGradient(0, -r * .2, 0, 0, 0, r * 1.04); d.addColorStop(0, '#fff8e2'); d.addColorStop(.45, '#ffe0a0'); d.addColorStop(.8, '#ffb15e'); d.addColorStop(.97, 'rgba(255,140,70,.9)'); d.addColorStop(1, 'rgba(255,140,70,0)');
      x.fillStyle = d; x.beginPath(); x.arc(0, 0, r * 1.04, 0, TAU); x.fill(); x.restore();
      /* thin haze strips crossing the low sun */
      x.filter = 'blur(1.5px)'; x.fillStyle = 'rgba(190,80,70,.35)';
      [[.18, 2.2, 1.4], [.42, 1.6, 1.1], [-.15, 1.2, .9]].forEach(([dy, h, wf]) => { x.beginPath(); x.ellipse(cx + r * .2, cy + dy * r, r * wf * 1.6, h, 0, 0, TAU); x.fill(); });
      x.filter = 'none';
      return c;
    }
    function sun(g, t) {
      const r = Math.min(44, W * .1), cx = W / 2, cy = hY + r * .22;
      if (!sunImg || sunImg.r !== r) { sunImg = { r, c: paintSun(r) }; }
      g.save(); g.beginPath(); g.rect(0, 0, W, hY + .5); g.clip(); g.drawImage(sunImg.c, cx - r * 4, cy - r * 4, r * 8, r * 8); g.restore();
      /* reflection: a soft glow column + many tiny twinkling glints, wider towards the viewer */
      g.save(); g.globalCompositeOperation = 'lighter';
      if (!sunImg.col) {
        const ch = Math.round(H - hY), [cc, cx2] = canvas(r * 6, ch), m = r * 3;
        const v = cx2.createLinearGradient(0, 0, 0, ch); v.addColorStop(0, 'rgba(255,190,110,.42)'); v.addColorStop(.35, 'rgba(255,160,90,.16)'); v.addColorStop(1, 'rgba(255,150,80,0)');
        cx2.filter = 'blur(' + Math.round(r * .35) + 'px)'; cx2.fillStyle = v;
        cx2.beginPath(); cx2.moveTo(m - r * .7, 0); cx2.lineTo(m + r * .7, 0); cx2.lineTo(m + r * 1.6, ch); cx2.lineTo(m - r * 1.6, ch); cx2.closePath(); cx2.fill(); cx2.filter = 'none';
        sunImg.col = cc; sunImg.ch = ch;
      }
      g.globalAlpha = .9 + .1 * Math.sin(t * .8); g.drawImage(sunImg.col, cx - r * 3, hY, r * 6, sunImg.ch); g.globalAlpha = 1;
      const n = lite() ? 55 : 90;
      for (let i = 0; i < n; i++) {
        const k = ((i * 0.6180339) % 1), y = hY + 1 + Math.pow(k, 1.5) * (H - hY) * .85, spread = r * (.9 + k * 1.6);
        const ph = i * 2.399, xx = cx + Math.sin(ph * 3.1) * spread * (.55 + .45 * Math.sin(t * .6 + ph)), on = Math.sin(t * (1.8 + (i % 5) * .5) + ph);
        if (on < .1) continue;
        g.globalAlpha = Math.min(1, on * (1.1 - k * .7)); g.fillStyle = i % 4 ? '#ffc878' : '#fff3d2';
        g.fillRect(xx - (2 + k * 9) / 2, y, 2 + k * 9 + on * 4, .8 + k * 1.4);
      }
      g.restore(); g.globalAlpha = 1;
    }
    function ripples(g, t) {
      g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = 'rgba(255,170,120,.09)'; g.lineWidth = .8;
      for (let i = 0; i < 14; i++) {
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
      g.save(); g.strokeStyle = 'rgba(25,12,24,.75)'; g.lineWidth = 1.1; g.lineCap = 'round';
      for (const b of birds) {
        b.x += 9 * dt; if (b.x > W + 30) b.x = -40 - R() * 60;
        const f = Math.sin(t * 6 * b.s + b.ph) * 3, w = 4.6 * b.s, by = b.y + Math.sin(t * .7 + b.ph) * 4;
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
      g.drawImage(shore, 0, hY - 40, W, 80);
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
