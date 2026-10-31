/* =====================================================================
   theme.js - ONE colour theme for the phone app AND the PC dashboard (same website, same saved choice).
   Modes:  'mist'     = Lavender Mist  (light)
           'twilight' = Twilight Violet (dark)
           'auto'     = follow the device (dark at night if the phone/PC is set to dark)
   Saved in localStorage 'staffly_theme'. Runs in <head> so there is no flash.
   ===================================================================== */
(function () {
  'use strict';
  var KEY = 'staffly_theme';
  var THEMES = [
    { id: 'mist', name: 'Lavender Mist (light)' },
    { id: 'twilight', name: 'Twilight Violet (dark)' }
  ];
  function valid(m) { return m === 'auto' || m === 'mist' || m === 'twilight'; }
  function getMode() { try { var m = localStorage.getItem(KEY); if (valid(m)) return m; } catch (e) {} return 'mist'; }
  function resolve(m) {
    m = m || getMode();
    if (m === 'auto') { try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'twilight' : 'mist'; } catch (e) { return 'mist'; } }
    return m;
  }
  /* v93: Staffly v2 look - 'dark' (default) or 'light', chosen by the user (see dash/js/mode.js) */
  var LKEY = 'staffly_mode';
  function getLook() { try { return localStorage.getItem(LKEY) === 'light' ? 'light' : 'dark'; } catch (e) { return 'dark'; } }
  function setLook(l) { l = l === 'light' ? 'light' : 'dark'; try { localStorage.setItem(LKEY, l); } catch (e) {} applyLook(); return l; }
  function applyLook() {
    var l = getLook(), h = document.documentElement;
    h.dataset.mode = l; h.style.colorScheme = l;
    var mt = document.querySelector('meta[name=theme-color]');
    if (mt) mt.setAttribute('content', l === 'light' ? '#fafafa' : '#000000');
  }
  function apply(m) {
    var r = resolve(m), h = document.documentElement;
    h.dataset.theme = r; h.dataset.vt = '1'; h.dataset.themeMode = m;
    applyLook();
  }
  function setMode(m) {
    if (!valid(m)) m = 'mist';
    try { localStorage.setItem(KEY, m); } catch (e) {}
    apply(m); try { window.dispatchEvent(new CustomEvent('staffly-theme', { detail: resolve(m) })); } catch (e) {}
    return m;
  }
  window.DCC_THEME = {
    THEMES: THEMES, MODES: ['auto', 'mist', 'twilight'],
    getMode: getMode, setMode: setMode, getLook: getLook, setLook: setLook, resolve: resolve, festiveNow: function () { return null; },
    name: function (id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i].name; return id === 'auto' ? 'Auto' : id; }
  };
  apply(getMode());
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (getMode() === 'auto') apply('auto'); }); } catch (e) {}
  window.addEventListener('storage', function (e) { if (e.key === KEY || e.key === LKEY) apply(getMode()); });
  document.addEventListener('DOMContentLoaded', applyLook);
})();
