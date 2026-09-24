// ==========================================================================
// STAFFLY PAGES
// --------------------------------------------------------------------------
// Leave, Payroll, Training, Analytics, Live Map, Staff Directory and Team
// Accounts. Loaded after app.js and uses its helpers (callAPI, escapeHtml,
// CURRENT_USER, OFFICE_LAT/LNG ...). Everything here renders into markup that
// lives in index.html - no Bootstrap, no external UI framework.
// ==========================================================================

const ADMIN_ROLES = ['Admin', 'HR', 'Dev'];
const isAdminUser = () => !!(CURRENT_USER && ADMIN_ROLES.includes(CURRENT_USER.role));

// --------------------------------------------------------------------------
// Shared UI helpers
// --------------------------------------------------------------------------

// Small non-blocking message at the bottom of the screen (replaces alert()).
function notify(message, kind = 'ok') {
  let stack = document.getElementById('toastStack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toastStack';
    stack.className = 'toast-stack';
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  const icon = kind === 'error' ? 'fa-circle-exclamation' : kind === 'info' ? 'fa-circle-info' : 'fa-circle-check';
  t.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, kind === 'error' ? 5000 : 3200);
}

// Bottom sheets (reuse the .loc-check-modal look). Esc / backdrop closes.
let LAST_SHEET_TRIGGER = null;
function openSheet(id) {
  const m = document.getElementById(id);
  if (!m) return;
  LAST_SHEET_TRIGGER = document.activeElement;
  m.classList.add('open');
  m.setAttribute('aria-hidden', 'false');
  const first = m.querySelector('input:not([type=hidden]), select, textarea');
  if (first) setTimeout(() => first.focus(), 60);
}
function closeSheet(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('open');
  m.setAttribute('aria-hidden', 'true');
  if (LAST_SHEET_TRIGGER && LAST_SHEET_TRIGGER.focus) LAST_SHEET_TRIGGER.focus();
}
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector('.sheet-modal.open');
  if (open) closeSheet(open.id);
});
document.addEventListener('click', (e) => {
  if (e.target.classList && e.target.classList.contains('sheet-modal') && e.target.classList.contains('open')) {
    closeSheet(e.target.id);
  }
});

function setBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span>${label || 'Saving…'}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.innerHTML = btn.dataset.label;
  }
}

function emptyState(icon, title, text) {
  return `<div class="empty-state">
    <div class="empty-icon"><i class="fas ${icon}" aria-hidden="true"></i></div>
    <p class="empty-title">${escapeHtml(title)}</p>
    ${text ? `<p class="empty-text">${escapeHtml(text)}</p>` : ''}
  </div>`;
}

function listSkeleton(n = 3) {
  return Array.from({ length: n }, () => '<div class="row-skeleton"></div>').join('');
}

function statusPill(status) {
  const s = String(status || '').toLowerCase();
  const kind =
    /approved|active|present|complete/.test(s) ? 'ok' :
    /rejected|inactive|absent|denied/.test(s) ? 'bad' :
    /pending|half|late|review/.test(s) ? 'warn' : 'neutral';
  return `<span class="pill pill-${kind}">${escapeHtml(status || '—')}</span>`;
}

function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d);
  if (isNaN(dt)) return String(d);
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysBetween(from, to) {
  const a = new Date(from + 'T00:00:00'), b = new Date(to + 'T00:00:00');
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

function relTime(ts) {
  const t = Date.parse(ts);
  if (isNaN(t)) return ts ? String(ts) : '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmtDate(ts);
}

function rupees(n) {
  const v = Number(n);
  return isNaN(v) ? '₹0' : '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function humanize(key) {
  const s = String(key).replace(/_/g, ' ').replace(/\bcount\b/i, '').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Server write results come in a few shapes; treat any explicit failure as one.
function resultFailed(r) {
  return !r || r.success === false || r.status === 'ERROR' || r.status === 'FAILED';
}

// --------------------------------------------------------------------------
// HOME: today's stats
// --------------------------------------------------------------------------
async function loadHomeStats() {
  if (!CURRENT_USER) return;
  try {
    const m = await callAPI('getDashboardMetrics', { employeeId: CURRENT_USER.employeeId, date: getLocalDateString() });
    if (!m || typeof m !== 'object') return;
    const pick = (re) => {
      const k = Object.keys(m).find(key => re.test(key) && !isNaN(Number(m[key])));
      return k ? Number(m[k]) : null;
    };
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && v !== null) el.textContent = v;
    };
    set('presentCount', pick(/present/i));
    set('halfDayCount', pick(/half/i));
    set('leaveCount', pick(/leave/i));
  } catch (e) { /* stats are optional */ }
}

// --------------------------------------------------------------------------
// STAFF DIRECTORY
// --------------------------------------------------------------------------
async function loadDirectory() {
  const container = document.getElementById('directoryList');
  if (!container) return;
  container.innerHTML = listSkeleton(6);
  try {
    const list = await callAPI('getEmployeesDirectory');
    EMPLOYEE_LIST = list || [];
    renderDirectorySummary(EMPLOYEE_LIST);
    if (!EMPLOYEE_LIST.length) {
      container.innerHTML = emptyState('fa-users', 'No active employees yet', 'Add team accounts from System Settings.');
      return;
    }
    container.innerHTML = EMPLOYEE_LIST.map(emp => {
      const status = emp.today_status || 'Absent';
      return `<div class="person-row dir-item" data-status="${escapeHtml(status.toLowerCase())}"
                   data-name="${escapeHtml((emp.name || '').toLowerCase())}" data-id="${escapeHtml((emp.employee_id || '').toLowerCase())}">
        <div class="avatar">${escapeHtml(initials(emp.name || emp.employee_id))}</div>
        <div class="person-main">
          <div class="person-name">${escapeHtml(emp.name || emp.employee_id)}</div>
          <div class="person-meta">${escapeHtml(emp.role || '')} &bull; ${escapeHtml(emp.employee_id || '')}</div>
        </div>
        ${statusPill(status)}
      </div>`;
    }).join('');
    filterDirectory();
  } catch (e) {
    container.innerHTML = emptyState('fa-triangle-exclamation', "Couldn't load the directory", 'Check your connection and open this page again.');
  }
}

function renderDirectorySummary(list) {
  const el = document.getElementById('directorySummary');
  if (!el) return;
  const present = list.filter(e => String(e.today_status || '').toLowerCase() === 'present').length;
  el.innerHTML = `<b>${present}</b> of ${list.length} present today`;
}

function filterDirectory() {
  const input = document.getElementById('dirSearchInput');
  const q = input ? input.value.trim().toLowerCase() : '';
  let shown = 0;
  document.querySelectorAll('#directoryList .dir-item').forEach(item => {
    const ok = (item.dataset.name.includes(q) || item.dataset.id.includes(q)) &&
      (dirFilterState === 'all' || item.dataset.status === dirFilterState);
    item.style.display = ok ? '' : 'none';
    if (ok) shown++;
  });
  const none = document.getElementById('directoryNoMatch');
  if (none) none.hidden = shown > 0 || !EMPLOYEE_LIST.length;
}

function setDirFilter(filter, btn) {
  dirFilterState = filter;
  document.querySelectorAll('#dirFilterChips .chip').forEach(c => {
    c.classList.toggle('on', c === btn);
    c.setAttribute('aria-pressed', c === btn ? 'true' : 'false');
  });
  filterDirectory();
}

// --------------------------------------------------------------------------
// LEAVE PORTAL
// --------------------------------------------------------------------------
let LEAVE_TAB = 'mine';

async function loadLeaveData() {
  if (!CURRENT_USER) return;
  const mine = document.getElementById('leaveHistoryList');
  if (mine) mine.innerHTML = listSkeleton(3);
  try {
    const myLeaves = await callAPI('getEmployeeLeaves', { employeeId: CURRENT_USER.employeeId });
    renderLeaveList(myLeaves, 'leaveHistoryList', false);
  } catch (e) {
    if (mine) mine.innerHTML = emptyState('fa-triangle-exclamation', "Couldn't load your leave requests", 'Check your connection and try again.');
  }
  if (isAdminUser()) {
    const review = document.getElementById('leaveReviewList');
    if (review) review.innerHTML = listSkeleton(2);
    try {
      const pending = await callAPI('getAllPendingLeaves');
      renderLeaveList(pending, 'leaveReviewList', true);
      const badge = document.getElementById('leaveReviewCount');
      if (badge) {
        const n = (pending || []).length;
        badge.textContent = n;
        badge.hidden = n === 0;
      }
    } catch (e) {
      if (review) review.innerHTML = emptyState('fa-triangle-exclamation', "Couldn't load requests to review", '');
    }
  }
  switchLeaveView(LEAVE_TAB);
}

function renderLeaveList(list, containerId, isReview) {
  const box = document.getElementById(containerId);
  if (!box) return;
  if (!list || !list.length) {
    box.innerHTML = isReview
      ? emptyState('fa-inbox', 'Nothing to review', 'New leave requests from your team will appear here.')
      : emptyState('fa-umbrella-beach', 'No leave requests yet', 'Tap "Apply for leave" to request time off.');
    return;
  }
  box.innerHTML = list.map(item => {
    const days = daysBetween(item.from_date, item.to_date);
    const range = item.from_date === item.to_date
      ? fmtDate(item.from_date)
      : `${fmtDate(item.from_date)} – ${fmtDate(item.to_date)}`;
    const who = isReview
      ? `<div class="leave-who"><span class="avatar avatar-sm">${escapeHtml(initials(item.employee_name || item.employee_id))}</span>${escapeHtml(item.employee_name || item.employee_id)}</div>`
      : '';
    const actions = isReview && item.status === 'Pending' ? `
      <input type="text" class="field-input field-sm" id="leaveComment-${Number(item.id)}" placeholder="Comment for the employee (optional)" maxlength="200">
      <div class="btn-row">
        <button type="button" class="btn btn-success" onclick="processLeave(${Number(item.id)}, 'Approved', this)"><i class="fas fa-check" aria-hidden="true"></i> Approve</button>
        <button type="button" class="btn btn-danger-ghost" onclick="processLeave(${Number(item.id)}, 'Rejected', this)"><i class="fas fa-xmark" aria-hidden="true"></i> Reject</button>
      </div>` : '';
    return `<article class="card leave-card" id="leave-${Number(item.id)}">
      ${who}
      <div class="leave-top">
        <span class="leave-type">${escapeHtml(item.leave_type || 'Leave')}</span>
        ${statusPill(item.status)}
      </div>
      <div class="leave-dates"><i class="far fa-calendar" aria-hidden="true"></i> ${escapeHtml(range)} <span class="muted">&bull; ${days} ${days === 1 ? 'day' : 'days'}</span></div>
      <p class="leave-reason">${item.reason ? escapeHtml(item.reason) : '<span class="muted">No reason given</span>'}</p>
      ${item.hr_comment && !isReview ? `<p class="leave-comment"><i class="fas fa-reply" aria-hidden="true"></i> ${escapeHtml(item.hr_comment)}</p>` : ''}
      ${actions}
    </article>`;
  }).join('');
}

function switchLeaveView(view) {
  LEAVE_TAB = view === 'review' && isAdminUser() ? 'review' : 'mine';
  const mine = document.getElementById('leaveHistoryList');
  const review = document.getElementById('leaveReviewList');
  if (mine) mine.hidden = LEAVE_TAB !== 'mine';
  if (review) review.hidden = LEAVE_TAB !== 'review';
  document.querySelectorAll('#leaveTabs .seg-btn').forEach(b => {
    const on = b.dataset.tab === LEAVE_TAB;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function updateLeaveDays() {
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  const out = document.getElementById('leaveDaysHint');
  if (!out) return;
  const n = from && to ? daysBetween(from, to) : 0;
  out.textContent = n > 0 ? `${n} ${n === 1 ? 'day' : 'days'} of leave` : (from && to ? 'End date is before the start date' : '');
  out.classList.toggle('bad', n <= 0 && !!(from && to));
}

function openApplyLeave() {
  const today = getLocalDateString();
  const from = document.getElementById('fromDate');
  const to = document.getElementById('toDate');
  if (from && !from.value) from.value = today;
  if (to && !to.value) to.value = today;
  if (from) from.min = today;
  if (to) to.min = today;
  updateLeaveDays();
  openSheet('applyLeaveModal');
}

async function handleApplyLeave(btn) {
  const type = document.getElementById('leaveType').value;
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  const reason = document.getElementById('leaveReason').value.trim();
  if (!from || !to) return notify('Pick the start and end dates.', 'error');
  if (daysBetween(from, to) <= 0) return notify('End date must be on or after the start date.', 'error');
  if (reason.length < 5) return notify('Add a short reason (at least 5 characters).', 'error');

  setBusy(btn, true, 'Sending…');
  try {
    const r = await callAPI('applyLeave', { leaveType: type, fromDate: from, toDate: to, reason });
    if (r && (r.success === false || r.status === 'ERROR')) {
      notify(r.message || 'Leave request was not accepted.', 'error');
      return;
    }
    closeSheet('applyLeaveModal');
    document.getElementById('leaveReason').value = '';
    notify('Leave request sent for approval.');
    LEAVE_TAB = 'mine';
    loadLeaveData();
  } catch (e) {
    notify('Could not send the leave request. Check your connection.', 'error');
  } finally {
    setBusy(btn, false);
  }
}

async function processLeave(leaveId, status, btn) {
  const commentEl = document.getElementById(`leaveComment-${leaveId}`);
  const comment = commentEl && commentEl.value.trim() ? commentEl.value.trim() : status;
  const card = document.getElementById(`leave-${leaveId}`);
  if (card) card.querySelectorAll('button').forEach(b => b.disabled = true);
  setBusy(btn, true, status === 'Approved' ? 'Approving…' : 'Rejecting…');
  try {
    const r = await callAPI('updateLeaveStatus', { leaveId, status, hrComment: comment });
    if (r && r.success === false) throw new Error(r.message);
    notify(status === 'Approved' ? 'Leave approved.' : 'Leave rejected.');
    if (card) {
      card.classList.add('leaving');
      setTimeout(loadLeaveData, 280);
    } else {
      loadLeaveData();
    }
  } catch (e) {
    notify('Could not update this request.', 'error');
    if (card) card.querySelectorAll('button').forEach(b => b.disabled = false);
    setBusy(btn, false);
  }
}

// --------------------------------------------------------------------------
// PAYROLL
// --------------------------------------------------------------------------
async function loadSalaryData() {
  const month = document.getElementById('salaryMonth');
  if (month && !month.value) {
    const d = new Date();
    month.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const empSel = document.getElementById('salaryEmpId');
  if (isAdminUser() && empSel && empSel.options.length <= 1) {
    try {
      let people = EMPLOYEE_LIST && EMPLOYEE_LIST.length ? EMPLOYEE_LIST : await callAPI('getEmployeeNames');
      people = (people || []).map(p => typeof p === 'string' ? { employee_id: p } : p);
      empSel.innerHTML = `<option value="">Me (${escapeHtml(CURRENT_USER.employeeId)})</option>` +
        people.filter(p => p.employee_id !== CURRENT_USER.employeeId)
          .map(p => `<option value="${escapeHtml(p.employee_id)}">${escapeHtml(p.name ? `${p.name} (${p.employee_id})` : p.employee_id)}</option>`).join('');
    } catch (e) { /* keep "Me" only */ }
  }
  calculateSalary();
}

function salaryTarget() {
  const sel = document.getElementById('salaryEmpId');
  return (isAdminUser() && sel && sel.value) ? sel.value : CURRENT_USER.employeeId;
}

async function saveSalaryConfig(btn) {
  const empId = salaryTarget();
  const monthStr = document.getElementById('salaryMonth').value;
  const amount = parseFloat(document.getElementById('salaryPerDay').value);
  if (!monthStr) return notify('Pick a month first.', 'error');
  if (isNaN(amount) || amount <= 0) return notify('Enter the per-day amount in rupees.', 'error');
  setBusy(btn, true);
  try {
    const r = await callAPI('saveSalaryConfig', { employeeId: empId, monthStr, amount });
    if (r && r.success === false) throw new Error(r.message);
    notify(`Per-day rate saved for ${empId}.`);
    calculateSalary();
  } catch (e) {
    notify('Could not save the rate.', 'error');
  } finally {
    setBusy(btn, false);
  }
}

// Calendar colours from the server are names like "green" / "red"; these
// labels are only used for the legend.
const PAY_COLOR_LABELS = {
  green: 'Present', red: 'Absent', yellow: 'Half day', orange: 'Late / short',
  blue: 'Leave', purple: 'Holiday', grey: 'Weekend / off', gray: 'Weekend / off', white: 'Upcoming'
};

async function calculateSalary() {
  if (!CURRENT_USER) return;
  const empId = salaryTarget();
  const monthStr = document.getElementById('salaryMonth').value;
  const grid = document.getElementById('salaryCalendar');
  const result = document.getElementById('salaryResult');
  if (!monthStr || !grid) return;
  if (result) result.classList.add('loading');
  try {
    const res = await callAPI('getSalaryDetails', { employeeId: empId, monthStr });
    document.getElementById('sal-totalDays').textContent = (res && res.total_days) || 0;
    document.getElementById('sal-payable').textContent = (res && res.payable_days) || 0;
    document.getElementById('sal-amount').textContent = rupees(res && res.calculated_payout);

    const [y, m] = monthStr.split('-').map(Number);
    const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
    const daily = (res && res.daily_colors) || [];
    const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="cal-head">${d}</div>`).join('');
    const pad = '<div class="cal-day cal-pad" aria-hidden="true"></div>'.repeat(firstDow);
    const todayStr = getLocalDateString();
    const cells = daily.map(item => {
      const day = typeof item.day === 'number' ? item.day : parseInt(String(item.day).slice(-2), 10);
      const color = String(item.color || 'white').toLowerCase();
      const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`;
      const label = item.status || item.label || PAY_COLOR_LABELS[color] || color;
      return `<div class="cal-day color-${escapeHtml(color)}${dateStr === todayStr ? ' is-today' : ''}" title="${escapeHtml(fmtDate(dateStr) + ': ' + label)}">${day}</div>`;
    }).join('');
    const noRate = !res || !Number(res.calculated_payout);
    grid.innerHTML = daily.length ? heads + pad + cells
      : `<div class="cal-empty">${emptyState('fa-calendar-xmark', 'No payroll for this month yet',
          isAdminUser() && noRate
            ? 'Save a per-day rate above, then the calendar and payout fill in from attendance.'
            : 'Days appear here once attendance is recorded for this month.')}</div>`;

    const legend = document.getElementById('salaryLegend');
    if (legend) {
      const seen = [...new Set(daily.map(i => String(i.color || '').toLowerCase()).filter(Boolean))];
      legend.innerHTML = seen.map(c => `<span class="legend-item"><span class="legend-dot color-${escapeHtml(c)}"></span>${escapeHtml(PAY_COLOR_LABELS[c] || c)}</span>`).join('');
    }
    const who = document.getElementById('salaryWho');
    if (who) who.textContent = empId === CURRENT_USER.employeeId ? 'Your payroll' : `Payroll for ${empId}`;
  } catch (e) {
    notify("Couldn't calculate payroll for that month.", 'error');
  } finally {
    if (result) result.classList.remove('loading');
  }
}

// --------------------------------------------------------------------------
// TRAINING
// --------------------------------------------------------------------------
let TRAINING_ITEMS = [];
let TRAINING_DEPT = 'all';
const trainingDoneKey = () => `STAFFLY_TRAINING_DONE_${CURRENT_USER ? CURRENT_USER.employeeId : ''}`;
function trainingDone() {
  try { return JSON.parse(localStorage.getItem(trainingDoneKey()) || '[]'); } catch (e) { return []; }
}

async function loadTrainingData() {
  const box = document.getElementById('trainingContainer');
  if (!box) return;
  box.innerHTML = listSkeleton(4);
  try {
    TRAINING_ITEMS = (await callAPI('getTrainingList')) || [];
    renderTrainingFilters();
    renderTraining();
  } catch (e) {
    box.innerHTML = emptyState('fa-triangle-exclamation', "Couldn't load training", 'Check your connection and try again.');
  }
}

function renderTrainingFilters() {
  const bar = document.getElementById('trainingFilters');
  if (!bar) return;
  const depts = [...new Set(TRAINING_ITEMS.map(i => i.department).filter(Boolean))];
  if (depts.length < 2) { bar.innerHTML = ''; return; }
  bar.innerHTML = ['all', ...depts].map(d =>
    `<button type="button" class="chip${d === TRAINING_DEPT ? ' on' : ''}" aria-pressed="${d === TRAINING_DEPT}" onclick="setTrainingDept(this.dataset.dept)" data-dept="${escapeHtml(d)}">${d === 'all' ? 'All' : escapeHtml(d)}</button>`
  ).join('');
}

function setTrainingDept(d) {
  TRAINING_DEPT = d;
  renderTrainingFilters();
  renderTraining();
}

function renderTraining() {
  const box = document.getElementById('trainingContainer');
  if (!box) return;
  const done = trainingDone();
  const items = TRAINING_ITEMS.filter(i => TRAINING_DEPT === 'all' || i.department === TRAINING_DEPT);

  const total = TRAINING_ITEMS.length;
  const completed = TRAINING_ITEMS.filter(i => done.includes(String(i.id))).length;
  const bar = document.getElementById('trainingProgress');
  if (bar) {
    bar.hidden = total === 0;
    bar.querySelector('.progress-fill').style.width = total ? `${Math.round(completed / total * 100)}%` : '0';
    bar.querySelector('.progress-text').textContent = `${completed} of ${total} completed`;
  }

  if (!items.length) {
    box.innerHTML = emptyState('fa-graduation-cap', 'No training modules yet',
      isAdminUser() ? 'Tap "Add module" to share a guide with the team.' : 'Your manager will add guides here.');
    return;
  }
  box.innerHTML = items.map(item => {
    const id = String(item.id);
    const isDone = done.includes(id);
    return `<article class="card training-card${isDone ? ' is-done' : ''}">
      <span class="pill pill-neutral">${escapeHtml(item.department || 'General')}</span>
      <h3 class="training-title">${escapeHtml(item.system_title || 'Untitled')}</h3>
      <p class="training-purpose">${escapeHtml(item.purpose || '')}</p>
      <div class="training-actions">
        <a class="btn btn-ghost" href="${escapeHtml(safeUrl(item.resource_link))}" target="_blank" rel="noopener noreferrer"><i class="fas fa-arrow-up-right-from-square" aria-hidden="true"></i> Open guide</a>
        <label class="check">
          <input type="checkbox" ${isDone ? 'checked' : ''} onchange="toggleTrainingDone('${escapeHtml(id)}', this.checked)">
          <span>Completed</span>
        </label>
      </div>
    </article>`;
  }).join('');
}

function toggleTrainingDone(id, checked) {
  const done = new Set(trainingDone());
  if (checked) done.add(id); else done.delete(id);
  try { localStorage.setItem(trainingDoneKey(), JSON.stringify([...done])); } catch (e) {}
  renderTraining();
}

async function handleSaveTraining(btn) {
  const dept = document.getElementById('trainDept').value.trim();
  const title = document.getElementById('trainSystem').value.trim();
  const purpose = document.getElementById('trainPurpose').value.trim();
  const link = document.getElementById('trainLink').value.trim();
  if (!dept || !title) return notify('Department and title are required.', 'error');
  if (!/^https?:\/\//i.test(link)) return notify('The link must start with https://', 'error');
  setBusy(btn, true);
  try {
    const r = await callAPI('addTraining', { dept, system: title, purpose, link });
    if (r && r.success === false) throw new Error(r.message);
    closeSheet('addTrainingModal');
    ['trainDept', 'trainSystem', 'trainPurpose', 'trainLink'].forEach(i => document.getElementById(i).value = '');
    notify('Training module added.');
    loadTrainingData();
  } catch (e) {
    notify('Could not add the module.', 'error');
  } finally {
    setBusy(btn, false);
  }
}

// --------------------------------------------------------------------------
// ANALYTICS
// --------------------------------------------------------------------------
let CHART_LIB_PROMISE = null;
function loadChartLib() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!CHART_LIB_PROMISE) {
    CHART_LIB_PROMISE = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
      s.onload = () => resolve(window.Chart);
      s.onerror = () => { CHART_LIB_PROMISE = null; reject(new Error('chart lib')); };
      document.head.appendChild(s);
    });
  }
  return CHART_LIB_PROMISE;
}

const BRAND_SERIES = ['#EE8478', '#47C6B0', '#7B6FA8', '#F0C660', '#2E2A5C', '#F5B8A8'];

async function loadDashboardData() {
  if (!CURRENT_USER) return;
  const date = getLocalDateString();
  const kpis = document.getElementById('dashboardMetrics');
  if (kpis) kpis.innerHTML = '<div class="kpi kpi-skeleton"></div>'.repeat(4);
  const admin = isAdminUser();
  const scope = document.getElementById('analyticsScope');
  if (scope) scope.textContent = admin ? 'Whole team, today' : 'Your attendance';

  try {
    const [metrics, charts] = await Promise.all([
      admin ? callAPI('getOverallMetrics', { date }) : callAPI('getDashboardMetrics', { employeeId: CURRENT_USER.employeeId, date }),
      admin ? callAPI('getOverallCharts', { date }) : callAPI('getDashboardCharts', { employeeId: CURRENT_USER.employeeId, date })
    ]);
    renderKpis(metrics);
    await renderDashboardCharts(charts);
  } catch (e) {
    if (kpis) kpis.innerHTML = emptyState('fa-triangle-exclamation', "Couldn't load analytics", 'Check your connection and try again.');
  }
}

function renderKpis(metrics) {
  const box = document.getElementById('dashboardMetrics');
  if (!box) return;
  const entries = metrics && typeof metrics === 'object'
    ? Object.entries(metrics).filter(([, v]) => v !== null && v !== '' && !isNaN(Number(v)))
    : [];
  if (!entries.length) {
    box.innerHTML = emptyState('fa-chart-simple', 'No numbers for today yet', 'Figures appear once people start punching in.');
    return;
  }
  box.innerHTML = entries.slice(0, 8).map(([k, v]) => {
    const isMoney = /amount|payout|salary|cost/i.test(k);
    const isHours = /hour/i.test(k);
    const val = isMoney ? rupees(v) : isHours ? `${Number(v).toFixed(1)} h` : Number(v).toLocaleString('en-IN');
    return `<div class="kpi"><span class="kpi-val">${escapeHtml(val)}</span><span class="kpi-lbl">${escapeHtml(humanize(k))}</span></div>`;
  }).join('');
}

async function renderDashboardCharts(charts) {
  const slots = [
    ['weekly', 'weeklyChart', 'bar'],
    ['status', 'statusChart', 'doughnut'],
    ['monthly', 'monthlyChart', 'line']
  ];
  const has = charts && slots.some(([k]) => charts[k] && charts[k].datasets);
  document.querySelectorAll('.chart-card').forEach(c => { c.hidden = !has; });
  const empty = document.getElementById('chartsEmpty');
  if (empty) empty.hidden = !!has;
  if (!has) return;

  let Chart;
  try { Chart = await loadChartLib(); } catch (e) { if (empty) { empty.hidden = false; } return; }
  Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
  Chart.defaults.color = '#6f6a8f';

  const store = { weekly: 'weeklyChartObj', status: 'statusChartObj', monthly: 'monthlyChartObj' };
  for (const [key, canvasId, type] of slots) {
    const canvas = document.getElementById(canvasId);
    const card = canvas && canvas.closest('.chart-card');
    const data = charts[key];
    if (!canvas || !data || !data.datasets) { if (card) card.hidden = true; continue; }
    // Brand colours unless the server already chose some.
    data.datasets.forEach((ds, i) => {
      if (type === 'doughnut') {
        ds.backgroundColor = ds.backgroundColor || BRAND_SERIES;
        ds.borderWidth = 0;
      } else {
        const c = BRAND_SERIES[i % BRAND_SERIES.length];
        ds.backgroundColor = ds.backgroundColor || (type === 'line' ? c + '33' : c);
        ds.borderColor = ds.borderColor || c;
        if (type === 'bar') { ds.borderRadius = ds.borderRadius ?? 8; ds.maxBarThickness = 38; }
        if (type === 'line') { ds.tension = ds.tension ?? 0.35; ds.fill = ds.fill ?? true; ds.pointRadius = 3; }
      }
    });
    const prev = { weeklyChartObj, statusChartObj, monthlyChartObj }[store[key]];
    if (prev) prev.destroy();
    const chart = new Chart(canvas, {
      type,
      data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 700 },
        plugins: { legend: { display: type === 'doughnut' || data.datasets.length > 1, position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } },
        scales: type === 'doughnut' ? {} : {
          x: { grid: { display: false } },
          y: { beginAtZero: true, grid: { color: 'rgba(46,42,92,0.06)' }, ticks: { precision: 0 } }
        },
        cutout: type === 'doughnut' ? '68%' : undefined
      }
    });
    if (key === 'weekly') weeklyChartObj = chart;
    if (key === 'status') statusChartObj = chart;
    if (key === 'monthly') monthlyChartObj = chart;
  }
}

// --------------------------------------------------------------------------
// LIVE MAP (admin)
// --------------------------------------------------------------------------
const LIVE_FRESH_MIN = 5, LIVE_RECENT_MIN = 30;

function pingFreshness(ts) {
  const t = Date.parse(ts);
  if (isNaN(t)) return 'stale';
  const min = (Date.now() - t) / 60000;
  return min <= LIVE_FRESH_MIN ? 'fresh' : min <= LIVE_RECENT_MIN ? 'recent' : 'stale';
}

async function initLiveMap() {
  const el = document.getElementById('liveMapContainer');
  if (!el || typeof L === 'undefined') return;
  if (!liveMapInstance) {
    liveMapInstance = L.map('liveMapContainer', { zoomControl: true }).setView([OFFICE_LAT, OFFICE_LNG], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(liveMapInstance);
    liveMapGeofenceCircle = L.circle([OFFICE_LAT, OFFICE_LNG], {
      radius: OFFICE_RADIUS_M, color: '#7B6FA8', weight: 1.5, dashArray: '6 6',
      fillColor: '#7B6FA8', fillOpacity: 0.08
    }).addTo(liveMapInstance);
    L.marker([OFFICE_LAT, OFFICE_LNG], {
      icon: L.divIcon({ className: 'hq-pin', html: '<i class="fas fa-building" aria-hidden="true"></i>', iconSize: [34, 34], iconAnchor: [17, 17] })
    }).addTo(liveMapInstance).bindPopup('<b>DDC Safdarjung HQ</b>');
  }
  // The container was hidden until now - let Leaflet measure it.
  setTimeout(() => liveMapInstance.invalidateSize(), 60);
  refreshLiveMapLocations();
  if (!liveMapInterval) liveMapInterval = setInterval(refreshLiveMapLocations, 15000);
}

async function refreshLiveMapLocations() {
  if (!liveMapInstance) return;
  const listEl = document.getElementById('liveMapList');
  try {
    const locations = (await callAPI('getLiveLocations')) || [];
    const seen = new Set();
    locations.forEach(loc => {
      if (loc.lat == null || loc.lng == null) return;
      const id = loc.employee_id;
      seen.add(id);
      const fresh = pingFreshness(loc.ping_time);
      const name = loc.name || id;
      const icon = L.divIcon({
        className: `staff-pin staff-${fresh}`,
        html: `<span>${escapeHtml(initials(name))}</span>`,
        iconSize: [34, 34], iconAnchor: [17, 17]
      });
      const popup = `<b>${escapeHtml(name)}</b><br>${escapeHtml(id)}<br>Last seen ${escapeHtml(relTime(loc.ping_time))}`;
      if (liveMapMarkers[id]) {
        liveMapMarkers[id].setLatLng([loc.lat, loc.lng]).setIcon(icon).setPopupContent(popup);
      } else {
        liveMapMarkers[id] = L.marker([loc.lat, loc.lng], { icon, title: name }).addTo(liveMapInstance).bindPopup(popup);
      }
    });
    // Drop people who are no longer reported.
    Object.keys(liveMapMarkers).forEach(id => {
      if (!seen.has(id)) { liveMapInstance.removeLayer(liveMapMarkers[id]); delete liveMapMarkers[id]; }
    });

    if (listEl) {
      const sorted = locations.filter(l => l.lat != null)
        .sort((a, b) => (Date.parse(b.ping_time) || 0) - (Date.parse(a.ping_time) || 0));
      listEl.innerHTML = sorted.length ? sorted.map(loc => {
        const fresh = pingFreshness(loc.ping_time);
        const dist = Math.round(calculateDistance(loc.lat, loc.lng, OFFICE_LAT, OFFICE_LNG));
        return `<button type="button" class="map-row" onclick="focusLiveMarker('${escapeHtml(loc.employee_id)}')">
          <span class="fresh-dot fresh-${fresh}" aria-hidden="true"></span>
          <span class="map-row-main">
            <span class="person-name">${escapeHtml(loc.name || loc.employee_id)}</span>
            <span class="person-meta">${escapeHtml(relTime(loc.ping_time))} &bull; ${dist < 1000 ? dist + ' m' : (dist / 1000).toFixed(1) + ' km'} from HQ</span>
          </span>
          <i class="fas fa-location-crosshairs" aria-hidden="true"></i>
        </button>`;
      }).join('') : emptyState('fa-map-location-dot', 'No one is sharing location right now', 'People appear here while they are punched in.');
    }
    const stamp = document.getElementById('liveMapUpdated');
    if (stamp) stamp.textContent = `Updated ${new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  } catch (e) {
    if (listEl && !listEl.children.length) listEl.innerHTML = emptyState('fa-triangle-exclamation', "Couldn't load locations", '');
  }
}

function focusLiveMarker(id) {
  const m = liveMapMarkers[id];
  if (!m || !liveMapInstance) return;
  liveMapInstance.flyTo(m.getLatLng(), 17, { duration: 0.6 });
  m.openPopup();
  const el = document.getElementById('liveMapContainer');
  if (el && window.innerWidth < 900) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fitAllLiveMarkers() {
  if (!liveMapInstance) return;
  const pts = Object.values(liveMapMarkers).map(m => m.getLatLng());
  pts.push(L.latLng(OFFICE_LAT, OFFICE_LNG));
  liveMapInstance.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 17 });
}

function stopLiveMapRefresh() {
  if (liveMapInterval) {
    clearInterval(liveMapInterval);
    liveMapInterval = null;
  }
}

// --------------------------------------------------------------------------
// TEAM ACCOUNTS (System Settings)
// --------------------------------------------------------------------------
async function loadUserManagement() {
  const box = document.getElementById('usersTableBody');
  if (!box) return;
  box.innerHTML = listSkeleton(4);
  try {
    const [users, dir] = await Promise.all([
      callAPI('getUsers'),
      EMPLOYEE_LIST && EMPLOYEE_LIST.length ? EMPLOYEE_LIST : callAPI('getEmployeesDirectory').catch(() => [])
    ]);
    const names = {};
    (dir || []).forEach(d => { if (d && d.employee_id && d.name) names[d.employee_id] = d.name; });
    window.USERS_CACHE = (users || []).map(u => ({
      ...u,
      name: u.name || (names[u.employee_id] && names[u.employee_id] !== u.employee_id ? names[u.employee_id] : '')
    }));
    renderUsers();
  } catch (e) {
    box.innerHTML = emptyState('fa-triangle-exclamation', "Couldn't load team accounts", '');
  }
}

function renderUsers() {
  const box = document.getElementById('usersTableBody');
  if (!box) return;
  const q = (document.getElementById('userSearch') || {}).value || '';
  const users = (window.USERS_CACHE || []).map((u, idx) => ({ u, idx }))
    .filter(({ u }) => !q || [u.employee_id, u.email, u.name, u.role].join(' ').toLowerCase().includes(q.toLowerCase()));
  const count = document.getElementById('userCount');
  if (count) count.textContent = `${(window.USERS_CACHE || []).length} accounts`;
  if (!users.length) {
    box.innerHTML = emptyState('fa-user-slash', q ? 'No accounts match your search' : 'No accounts yet', '');
    return;
  }
  box.innerHTML = users.map(({ u, idx }) => {
    const active = u.status === 'Active';
    return `<div class="person-row user-row${active ? '' : ' is-inactive'}">
      <div class="avatar">${escapeHtml(initials(u.name || u.employee_id))}</div>
      <div class="person-main">
        <div class="person-name">${escapeHtml(u.name || u.employee_id)} <span class="muted">${u.name ? escapeHtml(u.employee_id) : ''}</span></div>
        <div class="person-meta">${u.email ? escapeHtml(u.email) : '<span class="muted-soft">No email added</span>'}</div>
        <div class="pill-row"><span class="pill pill-role">${escapeHtml(u.role)}</span>${statusPill(u.status)}</div>
      </div>
      <div class="row-actions">
        <button type="button" class="icon-btn" aria-label="Edit ${escapeHtml(u.employee_id)}" title="Edit" onclick="openEditUserModal(window.USERS_CACHE[${idx}])"><i class="fas fa-pen" aria-hidden="true"></i></button>
        <button type="button" class="icon-btn ${active ? 'icon-btn-danger' : 'icon-btn-ok'}" aria-label="${active ? 'Deactivate' : 'Activate'} ${escapeHtml(u.employee_id)}" title="${active ? 'Deactivate' : 'Activate'}"
          onclick="toggleUserStatus(window.USERS_CACHE[${idx}].employee_id, window.USERS_CACHE[${idx}].status, this)"><i class="fas fa-power-off" aria-hidden="true"></i></button>
      </div>
    </div>`;
  }).join('');
}

function openAddUser() {
  ['newUserId', 'newUserEmail', 'newUserPass'].forEach(i => { const el = document.getElementById(i); if (el) el.value = ''; });
  const role = document.getElementById('newUserRole');
  if (role) role.value = 'Employee';
  openSheet('addUserModal');
}

async function handleAddUser(btn) {
  const id = document.getElementById('newUserId').value.trim().toUpperCase();
  const email = document.getElementById('newUserEmail').value.trim();
  const role = document.getElementById('newUserRole').value;
  const pass = document.getElementById('newUserPass').value;
  if (!/^[A-Za-z0-9_-]{2,20}$/.test(id)) return notify('Employee ID: 2-20 letters or numbers, no spaces.', 'error');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return notify('Enter a valid email address.', 'error');
  if (pass.length < 8) return notify('Password must be at least 8 characters.', 'error');
  setBusy(btn, true, 'Creating…');
  try {
    const r = await callAPI('addUser', { employeeId: id, email, role, password: pass });
    if (!r || r.success === false) return notify((r && r.message) || 'Could not create the account.', 'error');
    closeSheet('addUserModal');
    notify(`Account ${id} created. Share the password with them privately.`);
    loadUserManagement();
  } catch (e) {
    notify('Could not create the account.', 'error');
  } finally {
    setBusy(btn, false);
  }
}

function openEditUserModal(user) {
  if (!user) return;
  document.getElementById('editUserId').value = user.employee_id;
  document.getElementById('editUserIdLabel').textContent = user.name ? `${user.name} (${user.employee_id})` : user.employee_id;
  document.getElementById('editUserEmail').value = user.email || '';
  document.getElementById('editUserRole').value = user.role || 'Employee';
  document.getElementById('editUserStatus').value = user.status || 'Active';
  openSheet('editUserModal');
}

async function handleUpdateUser(btn) {
  const id = document.getElementById('editUserId').value;
  const email = document.getElementById('editUserEmail').value.trim();
  const role = document.getElementById('editUserRole').value;
  const status = document.getElementById('editUserStatus').value;
  setBusy(btn, true);
  try {
    const r = await callAPI('updateUser', { employeeId: id, email, role, status });
    if (!r || r.success === false) return notify((r && r.message) || 'Could not save changes.', 'error');
    closeSheet('editUserModal');
    notify(`Saved changes for ${id}.`);
    loadUserManagement();
  } catch (e) {
    notify('Could not save changes.', 'error');
  } finally {
    setBusy(btn, false);
  }
}

async function toggleUserStatus(employeeId, currentStatus, btn) {
  const next = currentStatus === 'Active' ? 'Inactive' : 'Active';
  if (next === 'Inactive' && !confirm(`Deactivate ${employeeId}?\n\nThey will be signed out everywhere and can't log in until reactivated.`)) return;
  if (btn) btn.disabled = true;
  try {
    const u = (window.USERS_CACHE || []).find(x => x.employee_id === employeeId) || {};
    const r = await callAPI('updateUser', { employeeId, email: u.email, role: u.role, status: next });
    if (!r || r.success === false) return notify((r && r.message) || 'Could not change the status.', 'error');
    notify(next === 'Active' ? `${employeeId} reactivated.` : `${employeeId} deactivated.`);
    loadUserManagement();
  } catch (e) {
    notify('Could not change the status.', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --------------------------------------------------------------------------
// NOTIFICATIONS  (bell + panel + "Staffly!" jingle)
// --------------------------------------------------------------------------
// Rows are created by database triggers (punch-in, leave applied, leave
// decided). The app polls every 25 s while the tab is visible. New items
// play the Staffly jingle unless muted.
const NOTIF_POLL_MS = 25000;
const NOTIF_SOUND_KEY = 'STAFFLY_NOTIF_SOUND';
const STAFFLY_SOUND_FILE = 'sounds/staffly.mp3'; // optional recorded voice clip
let NOTIF_ITEMS = [];
let NOTIF_LAST_ID = 0;
let NOTIF_UNREAD = 0;
let NOTIF_TIMER = null;
let NOTIF_STARTED = false;

const notifSoundOn = () => localStorage.getItem(NOTIF_SOUND_KEY) !== 'off';

async function startNotifications() {
  stopNotifications();
  NOTIF_ITEMS = []; NOTIF_LAST_ID = 0; NOTIF_UNREAD = 0;
  NOTIF_STARTED = true;
  updateSoundButton();
  await pollNotifications(true);
  NOTIF_TIMER = setInterval(() => { if (document.visibilityState === 'visible') pollNotifications(false); }, NOTIF_POLL_MS);
}

function stopNotifications() {
  if (NOTIF_TIMER) clearInterval(NOTIF_TIMER);
  NOTIF_TIMER = null;
  NOTIF_STARTED = false;
  NOTIF_ITEMS = []; NOTIF_LAST_ID = 0; NOTIF_UNREAD = 0;
  renderNotifBadge();
  toggleNotifPanel(false);
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && NOTIF_STARTED && CURRENT_USER) pollNotifications(false);
});

async function pollNotifications(initial) {
  if (!CURRENT_USER) return;
  try {
    const r = await callAPI('notifications', { afterId: initial ? 0 : NOTIF_LAST_ID, limit: initial ? 30 : 50 });
    if (!r) return;
    const fresh = r.items || [];
    NOTIF_UNREAD = Number(r.unread) || 0;
    if (fresh.length) {
      NOTIF_LAST_ID = Math.max(NOTIF_LAST_ID, ...fresh.map(i => Number(i.id)));
      const known = new Set(NOTIF_ITEMS.map(i => i.id));
      NOTIF_ITEMS = [...fresh.filter(i => !known.has(i.id)), ...NOTIF_ITEMS].slice(0, 60);
      if (!initial) {
        playStafflyJingle();
        const panelOpen = document.getElementById('notifPanel')?.classList.contains('open');
        if (!panelOpen) notify(`${fresh[0].title}${fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}`, 'info');
        // A new punch or leave may change what the open page shows.
        if (fresh.some(i => i.kind === 'leave_applied' || i.kind === 'leave_decided') &&
            document.getElementById('leaveView')?.classList.contains('active')) loadLeaveData();
      }
    }
    renderNotifBadge();
    renderNotifList();
  } catch (e) { /* polling is best-effort */ }
}

function renderNotifBadge() {
  document.querySelectorAll('.notif-badge').forEach(b => {
    b.hidden = NOTIF_UNREAD <= 0;
    b.textContent = NOTIF_UNREAD > 99 ? '99+' : String(NOTIF_UNREAD);
  });
  document.querySelectorAll('.notif-bell').forEach(btn => {
    btn.setAttribute('aria-label', NOTIF_UNREAD ? `Notifications, ${NOTIF_UNREAD} unread` : 'Notifications');
  });
}

const NOTIF_ICONS = {
  punch_in: ['fa-right-to-bracket', 'ni-mint'],
  punch_in_self: ['fa-circle-check', 'ni-mint'],
  leave_applied: ['fa-umbrella-beach', 'ni-coral'],
  leave_decided: ['fa-envelope-open-text', 'ni-purple']
};

function renderNotifList() {
  const box = document.getElementById('notifList');
  if (!box) return;
  if (!NOTIF_ITEMS.length) {
    box.innerHTML = emptyState('fa-bell-slash', "You're all caught up", 'Punch-ins and leave updates will show up here.');
    return;
  }
  box.innerHTML = NOTIF_ITEMS.map(n => {
    let [icon, tone] = NOTIF_ICONS[n.kind] || ['fa-bell', 'ni-purple'];
    if (n.kind === 'leave_decided') {
      const ok = /approved/i.test(n.title);
      icon = ok ? 'fa-circle-check' : 'fa-circle-xmark';
      tone = ok ? 'ni-mint' : 'ni-red';
    }
    if (n.kind === 'punch_in' && /late/i.test(n.body || '')) tone = 'ni-gold';
    return `<button type="button" class="notif-item${n.read ? '' : ' unread'}" onclick="openNotification(${Number(n.id)})">
      <span class="notif-icon ${tone}"><i class="fas ${icon}" aria-hidden="true"></i></span>
      <span class="notif-text">
        <span class="notif-title">${escapeHtml(n.title)}</span>
        ${n.body ? `<span class="notif-body">${escapeHtml(n.body)}</span>` : ''}
        <span class="notif-time">${escapeHtml(relTime(n.created_at))}</span>
      </span>
      ${n.read ? '' : '<span class="notif-dot" aria-label="Unread"></span>'}
    </button>`;
  }).join('');
}

function toggleNotifPanel(force) {
  const panel = document.getElementById('notifPanel');
  const backdrop = document.getElementById('notifBackdrop');
  if (!panel) return;
  const open = typeof force === 'boolean' ? force : !panel.classList.contains('open');
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (backdrop) backdrop.classList.toggle('open', open);
  if (open) {
    unlockNotifAudio();
    renderNotifList();
    setTimeout(() => { const first = panel.querySelector('.notif-item, .icon-btn'); if (first) first.focus(); }, 60);
  }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('notifPanel')?.classList.contains('open')) toggleNotifPanel(false);
});

async function openNotification(id) {
  const n = NOTIF_ITEMS.find(x => Number(x.id) === id);
  if (!n) return;
  if (!n.read) {
    n.read = true;
    NOTIF_UNREAD = Math.max(0, NOTIF_UNREAD - 1);
    renderNotifBadge();
    renderNotifList();
    callAPI('notificationsRead', { ids: [id] }).catch(() => {});
  }
  // Jump to the page the notification is about.
  const target = n.kind === 'leave_applied' || n.kind === 'leave_decided' ? 'leaveView'
    : n.kind === 'punch_in' && isAdminUser() ? 'directoryView' : null;
  if (target) {
    toggleNotifPanel(false);
    if (target === 'leaveView') LEAVE_TAB = n.kind === 'leave_applied' ? 'review' : 'mine';
    const link = document.querySelector(`.sidebar-nav .nav-item[data-view="${target}"]`);
    if (link) link.click();
  }
}

async function markAllNotificationsRead() {
  if (!NOTIF_UNREAD) return;
  NOTIF_ITEMS.forEach(n => { n.read = true; });
  NOTIF_UNREAD = 0;
  renderNotifBadge();
  renderNotifList();
  try { await callAPI('notificationsRead', {}); } catch (e) {}
}

function toggleNotifSound() {
  localStorage.setItem(NOTIF_SOUND_KEY, notifSoundOn() ? 'off' : 'on');
  updateSoundButton();
  if (notifSoundOn()) { unlockNotifAudio(); playStafflyJingle(); notify('Notification sound on.', 'info'); }
  else notify('Notification sound muted.', 'info');
}

function updateSoundButton() {
  const b = document.getElementById('notifSoundBtn');
  if (!b) return;
  const on = notifSoundOn();
  b.innerHTML = `<i class="fas ${on ? 'fa-volume-high' : 'fa-volume-xmark'}" aria-hidden="true"></i>`;
  b.setAttribute('aria-label', on ? 'Mute notification sound' : 'Turn notification sound on');
  b.title = on ? 'Sound on' : 'Muted';
}

// ---- The "Staffly!" jingle ------------------------------------------------
// An original sparkly rising chime (Web Audio, no files), followed by a
// bright voice saying "Staffly!" (the phone's built-in speech voice, tuned
// high and cheerful). If sounds/staffly.mp3 exists - e.g. a recorded voice
// clip - that plays instead.
let NOTIF_AUDIO_CTX = null;
let STAFFLY_CLIP = undefined; // undefined = not checked, null = none, Audio = use it

function unlockNotifAudio() {
  try {
    if (!NOTIF_AUDIO_CTX) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) NOTIF_AUDIO_CTX = new AC();
    }
    if (NOTIF_AUDIO_CTX && NOTIF_AUDIO_CTX.state === 'suspended') NOTIF_AUDIO_CTX.resume();
  } catch (e) {}
  if (STAFFLY_CLIP === undefined && typeof fetch === 'function') {
    STAFFLY_CLIP = null;
    fetch(STAFFLY_SOUND_FILE, { method: 'HEAD' })
      .then(r => { if (r.ok) { STAFFLY_CLIP = new Audio(STAFFLY_SOUND_FILE); STAFFLY_CLIP.preload = 'auto'; } })
      .catch(() => {});
  }
}
// Browsers only allow sound after the user has touched the page once.
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlockNotifAudio, { once: true, passive: true }));

function playStafflyJingle() {
  if (!notifSoundOn()) return;
  try { if (navigator.vibrate) navigator.vibrate([40, 40, 60]); } catch (e) {}
  if (STAFFLY_CLIP) {
    STAFFLY_CLIP.currentTime = 0;
    STAFFLY_CLIP.play().catch(() => {});
    return;
  }
  const ctx = NOTIF_AUDIO_CTX;
  if (ctx && ctx.state === 'running') {
    const t0 = ctx.currentTime + 0.02;
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    // Bright rising arpeggio (E6 G#6 B6 E7) + a soft shimmer on top.
    [[1318.5, 0], [1661.2, 0.075], [1975.5, 0.15], [2637.0, 0.24]].forEach(([f, dt], i) => {
      ['sine', 'triangle'].forEach((type, k) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = f * (k ? 2 : 1);
        const start = t0 + dt, peak = k ? 0.12 : 0.9, len = i === 3 ? 0.55 : 0.22;
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, start + len);
        o.connect(g); g.connect(master);
        o.start(start); o.stop(start + len + 0.05);
      });
    });
  }
  setTimeout(sayStaffly, 380);
}

function sayStaffly() {
  if (!('speechSynthesis' in window)) return;
  try {
    const u = new SpeechSynthesisUtterance('Staffly!');
    const voices = speechSynthesis.getVoices();
    const female = /female|zira|samantha|susan|karen|moira|tessa|veena|heera|aria|jenny|google uk english female|google us english/i;
    u.voice = voices.find(v => /^en/i.test(v.lang) && female.test(v.name))
      || voices.find(v => /^en/i.test(v.lang)) || null;
    u.lang = (u.voice && u.voice.lang) || 'en-US';
    u.pitch = 1.8;   // bright, playful
    u.rate = 1.05;
    u.volume = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {}
}
// Chrome loads voices asynchronously.
if ('speechSynthesis' in window) { try { speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices(); } catch (e) {} }
