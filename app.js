// ==========================================================================
// DDC SUPPLY CHAIN & DISTRIBUTION LLP - WORKFORCE ATTENDANCE APP.JS
// ==========================================================================

const SUPABASE_URL = "https://bpwpxhsdmbkymhpjsfej.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwd3B4aHNkbWJreW1ocGpzZmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDUzNzIsImV4cCI6MjEwNDUyMTM3Mn0.XnXF9kqp0g6xQwZpjPC6tUhLGNI1T29i02DQGjNYG2M";
const sbClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// DDC Safdarjung HQ Geofence Coordinates
const OFFICE_LAT = 28.56616;
const OFFICE_LNG = 77.19904;
const OFFICE_RADIUS_M = 150; // 150-meter coverage radius

// Aliases used by geofence-checking helpers
const HQ_LAT = OFFICE_LAT;
const HQ_LNG = OFFICE_LNG;
const MAX_GEOFENCE_RADIUS_METERS = OFFICE_RADIUS_M;

// Official shift timing (IST) - DDC Safdarjung HQ
const SHIFT_START_TIME = "11:00 AM";
const SHIFT_END_TIME = "07:30 PM";
const SHIFT_LATE_GRACE_MINUTES = 15;               // late after 11:15 AM IST
const SHIFT_LATE_CUTOFF_MINUTES = 11 * 60 + 15;    // 11:15 AM in minutes-since-midnight
const SHIFT_END_MINUTES = 19 * 60 + 30;            // 07:30 PM in minutes-since-midnight

// Single source of truth for the localStorage session key. Every part of
// the app (login, logout, session restore) reads/writes through this key
// only - this is what previously caused the auto-logout loop, since older
// code paths wrote to 'currentUser' while others read 'DDC_USER'.
const SESSION_STORAGE_KEY = 'DDC_USER';

// Google Sheets sync endpoint - declared exactly once, top-level scope.
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbwiU8qhkQXeVv4VVm2ODhtY_WGtb0WmtrgcJ1g0a2gdGgK7RN-DDvl_SUg2lcq6-IYwQA/exec';

// Global Application State
let CURRENT_USER = null;
let ATTENDANCE_SELFIE_BASE64 = null;
// The current shift's own clock-in timestamp, used to compute each
// employee's individual 9-hour shift-end (clockInTime + 9h) rather than a
// fixed company-wide time. Set on a fresh clock-in, restored from
// get_today_attendance on refresh/re-login, and cleared on clock-out.
let CURRENT_SHIFT_CLOCK_IN_TIME = null;
let locationPingTimer = null;
let autoLogoutInterval = null;
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

// Utility: Minutes-since-midnight in IST, independent of the device's own
// local timezone (a phone set to a different timezone must still be judged
// against DDC Safdarjung HQ's local shift clock, not its own).
function getISTMinutesNow() {
  const istString = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit'
  });
  const [hh, mm] = istString.split(':').map(Number);
  return hh * 60 + mm;
}

// ==========================================================================
// GEOLOCATION HELPER (DESKTOP / INCOGNITO SAFE)
// ==========================================================================
// Wraps navigator.geolocation.getCurrentPosition with a two-stage strategy:
// first attempt a fast, high-accuracy fix (4s timeout), and if that fails
// or times out (common on desktop browsers and incognito windows where a
// GPS chip isn't available and the browser falls back to slow Wi-Fi/IP
// based positioning), retry once with high accuracy disabled and a longer
// timeout. This prevents the "Checking Location..." / clock-in spinner
// from hanging indefinitely or failing outright on desktop/incognito.
function getGpsPosition(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new Error("Geolocation not supported"));
    }
    navigator.geolocation.getCurrentPosition(
      resolve,
      () => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 30000 }
        );
      },
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 0 }
    );
  });
}

// ==========================================================================
// ESSENTIAL PERMISSIONS: LOCATION + CAMERA (PRIMING + PERSISTENT REMINDER)
// ==========================================================================
// Punch In/Out silently used to fail if a user had denied location or
// camera access - they'd only find out mid-punch, after already trying to
// take a selfie. This module actively asks for both permissions right
// after login (so surprises happen once, upfront, not during a punch),
// and re-checks every time the app is opened/foregrounded. iOS Safari is
// known to reset permissions for installed home-screen PWAs more often
// than Android Chrome, so this re-check-every-time behavior matters more
// there, not less.
const PERMISSION_STATE = { location: 'unknown', camera: 'unknown' };

function hasEssentialPermissions() {
  return PERMISSION_STATE.location !== 'denied' && PERMISSION_STATE.camera !== 'denied';
}

// Passive check via the Permissions API where supported - does NOT trigger
// a prompt, just reads current OS/browser state. Safari's support for
// querying 'camera' this way is inconsistent, so camera state may stay
// 'unknown' here until primeEssentialPermissions() actually attempts it.
async function refreshPermissionStates() {
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const locStatus = await navigator.permissions.query({ name: 'geolocation' });
      PERMISSION_STATE.location = locStatus.state;
      locStatus.onchange = () => {
        PERMISSION_STATE.location = locStatus.state;
        renderPermissionBanner();
      };
    } catch (e) { /* geolocation query unsupported in this browser */ }

    try {
      const camStatus = await navigator.permissions.query({ name: 'camera' });
      PERMISSION_STATE.camera = camStatus.state;
      camStatus.onchange = () => {
        PERMISSION_STATE.camera = camStatus.state;
        renderPermissionBanner();
      };
    } catch (e) { /* 'camera' permission name unsupported (notably older Safari) */ }
  }
  renderPermissionBanner();
}

// Actively triggers the native OS/browser permission dialogs. Call this
// right after login - camera is opened for an instant purely to force the
// prompt, then immediately stopped; nothing is recorded or shown to the
// user during this priming step.
async function primeEssentialPermissions() {
  try {
    await getGpsPosition(8000);
    PERMISSION_STATE.location = 'granted';
  } catch (e) {
    PERMISSION_STATE.location = 'denied';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    PERMISSION_STATE.camera = 'granted';
  } catch (e) {
    PERMISSION_STATE.camera = 'denied';
  }

  renderPermissionBanner();
}

function renderPermissionBanner() {
  const banner = document.getElementById('permissionBanner');
  const textEl = document.getElementById('permissionBannerText');
  if (!banner) return;

  const missing = [];
  if (PERMISSION_STATE.location === 'denied') missing.push('Location');
  if (PERMISSION_STATE.camera === 'denied') missing.push('Camera');

  if (missing.length === 0) {
    banner.style.display = 'none';
    return;
  }

  if (textEl) {
    textEl.textContent = `${missing.join(' & ')} access is blocked - Punch In/Out will fail until you enable ${missing.length > 1 ? 'both' : 'it'}.`;
  }
  banner.style.display = 'flex';
}

// Bound to the banner's "Enable Now" button - re-triggers native prompts.
// If the browser has already permanently blocked the permission (rather
// than just not-yet-asked), the browser won't re-prompt; the banner text
// then points the user to their browser/app site settings instead.
async function retryEssentialPermissions() {
  await primeEssentialPermissions();
  if (!hasEssentialPermissions()) {
    alert("Your browser has blocked this permanently. Please open your phone's Settings (or the browser's site settings for this app) and manually allow Location and Camera access for DDC Portal.");
  }
}


// Shows the official shift window as subtext under the geofence status
// card. Created dynamically since index.html doesn't ship a dedicated
// element for it - safe to call repeatedly, it reuses the same node
// rather than duplicating it on every call.
function renderShiftGuidanceBadge() {
  const geofenceCard = document.querySelector('.geofence-status-card');
  if (!geofenceCard) return;

  let badge = document.getElementById('shiftGuidanceBadge');
  if (!badge) {
    badge = document.createElement('p');
    badge.id = 'shiftGuidanceBadge';
    badge.className = 'status-subheading';
    badge.style.marginTop = '4px';
    badge.style.opacity = '0.8';
    geofenceCard.appendChild(badge);
  }
  badge.textContent = `Official Shift: ${SHIFT_START_TIME} - ${SHIFT_END_TIME} IST`;
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
        // Only attach a selfie once the punch itself actually succeeded -
        // uploading/attaching a photo against an OUT_OF_RANGE or
        // ALREADY_CLOCKED_IN attempt would try to attach to an attendance
        // row that was never created for today.
        if (data && data.status === 'SUCCESS' && payload.gps.selfieBase64) {
          const attached = await uploadSelfie(payload.employeeId, payload.gps.selfieBase64, 'clockin');
          // Surface this on the returned object rather than swallowing it -
          // a failed attach must not be treated as if the selfie succeeded.
          data._selfieAttached = attached;
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
        // Same rule as clockIn: only attach the clock-out selfie once
        // clock_out itself reports SUCCESS.
        if (data && data.status === 'SUCCESS' && payload.gps && payload.gps.selfieBase64) {
          const attached = await uploadSelfie(payload.employeeId, payload.gps.selfieBase64, 'clockout');
          data._selfieAttached = attached;
        }
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
      case "getTodayAttendance": {
        const { data, error } = await sbClient.rpc('get_today_attendance', {
          p_employee_id: payload.employeeId
        });
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

async function uploadSelfie(employeeId, base64, eventType = 'clockin') {
  try {
    const blob = base64ToBlob(base64);
    const dateStr = getLocalDateString();
    // Unique per punch event: timestamp + event type prevents same-day
    // clock-in/clock-out selfies from colliding on the same storage path.
    const fileName = `selfies/${employeeId}_${dateStr}_${eventType}_${Date.now()}.webp`;

    // 1. Upload the file to Supabase Storage.
    const { error: uploadError } = await sbClient.storage
      .from('attendance-media')
      .upload(fileName, blob, { upsert: true, contentType: 'image/webp' });

    if (uploadError) {
      console.error("Selfie upload error:", uploadError);
      return false;
    }

    // 2. Resolve the public URL for the uploaded file.
    const { data: publicUrlData } = sbClient.storage
      .from('attendance-media')
      .getPublicUrl(fileName);
    const publicUrl = publicUrlData ? publicUrlData.publicUrl : null;

    // 3. Persist the URL via a SECURITY DEFINER RPC, NOT a direct
    // .from('attendance').update() call. The attendance table has RLS
    // enabled and direct table writes from the anon/authenticated client
    // are intentionally blocked - every mutation to this table goes
    // through a vetted RPC (see clock_in/clock_out/ping_location in
    // callAPI() above). attach_attendance_photo() must exist server-side
    // as a SECURITY DEFINER function for this call to succeed.
    if (publicUrl) {
      const { data: isAttached, error: rpcError } = await sbClient.rpc('attach_attendance_photo', {
        p_employee_id: employeeId,
        p_work_date: dateStr,
        p_photo_url: publicUrl,
        p_event_type: eventType
      });

      if (rpcError || !isAttached) {
        console.warn(`Selfie uploaded to storage, but failed to attach to attendance row (${eventType}):`, rpcError || 'Row not found');
        return false;
      }
      return true;
    }
    return false;
  } catch (e) {
    console.error("Upload failed:", e);
    return false;
  }
}

// Tracks a selfie that uploaded/attached successfully to Storage's bucket
// path but whose RPC attach step failed (or the base64 the user needs to
// retry with), so retrySelfiePhotoAttach() can re-attempt without forcing
// the employee to punch in/out again - the punch itself already succeeded.
let PENDING_SELFIE_RETRY = null; // { employeeId, base64, eventType } | null

function renderSelfieRetryPrompt(employeeId, base64, eventType) {
  PENDING_SELFIE_RETRY = { employeeId, base64, eventType };
  const btn = document.getElementById('retryPhotoUploadBtn');
  if (btn) {
    btn.style.display = 'inline-flex';
    btn.textContent = `⚠️ Retry ${eventType === 'clockout' ? 'Clock-Out' : 'Clock-In'} Photo Upload`;
  }
}

async function retrySelfiePhotoAttach() {
  if (!PENDING_SELFIE_RETRY) return;
  const { employeeId, base64, eventType } = PENDING_SELFIE_RETRY;
  const btn = document.getElementById('retryPhotoUploadBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Retrying...'; }

  const attached = await uploadSelfie(employeeId, base64, eventType);

  if (attached) {
    PENDING_SELFIE_RETRY = null;
    if (btn) btn.style.display = 'none';
    alert("Photo uploaded successfully.");
  } else {
    if (btn) {
      btn.disabled = false;
      btn.textContent = `⚠️ Retry ${eventType === 'clockout' ? 'Clock-Out' : 'Clock-In'} Photo Upload`;
    }
    alert("Photo upload failed again. Your Punch " + (eventType === 'clockout' ? 'Out' : 'In') + " time was still recorded correctly - only the photo is missing. Please try the retry button again, or contact admin if it keeps failing.");
  }
}

// Shift-completion badge shown near the Punch button. Green when the
// employee has completed the full 9-hour shift (measured from their own
// clock-in, not a fixed company-wide time), amber otherwise. Used both
// right after a clock-out (A.7) and when restoring today's status on
// page load/refresh (B.2), so the indicator persists across refreshes.
function renderShiftStatusBadge(shiftComplete, message) {
  const badge = document.getElementById('shiftStatusBadge');
  if (!badge) return;

  badge.textContent = message;
  badge.style.display = 'block';
  if (shiftComplete) {
    badge.style.background = '#f0fdf4';
    badge.style.color = '#15803d';
    badge.style.border = '1px solid #bbf7d0';
  } else {
    badge.style.background = '#fffbeb';
    badge.style.color = '#b45309';
    badge.style.border = '1px solid #fde68a';
  }
}

function hideShiftStatusBadge() {
  const badge = document.getElementById('shiftStatusBadge');
  if (badge) badge.style.display = 'none';
}


// Everything related to "who is logged in" and "which screen is visible"
// lives here, in one place, reading/writing SESSION_STORAGE_KEY only.
// This replaces the previous split between applySessionAndRenderApp /
// restoreSessionFromStorage / initSession / setupAuth, which wrote to two
// different localStorage keys and attached competing click handlers,
// causing the intermittent auto-logout / view-flicker bugs.

// Force-toggle the two top-level screens with !important so no leftover
// inline style or stylesheet rule can leave both (or neither) visible.
function applySessionUI(isLoggedIn) {
  const loginView = document.getElementById('loginView');
  const appLayout = document.getElementById('appLayout');

  if (isLoggedIn) {
    if (loginView) {
      loginView.classList.remove('active');
      loginView.style.setProperty('display', 'none', 'important');
    }
    if (appLayout) {
      appLayout.classList.add('active');
      appLayout.style.setProperty('display', 'flex', 'important');
    }
  } else {
    if (appLayout) {
      appLayout.classList.remove('active');
      appLayout.style.setProperty('display', 'none', 'important');
    }
    if (loginView) {
      loginView.classList.add('active');
      // Clear the forced inline value so the stylesheet's flexbox
      // centering for the login screen takes effect, per spec.
      loginView.style.removeProperty('display');
      loginView.style.setProperty('display', 'flex', 'important');
    }
  }
}

// Populate sidebar / header user info from whatever fields exist on the
// stored user object (RPC login returns name/role/employeeId; a minimal
// fallback object may only have employeeId).
function renderUserBadge(user) {
  if (!user) return;
  const displayName = user.name || user.fullName || user.employeeId || user.employee_id || '';
  const initial = displayName ? displayName.charAt(0).toUpperCase() : '?';

  const nameDisplay = document.getElementById('userNameDisplay');
  const roleBadge = document.getElementById('userRoleBadge');
  const userAvatar = document.getElementById('userAvatar');
  const mobileUserAvatar = document.getElementById('mobileUserAvatar');

  if (nameDisplay) nameDisplay.textContent = displayName;
  if (roleBadge) roleBadge.textContent = user.role || 'Employee';
  if (userAvatar) userAvatar.textContent = initial;
  if (mobileUserAvatar) mobileUserAvatar.textContent = initial;

  applyRoleBasedUIRestrictions(user.role);
}

// Restrict .admin-only UI elements based on the current user's role
function applyRoleBasedUIRestrictions(role) {
  const isAdmin = ['Admin', 'HR', 'Dev'].includes(role);
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });
}

// Single entry point used by both a fresh login and session restoration.
function applySessionAndRenderApp(user, persist) {
  window.CURRENT_USER = user;
  CURRENT_USER = user;

  if (persist) {
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
  }

  applySessionUI(true);
  renderUserBadge(user);

  // Kick off the geofence status check immediately on login/session
  // restore, rather than waiting for whatever view happens to be active
  // to trigger it - this is what previously left the status card stuck
  // on "Checking Location..." until the user manually navigated.
  checkGeofence();

  // Proactively ask for Location + Camera access right after login/session
  // restore, every single time the app opens - not just once ever. This is
  // what surfaces the OS permission dialogs upfront (or the persistent
  // warning banner if already denied) before the user ever reaches the
  // Punch In button, instead of the punch quietly failing mid-attempt.
  primeEssentialPermissions();

  // Sync the punch button state (Punch In vs Punch Out) against today's
  // actual attendance row immediately on login/session restore, so a
  // refreshed page or a re-login mid-shift doesn't show the wrong button.
  checkTodayAttendanceStatus();
}

// Attempt to restore an existing session from localStorage on page load.
// Runs once, from the single DOMContentLoaded initializer at the bottom of
// this file - no other init path should call this.
async function restoreSessionFromStorage() {
  try {
    const stored = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      applySessionUI(false);
      return;
    }
    const user = JSON.parse(stored);
    if (user && (user.employeeId || user.employee_id)) {
       const empId = user.employeeId || user.employee_id;

      // Check if session belongs to a completed shift via centralized callAPI
      const attData = await callAPI("getTodayAttendance", { employeeId: empId });
      if (attData && attData.length > 0 && attData[0].clock_in_time && attData[0].clock_out_time) {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        applySessionUI(false);
        const errorDiv = document.getElementById('loginError');
        if (errorDiv) {
          errorDiv.textContent = 'Your shift for today is completed. Login is restricted until tomorrow.';
          errorDiv.style.display = 'block';
        }
        return;
      }

      applySessionAndRenderApp(user, false);
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      applySessionUI(false);
    }
  } catch (e) {
    console.warn("Could not restore session:", e);
    localStorage.removeItem(SESSION_STORAGE_KEY);
    applySessionUI(false);
  }
}

// Real login: authenticates against the `login` RPC (employee_id/email +
// password) and only switches to the app workspace on a genuine success.
async function handleLogin(e) {
  if (e && e.preventDefault) e.preventDefault();

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
    const data = await callAPI("login", { employeeId: inputVal, password: password });

    if (!data || data.length === 0) {
      if (errorDiv) {
        errorDiv.textContent = 'Invalid Employee ID/Email or Password';
        errorDiv.style.display = 'block';
      }
      return;
    }

    const user = data[0];
    const empId = user.employeeId || user.employee_id;

    // SHIFT COMPLETION CHECK via centralized callAPI
    const attData = await callAPI("getTodayAttendance", { employeeId: empId });
    if (attData && attData.length > 0 && attData[0].clock_in_time && attData[0].clock_out_time) {
      if (errorDiv) {
        errorDiv.textContent = 'Your shift for today is completed. Login is restricted until tomorrow.';
        errorDiv.style.display = 'block';
      }
      return; // Block login access
    }

    applySessionAndRenderApp(user, true);
  } catch (err) {
    console.error("Login error:", err);
    if (errorDiv) {
      errorDiv.textContent = 'Login failed. Connection error.';
      errorDiv.style.display = 'block';
    }
  }
}

// Single logout path: clears all local session state, tears down live
// polling/timers, signs out of Supabase auth (best-effort), and restores
// the login screen without a full page reload (a reload was masking the
// fact that two different storage keys were being used).
async function handleLogout(e) {
  if (e && e.preventDefault) e.preventDefault();

  try {
    if (sbClient && sbClient.auth) {
      await sbClient.auth.signOut();
    }
  } catch (err) {
    console.warn('Supabase signout notice:', err);
  }

  CURRENT_USER = null;
  window.CURRENT_USER = null;
  localStorage.removeItem(SESSION_STORAGE_KEY);
  sessionStorage.clear();

  stopLocationPinging();
  stopLiveMapRefresh();
  stopAutoLogoutTimer();

  const loginEmpId = document.getElementById('loginEmpId');
  const loginPassword = document.getElementById('loginPassword');
  const loginError = document.getElementById('loginError');
  if (loginEmpId) loginEmpId.value = '';
  if (loginPassword) loginPassword.value = '';
  if (loginError) loginError.style.display = 'none';

  applySessionUI(false);
}

// Wires up #loginBtn / #loginForm / #logoutBtn exactly once. Intentionally
// does NOT register any supabase.auth.onAuthStateChange listener - that
// listener was the source of the unwanted auto-redirect-to-login loop,
// since it could fire and clear the session behind the unified manager's
// back. Session state is owned entirely by SESSION_STORAGE_KEY above.
function setupAuth() {
  const loginBtn = document.getElementById('loginBtn');
  const loginForm = document.getElementById('loginForm');
  const logoutBtn = document.getElementById('logoutBtn');

  if (loginBtn) loginBtn.onclick = handleLogin;
  if (loginForm) loginForm.onsubmit = handleLogin;
  if (logoutBtn) logoutBtn.onclick = handleLogout;
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

    .punch-success-overlay {
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.85);
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      z-index: 9999; opacity: 0; pointer-events: none;
      transition: opacity 0.3s ease;
    }
    .punch-success-overlay.show {
      opacity: 1; pointer-events: auto;
    }
    .success-checkmark {
      font-size: 3rem; color: #22c55e;
      background: #f0fdf4; border-radius: 50%;
      width: 90px; height: 90px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 1rem;
    }
    .success-text {
      font-size: 1.5rem; font-weight: bold; color: #ffffff;
    }
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
  const btn = document.getElementById('punchInBtn');
  if (btn) btn.classList.add('btn-pulsing');

  // Camera flash timed to coincide with the selfie snapshot moment.
  triggerCameraFlash();

  try {
    await handleClockIn();
  } finally {
    if (btn) btn.classList.remove('btn-pulsing');
    // .geofence-status-card is the actual wrapper class in index.html -
    // there's no separate #homeStatusCard ID to hang this off of.
    const statusCard = document.querySelector('.geofence-status-card');
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
  const id = CURRENT_USER ? (CURRENT_USER.employeeId || CURRENT_USER.employee_id) : "";
  if (!id) return;

  // Hard guard: don't let the punch attempt even start if we already know
  // location or camera access is blocked. Without this, the failure only
  // ever surfaced deep inside the try/catch below, after the user had
  // already gone through capturing a selfie - wasted effort and a confusing
  // late failure instead of a clear upfront one.
  if (!hasEssentialPermissions()) {
    renderPermissionBanner();
    alert("Punch In needs both Location and Camera access. Please tap 'Enable Now' in the banner at the top of the screen, then try again.");
    return;
  }

  if (!ATTENDANCE_SELFIE_BASE64) {
    alert("Please capture verification selfie first.");
    highlightSelfieCaptureCard();
    return;
  }

  const btn = document.getElementById('punchInBtn');
  if (!btn) return;

  // index.html ships the label as #punchBtnText inside #punchInBtn - no
  // need to synthesize a #homeClockBtnLabel span that never exists in the
  // markup (that legacy fallback was overwriting the button's real content).
  const btnLabel = document.getElementById('punchBtnText');

  // UI Loading State
  btn.classList.add('loading');
  if (btnLabel) btnLabel.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Verifying...';

  try {
    const pos = await getGpsPosition(10000);

    // clock_in RPC now returns a single JSON object:
    //   { status: 'SUCCESS', distance_m: 24.89 }
    //   { status: 'OUT_OF_RANGE', distance_m: 150.5 }
    //   { status: 'ERROR', message: '...' }
    // (previously an array-of-rows shape like res[0][0]/res[0][1]).
    const data = await callAPI("clockIn", {
      employeeId: id,
      gps: { lat: pos.coords.latitude, lng: pos.coords.longitude, selfieBase64: ATTENDANCE_SELFIE_BASE64 }
    });

    if (!data) {
      alert("Error clocking in. Please try again.");
      return;
    }

    if (data.status === 'SUCCESS') {
      // Prefer the server's own determination of Present/Late over the
      // wall-clock heuristic computed before we knew the response - the
      // backend is the source of truth for attendance_status.
      const serverIsLate = data.attendance_status === 'Late';
      startLocationPinging(id);

      // Anchor this employee's own 9-hour shift-end to the moment they
      // actually clocked in - this is what the early-departure guard in
      // handleClockOut() checks against, instead of a fixed company time.
      CURRENT_SHIFT_CLOCK_IN_TIME = new Date();

      // Clear any leftover Shift Complete/Incomplete badge from a previous
      // day's session - a fresh clock-in starts a new shift.
      hideShiftStatusBadge();

      // Hide preview thumbnail
      const selfiePreview = document.getElementById('selfiePreview');
      if (selfiePreview) selfiePreview.style.display = 'none';

      // Show Full-Screen Overlay Animation
      const lateSuffix = serverIsLate ? ' • (Late Punch)' : '';
      showPunchSuccess(`Distance from HQ: ${Math.round(data.distance_m)} meters${lateSuffix}`);
      updateHomeUI(true);
      renderPunchInSuccessCard(serverIsLate);
      startAutoLogoutTimer(10);

      // The photo attach step is tracked separately from the punch itself -
      // don't let a failed attach silently pass as if the selfie was saved.
      if (data._selfieAttached === false) {
        renderSelfieRetryPrompt(id, ATTENDANCE_SELFIE_BASE64, 'clockin');
        alert("Punch In was recorded, but your selfie photo failed to upload. Please tap 'Retry Photo Upload' below to try again.");
      } else {
        ATTENDANCE_SELFIE_BASE64 = null;
      }
    } else if (data.status === 'OUT_OF_RANGE') {
      const distanceInfo = (data.distance_m !== undefined && data.distance_m !== null)
        ? ` You are approximately ${Math.round(data.distance_m)} meters from DDC Safdarjung HQ (allowed radius: ${OFFICE_RADIUS_M}m).`
        : '';
      alert(`You're outside the office geofence.${distanceInfo} Please move within range of DDC Safdarjung HQ before punching in.`);
    } else if (data.status === 'ERROR') {
      alert(data.message || "Error clocking in. Please try again.");
    } else if (data.status === 'ALREADY_CLOCKED_IN') {
      alert("You have already clocked in today.");
    } else if (data.status === 'ALREADY_CLOCKED_OUT') {
      // Retained in case this status is ever reintroduced server-side;
      // not part of the current documented response set.
      alert("You have already completed your attendance for today (clocked in and out). You cannot clock in again.");
    } else if (data.status) {
      // Any other status string the RPC returns - surfaced verbatim so
      // nothing silently fails, but framed clearly as a server message.
      alert(`Unable to clock in: ${data.status}`);
    } else {
      alert("Error clocking in. Please try again.");
    }
  } catch (e) {
    alert("Location permission required to clock in.");
  } finally {
    btn.classList.remove('loading');
    if (btnLabel) btnLabel.textContent = 'Punch In Now';
  }
}

// ==========================================================================
// GOOGLE SHEETS SYNC INTEGRATION
// ==========================================================================
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

// Alias kept for markup that still calls handlePunchIn() directly.
async function handlePunchIn() {
  return handleClockIn();
}

async function handleClockOut() {
  const id = CURRENT_USER ? (CURRENT_USER.employeeId || CURRENT_USER.employee_id) : "";
  if (!id) return;

  if (!hasEssentialPermissions()) {
    renderPermissionBanner();
    alert("Punch Out needs both Location and Camera access. Please tap 'Enable Now' in the banner at the top of the screen, then try again.");
    return;
  }

  if (!ATTENDANCE_SELFIE_BASE64) {
    alert("Please capture verification selfie before clocking out.");
    highlightSelfieCaptureCard();
    return;
  }

  // Early-departure guard: each employee's shift is 9 hours measured from
  // their OWN clock-in time, not a fixed company-wide clock time - someone
  // who clocked in at 10:00, 10:30, or 11:00 all need their own 9 hours.
  // This mirrors the same rule already enforced server-side (shift_complete/
  // shift_message in the clock_out RPC response) so the confirmation
  // dialog and the actual server outcome never disagree.
  if (CURRENT_SHIFT_CLOCK_IN_TIME) {
    const shiftEndForThisEmployee = new Date(CURRENT_SHIFT_CLOCK_IN_TIME.getTime() + 9 * 60 * 60 * 1000);
    const isEarly = new Date() < shiftEndForThisEmployee;

    if (isEarly) {
      const remainingMs = shiftEndForThisEmployee - new Date();
      const remainingMins = Math.max(0, Math.round(remainingMs / 60000));
      const remainingH = Math.floor(remainingMins / 60);
      const remainingM = remainingMins % 60;
      const remainingStr = remainingH > 0 ? `${remainingH}h ${remainingM}m` : `${remainingM}m`;

      const confirmedEarlyOut = confirm(
        `You haven't completed your 9-hour shift yet (${remainingStr} remaining). Are you sure you want to clock out early?`
      );
      if (!confirmedEarlyOut) return;
    }
  }
  // If CURRENT_SHIFT_CLOCK_IN_TIME is somehow unknown (e.g. stale session
  // state), skip the client-side confirmation entirely rather than guess -
  // the clock_out RPC's own shift_complete/shift_message response remains
  // the authoritative source of truth either way.

  const btn = document.getElementById('punchInBtn');
  if (!btn) return;

  btn.classList.add('loading');
  setButtonLabel(btn, "Clocking Out...");

  try {
    const pos = await getGpsPosition(10000);

    const res = await callAPI("clockOut", {
      employeeId: id,
      gps: {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        selfieBase64: ATTENDANCE_SELFIE_BASE64
      }
    });

    if (!res) {
      alert("Error clocking out. Please try again.");
      return;
    }

    if (res.status === 'SUCCESS') {
      stopLocationPinging();
      CURRENT_SHIFT_CLOCK_IN_TIME = null;

      const selfiePreview = document.getElementById('selfiePreview');
      if (selfiePreview) selfiePreview.style.display = 'none';

      showPunchSuccess(`Hours worked: ${res.hours_worked} hrs`, "Clocked Out Successfully!");
      // renderPunchOutSuccessCard() sets the red PUNCH OUT SUCCESSFUL!
      // card state and calls updateHomeUI(false) itself.
      renderPunchOutSuccessCard(res.hours_worked);
      startAutoLogoutTimer(10);

      // shift_message/shift_complete come straight from the clock_out RPC
      // (e.g. "Shift Incomplete - only 6.25 of 9 hours completed." or
      // "Shift Complete - 9 hours fulfilled.") - shown verbatim so the
      // wording always matches whatever ops configures server-side.
      if (res.shift_message) {
        renderShiftStatusBadge(!!res.shift_complete, res.shift_message);
      }

      // Same rule as handleClockIn(): a failed photo attach must not be
      // treated as if the selfie was saved, even though the punch itself
      // already succeeded.
      if (res._selfieAttached === false) {
        renderSelfieRetryPrompt(id, ATTENDANCE_SELFIE_BASE64, 'clockout');
        alert("Punch Out was recorded, but your selfie photo failed to upload. Please tap 'Retry Photo Upload' below to try again.");
      } else {
        ATTENDANCE_SELFIE_BASE64 = null;
      }

      // --- GOOGLE SHEETS SYNC (PUNCH OUT) ---
      syncToGoogleSheets({
        record_id: id,
        employee_id: id,
        employee_name: CURRENT_USER ? (CURRENT_USER.fullName || CURRENT_USER.name || "") : "",
        punch_out_time: new Date().toISOString(),
        punch_out_address: `${pos.coords.latitude}, ${pos.coords.longitude}`
      });

    } else if (res.status === 'OUT_OF_RANGE') {
      // Use the server's own wording verbatim - this is deliberately a
      // different, more specific message than clock-in's generic
      // out-of-geofence alert, since ops wants employees to see the exact
      // clock-out phrasing (it explains the 9-hour shift consequence too).
      alert(res.message || `You're outside the office geofence. Please move within range of DDC Safdarjung HQ before punching out.`);
    } else if (res.status === 'NO_CLOCK_IN') {
      alert("You haven't clocked in yet today. Please clock in before attempting to clock out.");
    } else if (res.status === 'ALREADY_CLOCKED_OUT') {
      alert("You have already clocked out for today.");
    } else {
      alert(`Unable to clock out: ${res.status || 'Unknown error'}`);
    }
  } catch (e) {
    console.error("Clock out error:", e);
    alert("Location permission required or error occurred during clock out.");
  } finally {
    btn.classList.remove('loading');
  }
}

// Full-screen overlay animation helper. titleText defaults to the clock-in
// wording so existing handleClockIn() calls (which only pass distanceText)
// keep working unchanged; handleClockOut() passes its own title explicitly.
function showPunchSuccess(distanceText, titleText = "Clocked In Successfully!") {
  let overlay = document.getElementById('punchSuccessOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'punchSuccessOverlay';
    overlay.className = 'punch-success-overlay';
    overlay.innerHTML = `
        <div class="success-checkmark">
            <i class="fas fa-check"></i>
        </div>
        <div id="punchSuccessText" class="success-text"></div>
        <div id="punchSuccessSubtext" class="text-secondary mt-2 small"></div>
    `;
    document.body.appendChild(overlay);
  }

  const titleEl = document.getElementById('punchSuccessText');
  if (titleEl) titleEl.innerText = titleText;

  const subtext = document.getElementById('punchSuccessSubtext');
  if (subtext) subtext.innerText = distanceText;

  overlay.classList.add('show');
  setTimeout(() => overlay.classList.remove('show'), 2500);
}

// Small helper used by handleClockIn()/handleClockOut() to update the main
// punch button's label text without clobbering the button itself - targets
// #punchBtnText (the actual span index.html ships inside #punchInBtn),
// falling back to the button's own text content if that span is absent.
function setButtonLabel(btn, text) {
  const btnLabel = document.getElementById('punchBtnText');
  if (btnLabel) {
    btnLabel.innerText = text;
  } else if (btn) {
    btn.innerText = text;
  }
}

// Draws attention back to the selfie-capture card when handleClockIn() or
// handleClockOut() is blocked because ATTENDANCE_SELFIE_BASE64 is empty -
// scrolls it into view and briefly reuses the existing .pulse-glow
// keyframe animation already defined in styles.css, so no new CSS is
// required.
function highlightSelfieCaptureCard() {
  const card = document.querySelector('.camera-verification-card');
  if (!card) return;

  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('pulse-glow');
  setTimeout(() => card.classList.remove('pulse-glow'), 2200);
}

// ==========================================================================
// AUTO-LOGOUT COUNTDOWN (fires after a successful Punch In / Punch Out)
// ==========================================================================
function startAutoLogoutTimer(seconds = 10) {
  stopAutoLogoutTimer(); // Clear any existing timer instance

  let timeLeft = seconds;
  let banner = document.getElementById('autoLogoutBanner');

  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'autoLogoutBanner';
    banner.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #0f172a;
      color: #ffffff;
      padding: 12px 24px;
      border-radius: 50px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      z-index: 10000;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 12px;
      border: 1px solid #334155;
    `;
    document.body.appendChild(banner);
  }

  // Pure countdown display — "Stay Logged In" button removed
  banner.innerHTML = `
    <span><i class="fas fa-clock text-warning me-2"></i> Logging out automatically in <b id="logoutTimerCount" class="text-warning">${timeLeft}</b>s...</span>
  `;
  banner.style.display = 'flex';

  autoLogoutInterval = setInterval(() => {
    timeLeft--;
    const countEl = document.getElementById('logoutTimerCount');
    if (countEl) countEl.innerText = timeLeft;

    if (timeLeft <= 0) {
      stopAutoLogoutTimer();
      handleLogout();
    }
  }, 1000);
}

function stopAutoLogoutTimer() {
  if (autoLogoutInterval) {
    clearInterval(autoLogoutInterval);
    autoLogoutInterval = null;
  }
  const banner = document.getElementById('autoLogoutBanner');
  if (banner) banner.remove();
}

// Green "Punch In Successful" card + metric + button treatment described in spec
function renderPunchInSuccessCard(isLate = false) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Increment present-count metric
  const presentCountEl = document.getElementById('presentCount');
  if (presentCountEl) {
    const current = parseInt(presentCountEl.innerText, 10) || 0;
    presentCountEl.innerText = current + 1;
  }

  // Canonical IDs only - index.html ships #geofenceIcon/#geofenceTitle/
  // #geofenceSubtitle inside .geofence-status-card. The old #homeStatus*
  // fallbacks never matched anything in the markup and are removed.
  const titleEl = document.getElementById('geofenceTitle');
  const subtitleEl = document.getElementById('geofenceSubtitle');
  const iconEl = document.getElementById('geofenceIcon');

  if (titleEl) {
    titleEl.textContent = 'PUNCH IN SUCCESSFUL!';
    titleEl.style.color = '#15803d';
  }
  if (subtitleEl) {
    // Subtle late-punch flag: same layout, just an appended note and a
    // warm amber tint instead of the default muted gray.
    subtitleEl.textContent = isLate
      ? `Clocked in at ${timeStr} today (Late Punch)`
      : `Clocked in at ${timeStr} today`;
    subtitleEl.style.color = isLate ? '#b45309' : '';
  }
  if (iconEl) iconEl.textContent = '✅';

  // Bounce the surrounding card - .geofence-status-card is the actual
  // wrapper class, there's no separate #homeStatusCard/#geofenceCard ID.
  const statusCard = titleEl ? titleEl.closest('.geofence-status-card') : null;
  if (statusCard) {
    statusCard.style.background = '#f0fdf4';
    statusCard.style.borderColor = '#bbf7d0';
    statusCard.classList.add('success-bounce');
    setTimeout(() => statusCard.classList.remove('success-bounce'), 500);
  }

  // Transform the main clock button - #punchInBtn is the only button ID
  // that exists in index.html.
  const btn = document.getElementById('punchInBtn');
  const btnLabel = document.getElementById('punchBtnText');
  if (btn) {
    btn.style.background = 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)';
    btn.style.border = 'none';
  }
  if (btnLabel) btnLabel.innerText = '✓ CLOCKED IN TODAY';

  // --- GOOGLE SHEETS SYNC (PUNCH IN) ---
  if (CURRENT_USER) {
    syncToGoogleSheets({
      record_id: CURRENT_USER.employeeId || CURRENT_USER.employee_id || "",
      employee_id: CURRENT_USER.employeeId || CURRENT_USER.employee_id || "",
      employee_name: CURRENT_USER.fullName || CURRENT_USER.name || "",
      punch_in_time: new Date().toISOString()
    });
  }
}

// Red "Punch Out Successful" card + button treatment - the clock-out
// counterpart to renderPunchInSuccessCard(). Clears every green/clocked-in
// visual state left over from punch-in so the UI can never show
// "PUNCH IN SUCCESSFUL!" or the green button style after a punch-out.
function renderPunchOutSuccessCard(hoursWorked) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const titleEl = document.getElementById('geofenceTitle');
  const subtitleEl = document.getElementById('geofenceSubtitle');
  const iconEl = document.getElementById('geofenceIcon');

  if (titleEl) {
    titleEl.textContent = 'PUNCH OUT SUCCESSFUL!';
    titleEl.style.color = '#dc2626';
  }
  if (subtitleEl) {
    subtitleEl.textContent = `Clocked out at ${timeStr} today (${hoursWorked} hrs worked)`;
    subtitleEl.style.color = '';
  }
  if (iconEl) iconEl.textContent = '🏁';

  const statusCard = titleEl ? titleEl.closest('.geofence-status-card') : null;
  if (statusCard) {
    // Red card treatment, replacing any green background left by
    // renderPunchInSuccessCard() earlier in the same shift.
    statusCard.style.background = '#fef2f2';
    statusCard.style.borderColor = '#fecaca';
    statusCard.classList.add('success-bounce');
    setTimeout(() => statusCard.classList.remove('success-bounce'), 500);
  }

  // Shift is now fully complete for today (clock_in_time AND clock_out_time
  // both exist) - disable the button rather than reverting to a re-clickable
  // "Punch In Now" state, so the employee can't punch in again same day.
  updateHomeUI(false, true);
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
async function checkGeofence() {
  const title = document.getElementById('geofenceTitle');
  const subtitle = document.getElementById('geofenceSubtitle');
  const icon = document.getElementById('geofenceIcon');

  if (!navigator.geolocation) {
    if (title) title.textContent = "GPS Unavailable";
    if (subtitle) subtitle.textContent = "Geolocation is not supported by your browser.";
    return;
  }

  try {
    // getGpsPosition() gives desktop/incognito browsers (which often lack
    // a real GPS chip and fall back to slow Wi-Fi/IP based positioning) a
    // fast high-accuracy attempt followed by a longer low-accuracy retry,
    // instead of failing outright on a single 5s high-accuracy timeout.
    const pos = await getGpsPosition(8000);

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
  } catch (err) {
    console.warn("Location prompt or signal timeout:", err);
    if (icon) icon.textContent = "📍";
    if (title) title.textContent = "GPS Location Pending";
    if (subtitle) subtitle.textContent = "Please allow location access in your browser bar";
  }
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
  const navItems = document.querySelectorAll('.sidebar-nav .nav-item[data-view], .bottom-nav .bottom-nav-item[data-view]');
  const appViews = document.querySelectorAll('.app-view');
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const menuToggleBtn = document.getElementById('menuToggleBtn');
  const bottomMoreBtn = document.getElementById('bottomMoreBtn');

  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetViewId = item.getAttribute('data-view');
      if (!targetViewId) return;

      // Keep the sidebar and the bottom nav in sync: whichever one was
      // clicked, mirror the active state across BOTH navigation surfaces.
      navItems.forEach(nav => {
        nav.classList.toggle('active', nav.getAttribute('data-view') === targetViewId);
      });

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

  // "More" tab in the mobile bottom nav opens the same drawer used by the
  // hamburger button, so overflow items (Analytics, Payroll, GPS Map,
  // Settings, Sign Out) stay reachable without crowding the bottom bar.
  if (bottomMoreBtn) {
    bottomMoreBtn.addEventListener('click', () => {
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

// ==========================================================================
// PUNCH STATUS & UI SYNC HELPERS
// ==========================================================================

// Checks Supabase on login/refresh to see if the employee has already clocked
// in today, and resolves one of three states:
//   A) Not clocked in yet             -> plain "Punch In Now" button
//   B) Active shift (in, no out)      -> red "Punch Out Now" button
//   C) Shift completed (in AND out)   -> red completed card, button disabled
async function checkTodayAttendanceStatus() {
  if (!CURRENT_USER) return;
  const empId = CURRENT_USER.employeeId || CURRENT_USER.employee_id;

  try {
    const data = await callAPI("getTodayAttendance", { employeeId: empId });
    const row = data && data.length > 0 ? data[0] : null;

    if (row && row.clock_in_time && row.clock_out_time) {
      // State C: Shift completed today
      CURRENT_SHIFT_CLOCK_IN_TIME = null;
      renderPunchOutSuccessCard(row.hours_worked ?? '--');

      // Persist the same Shift Complete/Incomplete indicator shown right
      // after clocking out (A.7) across page refreshes and re-logins too -
      // get_today_attendance only returns hours_worked, not the RPC's own
      // shift_message string, so the wording is reconstructed client-side
      // in the same style the backend uses.
      if (typeof row.hours_worked === 'number') {
        const shiftComplete = row.hours_worked >= 9;
        const message = shiftComplete
          ? `Shift Complete - ${row.hours_worked} hours fulfilled.`
          : `Shift Incomplete - only ${row.hours_worked} of 9 hours completed.`;
        renderShiftStatusBadge(shiftComplete, message);
      }
    } else if (row && row.clock_in_time && !row.clock_out_time) {
      // State B: Currently clocked in - restore the shift's own clock-in
      // time so the early-departure guard works correctly after a page
      // refresh or re-login, not just within the same session as the punch.
      CURRENT_SHIFT_CLOCK_IN_TIME = new Date(row.clock_in_time);
      hideShiftStatusBadge();
      updateHomeUI(true);
    } else {
      // State A: Not clocked in yet
      CURRENT_SHIFT_CLOCK_IN_TIME = null;
      hideShiftStatusBadge();
      updateHomeUI(false);
    }
  } catch (e) {
    console.warn("Could not fetch today's punch status via callAPI:", e);
    updateHomeUI(false);
  }
}

function updateHomeUI(isClockedIn, isCompleted = false) {
  // #punchInBtn / #punchBtnText are the only button IDs index.html ships.
  const btn = document.getElementById('punchInBtn');
  const btnLabel = document.getElementById('punchBtnText');
  const timerChip = document.getElementById('timerChip');

  if (isCompleted) {
    // State C: clock_in_time AND clock_out_time both exist for today -
    // lock the button so the employee can't punch in again same day.
    if (btn) {
      btn.onclick = null;
      btn.disabled = true;
      btn.style.background = 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)';
      btn.style.border = 'none';
      btn.style.cursor = 'not-allowed';
      btn.style.opacity = '0.75';
    }
    if (btnLabel) {
      btnLabel.innerText = 'Shift Completed Today';
    } else if (btn) {
      btn.innerText = 'Shift Completed Today';
    }
    if (timerChip) timerChip.style.display = 'none';
    return;
  }

  if (btn) {
    btn.disabled = false;
    btn.style.cursor = '';
    btn.style.opacity = '';
  }

  if (isClockedIn) {
    if (btn) {
      btn.onclick = handleClockOut;
      btn.style.background = 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)'; // Red button
      btn.style.border = 'none';
    }
    if (btnLabel) {
      btnLabel.innerText = "Punch Out Now";
    } else if (btn) {
      btn.innerText = "Punch Out Now";
    }
    if (timerChip) timerChip.style.display = 'inline-block';
  } else {
    if (btn) {
      btn.onclick = handlePunchInAnimated;
      btn.style.background = ''; // Revert to default stylesheet theme
      btn.style.border = ''; // Clear any red/green border left by success cards
    }
    if (btnLabel) {
      btnLabel.innerText = "Punch In Now";
    } else if (btn) {
      btn.innerText = "Punch In Now";
    }
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
// SINGLE INITIALIZATION ENTRY POINT
// ==========================================================================
// Everything the app needs to wire up on load lives in this one listener.
// Earlier versions of this file registered several competing
// DOMContentLoaded handlers (one for login, one for logout, one for
// "bulletproof" session init) that each manipulated #loginView/#appLayout
// independently - that's what produced the auto-logout loop and the view
// getting stuck in the wrong state. Now there is exactly one.
function initApp() {
  // Inject shimmer/transition/animation CSS used by the enhancements above
  injectUiEnhancementStyles();

  // Auth: login/logout buttons + form, wired exactly once
  setupAuth();

  // Webcam capture button
  const captureBtn = document.getElementById('captureBtn');
  if (captureBtn) captureBtn.addEventListener('click', handleCaptureSelfie);

  // Punch-in button: no addEventListener here. updateHomeUI() is the
  // single source of truth for the click handler via btn.onclick, and it
  // always runs (through checkTodayAttendanceStatus()) right after login/
  // session restore. A stacked addEventListener + onclick previously
  // caused BOTH handlePunchInAnimated() and the onclick handler (e.g.
  // handleClockOut) to fire on a single click.

  // Employee autocomplete on login screen
  initSuggestions();

  // Sidebar / mobile drawer navigation
  initNavigation();

  // Official shift-timing subtext under the geofence card
  renderShiftGuidanceBadge();

  // iOS Safari is known to reset camera/location permissions for installed
  // home-screen PWAs more aggressively than Android Chrome - re-verifying
  // every time the app regains focus (not just once at login) is what
  // catches that case before the user hits Punch In/Out and it fails.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && CURRENT_USER) {
      refreshPermissionStates();
    }
  });

  // Restore a previously active session (or show the login screen) - the
  // one and only place session state is read on page load.
  restoreSessionFromStorage();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}