/* =====================================================================
   theme.js - picks the look BEFORE the page paints (no flash).

   ONLY ONE LOOK: Professional (id 'premium'). Everyone, on every device, always gets it.
   The Festive (Durga) and Hydrangea looks are switched off here; their CSS is still in the files if ever needed.
   ===================================================================== */
(function () {
  'use strict';
  var KEY = 'dccThemeMode';
  var FESTIVE = [];   // festive auto mode switched OFF: the Professional look is the only look
  var THEMES = [
    { id: 'premium', name: 'Professional' }
  ];

  function festiveNow() { return null; }
  function valid(mode) { return mode === 'premium'; }
  function resolve() { return 'premium'; }
  function getMode() { return 'premium'; }      // ignores any older saved choice (Durga / Hydrangea / Auto)
  function setMode() {
    document.documentElement.dataset.theme = 'premium';
    document.documentElement.dataset.themeMode = 'premium';
    try { localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ }
    return 'premium';
  }

  window.DCC_THEME = {
    THEMES: THEMES,
    MODES: ['auto'].concat(THEMES.map(function (t) { return t.id; })),
    getMode: getMode, setMode: setMode, resolve: resolve, festiveNow: festiveNow,
    name: function (id) { for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i].name; return id; }
  };
  setMode(getMode(), false);
})();
