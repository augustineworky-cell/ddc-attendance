/* =====================================================================
   mode.js - Staffly v2: dark / light look (phone app + PC dashboard).
   - Dark is the default. A small pill appears ONCE near the top (next to the
     search bar on PC) offering light mode: "Switch to light" / "Keep dark" / x.
     Any answer is remembered on this device and the pill never comes back.
   - Later changes: Appearance switch (PC sidebar footer, phone Profile).
   - Switching fades the colours (tokens.css .k-fading) and offers Undo.
   - Phone: bottom-tab switches slide in the direction you move.
   The look itself is applied in <head> by theme.js (no flash).
   ===================================================================== */
(function () {
  'use strict';
  var ASKED = 'staffly_mode_asked';
  var T = window.DCC_THEME;
  if (!T || !T.getLook) return;
  var isDash = !!document.querySelector('.app .side') || /dashboard\.html$/.test(location.pathname);

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  var SUN = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  var MOON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>';
  function syncButtons() {
    var l = T.getLook();
    document.querySelectorAll('[data-mode-set]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode-set') === l)); });
    var t = document.getElementById('kLookBtn');
    if (t) { t.innerHTML = l === 'light' ? MOON : SUN; var lab = l === 'light' ? 'Switch to dark' : 'Switch to light'; t.setAttribute('aria-label', lab); t.title = lab; }
  }
  /* PC top bar: small sun/moon button next to "Mobile view" - always visible, flips the look */
  function addTopButton() {
    if (!isDash || document.getElementById('kLookBtn')) return;
    var mob = document.getElementById('mobBtn'); if (!mob) return;
    var b = document.createElement('button');
    b.id = 'kLookBtn'; b.type = 'button'; b.className = 'btn k-lookbtn';
    b.addEventListener('click', function () { setLook(T.getLook() === 'light' ? 'dark' : 'light'); });
    mob.parentNode.insertBefore(b, mob);
  }

  var undoEl = null, undoT = 0;
  function setLook(l, opts) {
    opts = opts || {};
    var before = T.getLook();
    if (before === l) { syncButtons(); return; }
    var h = document.documentElement;
    h.classList.add('k-fading');
    T.setLook(l);
    syncButtons();
    setTimeout(function () { h.classList.remove('k-fading'); }, 450);
    store(ASKED, '1');
    if (opts.undo !== false) showUndo(before, l);
    try { window.dispatchEvent(new CustomEvent('staffly-look', { detail: l })); } catch (e) {}
  }
  window.stafflySetLook = setLook;

  function showUndo(prev, now) {
    if (undoEl) undoEl.remove();
    clearTimeout(undoT);
    undoEl = document.createElement('div');
    undoEl.className = 'k-undo'; undoEl.setAttribute('role', 'status');
    undoEl.innerHTML = '<span>' + (now === 'light' ? 'Light mode on' : 'Dark mode on') + '</span><button type="button">Undo</button>';
    undoEl.querySelector('button').addEventListener('click', function () { setLook(prev, { undo: false }); undoEl.remove(); undoEl = null; });
    document.body.appendChild(undoEl);
    undoT = setTimeout(function () { if (undoEl) { undoEl.remove(); undoEl = null; } }, 5000);
  }

  /* Appearance buttons anywhere (phone Profile row, PC sidebar) */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest && ev.target.closest('[data-mode-set]');
    if (!b) return;
    ev.preventDefault();
    setLook(b.getAttribute('data-mode-set'));
  });

  /* PC: Appearance switch in the sidebar footer */
  function addSidebarSwitch() {
    if (!isDash || document.getElementById('kLook')) return;
    var foot = document.querySelector('.side .foot');
    if (!foot) return;
    var row = document.createElement('div');
    row.className = 'k-look'; row.id = 'kLook';
    row.innerHTML = '<span>Appearance</span><span class="k-seg" role="group" aria-label="Appearance"><button type="button" data-mode-set="dark">Dark</button><button type="button" data-mode-set="light">Light</button></span>';
    foot.parentNode.insertBefore(row, foot);
    syncButtons();
  }

  /* the one-time suggestion pill */
  var askEl = null;
  function closeAsk(answer) {
    store(ASKED, '1');
    if (!askEl) return;
    var el = askEl; askEl = null;
    el.classList.add('out');
    setTimeout(function () { el.remove(); }, 260);
    if (answer === 'light') setLook('light');
  }
  function placeOnDash(el) {
    var s = document.querySelector('.searchwrap');
    if (!s) return;
    var r = s.getBoundingClientRect();
    el.classList.add('on-dash');
    /* just under the search bar, lined up with its left edge, so it never covers the top buttons */
    el.style.top = (r.bottom + 10) + 'px';
    el.style.left = Math.max(16, Math.min(r.left, innerWidth - el.offsetWidth - 16)) + 'px';
  }
  function showAsk() {
    if (askEl || store(ASKED) || T.getLook() === 'light') return;
    if (document.querySelector('.sitegate')) return;           // still on the PC login
    var lv = document.getElementById('loginView');
    if (lv && lv.classList.contains('active')) return;         // still on the phone login
    askEl = document.createElement('div');
    askEl.className = 'k-ask'; askEl.setAttribute('role', 'dialog'); askEl.setAttribute('aria-label', 'Appearance suggestion');
    askEl.innerHTML = '<svg class="k-ask-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      + '<b>Prefer a lighter look?</b>'
      + '<button type="button" class="k-yes">Switch to light</button>'
      + '<button type="button" class="k-no">Keep dark</button>'
      + '<button type="button" class="k-x" aria-label="Close">✕</button>';
    askEl.querySelector('.k-yes').addEventListener('click', function () { closeAsk('light'); });
    askEl.querySelector('.k-no').addEventListener('click', function () { closeAsk('dark'); });
    askEl.querySelector('.k-x').addEventListener('click', function () { closeAsk('dark'); });
    document.body.appendChild(askEl);
    if (isDash) placeOnDash(askEl);
  }
  function scheduleAsk() {
    if (store(ASKED) || T.getLook() === 'light') return;
    var light = false; try { light = matchMedia('(prefers-color-scheme: light)').matches; } catch (e) {}
    var tries = 0;
    (function wait() {
      tries++;
      var ready = isDash ? (typeof S !== 'undefined' && S.today && !document.querySelector('.sitegate'))
                         : (document.getElementById('loginView') && !document.getElementById('loginView').classList.contains('active'));
      if (ready) setTimeout(showAsk, light ? 1800 : 3500);
      else if (tries < 400) setTimeout(wait, 700);
    })();
  }
  addEventListener('resize', function () { if (askEl && isDash) placeOnDash(askEl); });

  /* phone: bottom tabs slide left/right in the direction of travel */
  function tabSlide() {
    if (isDash) return;
    document.addEventListener('click', function (ev) {
      var item = ev.target.closest && ev.target.closest('.bottom-nav .bottom-nav-item[data-view], #bottomNav [data-view]');
      if (!item) return;
      var all = Array.prototype.slice.call(document.querySelectorAll('#bottomNav [data-view], .bottom-nav .bottom-nav-item[data-view]'));
      var cur = all.findIndex(function (x) { return x.classList.contains('active'); });
      var nxt = all.indexOf(item);
      document.documentElement.dataset.slide = cur < 0 || nxt === cur ? '' : (nxt > cur ? 'next' : 'prev');
    }, true);
  }

  function start() { addSidebarSwitch(); addTopButton(); syncButtons(); scheduleAsk(); tabSlide(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  addEventListener('storage', function (e) { if (e.key === 'staffly_mode') syncButtons(); });
})();
