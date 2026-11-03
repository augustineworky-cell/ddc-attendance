/* Staffly dashboard - Morons (guard punches labours who have no smartphone).
 * Admin / HR / Dev only. Pick the guards (each gets a 4-digit Moron PIN) and the workers.
 * A guard logs into the phone app normally, opens Morons, types the PIN and punches his branch's workers in / out.
 * Backend: dash_moron_* RPCs (supabase/migrations/17_staffly_morons.sql). Uses app.js globals (S, NAV, gas, go, toast, esc, $). */
(function () {
  'use strict';
  const M = { data: null, loading: false, err: '', loc: '', gEmp: '', gPin: '', wEmp: '' };
  S.mo = M;

  TITLES.morons = ['Morons', 'Guards punch these workers in and out from the gate phone'];
  ICON.morons = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>';

  const allowed = () => StafflyAPI.isAdmin && StafflyAPI.isAdmin();

  const _buildNav = buildNav;
  buildNav = function () {
    if (allowed() && !NAV.some((x) => x[0] === 'morons')) NAV = NAV.concat([['morons', 'Morons']]);
    _buildNav();
  };
  const _renderPage = renderPage;
  renderPage = function (soft) {
    if (S.page !== 'morons') return _renderPage(soft);
    const c = $('#center'); c.classList.remove('leaving');
    c.innerHTML = page();
    if (!soft) { c.classList.add('enter'); setTimeout(() => c.classList.remove('enter'), 400); }
  };
  PAGES.morons = () => page();
  const _go = go;
  go = function (p) { _go(p); if (p === 'morons') load(); };

  async function load(quiet) {
    if (!allowed() || M.loading) return;
    M.loading = true; if (!quiet) renderPage(true);
    try { M.data = await gas('webMoronData'); M.err = ''; } catch (e) { M.err = e.message; }
    M.loading = false;
    if (S.page === 'morons') renderPage(true);
  }

  const ft = (t) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  const ini = (n) => esc(String(n || '').split(' ').map((w) => w[0]).slice(0, 2).join(''));
  const opts = (list, sel) => {
    const locs = [...new Set(list.map((s) => s.location))];
    return locs.map((l) => `<optgroup label="${esc(l)}">${list.filter((s) => s.location === l).map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('');
  };

  function guardsCard(d) {
    const g = d.guards;
    return `<div class="ap-card"><h3>Guards <span class="ap-count mo-count">${g.length}</span></h3>
      ${g.length ? g.map((x) => `<div class="mo-row" data-id="${esc(x.id)}">
        <div class="ap-av">${ini(x.name)}</div>
        <div class="mo-main"><b>${esc(x.name)}</b><small>${esc(x.location)} · Moron PIN •••• · ${x.workers} worker${x.workers === 1 ? '' : 's'} in his branch${x.locked ? ' · <span class="mo-warn">locked after wrong PINs</span>' : ''}</small></div>
        <div class="ap-acts"><button class="ap-btn ap-sm" data-mo="gpin">Change PIN</button><button class="ap-btn ap-no ap-sm" data-mo="grm">Remove</button></div>
      </div>`).join('') : '<div class="ap-empty">No guard yet. Add one on the right: pick the person and give him a 4-digit Moron PIN.</div>'}
    </div>`;
  }

  function workersCard(d) {
    const locs = [...new Set(d.workers.map((w) => w.location))];
    const W = d.workers.filter((w) => !M.loc || w.location === M.loc);
    const last = (l) => !l ? '<span class="ap-mut">No punch yet</span>'
      : `<span class="mo-k mo-${l.kind}">${l.kind === 'in' ? 'IN' : 'OUT'}</span> ${ft(l.at)} <span class="${l.source === 'gallery' ? 'mo-warn' : 'ap-mut'}">· ${esc(l.source)}</span>${l.offline ? ' <span class="ap-mut">· sent later</span>' : ''}<small>by ${esc(String(l.guard || '').split(' ')[0])}</small>`;
    return `<div class="ap-card"><div class="mo-head"><h3>Workers <span class="ap-count mo-count">${d.workers.length}</span></h3>
        ${locs.length > 1 ? `<select id="moLoc" class="mo-sel" aria-label="Branch"><option value="">All branches</option>${locs.map((l) => `<option ${l === M.loc ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}</div>
      ${W.length ? `<div class="ap-tw"><table class="ap-t"><thead><tr><th>Worker</th><th>Branch</th><th>Last punch</th><th></th></tr></thead><tbody>
        ${W.map((w) => `<tr data-id="${esc(w.id)}"><td><b>${esc(w.name)}</b><small>${esc(w.id)}</small></td><td>${esc(w.location)}</td><td class="mo-last">${last(w.last)}</td>
          <td><button class="ap-btn ap-ghost ap-sm" data-mo="wrm">Remove</button></td></tr>`).join('')}
      </tbody></table></div>` : '<div class="ap-empty">No workers yet. Add the labours the guard should punch in and out.</div>'}
    </div>`;
  }

  function side(d) {
    const notW = d.staff.filter((s) => !s.is_worker), all = d.staff;
    return `<div class="ap-col">
      <form class="ap-card ap-form" id="moW"><h3>Add worker</h3>
        <label>Employee<select id="moWEmp" required><option value="">Choose a person</option>${opts(notW, M.wEmp)}</select></label>
        <p class="ap-hint">The guard of the same branch will see this person in his Morons list.</p>
        <button class="ap-btn ap-pri" type="submit">Add to Morons</button>
      </form>
      <form class="ap-card ap-form" id="moG"><h3>Add guard / change PIN</h3>
        <label>Guard<select id="moGEmp" required><option value="">Choose a person</option>${opts(all, M.gEmp)}</select></label>
        <label>Moron PIN<span class="mo-pin"><input id="moGPin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4 digits" value="${esc(M.gPin)}"><button type="button" class="ap-btn" data-mo="auto">Auto</button></span></label>
        <p class="ap-hint">He still logs in with his own ID and password. The PIN only opens Morons. Tell him the PIN yourself, not in a group.</p>
        <button class="ap-btn ap-pri" type="submit">Save guard</button>
      </form>
    </div>`;
  }

  function page() {
    if (!allowed()) return '<div class="empty"><b>No access</b>Only Admin / Dev can manage Morons.</div>';
    if (M.err && !M.data) return `<div class="empty"><b>Could not load</b>${esc(M.err)}<br><br><button class="ap-btn" data-mo="reload">Try again</button></div>`;
    if (!M.data) return '<div class="ap-load">Loading…</div>';
    return `<div class="ap"><div class="ap-two mo-two"><div class="ap-col">${guardsCard(M.data)}${workersCard(M.data)}</div>${side(M.data)}</div></div>`;
  }

  const C = $('#center');
  C.addEventListener('click', async (ev) => {
    if (S.page !== 'morons') return;
    const b = ev.target.closest('[data-mo]'); if (!b) return;
    const k = b.dataset.mo;
    if (k === 'reload') { M.err = ''; load(); return; }
    if (k === 'auto') { const p = $('#moGPin'); p.value = String(Math.floor(1000 + Math.random() * 9000)); M.gPin = p.value; return; }
    const row = b.closest('[data-id]'); if (!row) return;
    const id = row.dataset.id;
    if (k === 'gpin') { M.gEmp = id; M.gPin = ''; renderPage(true); setTimeout(() => { const p = $('#moGPin'); if (p) p.focus(); }, 30); return; }
    if (b.dataset.sure !== '1') { const t = b.textContent; b.dataset.sure = '1'; b.textContent = 'Tap again'; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = t; } }, 3000); return; }
    b.disabled = true;
    try {
      if (k === 'grm') { await gas('webMoronRemoveGuard', id); toast('Guard removed. Morons is closed on his phone.', 'ok'); }
      if (k === 'wrm') { await gas('webMoronSetWorker', id, false); toast('Worker removed from Morons', 'ok'); }
      await load(true);
    } catch (e) { b.disabled = false; toast(e.message, 'err'); }
  });
  C.addEventListener('change', (ev) => {
    if (S.page !== 'morons') return;
    if (ev.target.id === 'moLoc') { M.loc = ev.target.value; renderPage(true); }
    if (ev.target.id === 'moGEmp') M.gEmp = ev.target.value;
    if (ev.target.id === 'moWEmp') M.wEmp = ev.target.value;
  });
  C.addEventListener('input', (ev) => {
    if (S.page === 'morons' && ev.target.id === 'moGPin') { ev.target.value = ev.target.value.replace(/\D/g, '').slice(0, 4); M.gPin = ev.target.value; }
  });
  C.addEventListener('submit', async (ev) => {
    if (S.page !== 'morons' || (ev.target.id !== 'moW' && ev.target.id !== 'moG')) return;
    ev.preventDefault();
    const btn = ev.target.querySelector('button[type=submit]');
    try {
      if (ev.target.id === 'moW') {
        const id = $('#moWEmp').value; if (!id) { toast('Choose a person', 'err'); return; }
        btn.disabled = true; await gas('webMoronSetWorker', id, true); M.wEmp = ''; toast('Added to Morons', 'ok');
      } else {
        const id = $('#moGEmp').value, pin = $('#moGPin').value;
        if (!id) { toast('Choose the guard', 'err'); return; }
        if (!/^\d{4}$/.test(pin)) { toast('Moron PIN must be 4 digits', 'err'); return; }
        btn.disabled = true; await gas('webMoronSetGuard', id, pin); M.gEmp = ''; M.gPin = ''; toast('Guard saved. Give him the PIN: ' + pin, 'ok');
      }
      await load(true);
    } catch (e) { if (btn) btn.disabled = false; toast(e.message, 'err'); }
  });

  (function wait(n) {
    const u = StafflyAPI.user && StafflyAPI.user();
    if (u && u.token && S.today) { if (allowed()) buildNav(); }
    else if (n < 240) setTimeout(() => wait(n + 1), 500);
  })(0);
})();
