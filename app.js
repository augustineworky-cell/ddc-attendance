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

// Aliases used by geofence-checking helpers
const HQ_LAT = OFFICE_LAT;
const HQ_LNG = OFFICE_LNG;
const MAX_GEOFENCE_RADIUS_METERS = OFFICE_RADIUS_M;

// Global Application State
let CURRENT_USER = null;
let ATTENDANCE_SELFIE_BASE64 = null;
let locationPingTimer = null;
let liveMapInstance = null;
let liveMapMarkers = {};
let liveMapInterval = null;
let liveMapGeofenceCircle = null;
let dirFilterState = "all";
let weeklyChartObj = null, statusChartObj = null, monthlyChartObj = null;
let currentLatitude = null;
let currentLongitude = null;
let EMPLOYEE_LIST = [];
let webcamStream = null;

// Utility: Date String Formatter (YYYY-MM-DD)
function getLocalDateString(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ==========================================================================
// HAVERSINE DISTANCE FORMULA (METERS)
// ==========================================================================
function calculateDistance(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000; // Earth radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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
      case "updateUser": {
        const { data, error } = await sbClient.rpc('update_user', {
          p_employee_id: payload.employeeId,
          p_email: payload.email,
          p_role: payload.role,
          p_status: payload.status
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
// AUTHENTICATION & SESSION MANAGEMENT
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
    applySessionAndRenderApp(user, true);

  } catch (err) {
    console.error("Login error:", err);
    if (errorDiv) {
      errorDiv.textContent = 'Login failed. Connection error.';
      errorDiv.style.display = 'block';
    }
  }
}

// Shared helper used both by fresh logins and by session restoration
function applySessionAndRenderApp(user, persist) {
  window.CURRENT_USER = user;
  CURRENT_USER = user;

  if (persist) {
    localStorage.setItem('currentUser', JSON.stringify(user));
  }

  // Hide Login, Show Main App Layout
  const loginView = document.getElementById('loginView');
  const appLayout = document.getElementById('appLayout');
  if (loginView) loginView.style.display = 'none';
  if (appLayout) appLayout.style.display = 'flex';

  // Populate Sidebar Details
  const nameDisplay = document.getElementById('userNameDisplay');
  const roleBadge = document.getElementById('userRoleBadge');
  const userAvatar = document.getElementById('userAvatar');

  if (nameDisplay) nameDisplay.textContent = user.name || user.employee_id;
  if (roleBadge) roleBadge.textContent = user.role || 'Employee';
  if (userAvatar) userAvatar.textContent = (user.name || user.employee_id).charAt(0).toUpperCase();

  applyRoleBasedUIRestrictions(user.role);
}

// Restrict .admin-only UI elements based on the current user's role
function applyRoleBasedUIRestrictions(role) {
  const isAdmin = ['Admin', 'HR', 'Dev'].includes(role);
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

// Attempt to restore an existing session from localStorage on page load
function restoreSessionFromStorage() {
  try {
    const stored = localStorage.getItem('currentUser');
    if (!stored) return;
    const user = JSON.parse(stored);
    if (user && user.employeeId) {
      applySessionAndRenderApp(user, false);
    }
  } catch (e) {
    console.warn("Could not restore session:", e);
    localStorage.removeItem('currentUser');
  }
}

function handleLogout() {
  CURRENT_USER = null;
  window.CURRENT_USER = null;
  localStorage.removeItem('currentUser');
  stopLocationPinging();
  stopLiveMapRefresh();
  location.reload();
}

// ==========================================================================
// UI ENHANCEMENT LAYER: SKELETON LOADERS, TRANSITIONS, MICRO-INTERACTIONS
// ==========================================================================

// Injects the CSS needed for skeleton shimmer, nav transitions, and the
// punch-in animation sequence. Self-contained so no external stylesheet
// changes are required. Runs once on DOMContentLoaded.
function injectUiEnhancementStyles() {
  if (document.getElementById('uiEnhancementStyles')) return;
  const style = document.createElement('style');
  style.id = 'uiEnhancementStyles';
  style.textContent = `
    @keyframes skeletonShimmer {
      0% { background-position: -400px 0; }
      100% { background-position: 400px 0; }
    }
    .skeleton-card {
      position: relative;
      overflow: hidden;
      border-radius: 12px;
      background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.14) 37%, rgba(255,255,255,0.06) 63%);
      background-size: 800px 100%;
      animation: skeletonShimmer 1.4s ease-in-out infinite;
    }
    .skeleton-dir-card { height: 64px; margin-bottom: 12px; }
    .skeleton-metric-card { height: 90px; margin-bottom: 12px; }
    .skeleton-chart-card { height: 220px; margin-bottom: 12px; }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(14px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .fade-in-up { animation: fadeInUp 0.32s ease-out; }

    @keyframes btnPulse {
      0% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.55); }
      70% { box-shadow: 0 0 0 14px rgba(37, 99, 235, 0); }
      100% { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
    }
    .btn-pulsing { animation: btnPulse 0.9s ease-out infinite; }

    .camera-flash-overlay {
      position: fixed;
      inset: 0;
      background: #ffffff;
      opacity: 0;
      pointer-events: none;
      z-index: 9998;
      transition: opacity 120ms ease-out;
    }
    .camera-flash-overlay.flash-active {
      opacity: 0.85;
      transition: opacity 40ms ease-in;
    }

    @keyframes successBounceIn {
      0% { transform: scale(0.85); opacity: 0; }
      60% { transform: scale(1.04); opacity: 1; }
      100% { transform: scale(1); opacity: 1; }
    }
    .success-bounce { animation: successBounceIn 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  `;
  document.head.appendChild(style);
}

// ---- Skeleton loading lifecycle -------------------------------------------

// Renders shimmering placeholder rows inside the employee directory list
// prior to the getEmployeesDirectory RPC resolving.
function showDirectorySkeletons(count = 6) {
  const container = document.getElementById('directoryList') || document.getElementById('directory-container');
  if (!container) return;
  container.dataset.skeletonActive = 'true';
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const card = document.createElement('div');
    card.className = 'skeleton-card skeleton-dir-card';
    container.appendChild(card);
  }
}

// Renders shimmering placeholders for the dashboard metric tiles and chart
// canvases prior to the dashboard metrics/charts RPCs resolving.
function showDashboardSkeletons() {
  const metricTargets = ['presentCount', 'dashboardMetrics'];
  metricTargets.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const parent = el.closest('.glass-card') || el.parentElement;
    if (parent) {
      parent.dataset.skeletonActive = 'true';
      if (!parent.querySelector('.skeleton-metric-card')) {
        const skel = document.createElement('div');
        skel.className = 'skeleton-card skeleton-metric-card skeleton-injected';
        parent.appendChild(skel);
      }
      el.style.visibility = 'hidden';
    }
  });

  ['weeklyChart', 'statusChart', 'monthlyChart'].forEach(id => {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const wrapper = canvas.parentElement;
    if (wrapper) {
      wrapper.dataset.skeletonActive = 'true';
      canvas.style.visibility = 'hidden';
      if (!wrapper.querySelector('.skeleton-injected')) {
        const skel = document.createElement('div');
        skel.className = 'skeleton-card skeleton-chart-card skeleton-injected';
        wrapper.appendChild(skel);
      }
    }
  });
}

// Removes any skeleton placeholders under the given containerId and restores
// visibility of the real elements underneath them. Safe to call even if no
// skeletons are currently showing.
function hideSkeletons(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.querySelectorAll('.skeleton-injected').forEach(node => node.remove());
  delete container.dataset.skeletonActive;
  container.querySelectorAll('[style*="visibility: hidden"]').forEach(node => {
    node.style.visibility = '';
  });
  container.classList.add('fade-in-up');
  setTimeout(() => container.classList.remove('fade-in-up'), 350);
}

// Clears every skeleton on the page regardless of container, used as a
// catch-all after dashboard data finishes loading (metrics + 3 charts each
// live in their own wrapper element).
function hideAllDashboardSkeletons() {
  document.querySelectorAll('[data-skeleton-active="true"]').forEach(node => {
    node.querySelectorAll('.skeleton-injected').forEach(skel => skel.remove());
    delete node.dataset.skeletonActive;
    node.querySelectorAll('[style*="visibility: hidden"]').forEach(el => { el.style.visibility = ''; });
    const canvas = node.querySelector('canvas');
    if (canvas) canvas.style.visibility = '';
    node.classList.add('fade-in-up');
    setTimeout(() => node.classList.remove('fade-in-up'), 350);
  });
}

// ---- Punch-in animated sequence -------------------------------------------

function getCameraFlashOverlay() {
  let overlay = document.getElementById('cameraFlashOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'cameraFlashOverlay';
    overlay.className = 'camera-flash-overlay';
    document.body.appendChild(overlay);
  }
  return overlay;
}

function triggerCameraFlash() {
  const overlay = getCameraFlashOverlay();
  overlay.classList.add('flash-active');
  setTimeout(() => overlay.classList.remove('flash-active'), 160);
}

// Drives the visible step-by-step animation (pulse -> flash -> bounce) around
// the existing handleClockIn() flow, without altering its RPC logic.
async function handlePunchInAnimated() {
  const btn = document.getElementById('punchInBtn') || document.getElementById('homeClockBtn');
  if (btn) btn.classList.add('btn-pulsing');

  // Camera flash timed to coincide with the selfie snapshot moment.
  triggerCameraFlash();

  try {
    await handleClockIn();
  } finally {
    if (btn) btn.classList.remove('btn-pulsing');
    const statusCard = document.getElementById('homeStatusCard');
    if (statusCard) {
      statusCard.classList.add('success-bounce');
      setTimeout(() => statusCard.classList.remove('success-bounce'), 500);
    }
  }
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
      renderPunchInSuccessCard();
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

// ==========================================================================
// GOOGLE SHEETS SYNC INTEGRATION
// ==========================================================================
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbwiU8qhkQXeVv4VVm2ODht/exec';

async function syncToGoogleSheets(data) {
  try {
    await fetch(GOOGLE_SHEET_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log('Google Sheets sync triggered successfully');
  } catch (error) {
    console.error('Google Sheets Sync Failed:', error);
  }
}

// to the same clock-in flow so both names work from markup.
async function handlePunchIn() {
  return handleClockIn();
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

      // --- GOOGLE SHEETS SYNC (PUNCH OUT) ---
      syncToGoogleSheets({
        record_id: id,
        employee_id: id,
        employee_name: CURRENT_USER ? (CURRENT_USER.fullName || CURRENT_USER.name || "") : "",
        punch_out_time: new Date().toISOString(),
        punch_out_address: `${pos.coords.latitude}, ${pos.coords.longitude}`
      });

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

// Green "Punch In Successful" card + metric + button treatment described in spec
function renderPunchInSuccessCard() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Increment present-count metric
  const presentCountEl = document.getElementById('presentCount');
  if (presentCountEl) {
    const current = parseInt(presentCountEl.innerText, 10) || 0;
    presentCountEl.innerText = current + 1;
  }

  // Update top status card styling
  const statusCard = document.getElementById('homeStatusCard');
  const statusIcon = document.getElementById('homeStatusIcon');
  const statusTitle = document.getElementById('homeStatusTitle');
  const statusSubtitle = document.getElementById('homeStatusSubtitle');

  if (statusCard) {
    statusCard.style.background = '#f0fdf4';
    statusCard.style.borderColor = '#bbf7d0';
    statusCard.classList.add('success-bounce');
    setTimeout(() => statusCard.classList.remove('success-bounce'), 500);
  }
  if (statusIcon) statusIcon.textContent = '🎉';
  if (statusTitle) {
    statusTitle.textContent = 'PUNCH IN SUCCESSFUL!';
    statusTitle.style.color = '#15803d';
  }
  if (statusSubtitle) statusSubtitle.textContent = `Clocked in at ${timeStr} today`;

  // Transform the main clock button
  const btn = document.getElementById('homeClockBtn');
  const btnLabel = document.getElementById('homeClockBtnLabel');
  if (btn) {
    btn.style.background = 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)';
    btn.style.border = 'none';
  }
  if (btnLabel) btnLabel.innerText = '✓ CLOCKED IN TODAY';

  // --- GOOGLE SHEETS SYNC (PUNCH IN) ---
  if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) {
    syncToGoogleSheets({
      record_id: CURRENT_USER.employeeId || "",
      employee_id: CURRENT_USER.employeeId || "",
      employee_name: CURRENT_USER.fullName || CURRENT_USER.name || "",
      punch_in_time: new Date().toISOString()
    });
  }
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

// ==================== GEOLOCATION & GEOFENCE WITH TIMEOUT ====================
function checkGeofence() {
  const title = document.getElementById('geofenceTitle');
  const subtitle = document.getElementById('geofenceSubtitle');
  const icon = document.getElementById('geofenceIcon');

  if (!navigator.geolocation) {
    if (title) title.textContent = "GPS Unavailable";
    if (subtitle) subtitle.textContent = "Geolocation is not supported by your browser.";
    return;
  }

  // 5-second maximum timeout to prevent hanging indefinitely on "Checking Location..."
  const options = { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 };

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLatitude = pos.coords.latitude;
      currentLongitude = pos.coords.longitude;

      const dist = calculateDistance(currentLatitude, currentLongitude, HQ_LAT, HQ_LNG);

      if (dist <= MAX_GEOFENCE_RADIUS_METERS) {
        if (icon) icon.textContent = "✅";
        if (title) title.textContent = "Inside Geofence";
        if (subtitle) subtitle.textContent = `${Math.round(dist)}m from DDC Safdarjung HQ`;
      } else {
        if (icon) icon.textContent = "📍";
        if (title) title.textContent = "Outside Geofence";
        if (subtitle) subtitle.textContent = `${Math.round(dist)}m from DDC Safdarjung HQ`;
      }
    },
    (err) => {
      console.warn("Location prompt or signal timeout:", err);
      if (icon) icon.textContent = "📍";
      if (title) title.textContent = "GPS Location Pending";
      if (subtitle) subtitle.textContent = "Please allow location access in your browser bar";
    },
    options
  );
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
// NAVIGATION & MODULE SWITCHER (LEGACY SPA SECTIONS)
// ==========================================================================
function switchSection(sectionId, el) {
  document.querySelectorAll('.spa-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(sectionId + 'Section');
  if (target) {
    target.classList.add('active');
    target.classList.add('fade-in-up');
    setTimeout(() => target.classList.remove('fade-in-up'), 350);
  }

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

// ==========================================================================
// SAAS SIDEBAR & MOBILE DRAWER NAVIGATION
// ==========================================================================
function initNavigation() {
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item[data-view]');
  const appViews = document.querySelectorAll('.app-view');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const menuToggleBtn = document.getElementById('menuToggleBtn');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetViewId = item.getAttribute('data-view');
      if (!targetViewId) return;

      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      appViews.forEach(view => {
        if (view.id === targetViewId) {
          view.classList.add('active');
          // Smooth transition hook: briefly apply a fade-in-up entrance so
          // switching workspace views doesn't feel like an abrupt hard-cut.
          view.classList.remove('fade-in-up');
          // Force reflow so the animation re-triggers on repeated visits.
          void view.offsetWidth;
          view.classList.add('fade-in-up');
          setTimeout(() => view.classList.remove('fade-in-up'), 350);
        } else {
          view.classList.remove('active');
          view.classList.remove('fade-in-up');
        }
      });

      // Lazy-load data for the view being entered
      if (targetViewId === 'dashboardView') loadDashboardData();
      if (targetViewId === 'directoryView') loadDirectory();
      if (targetViewId === 'leaveView') loadLeaveData();
      if (targetViewId === 'salaryView') loadSalaryData();
      if (targetViewId === 'trainingView') loadTrainingData();
      if (targetViewId === 'fieldMapView') initLiveMap();
      if (targetViewId === 'userMgmtView') loadUserManagement();

      if (sidebar) sidebar.classList.remove('open');
      if (backdrop) backdrop.classList.remove('active');
    });
  });

  if (menuToggleBtn) {
    menuToggleBtn.addEventListener('click', () => {
      if (sidebar) sidebar.classList.toggle('open');
      if (backdrop) backdrop.classList.toggle('active');
    });
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      if (sidebar) sidebar.classList.remove('open');
      backdrop.classList.remove('active');
    });
  }
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
// DASHBOARD MODULE
// ==========================================================================
async function loadDashboardData() {
  if (!CURRENT_USER) return;
  const dateStr = getLocalDateString();

  showDashboardSkeletons();

  try {
    const isAdmin = ['Admin', 'HR', 'Dev'].includes(CURRENT_USER.role);
    const metrics = isAdmin
      ? await callAPI("getOverallMetrics", { date: dateStr })
      : await callAPI("getDashboardMetrics", { employeeId: CURRENT_USER.employeeId, date: dateStr });

    if (metrics) {
      const presentCountEl = document.getElementById('presentCount');
      if (presentCountEl && metrics.present_count !== undefined) {
        presentCountEl.innerText = metrics.present_count;
      }
    }

    const charts = isAdmin
      ? await callAPI("getOverallCharts", { date: dateStr })
      : await callAPI("getDashboardCharts", { employeeId: CURRENT_USER.employeeId, date: dateStr });

    renderDashboardCharts(charts);
  } catch (e) {
    console.error("Dashboard load error:", e);
  } finally {
    hideAllDashboardSkeletons();
  }
}

function renderDashboardCharts(charts) {
  if (!charts || typeof Chart === 'undefined') return;

  const weeklyCanvas = document.getElementById('weeklyChart');
  if (weeklyCanvas && charts.weekly) {
    if (weeklyChartObj) weeklyChartObj.destroy();
    weeklyChartObj = new Chart(weeklyCanvas, {
      type: 'bar',
      data: charts.weekly
    });
  }

  const statusCanvas = document.getElementById('statusChart');
  if (statusCanvas && charts.status) {
    if (statusChartObj) statusChartObj.destroy();
    statusChartObj = new Chart(statusCanvas, {
      type: 'doughnut',
      data: charts.status
    });
  }

  const monthlyCanvas = document.getElementById('monthlyChart');
  if (monthlyCanvas && charts.monthly) {
    if (monthlyChartObj) monthlyChartObj.destroy();
    monthlyChartObj = new Chart(monthlyCanvas, {
      type: 'line',
      data: charts.monthly
    });
  }
}

// ==========================================================================
// DIRECTORY MODULE
// ==========================================================================
async function loadDirectory() {
  const container = document.getElementById('directoryList') || document.getElementById('directory-container');
  if (!container) return;

  showDirectorySkeletons();

  try {
    const list = await callAPI("getEmployeesDirectory");
    EMPLOYEE_LIST = list || [];
    container.innerHTML = "";
    if (!list || list.length === 0) {
      container.innerHTML = `<div class="text-secondary small p-3 text-center">No active employees found.</div>`;
      return;
    }

    list.forEach(emp => {
      const statusClass = emp.today_status === 'Present' ? 'text-success' : 'text-danger';
      const card = document.createElement('div');
      card.className = "glass-card p-3 d-flex align-items-center justify-content-between dir-item fade-in-up";
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
      setTimeout(() => card.classList.remove('fade-in-up'), 350);
    });
  } catch (e) {
    console.error(e);
  } finally {
    delete container.dataset.skeletonActive;
  }
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
          <div class="d-flex align-items-center justify-content-between">
            <a href="${item.resource_link}" target="_blank" class="btn btn-sm btn-outline-light"><i class="fas fa-external-link-alt me-1"></i>Open Resource</a>
            <div class="form-check">
              <input class="form-check-input training-progress-check" type="checkbox" data-id="${item.id}" ${item.completed ? 'checked' : ''}>
              <label class="form-check-label small text-secondary">Completed</label>
            </div>
          </div>
        </div>
      `;
      container.appendChild(col);
    });

    document.querySelectorAll('.training-progress-check').forEach(cb => {
      cb.addEventListener('change', (e) => {
        // Progress state tracked client-side; persisted server-side once a
        // dedicated RPC for training completion is exposed.
        console.log(`Training ${e.target.dataset.id} marked completed: ${e.target.checked}`);
      });
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

  const viewer = document.getElementById('liveMapViewer');
  if (viewer) viewer.style.display = 'block';

  if (!liveMapInstance) {
    liveMapInstance = L.map('liveMapContainer').setView([OFFICE_LAT, OFFICE_LNG], 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(liveMapInstance);

    // Geofence radius overlay around HQ
    liveMapGeofenceCircle = L.circle([OFFICE_LAT, OFFICE_LNG], {
      radius: OFFICE_RADIUS_M,
      color: '#2563eb',
      fillColor: '#3b82f6',
      fillOpacity: 0.15
    }).addTo(liveMapInstance);

    L.marker([OFFICE_LAT, OFFICE_LNG], {
      icon: L.divIcon({ className: 'hq-marker', html: '🏢', iconSize: [24, 24] })
    }).addTo(liveMapInstance).bindPopup('DDC Safdarjung HQ');
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
  const viewer = document.getElementById('liveMapViewer');
  if (viewer) viewer.style.display = 'none';
}

// ==========================================================================
// USER MANAGEMENT MODULE (ADMIN CRUD)
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
        <td><span class="badge bg-${u.status === 'Active' ? 'success' : 'danger'}">${u.status}</span></td>
        <td>
          <button class="btn btn-sm btn-outline-light me-1" onclick='openEditUserModal(${JSON.stringify(u)})'>
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-sm btn-outline-warning" onclick="toggleUserStatus('${u.employee_id}', '${u.status}')">
            <i class="fas fa-power-off"></i>
          </button>
        </td>
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

function openEditUserModal(user) {
  const idField = document.getElementById('editUserId');
  const emailField = document.getElementById('editUserEmail');
  const roleField = document.getElementById('editUserRole');
  const statusField = document.getElementById('editUserStatus');

  if (idField) idField.value = user.employee_id;
  if (emailField) emailField.value = user.email;
  if (roleField) roleField.value = user.role;
  if (statusField) statusField.value = user.status;

  const modalEl = document.getElementById('editUserModal');
  if (modalEl && window.bootstrap) {
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }
}

async function handleUpdateUser() {
  const id = document.getElementById('editUserId').value;
  const email = document.getElementById('editUserEmail').value;
  const role = document.getElementById('editUserRole').value;
  const status = document.getElementById('editUserStatus').value;

  try {
    await callAPI("updateUser", { employeeId: id, email: email, role: role, status: status });
    alert("User updated successfully.");
    const modalEl = document.getElementById('editUserModal');
    if (modalEl && window.bootstrap) {
      bootstrap.Modal.getInstance(modalEl).hide();
    }
    loadUserManagement();
  } catch (e) { alert("Failed to update user."); }
}

async function toggleUserStatus(employeeId, currentStatus) {
  const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';
  try {
    await callAPI("updateUser", { employeeId: employeeId, status: newStatus });
    loadUserManagement();
  } catch (e) { alert("Failed to change user status."); }
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
// EMPLOYEE AUTOCOMPLETE (LOGIN SCREEN)
// ==========================================================================
function initSuggestions() {
  const nameSearch = document.getElementById('loginNameSearch');
  if (!nameSearch) return;

  nameSearch.addEventListener('input', async (e) => {
    const val = e.target.value.trim();
    const container = document.getElementById('nameSuggestions');
    if (!container) return;
    if (val.length < 2) { container.style.display = 'none'; return; }

    try {
      const names = await callAPI("getEmployeeNames");
      EMPLOYEE_LIST = names || EMPLOYEE_LIST;
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
        } else {
          container.style.display = 'none';
        }
      }
    } catch (err) { console.error(err); }
  });
}

// ==========================================================================
// WEBCAM & SELFIE CAPTURE LOGIC
// ==========================================================================
async function handleCaptureSelfie() {
  const video = document.getElementById('webcam');
  const preview = document.getElementById('selfiePreview');
  const captureBtn = document.getElementById('captureBtn');
  const canvas = document.getElementById('canvas');

  if (!video || !preview || !captureBtn || !canvas) return;

  // Step 2: If stream is active, take snapshot
  if (webcamStream) {
    triggerCameraFlash();

    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth || 300;
    canvas.height = video.videoHeight || 300;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageDataUrl = canvas.toDataURL('image/jpeg');
    preview.src = imageDataUrl;
    window.CAPTURED_SELFIE_DATA = imageDataUrl; // Saved for Supabase upload
    ATTENDANCE_SELFIE_BASE64 = imageDataUrl;

    // Turn off camera tracks
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;

    video.style.display = 'none';
    preview.style.display = 'block';
    captureBtn.textContent = '📷 Retake Selfie';
    return;
  }

  // Step 1: Request camera permission & display video preview
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 400 }, height: { ideal: 400 } },
      audio: false
    });

    video.srcObject = webcamStream;
    video.style.display = 'block';
    preview.style.display = 'none';
    captureBtn.textContent = '📸 Snap Photo';
  } catch (err) {
    console.error("Camera access error:", err);
    alert("Camera permission denied or camera not found. Please allow camera access in your browser settings.");
  }
}

// ==========================================================================
// INITIALIZATION ON DOM LOAD
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Inject shimmer/transition/animation CSS used by the enhancements above
  injectUiEnhancementStyles();

  // Login Button Listener
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', handleLogin);

  // Webcam capture button
  const captureBtn = document.getElementById('captureBtn');
  if (captureBtn) captureBtn.addEventListener('click', handleCaptureSelfie);

  // Punch-in button: wire the animated pulse -> flash -> bounce sequence.
  // Falls back to the legacy #homeClockBtn if #punchInBtn isn't present, and
  // never overrides the onclick handler updateHomeUI() assigns after a
  // clock-out (which switches the button back to the plain handleClockIn).
  const punchInBtn = document.getElementById('punchInBtn');
  if (punchInBtn) punchInBtn.addEventListener('click', handlePunchInAnimated);

  // Employee autocomplete on login screen
  initSuggestions();

  // Sidebar / mobile drawer navigation
  initNavigation();

  // Attempt to restore a previously active session
  restoreSessionFromStorage();
});
