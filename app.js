/* ==========================================================================
   DDC SUPPLY CHAIN & DISTRIBUTION LLP - FRONTEND LOGIC (app.js)
   ========================================================================== */

function getLocalDateString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- SUPABASE CLIENT SETUP ---
// --- SUPABASE CLIENT SETUP ---
const SUPABASE_URL = "https://jwlvumuawpsvqkmytwlu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp3bHZ1bXVhd3BzdnFrbXl0d2x1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5MzEzOTcsImV4cCI6MjEwNDUwNzM5N30.nthEzaHy8e5KKtdoeROqkhi8uRat8SjdZBUjP-Eule4";
const sbClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
// --- DDC SUPPLY CHAIN HQ GEOFENCE (Safdarjung Enclave, New Delhi) ---
const OFFICE_LAT = 28.5633;
const OFFICE_LNG = 77.1912;
const OFFICE_RADIUS_M = 150; // 150-meter radius coverage

const SUPABASE_ACTIONS = new Set([
  "login", "clockIn", "clockOut",
  "getEmployeesDirectory", "getUsers", "addUser",
  "getDashboardMetrics", "getDashboardCharts", "getOverallMetrics", "getOverallCharts",
  "applyLeave", "getEmployeeLeaves", "getAllPendingLeaves", "updateLeaveStatus",
  "saveSalaryConfig", "getSalaryDetails",
  "getTrainingList", "addTraining",
  "getEmployeeNames", "pingLocation", "getLiveLocations", "getAuditLogs", "askSherl"
]);

async function callAPI(action, params = {}) {
  if (SUPABASE_ACTIONS.has(action)) {
    return callSupabase(action, params);
  }
  throw new Error("Unhandled action: " + action);
}

async function callSupabase(action, params) {
  if (!sbClient) throw new Error("Supabase client is not initialized.");

  if (action === "login") {
    const { data, error } = await sbClient.rpc('login', {
      p_employee_id: params.employeeId,
      p_password: params.password
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "clockIn") {
    const { data, error } = await sbClient.rpc('clock_in', {
      p_employee_id: params.employeeId,
      p_lat: params.gps.lat,
      p_lng: params.gps.lng
    });
    if (error) throw new Error(error.message);
    if (data.success) {
      if (params.gps.selfieBase64) {
        uploadSelfieToSupabase(params.employeeId, params.gps.selfieBase64).catch(console.error);
      }
      return [["SUCCESS", data.distance_m, data.message]];
    } else {
      return [[data.message]];
    }
  }

  if (action === "clockOut") {
    const { data, error } = await sbClient.rpc('clock_out', {
      p_employee_id: params.employeeId,
      p_lat: params.gps.lat,
      p_lng: params.gps.lng
    });
    if (error) throw new Error(error.message);
    if (data.success) {
      if (params.gps.selfieBase64) {
        try {
          await uploadClockOutSelfieToSupabase(params.employeeId, params.gps.selfieBase64);
        } catch (err) {
          return [["SUCCESS_SELFIE_FAILED", data.hours_worked]];
        }
      }
      return [["SUCCESS", data.hours_worked]];
    } else {
      return [[data.message]];
    }
  }

  if (action === "getEmployeesDirectory") {
    const { data, error } = await sbClient.rpc('get_employees_directory');
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getUsers") {
    const { data, error } = await sbClient.rpc('get_users');
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "addUser") {
    const { data, error } = await sbClient.rpc('add_user', {
      p_employee_id: params.employeeId, p_email: params.email,
      p_role: params.role, p_password: params.password
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getDashboardMetrics") {
    const { data, error } = await sbClient.rpc('get_dashboard_metrics', {
      p_employee_id: params.employeeId, p_date_param: params.dateParam || null
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getDashboardCharts") {
    const { data, error } = await sbClient.rpc('get_dashboard_charts', {
      p_employee_id: params.employeeId, p_date_param: params.dateParam || null
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getOverallMetrics") {
    const { data, error } = await sbClient.rpc('get_overall_metrics', { p_date_param: params.dateParam || null });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getOverallCharts") {
    const { data, error } = await sbClient.rpc('get_overall_charts', { p_date_param: params.dateParam || null });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "applyLeave") {
    const { data, error } = await sbClient.rpc('apply_leave', {
      p_employee_id: params.employeeId, p_from_date: params.fromDate, p_to_date: params.toDate,
      p_leave_type: params.leaveType, p_reason: params.reason, p_doc_pending: !!params.docObj
    });
    if (error) throw new Error(error.message);
    if (params.docObj) {
      uploadLeaveDocToSupabase(params.employeeId, params.docObj).catch(console.error);
    }
    return data;
  }

  if (action === "getEmployeeLeaves") {
    const { data, error } = await sbClient.rpc('get_employee_leaves', { p_employee_id: params.employeeId });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getAllPendingLeaves") {
    const { data, error } = await sbClient.rpc('get_all_pending_leaves');
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "updateLeaveStatus") {
    const { data, error } = await sbClient.rpc('update_leave_status', {
      p_leave_id: params.leaveId, p_status: params.status, p_hr_comment: params.hrComment || null
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "saveSalaryConfig") {
    const { data, error } = await sbClient.rpc('save_salary_config', {
      p_employee_id: params.employeeId, p_month_str: params.monthStr, p_amount: params.amount
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getSalaryDetails") {
    const { data, error } = await sbClient.rpc('get_salary_details', {
      p_employee_id: params.employeeId, p_month_str: params.monthStr
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getEmployeeNames") {
    const { data, error } = await sbClient.rpc('get_employee_names');
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getTrainingList") {
    const { data, error } = await sbClient.rpc('get_training_list');
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "addTraining") {
    const { data, error } = await sbClient.rpc('add_training', {
      p_dept: params.dept, p_system: params.system, p_purpose: params.purpose, p_link: params.link
    });
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "pingLocation") {
    const { error } = await sbClient.rpc('ping_location', {
      p_employee_id: params.employeeId, p_lat: params.lat, p_lng: params.lng
    });
    if (error) throw new Error(error.message);
    return { success: true };
  }

  if (action === "getLiveLocations") {
    const { data, error } = await sbClient.rpc('get_live_locations');
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "getAuditLogs") {
    const { data, error } = await sbClient.rpc('get_audit_logs');
    if (error) throw new Error(error.message);
    return data;
  }

  if (action === "askSherl") {
    return "DDC Assistant: For payroll or attendance inquiries, check your Dashboard or Leave Portal.";
  }

  throw new Error("Unhandled Supabase action: " + action);
}

// --- MEDIA UPLOADS ---
async function uploadLeaveDocToSupabase(employeeId, docObj) {
  const path = `leaves/${employeeId}_${Date.now()}_${docObj.name}`;
  const blob = await (await fetch(`data:${docObj.type};base64,${docObj.base64}`)).blob();
  const { error } = await sbClient.storage.from('leave-docs').upload(path, blob, { contentType: docObj.type });
  if (error) throw error;
  await sbClient.rpc('attach_leave_document', { p_employee_id: employeeId, p_doc_path: path });
}

async function uploadSelfieToSupabase(employeeId, base64) {
  const dateStr = getLocalDateString();
  const path = `selfies/${employeeId}_${dateStr}.webp`;
  const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
  const webpBlob = await compressToWebp(blob);
  await sbClient.storage.from('attendance-media').upload(path, webpBlob, { contentType: 'image/webp', upsert: true });
}

async function uploadClockOutSelfieToSupabase(employeeId, base64) {
  const dateStr = getLocalDateString();
  const path = `selfies/${employeeId}_${dateStr}_out.webp`;
  const blob = await (await fetch(`data:image/jpeg;base64,${base64}`)).blob();
  const webpBlob = await compressToWebp(blob);
  await sbClient.storage.from('attendance-media').upload(path, webpBlob, { contentType: 'image/webp', upsert: true });
}

function compressToWebp(blob, maxDim = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/webp', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// --- GLOBAL STATE ---
let CURRENT_USER = null;
let ATTENDANCE_SELFIE_BASE64 = null;
let weeklyChartInstance = null;
let statusChartInstance = null;
let monthlyChartInstance = null;
let geoWatchId = null;
let timerInterval = null;
let locationPingInterval = null;

// --- THEME TOGGLE ---
function toggleTheme() {
  document.body.classList.toggle('light-mode');
  const isLight = document.body.classList.contains('light-mode');
  document.querySelectorAll('.theme-icon').forEach(icon => {
    icon.className = 'fas ' + (isLight ? 'fa-moon' : 'fa-sun') + ' theme-icon';
  });
}

// --- HAVERSINE DISTANCE GEOFENCING ---
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function startZoneWatch() {
  const radar = document.getElementById('zoneRadar');
  const statusText = document.getElementById('zoneStatusText');
  const distText = document.getElementById('zoneDistanceText');
  if (!radar || !statusText || !distText || !navigator.geolocation) return;

  radar.classList.add('locating');
  if (geoWatchId !== null) navigator.geolocation.clearWatch(geoWatchId);

  geoWatchId = navigator.geolocation.watchPosition(pos => {
    radar.classList.remove('locating');
    const dist = haversineMeters(pos.coords.latitude, pos.coords.longitude, OFFICE_LAT, OFFICE_LNG);
    const inRange = dist <= OFFICE_RADIUS_M;
    radar.classList.toggle('out-of-range', !inRange);
    statusText.innerText = inRange ? "You are in range" : "Out of office range";
    distText.innerText = Math.round(dist) + "m from DDC Safdarjung HQ";
  }, () => {
    radar.classList.remove('locating');
    statusText.innerText = "Enable GPS to punch in";
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
}

function stopZoneWatch() {
  if (geoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}

// --- LOCATION PINGING ---
function startLocationPinging(employeeId) {
  if (locationPingInterval) return;
  locationPingInterval = setInterval(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos => {
      callAPI("pingLocation", { employeeId: employeeId, lat: pos.coords.latitude, lng: pos.coords.longitude }).catch(console.error);
    });
  }, 60000);
}

function stopLocationPinging() {
  if (locationPingInterval) {
    clearInterval(locationPingInterval);
    locationPingInterval = null;
  }
}

// --- LOGIN & AUTHENTICATION ---
function handleLogin() {
  let empId = document.getElementById("loginEmpId") ? document.getElementById("loginEmpId").value.trim() : "";
  const nameSearch = document.getElementById("loginNameSearch") ? document.getElementById("loginNameSearch").value.trim() : "";
  
  if (!empId && nameSearch) empId = nameSearch;
  const pass = document.getElementById("loginPass").value;
  const errorDiv = document.getElementById("login-error");

  if (!empId || !pass) {
    errorDiv.innerText = "Please enter Employee ID/Email and Password";
    return;
  }

  errorDiv.innerText = "Verifying...";
  errorDiv.className = "login-error-text text-warning";
  const btn = document.getElementById("loginBtn");
  btn.disabled = true;

  callAPI("login", { employeeId: empId, password: pass })
    .then(result => {
      btn.disabled = false;
      if (result && result.success) {
        localStorage.setItem('attendsys-user', JSON.stringify(result.user));
        CURRENT_USER = result.user;
        transitionToApp(result.user);
      } else {
        errorDiv.className = "login-error-text text-danger";
        errorDiv.innerText = result.message || "Invalid credentials";
      }
    })
    .catch(() => {
      btn.disabled = false;
      errorDiv.className = "login-error-text text-danger";
      errorDiv.innerText = "Connection failed. Try again.";
    });
}

function transitionToApp(user) {
  const loginScreen = document.getElementById('login-screen');
  loginScreen.style.display = 'none';
  initDashboardUI(user);
  const appWrapper = document.getElementById('app-wrapper');
  appWrapper.style.display = 'block';
  appWrapper.style.opacity = '1';
}

function handleLogout() {
  localStorage.removeItem('attendsys-user');
  CURRENT_USER = null;
  stopZoneWatch();
  stopLocationPinging();
  document.getElementById('app-wrapper').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function initDashboardUI(user) {
  if (document.getElementById('sidebarProfileName')) document.getElementById('sidebarProfileName').innerText = user.name || user.employeeId;
  if (document.getElementById('sidebarProfileRole')) document.getElementById('sidebarProfileRole').innerText = user.role;
  applyRoleRules(user.role);
  if (document.getElementById('clockEmpId')) document.getElementById('clockEmpId').value = user.employeeId;
  switchSection('home');
}

function applyRoleRules(role) {
  const isAdminOrDev = role === 'Admin' || role === 'Dev';
  const isHR = role === 'HR';

  ['menu-directory', 'menu-dashboard', 'menu-users', 'menu-salary', 'menu-liveMap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (isAdminOrDev || (isHR && id !== 'menu-users')) ? 'block' : 'none';
  });
}

function switchSection(sectionName, linkElement) {
  document.querySelectorAll('.spa-section').forEach(sec => sec.classList.remove('active'));
  const target = document.getElementById(sectionName + 'Section');
  if (target) target.classList.add('active');

  document.querySelectorAll('.bottom-nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionName);
  });

  if (sectionName === 'home') {
    startZoneWatch();
  } else {
    stopZoneWatch();
  }

  if (sectionName === 'employee') loadDirectory();
  if (sectionName === 'users') loadUsersList();
  if (sectionName === 'leave') loadMyLeaveHistory();
}

// --- CLOCK IN / OUT HANDLERS ---
async function handleClockIn() {
  const id = CURRENT_USER ? CURRENT_USER.employeeId : "";
  if (!id) return;
  if (!ATTENDANCE_SELFIE_BASE64) {
    alert("Please capture verification selfie first.");
    return;
  }
  try {
    const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej));
    const res = await callAPI("clockIn", { employeeId: id, gps: { lat: pos.coords.latitude, lng: pos.coords.longitude, selfieBase64: ATTENDANCE_SELFIE_BASE64 } });
    if (res && res[0] && res[0][0] === 'SUCCESS') {
      alert(res[0][2]);
      ATTENDANCE_SELFIE_BASE64 = null;
      startLocationPinging(id);
    } else {
      alert(res[0][0] || "Error clocking in");
    }
  } catch (e) {
    alert("Location permission required to clock in.");
  }
}

function previewFakePhoto(input) {
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      document.querySelector('.fake-thumb').src = e.target.result;
      document.getElementById('selfiePreview').style.display = 'block';
      ATTENDANCE_SELFIE_BASE64 = e.target.result.split(',')[1];
    };
    reader.readAsDataURL(input.files[0]);
  }
}

// --- DIRECTORY & USERS LIST ---
function loadDirectory() {
  const container = document.getElementById('directory-container');
  container.innerHTML = '<div class="text-center text-secondary py-3">Loading directory...</div>';
  callAPI("getEmployeesDirectory", {}).then(data => {
    container.innerHTML = (data || []).map(emp => `
      <div class="glass-card p-3 d-flex justify-content-between align-items-center">
        <div>
          <div class="fw-bold text-white">${emp.name}</div>
          <div class="small text-secondary">ID: ${emp.employeeId} | Joined: ${emp.joiningDate || '-'}</div>
        </div>
        <span class="badge ${emp.status === 'Present' ? 'bg-success' : 'bg-danger'}">${emp.status}</span>
      </div>
    `).join('');
  });
}

function loadUsersList() {
  const tbody = document.getElementById('usersTableBody');
  tbody.innerHTML = '<tr><td colspan="4" class="text-center text-secondary">Loading users...</td></tr>';
  callAPI("getUsers", {}).then(users => {
    tbody.innerHTML = (users || []).map(u => `
      <tr><td>${u.employeeId}</td><td>${u.email}</td><td>${u.role}</td><td><span class="badge bg-success">${u.status}</span></td></tr>
    `).join('');
  });
}

function loadMyLeaveHistory() {
  const container = document.getElementById('leaveHistoryList');
  if (!CURRENT_USER) return;
  callAPI("getEmployeeLeaves", { employeeId: CURRENT_USER.employeeId }).then(data => {
    container.innerHTML = (data || []).map(l => `
      <div class="glass-card p-3">
        <div class="d-flex justify-content-between">
          <div class="fw-bold text-white">${l.type}</div>
          <span class="badge ${l.status === 'Approved' ? 'bg-success' : l.status === 'Rejected' ? 'bg-danger' : 'bg-warning'}">${l.status}</span>
        </div>
        <div class="small text-secondary mt-1">${l.from} to ${l.to}</div>
      </div>
    `).join('');
  });
}

// --- SHERL CHATBOX ---
function toggleSherlChat() {
  const box = document.getElementById('sherl-chat-box');
  box.style.display = box.style.display === 'none' ? 'flex' : 'none';
}

function sendSherlMessage() {
  const input = document.getElementById('sherlInput');
  const msg = input.value.trim();
  if (!msg) return;
  const container = document.getElementById('sherl-messages');
  container.innerHTML += `<div class="text-white bg-accent p-2 rounded mb-2 align-self-end small">${msg}</div>`;
  input.value = '';
  callAPI("askSherl", { question: msg }).then(resp => {
    container.innerHTML += `<div class="bg-secondary text-white p-2 rounded mb-2 align-self-start small">${resp}</div>`;
  });
}

// --- INITIALIZATION ON LOAD ---
document.addEventListener("DOMContentLoaded", function() {
  const savedUser = localStorage.getItem('attendsys-user');
  if (savedUser) {
    CURRENT_USER = JSON.parse(savedUser);
    transitionToApp(CURRENT_USER);
  }
});