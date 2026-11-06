/* Staffly dashboard - Collection visits (v105). View only.
 * Field collectors record visits in the phone app (collection-app.js). Admin / HR / Dev and Supriya see them here.
 * Backend: dash_coll_me / dash_coll_data (supabase/migrations/20_staffly_collections.sql). Uses app.js globals (S, NAV, gas, go, toast, esc, $). */
(function () {
  'use strict';
  const C = { me: null, data: null, loading: false, err: '', from: '', to: '', emp: '', res: '', q: '', key: '' };
  S.cv = C;

  TITLES.collections = ['Collection visits', 'Payment visits by the field collectors: party, amount, mode, shop photo and location'];
  ICON.collections = '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>';

  const allowed = () => !!(C.me && C.me.can_view);
  const _buildNav = buildNav;
  buildNav = function () {
    if (allowed() && !NAV.some((x) => x[0] === 'collections')) NAV = NAV.concat([['collections', 'Collection visits']]);
    _buildNav();
  };
  const _renderPage = renderPage;
  renderPage = function (soft) {
    if (S.page !== 'collections') return _renderPage(soft);
    const c = $('#center'); c.classList.remove('leaving');
    c.innerHTML = page();
    if (!soft) { c.classList.add('enter'); setTimeout(() => c.classList.remove('enter'), 400); }
  };
  PAGES.collections = () => page();
  const _go = go;
  go = function (p) { _go(p); if (p === 'collections') load(); };

  const ist = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  function range() {
    if (!C.to) { C.to = ist(new Date()); C.from = C.to.slice(0, 8) + '01'; }
  }
  async function load(quiet) {
    if (!allowed() || C.loading) return;
    range();
    const key = C.from + '|' + C.to;
    C.loading = true; if (!quiet) renderPage(true);
    try { C.data = await gas('webCollData', C.from, C.to); C.key = key; C.err = ''; } catch (e) { C.err = e.message; }
    C.loading = false;
    if (S.page === 'collections') renderPage(true);
  }

  const rs = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const ft = (t) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  function rows() {
    const q = C.q.toLowerCase();
    return (C.data ? C.data.rows : []).filter((r) => (!C.emp || r.emp === C.emp) && (!C.res || r.result === C.res)
      && (!q || (r.party + ' ' + (r.place || '') + ' ' + r.name).toLowerCase().includes(q)));
  }

  function page() {
    if (!allowed()) return '<div class="empty"><b>No access</b>Only Admin and the collection team can see collection visits.</div>';
    range();
    if (C.err && !C.data) return `<div class="empty"><b>Could not load</b>${esc(C.err)}<br><br><button class="ap-btn" data-cv="reload">Try again</button></div>`;
    if (!C.data) return '<div class="ap-load">Loading…</div>';
    const R = rows(), got = R.filter((r) => r.result === 'received'), total = got.reduce((s, r) => s + Number(r.amount || 0), 0);
    const byMode = {}; got.forEach((r) => { byMode[r.mode] = (byMode[r.mode] || 0) + Number(r.amount || 0); });
    const per = {}; R.forEach((r) => { const p = per[r.emp] || (per[r.emp] = { name: r.name, v: 0, g: 0, a: 0, days: new Set() }); p.v++; p.days.add(r.d); if (r.result === 'received') { p.g++; p.a += Number(r.amount || 0); } });
    const tiles = `<div class="cv-tiles">
      <div class="cv-tile"><small>Visits</small><b>${R.length}</b></div>
      <div class="cv-tile"><small>Payment received</small><b>${got.length}</b></div>
      <div class="cv-tile"><small>Not received</small><b>${R.length - got.length}</b></div>
      <div class="cv-tile cv-tile-w"><small>Amount collected</small><b>${rs(total)}</b><span>${Object.keys(byMode).map((m) => esc(m) + ' ' + rs(byMode[m])).join(' · ') || '—'}</span></div></div>`;
    const people = Object.keys(per).length ? `<div class="ap-card"><h3>By collector</h3><div class="ap-tw"><table class="ap-t"><thead><tr><th>Collector</th><th>Days out</th><th>Visits</th><th>Received</th><th class="cv-r">Amount</th></tr></thead><tbody>
      ${Object.keys(per).map((k) => per[k]).sort((a, b) => b.a - a.a).map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${p.days.size}</td><td>${p.v}</td><td>${p.g}</td><td class="cv-r"><b>${rs(p.a)}</b></td></tr>`).join('')}
      </tbody></table></div></div>` : '';
    const list = R.length ? `<div class="ap-tw"><table class="ap-t cv-t"><thead><tr><th>When</th><th>Collector</th><th>Party</th><th>Payment</th><th class="cv-r">Amount</th><th>Photo</th><th>Location</th></tr></thead><tbody>
      ${R.map((r) => `<tr><td>${ft(r.at)}${r.offline ? '<small>sent later (no signal)</small>' : ''}</td><td>${esc(r.name)}</td>
        <td><b>${esc(r.party)}</b>${r.place ? `<small>${esc(r.place)}</small>` : ''}</td>
        <td>${r.result === 'received' ? `<span class="cv-k cv-got">Received</span><small>${esc(r.mode)} · ${r.invoice === 'part' ? 'Part' : 'Full'} invoice</small>` : `<span class="cv-k cv-no">Not received</span><small>${esc(r.reason || '')}</small>`}</td>
        <td class="cv-r">${r.result === 'received' ? '<b>' + rs(r.amount) + '</b>' : '<span class="ap-mut">—</span>'}</td>
        <td><a class="cv-ph" href="${esc(r.photo)}" target="_blank" rel="noopener"><img src="${esc(r.photo)}" alt="Shop photo, ${esc(r.party)}" loading="lazy"></a>${r.src === 'gallery' ? '<small class="mo-warn">from gallery</small>' : ''}</td>
        <td>${r.lat != null ? `<a class="ap-btn ap-sm" href="https://www.google.com/maps?q=${r.lat},${r.lng}" target="_blank" rel="noopener">Map</a><small>±${r.acc || '?'} m</small>` : '<span class="mo-warn">No location</span>'}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="ap-empty">No visits for these filters.</div>';
    const coll = (C.data.collectors || []);
    return `<div class="ap">
      <div class="ap-card cv-filt">
        <label>From<input type="date" id="cvFrom" value="${esc(C.from)}" max="${esc(C.data.today)}"></label>
        <label>To<input type="date" id="cvTo" value="${esc(C.to)}" max="${esc(C.data.today)}"></label>
        <label>Collector<select id="cvEmp"><option value="">All</option>${coll.map((e) => `<option value="${esc(e.id)}" ${e.id === C.emp ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
        <label>Payment<select id="cvRes"><option value="">All</option><option value="received" ${C.res === 'received' ? 'selected' : ''}>Received</option><option value="not_received" ${C.res === 'not_received' ? 'selected' : ''}>Not received</option></select></label>
        <label class="cv-grow">Search<input type="search" id="cvQ" placeholder="Party or area" value="${esc(C.q)}"></label>
        <button class="ap-btn" data-cv="csv">Download CSV</button>
      </div>
      ${tiles}${people}
      <div class="ap-card"><h3>Visits <span class="ap-count mo-count">${R.length}</span></h3>${list}</div></div>`;
  }

  function csv() {
    const R = rows(), h = ['Date', 'Time', 'Collector', 'Party', 'Party location', 'Payment', 'Mode', 'Amount', 'Invoice', 'Reason', 'Photo', 'Latitude', 'Longitude', 'Sent later'];
    const t = (x) => new Date(x).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
    const lines = [h].concat(R.map((r) => [r.d, t(r.at), r.name, r.party, r.place || '', r.result === 'received' ? 'Received' : 'Not received', r.mode || '', r.amount == null ? '' : r.amount,
      r.invoice === 'part' ? 'Part' : r.invoice === 'full' ? 'Full' : '', r.reason || '', r.photo, r.lat == null ? '' : r.lat, r.lng == null ? '' : r.lng, r.offline ? 'Yes' : '']));
    const s = lines.map((l) => l.map((v) => { v = String(v); if (/^[=+\-@]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + s], { type: 'text/csv' })); a.download = 'Collection visits ' + C.from + ' to ' + C.to + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  const CEN = $('#center');
  CEN.addEventListener('click', (ev) => {
    if (S.page !== 'collections') return;
    const b = ev.target.closest('[data-cv]'); if (!b) return;
    if (b.dataset.cv === 'reload') { C.err = ''; load(); }
    if (b.dataset.cv === 'csv') csv();
  });
  CEN.addEventListener('change', (ev) => {
    if (S.page !== 'collections') return;
    const id = ev.target.id, v = ev.target.value;
    if (id === 'cvFrom' || id === 'cvTo') {
      if (id === 'cvFrom') C.from = v; else C.to = v;
      if (C.from && C.to && C.from > C.to) { toast('From date is after To date', 'err'); return; }
      if (C.from && C.to) load(true);
    }
    if (id === 'cvEmp') { C.emp = v; renderPage(true); }
    if (id === 'cvRes') { C.res = v; renderPage(true); }
  });
  CEN.addEventListener('input', (ev) => {
    if (S.page !== 'collections' || ev.target.id !== 'cvQ') return;
    C.q = ev.target.value; clearTimeout(C.t);
    C.t = setTimeout(() => { renderPage(true); const i = $('#cvQ'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250);
  });

  (function wait(n) {
    const u = StafflyAPI.user && StafflyAPI.user();
    if (u && u.token && S.today) {
      gas('webCollMe').then((m) => { C.me = m; if (allowed()) { document.body.classList.add('coll-mode'); buildNav(); } }).catch(() => {});
    } else if (n < 240) setTimeout(() => wait(n + 1), 500);
  })(0);
})();
