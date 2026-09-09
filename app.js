// ==========================================================================
// DDC SUPPLY CHAIN & DISTRIBUTION LLP - WORKFORCE ATTENDANCE APP.JS
// ==========================================================================

const SUPABASE_URL = "https://bpwpxhsdmbkymhpjsfej.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwd3B4aHNkbWJreW1ocGpzZmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDUzNzIsImV4cCI6MjEwNDUyMTM3Mn0.XnXF9kqp0g6xQwZpjPC6tUhLGNI1T29i02DQGjNYG2M";
const sbClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// DDC Safdarjung HQ Geofence Coordinates
const OFFICE_LAT = 28.5633;
const OFFICE_LNG = 77.1912;
const OFFICE_RADIUS_M = 150; // 150-meter coverage radius

// Global Application State
let CURRENT_USER = null;
let ATTENDANCE_SELFIE_BASE64 = null;
let locationPingTimer = null;
let liveMapInstance = null;
let liveMapMarkers = {};
let liveMapInterval = null;
let dirFilterState = "all";
let weeklyChartObj = null, statusChartObj = null, monthlyChartObj = null;

// Utility: Date String Formatter (YYYY-MM-DD)
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ==========================================================================
// SUPABASE RPC / API CALL WRAPPER
// ==========================================================================
async function callAPI(action, payload = {}) {
  if (!sbClient) {
    console.error("Supabase client is not initialized.");
    return null;
  }
  try {
    switch (action) {
      case "login": {
        const { data, error } = await sbClient.rpc('login', {
          p_employee_id: payload.employeeId,
          p_password: payload.password
        });
        if (error) throw error;
        return data;
      }
      case "clockIn": {
        const { data, error } = await sbClient.rpc('clock_in', {
          p_employee_id: payload.employeeId,
          p_lat: payload.gps.lat,
          p_lng: payload.gps.lng
        });
        if (error) throw error;
        if (payload.gps.selfieBase64) {
          await uploadSelfie(payload.employeeId, payload.gps.selfieBase64);
        }
        return data;
      }
      case "clockOut": {
        const { data, error } = await sbClient.rpc('clock_out', {
          p_employee_id: payload.employeeId,
          p_lat: payload.gps.lat,
          p_lng: payload.gps.lng
        });
        if (error) throw error;
        return data;
      }
      case "pingLocation": {
        const { data, error } = await sbClient.rpc('ping_location', {
          p_employee_id: payload.employeeId,
          p_lat: payload.lat,
          p_lng: payload.lng
        });
        if (error) throw error;
        return data;
      }
      case "applyLeave": {
        const { data, error } = await sbClient.rpc('apply_leave', {
          p_employee_id: payload.employeeId,
          p_from_date: payload.fromDate,
          p_to_date: payload.toDate,
          p_leave_type: payload.leaveType,
          p_reason: payload.reason,
          p_doc_pending: payload.docPending || false
        });
        if (error) throw error;
        return data;
      }
      case "attachLeaveDocument": {
        const { data, error } = await sbClient.rpc('attach_leave_document', {
          p_employee_id: payload.employeeId,
          p_doc_path: payload.docPath
        });
        if (error) throw error;
        return data;
      }
      case "getEmployeeLeaves": {
        const { data, error } = await sbClient.rpc('get_employee_leaves', {
          p_employee_id: payload.employeeId
        });
        if (error) throw error;
        return data;
      }
      case "getAllPendingLeaves": {
        const { data, error } = await sbClient.rpc('get_all_pending_leaves');
        if (error) throw error;
        return data;
      }
      case "updateLeaveStatus": {
        const { data, error } = await sbClient.rpc('update_leave_status', {
          p_leave_id: payload.leaveId,
          p_status: payload.status,
          p_hr_comment: payload.hrComment
        });
        if (error) throw error;
        return data;
      }
      case "saveSalaryConfig": {
        const { data, error } = await sbClient.rpc('save_salary_config', {
          p_employee_id: payload.employeeId,
          p_month_str: payload.monthStr,
          p_amount: payload.amount
        });
        if (error) throw error;
        return data;
      }
      case "getSalaryDetails": {
        const { data, error } = await sbClient.rpc('get_salary_details', {
          p_employee_id: payload.employeeId,
          p_month_str: payload.monthStr
        });
        if (error) throw error;
        return data;
      }
      case "getEmployeesDirectory": {
        const { data, error } = await sbClient.rpc('get_employees_directory');
        if (error) throw error;
        return data;
      }
      case "getTrainingList": {
        const { data, error } = await sbClient.rpc('get_training_list');
        if (error) throw error;
        return data;
      }
      case "addTraining": {
        const { data, error } = await sbClient.rpc('add_training', {
          p_dept: payload.dept,
          p_system: payload.system,
          p_purpose: payload.purpose,
          p_link: payload.link
        });
        if (error) throw error;
        return data;
      }
      case "getLiveLocations": {
        const { data, error } = await sbClient.rpc('get_live_locations');
        if (error) throw error;
        return data;
      }
      case "addUser": {
        const { data, error } = await sbClient.rpc('add_user', {
          p_employee_id: payload.employeeId,
          p_email: payload.email,
          p_role: payload.role,
          p_password: payload.password
        });
        if (error) throw error;
        return data;
      }
      case "getUsers": {
        const { data, error } = await sbClient.rpc('get_users');
        if (error) throw error;
        return data;
      }
      case "getDashboardMetrics": {
        const { data, error } = await sbClient.rpc('get_dashboard_metrics', {
          p_employee_id: payload.employeeId,
          p_date: payload.date
        });
        if (error) throw error;
        return data;
      }
      case "getDashboardCharts": {
        const { data, error } = await sbClient.rpc('get_dashboard_charts', {
          p_employee_id: payload.employeeId,
          p_date: payload.date
        });
        if (error) throw error;
        return data;
      }
      case "getOverallMetrics": {
        const { data, error } = await sbClient.rpc('get_overall_metrics', {
          p_date: payload.date
        });
        if (error) throw error;
        return data;
      }
      case "getOverallCharts": {
        const { data, error } = await sbClient.rpc('get_overall_charts', {
          p_date: payload.date
        });
        if (error) throw error;
        return data;
      }
      case "getAuditLogs": {
        const { data, error } = await sbClient.rpc('get_audit_logs');
        if (error) throw error;
        return data;
      }
      case "getEmployeeNames": {
        const { data, error } = await sbClient.rpc('get_employee_names');
        if (error) throw error;
        return data;
      }
      default:
        console.warn("Unknown RPC action:", action);
        return null;
    }
  } catch (err) {
    console.error(`Error executing RPC action [${action}]:`, err);
    throw err;
  }
}

// ==========================================================================
// SELFIE UPLOAD HELPER (SUPABASE STORAGE)
// ==========================================================================
function base64ToBlob(base64, mimeType = 'image/webp') {
  const byteCharacters = atob(base64.split(',')[1] || base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

async function uploadSelfie(employeeId, base64) {
  try {
    const blob = base64ToBlob(base64);
    const dateStr = getLocalDateString();
    const filePath = `selfies/${employeeId}_${dateStr}.webp`;
    const { error } = await sbClient.storage
      .from('attendance-media')
      .upload(filePath, blob, { upsert: true, contentType: 'image/webp' });
    if (error) console.error("Selfie upload error:", error);
  } catch (e) {
    console.error("Upload failed:", e);
  }
}

// ==========================================================================
// AUTHENTICATION & LOGIN HANDLERS
// ==========================================================================
async function handleLogin() {
  const empIdInput = document.getElementById('loginEmpId');
  const passwordInput = document.getElementById('loginPassword');
  const errorDiv = document.getElementById('loginError');

  if (errorDiv) errorDiv.style.display = 'none';

  if (!empIdInput || !passwordInput) {
    console.error("Login input elements not found in DOM.");
    return;
  }

  const inputVal = empIdInput.value.trim();
  const password = passwordInput.value.trim();

  if (!inputVal || !password) {
    if (errorDiv) {
      errorDiv.textContent = 'Please enter both Employee ID/Name and Password.';
      errorDiv.style.display = 'block';
    }
    return;
  }

  try {
    const { data, error } = await sbClient.rpc('login', {
      p_employee_id: inputVal,
      p_password: password
    });

    if (error || !data || data.length === 0) {
      if (errorDiv) {
        errorDiv.textContent = 'Invalid Employee ID/Email or Password';
        errorDiv.style.display = 'block';
      }
      return;
    }

    const user = data[0];
    window.CURRENT_USER = user;
    localStorage.setItem('currentUser', JSON.stringify(user));

    // Hide Login, Show Main App Layout
    document.getElementById('loginView').style.display = 'none';
    document.getElementById('appLayout').style.display = 'flex';

    // Populate Sidebar Details
    const nameDisplay = document.getElementById('userNameDisplay');
    const roleBadge = document.getElementById('userRoleBadge');
    const userAvatar = document.getElementById('userAvatar');

    if (nameDisplay) nameDisplay.textContent = user.name || user.employee_id;
    if (roleBadge) roleBadge.textContent = user.role || 'Employee';
    if (userAvatar) userAvatar.textContent = (user.name || user.employee_id).charAt(0).toUpperCase();

  } catch (err) {
    console.error("Login error:", err);
    if (errorDiv) {
      errorDiv.textContent = 'Login failed. Connection error.';
      errorDiv.style.display = 'block';
    }
  }
}

// Attach event listener once DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.addEventListener('click', handleLogin);
  }
});

function handleLogout() {
  CURRENT_USER = null;
  stopLocationPinging();
  location.reload();
}

// ==========================================================================
// CLOCK IN / OUT HANDLERS WITH VISUAL ANIMATION
// ==========================================================================
async function handleClockIn() {
  const id = CURRENT_USER ? CURRENT_USER.employeeId : "";
  if (!id) return;

  if (!ATTENDANCE_SELFIE_BASE64) {
    alert("Please capture verification selfie first.");
    return;
  }

  const btn = document.getElementById('homeClockBtn');
  let btnLabel = document.getElementById('homeClockBtnLabel');
  if (!btnLabel) {
    btn.innerHTML = '<i class="fas fa-sign-in-alt me-2"></i><span id="homeClockBtnLabel">Punch In Now</span>';
    btnLabel = document.getElementById('homeClockBtnLabel');
  }

  // UI Loading State
  btn.classList.add('loading');
  btnLabel.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Verifying...';

  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
    );

    const res = await callAPI("clockIn", {
      employeeId: id,
      gps: { lat: pos.coords.latitude, lng: pos.coords.longitude, selfieBase64: ATTENDANCE_SELFIE_BASE64 }
    });

    if (res && res[0] && res[0][0] === 'SUCCESS') {
      ATTENDANCE_SELFIE_BASE64 = null;
      startLocationPinging(id);

      // Hide preview thumbnail
      const selfiePreview = document.getElementById('selfiePreview');
      if (selfiePreview) selfiePreview.style.display = 'none';

      // Show Full-Screen Overlay Animation
      showPunchSuccess(`Distance from HQ: ${Math.round(res[0][1])} meters`);
      updateHomeUI(true);
    } else {
      alert((res && res[0] && res[0][0]) || "Error clocking in.");
    }
  } catch (e) {
    alert("Location permission required to clock in.");
  } finally {
    btn.classList.remove('loading');
    btnLabel.innerHTML = 'Punch In Now';
  }
}

async function handleClockOut() {
  const id = CURRENT_USER ? CURRENT_USER.employeeId : "";
  if (!id) return;

  const btn = document.getElementById('homeClockBtn');
  let btnLabel = document.getElementById('homeClockBtnLabel');

  btn.classList.add('loading');
  if (btnLabel) btnLabel.innerHTML = '<span class="spinner-border spinner-border-sm" role="status"></span> Clocking Out...';

  try {
    const pos = await new Promise((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
    );

    const res = await callAPI("clockOut", {
      employeeId: id,
      gps: { lat: pos.coords.latitude, lng: pos.coords.longitude }
    });

    if (res && res[0] && res[0][0] === 'SUCCESS') {
      stopLocationPinging();
      showPunchSuccess(`Clocked Out Successfully! Hours: ${res[0][2]}`);
      updateHomeUI(false);
    } else {
      alert((res && res[0] && res[0][0]) || "Error clocking out.");
    }
  } catch (e) {
    alert("Location permission required to clock out.");
  } finally {
    btn.classList.remove('loading');
  }
}

// Full-screen overlay animation helper
function showPunchSuccess(distanceText) {
  let overlay = document.getElementById('punchSuccessOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'punchSuccessOverlay';
    overlay.className = 'punch-success-overlay';
    overlay.innerHTML = `
        <div class="success-checkmark">
            <i class="fas fa-check"></i>
        </div>
        <div id="punchSuccessText" class="success-text">Clocked In Successfully!</div>
        <div id="punchSuccessSubtext" class="text-secondary mt-2 small"></div>
    `;
    document.body.appendChild(overlay);
  }

  const subtext = document.getElementById('punchSuccessSubtext');
  if (subtext) subtext.innerText = distanceText;

  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 2500);
}

// ==========================================================================
// LOCATION TRACKING & GEOFENCING
// ==========================================================================
function startLocationPinging(employeeId) {
  stopLocationPinging();
  locationPingTimer = setInterval(async () => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          await callAPI("pingLocation", {
            employeeId: employeeId,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
        } catch (e) { console.error("Ping failed:", e); }
      });
    }
  }, 300000); // 5-minute pings
}

function stopLocationPinging() {
  if (locationPingTimer) {
    clearInterval(locationPingTimer);
    locationPingTimer = null;
  }
}

function checkGeofenceProximity() {
  const zoneRadar = document.getElementById('zoneRadar');
  const zoneStatusText = document.getElementById('zoneStatusText');
  const zoneDistanceText = document.getElementById('zoneDistanceText');

  if (!navigator.geolocation) {
    if (zoneStatusText) zoneStatusText.innerText = "GPS Not Supported";
    return;
  }

  navigator.geolocation.watchPosition((pos) => {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;

    const R = 6371e3; // meters
    const φ1 = lat * Math.PI / 180;
    const φ2 = OFFICE_LAT * Math.PI / 180;
    const Δφ = (OFFICE_LAT - lat) * Math.PI / 180;
    const Δλ = (OFFICE_LNG - lng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const dist = Math.round(R * c);

    if (zoneDistanceText) zoneDistanceText.innerText = `${dist}m from DDC Safdarjung HQ`;

    if (dist <= OFFICE_RADIUS_M) {
      if (zoneRadar) zoneRadar.className = 'zone-radar inside';
      if (zoneStatusText) zoneStatusText.innerText = "Inside Safdarjung Hub";
    } else {
      if (zoneRadar) zoneRadar.className = 'zone-radar outside';
      if (zoneStatusText) zoneStatusText.innerText = "Outside Geofence";
    }
  }, () => {
    if (zoneStatusText) zoneStatusText.innerText = "Location Access Denied";
  }, { enableHighAccuracy: true });
}

function previewFakePhoto(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function (e) {
      ATTENDANCE_SELFIE_BASE64 = e.target.result;
      const previewBox = document.getElementById('selfiePreview');
      const previewImg = previewBox ? previewBox.querySelector('img') : null;
      if (previewImg) previewImg.src = e.target.result;
      if (previewBox) previewBox.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// ==========================================================================
// NAVIGATION & MODULE SWITCHER
// ==========================================================================
function switchSection(sectionId, el) {
  document.querySelectorAll('.spa-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(sectionId + 'Section');
  if (target) target.classList.add('active');

  document.querySelectorAll('.sidebar-menu a, .bottom-nav-item').forEach(a => a.classList.remove('active'));
  if (el) el.classList.add('active');

  if (sectionId === 'dashboard') loadDashboardData();
  if (sectionId === 'employee') loadDirectory();
  if (sectionId === 'leave') loadLeaveData();
  if (sectionId === 'salary') loadSalaryData();
  if (sectionId === 'training') loadTrainingData();
  if (sectionId === 'liveMap') initLiveMap();
  if (sectionId === 'users') loadUserManagement();
}

function updateHomeUI(isClockedIn) {
  const btn = document.getElementById('homeClockBtn');
  const btnLabel = document.getElementById('homeClockBtnLabel');
  const timerChip = document.getElementById('timerChip');

  if (isClockedIn) {
    if (btn) btn.onclick = handleClockOut;
    if (btnLabel) btnLabel.innerText = "Punch Out Now";
    if (btn) btn.className = "btn btn-danger btn-lg px-5";
    if (timerChip) timerChip.style.display = 'inline-block';
  } else {
    if (btn) btn.onclick = handleClockIn;
    if (btnLabel) btnLabel.innerText = "Punch In Now";
    if (btn) btn.className = "btn btn-staffly-signin btn-lg px-5";
    if (timerChip) timerChip.style.display = 'none';
  }
}

// ==========================================================================
// DIRECTORY MODULE
// ==========================================================================
async function loadDirectory() {
  const container = document.getElementById('directory-container');
  if (!container) return;

  try {
    const list = await callAPI("getEmployeesDirectory");
    container.innerHTML = "";
    if (!list || list.length === 0) {
      container.innerHTML = `<div class="text-secondary small p-3 text-center">No active employees found.</div>`;
      return;
    }

    list.forEach(emp => {
      const statusClass = emp.today_status === 'Present' ? 'text-success' : 'text-danger';
      const card = document.createElement('div');
      card.className = "glass-card p-3 d-flex align-items-center justify-content-between dir-item";
      card.dataset.status = emp.today_status ? emp.today_status.toLowerCase() : 'absent';
      card.dataset.name = (emp.name || '').toLowerCase();
      card.dataset.id = (emp.employee_id || '').toLowerCase();

      card.innerHTML = `
        <div class="d-flex align-items-center gap-3">
            <div class="rounded-circle bg-accent text-white fw-bold d-flex align-items-center justify-content-center" style="width:40px; height:40px;">
                ${(emp.name || 'U').charAt(0)}
            </div>
            <div>
                <div class="fw-bold text-white">${emp.name || emp.employee_id}</div>
                <div class="text-secondary small">${emp.role} • ID: ${emp.employee_id}</div>
            </div>
        </div>
        <div>
            <span class="badge bg-dark ${statusClass}">${emp.today_status || 'Absent'}</span>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (e) { console.error(e); }
}

function filterDirectory() {
  const search = document.getElementById('dirSearchInput').value.toLowerCase();
  document.querySelectorAll('.dir-item').forEach(item => {
    const name = item.dataset.name;
    const id = item.dataset.id;
    const status = item.dataset.status;

    const matchesSearch = name.includes(search) || id.includes(search);
    const matchesFilter = dirFilterState === 'all' || status === dirFilterState;

    item.style.display = (matchesSearch && matchesFilter) ? 'flex' : 'none';
  });
}

function setDirFilter(filter, btn) {
  dirFilterState = filter;
  document.querySelectorAll('#dirFilterChips .chip').forEach(c => c.classList.remove('on'));
  if (btn) btn.classList.add('on');
  filterDirectory();
}

// ==========================================================================
// LEAVE PORTAL MODULE
// ==========================================================================
async function loadLeaveData() {
  if (!CURRENT_USER) return;
  try {
    const myLeaves = await callAPI("getEmployeeLeaves", { employeeId: CURRENT_USER.employeeId });
    renderLeaveList(myLeaves, 'leaveHistoryList');

    if (['Admin', 'HR', 'Dev'].includes(CURRENT_USER.role)) {
      const pendingLeaves = await callAPI("getAllPendingLeaves");
      renderLeaveList(pendingLeaves, 'leaveReviewList', true);
    }
  } catch (e) { console.error(e); }
}

function renderLeaveList(list, containerId, isReview = false) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  if (!list || list.length === 0) {
    container.innerHTML = `<div class="text-secondary small p-3 text-center">No leave requests.</div>`;
    return;
  }

  list.forEach(item => {
    const div = document.createElement('div');
    div.className = "glass-card p-3";
    div.innerHTML = `
      <div class="d-flex justify-content-between align-items-center mb-1">
        <span class="fw-bold text-white">${item.leave_type}</span>
        <span class="badge bg-${item.status === 'Approved' ? 'success' : item.status === 'Rejected' ? 'danger' : 'warning'}">${item.status}</span>
      </div>
      <div class="small text-secondary mb-2">${item.from_date} to ${item.to_date} (${item.employee_id})</div>
      <div class="small text-light">${item.reason || 'No reason provided'}</div>
      ${isReview && item.status === 'Pending' ? `
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-sm btn-success w-50" onclick="processLeave(${item.id}, 'Approved')">Approve</button>
          <button class="btn btn-sm btn-danger w-50" onclick="processLeave(${item.id}, 'Rejected')">Reject</button>
        </div>
      ` : ''}
    `;
    container.appendChild(div);
  });
}

async function handleApplyLeave() {
  const type = document.getElementById('leaveType').value;
  const from = document.getElementById('fromDate').value;
  const to = document.getElementById('toDate').value;
  const reason = document.getElementById('leaveReason').value;

  try {
    await callAPI("applyLeave", {
      employeeId: CURRENT_USER.employeeId,
      leaveType: type,
      fromDate: from,
      toDate: to,
      reason: reason
    });
    alert("Leave request submitted successfully.");
    bootstrap.Modal.getInstance(document.getElementById('applyLeaveModal')).hide();
    loadLeaveData();
  } catch (e) { alert("Failed to submit leave request."); }
}

async function processLeave(leaveId, status) {
  try {
    await callAPI("updateLeaveStatus", { leaveId: leaveId, status: status, hrComment: "Processed" });
    loadLeaveData();
  } catch (e) { alert("Error updating leave."); }
}

function switchLeaveView(view, btn) {
  document.querySelectorAll('#hr-review-tabs .nav-link').forEach(l => l.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('leaveHistoryList').style.display = view === 'mine' ? 'flex' : 'none';
  document.getElementById('leaveReviewList').style.display = view === 'review' ? 'flex' : 'none';
}

// ==========================================================================
// SALARY & PAYROLL MODULE
// ==========================================================================
async function loadSalaryData() {
  const monthInput = document.getElementById('salaryMonth');
  if (monthInput && !monthInput.value) {
    const d = new Date();
    monthInput.value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
}

async function saveSalaryConfig() {
  const empId = document.getElementById('salaryEmpId').value || CURRENT_USER.employeeId;
  const monthStr = document.getElementById('salaryMonth').value;
  const amount = parseFloat(document.getElementById('salaryPerDay').value);

  if (!empId || !monthStr || isNaN(amount)) {
    alert("Please enter Employee ID, Month, and Base Amount.");
    return;
  }

  try {
    await callAPI("saveSalaryConfig", { employeeId: empId, monthStr: monthStr, amount: amount });
    document.getElementById('salaryMsg').innerHTML = `<span class="text-success">Salary saved successfully!</span>`;
  } catch (e) { alert("Failed to save salary config."); }
}

async function calculateSalary() {
  const empId = document.getElementById('salaryEmpId').value || CURRENT_USER.employeeId;
  const monthStr = document.getElementById('salaryMonth').value;

  try {
    const res = await callAPI("getSalaryDetails", { employeeId: empId, monthStr: monthStr });
    if (res) {
      document.getElementById('sal-totalDays').innerText = res.total_days || 0;
      document.getElementById('sal-payable').innerText = res.payable_days || 0;
      document.getElementById('sal-amount').innerText = `₹${res.calculated_payout || 0}`;

      // Calendar grid render
      const grid = document.getElementById('salaryCalendar');
      grid.innerHTML = "";
      if (res.daily_colors) {
        res.daily_colors.forEach(item => {
          const dayBox = document.createElement('div');
          dayBox.className = `calendar-day color-${item.color}`;
          dayBox.innerText = item.day;
          grid.appendChild(dayBox);
        });
      }
    }
  } catch (e) { alert("Error calculating salary."); }
}

// ==========================================================================
// TRAINING & LIVE MAP MODULES
// ==========================================================================
async function loadTrainingData() {
  const container = document.getElementById('trainingContainer');
  if (!container) return;

  try {
    const list = await callAPI("getTrainingList");
    container.innerHTML = "";
    if (!list || list.length === 0) {
      container.innerHTML = `<div class="text-secondary small p-3 text-center">No training resources found.</div>`;
      return;
    }

    list.forEach(item => {
      const col = document.createElement('div');
      col.className = "col-md-6";
      col.innerHTML = `
        <div class="glass-card p-3">
          <span class="badge bg-accent mb-2">${item.department}</span>
          <h6 class="text-white mb-1">${item.system_title}</h6>
          <p class="small text-secondary mb-3">${item.purpose}</p>
          <a href="${item.resource_link}" target="_blank" class="btn btn-sm btn-outline-light"><i class="fas fa-external-link-alt me-1"></i>Open Resource</a>
        </div>
      `;
      container.appendChild(col);
    });
  } catch (e) { console.error(e); }
}

async function handleSaveTraining() {
  const dept = document.getElementById('trainDept').value;
  const title = document.getElementById('trainSystem').value;
  const purpose = document.getElementById('trainPurpose').value;
  const link = document.getElementById('trainLink').value;

  try {
    await callAPI("addTraining", { dept: dept, system: title, purpose: purpose, link: link });
    alert("Training resource added.");
    bootstrap.Modal.getInstance(document.getElementById('addTrainingModal')).hide();
    loadTrainingData();
  } catch (e) { alert("Failed to add resource."); }
}

async function initLiveMap() {
  const mapContainer = document.getElementById('liveMapContainer');
  if (!mapContainer) return;

  document.getElementById('liveMapViewer').style.display = 'block';

  if (!liveMapInstance) {
    liveMapInstance = L.map('liveMapContainer').setView([OFFICE_LAT, OFFICE_LNG], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(liveMapInstance);
  }

  refreshLiveMapLocations();
  if (!liveMapInterval) liveMapInterval = setInterval(refreshLiveMapLocations, 15000);
}

async function refreshLiveMapLocations() {
  try {
    const locations = await callAPI("getLiveLocations");
    if (!locations) return;

    locations.forEach(loc => {
      if (liveMapMarkers[loc.employee_id]) {
        liveMapMarkers[loc.employee_id].setLatLng([loc.lat, loc.lng]);
      } else {
        const marker = L.marker([loc.lat, loc.lng]).addTo(liveMapInstance)
          .bindPopup(`<b>${loc.name || loc.employee_id}</b><br>Last ping: ${loc.ping_time}`);
        liveMapMarkers[loc.employee_id] = marker;
      }
    });
  } catch (e) { console.error(e); }
}

function stopLiveMapRefresh() {
  if (liveMapInterval) {
    clearInterval(liveMapInterval);
    liveMapInterval = null;
  }
  document.getElementById('liveMapViewer').style.display = 'none';
}

// ==========================================================================
// USER MANAGEMENT MODULE
// ==========================================================================
async function loadUserManagement() {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;

  try {
    const users = await callAPI("getUsers");
    tbody.innerHTML = "";
    if (!users) return;

    users.forEach(u => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${u.employee_id}</td>
        <td>${u.email}</td>
        <td><span class="badge bg-secondary">${u.role}</span></td>
        <td><span class="badge bg-success">${u.status}</span></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) { console.error(e); }
}

async function handleAddUser() {
  const id = document.getElementById('newUserId').value;
  const email = document.getElementById('newUserEmail').value;
  const role = document.getElementById('newUserRole').value;
  const pass = document.getElementById('newUserPass').value;

  try {
    await callAPI("addUser", { employeeId: id, email: email, role: role, password: pass });
    alert("User account created.");
    loadUserManagement();
  } catch (e) { alert("Failed to create user."); }
}

// ==========================================================================
// SHERL AI SUPPORT CHAT
// ==========================================================================
function toggleSherlChat() {
  const box = document.getElementById('sherl-chat-box');
  if (box) box.style.display = box.style.display === 'none' ? 'flex' : 'none';
}

function handleSherlEnter(e) {
  if (e.key === 'Enter') sendSherlMessage();
}

function sendSherlMessage() {
  const input = document.getElementById('sherlInput');
  const msgContainer = document.getElementById('sherlMessages');
  const text = input.value.trim();

  if (!text) return;

  // Append User Msg
  const uDiv = document.createElement('div');
  uDiv.className = "sherl-msg user-msg";
  uDiv.innerText = text;
  msgContainer.appendChild(uDiv);
  input.value = "";

  // Bot Response Simulation
  setTimeout(() => {
    const bDiv = document.createElement('div');
    bDiv.className = "sherl-msg bot-msg";
    bDiv.innerText = "Hello! DDC Supply Chain support bot is ready to assist with geofence, payroll, or leave issues.";
    msgContainer.appendChild(bDiv);
    msgContainer.scrollTop = msgContainer.scrollHeight;
  }, 600);
}

// ==========================================================================
// THEME TOGGLER
// ==========================================================================
function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  document.body.classList.toggle('light-mode');
}

// ==========================================================================
// INITIALIZATION ON DOM LOAD
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Login Button Listener
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', handleLogin);

  // Auto-fill Employee ID suggestions
  const nameSearch = document.getElementById('loginNameSearch');
  if (nameSearch) {
    nameSearch.addEventListener('input', async (e) => {
      const val = e.target.value.trim();
      const container = document.getElementById('nameSuggestions');
      if (val.length < 2) { container.style.display = 'none'; return; }

      try {
        const names = await callAPI("getEmployeeNames");
        if (names) {
          const filtered = names.filter(n =>
            (n.name && n.name.toLowerCase().includes(val.toLowerCase())) ||
            (n.employee_id && n.employee_id.toLowerCase().includes(val.toLowerCase()))
          );

          if (filtered.length > 0) {
            container.innerHTML = "";
            filtered.forEach(f => {
              const item = document.createElement('div');
              item.className = 'suggestion-item p-2';
              item.innerText = `${f.name || f.employee_id} (${f.employee_id})`;
              item.onclick = () => {
                nameSearch.value = f.name || f.employee_id;
                document.getElementById('loginEmpId').value = f.employee_id;
                container.style.display = 'none';
              };
              container.appendChild(item);
            });
            container.style.display = 'block';
          }
        }
      } catch (err) { console.error(err); }
    });
  }
});