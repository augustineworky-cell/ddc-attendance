/* Staffly dashboard - Extra day / Night approvals.
 * Requesters (Anshu, Avinash) ask for an Extra day or Night for any staff member.
 * The approver (Neelam) approves or rejects. Only an approved request is written to that person's day.
 * Backend: dash_appr_* RPCs (see staffly-api.js). Loaded after app.js and uses its globals (S, NAV, gas, go, toast, esc). */
(function () {
  'use strict';
  const A = { me: null, staff: null, rows: null, loading: false, kind: 'extra', emp: '', date: '', reason: '', tab: 'pending' };
  S.ap = A;

  TITLES.approvals = ['Extra & night approvals', 'Requests for Extra day or Night duty. Nothing counts until it is approved.'];
  ICON.approvals = '<path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>';
  BADGE.approvals = 'appr';

  const allowed = () => A.me && (A.me.can_request || A.me.can_approve);
  const navLabel = () => (A.me && A.me.can_approve ? 'Approvals' : 'Extra / night requests');

  /* add the page to whichever menu is showing (employee mode or full admin menu) */
  const _buildNav = buildNav;
  buildNav = function () {
    if (allowed() && !NAV.some((x) => x[0] === 'approvals')) NAV = NAV.concat([['approvals', navLabel()]]);
    _buildNav();
    setBadge();
  };
  function setBadge() {
    if (!A.me) return;
    const n = A.me.can_approve ? A.me.pending : A.me.mine_pending;
    ['bd_appr', 'apBtnN'].forEach((id) => { const el = document.getElementById(id); if (el) { el.textContent = n || ''; el.style.display = n ? '' : 'none'; } });
    const b = document.getElementById('apBtn'); if (b) b.classList.toggle('on', S.page === 'approvals');
  }
  /* top-bar button: the side menu is hidden for employees, so this is how Anshu, Avinash and Neelam open the page */
  function topButton() {
    const mob = document.getElementById('mobBtn'); if (!mob || document.getElementById('apBtn')) return;
    const b = document.createElement('button');
    b.id = 'apBtn'; b.type = 'button'; b.className = mob.className;
    b.innerHTML = navLabel() + ' <span id="apBtnN" class="ap-n"></span>';
    b.addEventListener('click', () => { if (S.page === 'approvals') { if (S.sel) openProfile(S.sel); else go(StafflyAPI.isAdmin() ? 'overview' : 'profile'); } else go('approvals'); setBadge(); });
    mob.parentNode.insertBefore(b, mob);
    setBadge();
  }

  const _renderPage = renderPage;
  renderPage = function (soft) {
    if (S.page !== 'approvals') return _renderPage(soft);
    const c = $('#center'); c.classList.remove('leaving');
    c.innerHTML = page();
    if (!soft) { c.classList.add('enter'); setTimeout(() => c.classList.remove('enter'), 400); }
  };
  PAGES.approvals = () => page();
  const _go = go;
  go = function (p) { _go(p); if (p === 'approvals') load(); setBadge(); };

  /* ---------- data ---------- */
  async function init() {
    try { A.me = await gas('webApprMe'); } catch (e) { return; }
    if (!allowed()) return;
    document.body.classList.add('appr-mode');
    buildNav(); topButton();
    if (A.me.can_approve && A.me.pending && S.page !== 'approvals') toast(A.me.pending + ' extra / night request' + (A.me.pending > 1 ? 's' : '') + ' waiting for you');
  }
  async function load(quiet) {
    if (!allowed() || A.loading) return;
    A.loading = true; if (!quiet) renderPage(true);
    try {
      const [st, ls, me] = await Promise.all([A.staff ? null : gas('webApprStaff'), gas('webApprList'), gas('webApprMe')]);
      if (st) { A.staff = st.staff; A.today = st.today; A.dataStart = st.data_start; if (!A.date) A.date = st.today; }
      A.rows = ls.rows || []; A.me = me; A.err = '';
    } catch (e) { A.err = e.message; }
    A.loading = false; setBadge();
    if (S.page === 'approvals') renderPage(true);
  }

  /* ---------- view ---------- */
  const KIND = { extra: 'Extra day', night: 'Night' };
  const fd = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const ft = (t) => new Date(t).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  const kindPill = (k) => `<span class="ap-pill ap-${k}">${k === 'extra' ? '☀' : '☾'} ${KIND[k]}</span>`;
  const statPill = (s) => `<span class="ap-pill ap-s-${s}">${{ pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }[s]}</span>`;
  const dayLine = (d) => !d ? '' : `That day: <b>${esc(d.status || '—')}</b>${d.in || d.out ? ` · In ${esc((d.in || '—').slice(0, 5))} · Out ${esc((d.out || '—').slice(0, 5))}${d.hours ? ` (${d.hours} h)` : ''}` : ' · no punches'}`;
  const ini = (n) => esc(String(n || '').split(' ').map((w) => w[0]).slice(0, 2).join(''));

  function form() {
    const locs = [...new Set((A.staff || []).map((s) => s.location))];
    return `<form class="ap-card ap-form" id="apForm">
      <h3>New request</h3>
      <label>Employee<select id="apEmp" required><option value="">Choose a person</option>${locs.map((l) => `<optgroup label="${esc(l)}">${A.staff.filter((s) => s.location === l).map((s) => `<option value="${s.id}" ${String(s.id) === String(A.emp) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>`).join('')}</select></label>
      <label>Date<input type="date" id="apDate" value="${esc(A.date)}" max="${esc(A.today || '')}" min="${esc(A.dataStart || '')}" required></label>
      <div class="ap-lbl">Type</div>
      <div class="ap-seg"><button type="button" data-ap="kind" data-v="extra" class="${A.kind === 'extra' ? 'on' : ''}">☀ Extra day</button><button type="button" data-ap="kind" data-v="night" class="${A.kind === 'night' ? 'on' : ''}">☾ Night</button></div>
      <label>Reason<textarea id="apWhy" maxlength="300" placeholder="e.g. Sunday unloading for Pluckk truck" required>${esc(A.reason)}</textarea></label>
      <p class="ap-hint">Extra day = worked on a Sunday or holiday. Night = stayed for a night shift. It goes to Neelam and only counts once she approves.</p>
      <button class="ap-btn ap-pri" type="submit">Send for approval</button>
    </form>`;
  }

  function pendingCard(r) {
    const canDecide = A.me.can_approve && (!r.mine || A.me.is_admin);
    return `<div class="ap-req" data-id="${r.id}">
      <div class="ap-av">${ini(r.employee)}</div>
      <div class="ap-main"><div><b>${esc(r.employee)}</b> <span class="ap-mut">· ${esc(r.location || '')}</span></div>
        <div class="ap-meta">${kindPill(r.kind)}<span>${fd(r.date)}</span><span class="ap-mut">asked by ${esc(String(r.requested_by).split(' ')[0])}, ${ft(r.requested_at)}</span></div>
        <q>${esc(r.reason)}</q><div class="ap-meta ap-mut">${dayLine(r.day)}</div></div>
      <div class="ap-acts">${canDecide ? `<button class="ap-btn ap-ok" data-ap="approve">Approve</button><button class="ap-btn ap-no" data-ap="reject">Reject</button>` : ''}${r.mine || A.me.is_admin ? `<button class="ap-btn ap-ghost" data-ap="cancel">Cancel request</button>` : ''}</div>
      ${canDecide ? `<div class="ap-note"><input id="apNote${r.id}" maxlength="300" placeholder="Comment (needed to reject)"></div>` : ''}
    </div>`;
  }

  function history(rows) {
    if (!rows.length) return '<div class="ap-empty">Nothing decided yet.</div>';
    return `<div class="ap-tw"><table class="ap-t"><thead><tr><th>Employee</th><th>Date</th><th>Type</th><th>Reason</th><th>Asked by</th><th>Decision</th>${A.me.is_admin ? '<th></th>' : ''}</tr></thead><tbody>${rows.map((r) => `<tr data-id="${r.id}">
      <td><b>${esc(r.employee)}</b><small>${esc(r.location || '')}</small></td><td>${fd(r.date)}</td><td>${kindPill(r.kind)}</td><td class="ap-why">${esc(r.reason)}</td>
      <td>${esc(String(r.requested_by).split(' ')[0])}</td>
      <td>${statPill(r.status)}<small>${r.decided_by ? esc(r.decided_by.split(' ')[0]) + ' · ' + ft(r.decided_at) : ''}</small>${r.note ? `<small class="ap-q">“${esc(r.note)}”</small>` : ''}</td>
      ${A.me.is_admin ? `<td>${r.status === 'approved' ? '<button class="ap-btn ap-ghost ap-sm" data-ap="cancel">Undo</button>' : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
  }

  function page() {
    if (!A.me || !allowed()) return '<div class="empty"><b>No access</b>Ask the admin to give you access to Extra / Night requests.</div>';
    if (A.err && !A.rows) return `<div class="empty"><b>Could not load</b>${esc(A.err)}<br><br><button class="ap-btn" data-ap="reload">Try again</button></div>`;
    if (!A.rows) return '<div class="ap-load">Loading requests…</div>';
    const pend = A.rows.filter((r) => r.status === 'pending'), done = A.rows.filter((r) => r.status !== 'pending');
    const pendBox = `<div class="ap-card"><h3>${A.me.can_approve ? 'Waiting for you' : 'Waiting for Neelam'} <span class="ap-count">${pend.length}</span></h3>${pend.length ? pend.map(pendingCard).join('') : `<div class="ap-empty">${A.me.can_approve ? 'All clear. New requests will show up here.' : 'No pending requests.'}</div>`}</div>`;
    const doneBox = `<div class="ap-card"><h3>${A.me.can_approve ? 'Decided' : 'My requests'}</h3>${history(done)}</div>`;
    return `<div class="ap">${A.me.can_request ? `<div class="ap-two">${form()}<div class="ap-col">${pendBox}</div></div>` : pendBox}${doneBox}</div>`;
  }

  /* ---------- actions ---------- */
  const C = $('#center');
  C.addEventListener('click', async (ev) => {
    if (S.page !== 'approvals') return;
    const b = ev.target.closest('[data-ap]'); if (!b) return;
    const k = b.dataset.ap;
    if (k === 'kind') { A.kind = b.dataset.v; C.querySelectorAll('.ap-seg button').forEach((x) => x.classList.toggle('on', x === b)); return; }
    if (k === 'reload') { A.err = ''; load(); return; }
    const row = b.closest('[data-id]'); if (!row) return;
    const id = +row.dataset.id;
    if (k === 'approve' || k === 'reject') {
      const noteEl = document.getElementById('apNote' + id), note = noteEl ? noteEl.value.trim() : '';
      if (k === 'reject' && !note) { if (noteEl) noteEl.focus(); toast('Add a comment so they know why it was rejected', 'err'); return; }
      b.disabled = true;
      try { await gas('webApprDecide', id, k, note); toast(k === 'approve' ? 'Approved. Added to their attendance.' : 'Rejected. Nothing added.', 'ok'); S.cache = {}; S.emp = null; await load(true); }
      catch (e) { b.disabled = false; toast(e.message, 'err'); }
    } else if (k === 'cancel') {
      if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Tap again to confirm'; setTimeout(() => { if (b.isConnected) { b.dataset.sure = ''; b.textContent = b.classList.contains('ap-sm') ? 'Undo' : 'Cancel request'; } }, 3000); return; }
      b.disabled = true;
      try { await gas('webApprCancel', id); toast('Request cancelled', 'ok'); S.cache = {}; S.emp = null; await load(true); }
      catch (e) { b.disabled = false; toast(e.message, 'err'); }
    }
  });
  C.addEventListener('input', (ev) => {
    if (S.page !== 'approvals') return;
    if (ev.target.id === 'apWhy') A.reason = ev.target.value;
  });
  C.addEventListener('change', (ev) => {
    if (S.page !== 'approvals') return;
    if (ev.target.id === 'apEmp') A.emp = ev.target.value;
    if (ev.target.id === 'apDate') A.date = ev.target.value;
  });
  C.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'apForm') return;
    ev.preventDefault();
    A.emp = $('#apEmp').value; A.date = $('#apDate').value; A.reason = $('#apWhy').value.trim();
    if (!A.emp) { toast('Choose an employee', 'err'); return; }
    if (!A.reason) { toast('Write a reason', 'err'); return; }
    const btn = ev.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      await gas('webApprRequest', A.emp, A.date, A.kind, A.reason);
      toast('Sent to Neelam for approval', 'ok'); A.reason = ''; A.emp = '';
      await load(true);
    } catch (e) { btn.disabled = false; toast(e.message, 'err'); }
  });

  /* start once the person has signed in and the dashboard has loaded */
  (function wait(n) {
    const u = StafflyAPI.user && StafflyAPI.user();
    if (u && u.token && S.today) init();
    else if (n < 240) setTimeout(() => wait(n + 1), 500);
  })(0);
})();
