# Staffly redesign — v1 (locked 30 Oct 2026)

Approved visual direction for the Staffly rebuild. Design reference only — the live app is unchanged.

## Look
- All black & white: near-black background (#050505), off-white text (#fafafa), greys for surfaces and borders.
- Status colours kept only as faint tints so days stay readable: Present #86efac, Absent #fca5a5, Missing #fde68a.
- Fonts: Fraunces (serif headlines), Plus Jakarta Sans (UI).
- Motion: word-by-word blur-to-sharp headline reveal, staggered card rise, drifting card wallpaper on login,
  pulse rings + progress ring on the punch button, calendar cells fading in, sparklines drawing in, sliding day panel.
  Everything respects "reduce motion".

## Files
- `staffly-cube-3d.html` — Three.js login hero (3×3×3 dark metallic cube, layer twists, bloom, fog fade, drag to spin).
  Open in Chrome with internet. Tune the `CFG` block at the top of the script.
- `canvas/*.dc.html` — design-canvas screens (source of the mockups): PC login, phone PIN login, phone home (punch),
  PC dashboard (employee month). They render inside the Claude design canvas, not as standalone pages.
- `canvas/canvas.json` — canvas layout.

## Next
Build these screens into the real app (index.html / dashboard.html) after the remaining screens
(Leave, Profile, Overview, Daily board) are designed in the same style.
