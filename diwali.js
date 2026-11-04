/* diwali.js - Staffly phone app: temporary Diwali look (v101).
 * ON from 4 Nov 2026 until the end of 10 Nov 2026 (India time), then switches itself off. No push needed to remove it.
 * What it adds (phone app only, not the PC dashboard):
 *   - opening screen: logo with a diya flame, rising embers, "Shubh Deepavali"   (the <head> script sets html.diwali early)
 *   - login: real fireworks + distant diya lights over the existing night sky   (drawn by login-stars.js through DW.fw)
 *   - login: "Shubh Deepavali" heading and a small flame on the logo
 *   - after Punch Out: a fireworks greeting "Happy Diwali, <name>"             (app.js calls window.stafflyDiwaliPunchOut)
 * To switch it off early: delete the <script src="diwali.js"> line and the html.diwali line in index.html. */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('diwali')) return;
  const R = Math.random;
  const lite = () => document.documentElement.classList.contains('lite-gfx');

  /* ---------------- fireworks engine (used by login-stars.js and the punch-out greeting) ---------------- */
  const COLORS = [[255, 214, 150], [255, 236, 200], [255, 190, 110], [255, 244, 228], [255, 170, 120], [220, 230, 255]];
  function fireworks(opts) {
    const o = Object.assign({ gap: [1.4, 3.6], top: [110, 260] }, opts || {});
    const rockets = [], parts = []; let wait = 0.6;
    function launch(W, base) { rockets.push({ x: 50 + R() * (W - 100), y: base + 10, vx: (R() - .5) * 18, vy: -(330 + R() * 140), ty: o.top[0] + R() * (o.top[1] - o.top[0]), trail: [] }); }
    function burst(x, y) {
      const c = COLORS[Math.floor(R() * COLORS.length)], L = lite();
      const n = L ? 40 + Math.floor(R() * 25) : 70 + Math.floor(R() * 50), sp = 90 + R() * 60, willow = R() < .35;
      for (let i = 0; i < n; i++) { const a = R() * 6.283, v = sp * (.55 + .45 * Math.sqrt(R())); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: willow ? 2.2 + R() * .8 : 1.2 + R() * .7, c, h: [], fl: R() < .4, willow }); }
      parts.push({ flash: true, x, y, life: 0, max: .18 });
    }
    return function step(g, dt, W, base) {
      const L = lite();
      if ((wait -= dt) <= 0) { launch(W, base); wait = (o.gap[0] + R() * (o.gap[1] - o.gap[0])) * (L ? 1.5 : 1); }
      const prev = g.globalCompositeOperation; g.globalCompositeOperation = 'lighter'; g.lineWidth = 1;
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]; r.trail.push([r.x, r.y]); if (r.trail.length > 8) r.trail.shift();
        r.vy += 60 * dt; r.x += r.vx * dt; r.y += r.vy * dt;
        for (let j = 0; j < r.trail.length; j++) { g.globalAlpha = (j / r.trail.length) * .5; g.fillStyle = '#ffd9a0'; g.fillRect(r.trail[j][0], r.trail[j][1], 1.2, 1.2); }
        if (r.y <= r.ty || r.vy > -40) { burst(r.x, r.y); rockets.splice(i, 1); }
      }
      g.globalAlpha = 1;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life += dt; const k = p.life / p.max;
        if (k >= 1) { parts.splice(i, 1); continue; }
        if (p.flash) { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, 70); gr.addColorStop(0, 'rgba(255,240,210,' + (.35 * (1 - k)) + ')'); gr.addColorStop(1, 'rgba(255,240,210,0)'); g.fillStyle = gr; g.fillRect(p.x - 70, p.y - 70, 140, 140); continue; }
        p.h.push([p.x, p.y]); if (p.h.length > (L ? 3 : (p.willow ? 7 : 4))) p.h.shift();
        const drag = Math.pow(p.willow ? .965 : .94, dt * 60); p.vx *= drag; p.vy *= drag; p.vy += (p.willow ? 38 : 55) * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
        let a = 1 - k * k; if (p.fl && k > .5 && R() < .5) a *= .2;
        const col = p.willow && k > .4 ? '255,190,120' : p.c.join(',');
        g.strokeStyle = 'rgba(' + col + ',' + (a * .5) + ')';
        g.beginPath(); g.moveTo(p.h[0][0], p.h[0][1]); for (const q of p.h) g.lineTo(q[0], q[1]); g.stroke();
        g.fillStyle = 'rgba(' + col + ',' + a + ')'; g.fillRect(p.x - .7, p.y - .7, 1.4, 1.4);
      }
      g.globalCompositeOperation = prev; g.globalAlpha = 1;
    };
  }
  /* tiny warm lights on the ridge, flickering like diyas far away */
  function lamps(ridgePts, n) {
    const L = []; if (!ridgePts || !ridgePts.length) return () => {};
    const W = ridgePts[ridgePts.length - 1][0];
    for (let i = 0; i < n; i++) { const x = 8 + R() * (W - 16), p = ridgePts[Math.min(ridgePts.length - 1, Math.round(x / 6))]; L.push({ x, y: p[1] + 6 + R() * 26, r: .8 + R() * 1.1, ph: R() * 6.28, sp: 6 + R() * 8 }); }
    return function draw(g, t) {
      const prev = g.globalCompositeOperation; g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1;
      for (const l of L) {
        const a = .55 + .45 * Math.sin(t * l.sp + l.ph) * Math.sin(t * l.sp * .37 + l.ph);
        const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, 7); gr.addColorStop(0, 'rgba(255,190,110,' + (.5 * a) + ')'); gr.addColorStop(1, 'rgba(255,190,110,0)');
        g.fillStyle = gr; g.fillRect(l.x - 7, l.y - 7, 14, 14);
        g.fillStyle = 'rgba(255,225,170,' + a + ')'; g.beginPath(); g.arc(l.x, l.y, l.r, 0, 6.283); g.fill();
      }
      g.globalCompositeOperation = prev;
    };
  }
  window.DW = { fireworks, lamps };

  /* ---------------- login: heading + flame on the logo ---------------- */
  const FLAME = '<svg class="dw-flame" viewBox="0 0 34 54" aria-hidden="true"><path class="dw-fo" d="M17 4 C24 16 27 28 17 50 C7 28 10 16 17 4 Z"/><path class="dw-fi" d="M17 24 C20 31 21 38 17 49 C13 38 14 31 17 24 Z"/></svg>';
  function decorateLogin() {
    const card = document.querySelector('#loginView .login-card-container');
    if (card && !document.getElementById('dwGreet')) {
      const d = document.createElement('div'); d.id = 'dwGreet'; d.className = 'dw-greet'; d.setAttribute('aria-hidden', 'true');
      d.innerHTML = '<span class="dw-kicker">DEEPAVALI 2026</span><span class="dw-title">Shubh Deepavali</span><span class="dw-rule"></span>';
      document.getElementById('loginView').appendChild(d);
      place(); addEventListener('resize', place); setInterval(place, 1500);
    }
    const logo = document.querySelector('#loginView .brand-icon-wrapper');
    if (logo && !logo.querySelector('.dw-flame')) { logo.classList.add('dw-logo'); logo.insertAdjacentHTML('beforeend', FLAME); }
  }
  /* the heading sits in the open sky between the top banner and the mountains above the login card; hidden if there is no room */
  function place() {
    const d = document.getElementById('dwGreet'), lv = document.getElementById('loginView');
    if (!d || !lv) return;
    const top = (document.querySelector('#loginView .login-header-banner') || {}).getBoundingClientRect, card = document.querySelector('#loginView .login-card');
    if (!card || !lv.classList.contains('active')) { d.style.display = 'none'; return; }
    const hb = top ? document.querySelector('#loginView .login-header-banner').getBoundingClientRect().bottom : 0;
    const ct = card.getBoundingClientRect().top - 60;   // keep clear of the mountain ridge drawn just above the card
    d.style.display = '';
    const h = d.offsetHeight || 80;
    if (ct - hb < h + 16) { d.style.display = 'none'; return; }
    d.style.top = Math.round(hb + (ct - hb - h) / 2) + 'px';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateLogin); else decorateLogin();

  /* ---------------- after Punch Out: fireworks greeting ---------------- */
  window.stafflyDiwaliPunchOut = function (info) {
    info = info || {};
    const first = String(info.name || '').trim().split(/\s+/)[0] || '';
    const now = new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
    const el = document.createElement('div'); el.className = 'dw-po'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Happy Diwali');
    el.innerHTML = '<canvas class="dw-po-sky" aria-hidden="true"></canvas><div class="dw-po-body">'
      + '<span class="dw-po-k">PUNCHED OUT · ' + now.toUpperCase() + '</span>'
      + '<h2 class="dw-po-h">Happy Diwali' + (first ? ', ' + first.replace(/[<>&"]/g, '') : '') + '</h2><span class="dw-rule"></span>'
      + '<p class="dw-po-p">Thank you for today. Wishing you and your family light, health and prosperity. Shubh Deepavali from all of us at DCC.</p>'
      + (info.hours ? '<span class="dw-po-chip">' + String(info.hours).replace(/[<>&"]/g, '') + ' h today</span>' : '')
      + '</div><button type="button" class="dw-po-done">Done</button>';
    document.body.appendChild(el);
    const cv = el.querySelector('canvas'), g = cv.getContext('2d');
    const dpr = lite() ? 1 : Math.min(devicePixelRatio || 1, 2);
    let W = 0, H = 0;
    const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener('resize', size);
    const fw = fireworks({ gap: [.6, 1.4], top: [60, Math.max(140, H * .4)] });
    let last = performance.now(), on = true;
    const minGap = lite() ? 1000 / 30 : 0;
    function frame(now) {
      if (!on) return;
      if (minGap && now - last < minGap) { requestAnimationFrame(frame); return; }
      const dt = Math.min((now - last) / 1000, .05); last = now;
      g.clearRect(0, 0, W, H); fw(g, dt, W, H * .62);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    const close = () => { if (!on) return; on = false; removeEventListener('resize', size); el.classList.add('out'); setTimeout(() => el.remove(), 350); };
    el.querySelector('.dw-po-done').addEventListener('click', close);
    setTimeout(close, 15000);
  };
})();
