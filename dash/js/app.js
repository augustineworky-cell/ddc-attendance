const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const S = { emps: [], today: '', dataStart: '', latest: null, sel: null, month: '', rows: [], emp: null,
            admin: false, token: null, secs: 0, loc: '', special: '', activeOnly: true, listQ: '', adminOk: true, editDate: null,
            from: '', to: '', rkey: 'month', dayStatus: '',
            page: 'profile', all: [], cache: {}, sort: {}, dtab: { absent: 'emp', missing: 'emp' }, emap: {}, loadingAll: true };
S.mg = { q: '', rm: null };
const STATUS_OPTS = ['', 'Present', 'Absent', 'Half Day', 'Extra Day', 'Holiday'];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

let pend = 0, busyT = null;
const busyLabel = { webAdminSetDay: 'Saving to Supabase…', webAdminClearDay: 'Clearing changes…', webAdminLogin: 'Checking password…', webAdminPunches: 'Loading punches…', webCalendar: 'Loading calendar…', webRange: 'Loading data from Supabase…', webEmployees: 'Loading employees…', webDayPunches: 'Loading punches…', webPhoto: 'Loading photo…', webAdminExportMonth: 'Building the report…', webAdminSalaryMonth: 'Calculating salary…' };
function busyUpd(fn) {
  $('#topbar').classList.toggle('on', pend > 0);
  clearTimeout(busyT);
  if (pend > 0) busyT = setTimeout(() => { $('#busyTx').textContent = (fn && busyLabel[fn]) || 'Working…'; $('#busy').classList.add('on'); }, 450);
  else $('#busy').classList.remove('on');
}
/* All server calls go to Staffly's Supabase through StafflyAPI (dash/js/staffly-api.js). Same function names as before. */
function askSitePassword() {
  return new Promise((resolve) => {
    const w = document.createElement('div'); w.className = 'sitegate';
    document.body.appendChild(w);
    /* design-v1: black & white login with a 3D cube hero (wide screens only). The form logic below is unchanged. */
    w.innerHTML = '<div class="sg-stage" aria-hidden="true"></div><div class="sg-veil" aria-hidden="true"></div>'
      + '<div class="sg-hero" aria-hidden="true"><div class="sg-brand"><b>Staffly</b><i></i><span>DCC Supply Chain &amp; Distribution</span></div>'
      + '<div><span class="sg-badge"><s></s>Safdarjung · Okhla · Gurgaon</span>'
      + '<h1><span style="animation-delay:.3s">Every</span> <span style="animation-delay:.42s">punch.</span><br><span style="animation-delay:.56s">Every</span> <span style="animation-delay:.68s">person.</span><br><span style="animation-delay:.84s;font-style:italic">on time.</span></h1>'
      + '<p>Attendance, leave and payroll for the whole DCC team. GPS-verified punches, selfie check-in, one calendar.</p></div>'
      + '<div class="sg-feat"><span>GPS geofence</span><span>Selfie verified</span><span>Leave &amp; payroll</span><span>Installs as an app</span></div></div>'
      + '<div class="sg-slot"></div>';
    const slot = w.querySelector('.sg-slot');
    let stopCube = null, closed = false;
    const canWebGL = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
    if (window.innerWidth >= 1100 && canWebGL) {
      import('/dash/js/gate-cube.js?v=1').then((m) => { if (!closed) stopCube = m.startCube(w.querySelector('.sg-stage')); }).catch(() => { /* no cube: the login still works */ });
    }
    const logo = '<div class="sg-logo"><img src="/dash/img/staffly-icon.png" alt="Staffly"></div>';
    const foot = '<p class="sg-foot">DCC Supply Chain &amp; Distribution LLP<br>Authorised staff only</p>';
    const finish = () => { closed = true; if (stopCube) { try { stopCube(); } catch (e) {} } w.remove(); resolve(); };
    const eyeSvg = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    const pinField = (label) => '<label class="sg-field"><span>' + label + '</span><div class="sg-in"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="4-digit PIN" style="letter-spacing:.5em;font-weight:700"></div></label>';

    function showPassword() {
      slot.innerHTML = '<form class="sg-card" novalidate>' + logo + '<h3>Staffly Attendance</h3>'
        + '<p class="sg-sub">Sign in with your Employee ID and password<br>to see your attendance.</p>'
        + '<label class="sg-field"><span>Employee ID</span><div class="sg-in"><svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg><input name="id" type="text" autocomplete="username" autocapitalize="characters" spellcheck="false" placeholder="e.g. DCC101" autofocus></div></label>'
        + '<label class="sg-field"><span>Password</span><div class="sg-in"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg><input name="pw" type="password" autocomplete="current-password" placeholder="Enter your password"><button type="button" class="sg-eye" tabindex="-1" aria-label="Show password">' + eyeSvg + '</button></div></label>'
        + '<button class="sg-go" type="submit">Sign in</button><div class="err" role="alert"></div>' + foot + '</form>';
      const f = w.querySelector('form'), i = w.querySelector('input[name=id]'), p = w.querySelector('input[name=pw]'), er = w.querySelector('.err'), b = w.querySelector('.sg-go'), eye = w.querySelector('.sg-eye');
      eye.addEventListener('click', () => { const s = p.type === 'password'; p.type = s ? 'text' : 'password'; p.focus(); });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); er.textContent = ''; if (!i.value.trim() || !p.value) { er.textContent = 'Enter your Employee ID and password.'; (i.value.trim() ? p : i).focus(); return; }
        b.disabled = true; b.innerHTML = '<span class="sp"></span>Signing in…';
        try { await StafflyAPI.login(i.value.trim(), p.value); showSetPin(); }
        catch (e) { er.textContent = e.message; b.disabled = false; b.textContent = 'Sign in'; p.select(); }
      });
      setTimeout(() => i.focus(), 50);
    }

    function showSetPin() {
      const u = StafflyAPI.user() || {};
      slot.innerHTML = '<form class="sg-card" novalidate>' + logo + '<h3>Set your PIN</h3>'
        + '<p class="sg-sub">Hi ' + esc((u.name || '').split(' ')[0]) + '. Choose a 4-digit PIN for this computer.<br>Next time you only need the PIN.</p>'
        + pinField('New PIN') + pinField('Confirm PIN').replace('name="pin"', 'name="pin2"')
        + '<button class="sg-go" type="submit">Save PIN &amp; continue</button><div class="err" role="alert"></div>'
        + '<div class="sg-or">or</div><a href="#" class="sg-mob" id="sgSkip">Skip for now</a>' + foot + '</form>';
      const f = w.querySelector('form'), a = w.querySelector('input[name=pin]'), c = w.querySelector('input[name=pin2]'), er = w.querySelector('.err'), b = w.querySelector('.sg-go');
      w.querySelector('#sgSkip').addEventListener('click', (ev) => { ev.preventDefault(); finish(); });
      [a, c].forEach((x) => x.addEventListener('input', () => { x.value = x.value.replace(/\D/g, '').slice(0, 4); }));
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault(); er.textContent = '';
        if (!/^\d{4}$/.test(a.value)) { er.textContent = 'PIN must be exactly 4 digits.'; a.focus(); return; }
        if (a.value !== c.value) { er.textContent = 'The two PINs do not match.'; c.select(); return; }
        b.disabled = true; b.innerHTML = '<span class="sp"></span>Saving…';
        try { await StafflyAPI.setPin(a.value); finish(); }
        catch (e) { er.textContent = e.message; b.disabled = false; b.textContent = 'Save PIN & continue'; a.select(); }
      });
      setTimeout(() => a.focus(), 50);
    }

    function showPin() {
      const dev = StafflyAPI.device() || {};
      slot.innerHTML = '<form class="sg-card" novalidate>' + logo + '<h3>Welcome back' + (dev.name ? ', ' + esc(dev.name.split(' ')[0]) : '') + '</h3>'
        + '<p class="sg-sub">Enter your 4-digit PIN to open your attendance.</p>'
        + pinField('PIN')
        + '<button class="sg-go" type="submit">Open</button><div class="err" role="alert"></div>'
        + '<div class="sg-or">forgot PIN or not you?</div><a href="#" class="sg-mob" id="sgPw">Sign in with ID &amp; password</a>' + foot + '</form>';
      const f = w.querySelector('form'), p = w.querySelector('input[name=pin]'), er = w.querySelector('.err'), b = w.querySelector('.sg-go');
      w.querySelector('#sgPw').addEventListener('click', (ev) => { ev.preventDefault(); StafflyAPI.forgetDevice(); showPassword(); });
      const go = async () => {
        er.textContent = ''; if (!/^\d{4}$/.test(p.value)) return;
        b.disabled = true; b.innerHTML = '<span class="sp"></span>Checking…';
        try { await StafflyAPI.loginPin(p.value); finish(); }
        catch (e) {
          if (e.code === 'NO_DEVICE') { showPassword(); const er2 = w.querySelector('.err'); if (er2) er2.textContent = e.message; return; }
          er.textContent = e.message; b.disabled = false; b.textContent = 'Open'; p.value = ''; p.focus();
        }
      };
      p.addEventListener('input', () => { p.value = p.value.replace(/\D/g, '').slice(0, 4); if (p.value.length === 4) go(); });
      f.addEventListener('submit', (ev) => { ev.preventDefault(); go(); });
      setTimeout(() => p.focus(), 50);
    }

    if (StafflyAPI.device()) showPin(); else showPassword();
  });
}
const callApi = (fn, args) => StafflyAPI.call(fn, args);
function gas(fn, ...args) {
  pend++; busyUpd(fn);
  const done = () => { pend = Math.max(0, pend - 1); busyUpd(); };
  return (async () => {
    try {
      let v;
      try { v = await callApi(fn, args); }
      catch (e) { if (e.code === 'SITE_LOCKED') { await askSitePassword(); v = await callApi(fn, args); } else throw e; }
      done(); return v;
    } catch (e) {
      done();
      const m = String((e && e.message) || e || 'Request failed').replace(/^Error:\s*/, '');
      const x = new Error(m.includes('AUTH_EXPIRED') ? 'Admin session expired. Enter your password again.' : m); x.auth = m.includes('AUTH_EXPIRED'); throw x;
    }
  })();
}
function toast(m, kind) { const t = $('#toast'); t.className = 'toast show ' + (kind || ''); t.textContent = (kind === 'ok' ? '✓ ' : kind === 'err' ? '✕ ' : '') + m; clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), kind === 'err' ? 4500 : 2800); }
const t5 = (x) => (x ? String(x).slice(0, 5) : '—');
const fmtDate = (d) => d.slice(8) + '/' + d.slice(5, 7);
const dowOf = (d) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8))).getUTCDay(); // 0=Sun

/* ---------- boot ---------- */
async function boot() {
  $('#list').innerHTML = listSkeleton();
  try {
    const d = await gas('webEmployees');
    S.emps = d.employees; S.locsAll = d.locations || []; S.today = d.today; S.dataStart = d.data_start; S.latest = d.latest_punch;
  } catch (e) { $('#fresh').textContent = 'Could not load: ' + e.message; return; }
  const isEmp = !StafflyAPI.isAdmin();
  buildMonths(); buildLocations(); freshText();
  $('#month').value = S.month;
  if (isEmp) {
    document.body.classList.add('emp-mode');
    TITLES.profile = ['My attendance', 'Your month calendar and day-by-day detail'];
    NAV = [['profile', 'My attendance']]; buildNav();
  }
  setRange('month');
  renderList();
  if (isEmp) {
    if (S.emps.length) openProfile(S.emps[0].id);
    else $('#center').innerHTML = '<div class="empty"><b>No attendance record yet</b>Your attendance will appear here once you are added to the register. Ask HR if this looks wrong.</div>';
  }
}
function buildMonths() {
  const sel = $('#month'); sel.innerHTML = '';
  let [y, m] = S.dataStart.split('-').map(Number); const [ty, tm] = S.today.split('-').map(Number);
  const opts = [];
  while (y < ty || (y === ty && m <= tm)) { opts.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  opts.reverse().forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = MONTHS[+v.slice(5) - 1] + ' ' + v.slice(0, 4); sel.appendChild(o); });
  S.month = S.today.slice(0, 7);
}
function buildLocations() {
  const locs = [...new Set(S.emps.map((e) => e.location))].sort();
  const sel = $('#loc'); sel.innerHTML = '<option value="">All locations</option>' + locs.map((l) => `<option>${esc(l)}</option>`).join('');
}
function freshText() {
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
  const lp = S.latest ? new Date(S.latest).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  $('#fresh').innerHTML = `Latest punch <b>${lp}</b><br>Updated ${now}`;
}
const latestDay = () => (S.latest ? new Date(new Date(S.latest).getTime() + 19800000).toISOString().slice(0, 10) : S.today);
const addDays = (d, n) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8) + n)).toISOString().slice(0, 10);
const monthEnd = (m) => { const [y, mo] = m.split('-').map(Number); return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`; };
function setRange(key) {
  S.rkey = key; let f, t;
  if (key === 'latest') { t = latestDay(); f = t; }
  else if (key === '7') { t = S.today; f = addDays(t, -6); }
  else if (key === 'all') { f = S.dataStart; t = S.today; }
  else { f = S.month + '-01'; t = monthEnd(S.month); }
  S.from = f; S.to = t;
  const mm = (key === 'month') ? S.month : t.slice(0, 7), moved = mm !== S.month;
  if (mm !== S.month) { S.month = mm; if ([...$('#month').options].some((o) => o.value === mm)) $('#month').value = mm; }
  syncRangeUi(); afterRange(moved || key === 'month');
}
function fsum() {
  const P = { latest: 'Today', 7: 'Last 7 days', month: 'This month', all: 'All data' };
  const per = S.rkey ? P[S.rkey] : fmtDate(S.from) + ' – ' + fmtDate(S.to);
  const el = $('#fsum'); if (el) el.innerHTML = `<b>Showing</b><br>${per}<br>${S.loc ? esc(S.loc) : 'All locations'}<br>${S.activeOnly ? 'Active staff' : 'All staff'}${S.special ? '<br>Duty: ' + SPECIAL_LABEL[S.special] : ''}${S.listQ ? '<br>Name: “' + esc(S.listQ) + '”' : ''}`;
}
function syncRangeUi() {
  fsum();
  $('#dFrom').value = S.from; $('#dTo').value = S.to;
  document.querySelectorAll('#chips .chip').forEach((c) => c.classList.toggle('on', c.dataset.r === S.rkey));
}
const inRange = (d) => (!S.from || d >= S.from) && (!S.to || d <= S.to);

/* ---------- search + list ---------- */
/* Night / Extra day per employee for the selected period (counts come from the already-loaded S.all) */
const SPECIAL_LABEL = { any: 'Night or Extra day', night: 'Night duty only', extra: 'Extra day only', half: 'Half day only' };
function dutyStats() {
  const m = {};
  (S.all || []).forEach((r) => {
    if (!inRange(r.d)) return;
    const night = !!r.n, extra = r.st === 'Extra Day', half = r.st === 'Half Day';
    if (!night && !extra && !half) return;
    const o = m[r.id] || (m[r.id] = { night: 0, extra: 0, half: 0 });
    if (night) o.night++;
    if (extra) o.extra++; if (half) o.half++;
  });
  return m;
}
const dutyOk = (o) => !S.special || (!!o && (S.special === 'night' ? o.night > 0 : S.special === 'extra' ? o.extra > 0 : S.special === 'half' ? o.half > 0 : (o.night > 0 || o.extra > 0)));
const visibleEmps = () => S.emps.filter((e) => (!S.activeOnly || e.active || e.left_on) && (!S.loc || e.location === S.loc));
function renderList() {
  const q = S.listQ.toLowerCase(), D = dutyStats();
  const items = visibleEmps().filter((e) => e.name.toLowerCase().includes(q) && dutyOk(D[e.id]));
  const badge = (o) => (o ? `<span class="duty">${o.night ? '<i class="dn" title="Night duty days">&#9790;' + o.night + '</i>' : ''}${o.extra ? '<i class="de" title="Extra days">E' + o.extra + '</i>' : ''}${o.half ? '<i class="dh" title="Half days">&frac12;' + o.half + '</i>' : ''}</span>` : '');
  const empty = S.loadingAll && S.special ? 'Loading…' : (S.special ? 'No night / extra day staff in this period' : 'No match');
  $('#list').innerHTML = items.map((e) => `<button type="button" data-id="${e.id}" class="${S.sel === e.id ? 'sel' : ''}"><span class="nm">${esc(e.name)}</span>${badge(D[e.id])}<small>${esc(e.location)}</small></button>`).join('') || `<div class="sub" style="padding:8px">${empty}</div>`;
  const dc = $('#dutyChips'); if (dc) dc.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.s === S.special));
}
function setSpecial(v) {
  S.special = v; const sel = $('#special'); if (sel) sel.value = v;
  renderList(); fsum(); refreshPage();
}
let sugIdx = -1, sugItems = [];
function renderSuggest() {
  const q = $('#q').value.trim().toLowerCase(); const box = $('#suggest');
  if (!q) { box.classList.remove('open'); return; }
  const emps = S.emps.filter((e) => e.name.toLowerCase().includes(q)   ).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).slice(0, 8)
    .map((e) => ({ t: e.name, s: e.location + (e.active ? '' : ' · inactive'), act: () => openProfile(e.id) }));
  const pages = NAV.filter(([p, t]) => t.toLowerCase().includes(q)).map(([p, t]) => ({ t: 'Go to ' + t, s: 'page', act: () => go(p) }));
  const locs = [...new Set(S.emps.map((e) => e.location))].filter((l) => l.toLowerCase().includes(q)).map((l) => ({ t: l, s: 'filter location', act: () => { S.loc = l; $('#loc').value = l; renderList(); refreshPage(); } }));
  sugItems = emps.concat(locs, pages); sugIdx = sugItems.length ? 0 : -1;
  box.innerHTML = sugItems.map((x, i) => `<button type="button" role="option" data-i="${i}" class="${i === sugIdx ? 'act' : ''}">${esc(x.t)}<small>${esc(x.s)}</small></button>`).join('') || '<div class="sub" style="padding:10px 14px">No match</div>';
  box.classList.add('open');
}
function pickSug(i) { const x = sugItems[i]; $('#suggest').classList.remove('open'); if (x) x.act(); }
$('#q').addEventListener('input', renderSuggest);
$('#q').addEventListener('keydown', (ev) => {
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); if (!sugItems.length) return; sugIdx = (sugIdx + (ev.key === 'ArrowDown' ? 1 : -1) + sugItems.length) % sugItems.length; [...$('#suggest').children].forEach((c, i) => c.classList.toggle('act', i === sugIdx)); }
  if (ev.key === 'Enter' && sugItems[sugIdx]) { ev.preventDefault(); pickSug(sugIdx); }
  if (ev.key === 'Escape') $('#suggest').classList.remove('open');
});
$('#suggest').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-i]'); if (b) pickSug(+b.dataset.i); });
document.addEventListener('click', (ev) => { if (!ev.target.closest('.searchwrap')) $('#suggest').classList.remove('open'); });
function pick(id) { openProfile(id); }
$('#list').addEventListener('click', (ev) => { const b = ev.target.closest('button[data-id]'); if (b) pick(+b.dataset.id); });
$('#listq').addEventListener('input', (ev) => { S.listQ = ev.target.value; $('#empq').value = ev.target.value; renderList(); refreshPage(); });
$('#month').addEventListener('change', (ev) => { S.month = ev.target.value; setRange('month'); });
$('#chips').addEventListener('click', (ev) => { const b = ev.target.closest('.chip'); if (b) setRange(b.dataset.r); });
const onDates = () => { S.rkey = ''; S.from = $('#dFrom').value; S.to = $('#dTo').value; const mm = (S.to || S.from || S.month).slice(0, 7), moved = !!mm && mm !== S.month; if (moved) { S.month = mm; if ([...$('#month').options].some((o) => o.value === mm)) $('#month').value = mm; } syncRangeUi(); afterRange(moved); };
$('#dFrom').addEventListener('change', onDates); $('#dTo').addEventListener('change', onDates);
$('#dayStatus').addEventListener('change', (ev) => { S.dayStatus = ev.target.value; if (S.sel && S.rows.length) renderCal(true); });
$('#empq').addEventListener('input', (ev) => { S.listQ = ev.target.value; $('#listq').value = ev.target.value; renderList(); refreshPage(); });
$('#clearAll').addEventListener('click', () => { S.special = ''; $('#special').value = ''; S.loc = ''; S.activeOnly = true; S.listQ = ''; S.dayStatus = ''; $('#loc').value = ''; $('#activeOnly').checked = true; $('#listq').value = ''; $('#empq').value = ''; $('#dayStatus').value = ''; S.month = S.today.slice(0, 7); $('#month').value = S.month; renderList(); setRange('month'); });
document.addEventListener('keydown', (ev) => { if (ev.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { ev.preventDefault(); $('#q').focus(); } });
$('#csv').addEventListener('click', () => {
  const dl = (name, lines) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); };
  if (S.page !== 'profile') {
    const q2 = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const R = rowsF(); if (!R.length) { toast('Nothing to export'); return; }
    dl('attendance_' + S.from + '_to_' + S.to + '.csv', [['Employee', 'Location', 'Date', 'Status', 'In', 'Out', 'Hours', 'OT hours', 'Late out', 'Night', 'Source', 'Note'].map(q2).join(',')]
      .concat(R.map((r) => [r.e.name, r.e.location, r.d, r.st, t5(r.tin), t5(r.tout), r.h ?? '', r.ot || '', r.lo ? 'Y' : '', r.n ? 'Y' : '', r.src, r.note].map(q2).join(','))));
    return;
  }
  if (!S.sel || !S.rows.length) { toast('Pick an employee first'); return; }
  const rows = S.rows.filter((r) => inRange(r.work_date));
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Employee', 'Location', 'Date', 'Status', 'In', 'Out', 'Hours', 'OT hours', 'Late in', 'Late out', 'Night', 'Source', 'Note'].map(q).join(',')]
    .concat(rows.map((r) => [S.emp.name, S.emp.location, r.work_date, r.status, t5(r.in_time), t5(r.out_time), r.hours ?? '', r.ot_hours ?? '', r.late_in ? 'Y' : '', r.late_out ? 'Y' : '', r.night ? 'Y' : '', r.source || '', r.note || ''].map(q).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv' }));
  a.download = (S.emp.name + '_' + S.from + '_to_' + S.to + '.csv').replace(/\s+/g, '_'); document.body.appendChild(a); a.click(); a.remove();
});
$('#loc').addEventListener('change', (ev) => { S.loc = ev.target.value; renderList(); refreshPage(); });
$('#special').addEventListener('change', (ev) => setSpecial(ev.target.value));
$('#dutyChips').addEventListener('click', (ev) => { const b = ev.target.closest('.chip'); if (b) setSpecial(b.dataset.s === S.special ? '' : b.dataset.s); });
$('#activeOnly').addEventListener('change', (ev) => { S.activeOnly = ev.target.checked; renderList(); refreshPage(); });
$('#refresh').addEventListener('click', async () => { $('#refresh').classList.add('busy'); try { const d = await gas('webEmployees'); S.emps = d.employees; S.locsAll = d.locations || []; S.latest = d.latest_punch; S.today = d.today; freshText(); renderList(); } catch {} $('#refresh').classList.remove('busy'); S.cache = {}; loadData(true); if (S.sel && S.page === 'profile') loadCal(); });

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
function countUps(root) {
  root.querySelectorAll('[data-cu]').forEach((el) => {
    if (REDUCED) return;
    const to = +el.dataset.cu, d = +el.dataset.d, t0 = performance.now();
    const step = (t) => { const p = Math.min((t - t0) / 900, 1), e = 1 - Math.pow(1 - p, 3); el.textContent = (to * e).toFixed(d); if (p < 1) requestAnimationFrame(step); };
    el.textContent = (0).toFixed(d); requestAnimationFrame(step);
  });
}
function playEnter() {
  const c = $('#center'); c.classList.remove('leaving', 'enter'); void c.offsetWidth; c.classList.add('enter');
  c.querySelectorAll('.tile').forEach((t, i) => t.style.setProperty('--i', i));
  countUps(c);
}
const L = (w, h = 10, m = '') => `<div class="sk" style="width:${w};height:${h}px;${m}"></div>`;
function skeleton() {
  const kpi = `<div class="kpi"><div style="display:flex;gap:10px;align-items:center"><div class="sk" style="width:30px;height:30px;border-radius:50%;flex:none"></div><div style="flex:1">${L('55%', 9)}${L('70%', 20, 'margin-top:7px')}</div></div>${L('62%', 9, 'margin-top:12px')}${L('100%', 30, 'margin-top:10px')}</div>`;
  const tiles = Array.from({ length: 28 }, () => `<div class="sk" style="height:76px;border-radius:11px"></div>`).join('');
  return `<div class="skel" aria-busy="true" aria-label="Loading">${L('34%', 18)}${L('100%', 38, 'margin:14px 0')}<div class="kpis">${kpi.repeat(5)}</div><div class="cal">${tiles}</div></div>`;
}
const listSkeleton = () => Array.from({ length: 10 }, () => `<div class="skelrow">${L('55%', 11)}${L('25%', 9)}</div>`).join('');
function selectEmp(id) { S.sel = id; renderList(); loadCal(); }
async function loadCal() {
  if (!S.sel || S.page !== 'profile') return;
  const my = (loadCal.n = (loadCal.n || 0) + 1);
  $('#center').classList.remove('enter'); $('#center').innerHTML = skeleton();
  try {
    const d = await gas('webCalendar', S.sel, S.month);
    if (my !== loadCal.n || S.page !== 'profile') return;
    S.emp = d.employee; S.today = d.today; S.rows = d.rows.map((r) => (isPending(r.work_date, r.status, r.in_time || r.out_time, r.source) ? { ...r, status: 'Not In Yet' } : r)); renderCal();
  } catch (e) { if (my === loadCal.n) $('#center').innerHTML = `<div class="empty"><b>Could not load</b>${esc(e.message)}</div>`; }
}

/* ---------- calendar ---------- */
function tileHtml(d, r) {
  const n = +d.slice(8);
  if (d > S.today) return `<div class="tile future${inRange(d) ? '' : ' dim'}"><b>${n}</b></div>`;
  if (!r) return `<div class="tile none"><b>${n}</b><span>—</span></div>`;
  const st = r.status, cls = st.replace(/\s+/g, '');
  const ic = [];
  if (r.night) ic.push('<span title="Night duty">☾</span>');
  if (r.source === 'Corrected') ic.push('<span title="Corrected by admin">●</span>');
  if (r.branch_entry) ic.push(`<span title="Entered by branch${r.branch_by ? ' - ' + esc(r.branch_by) : ''}">◆</span>`);
  if (r.flag) ic.push(`<span title="${esc(r.flag)}">⚠</span>`);
  let l1 = '', l2 = '';
  const hrs = r.hours != null ? Number(r.hours).toFixed(1) + 'h' : '';
  const ot = Number(r.ot_hours) > 0 ? ' · +' + Number(r.ot_hours).toFixed(1) + 'h' : '';
  if (st === 'Present') { l1 = `${t5(r.in_time)}→${t5(r.out_time)}`; l2 = hrs + ot; }
  else if (st === 'Half Day') { l1 = `${t5(r.in_time)}→${t5(r.out_time)}`; l2 = 'Half day · ' + hrs; }
  else if (st === 'Extra Day') { l1 = `${t5(r.in_time)}→${t5(r.out_time)}`; l2 = 'Extra day' + (hrs ? ' · ' + hrs : ''); }
  else if (st === 'Missing Punch') { if (!r.in_time && r.out_time) { l1 = 'Out ' + t5(r.out_time); l2 = 'In missing'; } else if (r.in_time && !r.out_time) { l1 = 'In ' + t5(r.in_time); l2 = 'Out missing'; } else { l1 = `${t5(r.in_time)}→${t5(r.out_time)}`; l2 = 'Missing punch'; } }
  else if (st === 'In Progress') { l1 = 'In ' + t5(r.in_time); l2 = 'In progress'; }
  else if (st === 'Not In Yet') { l1 = 'Not in yet'; l2 = 'no punch so far'; }
  else { l1 = st; }
  if (r.branch_entry) l2 += (l2 ? ' · ' : '') + '◆ ' + [r.branch_extra ? 'Extra' : '', r.branch_night ? 'Night' : ''].filter(Boolean).join('+');
  const tip = [st, r.in_time ? 'In ' + t5(r.in_time) : '', r.out_time ? 'Out ' + t5(r.out_time) : '', hrs, r.note || ''].filter(Boolean).join(' · ');
  const click = ' click';
  const dim = (!inRange(d) || (S.dayStatus && S.dayStatus !== st)) ? ' dim' : '';
  return `<button type="button" class="tile ${cls}${r.night ? ' night' : ''}${click}${dim}" data-date="${d}" title="${esc(tip)}"><span class="ic">${ic.join('')}</span><b>${n}</b><span class="t">${esc(l1)}</span><span class="h">${esc(l2)}</span></button>`;
}
function kpis(rows) {
  const by = (s) => rows.filter((r) => r.status === s);
  const present = rows.filter((r) => ['Present', 'Half Day', 'In Progress'].includes(r.status)).length;
  const half = by('Half Day').length, absent = by('Absent').length, miss = by('Missing Punch');
  const missIn = miss.filter((r) => !r.in_time).length, missOut = miss.length - missIn;
  const working = rows.filter((r) => !['Sunday', 'Holiday', 'Extra Day', 'Not In Yet'].includes(r.status)).length;
  const full = by('Present').length + by('In Progress').length;
  const pct = working ? Math.round(((full + 0.5 * half) / working) * 1000) / 10 : 0;
  const payable = rows.length - absent - 0.5 * half;
  const otH = rows.reduce((a, r) => a + Number(r.ot_hours || 0), 0);
  const worked = rows.filter((r) => r.hours != null && r.hours > 0);
  const avg = worked.length ? worked.reduce((a, r) => a + Number(r.hours), 0) / worked.length : 0;
  const nights = rows.filter((r) => r.night).length, extra = by('Extra Day').length;
  const xr = rows.filter((r) => r.status === 'Extra Day' && r.in_time && r.out_time);
  const sunAvg = xr.length ? t5(xr[0].in_time) + ' → ' + t5(xr[0].out_time) : '—';
  const days = rows.slice().sort((x, y) => (x.work_date < y.work_date ? -1 : 1));
  const sp = (vals, c) => {
    const W = 120, H = 34, mx = Math.max(1, ...vals), n = Math.max(vals.length - 1, 1);
    const pts = vals.map((v, i) => `${(i / n * W).toFixed(1)},${(H - 3 - (v / mx) * (H - 8)).toFixed(1)}`).join(' ');
    return `<svg class="sp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline pathLength="1" points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  };
  const I = { ok: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', warn: '<path d="M12 4 3 20h18zM12 10v5M12 17.5v.5"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>' };
  let ki = 0;
  const cu = (v) => { const m = String(v).match(/^([\d.]+)(.*)$/); return m ? `<span data-cu="${m[1]}" data-d="${(m[1].split('.')[1] || '').length}">${m[1]}</span>${m[2]}` : v; };
  const card = (c, bg, ic, l, v, s2, line) => `<div class="kpi" style="--k:${ki++}"><div class="top2"><div class="ico" style="background:${bg};color:${c}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${I[ic]}</svg></div><div><div class="l">${l}</div><div class="v">${cu(v)}</div></div></div><div class="s">${s2}</div>${sp(line, c)}</div>`;
  const tp = (r) => ['Present', 'Half Day', 'In Progress'].includes(r.status) ? 1 : 0;
  return `<div class="kpis">
    ${card('#1f9d57', '#dcf3e5', 'ok', 'Present', present, `${pct}% attendance · ${payable} payable`, days.map(tp))}
    ${card('#e04848', '#fde3e3', 'x', 'Absent', absent, 'No-punch working days', days.map((r) => (r.status === 'Absent' ? 1 : 0)))}
    ${card('#e49b00', '#fff0cc', 'warn', 'Missing punches', miss.length, `${missIn} In · ${missOut} Out`, days.map((r) => (r.status === 'Missing Punch' ? 1 : 0)))}
    ${card('#7c4dc9', '#e0eaff', 'clock', 'Overtime', otH.toFixed(1) + ' h', `${worked.length} days · avg ${avg.toFixed(1)} h/day`, days.map((r) => Number(r.hours || 0)))}
    ${card('#7a4dff', '#ece5ff', 'moon', 'Nights &amp; Sundays', nights, `${nights} nights · ${extra} Sun/Hol · avg ${sunAvg}`, days.map((r) => (r.night || r.status === 'Extra Day' ? 1 : 0)))}
  </div>`;
}
function chartSvg(rows) {
  const W = 700, H = 150, pad = 22, data = rows.filter((r) => r.hours != null);
  if (!data.length) return '';
  const n = rows.length, bw = (W - pad * 2) / Math.max(n, 1), max = Math.max(12, ...data.map((r) => Number(r.hours)));
  const y = (v) => H - 20 - (v / max) * (H - 36);
  const bars = rows.map((r, i) => {
    if (r.hours == null) return '';
    const x = pad + i * bw + 2, h = (H - 20) - y(Number(r.hours));
    return `<rect x="${x.toFixed(1)}" y="${y(Number(r.hours)).toFixed(1)}" width="${Math.max(bw - 4, 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#7c4dc9" opacity=".85"><title>${fmtDate(r.work_date)}: ${Number(r.hours).toFixed(1)} h</title></rect>`;
  }).join('');
  const ys = y(9);
  return `<div class="chart"><h3>Hours per day</h3><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hours worked per day">
    <line x1="${pad}" x2="${W - pad}" y1="${ys}" y2="${ys}" stroke="#e04848" stroke-dasharray="4 4"/><text x="${W - pad}" y="${ys - 4}" text-anchor="end" font-size="10" fill="#e04848">Shift (9 h)</text>${bars}</svg></div>`;
}
function renderCal(soft) {
  if (S.page !== 'profile') return;
  const map = Object.fromEntries(S.rows.map((r) => [r.work_date, r]));
  const [y, m] = S.month.split('-').map(Number), last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (dowOf(S.month + '-01') + 6) % 7;
  let cells = '<div class="tile blank"></div>'.repeat(lead);
  for (let d = 1; d <= last; d++) { const ds = `${S.month}-${String(d).padStart(2, '0')}`; cells += tileHtml(ds, map[ds]); }
  const noted = S.rows.filter((r) => r.note);
  const noteBox = noted.length ? `<div class="notes"><b>${noted.length} day(s) with corrections / notes:</b> ${noted.map((r) => `${fmtDate(r.work_date)} – ${esc(r.note)}`).join(' · ')}</div>` : '';
  const e = S.emp;
  const _code = ((S.emps.find((x) => x.id === e.id)) || {}).code || '';
  const _ini = esc(String(e.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase());
  const _av = `<span class="eav"><b>${_ini}</b>${_code ? `<img src="/photos/${encodeURIComponent(_code)}.jpg" alt="" onerror="this.remove()">` : ''}</span>`;
  const head = `<div class="emp-head"><div class="eh-l">${_av}<h2>${esc(e.name)}</h2></div><span>${esc(e.location)} · ${S.from ? S.from.slice(8) + ' ' + MONTHS[+S.from.slice(5, 7) - 1] : ''} – ${S.to ? S.to.slice(8) + ' ' + MONTHS[+S.to.slice(5, 7) - 1] : ''}${e.active ? '' : ' · inactive'}</span></div>`;
  if (!S.rows.length) {
    $('#center').classList.remove('enter'); $('#center').innerHTML = head + '<div class="empty"><b>No attendance records</b>Nothing is recorded for this employee in this month (not on the roster yet, or no longer active).</div>';
    return;
  }
  $('#center').innerHTML = `
    ${head}
    ${noteBox}
    ${kpis(S.rows.filter((r) => inRange(r.work_date)))}
    <div class="dow">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((x) => `<div>${x}</div>`).join('')}</div>
    <div class="cal" id="cal">${cells}</div>
    <div class="legend">
      <span><i style="background:var(--present)"></i>Present</span><span><i style="background:var(--absent)"></i>Absent</span>
      <span><i style="background:var(--missing)"></i>Missing punch</span><span><i style="background:var(--extra)"></i>Sunday/holiday worked</span>
      <span><i style="background:var(--half)"></i>Half day</span><span><i style="background:var(--prog)"></i>In progress</span>
      <span><i style="background:var(--off)"></i>Sunday/holiday</span><span>☾ Night duty</span><span>● Corrected</span>
    </div>
    ${chartSvg(S.rows)}`;
  if (!soft) playEnter(); else $('#center').querySelectorAll('.tile').forEach((t) => (t.style.animation = 'none'));
}
$('#center').addEventListener('click', (ev) => { const b = ev.target.closest('.tile.click'); if (b) { const dt = b.dataset.date; if (S.admin) openDrawer(dt); else openView(dt); } });

/* ---------- pages (all employees, selected date range) ---------- */
const ICON = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  employees: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  absent: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
  missing: '<path d="M12 4 3 20h18zM12 10v5M12 17.5v.5"/>',
  overwork: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  locations: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  audit: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h3M8 16h6"/>',
  salary: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>'
};
let NAV = [['overview', 'Overview'], ['board', 'Daily board'], ['profile', 'Employee profile'], ['absent', 'Absent'], ['missing', 'Missing punches'], ['overwork', 'Overwork'], ['employees', 'Employees'], ['locations', 'Locations'], ['audit', 'Corrections & notes']];
const TITLES = {
  overview: ['Overview', 'Attendance health for the selected period'],
  employees: ['Employees', 'Per-employee summary — click a row to open the profile'],
  absent: ['Absent', 'Working days with no punch, with dates'],
  missing: ['Missing punches', 'Days where the In or Out punch is missing'],
  overwork: ['Overwork', 'Overtime, late exits, nights and Sunday/holiday work'],
  locations: ['Locations', 'Compare branches side by side'],
  profile: ['Employee profile', 'Month calendar and day-by-day detail'],
  audit: ['Corrections & notes', 'Admin corrections and remarks in the selected period']
};
const BADGE = { absent: 'abs', missing: 'miss', audit: 'aud' };
function buildNav() {
  const GRP = { overview: 'Main', absent: 'Reports', employees: 'Manage', salary: 'Admin' };
  $('#nav').innerHTML = NAV.map(([p, t]) => (GRP[p] ? `<div class="grp">${GRP[p]}</div>` : '') + `<a data-p="${p}" class="${S.page === p ? 'act' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[p]}</svg><span class="lb">${t}</span>${BADGE[p] ? `<span class="bd" id="bd_${BADGE[p]}">–</span>` : ''}</a>`).join('');
}
$('#nav').addEventListener('click', (ev) => { const a = ev.target.closest('a[data-p]'); if (a) go(a.dataset.p); });

const nf = (n, d = 0) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const pctOf = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const WORK = (r) => !['Sunday', 'Holiday', 'Extra Day', 'Not In Yet'].includes(r.st);

/* data: S.all = parsed rows for [S.from..S.to], all employees */
function parseRows(raw) {
  const em = {}; S.emps.forEach((e) => (em[e.id] = e)); S.emap = em;
  return raw.filter((r) => em[r[0]]).map((r) => ({ id: r[0], d: r[1], st: isPending(r[1], r[2], r[3] || r[4], r[10]) ? 'Not In Yet' : r[2], tin: r[3], tout: r[4], h: r[5] == null ? null : Number(r[5]), ot: Number(r[6] || 0), li: r[7], lo: r[8], n: r[9], src: r[10], note: r[11], e: em[r[0]] }));
}
const rowsF = () => {
  const q = S.listQ.toLowerCase();
  const D = S.special ? dutyStats() : null;
  return S.all.filter((r) => (!S.activeOnly || r.e.active || r.e.left_on) && (!S.loc || r.e.location === S.loc) && (!q || r.e.name.toLowerCase().includes(q)) && (!D || dutyOk(D[r.id])) && inRange(r.d));
};
function aggBy(rows, keyFn) {
  const m = new Map();
  rows.forEach((r) => {
    const k = keyFn(r); let g = m.get(k);
    if (!g) { g = { k, e: r.e, pres: 0, full: 0, half: 0, abs: 0, miss: 0, missIn: 0, missOut: 0, extra: 0, ot: 0, night: 0, lateOut: 0, hs: 0, hn: 0, work: 0, days: 0, absD: [], missD: [], exD: [], emps: new Set() }; m.set(k, g); }
    g.days++; g.emps.add(r.id);
    if (WORK(r)) g.work++;
    if (r.st === 'Present' || r.st === 'In Progress') { g.full++; g.pres++; }
    else if (r.st === 'Half Day') { g.half++; g.pres++; }
    else if (r.st === 'Absent') { g.abs++; g.absD.push(r.d); }
    else if (r.st === 'Missing Punch') { g.miss++; g.missD.push(r.d); if (!r.tin) g.missIn++; else g.missOut++; }
    else if (r.st === 'Extra Day') { g.extra++; g.exD.push(r.d); }
    g.ot += r.ot; if (r.n) g.night++; if (r.lo) g.lateOut++;
    if (r.h != null && r.h > 0) { g.hs += r.h; g.hn++; }
  });
  m.forEach((g) => { g.pct = pctOf(g.full + 0.5 * g.half, g.work); g.avg = g.hn ? g.hs / g.hn : 0; g.pay = g.days - g.abs - 0.5 * g.half; });
  return [...m.values()];
}
function updateBadges() {
  const rows = rowsF();
  const set = (id, v) => { const el = $('#bd_' + id); if (el) el.textContent = v; };
  set('abs', rows.filter((r) => r.st === 'Absent').length);
  set('miss', rows.filter((r) => r.st === 'Missing Punch').length);
  set('aud', rows.filter((r) => r.note || r.src === 'Corrected').length);
}

/* ---------- small renderers ---------- */
const SPK = (vals, c) => {
  const W = 120, H = 34, mx = Math.max(1, ...vals), n = Math.max(vals.length - 1, 1);
  const pts = vals.map((v, i) => `${(i / n * W).toFixed(1)},${(H - 3 - (v / mx) * (H - 8)).toFixed(1)}`).join(' ');
  return `<svg class="sp" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline pathLength="1" points="${pts || '0,31 120,31'}" fill="none" stroke="${c}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
};
const KI = { ok: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', warn: '<path d="M12 4 3 20h18zM12 10v5M12 17.5v.5"/>', clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>', moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>', users: ICON.employees, pin: ICON.locations, bolt: ICON.overwork };
let KI_N = 0;
const cuw = (v, d = 0) => `<span data-cu="${v}" data-d="${d}">${nf(v, d)}</span>`;
const kcard = (c, bg, ic, l, vHtml, sub, line) => `<div class="kpi" style="--k:${KI_N++}"><div class="top2"><div class="ico" style="background:${bg};color:${c}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${KI[ic]}</svg></div><div><div class="l">${l}</div><div class="v">${vHtml}</div></div></div><div class="s">${sub}</div>${SPK(line, c)}</div>`;
function hbars(items, color, unit = '') {
  if (!items.length) return '<div class="sub" style="padding:12px 0">Nothing to show.</div>';
  const mx = Math.max(...items.map((i) => i.v), 1);
  return `<div class="hb">${items.map((i) => `<div class="r"${i.id ? ` data-emp="${i.id}"` : ''} title="${esc(i.l)}: ${nf(i.v, 1)}${unit}"><div class="l">${esc(i.l)}</div><div class="t"><i style="width:${(i.v / mx * 100).toFixed(1)}%;background:${color}"></i></div><div class="v">${nf(i.v, i.v % 1 ? 1 : 0)}${unit}</div></div>`).join('')}</div>`;
}
function vbars(items, color) {
  if (!items.length) return '<div class="sub" style="padding:12px 0">Nothing to show.</div>';
  const mx = Math.max(...items.map((i) => i.v), 1), step = Math.ceil(items.length / 14);
  return `<div class="vb">${items.map((i, k) => `<div class="c" title="${esc(i.l)}: ${i.v}"><u>${i.v}</u><i style="height:${Math.max(i.v / mx * 100, i.v ? 3 : 0)}%;background:${color}"></i>${k % step === 0 ? `<em>${esc(i.l)}</em>` : ''}</div>`).join('')}</div>`;
}
const dayList = (rows, f) => { const m = {}; rows.forEach((r) => { if (f(r)) m[r.d] = (m[r.d] || 0) + 1; }); return Object.keys(m).sort().map((d) => ({ l: fmtDate(d), v: m[d], d })); };
const chips = (ds, cls = '') => `<div class="dchips ${cls}">${ds.sort().map((d) => `<span>${fmtDate(d)}</span>`).join('')}</div>`;

/* generic sortable table: cols [{k,label,n,html(row)->string,v(row)->sortValue}] */
function table(id, cols, rows, o = {}) {
  const so = S.sort[id] || o.sort || { k: cols[0].k, dir: 1 };
  const col = cols.find((c) => c.k === so.k) || cols[0];
  const val = (r) => (col.v ? col.v(r) : r[col.k]);
  const sorted = rows.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : (x ?? -1e9) - (y ?? -1e9)) * so.dir; });
  const lim = 400, shown = sorted.slice(0, lim);
  const arrow = (c) => (c.k === so.k ? (so.dir > 0 ? ' ▲' : ' ▼') : '');
  return `<div class="tblwrap"><table class="t" data-tid="${id}"><thead><tr>${cols.map((c) => `<th data-sort="${c.k}" class="${c.n ? 'n' : ''}">${c.label}${arrow(c)}</th>`).join('')}</tr></thead>
    <tbody>${shown.map((r, i) => `<tr style="--r:${Math.min(i, 24)}"${o.emp ? ` data-emp="${o.emp(r)}"` : ''}>${cols.map((c) => `<td class="${c.n ? 'n' : ''}">${c.html ? c.html(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="sub" style="padding:18px">No rows for these filters.</td></tr>`}</tbody></table></div>
    <div class="sub" style="text-align:right;margin-top:6px;font-size:11.5px">${shown.length} of ${rows.length} rows${rows.length > lim ? ' (narrow the filters to see the rest)' : ''}</div>`;
}
const nm = (g) => esc(g.e.name), lc = (g) => esc(g.e.location);
const pillCls = (s) => s.replace(/\s+/g, '');

/* ---------- the pages ---------- */
function pgOverview(R) {
  const days = [...new Set(R.map((r) => r.d))].sort();
  const last = days.length ? days[days.length - 1] : null;
  const today = R.filter((r) => r.d === last);
  const T = (s) => today.filter((r) => r.st === s).length;
  const allG = aggBy(R, () => 'all')[0] || { pct: 0, abs: 0, miss: 0, ot: 0, emps: new Set(), half: 0, extra: 0, work: 0, full: 0, night: 0 };
  const perDay = (f) => days.map((d) => R.filter((r) => r.d === d && f(r)).length);
  const mixDefs = [['Present', '#34b36b'], ['Half Day', '#4b8df8'], ['Extra Day', '#8b5cf6'], ['Missing Punch', '#f0a500'], ['Absent', '#e04848'], ['Sunday', '#c3cadb'], ['Holiday', '#aab3c8'], ['In Progress', '#35b5b5'], ['Not In Yet', '#9fb1e8']];
  const cnt = {}; R.forEach((r) => (cnt[r.st] = (cnt[r.st] || 0) + 1));
  const tot = R.length || 1;
  const L = aggBy(R, (r) => r.e.location).sort((a, b) => b.pct - a.pct);
  KI_N = 0;
  return `
  <div class="kpis">
    ${kcard('#1f9d57', '#dcf3e5', 'ok', last ? 'Present · ' + fmtDate(last) : 'Present', cuw(T('Present') + T('Half Day') + T('In Progress')), `${T('Half Day')} half day · ${T('Extra Day')} extra day`, perDay((r) => ['Present', 'Half Day', 'In Progress'].includes(r.st)))}
    ${kcard('#e04848', '#fde3e3', 'x', last ? 'Absent · ' + fmtDate(last) : 'Absent', cuw(T('Absent')), 'Working-day no-punch', perDay((r) => r.st === 'Absent'))}
    ${kcard('#e49b00', '#fff0cc', 'warn', 'Missing punches', cuw(allG.miss), `in selected period`, perDay((r) => r.st === 'Missing Punch'))}
    ${kcard('#7c4dc9', '#e0eaff', 'users', 'Attendance', `<span data-cu="${allG.pct}" data-d="1">${nf(allG.pct, 1)}</span>%`, `${allG.emps.size} employees`, days.map((d) => { const x = R.filter((r) => r.d === d && WORK(r)); return pctOf(x.filter((r) => ['Present', 'In Progress'].includes(r.st)).length + 0.5 * x.filter((r) => r.st === 'Half Day').length, x.length); }))}
    ${kcard('#7a4dff', '#ece5ff', 'bolt', 'Overtime', `<span data-cu="${allG.ot}" data-d="1">${nf(allG.ot, 1)}</span> h`, `${allG.night} nights · ${allG.extra} Sun/Hol worked`, days.map((d) => R.filter((r) => r.d === d).reduce((a, r) => a + r.ot, 0)))}
  </div>
  <div class="two2">
    <div class="card pad"><div class="cardh"><h3>Status mix</h3><small>${R.length} employee-days</small></div>
      <div class="mix">${mixDefs.filter(([s]) => cnt[s]).map(([s, c]) => `<i title="${s}: ${cnt[s]}" style="width:${(cnt[s] / tot * 100).toFixed(2)}%;background:${c}"></i>`).join('')}</div>
      <div class="mixl">${mixDefs.filter(([s]) => cnt[s]).map(([s, c]) => `<span><i style="background:${c}"></i>${s} <b>${cnt[s]}</b></span>`).join('')}</div>
      <div class="cardh" style="margin-top:18px"><h3>By location</h3></div>
      ${table('ovloc', [
        { k: 'k', label: 'Location', html: (g) => esc(g.k) }, { k: 'n', label: 'Staff', n: 1, v: (g) => g.emps.size, html: (g) => g.emps.size },
        { k: 'pct', label: 'Att %', n: 1, html: (g) => g.pct + '%' }, { k: 'abs', label: 'Absent', n: 1 }, { k: 'miss', label: 'Missing', n: 1 }], L, { sort: { k: 'pct', dir: -1 } })}
    </div>
    <div class="card pad"><div class="cardh"><h3>Absent per day</h3><small>${last ? fmtDate(days[0]) + ' – ' + fmtDate(last) : ''}</small></div>
      ${vbars(dayList(R, (r) => r.st === 'Absent'), '#e04848')}
    </div>
  </div>`;
}
function mgRows() {
  const q = (S.mg.q || '').toLowerCase();
  const L = S.emps.filter((e) => !q || e.name.toLowerCase().includes(q) || e.location.toLowerCase().includes(q)).slice().sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  if (!L.length) return '<div class="empty">No staff match</div>';
  return L.map((e) => {
    const arm = S.mg.rm === e.id;
    const act = e.active
      ? (arm ? `<input type="date" id="mgLast" value="${S.today}" max="${S.today}"> <button class="btn danger" type="button" data-mg="rmgo" data-id="${e.id}">Confirm remove</button> <button class="btn" type="button" data-mg="rmx">Cancel</button>`
             : `<button class="btn danger" type="button" data-mg="rm" data-id="${e.id}">Remove</button>`)
      : `<button class="btn" type="button" data-mg="restore" data-id="${e.id}">Restore</button>`;
    return `<div class="mgrow ${e.active ? '' : 'off'}"><div class="n"><b>${esc(e.name)}</b><small>${esc(e.location)}${e.active ? '' : ' · left' + (e.left_on ? ' ' + fmtDate(e.left_on) : '')}</small></div>${act}</div>`;
  }).join('');
}
function reportCard2() { return S.admin ? reportCard() : ''; }
function reportCard() {
  const opts = [...$('#month').options].map((o) => `<option value="${o.value}">${esc(o.textContent)}</option>`).join('');
  return `<div class="card pad mg"><h3>Month-end report <span class="tag">admin</span></h3>
    <div class="mgnote">Excel with 4 tabs: <b>Attendance Report</b> (your register layout with live formulas), <b>Data</b>, <b>Attendance Summary</b> (final: absent, half day, extra day, night, total working days, date lists) and <b>Removed - No Attendance</b>. Includes admin corrections. Nothing is changed in Staffly.</div>
    <div class="mgadd" style="grid-template-columns:1.4fr auto auto"><label>Month<select id="rpMonth">${opts}</select></label><button class="btn primary" type="button" data-mg="export" id="rpGo">Download Excel</button><span id="rpLink" class="mgnote" style="margin:0 0 6px"></span></div></div>`;
}
async function rpExport() {
  const btn = $('#rpGo'), mo = $('#rpMonth').value; btn.classList.add('loading'); btn.innerHTML = '<span class="spin"></span>Building report…';
  $('#rpLink').textContent = 'This takes a few seconds. Please wait.';
  try {
    const r = await gas('webAdminExportMonth', S.token, mo);
    if (r.blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(r.blob); a.download = r.name + '.xlsx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
    $('#rpLink').innerHTML = `${r.employees} in the summary${r.all > r.employees ? ' · ' + (r.all - r.employees) + ' with no attendance' : ''} · ${esc(r.name)}.xlsx saved to your Downloads`;
    toast('Report downloaded', 'ok');
  } catch (e) { $('#rpLink').textContent = ''; if (!sessionLost(e)) toast(e.message, 'err'); }
  btn.classList.remove('loading'); btn.textContent = 'Download Excel';
}
function mgCard() {
  if (!S.admin) return '';
  const locs = (S.locsAll && S.locsAll.length ? S.locsAll : [...new Set(S.emps.map((e) => e.location))]).slice();
  return `<div class="card pad mg"><h3>Manage staff <span class="tag">admin</span></h3>
    <div class="mgnote">One place for everything: adding creates the person's Staffly login too, and removing switches it off. History is never deleted.</div>
    <div class="mgadd">
      <label>Full name<input id="mgName" type="text" maxlength="60" placeholder="e.g. Rahul Sharma" autocomplete="off"></label>
      <label>Location<select id="mgLoc">${locs.map((l) => `<option>${esc(l)}</option>`).join('')}</select></label>
      <label>Joining date<input id="mgJoin" type="date" value="${S.today}"></label>
      <label>Password (min 8)<input id="mgPw" type="text" maxlength="60" placeholder="for their Staffly login" autocomplete="off"></label>
      <button class="btn primary" type="button" id="mgAdd" data-mg="add">Add employee</button>
    </div>
    <div class="err" id="mgErr" style="color:var(--absent-ink);font-size:12px;min-height:16px"></div>
    <input class="search" id="mgQ" type="text" placeholder="Search staff to remove or restore…" value="${esc(S.mg.q || '')}" style="width:100%;padding:8px 10px;border:1px solid var(--line);border-radius:9px">
    <div class="mglist" id="mgList">${mgRows()}</div></div>`;
}
async function reloadEmps() {
  const d = await gas('webEmployees');
  S.emps = d.employees; S.locsAll = d.locations || []; buildLocations(); renderList();
  S.cache = {}; loadData(true);
}
async function mgAct(kind, id) {
  const err = $('#mgErr'); if (err) err.textContent = '';
  const btn = kind === 'add' ? $('#mgAdd') : document.querySelector(`[data-mg="${kind}"][data-id="${id}"]`);
  const label = btn && btn.textContent; if (btn) { btn.classList.add('loading'); btn.innerHTML = '<span class="spin"></span>Working…'; }
  try {
    let r;
    if (kind === 'add') r = await gas('webAdminAddEmployee', S.token, { name: $('#mgName').value, location: $('#mgLoc').value, joined_on: $('#mgJoin').value, password: ($('#mgPw') || {}).value });
    else if (kind === 'rmgo') r = await gas('webAdminRemoveEmployee', S.token, { id, left_on: ($('#mgLast') || {}).value });
    else r = await gas('webAdminRestoreEmployee', S.token, { id });
    S.mg.rm = null; if (kind === 'add') S.mg.q = '';
    toast(kind === 'add' ? (r && r.restored ? 'Employee restored' : 'Employee added' + (r && r.employee_id ? ' - ID ' + r.employee_id : '')) : kind === 'rmgo' ? 'Employee removed' : 'Employee restored', 'ok');
    await reloadEmps();
    if (r && r.form) setTimeout(() => toast(r.form, /could not|no linked/i.test(r.form) ? 'err' : 'ok'), 700);
  } catch (e) {
    if (btn) { btn.classList.remove('loading'); btn.textContent = label; }
    if (!sessionLost(e)) { if (err) err.textContent = e.message; toast(e.message, 'err'); }
  }
}
function pgEmployees(R) {
  const G = aggBy(R, (r) => r.id);
  return reportCard2() + mgCard() + `<div class="card pad"><div class="cardh"><h3>Employees</h3><small>${G.length} employees · click a row to open the calendar</small></div>
  ${table('emps', [
    { k: 'name', label: 'Employee', v: (g) => g.e.name, html: nm }, { k: 'loc', label: 'Location', v: (g) => g.e.location, html: lc },
    { k: 'pres', label: 'Present', n: 1 }, { k: 'half', label: 'Half', n: 1 }, { k: 'abs', label: 'Absent', n: 1 }, { k: 'miss', label: 'Missing', n: 1 }, { k: 'extra', label: 'Extra', n: 1 },
    { k: 'ot', label: 'OT h', n: 1, html: (g) => nf(g.ot, 1) }, { k: 'night', label: 'Nights', n: 1 }, { k: 'pct', label: 'Att %', n: 1, html: (g) => g.pct + '%' }, { k: 'pay', label: 'Payable', n: 1 }], G, { sort: { k: 'name', dir: 1 }, emp: (g) => g.k })}
  </div>`;
}
function pgAbsent(R) {
  const G = aggBy(R, (r) => r.id).filter((g) => g.abs);
  const ab = R.filter((r) => r.st === 'Absent');
  const tab = S.dtab.absent;
  const top = G.slice().sort((a, b) => b.abs - a.abs).slice(0, 15).map((g) => ({ l: g.e.name, v: g.abs, id: g.k }));
  return `
  <div class="card pad"><div class="cardh"><h3>Absent</h3></div>
    <div class="stats"><div><b class="r">${ab.length}</b><span>Absent days</span></div><div><b>${G.length}</b><span>Employees absent</span></div><div><b>${G.filter((g) => g.abs >= 5).length}</b><span>5+ absences</span></div><div><b>${R.filter((r) => r.st === 'Half Day').length}</b><span>Half days</span></div></div>
    <div class="two2"><div><h3>Most absent</h3>${hbars(top, '#e03a3a')}</div><div><h3>Absent per day</h3>${vbars(dayList(R, (r) => r.st === 'Absent'), '#e03a3a')}</div></div>
  </div>
  <div class="card pad"><div class="tabs"><button class="chip ${tab === 'emp' ? 'on' : ''}" data-tab="absent:emp">By employee (with dates)</button><button class="chip ${tab === 'day' ? 'on' : ''}" data-tab="absent:day">Date-wise detail</button></div>
  ${tab === 'emp' ? table('absE', [{ k: 'name', label: 'Employee', v: (g) => g.e.name, html: nm }, { k: 'loc', label: 'Location', v: (g) => g.e.location, html: lc }, { k: 'abs', label: 'Absent', n: 1 }, { k: 'dates', label: 'Absent dates', v: (g) => g.absD.length, html: (g) => chips(g.absD) }], G, { sort: { k: 'abs', dir: -1 }, emp: (g) => g.k })
  : table('absD', [{ k: 'd', label: 'Date', html: (r) => fmtDate(r.d) }, { k: 'name', label: 'Employee', v: (r) => r.e.name, html: (r) => esc(r.e.name) }, { k: 'loc', label: 'Location', v: (r) => r.e.location, html: (r) => esc(r.e.location) }], ab, { sort: { k: 'd', dir: -1 }, emp: (r) => r.id })}
  </div>`;
}
function pgMissing(R) {
  const mp = R.filter((r) => r.st === 'Missing Punch');
  const G = aggBy(R, (r) => r.id).filter((g) => g.miss);
  const tab = S.dtab.missing;
  const mi = mp.filter((r) => !r.tin).length;
  return `
  <div class="card pad"><div class="cardh"><h3>Missing punches</h3></div>
    <div class="stats"><div><b class="a">${mp.length}</b><span>Missing punches</span></div><div><b>${mi}</b><span>In missing</span></div><div><b>${mp.length - mi}</b><span>Out missing</span></div><div><b>${G.length}</b><span>Employees</span></div></div>
    <div class="two2"><div><h3>Most missing</h3>${hbars(G.slice().sort((a, b) => b.miss - a.miss).slice(0, 12).map((g) => ({ l: g.e.name, v: g.miss, id: g.k })), '#f0a500')}</div><div><h3>Missing per day</h3>${vbars(dayList(R, (r) => r.st === 'Missing Punch'), '#f0a500')}</div></div>
  </div>
  <div class="card pad"><div class="tabs"><button class="chip ${tab === 'emp' ? 'on' : ''}" data-tab="missing:emp">By employee (with dates)</button><button class="chip ${tab === 'day' ? 'on' : ''}" data-tab="missing:day">Date-wise detail</button></div>
  ${tab === 'emp' ? table('misE', [{ k: 'name', label: 'Employee', v: (g) => g.e.name, html: nm }, { k: 'loc', label: 'Location', v: (g) => g.e.location, html: lc }, { k: 'miss', label: 'Missing', n: 1 }, { k: 'missIn', label: 'In', n: 1 }, { k: 'missOut', label: 'Out', n: 1 }, { k: 'dates', label: 'Dates', v: (g) => g.missD.length, html: (g) => chips(g.missD, 'am') }], G, { sort: { k: 'miss', dir: -1 }, emp: (g) => g.k })
  : table('misD', [{ k: 'd', label: 'Date', html: (r) => fmtDate(r.d) }, { k: 'name', label: 'Employee', v: (r) => r.e.name, html: (r) => esc(r.e.name) }, { k: 'loc', label: 'Location', v: (r) => r.e.location, html: (r) => esc(r.e.location) }, { k: 'in', label: 'In', v: (r) => r.tin || '', html: (r) => t5(r.tin) }, { k: 'out', label: 'Out', v: (r) => r.tout || '', html: (r) => t5(r.tout) }, { k: 'what', label: 'Missing', v: (r) => (r.tin ? 'Out' : 'In'), html: (r) => `<span class="pill MissingPunch">${r.tin ? 'Out' : 'In'}</span>` }], mp, { sort: { k: 'd', dir: -1 }, emp: (r) => r.id })}
  </div>`;
}
function pgOverwork(R) {
  const G = aggBy(R, (r) => r.id);
  const tot = G.reduce((a, g) => a + g.ot, 0);
  const ex = R.filter((r) => r.st === 'Extra Day');
  return `
  <div class="card pad"><div class="cardh"><h3>Overwork</h3></div>
    <div class="stats"><div><b class="b">${nf(tot, 1)} h</b><span>Overtime</span></div><div><b>${G.filter((g) => g.ot > 0).length}</b><span>Employees with OT</span></div><div><b>${R.filter((r) => r.lo).length}</b><span>Late exits (9 PM+)</span></div><div><b>${R.filter((r) => r.n).length}</b><span>Nights</span></div><div><b>${ex.length}</b><span>Sun/Hol worked</span></div></div>
    <div class="two2"><div><h3>Top overtime (hours)</h3>${hbars(G.filter((g) => g.ot > 0).sort((a, b) => b.ot - a.ot).slice(0, 15).map((g) => ({ l: g.e.name, v: Math.round(g.ot * 10) / 10, id: g.k })), '#7c4dc9', ' h')}</div>
    <div><h3>Overtime per day (hours)</h3>${vbars([...new Set(R.map((r) => r.d))].sort().map((d) => ({ l: fmtDate(d), v: Math.round(R.filter((r) => r.d === d).reduce((a, r) => a + r.ot, 0) * 10) / 10 })), '#7c4dc9')}</div></div>
  </div>
  <div class="card pad">${table('ow', [{ k: 'name', label: 'Employee', v: (g) => g.e.name, html: nm }, { k: 'loc', label: 'Location', v: (g) => g.e.location, html: lc }, { k: 'ot', label: 'OT h', n: 1, html: (g) => nf(g.ot, 1) }, { k: 'avg', label: 'Avg h/day', n: 1, html: (g) => nf(g.avg, 1) }, { k: 'lateOut', label: 'Late exits', n: 1 }, { k: 'night', label: 'Nights', n: 1 }, { k: 'extra', label: 'Sun/Hol', n: 1 }], G.filter((g) => g.ot > 0 || g.night || g.lateOut || g.extra), { sort: { k: 'ot', dir: -1 }, emp: (g) => g.k })}</div>`;
}
function pgLocations(R) {
  const L = aggBy(R, (r) => r.e.location).sort((a, b) => b.pct - a.pct);
  return `
  <div class="card pad"><div class="cardh"><h3>Locations</h3><small>${L.length} locations</small></div>
    <div class="lgrid">${L.map((g) => `<div class="lc"><h4>${esc(g.k)}</h4><div class="sub">${g.emps.size} employees</div><div class="big">${g.pct}%</div><div class="hb"><div class="r" style="grid-template-columns:0 1fr 0"><div></div><div class="t"><i style="width:${g.pct}%;background:#34b36b"></i></div><div></div></div></div>
      <div class="m"><div><b>${g.abs}</b>Absent</div><div><b>${g.miss}</b>Missing</div><div><b>${nf(g.ot, 1)} h</b>Overtime</div><div><b>${g.night}</b>Nights</div></div></div>`).join('') || '<div class="sub">No data.</div>'}</div></div>
  <div class="card pad">${table('locs', [{ k: 'k', label: 'Location', html: (g) => esc(g.k) }, { k: 'n', label: 'Staff', n: 1, v: (g) => g.emps.size, html: (g) => g.emps.size }, { k: 'pct', label: 'Att %', n: 1, html: (g) => g.pct + '%' }, { k: 'pres', label: 'Present days', n: 1 }, { k: 'abs', label: 'Absent', n: 1 }, { k: 'miss', label: 'Missing', n: 1 }, { k: 'ot', label: 'OT h', n: 1, html: (g) => nf(g.ot, 1) }, { k: 'night', label: 'Nights', n: 1 }], L, { sort: { k: 'pct', dir: -1 } })}</div>`;
}
function pgAudit(R) {
  const N = R.filter((r) => r.note || r.src === 'Corrected');
  return `<div class="card pad"><div class="cardh"><h3>Corrections &amp; notes</h3><small>${N.length} days · click a row to open the calendar</small></div>
  ${table('aud', [{ k: 'd', label: 'Date', html: (r) => fmtDate(r.d) }, { k: 'name', label: 'Employee', v: (r) => r.e.name, html: (r) => esc(r.e.name) }, { k: 'loc', label: 'Location', v: (r) => r.e.location, html: (r) => esc(r.e.location) },
    { k: 'st', label: 'Status', html: (r) => `<span class="pill ${pillCls(r.st)}">${esc(r.st)}</span>` }, { k: 'in', label: 'In', v: (r) => r.tin || '', html: (r) => t5(r.tin) }, { k: 'out', label: 'Out', v: (r) => r.tout || '', html: (r) => t5(r.tout) },
    { k: 'src', label: 'Source', html: (r) => esc(r.src) }, { k: 'note', label: 'Note', html: (r) => esc(r.note) }], N, { sort: { k: 'd', dir: -1 }, emp: (r) => r.id })}</div>`;
}
const PAGES = { overview: pgOverview, employees: pgEmployees, absent: pgAbsent, missing: pgMissing, overwork: pgOverwork, locations: pgLocations, audit: pgAudit };

function pageSkeleton() {
  const kpi = `<div class="kpi"><div style="display:flex;gap:10px;align-items:center"><div class="sk" style="width:30px;height:30px;border-radius:50%;flex:none"></div><div style="flex:1">${L('55%', 9)}${L('70%', 20, 'margin-top:7px')}</div></div>${L('62%', 9, 'margin-top:12px')}${L('100%', 30, 'margin-top:10px')}</div>`;
  const bars = `<div class="card pad">${L('40%', 12)}<div style="margin-top:18px;display:grid;gap:11px">${[92, 78, 66, 52, 44, 36, 28, 20].map((w) => `<div style="display:flex;gap:8px;align-items:center">${L('26%', 8)}${L(w * .6 + '%', 13)}</div>`).join('')}</div></div>`;
  return `<div class="skel" aria-busy="true"><div class="kpis">${kpi.repeat(5)}</div><div class="two2">${bars}${bars}</div></div>`;
}

/* ---------- calendar focus: on the profile page the side menu + staff list tuck away so the calendar is the star ---------- */
function setMenu(open) { document.body.classList.toggle('menu-open', !!open); }
$('#menuBtn').addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));
$('#menuScrim').addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') setMenu(false); });
document.addEventListener('DOMContentLoaded', () => document.body.classList.toggle('focus', S.page === 'profile'));

/* ---------- navigation + data loading ---------- */
function go(p) {
  if (p === S.page && p !== 'profile') return;
  S.page = p;
  if (p === 'salary' && S.admin) loadSalary(); if (p === 'board') loadBoard();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('act', a.dataset.p === p));
  const [t, s] = TITLES[p]; $('#ttl').textContent = t; $('#subt').textContent = s;
  document.querySelector('.grid').classList.toggle('wide', p !== 'profile');
  document.body.classList.toggle('focus', p === 'profile'); setMenu(false);
  $('#grpDay').style.display = p === 'profile' ? '' : 'none';
  $('#center').classList.add('leaving');
  setTimeout(() => {
    if (p === 'profile') {
      if (S.sel && S.emp) renderCal();
      else if (S.sel) loadCal();
      else { $('#center').classList.remove('leaving', 'enter'); $('#center').innerHTML = '<div class="empty"><b>Search for an employee</b>Type a name in the search bar above, or pick one from the list.</div>'; }
    } else renderPage();
  }, 150);
}
function renderPage(soft) {
  if (S.page === 'profile' || !PAGES[S.page]) return;
  const c = $('#center');
  if (S.loadingAll && S.page !== 'brsum' && S.page !== 'brcal' && S.page !== 'brlog' && S.page !== 'salary' && S.page !== 'board') { c.classList.remove('enter', 'leaving'); c.innerHTML = pageSkeleton(); return; }
  const y = window.scrollY;
  c.innerHTML = PAGES[S.page](rowsF());
  if (soft) { c.classList.remove('leaving'); c.querySelectorAll('.kpi,.hb i,.vb i,.mix i,table.t tbody tr').forEach((n) => (n.style.animation = 'none')); window.scrollTo(0, y); }
  else playEnter();
}
async function loadData(force) {
  const lo = S.from < S.dataStart ? S.dataStart : S.from, hi = S.to > S.today ? S.today : S.to, key = lo + '|' + hi;
  if (!force && S.cache[key]) { S.all = S.cache[key]; S.loadingAll = false; updateBadges(); renderList(); if (S.page !== 'profile') renderPage(); return; }
  const my = (loadData.n = (loadData.n || 0) + 1);
  S.loadingAll = true; if (S.special) renderList(); if (S.page !== 'profile') renderPage();
  try {
    const d = await gas('webRange', lo, hi);
    if (my !== loadData.n) return;
    S.all = S.cache[key] = parseRows(d.rows); S.loadingAll = false; updateBadges(); renderList(); if (S.page !== 'profile') renderPage();
  } catch (e) {
    if (my !== loadData.n) return;
    S.loadingAll = false; S.all = [];
    if (S.page !== 'profile') $('#center').innerHTML = `<div class="card pad"><div class="empty"><b>Could not load</b>${esc(e.message)}</div></div>`;
  }
}
function refreshPage() { fsum(); updateBadges(); if (S.page !== 'profile') renderPage(true); }
function afterRange(monthChanged) {
  loadData();
  if (S.page === 'profile' && S.sel) { if (monthChanged !== false) loadCal(); else if (S.rows.length) renderCal(true); }
}
$('#center').addEventListener('click', (ev) => {
  const th = ev.target.closest('th[data-sort]');
  if (th) { const id = th.closest('table').dataset.tid, cur = S.sort[id] || {}; S.sort[id] = { k: th.dataset.sort, dir: cur.k === th.dataset.sort ? -cur.dir : (th.dataset.sort === 'name' || th.dataset.sort === 'loc' || th.dataset.sort === 'k' ? 1 : -1) }; renderPage(true); return; }
  const tb = ev.target.closest('[data-tab]'); if (tb) { const [pg, v] = tb.dataset.tab.split(':'); S.dtab[pg] = v; renderPage(true); return; }
  const rw = ev.target.closest('[data-emp]'); if (rw) openProfile(+rw.dataset.emp);
});
function openProfile(id) { const e = S.emps.find((x) => x.id === id); $('#q').value = e ? e.name : ''; S.sel = id; S.emp = null; renderList(); S.page = ''; go('profile'); }

buildNav();

/* ---------- admin ---------- */
function openPin() {
  
  $('#pinErr').textContent = ''; $('#pin').value = ''; $('#pinScrim').classList.add('open'); setTimeout(() => $('#pin').focus(), 30);
}
$('#adminBtn').addEventListener('click', () => (S.admin ? exitAdmin() : openPin()));
$('#pinCancel').addEventListener('click', () => $('#pinScrim').classList.remove('open'));
$('#pinForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try { const d = await gas('webAdminLogin', $('#pin').value); S.token = d.token; $('#pinScrim').classList.remove('open'); enterAdmin(d.seconds_left); toast('Admin mode on'); }
  catch (e) { $('#pinErr').textContent = e.message; $('#pin').select(); }
});
let tick = null;
function enterAdmin(secs) {
  S.admin = true; S.secs = secs; $('#adminbar').classList.add('on'); $('#adminBtn').classList.add('on'); $('#adminBtnTxt').textContent = 'Exit admin mode'; $('#adminSub').textContent = 'Editing enabled';
  clearInterval(tick); tick = setInterval(() => { S.secs--; if (S.secs <= 0) { exitAdmin(true); return; } const m = Math.floor(S.secs / 60); $('#secs').textContent = m + ':' + String(S.secs % 60).padStart(2, '0'); }, 1000);
  if (S.sel) renderCal(true); if (S.page === 'employees') renderPage(true);
}
async function exitAdmin(expired) {
  S.admin = false; clearInterval(tick); closeDrawer(); $('#adminbar').classList.remove('on'); $('#adminBtn').classList.remove('on'); $('#adminBtnTxt').textContent = 'Enable admin mode'; $('#adminSub').textContent = 'View only';
  S.token = null;
  if (S.sel) renderCal(true); if (S.page === 'employees') renderPage(true); if (expired === true) toast('Admin session ended');
}
$('#exitAdmin').addEventListener('click', () => exitAdmin());
function sessionLost(e) { if (e.auth) { exitAdmin(true); return true; } return false; }

const HINTS = {
  '': 'Uses the punches from the form. If there are none, the day is Absent.',
  'Present': 'Counts as a full working day (use when the punch is wrong or missing).',
  'Absent': 'Unpaid. Deducted from payable days and lowers attendance %.',
  'Half Day': 'Counts as half a day. Deducts 0.5 from payable days.',
  'Extra Day': 'Worked on a Sunday or holiday. Counts as an extra day.',
  'Holiday': 'Paid day off. No deduction and not counted as a working day.'
};
const showHint = () => { $('#dHint').textContent = HINTS[$('#dStatus').value] || ''; };
STATUS_OPTS.forEach((s) => { const o = document.createElement('option'); o.value = s; o.textContent = s || 'Auto (from punches)'; $('#dStatus').appendChild(o); });
$('#dStatus').addEventListener('change', showHint);
async function openDrawer(date) {
  S.editDate = date; const r = S.rows.find((x) => x.work_date === date) || {};
  $('#dTitle').textContent = 'Edit ' + S.emp.name; $('#dCtx').textContent = `${fmtDate(date)}/${date.slice(0, 4)} · now: ${r.status || '—'}`;
  $('#dErr').textContent = ''; $('#dPunches').innerHTML = '<span class="dpl"><span class="spin"></span>Loading punches…</span>';
  ['dStatus', 'dIn', 'dOut', 'dRemark'].forEach((i) => ($('#' + i).value = '')); $('#dNext').checked = false; $('#dNight').checked = false; $('#dSource').value = (StafflyAPI.user() || {}).name || 'Admin';
  showHint(); $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  try {
    const d = await gas('webAdminPunches', S.token, S.emp.id, date);
    $('#dPunches').innerHTML = d.punches.length ? d.punches.map((p) => `<div class="punch"><span>${esc(p.io)} ${esc(p.local_ts.slice(11, 19))}</span><span>${esc(p.location)} ${p.photo_url ? `<a href="${esc(p.photo_url)}" target="_blank" rel="noopener noreferrer">photo</a>` : ''}</span></div>`).join('') : '<span class="sub">No punches that day</span>';
    d.corrections.forEach((c) => {
      if (c.io === 'In') $('#dIn').value = String(c.punch_time).slice(0, 5);
      if (c.io === 'Out') { $('#dOut').value = String(c.punch_time).slice(0, 5); $('#dNext').checked = !!c.out_next_day; }
      if (c.status) $('#dStatus').value = c.status;
      if (c.night) $('#dNight').checked = true;
      if (c.source) $('#dSource').value = c.source;
      if (c.remark) $('#dRemark').value = c.remark;
    });
    showHint();
  } catch (e) { if (!sessionLost(e)) $('#dPunches').textContent = e.message; }
}
function closeDrawer() { $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); }
$('#dClose').addEventListener('click', closeDrawer);
function normTime(v) {
  v = String(v || '').trim().toLowerCase(); if (!v) return '';
  const m = v.match(/^(\d{1,2})[:.\s]?(\d{2})?\s*(am|pm|a|p)?$/); if (!m) return null;
  let h = +m[1], mi = m[2] ? +m[2] : 0; const ap = m[3];
  if (ap) { if (h < 1 || h > 12) return null; if (ap[0] === 'p' && h < 12) h += 12; if (ap[0] === 'a' && h === 12) h = 0; }
  if (h > 23 || mi > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(mi).padStart(2, '0');
}
['dIn', 'dOut'].forEach((id) => {
  const el = $('#' + id);
  const fix = () => { const t = normTime(el.value); el.classList.toggle('bad', t === null); if (t) el.value = t; };
  el.addEventListener('blur', fix); el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); fix(); } }); el.addEventListener('input', () => el.classList.remove('bad'));
});
$('#dSave').addEventListener('click', async () => {
  $('#dErr').textContent = '';
  const tIn = normTime($('#dIn').value), tOut = normTime($('#dOut').value);
  if (tIn === null || tOut === null) { $('#dErr').textContent = 'Type the time like 09:30 or 6:45 pm'; return; }
  $('#dIn').value = tIn; $('#dOut').value = tOut;
  const sb = $('#dSave'); sb.classList.add('loading'); sb.innerHTML = '<span class="spin"></span>Saving…'; $('#drawer').classList.add('saving');
  const rel = () => { sb.classList.remove('loading'); sb.textContent = 'Save'; $('#drawer').classList.remove('saving'); };
  try {
    await gas('webAdminSetDay', S.token, { employee_id: S.emp.id, date: S.editDate, status: $('#dStatus').value, in: tIn, out: tOut, out_next_day: $('#dNext').checked, night: $('#dNight').checked, source: $('#dSource').value, remark: $('#dRemark').value });
    rel(); closeDrawer(); toast('Saved to Supabase', 'ok'); S.cache = {}; loadCal(); loadData(true);
  } catch (e) { rel(); if (!sessionLost(e)) { $('#dErr').textContent = e.message; toast('Could not save', 'err'); } }
});
let clearArm = null;
$('#dClear').addEventListener('click', async () => {
  const btn = $('#dClear');
  if (!clearArm) { btn.textContent = 'Click again to confirm'; clearArm = setTimeout(() => { clearArm = null; btn.textContent = 'Clear my changes'; }, 4000); return; }
  clearTimeout(clearArm); clearArm = null; btn.textContent = 'Clear my changes';
  btn.classList.add('loading'); btn.innerHTML = '<span class="spin"></span>Clearing…'; $('#drawer').classList.add('saving');
  const rel = () => { btn.classList.remove('loading'); btn.textContent = 'Clear my changes'; $('#drawer').classList.remove('saving'); };
  try { await gas('webAdminClearDay', S.token, { employee_id: S.emp.id, date: S.editDate }); rel(); closeDrawer(); toast('Cleared', 'ok'); S.cache = {}; loadCal(); loadData(true); }
  catch (e) { rel(); if (!sessionLost(e)) { $('#dErr').textContent = e.message; toast('Could not clear', 'err'); } }
});
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closeDrawer(); $('#pinScrim').classList.remove('open'); } });

$('#center').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-mg]'); if (!b || !S.admin) return;
  const k = b.dataset.mg, id = +b.dataset.id;
  if (k === 'export') rpExport();
  else if (k === 'add' || k === 'rmgo' || k === 'restore') mgAct(k, id);
  else if (k === 'rm') { S.mg.rm = id; $('#mgList').innerHTML = mgRows(); }
  else if (k === 'rmx') { S.mg.rm = null; $('#mgList').innerHTML = mgRows(); }
});
$('#center').addEventListener('input', (ev) => { if (ev.target.id === 'mgQ') { S.mg.q = ev.target.value; $('#mgList').innerHTML = mgRows(); } });

/* ---------- navigation list (Branch portal removed) ---------- */
S.br = null;
const NAV_BASE = NAV.slice();
function setNav() { NAV = NAV_BASE.concat(S.admin ? [['salary', 'Salary (preview)']] : []); buildNav(); }
{ // admin mode adds / removes the "Salary (preview)" page
  const _en = enterAdmin, _ex = exitAdmin;
  enterAdmin = function (secs) { _en(secs); setNav(); };
  exitAdmin = async function (x) { await _ex(x); setNav(); if (S.page === 'salary') { S.page = ''; go('overview'); } S.sal.data = null; };
}

/* ================= SALARY PREVIEW (extra feature, admin only) =================
 * Reads attendance + a private salary table. It is NOT part of the month-end Excel. */
TITLES.salary = ['Salary (preview)', 'Extra feature - not included in the month-end Excel'];
ICON.salary = '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>';
S.sal = { month: '', data: null, loading: false, err: '', view: 'cards', q: '', branch: '', sort: 'name' };
const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const dnum = (n) => (n % 1 ? n.toFixed(1) : String(n));
async function loadSalary() {
  if (!S.admin) return;
  const L = S.sal; if (L.loading) return;
  if (!L.month) L.month = S.today.slice(0, 7);
  L.loading = true; L.err = ''; if (S.page === 'salary') renderPage(!!L.data);
  try { L.data = await gas('webAdminSalaryMonth', S.token, L.month); } catch (e) { if (sessionLost(e)) { L.loading = false; return; } L.err = e.message; }
  L.loading = false; if (S.page === 'salary') renderPage(true);
}
const SAL_BR = ['#1e3a8a', '#d4af5a', '#0f9d8a', '#7c4dc9', '#e0662a'];
const SAL_STRIP = { P: ['Present', '#1f9d57'], H: ['Half day', '#2b6cb0'], E: ['Extra day', '#7c4dc9'], A: ['Absent', '#e04848'], S: ['Sunday paid', '#bfe5cc'], X: ['Sunday not paid', '#f4a3a3'],
  O: ['Holiday', '#b7c3d9'], M: ['Missing punch', '#e0902a'], I: ['In progress', '#2fb3b3'], '-': ['No data', '#e6e9ef'] };
const salInit = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
function salBranches(D) { return [...new Set(D.rows.map((r) => r.location))].sort(); }
function salRows() {
  const L = S.sal, D = L.data; if (!D) return [];
  let r = D.rows.slice();
  if (L.branch) r = r.filter((x) => x.location === L.branch);
  const q = (L.q || '').trim().toLowerCase(); if (q) r = r.filter((x) => x.name.toLowerCase().includes(q));
  const cmp = { name: (a, b) => a.name.localeCompare(b.name), high: (a, b) => b.total - a.total, low: (a, b) => a.total - b.total, cut: (a, b) => (b.absent + b.sunday_unpaid) - (a.absent + a.sunday_unpaid) }[L.sort || 'name'];
  return r.sort(cmp);
}
function salCard(r, ci) {
  const pct = Math.min(100, Math.round((r.paid_days / r.days_in_month) * 100));
  const strip = r.strip.split('').map((ch, i) => `<i style="background:${SAL_STRIP[ch][1]}" title="${i + 1} · ${SAL_STRIP[ch][0]}"></i>`).join('');
  const chip = (n, label, cls) => (n ? `<span class="sc ${cls}">${n} ${label}</span>` : '');
  return `<div class="salcard" style="--bc:${SAL_BR[ci % SAL_BR.length]}">
    <div class="sh"><div class="av">${esc(salInit(r.name))}</div><div class="who"><b>${esc(r.name)}</b><small>${esc(r.location)} · ${inr(r.monthly_salary)}/mo</small></div>
      <div class="amt"><b>${inr(r.total)}</b>${r.extra_pay ? `<small>incl. ${inr(r.extra_pay)} extra</small>` : '<small>to date</small>'}</div></div>
    <div class="bar"><i style="width:${pct}%"></i></div><div class="bt"><span>${dnum(r.paid_days)} paid days</span><span>of ${r.days_in_month}</span></div>
    <div class="strip">${strip}</div>
    <div class="chips">${chip(r.half, 'half', 'h')}${chip(r.extra, 'extra', 'e')}${chip(r.absent, 'absent', 'a')}${chip(r.sunday_unpaid, 'Sun cut', 'a')}${chip(r.missing, 'missing', 'm')}${r.half + r.extra + r.absent + r.sunday_unpaid + r.missing ? '' : '<span class="sc ok">full attendance</span>'}</div></div>`;
}
function salGrid() {
  const D = S.sal.data, rows = salRows(), brs = salBranches(D);
  if (!rows.length) return '<div class="empty"><b>No one found</b>Try another branch or name.</div>';
  if (S.sal.view === 'table') return table('sal', [
    { k: 'name', label: 'Employee', html: (r) => esc(r.name) },
    { k: 'location', label: 'Branch', html: (r) => esc(r.location) },
    { k: 'monthly_salary', label: 'Salary/mo', n: 1, html: (r) => inr(r.monthly_salary) },
    { k: 'present', label: 'Present', n: 1 }, { k: 'half', label: 'Half', n: 1 }, { k: 'extra', label: 'Extra', n: 1 }, { k: 'absent', label: 'Absent', n: 1 },
    { k: 'sunday_paid', label: 'Sun paid', n: 1 },
    { k: 'sunday_unpaid', label: 'Sun cut', n: 1, html: (r) => (r.sunday_unpaid ? `<b style="color:#b42318" title="${esc(r.unpaid_sundays.join(', '))}">${r.sunday_unpaid}</b>` : '0') },
    { k: 'holiday', label: 'Holiday', n: 1 },
    { k: 'missing', label: 'Missing', n: 1, html: (r) => (r.missing ? `<b style="color:#b54708">${r.missing}</b>` : '0') },
    { k: 'paid_days', label: 'Paid days', n: 1, html: (r) => dnum(r.paid_days) },
    { k: 'base_pay', label: 'Earned', n: 1, html: (r) => inr(r.base_pay) }, { k: 'extra_pay', label: 'Extra day', n: 1, html: (r) => inr(r.extra_pay) },
    { k: 'total', label: 'Total', n: 1, html: (r) => `<b>${inr(r.total)}</b>` },
  ], rows, { sort: S.sort.sal ? undefined : { k: 'name', dir: 1 } });
  return `<div class="salgrid">${rows.map((r) => salCard(r, brs.indexOf(r.location))).join('')}</div><div class="sub" style="text-align:right;margin-top:8px;font-size:11.5px">${rows.length} of ${D.rows.length} people</div>`;
}
function pgSalary() {
  const L = S.sal;
  if (!L.data && !L.err) { if (!L.loading) setTimeout(loadSalary, 0); return pageSkeleton(); }
  if (!L.data) return `<div class="card pad"><div class="empty"><b>Could not load</b>${esc(L.err)}<br><button class="btn" data-sal="go" type="button" style="margin-top:12px">Try again</button></div></div>`;
  const D = L.data;
  const note = `<details class="salnote"><summary>How this is calculated · preview only, not in the month-end Excel</summary>
    One day = monthly salary ÷ days in the month. Present 1 · Half Day 0.5 · Absent 0 · Sunday and Holiday paid (a Sunday with Absent on both sides is not paid) · Extra Day = that day + one extra day's salary · Missing punch paid as a full day until fixed · days before joining or after leaving are not paid. Night duty, EPF and ESIC are not calculated. Admin and branch edits are included.</details>`;
  if (D.setup_needed) return `<div class="card pad"><div class="cardh"><h3>Salary (preview)</h3></div>${note}<div class="empty"><b>Salary table not set up yet</b>Run <code>sql/07_salary.sql</code> and then the salary load script (08_load_salaries.sql) in the Supabase SQL Editor.</div></div>`;
  const months = []; { const [y, m] = S.today.split('-').map(Number); for (let i = 0; i < 6; i++) months.push(new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 7)); }
  const mname = (v) => new Date(v + '-01T00:00:00Z').toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const brs = salBranches(D), byBr = {}; D.rows.forEach((r) => { byBr[r.location] = (byBr[r.location] || 0) + r.total; });
  const tot = D.total || 1;
  const seg = brs.map((b, i) => `<i style="width:${(byBr[b] / tot) * 100}%;background:${SAL_BR[i % SAL_BR.length]}" title="${esc(b)} ${inr(byBr[b])}"></i>`).join('');
  const leg = brs.map((b, i) => `<span><i style="background:${SAL_BR[i % SAL_BR.length]}"></i>${esc(b)} <b>${inr(byBr[b])}</b></span>`).join('');
  const cut = D.rows.reduce((a, r) => a + r.sunday_unpaid, 0), miss = D.rows.reduce((a, r) => a + r.missing, 0);
  const hero = `<div class="salhero"><div class="hl"><small>Payable so far · ${esc(mname(D.month))}</small><div class="big">${cuw(D.total)}<em>₹</em></div>
      <div class="hs"><span><b>${D.people}</b> people</span><span><b>${inr(D.extra_pay)}</b> extra-day pay</span><span><b>${cut}</b> Sundays cut</span><span><b>${miss}</b> missing punches</span></div></div>
    <div class="hr"><small>Where it goes, by branch</small><div class="split">${seg}</div><div class="leg">${leg}</div></div></div>`;
  const chipB = (v, t) => `<button type="button" class="chip${(L.branch || '') === v ? ' on' : ''}" data-sal="br" data-v="${esc(v)}">${esc(t)}</button>`;
  const ctl = `<div class="salctl"><label class="f">Month<select id="salMonth">${months.map((v) => `<option value="${v}"${v === L.month ? ' selected' : ''}>${esc(mname(v))}</option>`).join('')}</select></label>
    <input id="salQ" class="search" type="search" placeholder="Find a name…" value="${esc(L.q || '')}" style="max-width:220px">
    <div class="salchips">${chipB('', 'All branches')}${brs.map((b) => chipB(b, b)).join('')}</div>
    <label class="f">Sort<select id="salSort">${[['name', 'Name A-Z'], ['high', 'Highest pay'], ['low', 'Lowest pay'], ['cut', 'Most cuts']].map(([v, t]) => `<option value="${v}"${(L.sort || 'name') === v ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
    <div class="salview"><button type="button" class="${L.view !== 'table' ? 'on' : ''}" data-sal="view" data-v="cards">Cards</button><button type="button" class="${L.view === 'table' ? 'on' : ''}" data-sal="view" data-v="table">Table</button></div>
    <button class="btn" type="button" data-sal="go">Refresh</button><button class="btn" type="button" data-sal="csv">CSV</button></div>`;
  const legend = `<div class="salkey">${['P', 'H', 'E', 'A', 'S', 'X', 'O', 'M'].map((k) => `<span><i style="background:${SAL_STRIP[k][1]}"></i>${SAL_STRIP[k][0]}</span>`).join('')}<small>each small square is one day of the month</small></div>`;
  const ns = (D.no_salary || []).length ? `<div class="salwarn"><b>${D.no_salary.length} people have attendance but no salary set</b> (not in the numbers above)<div>${D.no_salary.map((e) => `<span>${esc(e.name)} · ${esc(e.location)}</span>`).join('')}</div></div>` : '';
  return `<div class="salpage">${hero}${ctl}${note}${L.view === 'table' ? '' : legend}<div id="salGrid">${salGrid()}</div>${ns}</div>`;
}
PAGES.salary = pgSalary;
function salaryCsv() {
  const D = S.sal.data; if (!D || !D.rows || !D.rows.length) { toast('Nothing to export'); return; }
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const cols = [['Employee', 'name'], ['Branch', 'location'], ['Monthly salary', 'monthly_salary'], ['Present', 'present'], ['Half day', 'half'], ['Extra day', 'extra'], ['Absent', 'absent'],
    ['Sunday paid', 'sunday_paid'], ['Sunday not paid', 'sunday_unpaid'], ['Holiday', 'holiday'], ['Missing punch', 'missing'], ['Paid days', 'paid_days'], ['Salary', 'base_pay'], ['Extra day pay', 'extra_pay'], ['Total', 'total']];
  const L = [cols.map((c) => q(c[0])).join(',')].concat(D.rows.map((r) => cols.map((c) => q(r[c[1]])).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv' }));
  a.download = 'salary_preview_' + D.month + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
$('#center').addEventListener('change', (ev) => {
  if (ev.target.id === 'salMonth') { S.sal.month = ev.target.value; loadSalary(); }
  else if (ev.target.id === 'salSort') { S.sal.sort = ev.target.value; $('#salGrid').innerHTML = salGrid(); }
});
$('#center').addEventListener('input', (ev) => { if (ev.target.id === 'salQ') { S.sal.q = ev.target.value; const g = $('#salGrid'); if (g) g.innerHTML = salGrid(); } });
$('#center').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sal]'); if (!b) return;
  const k = b.dataset.sal;
  if (k === 'go') loadSalary(); else if (k === 'csv') salaryCsv();
  else if (k === 'br') { S.sal.branch = b.dataset.v; renderPage(true); }
  else if (k === 'view') { S.sal.view = b.dataset.v; renderPage(true); }
});


/* ================= DAILY BOARD: everyone on one day (Razorpay-style: calm cards, one blue, small useful motion) ================= */
TITLES.board = ['Daily board', 'Every employee on one day: who is in, who is absent'];
ICON.board = '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 13h3M8 16h6"/>';
S.db = { date: '', tab: 'absent', q: '', branch: '', rows: null, key: '', loading: false, err: '', anim: false };
const dAdd = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dLong = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const DB_G = { 'Present': 'p', 'In Progress': 'p', 'Half Day': 'h', 'Extra Day': 'x', 'Missing Punch': 'm', 'Absent': 'a', 'Not In Yet': 'n', 'Sunday': 'o', 'Holiday': 'o' };
const DB_LBL = { p: 'Present', h: 'Half day', x: 'Extra day', m: 'Missing punch', a: 'Absent', n: 'Not in yet', o: 'Day off' };
function dbRange(date) {
  let from = dAdd(date, -24); const ms = date.slice(0, 8) + '01'; if (ms < from) from = ms;
  if (from < S.dataStart) from = S.dataStart;
  return [from, date > S.today ? S.today : date];
}
async function loadBoard(force) {
  const B = S.db; if (!S.today) return;
  if (!B.date) B.date = S.today;
  if (B.date > S.today) B.date = S.today;
  const [from, to] = dbRange(B.date), key = from + '|' + to;
  if (!force && B.key === key && B.rows) { renderPage(true); return; }
  const my = (B.n = (B.n || 0) + 1);
  B.loading = true; B.err = ''; if (S.page === 'board') renderPage(!!B.rows);
  try {
    const d = await gas('webRange', from, to);
    if (my !== B.n) return;
    B.rows = parseRows(d.rows); B.key = key; B.anim = true;
  } catch (e) { if (my !== B.n) return; B.err = e.message; }
  B.loading = false; if (S.page === 'board') renderPage(true);
}
const dbPass = (r) => (!S.activeOnly || r.e.active || r.e.left_on) && (!S.loc || r.e.location === S.loc);
function dbStats(rows) {
  const c = { p: 0, h: 0, x: 0, m: 0, a: 0, n: 0, o: 0 };
  rows.forEach((r) => { c[DB_G[r.st] || 'o']++; });
  c.roll = c.p + c.h + c.m + c.a + c.n; c.inn = c.p + c.h + c.m;
  c.pct = c.roll ? (c.inn / c.roll) * 100 : null;
  return c;
}
function dbModel() {
  const B = S.db, all = B.rows.filter(dbPass), byDate = {};
  all.forEach((r) => { (byDate[r.d] = byDate[r.d] || []).push(r); });
  const dates = Object.keys(byDate).sort(), stat = {};
  dates.forEach((d) => { stat[d] = dbStats(byDate[d]); });
  const work = dates.filter((d) => d <= B.date && stat[d].roll > 0);
  const cur = stat[B.date] || dbStats([]);
  const prevD = work.filter((d) => d < B.date).pop();
  const dayRows = (byDate[B.date] || []);
  const info = {};   // per employee: last day they were in before this date, and absences this month so far
  all.forEach((r) => {
    const i = info[r.id] || (info[r.id] = { last: '', absM: 0 }), g = DB_G[r.st];
    if (r.d < B.date && (g === 'p' || g === 'h' || g === 'x' || g === 'm') && r.d > i.last) i.last = r.d;
    if (g === 'a' && r.d <= B.date && r.d.slice(0, 7) === B.date.slice(0, 7)) i.absM++;
  });
  return { all, byDate, stat, work, cur, prev: prevD ? stat[prevD] : null, prevD, dayRows, info, off: cur.roll === 0 && cur.o > 0, today: B.date === S.today };
}
function dbSpark(vals, col) {
  if (vals.length < 2) return '';
  const w = 84, h = 26, mx = Math.max.apply(null, vals) || 1, mn = Math.min.apply(null, vals), rg = mx - mn || 1;
  const pts = vals.map((v, i) => (i * w / (vals.length - 1)).toFixed(1) + ',' + (h - 3 - ((v - mn) / rg) * (h - 6)).toFixed(1)).join(' L');
  return `<svg class="dbsp" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="M${pts}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" pathLength="1"/></svg>`;
}
function dbDelta(cur, prev, goodUp, unit) {
  if (prev == null || cur == null) return '<span class="mut">no earlier day to compare</span>';
  const d = Math.round((cur - prev) * 10) / 10;
  if (!d) return '<span class="mut">unchanged vs previous day</span>';
  const good = goodUp ? d > 0 : d < 0;
  return `<span class="${good ? 'up' : 'dn'}">${d > 0 ? '▲' : '▼'} ${nf(Math.abs(d), unit ? 1 : 0)}${unit || ''}</span> <span class="mut">vs previous day</span>`;
}
function dbChart(M) {
  const days = M.work.slice(-14); if (days.length < 2) return '<div class="empty" style="padding:30px 0"><b>Not enough days yet</b>The trend appears after two working days.</div>';
  const vals = days.map((d) => M.stat[d].inn), W = 620, H = 190, pad = 30;
  const top = Math.max(10, Math.ceil(Math.max.apply(null, vals) * 1.15 / 10) * 10);
  const X = (i) => pad + i * (W - 2 * pad) / (days.length - 1), Y = (v) => H - pad - (v / top) * (H - 2 * pad);
  const line = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  const area = line + ` L${X(days.length - 1).toFixed(1)},${H - pad} L${X(0).toFixed(1)},${H - pad} Z`;
  const grid = [0, 1, 2, 3].map((k) => { const g = Math.round(top * k / 3), y = Y(g); return `<line x1="${pad}" x2="${W - pad}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#eef1f6"/><text x="2" y="${(y + 4).toFixed(1)}" font-size="10" fill="#94a3b8">${g}</text>`; }).join('');
  const xl = days.map((d, i) => `<text x="${X(i).toFixed(1)}" y="${H - 8}" font-size="10" fill="#94a3b8" text-anchor="middle">${+d.slice(8)}</text>`).join('');
  const dots = days.map((d, i) => `<circle class="dbdot${d === S.today ? ' now' : ''}" cx="${X(i).toFixed(1)}" cy="${Y(vals[i]).toFixed(1)}" r="3.5" style="--i:${i}"><title>${dLong(d)}: ${vals[i]} in${d === S.today ? ' so far' : ''}</title></circle>`).join('');
  return `<svg class="dbchart" width="100%" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="dbg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#2f6bff" stop-opacity=".2"/><stop offset="1" stop-color="#2f6bff" stop-opacity="0"/></linearGradient></defs>${grid}${xl}<path class="dbarea" d="${area}" fill="url(#dbg)"/><path class="dbline" d="${line}" fill="none" stroke="#2f6bff" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" pathLength="1"/>${dots}</svg>`;
}
function dbTabRows(M) {
  const B = S.db, q = B.q.trim().toLowerCase();
  let rows = M.dayRows.filter((r) => (!B.branch || r.e.location === B.branch) && (!q || r.e.name.toLowerCase().includes(q)));
  const keep = { absent: ['a', 'n'], present: ['p'], hx: ['h', 'x'], miss: ['m'] }[B.tab];
  if (keep) rows = rows.filter((r) => keep.includes(DB_G[r.st]));
  else rows = rows.filter((r) => DB_G[r.st] !== 'o' || B.tab === 'all');
  return rows.sort((a, b) => a.e.name.localeCompare(b.e.name));
}
function dbTable(M) {
  const B = S.db, rows = dbTabRows(M), absTab = B.tab === 'absent';
  const pill = (r) => { const g = DB_G[r.st] || 'o'; return `<span class="dbp ${g}">${esc(g === 'p' && r.st === 'In Progress' ? 'In progress' : DB_LBL[g])}</span>`; };
  const head = absTab ? '<th>Employee</th><th>Branch</th><th>Status</th><th>Last present</th><th class="n">Absent this month</th>'
    : '<th>Employee</th><th>Branch</th><th>Status</th><th>In</th><th>Out</th><th class="n">Hours</th>';
  const body = rows.map((r, i) => {
    const i2 = M.info[r.id] || { last: '', absM: 0 }, nm = `<div class="dbem"><span class="dbav">${esc(salInit(r.e.name))}</span><b>${esc(r.e.name)}</b></div>`;
    const tail = absTab ? `<td class="mut">${i2.last ? dLong(i2.last).replace(/, \d{4}$/, '') : '—'}</td><td class="n">${i2.absM}</td>`
      : `<td>${esc(r.tin || '—')}</td><td>${esc(r.tout || '—')}</td><td class="n">${r.h == null ? '—' : nf(r.h, 1)}</td>`;
    return `<tr data-emp="${r.id}" style="--r:${Math.min(i, 12)}"><td>${nm}</td><td class="mut">${esc(r.e.location)}</td><td>${pill(r)}</td>${tail}</tr>`;
  }).join('');
  if (!rows.length) return '<div class="empty" style="padding:34px 0"><b>No one here</b>Nothing matches this tab, branch and search.</div>';
  return `<div class="dbwrap"><table class="dbt"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><div class="dbfoot">${rows.length} ${rows.length === 1 ? 'person' : 'people'} · click a name to open the calendar</div>`;
}
function pgBoard() {
  const B = S.db;
  if (!S.today) return pageSkeleton();
  if (!B.rows && !B.err) { if (!B.loading) setTimeout(loadBoard, 0); return dbSkeleton(); }
  if (!B.rows) return `<div class="card pad"><div class="empty"><b>Could not load</b>${esc(B.err)}<br><button class="btn" data-db="reload" type="button" style="margin-top:12px">Try again</button></div></div>`;
  const M = dbModel(), c = M.cur, pv = M.prev, last7 = M.work.slice(-7).map((d) => M.stat[d]);
  const isToday = M.today;
  const ctl = `<div class="dbtop"><div><h2>${esc(dLong(B.date))}</h2><div class="dbsub">${isToday ? 'Live · updated ' + esc(freshStamp()) : 'Past day · final'}</div></div>
    <div class="dbctl"><div class="dbseg"><button type="button" data-db="day" data-v="${dAdd(S.today, -1)}" class="${B.date === dAdd(S.today, -1) ? 'on' : ''}">Yesterday</button><button type="button" data-db="day" data-v="${S.today}" class="${isToday ? 'on' : ''}">Today</button>
      <label class="${B.date !== S.today && B.date !== dAdd(S.today, -1) ? 'on' : ''}">Pick date<input type="date" id="dbDate" value="${B.date}" min="${esc(S.dataStart)}" max="${S.today}"></label></div>
      <button class="dbbtn" type="button" data-db="csv">Export CSV</button></div></div>`;
  let hero;
  if (M.off) {
    hero = `<div class="dbnote"><b>${esc(new Date(B.date + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' }))} is a day off.</b> No one is expected today${c.x ? `, ${c.x} ${c.x === 1 ? 'person' : 'people'} worked (Extra day)` : ''}. Pick a working day to see attendance.</div>`;
  } else {
    const k = (label, dot, val, sub, spark, cls) => `<div class="dbk ${cls || ''}" style="--k:${KI_N++}"><small>${dot ? `<i style="background:${dot}"></i>` : ''}${label}</small><div class="r"><div class="v">${val}</div>${spark || ''}</div><div class="d">${sub}</div></div>`;
    KI_N = 0;
    const pctTxt = c.pct == null ? '—' : `<span data-cu="${c.pct.toFixed(0)}" data-d="0">${c.pct.toFixed(0)}</span>%`;
    const notIn = isToday && c.n ? `<span class="mut">+ ${c.n} not in yet</span>` : dbDelta(c.a, pv && pv.a, false);
    hero = `<div class="dbkpis">
      ${k(isToday ? 'Attendance so far' : 'Attendance', '', pctTxt, `${c.inn} of ${c.roll} ${isToday ? '· ' : ''}${dbDelta(c.pct, pv && pv.pct, true, ' pts')}`, dbSpark(last7.map((x) => x.pct || 0), '#2f6bff'))}
      ${k('Present', '#16a34a', cuw(c.p), dbDelta(c.p, pv && pv.p, true), dbSpark(last7.map((x) => x.p), '#16a34a'))}
      ${k('Absent', '#dc2626', cuw(c.a), notIn, dbSpark(last7.map((x) => x.a), '#dc2626'))}
      ${k('Half day · Extra day', '#2f6bff', cuw(c.h) + ' · ' + cuw(c.x), dbDelta(c.h + c.x, pv && pv.h + pv.x, true), dbSpark(last7.map((x) => x.h + x.x), '#7c3aed'))}
      ${k('Missing punch', '#d97706', cuw(c.m), dbDelta(c.m, pv && pv.m, false), dbSpark(last7.map((x) => x.m), '#d97706'))}</div>`;
    const brs = [...new Set(M.dayRows.map((r) => r.e.location))].sort();
    const brRows = brs.map((b) => {
      const s2 = dbStats(M.dayRows.filter((r) => r.e.location === b)), inOk = s2.p + s2.h, mp = s2.m;
      const pc = s2.roll ? Math.round(((s2.inn) / s2.roll) * 100) : 0;
      return `<button type="button" class="dbbr${B.branch === b ? ' on' : ''}" data-db="br" data-v="${esc(b)}"><div class="l"><b>${esc(b)}</b><span>${s2.inn} / ${s2.roll} · ${pc}%</span></div>
        <div class="tr"><i style="width:${s2.roll ? (inOk / s2.roll) * 100 : 0}%"></i><i class="am" style="width:${s2.roll ? (mp / s2.roll) * 100 : 0}%"></i></div></button>`;
    }).join('');
    hero += `<div class="dbrow"><div class="dbcard"><div class="dbch"><b>People in, last ${Math.min(14, M.work.length)} working days</b><small>Sundays and holidays skipped${isToday ? ' · today is partial' : ''}</small></div>${dbChart(M)}</div>
      <div class="dbcard"><div class="dbch"><b>By branch</b><small>${B.branch ? 'click again to clear' : 'click to filter'}</small></div><div class="dbbrs">${brRows || '<div class="empty">No data</div>'}</div></div></div>`;
  }
  const cnt = { absent: c.a + c.n, present: c.p, hx: c.h + c.x, miss: c.m, all: c.roll + c.x };
  const tabs = [['absent', isToday && c.n ? 'Absent / not in yet' : 'Absent'], ['present', 'Present'], ['hx', 'Half / Extra'], ['miss', 'Missing punch'], ['all', 'All']];
  const tabsH = `<div class="dbtabs">${tabs.map(([k2, t]) => `<button type="button" class="dbtab${B.tab === k2 ? ' on' : ''}" data-db="tab" data-v="${k2}">${t}<b>${cnt[k2]}</b></button>`).join('')}
    <input id="dbQ" class="dbsearch" type="search" placeholder="Search employee" value="${esc(B.q)}" autocomplete="off"></div>`;
  return `<div class="dbd${B.anim ? ' anim' : ''}${B.loading ? ' busy' : ''}">${ctl}${hero}<div class="dbcard dbtbl">${tabsH}<div id="dbTable">${dbTable(M)}</div></div></div>`;
}
function freshStamp() { return S.latest ? new Date(S.latest).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true }) : 'just now'; }
function dbSkeleton() {
  const b = (w, h, m = '') => `<div class="dbsk" style="width:${w};height:${h}px;${m}"></div>`;
  const k = `<div class="dbk">${b('45%', 10)}${b('60%', 26, 'margin-top:12px')}${b('70%', 10, 'margin-top:12px')}</div>`;
  return `<div class="dbd" aria-busy="true"><div class="dbtop"><div>${b('160px', 22)}${b('240px', 12, 'margin-top:8px')}</div></div><div class="dbkpis">${k.repeat(5)}</div>
    <div class="dbrow"><div class="dbcard" style="padding:18px">${b('35%', 12)}${b('100%', 150, 'margin-top:16px')}</div><div class="dbcard" style="padding:18px">${b('30%', 12)}${[1, 2, 3].map(() => b('100%', 8, 'margin-top:22px')).join('')}</div></div>
    <div class="dbcard" style="padding:18px">${[1, 2, 3, 4].map(() => b('100%', 14, 'margin-bottom:14px')).join('')}</div></div>`;
}
function dbCsv() {
  const B = S.db; if (!B.rows) return;
  const M = dbModel(), rows = dbTabRows(M), q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const L = [['Date', 'Employee', 'Branch', 'Status', 'In', 'Out', 'Hours'].map(q).join(',')].concat(rows.map((r) => [B.date, r.e.name, r.e.location, DB_LBL[DB_G[r.st] || 'o'], r.tin, r.tout, r.h == null ? '' : r.h].map(q).join(',')));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + L.join('\r\n')], { type: 'text/csv' }));
  a.download = 'daily_board_' + B.date + '_' + B.tab + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
PAGES.board = pgBoard;
const _prevRenderPage = renderPage;
renderPage = function (soft) {
  _prevRenderPage(soft);
  if (S.page !== 'board') return;
  const c = $('#center');
  if (S.db.anim && !S.db.loading) { countUps(c); setTimeout(() => { S.db.anim = false; const d = c.querySelector('.dbd'); if (d) d.classList.remove('anim'); }, 1500); }
  else c.querySelectorAll('[data-cu]').forEach((el) => { el.textContent = nf(+el.dataset.cu, +el.dataset.d); });
};
$('#center').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-db]'); if (!b || S.page !== 'board') return;
  const k = b.dataset.db, B = S.db;
  if (k === 'day') { B.date = b.dataset.v; loadBoard(); }
  else if (k === 'tab') { B.tab = b.dataset.v; renderPage(true); }
  else if (k === 'br') { B.branch = B.branch === b.dataset.v ? '' : b.dataset.v; renderPage(true); }
  else if (k === 'csv') dbCsv();
  else if (k === 'reload') loadBoard(true);
});
$('#center').addEventListener('click', (ev) => {
  const i = ev.target.id === 'dbDate' ? ev.target : (ev.target.closest('.dbseg label') || {}).firstElementChild;
  if (i && i.id === 'dbDate') { try { i.showPicker(); } catch (e) { try { i.focus(); i.click(); } catch (e2) { /* old browser: type the date */ } } }
});
$('#center').addEventListener('change', (ev) => { if (ev.target.id === 'dbDate' && ev.target.value) { S.db.date = ev.target.value > S.today ? S.today : ev.target.value; loadBoard(); } });
$('#center').addEventListener('input', (ev) => { if (ev.target.id === 'dbQ') { S.db.q = ev.target.value; const t = $('#dbTable'); if (t && S.db.rows) t.innerHTML = dbTable(dbModel()); } });
$('#refresh').addEventListener('click', () => { if (S.page === 'board') { S.db.rows = null; setTimeout(() => loadBoard(true), 400); } });

/* ================= THEMES (first entry = default). Add a new theme here + a html[data-theme="id"] CSS block ================= */
/* The theme list, the festive dates and the auto rule live in js/theme.js (loaded in <head>, so there is no flash). */
const TH = window.DCC_THEME;
function modeLabel(mode) {
  return mode === 'auto' ? 'Auto (' + TH.name(TH.resolve('auto')) + ')' : TH.name(mode);
}
function applyTheme(mode, save) {
  mode = TH.setMode(mode, save);
  const next = TH.MODES[(TH.MODES.indexOf(mode) + 1) % TH.MODES.length];
  $('#themeBtn').textContent = '◐ Theme';
  $('#themeBtn').title = 'Switch to ' + modeLabel(next);
  return mode;
}
{
  applyTheme(TH.getMode(), false);
  /* Theme menu: every theme in one list, tick on the current one */
  const tm = document.createElement('div'); tm.id = 'themeMenu'; tm.hidden = true; document.body.appendChild(tm);
  const tmDraw = () => {
    const cur = TH.getMode();
    tm.innerHTML = TH.MODES.map((m) => `<button type="button" data-tm="${m}" class="${m === cur ? 'on' : ''}"><i></i>${esc(m === 'auto' ? 'Auto (' + TH.name(TH.resolve('auto')) + ' today)' : TH.name(m))}</button>`).join('');
  };
  const tmClose = () => { tm.hidden = true; };
  $('#themeBtn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!tm.hidden) return tmClose();
    tmDraw();
    const r = $('#themeBtn').getBoundingClientRect();
    tm.style.top = (r.bottom + 6) + 'px'; tm.style.right = Math.max(8, innerWidth - r.right) + 'px'; tm.hidden = false;
  });
  tm.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-tm]'); if (!b) return;
    ev.stopPropagation(); const m = applyTheme(b.dataset.tm, true); tmClose(); toast(modeLabel(m), 'ok');
  });
  document.addEventListener('click', tmClose);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') tmClose(); });
  /* Puja effects (sparks + petals) live in fx.js; the ✿ button switches them with the Hydrangea petals */
  const darkBtn = $('#darshanBtn'), dOff = () => document.body.classList.remove('darshan');
  darkBtn.addEventListener('click', (ev) => { ev.stopPropagation(); document.body.classList.add('darshan'); toast('Click anywhere or press Esc to return'); });
  document.addEventListener('click', () => { if (document.body.classList.contains('darshan')) dOff(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') dOff(); });
}

boot();

/* ---------- falling petals (purely decorative) ---------- */
(function () {
  const PAL = [['#ffd0e6', '#f06aa8'], ['#f8b4d6', '#d63384'], ['#e3d0fa', '#9a6fe0'], ['#cdb4f4', '#7c4dc9'], ['#ffe0ee', '#f29cc4'], ['#ead9fb', '#b48be6']];
  const box = document.createElement('div'); box.className = 'petals'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box);
  const mk = (i) => {
    const [a, b] = PAL[i % PAL.length], s = 14 + Math.random() * 18, id = 'pg' + i;
    const el = document.createElement('span'); el.className = 'petal';
    el.style.cssText = `--x:${(Math.random() * 100).toFixed(1)}%;--s:${s.toFixed(0)}px;--d:${(16 + Math.random() * 14).toFixed(1)}s;--delay:${(-Math.random() * 30).toFixed(1)}s;--sw:${(2.6 + Math.random() * 2.4).toFixed(1)}s;--dx:${(-80 + Math.random() * 200).toFixed(0)}px;--rot:${(180 + Math.random() * 360).toFixed(0)}deg`;
    el.innerHTML = `<svg viewBox="0 0 24 32"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><path d="M12 1C19 8 22 16 12 31 2 16 5 8 12 1Z" fill="url(#${id})" opacity=".92"/><path d="M12 5C12 14 12 22 12 29" stroke="#fff" stroke-opacity=".45" stroke-width=".8" fill="none"/></svg>`;
    return el;
  };
  for (let i = 0; i < 44; i++) box.appendChild(mk(i));
  const btn = document.getElementById('petalBtn');
  let on = true; try { on = localStorage.getItem('dccPetals') !== 'off'; } catch (e) {}
  const apply = () => { box.classList.toggle('off', !on); btn.setAttribute('aria-pressed', String(on)); try { localStorage.setItem('dccPetals', on ? 'on' : 'off'); } catch (e) {} };
  btn.addEventListener('click', () => { on = !on; apply(); });
  apply();
})();

/* ---------- view-only day details (everyone) ---------- */
const driveId = (u) => { const m = String(u || '').match(/[?&]id=([\w-]+)|\/d\/([\w-]+)/); return m ? (m[1] || m[2]) : ''; };
async function openView(date) {
  S.viewDate = date;
  const r = S.rows.find((x) => x.work_date === date); if (!r) return;
  $('#vTitle').textContent = S.emp.name;
  $('#vCtx').textContent = `${fmtDate(date)}/${date.slice(0, 4)} · ${S.emp.location}`;
  const hrs = r.hours != null ? Number(r.hours).toFixed(1) + ' h' : '—';
  const flags = [r.late_in ? 'Late in' : '', r.late_out ? 'Late out (9 PM+)' : '', r.night ? 'Night duty' : '', r.source === 'Corrected' ? 'Corrected by admin' : ''].filter(Boolean);
  $('#vBody').innerHTML = `<span class="pill ${r.status.replace(/\s+/g, '')}" style="font-size:12px;padding:3px 12px">${esc(r.status === 'Not In Yet' ? 'Not in yet' : r.status)}</span>
    <div class="vgrid"><div><small>In</small><b>${t5(r.in_time)}</b></div><div><small>Out</small><b>${t5(r.out_time)}</b></div><div><small>Hours</small><b>${hrs}</b></div><div><small>Overtime</small><b>${Number(r.ot_hours) > 0 ? '+' + Number(r.ot_hours).toFixed(1) + ' h' : '—'}</b></div></div>
    ${flags.length ? `<div class="sub" style="margin-bottom:8px">${flags.map(esc).join(' · ')}</div>` : ''}
    ${r.note ? `<div class="vnote">${esc(r.note)}</div>` : ''}
    <h3 style="font-size:13px;margin:10px 0 8px">Punch photos</h3><div id="vPun"><div class="sub">Loading…</div></div>`;
  $('#vdrawer').classList.add('open'); $('#vdrawer').setAttribute('aria-hidden', 'false');
  try {
    const d = await gas('webDayPunches', S.emp.id, date);
    $('#vPun').innerHTML = d.punches.length ? d.punches.map((p) => {
      const id = '';
      return `<div class="pcard"><div class="ph"><span><span class="tag ${String(p.io).toLowerCase() === 'out' ? 'out' : 'in'}">${esc(String(p.io).toUpperCase())}</span> <b>${esc(p.local_ts.slice(11, 16))}</b></span><span class="sub">${esc(p.location)}</span></div>
        ${p.photo_url ? `<a href="${esc(p.photo_url)}" target="_blank" rel="noopener noreferrer"><img class="pic" loading="lazy" alt="punch photo" src="${esc(p.photo_url)}" onerror="this.outerHTML='<div class=nopic>Photo could not be loaded.</div>'"></a>` : '<div class="nopic">No photo for this punch.</div>'}
        ${p.photo_url ? `<a class="open" href="${esc(p.photo_url)}" target="_blank" rel="noopener noreferrer">Open full photo ↗</a>` : ''}</div>`;
    }).join('') : '<div class="sub">No punches recorded for this day.</div>';
  } catch (e) { $('#vPun').innerHTML = `<div class="sub">${esc(e.message)}</div>`; }
}
async function loadPhotos(date) {
  for (const box of [...document.querySelectorAll('#vPun .phbox')]) {
    if (!$('#vdrawer').classList.contains('open') || S.viewDate !== date) return;
    try {
      const d = await gas('webPhoto', box.dataset.fid);
      box.innerHTML = `<a href="${esc(box.dataset.url)}" target="_blank" rel="noopener noreferrer"><img class="pic" alt="punch photo" src="data:${d.m};base64,${d.b}"></a>`;
    } catch (e) { box.innerHTML = `<div class="nopic">Photo can't be shown here.<br><small>${esc(e.message)}</small></div>`; }
  }
}
const closeView = () => { $('#vdrawer').classList.remove('open'); $('#vdrawer').setAttribute('aria-hidden', 'true'); };
$('#vClose').addEventListener('click', closeView);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeView(); });

/* ---------- today: someone who has not punched yet is "Not in yet", not Absent (until 9 PM) ---------- */
const istHour = () => +new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false });
const isPending = (date, status, hasPunch, src) => date === S.today && status === 'Absent' && !hasPunch && src !== 'Corrected' && istHour() < 21;

$('#vX').addEventListener('click', closeView);
$('#dX').addEventListener('click', () => closeDrawer());
document.addEventListener('mousedown', (ev) => { const v = $('#vdrawer'); if (v.classList.contains('open') && !ev.target.closest('#vdrawer') && !ev.target.closest('.tile')) closeView(); });