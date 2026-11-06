/* collection-app.js - Staffly phone app: Collection visit (v105). Replaces the Jotform "Form".
 * Field payment collectors (Payment Collector HO) get a menu item "Collection visit".
 * Each visit: party, received / not received, mode + amount + full / part invoice (or the reason), shop photo, GPS.
 * No signal at the shop? The visit is saved on the phone with its real time and sent when the signal is back.
 * Backend: coll_me / coll_add (supabase/migrations/20_staffly_collections.sql). Reuses the Morons screen styles (mo-*). */
(function () {
  'use strict';
  if (typeof sbClient === 'undefined' || !sbClient) return;

  const BUCKET = 'attendance-media';
  const MODES = ['Cash', 'Cheque', 'UPI', 'NEFT/RTGS'];
  const REASONS = ['Owner not available', 'Asked to come later', 'Cheque not ready', 'Shop closed', 'Bill dispute'];
  const ST = { user: null, me: null, f: null, gps: null, gpsErr: false, busy: false };
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tok = () => (typeof getSessionToken === 'function' ? getSessionToken() : null);
  const istDate = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const hm = (t) => (t ? new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : '');
  const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const hex = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (x) => x.toString(16).padStart(2, '0')).join('');
  const buzz = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} };
  const newForm = () => ({ result: '', party: '', place: '', reason: '', mode: '', amount: '', invoice: '', photo: null, source: 'camera' });

  /* ---------- offline queue (per collector) ---------- */
  const kQ = () => 'staffly_coll_q_' + ST.user;
  function queue() { try { return JSON.parse(localStorage.getItem(kQ()) || '[]'); } catch (e) { return []; } }
  function setQueue(q) { try { localStorage.setItem(kQ(), JSON.stringify(q)); } catch (e) { toast('Phone storage is full. Send the saved visits first.', 'err'); } }

  async function rpc(fn, args) {
    const r = await sbClient.rpc(fn, Object.assign({ p_token: tok() }, args || {}));
    if (r.error) {
      const m = String(r.error.message || ''), e = new Error(m);
      if (r.error.code === '28000' || /SESSION_INVALID/.test(m)) e.session = true;
      if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) e.net = true;
      throw e;
    }
    return r.data;
  }
  const isNet = (e) => e && (e.net || e instanceof TypeError || !navigator.onLine);

  /* ---------- menu entries (collectors only) ---------- */
  const ICON = '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>';
  function addMenu() {
    const fp = document.getElementById('loginSettingsBtn');
    if (fp && !document.getElementById('collNavBtn')) {
      const a = document.createElement('a');
      a.href = 'javascript:void(0)'; a.id = 'collNavBtn'; a.className = 'nav-item'; a.style.display = 'none';
      a.innerHTML = '<svg class="nav-icon" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON + '</svg><span class="nav-label">Collection visit</span>';
      a.addEventListener('click', open);
      fp.parentNode.insertBefore(a, fp.nextSibling);
    }
    const row = document.querySelector('.v2-row[onclick="openLoginSettings()"]');
    if (row && !document.getElementById('collRow')) {
      const b = document.createElement('button');
      b.type = 'button'; b.id = 'collRow'; b.className = 'v2-row'; b.style.display = 'none';
      b.innerHTML = '<span class="v2-row-ic v2-bg-slate"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICON + '</svg></span><span class="v2-row-text"><b>Collection visit</b><small>Record a payment visit at a party</small></span><span class="v2-chev" aria-hidden="true"></span>';
      b.addEventListener('click', open);
      row.parentNode.insertBefore(b, row);
    }
  }
  function showMenu(on) { ['collNavBtn', 'collRow'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = on ? '' : 'none'; }); }

  setInterval(async () => {
    const u = typeof CURRENT_USER !== 'undefined' && CURRENT_USER ? CURRENT_USER.employeeId || CURRENT_USER.employee_id || CURRENT_USER.id : null;
    if (u === ST.user) return;
    ST.user = u; ST.me = null; showMenu(false); close();
    if (!u || !tok()) return;
    addMenu();
    try { ST.me = await rpc('coll_me'); } catch (e) { ST.me = null; }
    if (ST.me && ST.me.is_collector) { showMenu(true); if (queue().length) flush(); }
  }, 1500);

  /* ---------- screen ---------- */
  let root = null;
  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'collApp'; root.className = 'mo-app cv-app'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Collection visit');
    root.innerHTML = '<div class="mo-screen" id="cvScreen"></div><div class="mo-toast" id="cvToast" role="status" aria-live="polite"></div>' +
      '<input type="file" id="cvCam" accept="image/*" capture="environment" hidden><input type="file" id="cvGal" accept="image/*" hidden>' +
      '<datalist id="cvParties"></datalist>';
    document.body.appendChild(root);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    $('#cvCam', root).addEventListener('change', (ev) => pick(ev, 'camera'));
    $('#cvGal', root).addEventListener('change', (ev) => pick(ev, 'gallery'));
  }
  function open() {
    const sb = document.querySelector('.sidebar'), bd = document.querySelector('.sidebar-backdrop');
    if (sb) sb.classList.remove('open'); if (bd) bd.classList.remove('active');
    if (!ST.me || !ST.me.is_collector) return;
    build(); root.classList.add('on'); document.documentElement.classList.add('mo-lock');
    drawHome(); refresh();
  }
  function close() { if (!root) return; root.classList.remove('on'); document.documentElement.classList.remove('mo-lock'); }
  function screen(html) { $('#cvScreen', root).innerHTML = html; $('#cvScreen', root).scrollTop = 0; }
  function toast(m, kind) {
    const t = root && $('#cvToast', root); if (!t) return;
    t.textContent = m; t.className = 'mo-toast show ' + (kind || ''); clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'mo-toast'; }, 3500);
  }
  const back = (to) => `<button type="button" class="mo-ic" data-c="${to}" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>`;

  async function refresh() {
    try { ST.me = await rpc('coll_me'); } catch (e) { return; }
    const dl = root && $('#cvParties', root);
    if (dl) dl.innerHTML = (ST.me.parties || []).map((p) => `<option value="${esc(p.party)}">`).join('');
    if (root && $('#cvHome', root)) drawHome();
  }

  /* 1. today */
  function drawHome() {
    const sent = (ST.me && ST.me.visits) || [], q = queue().filter((x) => istDate(x.at) === istDate(new Date()));
    const all = q.map((x) => Object.assign({ pending: true }, x)).concat(sent);
    const got = all.filter((v) => v.result === 'received'), amt = got.reduce((s, v) => s + Number(v.amount || 0), 0);
    const rows = all.map((v) => `<div class="cv-row"><span class="mo-tag ${v.result === 'received' ? 'mo-tag-in' : 'cv-no'}">${v.result === 'received' ? 'GOT' : 'NO'}</span>
      <span class="cv-rt"><b>${esc(v.party)}</b><small>${hm(v.at)}${v.result === 'received' ? ' · ' + esc(v.mode) + ' · ' + (v.invoice === 'part' ? 'part' : 'full') + ' invoice' : ' · ' + esc(v.reason || '')}${v.pending ? ' · <i>waiting to send</i>' : ''}</small></span>
      ${v.result === 'received' ? `<span class="cv-amt">${rs(v.amount)}</span>` : ''}</div>`).join('');
    const n = queue().length;
    screen(`<div id="cvHome" class="mo-top">${back('close')}<div class="mo-who"><b>Collection visits</b><small>Today · ${new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}</small></div><span class="mo-sp"></span></div>
      ${n ? `<div class="mo-qbar"><span>${n} visit${n > 1 ? 's' : ''} saved on this phone, waiting for signal</span><button type="button" class="mo-pill" data-c="flush">Send now</button></div>` : ''}
      <div class="cv-kpis"><div><b>${all.length}</b><small>Visits</small></div><div><b>${got.length}</b><small>Received</small></div><div><b>${rs(amt)}</b><small>Collected</small></div></div>
      <button type="button" class="mo-go mo-go-in" data-c="new">New visit</button>
      <div class="cv-list">${rows || '<div class="mo-empty">No visits yet today. Tap New visit at the party\'s shop.</div>'}</div>`);
  }

  /* 2. the form */
  const seg = (name, list, val) => `<div class="cv-seg" role="group">${list.map(([v, t]) => `<button type="button" data-s="${name}" data-v="${esc(v)}" class="${val === v ? 'on' : ''}" aria-pressed="${val === v}">${esc(t)}</button>`).join('')}</div>`;
  function drawForm() {
    const f = ST.f, got = f.result === 'received', no = f.result === 'not_received';
    screen(`<div class="mo-top">${back('home')}<div class="mo-who"><b>New visit</b><small>${ST.gps ? 'Location ready' : ST.gpsErr ? 'Location off' : 'Getting location…'}</small></div><span class="mo-sp"></span></div>
      <div class="cv-form">
        <label class="cv-l">Payment ${seg('result', [['received', 'Received'], ['not_received', 'Not received']], f.result)}</label>
        <label class="cv-l" for="cvParty">Party name<input id="cvParty" class="cv-in" list="cvParties" autocomplete="off" maxlength="150" placeholder="Shop / customer name" value="${esc(f.party)}"></label>
        <label class="cv-l" for="cvPlace">Party location<input id="cvPlace" class="cv-in" autocomplete="off" maxlength="250" placeholder="Area / address" value="${esc(f.place)}"></label>
        ${got ? `<label class="cv-l">Payment mode ${seg('mode', MODES.map((m) => [m, m]), f.mode)}</label>
          <label class="cv-l" for="cvAmt">Total amount (₹)<input id="cvAmt" class="cv-in cv-big" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amount)}"></label>
          <label class="cv-l">Invoice ${seg('invoice', [['full', 'Full invoice'], ['part', 'Part invoice']], f.invoice)}</label>` : ''}
        ${no ? `<label class="cv-l" for="cvWhy">Why not received<textarea id="cvWhy" class="cv-in" maxlength="500" rows="2" placeholder="Reason">${esc(f.reason)}</textarea></label>
          <div class="mo-chips cv-quick">${REASONS.map((r) => `<button type="button" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
        <div class="cv-l">Photo of the shop / office</div>
        <div class="mo-photo cv-photo${f.photo ? ' has' : ''}">${f.photo ? `<img src="${f.photo}" alt="Shop photo"><span class="mo-chip ${f.source === 'gallery' ? 'warn' : ''}">${f.source === 'gallery' ? 'From gallery' : 'Camera'}</span>` : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9l1.5-5h15L21 9M3 9h18v11H3zM9 20v-6h6v6"/></svg><span>Take a photo of the shop</span>'}</div>
        <div class="mo-two"><button type="button" class="mo-btn" data-c="cam">Camera</button><button type="button" class="mo-btn" data-c="gal">Gallery</button></div>
        <p class="mo-note cv-gps" id="cvGpsNote"${ST.gpsErr ? '' : ' hidden'}>Location is off. Turn on location so this visit saves where you are. <button type="button" class="mo-pill" data-c="gps">Turn on</button></p>
        <button type="button" class="mo-go mo-go-out" data-c="save">Save visit</button>
      </div>`);
  }
  function getGps() {
    ST.gps = null; ST.gpsErr = false;
    if (!navigator.geolocation) { ST.gpsErr = true; return; }
    navigator.geolocation.getCurrentPosition((p) => { ST.gps = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; upd(); },
      () => { ST.gpsErr = true; upd(); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 });
    function upd() {
      const s = root && $('.cv-form', root) && $('.mo-who small', root); if (s) s.textContent = ST.gps ? 'Location ready' : 'Location off';
      const n = root && $('#cvGpsNote', root); if (n) n.hidden = !ST.gpsErr;
    }
  }
  function pick(ev, source) {
    const file = ev.target.files && ev.target.files[0]; ev.target.value = '';
    if (!file) return;
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 1000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      let d = c.toDataURL('image/webp', 0.72); if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', 0.75);
      ST.f.photo = d; ST.f.source = source; drawForm();
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('Could not open that photo. Try another one.', 'err'); };
    img.src = url;
  }
  function b64Blob(data) {
    const [head, b] = data.split(','), bin = atob(b), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: (head.match(/data:([^;]+)/) || [])[1] || 'image/webp' });
  }
  async function upload(it) {
    const path = `collections/${ST.user}_${istDate(it.at)}_${Date.parse(it.at)}_${hex(8)}.webp`;
    const r = await sbClient.storage.from(BUCKET).upload(path, b64Blob(it.photo), { upsert: false, contentType: 'image/webp' });
    if (r.error) { const e = new Error(r.error.message || 'Upload failed'); if (/fetch|network|Load failed/i.test(e.message)) e.net = true; throw e; }
    return path;
  }
  const send = (it) => rpc('coll_add', { p_client_id: it.id, p_result: it.result, p_party: it.party, p_place: it.place || null, p_reason: it.reason || null,
    p_mode: it.mode || null, p_amount: it.amount === '' || it.amount == null ? null : Number(it.amount), p_invoice: it.invoice || null,
    p_photo_path: it.path, p_source: it.source, p_lat: it.lat, p_lng: it.lng, p_accuracy: it.acc, p_at: it.queued ? it.at : null });
  const MSG = { NO_PARTY: 'Write the party name.', NO_MODE: 'Pick the payment mode.', NO_AMOUNT: 'Write the amount.', NO_INVOICE: 'Pick full or part invoice.',
    NO_REASON: 'Write why the payment was not received.', PHOTO_MISSING: 'Photo did not upload. Try again.', NOT_ALLOWED: 'You are not a field collector. Ask admin.', TOO_OLD: 'This saved visit is older than 3 days and was dropped.' };

  async function save() {
    if (ST.busy) return;
    const f = ST.f;
    const err = !f.result ? 'Pick Received or Not received.' : !f.party.trim() ? MSG.NO_PARTY
      : f.result === 'received' && !f.mode ? MSG.NO_MODE : f.result === 'received' && !(Number(f.amount) > 0) ? MSG.NO_AMOUNT
      : f.result === 'received' && !f.invoice ? MSG.NO_INVOICE : f.result === 'not_received' && !f.reason.trim() ? MSG.NO_REASON
      : !f.photo ? 'Take a photo of the shop.' : '';
    if (err) { buzz([60, 40, 60]); toast(err, 'err'); return; }
    if (!ST.gps && !ST.gpsErr) { toast('Getting location… try again in a moment.', 'err'); return; }
    ST.busy = true; const btn = $('[data-c="save"]', root); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const it = { id: hex(12), at: new Date().toISOString(), result: f.result, party: f.party.trim(), place: f.place.trim(), reason: f.result === 'not_received' ? f.reason.trim() : '',
      mode: f.result === 'received' ? f.mode : '', amount: f.result === 'received' ? Number(f.amount) : null, invoice: f.result === 'received' ? f.invoice : '',
      photo: f.photo, source: f.source, lat: ST.gps ? ST.gps.lat : null, lng: ST.gps ? ST.gps.lng : null, acc: ST.gps ? ST.gps.acc : null };
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { net: true });
      it.path = await upload(it);
      const r = await send(it);
      if (r.status === 'SUCCESS') done(it, false);
      else { buzz([60, 40, 60]); toast(MSG[r.status] || 'Could not save (' + r.status + ')', 'err'); }
    } catch (e) {
      if (isNet(e)) { it.queued = true; const q = queue(); q.push(it); setQueue(q); done(it, true); }
      else toast(e.session ? 'Please sign in again.' : 'Could not save. Try again.', 'err');
    }
    ST.busy = false; const b2 = $('[data-c="save"]', root); if (b2) { b2.disabled = false; b2.textContent = 'Save visit'; }
  }
  function done(it, saved) {
    buzz(saved ? [40, 60, 40] : 50); ST.f = null;
    screen(`<div class="mo-done"><div class="mo-check ${saved ? 'saved' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true">${saved ? '<path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/>' : '<path d="M20 6L9 17l-5-5"/>'}</svg></div>
      <h2>${it.result === 'received' ? rs(it.amount) + ' received' : 'Visit saved'}</h2>
      <p>${esc(it.party)} · ${hm(it.at)}</p>
      ${saved ? '<p class="mo-note">No signal. Saved on this phone with the real time. It will be sent when the signal is back.</p>' : ''}
      <button type="button" class="mo-go mo-go-next" data-c="home">Done</button></div>`);
    if (!saved) refresh();
  }

  let flushing = false;
  async function flush() {
    if (flushing || !navigator.onLine || !tok()) return;
    let q = queue(); if (!q.length) return;
    flushing = true; let sent = 0, dropped = 0;
    while (q.length) {
      const it = q[0];
      try {
        if (!it.path) { it.path = await upload(it); setQueue(q); }
        const r = await send(it);
        if (r.status === 'SUCCESS') sent++; else dropped++;
        q.shift(); setQueue(q);
      } catch (e) { break; }
    }
    flushing = false;
    if (sent || dropped) { toast(sent + ' saved visit' + (sent === 1 ? '' : 's') + ' sent' + (dropped ? ', ' + dropped + ' could not be added' : ''), dropped ? 'err' : 'ok'); refresh(); }
  }
  addEventListener('online', () => setTimeout(flush, 1500));
  setInterval(() => { if (ST.me && ST.me.is_collector && queue().length) flush(); }, 30000);

  function onInput(ev) {
    if (!ST.f) return;
    const id = ev.target.id;
    if (id === 'cvParty') {
      ST.f.party = ev.target.value;
      const p = ((ST.me && ST.me.parties) || []).find((x) => x.party.toLowerCase() === ST.f.party.trim().toLowerCase());
      const pl = $('#cvPlace', root); if (p && p.place && pl && !pl.value) { pl.value = p.place; ST.f.place = p.place; }
    } else if (id === 'cvPlace') ST.f.place = ev.target.value;
    else if (id === 'cvWhy') ST.f.reason = ev.target.value;
    else if (id === 'cvAmt') { ev.target.value = ev.target.value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'); ST.f.amount = ev.target.value; }
  }
  function onClick(ev) {
    const s = ev.target.closest('[data-s]');
    if (s) { ST.f[s.dataset.s] = s.dataset.v; drawForm(); return; }
    const r = ev.target.closest('[data-r]');
    if (r) { ST.f.reason = r.dataset.r; const t = $('#cvWhy', root); if (t) t.value = r.dataset.r; return; }
    const m = ev.target.closest('[data-c]'); if (!m) return;
    const a = m.dataset.c;
    if (a === 'close') close();
    else if (a === 'home') { ST.f = null; drawHome(); }
    else if (a === 'new') { ST.f = newForm(); getGps(); drawForm(); }
    else if (a === 'flush') { if (!navigator.onLine) toast('Still no signal', 'err'); else flush(); }
    else if (a === 'cam') $('#cvCam', root).click();
    else if (a === 'gal') $('#cvGal', root).click();
    else if (a === 'save') save();
    else if (a === 'gps') { try { if (typeof retryEssentialPermissions === 'function') retryEssentialPermissions(); } catch (e) {} getGps(); }
  }
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && root && root.classList.contains('on')) { if (ST.f) { ST.f = null; drawHome(); } else close(); } });
})();
