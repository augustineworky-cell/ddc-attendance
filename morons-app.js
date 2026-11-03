/* morons-app.js - Staffly phone app: Moron mode.
 * A guard (chosen by admin on the dashboard) logs in NORMALLY with his employee ID + password.
 * Then: menu "Morons" -> 4-digit Moron PIN -> list of his branch's workers -> photo (camera or gallery) -> Punch In / Out.
 * The normal login and the guard's own punch are not touched.
 * No signal at the gate? The punch is saved on the phone with its real time and sent when the signal is back.
 * Backend: moron_me / moron_unlock / moron_list / moron_punch (supabase/migrations/17_staffly_morons.sql). */
(function () {
  'use strict';
  if (typeof sbClient === 'undefined' || !sbClient) return;

  const BUCKET = 'attendance-media';
  const ST = { me: null, user: null, key: null, list: null, loc: '', today: '', filter: 'all', q: '', w: null, photo: null, source: 'camera', gps: null, busy: false, timer: 0 };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tok = () => (typeof getSessionToken === 'function' ? getSessionToken() : null);
  const istDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const hm = (t) => (t ? new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '');
  const ini = (n) => esc(String(n || '').split(' ').map((x) => x[0]).slice(0, 2).join('').toUpperCase());
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };

  /* ---------- storage on this phone (per guard) ---------- */
  const kKey = () => 'staffly_moron_key_' + ST.user, kQ = () => 'staffly_moron_q_' + ST.user;
  function loadKey() { try { const j = JSON.parse(localStorage.getItem(kKey()) || 'null'); if (j && j.exp > Date.now()) return j.key; } catch (e) {} return null; }
  function saveKey(k) { try { if (k) localStorage.setItem(kKey(), JSON.stringify({ key: k, exp: Date.now() + 15.5 * 3600e3 })); else localStorage.removeItem(kKey()); } catch (e) {} }
  function queue() { try { return JSON.parse(localStorage.getItem(kQ()) || '[]'); } catch (e) { return []; } }
  function setQueue(q) { try { localStorage.setItem(kQ(), JSON.stringify(q)); } catch (e) { toast('Phone storage is full. Send the saved punches first.'); } updQ(); }

  /* ---------- server ---------- */
  async function rpc(fn, args) {
    const r = await sbClient.rpc(fn, Object.assign({ p_token: tok() }, args || {}));
    if (r.error) {
      const m = String(r.error.message || '');
      const e = new Error(m); e.code = r.error.code;
      if (/MORON_LOCKED/.test(m)) e.locked = true;
      if (/MORON_NOT_GUARD/.test(m)) e.notGuard = true;
      if (r.error.code === '28000' || /SESSION_INVALID/.test(m)) e.session = true;
      if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) e.net = true;
      throw e;
    }
    return r.data;
  }
  const isNet = (e) => e && (e.net || e instanceof TypeError || !navigator.onLine);

  /* ---------- menu entries (only for guards) ---------- */
  const ICON = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>';
  function addMenu() {
    const fp = document.getElementById('loginSettingsBtn');
    if (fp && !document.getElementById('moronNavBtn')) {
      const a = document.createElement('a');
      a.href = 'javascript:void(0)'; a.id = 'moronNavBtn'; a.className = 'nav-item'; a.style.display = 'none';
      a.innerHTML = '<svg class="nav-icon" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON + '</svg><span class="nav-label">Morons</span>';
      a.addEventListener('click', open);
      fp.parentNode.insertBefore(a, fp.nextSibling);
    }
    const row = document.querySelector('.v2-row[onclick="openLoginSettings()"]');
    if (row && !document.getElementById('moronRow')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'moronRow'; b.className = 'v2-row'; b.style.display = 'none';
      b.innerHTML = '<span class="v2-row-ic v2-bg-slate"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON + '</svg></span><span class="v2-row-text"><b>Morons</b><small>Punch workers in and out at the gate</small></span><span class="v2-chev" aria-hidden="true"></span>';
      b.addEventListener('click', open);
      row.parentNode.insertBefore(b, row.nextSibling);
    }
  }
  function showMenu(on) {
    ['moronNavBtn', 'moronRow'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; });
  }

  /* who is logged in? check once per login */
  setInterval(async () => {
    const u = typeof CURRENT_USER !== 'undefined' && CURRENT_USER ? CURRENT_USER.employeeId || CURRENT_USER.employee_id || CURRENT_USER.id : null;
    if (u === ST.user) return;
    ST.user = u; ST.me = null; ST.key = null; ST.list = null; showMenu(false); close();
    if (!u || !tok()) return;
    addMenu();
    try { ST.me = await rpc('moron_me'); } catch (e) { ST.me = null; }
    if (ST.me && ST.me.is_guard) { showMenu(true); ST.key = loadKey(); if (queue().length) flush(); }
  }, 1500);

  /* ---------- the screen ---------- */
  let root = null;
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'moronApp'; root.className = 'mo-app'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Morons');
    root.innerHTML = '<div class="mo-screen" id="moScreen"></div><div class="mo-toast" id="moToast" role="status" aria-live="polite"></div>' +
      '<input type="file" id="moCam" accept="image/*" capture="environment" hidden><input type="file" id="moGal" accept="image/*" hidden>';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', (ev) => { if (ev.target.id === 'moQ') { ST.q = ev.target.value.toLowerCase(); drawList(true); } });
    $('#moCam', root).addEventListener('change', (ev) => pick(ev, 'camera'));
    $('#moGal', root).addEventListener('change', (ev) => pick(ev, 'gallery'));
  }
  function open() {
    const sb = document.querySelector('.sidebar'), bd = document.querySelector('.sidebar-backdrop');
    if (sb) sb.classList.remove('open'); if (bd) bd.classList.remove('active');
    if (!ST.me || !ST.me.is_guard) return;
    build(); root.classList.add('on'); document.documentElement.classList.add('mo-lock');
    if (ST.key) loadList(); else drawPin();
  }
  function close() {
    if (!root) return;
    root.classList.remove('on'); document.documentElement.classList.remove('mo-lock'); clearTimeout(ST.timer);
  }
  function lock() { saveKey(null); ST.key = null; ST.list = null; close(); }
  function screen(html) { $('#moScreen', root).innerHTML = html; $('#moScreen', root).scrollTop = 0; }
  function toast(m, kind) {
    const t = root && $('#moToast', root); if (!t) return;
    t.textContent = m; t.className = 'mo-toast show ' + (kind || ''); clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'mo-toast'; }, 3500);
  }
  const back = (to) => `<button type="button" class="mo-ic" data-m="${to}" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>`;

  /* 1. PIN */
  let pin = '';
  function drawPin(msg) {
    pin = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
    screen(`<div class="mo-top">${back('close')}<span></span></div>
      <div class="mo-pinhead"><div class="mo-lockic"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        <h2>Moron mode</h2><p>Enter the Moron PIN given by admin</p></div>
      <div class="mo-dots" id="moDots">${'<span></span>'.repeat(4)}</div>
      <p class="mo-err" id="moErr">${esc(msg || '')}</p>
      <div class="mo-keys">${keys.map((k) => k === '' ? '<span></span>' : k === 'del'
        ? '<button type="button" class="mo-key mo-key-del" data-k="del" aria-label="Delete last digit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"/><path d="M17 9l-5 6M12 9l5 6"/></svg></button>'
        : `<button type="button" class="mo-key" data-k="${k}">${k}</button>`).join('')}</div>
      <p class="mo-foot">Stays open for your whole shift once unlocked</p>`);
  }
  function dots() { document.querySelectorAll('#moDots span').forEach((d, i) => d.classList.toggle('on', i < pin.length)); }
  async function tryPin() {
    if (ST.busy) return; ST.busy = true;
    try {
      const r = await rpc('moron_unlock', { p_pin: pin });
      if (r.status === 'SUCCESS') { ST.key = r.key; saveKey(r.key); buzz(30); loadList(); flush(); }
      else if (r.status === 'WRONG_PIN') { buzz([60, 40, 60]); drawPin('Wrong PIN. ' + r.attempts_left + ' tries left.'); }
      else if (r.status === 'LOCKED') { buzz([60, 40, 60]); drawPin('Too many wrong tries. Try again in ' + r.minutes + ' min.'); }
      else { drawPin('You are not a Moron guard. Ask admin.'); }
    } catch (e) { drawPin(isNet(e) ? 'No internet. Connect once to unlock Moron mode.' : (e.session ? 'Please sign in again.' : 'Could not unlock. Try again.')); }
    ST.busy = false;
  }

  /* 2. list */
  async function loadList() {
    if (!ST.list) screen('<div class="mo-load">Loading workers…</div>');
    try {
      const d = await rpc('moron_list', { p_key: ST.key });
      ST.list = d.workers || []; ST.loc = d.location || ''; ST.today = d.today || '';
      applyQueueToList();
    } catch (e) {
      if (e.locked) { saveKey(null); ST.key = null; drawPin('Moron mode timed out. Enter the PIN again.'); return; }
      if (e.notGuard) { lock(); showMenu(false); return; }
      if (!isNet(e) || !ST.list) { if (!ST.list) { screen(`<div class="mo-top">${back('close')}<span></span></div><div class="mo-load">${isNet(e) ? 'No internet. Connect to load the worker list.' : 'Could not load the list.'}<br><br><button type="button" class="mo-btn" data-m="reload">Try again</button></div>`); return; } }
    }
    drawList();
  }
  function applyQueueToList() {
    if (!ST.list) return;
    queue().forEach((p) => {
      const w = ST.list.find((x) => x.id === p.worker); if (!w) return;
      if (p.kind === 'in' && !w.in) { w.in = p.at; w.next = 'out'; w.pending = true; }
      if (p.kind === 'out' && !w.out) { w.out = p.at; w.next = 'done'; w.pending = true; }
    });
  }
  function drawList(keepInput) {
    const L = ST.list || [];
    const notIn = L.filter((w) => w.next === 'in').length, inside = L.filter((w) => w.next === 'out').length;
    const F = L.filter((w) => (ST.filter === 'all' || (ST.filter === 'in' ? w.next === 'in' : w.next === 'out')) && (!ST.q || w.name.toLowerCase().includes(ST.q)));
    const rows = F.map((w) => {
      const sub = w.next === 'in' ? 'Not punched yet' : w.next === 'out' ? 'In at ' + hm(w.in) : 'Done today · ' + hm(w.in) + ' – ' + hm(w.out);
      const tag = w.next === 'in' ? '<span class="mo-tag mo-tag-in">IN</span>' : w.next === 'out' ? '<span class="mo-tag mo-tag-out">OUT</span>' : '<span class="mo-tag mo-tag-done">DONE</span>';
      return `<button type="button" class="mo-worker${w.next === 'done' ? ' done' : ''}" data-w="${esc(w.id)}" ${w.next === 'done' ? 'disabled' : ''}>
        <span class="mo-av">${ini(w.name)}</span><span class="mo-wt"><b>${esc(w.name)}</b><small>${sub}${w.pending ? ' · <i>waiting to send</i>' : ''}</small></span>${tag}</button>`;
    }).join('');
    const listHtml = rows || `<div class="mo-empty">${L.length ? 'Nobody here.' : 'No workers added for ' + esc(ST.loc) + ' yet. Ask admin to add them in Morons on the dashboard.'}</div>`;
    if (keepInput && $('#moRows', root)) { $('#moRows', root).innerHTML = listHtml; return; }
    screen(`<div class="mo-top"><div><span class="mo-on">MORON MODE ON</span><h2 class="mo-h">${esc(ST.loc)} workers</h2></div>
        <div class="mo-topr"><button type="button" class="mo-ic" data-m="reload" aria-label="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg></button><button type="button" class="mo-pill" data-m="lock">Lock</button></div></div>
      <div class="mo-q" id="moQBox"></div>
      <label class="mo-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><span class="mo-sr">Search worker</span><input id="moQ" type="search" placeholder="Search name" value="${esc(ST.q)}" autocomplete="off"></label>
      <div class="mo-chips"><button type="button" data-f="all" class="${ST.filter === 'all' ? 'on' : ''}">All ${L.length}</button><button type="button" data-f="in" class="${ST.filter === 'in' ? 'on' : ''}">Not in · ${notIn}</button><button type="button" data-f="out" class="${ST.filter === 'out' ? 'on' : ''}">Inside · ${inside}</button></div>
      <div class="mo-rows" id="moRows">${listHtml}</div>`);
    updQ();
  }
  function updQ() {
    const box = root && $('#moQBox', root); if (!box) return;
    const n = queue().length;
    box.innerHTML = n ? `<div class="mo-qbar"><span>${n} punch${n > 1 ? 'es' : ''} saved on this phone, waiting for signal</span><button type="button" class="mo-pill" data-m="flush">Send now</button></div>` : '';
  }

  /* 3. photo + punch */
  function drawPhoto() {
    const w = ST.w, kind = w.next;
    screen(`<div class="mo-top">${back('list')}<div class="mo-who"><b>${esc(w.name)}</b><small>${esc(ST.loc)}${kind === 'out' ? ' · in at ' + hm(w.in) : ' · not punched yet'}</small></div><span class="mo-sp"></span></div>
      <div class="mo-photo${ST.photo ? ' has' : ''}">${ST.photo ? `<img src="${ST.photo}" alt="Photo of ${esc(w.name)}">` : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg><span>Add a photo of the worker</span>'}
        ${ST.photo ? `<span class="mo-chip ${ST.source === 'gallery' ? 'warn' : ''}">${ST.source === 'gallery' ? 'From gallery' : 'Camera'}</span>` : ''}</div>
      ${ST.photo && ST.source === 'gallery' ? '<p class="mo-note">Gallery photo. The punch counts, but admin sees it is from the gallery.</p>' : ''}
      <div class="mo-two"><button type="button" class="mo-btn" data-m="cam"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Camera</button>
        <button type="button" class="mo-btn" data-m="gal"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>Gallery</button></div>
      <p class="mo-gps" id="moGps">${ST.gps ? 'Location ready' : 'Getting location…'}</p>
      <button type="button" class="mo-go mo-go-${kind}" data-m="punch" ${ST.photo ? '' : 'disabled'}>${kind === 'in' ? 'Punch In' : 'Punch Out'}</button>`);
  }
  function getGps() {
    ST.gps = null;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => {
      ST.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      const g = root && $('#moGps', root); if (g) g.textContent = 'Location ready';
    }, () => { const g = root && $('#moGps', root); if (g) g.textContent = 'Location is off. Turn on location to punch.'; },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
  }
  function pick(ev, source) {
    const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
    if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const max = 900, s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let data = c.toDataURL('image/webp', 0.72);
      if (data.indexOf('data:image/webp') !== 0) data = c.toDataURL('image/jpeg', 0.75);
      ST.photo = data; ST.source = source; drawPhoto();
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not open that photo. Try another one.', 'err'); };
    img.src = url;
  }
  function b64Blob(data) {
    const [head, b] = data.split(','), bin = atob(b), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/webp' });
  }
  async function upload(worker, kind, at, data) {
    const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (x) => x.toString(16).padStart(2, '0')).join('');
    const path = `selfies/${worker}_${istDate(at)}_${kind === 'in' ? 'clockin' : 'clockout'}_${Date.now()}_${rand}.webp`;
    const r = await sbClient.storage.from(BUCKET).upload(path, b64Blob(data), { upsert: false, contentType: 'image/webp' });
    if (r.error) { const e = new Error(r.error.message || 'Upload failed'); if (/fetch|network|Load failed/i.test(e.message)) e.net = true; throw e; }
    return path;
  }
  const MSG = {
    OUT_OF_RANGE: (r) => 'You are ' + r.distance_m + ' m away from the branch. Punch at the gate.',
    NO_LOCATION: () => 'Location is off. Turn on location and try again.',
    PHOTO_MISSING: () => 'Photo did not upload. Try again.',
    ALREADY_IN: (r) => 'Already punched in at ' + hm(r.in) + '.',
    ALREADY_OUT: (r) => 'Already punched out at ' + hm(r.out) + '.',
    NO_CLOCK_IN: () => 'No Punch In found for today. Punch In first.',
    NOT_ALLOWED: () => 'This worker is not in your Morons list any more.',
    TOO_OLD: () => 'This saved punch is older than 36 hours and was dropped.',
    BAD_TIME: () => 'Punch Out time is before Punch In.'
  };
  async function punch() {
    if (ST.busy) return;
    const w = ST.w, kind = w.next;
    if (!ST.photo) { toast('Add a photo first', 'err'); return; }
    if (!ST.gps) { toast('Waiting for location… turn on location if it is off.', 'err'); getGps(); return; }
    ST.busy = true;
    const btn = $('[data-m="punch"]', root); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const item = { worker: w.id, name: w.name, kind, at: new Date().toISOString(), lat: ST.gps.lat, lng: ST.gps.lng, acc: ST.gps.acc, photo: ST.photo, source: ST.source };
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { net: true });
      const path = await upload(item.worker, kind, item.at, item.photo);
      const r = await rpc('moron_punch', { p_key: ST.key, p_worker: item.worker, p_kind: kind, p_lat: item.lat, p_lng: item.lng, p_accuracy: item.acc, p_photo_path: path, p_source: item.source, p_at: null });
      if (r.status === 'SUCCESS') { if (kind === 'in') { w.in = r.at; w.next = 'out'; } else { w.out = r.at; w.next = 'done'; } done(w, kind, r.at, false); }
      else { buzz([60, 40, 60]); toast((MSG[r.status] || (() => 'Could not punch (' + r.status + ')'))(r), 'err'); if (/ALREADY/.test(r.status)) { loadList(); } }
    } catch (e) {
      if (isNet(e)) {
        const q = queue(); q.push(item); setQueue(q);
        if (kind === 'in') { w.in = item.at; w.next = 'out'; } else { w.out = item.at; w.next = 'done'; }
        w.pending = true; done(w, kind, item.at, true);
      } else if (e.locked) { saveKey(null); ST.key = null; drawPin('Moron mode timed out. Enter the PIN again.'); }
      else if (e.session) { toast('Please sign in again.', 'err'); }
      else toast('Could not punch. Try again.', 'err');
    }
    ST.busy = false;
    const b2 = $('[data-m="punch"]', root); if (b2) { b2.disabled = false; b2.textContent = kind === 'in' ? 'Punch In' : 'Punch Out'; }
  }

  /* 4. done -> back to list */
  function done(w, kind, at, saved) {
    buzz(saved ? [40, 60, 40] : 50);
    ST.photo = null;
    screen(`<div class="mo-done"><div class="mo-check ${saved ? 'saved' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${saved ? '<path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/>' : '<path d="M20 6L9 17l-5-5"/>'}</svg></div>
      <h2>${esc(w.name)} is ${kind === 'in' ? 'in' : 'out'}</h2>
      <p>${hm(at)} · ${esc(ST.loc)} · by guard</p>
      ${saved ? '<p class="mo-note">No signal. Saved on this phone with the real time. It will be sent when the signal is back.</p>' : ''}
      <button type="button" class="mo-go mo-go-next" data-m="list">Next worker</button>
      <p class="mo-foot">Back to the list in 3 s</p></div>`);
    clearTimeout(ST.timer); ST.timer = setTimeout(() => { if (root && root.classList.contains('on') && $('.mo-done', root)) drawList(); }, 3000);
  }

  /* offline queue -> server */
  let flushing = false;
  async function flush() {
    if (flushing || !ST.key || !navigator.onLine) return;
    let q = queue(); if (!q.length) return;
    flushing = true; let sent = 0, dropped = 0;
    while (q.length) {
      const it = q[0];
      try {
        if (!it.path) { it.path = await upload(it.worker, it.kind, it.at, it.photo); setQueue(q); }
        const r = await rpc('moron_punch', { p_key: ST.key, p_worker: it.worker, p_kind: it.kind, p_lat: it.lat, p_lng: it.lng, p_accuracy: it.acc, p_photo_path: it.path, p_source: it.source, p_at: it.at });
        if (r.status === 'SUCCESS') sent++; else dropped++;
        q.shift(); setQueue(q);
      } catch (e) {
        if (e.locked) { saveKey(null); ST.key = null; break; }
        break;   // still no signal: try again later
      }
    }
    flushing = false;
    if (sent || dropped) {
      toast(sent + ' saved punch' + (sent === 1 ? '' : 'es') + ' sent' + (dropped ? ', ' + dropped + ' could not be added' : ''), dropped ? 'err' : 'ok');
      if (root && root.classList.contains('on') && ST.key) loadList();
    }
  }
  addEventListener('online', () => setTimeout(flush, 1500));
  setInterval(() => { if (ST.key && queue().length) flush(); }, 30000);

  /* ---------- clicks ---------- */
  function onClick(ev) {
    const k = ev.target.closest('[data-k]');
    if (k) {
      if (k.dataset.k === 'del') pin = pin.slice(0, -1); else if (pin.length < 4) pin += k.dataset.k;
      dots(); const er = $('#moErr', root); if (er) er.textContent = '';
      if (pin.length === 4) tryPin();
      return;
    }
    const f = ev.target.closest('[data-f]');
    if (f) { ST.filter = f.dataset.f; drawList(); return; }
    const w = ev.target.closest('[data-w]');
    if (w) { ST.w = (ST.list || []).find((x) => x.id === w.dataset.w); if (!ST.w || ST.w.next === 'done') return; ST.photo = null; ST.source = 'camera'; getGps(); drawPhoto(); return; }
    const m = ev.target.closest('[data-m]'); if (!m) return;
    const a = m.dataset.m;
    if (a === 'close') close();
    else if (a === 'lock') lock();
    else if (a === 'list') { clearTimeout(ST.timer); drawList(); }
    else if (a === 'reload') loadList();
    else if (a === 'flush') { if (!navigator.onLine) toast('Still no signal', 'err'); else flush(); }
    else if (a === 'cam') $('#moCam', root).click();
    else if (a === 'gal') $('#moGal', root).click();
    else if (a === 'punch') punch();
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && root && root.classList.contains('on')) close(); });
})();
