/* Staffly dashboard - backup guardian (v104).
 * Raj (DCC204) is punched by Ignatius from the phone app. If Ignatius has NOT punched in by 10:00 (India time),
 * the backup guardian (Robin, EMP101) gets the same question here on the PC dashboard:
 *   from 10:00  -> "Raj office aaya hai?"  Yes = Raj Punch In, No = Raj absent
 *   from 17:30  -> if Raj is in: "Raj ghar ja raha hai?" Yes = Raj Punch Out
 * Server decides who is on duty (guardian_backup_due / guardian_punch, migration 19). Checks every 5 minutes. */
(function () {
  'use strict';
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const key = (w, k) => 'staffly_gdash_' + w + '_' + k + '_' + today();
  const decided = (w, k) => { try { return !!localStorage.getItem(key(w, k)); } catch (e) { return false; } };
  const remember = (w, k) => { try { localStorage.setItem(key(w, k), '1'); } catch (e) {} };
  const forget = (w, k) => { try { localStorage.removeItem(key(w, k)); } catch (e) {} };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = (t) => new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
  let open = false;

  const css = '.gq-scrim{position:fixed;inset:0;z-index:900;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;animation:k-fade .2s ease both}'
    + '.gq-card{width:min(440px,100%);background:var(--k-card);color:var(--k-ink);border-radius:var(--k-r-xl,24px);box-shadow:var(--k-pop);padding:26px 24px 22px;font-family:var(--k-sans);animation:k-pop .3s var(--k-spring) both}'
    + '.gq-k{font:600 11px/1 var(--k-sans);letter-spacing:.14em;color:var(--k-mi)}'
    + '.gq-h{margin:10px 0 0;font-family:var(--k-serif);font-weight:400;font-size:26px;letter-spacing:-.01em;line-height:1.2}'
    + '.gq-p{margin:8px 0 0;color:var(--k-mut);font-size:14px;line-height:1.5}'
    + '.gq-who{margin-top:16px;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:var(--k-card2);box-shadow:var(--k-ring)}'
    + '.gq-av{width:40px;height:40px;border-radius:50%;display:grid;place-items:center;font:600 14px var(--k-sans);box-shadow:var(--k-ring-hi)}'
    + '.gq-who b{display:block}.gq-who small{color:var(--k-mut2);font-size:12px}'
    + '.gq-btns{margin-top:18px;display:flex;gap:10px}.gq-btns button{flex:1;height:46px;border-radius:9999px;font:600 14px var(--k-sans);cursor:pointer}'
    + '.gq-yes{border:0;background:var(--k-acc);color:var(--k-acc-ink)}.gq-no{border:1px solid var(--k-line2);background:transparent;color:var(--k-ink)}'
    + '.gq-err{margin:10px 0 0;color:var(--k-ab);font-size:13px;min-height:18px}';

  function ask(w, kind) {
    if (!document.getElementById('gqCss')) { const s = document.createElement('style'); s.id = 'gqCss'; s.textContent = css; document.head.appendChild(s); }
    return new Promise((resolve) => {
      const n = esc(String(w.name).split(' ')[0]), g = esc(String(w.guardian).split(' ')[0]);
      const q = kind === 'in'
        ? { k: 'GUARDIAN ANGEL ON DUTY', h: n + ' office aaya hai?', p: g + ' ne aaj 10 baje tak punch nahi kiya, so today you are ' + n + '’s guardian angel. Haan = ' + n + ' ka Punch In abhi lag jayega. Nahi = absent.', sub: 'Not punched in yet', yes: 'Haan, aaya hai', no: 'Nahi aaya' }
        : { k: 'GUARDIAN ANGEL ON DUTY', h: n + ' ghar ja raha hai?', p: g + ' is not in today. Haan = ' + n + ' ka Punch Out abhi lag jayega.', sub: 'In since ' + hm(w.in), yes: 'Haan, Punch Out karo', no: 'Abhi nahi' };
      const el = document.createElement('div'); el.className = 'gq-scrim';
      el.innerHTML = '<div class="gq-card" role="dialog" aria-modal="true" aria-label="' + q.h + '"><span class="gq-k">' + q.k + '</span><h3 class="gq-h">' + q.h + '</h3><p class="gq-p">' + q.p + '</p>'
        + '<div class="gq-who"><span class="gq-av">' + esc(String(w.name).slice(0, 1).toUpperCase()) + '</span><span><b>' + esc(w.name) + '</b><small>' + q.sub + '</small></span></div>'
        + '<p class="gq-err" role="alert"></p><div class="gq-btns"><button type="button" class="gq-no">' + q.no + '</button><button type="button" class="gq-yes">' + q.yes + '</button></div></div>';
      document.body.appendChild(el);
      el.querySelector('.gq-no').addEventListener('click', () => { el.remove(); resolve(false); });
      el.querySelector('.gq-yes').addEventListener('click', async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'Punching…';
        const loc = await new Promise((res) => { if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }); });
        try {
          const r = await StafflyAPI.call('webGuardianPunch', [w.id, kind, loc ? loc.latitude : null, loc ? loc.longitude : null, loc ? loc.accuracy : null]);
          const st = r && r.status;
          if (st === 'SUCCESS' || /^ALREADY/.test(st || '')) { el.remove(); if (typeof toast === 'function') toast(st === 'SUCCESS' ? n + ' punched ' + (kind === 'in' ? 'in' : 'out') + ' ✓' : n + ' was already punched', 'ok'); resolve(true); return; }
          const why = { OUT_OF_RANGE: 'This computer is not on the office Wi-Fi and its location is outside the office range.', NO_LOCATION: 'No location and not on the office Wi-Fi. Use the office network or allow location.', NOT_ALLOWED: 'Ignatius has punched in now, so he will handle it.', NO_CLOCK_IN: n + ' has no Punch In today.' }[st] || ('Could not punch (' + st + ').');
          el.querySelector('.gq-err').textContent = why; b.disabled = false; b.textContent = q.yes;
          if (st === 'NOT_ALLOWED') setTimeout(() => { el.remove(); resolve(true); }, 2500);
        } catch (e) { el.querySelector('.gq-err').textContent = e.message || 'Could not punch. Try again.'; b.disabled = false; b.textContent = q.yes; }
      });
    });
  }

  async function check() {
    if (open || !window.StafflyAPI || !StafflyAPI.user || !StafflyAPI.user() || document.querySelector('.sitegate')) return;
    let due; try { due = await StafflyAPI.call('webGuardianDue', []); } catch (e) { return; }
    for (const w of due || []) {
      const late = String(w.now || '') >= '17:30';
      const kind = !w.in ? 'in' : (!w.out && late ? 'out' : null);
      if (!kind || decided(w.id, kind)) continue;
      open = true;
      const answered = await ask(w, kind);
      remember(w.id, kind);
      if (answered === undefined) forget(w.id, kind);
      open = false;
    }
  }
  (function start(n) {
    const u = window.StafflyAPI && StafflyAPI.user && StafflyAPI.user();
    if (u && u.token && typeof S !== 'undefined' && S.today) { setTimeout(check, 2500); setInterval(check, 5 * 60 * 1000); }
    else if (n < 600) setTimeout(() => start(n + 1), 1000);
  })(0);
})();
