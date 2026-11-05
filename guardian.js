/* guardian.js - Staffly phone app: guardian punch (v103).
 * Raj (DCC204) does not use the app. Ignatius Lakra (DCC202) is his guardian angel.
 * Before Ignatius's own Punch In / Punch Out, a popup asks (in Jharkhandi style) whether Raj has come / is leaving.
 *   Yes -> Raj is punched in / out too (same location rules as a normal punch, or office Wi-Fi). No -> nothing, Raj stays absent.
 * Who is whose guardian lives in Supabase: private.punch_guardians (migration 19). app.js calls window.guardianAsk('in'|'out'). */
(function () {
  'use strict';
  if (typeof sbClient === 'undefined' || !sbClient) return;
  const tok = () => (typeof getSessionToken === 'function' ? getSessionToken() : null);
  const me = () => (typeof CURRENT_USER !== 'undefined' && CURRENT_USER ? (CURRENT_USER.employeeId || CURRENT_USER.employee_id) : null);
  const firstName = () => { const n = typeof CURRENT_USER !== 'undefined' && CURRENT_USER ? (CURRENT_USER.fullName || CURRENT_USER.name || '') : ''; return String(n).trim().split(/\s+/)[0] || 'bhaiya'; };
  const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hm = (t) => new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true });
  const key = (w, k) => 'staffly_guard_' + me() + '_' + w + '_' + k + '_' + today();
  const decided = (w, k) => { try { return !!localStorage.getItem(key(w, k)); } catch (e) { return false; } };
  const remember = (w, k, v) => { try { localStorage.setItem(key(w, k), v); } catch (e) {} };

  let cache = { user: null, list: null };
  async function wards() {
    if (cache.user === me() && cache.list && !cache.list.length) return cache.list;   // not a guardian: ask once per login
    const r = await sbClient.rpc('guardian_wards', { p_token: tok() });
    if (r.error) throw r.error;
    cache = { user: me(), list: r.data || [] };
    return cache.list;
  }

  const css = '.gd-scrim{position:fixed;inset:0;z-index:2500;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center;padding:16px;box-sizing:border-box;animation:k-fade .2s ease both}'
    + '.gd-card{width:100%;max-width:420px;background:var(--k-card,#0a0a0b);color:var(--k-ink,#f0f0f0);border-radius:24px;box-shadow:0 0 0 1px var(--k-line,#1d1e21),0 30px 70px -20px #000;padding:24px 20px calc(18px + env(safe-area-inset-bottom,0px));font-family:Inter,system-ui,sans-serif;animation:k-rise .35s var(--k-spring,ease) both}'
    + '.gd-k{font:600 11px/1 Inter,system-ui,sans-serif;letter-spacing:.14em;color:var(--k-mi,#ffc46b)}'
    + '.gd-h{margin:10px 0 0;font:600 22px/1.25 Inter,system-ui,sans-serif;letter-spacing:-.01em}'
    + '.gd-p{margin:8px 0 0;color:var(--k-mut,#a1a4a5);font-size:14px;line-height:1.5}'
    + '.gd-who{margin-top:16px;display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:16px;background:var(--k-card2,#111113);box-shadow:0 0 0 1px var(--k-line,#1d1e21)}'
    + '.gd-av{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 15px Inter,sans-serif;background:var(--k-bg,#000);box-shadow:0 0 0 1px var(--k-line2,#2c2e33)}'
    + '.gd-who b{display:block;font-size:16px}.gd-who small{color:var(--k-mut2,#6f7376);font-size:12px}'
    + '.gd-btns{margin-top:18px;display:grid;gap:10px}'
    + '.gd-btns button{height:52px;border-radius:9999px;font:600 16px Inter,system-ui,sans-serif;cursor:pointer}'
    + '.gd-yes{border:0;background:var(--k-acc,#fff);color:var(--k-acc-ink,#000)}'
    + '.gd-no{border:1px solid var(--k-line2,#2c2e33);background:transparent;color:var(--k-ink,#f0f0f0)}'
    + '.gd-toast{position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:2600;max-width:calc(100% - 32px);padding:11px 16px;border-radius:14px;background:var(--k-card2,#111113);color:var(--k-ink,#f0f0f0);box-shadow:0 0 0 1px var(--k-line,#1d1e21),0 20px 40px -20px #000;font:500 14px Inter,system-ui,sans-serif;text-align:center;animation:k-rise .3s ease both}';
  function style() { if (!document.getElementById('gdCss')) { const s = document.createElement('style'); s.id = 'gdCss'; s.textContent = css; document.head.appendChild(s); } }
  function toast(m) { style(); const t = document.createElement('div'); t.className = 'gd-toast'; t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 4000); }

  /* the question, Jharkhandi (Nagpuri) style. Resolves true (yes) / false (no). */
  function ask(w, kind) {
    style();
    return new Promise((resolve) => {
      const name = esc(w.name.split(' ')[0]);
      const el = document.createElement('div'); el.className = 'gd-scrim';
      const q = kind === 'in'
        ? { k: 'JOHAR ' + esc(firstName()).toUpperCase() + ' BHAIYA', h: name + ' aaj office aayal hai ka?', p: 'Haan dabaibe to ' + name + ' ke bhi Punch In ho jaitek. Nahi aayal to absent rahi.', yes: 'Haan, aayal hai', no: 'Nahi aayal', sub: 'Not punched in yet' }
        : { k: 'JOHAR ' + esc(firstName()).toUpperCase() + ' BHAIYA', h: name + ' bhi ghar jaat hai ka?', p: 'Haan dabaibe to ' + name + ' ke bhi Punch Out ho jaitek.', yes: 'Haan, Punch Out kar do', no: 'Nahi, abhi rukal hai', sub: w.in ? 'In since ' + hm(w.in) : '' };
      el.innerHTML = '<div class="gd-card" role="dialog" aria-modal="true" aria-label="' + q.h + '"><span class="gd-k">' + q.k + '</span><h3 class="gd-h">' + q.h + '</h3><p class="gd-p">' + q.p + '</p>'
        + '<div class="gd-who"><span class="gd-av">' + esc(w.name.split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase()) + '</span><span><b>' + esc(w.name) + '</b><small>' + q.sub + '</small></span></div>'
        + '<div class="gd-btns"><button type="button" class="gd-yes">' + q.yes + '</button><button type="button" class="gd-no">' + q.no + '</button></div></div>';
      document.body.appendChild(el);
      const done = (v) => { el.remove(); resolve(v); };
      el.querySelector('.gd-yes').addEventListener('click', () => done(true));
      el.querySelector('.gd-no').addEventListener('click', () => done(false));
      setTimeout(() => { const b = el.querySelector('.gd-yes'); if (b) b.focus(); }, 50);
    });
  }

  async function gps() {
    try { const p = typeof getGpsPosition === 'function' ? await getGpsPosition(15000) : null; return p && p.coords ? p.coords : null; } catch (e) { return null; }
  }
  const MSG = {
    OUT_OF_RANGE: 'is out of the office range, so not punched. Punch from inside the office or on the office Wi-Fi.',
    NO_LOCATION: 'could not be punched: no location. Turn on Location or use the office Wi-Fi.',
    ALREADY_CLOCKED_IN: 'is already punched in today.',
    ALREADY_CLOCKED_OUT: 'is already punched out today.',
    NO_CLOCK_IN: 'has no Punch In today, so no Punch Out.',
    NOT_ALLOWED: 'is not linked to you any more.'
  };

  window.guardianAsk = async function (kind) {
    if (!tok() || !me()) return;
    let list;
    try { list = await wards(); } catch (e) { return; }   // never block the person's own punch
    for (const w of list) {
      const need = kind === 'in' ? !w.in : (w.in && !w.out);
      if (!need || decided(w.id, kind)) continue;
      const yes = await ask(w, kind);
      remember(w.id, kind, yes ? 'yes' : 'no');
      if (!yes) { toast(w.name.split(' ')[0] + (kind === 'in' ? ' marked not come today.' : ' stays punched in.')); continue; }
      const c = await gps();
      try {
        const r = await sbClient.rpc('guardian_punch', { p_token: tok(), p_ward: w.id, p_kind: kind, p_lat: c ? c.latitude : null, p_lng: c ? c.longitude : null, p_accuracy: c ? c.accuracy : null });
        if (r.error) throw r.error;
        const st = r.data && r.data.status;
        if (st === 'SUCCESS') { toast(w.name.split(' ')[0] + ' ke Punch ' + (kind === 'in' ? 'In' : 'Out') + ' ho gelak ✓'); if (kind === 'in') w.in = new Date().toISOString(); else w.out = new Date().toISOString(); }
        else { toast(w.name.split(' ')[0] + ' ' + (MSG[st] || 'could not be punched (' + st + ').')); try { localStorage.removeItem(key(w.id, kind)); } catch (e) {} }
      } catch (e) {
        toast('Could not punch ' + w.name.split(' ')[0] + '. Check internet and try again.');
        try { localStorage.removeItem(key(w.id, kind)); } catch (x) {}
      }
    }
  };
})();
