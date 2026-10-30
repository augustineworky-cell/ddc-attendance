/* Staffly dashboard - server adapter.
 * The dashboard screens call functions like webRange / webCalendar / webAdminSetDay.
 * This file turns each one into a Staffly (Supabase) RPC, using the person's Staffly login session. */
(function () {
  'use strict';
  var SB_URL = 'https://bpwpxhsdmbkymhpjsfej.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwd3B4aHNkbWJreW1ocGpzZmVqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NDUzNzIsImV4cCI6MjEwNDUyMTM3Mn0.XnXF9kqp0g6xQwZpjPC6tUhLGNI1T29i02DQGjNYG2M';
  var SKEY = 'STAFFLY_DASH', MODE_KEY = 'staffly_view_mode', ADMIN_ROLES = ['Admin', 'HR', 'Dev'];
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

  function loadUser() { try { var j = sessionStorage.getItem(SKEY); if (j) return JSON.parse(j); } catch (e) {} return null; }
  var USER = loadUser();
  function saveUser(u) { USER = u; try { if (u) sessionStorage.setItem(SKEY, JSON.stringify(u)); else sessionStorage.removeItem(SKEY); } catch (e) {} }
  function lock() { var x = new Error('Sign in to continue'); x.code = 'SITE_LOCKED'; return x; }

  async function rpc(name, params) {
    var r = await sb.rpc(name, params);
    if (r.error) {
      var m = String(r.error.message || ''), c = String(r.error.code || '');
      if (/AUTH_EXPIRED/.test(m)) throw new Error('AUTH_EXPIRED');
      if (c === '42501' || /FORBIDDEN/.test(m)) throw new Error('You do not have access to that.');
      if (c === '28000' || /SESSION_INVALID|INVALID_TOKEN|SESSION_EXPIRED|NOT_AUTHENTICATED|UNAUTHORI[SZ]ED/i.test(m)) { saveUser(null); throw lock(); }
      throw new Error(m || 'Request failed');
    }
    return r.data;
  }
  function tok() { if (!USER || !USER.token) throw lock(); return USER.token; }

  async function login(id, pw) {
    if (!id || !pw) throw new Error('Enter your Employee ID and password');
    var r;
    try { r = await sb.rpc('app_login', { p_employee_id: id, p_password: pw }); } catch (e) { throw new Error('No internet connection. Try again.'); }
    if (r.error) throw new Error('Could not sign in. Check your connection and try again.');
    var d = r.data || {};
    if (d.status === 'LOCKED') throw new Error('Too many wrong attempts. Try again in ' + (d.retry_after_minutes || 15) + ' minutes.');
    if (d.status === 'APP_PAUSED') throw new Error(d.message || 'The app is paused right now.');
    if (d.status !== 'SUCCESS') throw new Error('Incorrect Employee ID or password.');
    saveUser({ token: d.token, employeeId: d.employee_id, name: d.employee_name, role: d.role });
  }

  /* ---- 4-digit PIN for this computer (same idea as the phone app) ---- */
  var DEV_KEY = 'STAFFLY_DASH_DEV';
  function getDevice() { try { var j = localStorage.getItem(DEV_KEY); return j ? JSON.parse(j) : null; } catch (e) { return null; } }
  function setDevice(d) { try { if (d) localStorage.setItem(DEV_KEY, JSON.stringify(d)); else localStorage.removeItem(DEV_KEY); } catch (e) {} }
  async function loginPin(pin) {
    var dev = getDevice(); if (!dev) throw new Error('NO_DEVICE');
    if (!/^\d{4}$/.test(pin || '')) throw new Error('Enter your 4-digit PIN.');
    var r;
    try { r = await sb.rpc('app_login_pin', { p_device_secret: dev.secret, p_pin: pin }); } catch (e) { throw new Error('No internet connection. Try again.'); }
    if (r.error) throw new Error('Could not sign in. Check your connection and try again.');
    var d = r.data || {};
    if (d.status === 'INVALID_DEVICE') { setDevice(null); var e1 = new Error('This computer is no longer registered. Sign in with your ID and password.'); e1.code = 'NO_DEVICE'; throw e1; }
    if (d.status === 'PIN_LOCKED') { setDevice(null); var e2 = new Error('PIN locked after too many wrong tries. Sign in with your ID and password.'); e2.code = 'NO_DEVICE'; throw e2; }
    if (d.status === 'APP_PAUSED') throw new Error(d.message || 'The app is paused right now.');
    if (d.status === 'INVALID_PIN') throw new Error('Wrong PIN. ' + (d.attempts_left != null ? d.attempts_left + ' tries left.' : ''));
    if (d.status !== 'SUCCESS') throw new Error('Could not sign in.');
    saveUser({ token: d.token, employeeId: d.employee_id, name: d.employee_name, role: d.role });
  }
  async function setPin(pin) {
    if (!USER) throw lock();
    if (!/^\d{4}$/.test(pin || '')) throw new Error('PIN must be exactly 4 digits.');
    var r = await sb.rpc('app_register_device', { p_token: USER.token, p_pin: pin, p_label: 'Desktop dashboard' });
    if (r.error) throw new Error('Could not save the PIN. Try again.');
    var d = r.data || {};
    if (d.status !== 'SUCCESS') throw new Error(d.message || 'Could not save the PIN.');
    setDevice({ secret: d.device_secret, id: d.employee_id, name: d.employee_name });
  }
  async function logout() {
    var t = USER && USER.token; saveUser(null);
    if (t) { try { await sb.rpc('app_logout', { p_token: t }); } catch (e) {} }
    location.reload();
  }
  function goMobile() { try { localStorage.setItem(MODE_KEY, 'mobile'); } catch (e) {} location.href = 'index.html'; }

  var CALLS = {
    webEmployees: function () { return rpc('dash_employees', { p_token: tok() }); },
    webRange: function (a) { return rpc('dash_range', { p_token: tok(), p_from: a[0], p_to: a[1] }); },
    webCalendar: function (a) { return rpc('dash_calendar', { p_token: tok(), p_emp: +a[0], p_month: a[1] }); },
    webDayPunches: function (a) { return rpc('dash_day_punches', { p_token: tok(), p_emp: +a[0], p_date: a[1] }); },
    webApprMe: function () { return rpc('dash_appr_me', { p_token: tok() }); },
    webApprStaff: function () { return rpc('dash_appr_staff', { p_token: tok() }); },
    webApprList: function () { return rpc('dash_appr_list', { p_token: tok() }); },
    webApprRequest: function (a) { return rpc('dash_appr_request', { p_token: tok(), p_emp: +a[0], p_date: a[1], p_kind: a[2], p_reason: a[3] }); },
    webApprDecide: function (a) { return rpc('dash_appr_decide', { p_token: tok(), p_id: +a[0], p_decision: a[1], p_note: a[2] || null }); },
    webApprCancel: function (a) { return rpc('dash_appr_cancel', { p_token: tok(), p_id: +a[0] }); },
    webAdminLogin: async function (a) {
      var d = await rpc('dash_admin_login', { p_token: tok(), p_password: a[0] || '' });
      if (d && d.error) throw new Error(d.error);
      return d;
    },
    webAdminPunches: function (a) { return rpc('dash_admin_punches', { p_token: tok(), p_emp: +a[1], p_date: a[2] }); },
    webAdminSetDay: function (a) { return rpc('dash_admin_set_day', { p_token: tok(), b: a[1] }); },
    webAdminClearDay: function (a) { return rpc('dash_admin_clear_day', { p_token: tok(), b: a[1] }); },
    webAdminAddEmployee: function (a) { return rpc('dash_admin_add_employee', { p_token: tok(), b: a[1] }); },
    webAdminRemoveEmployee: function (a) { return rpc('dash_admin_remove_employee', { p_token: tok(), b: a[1] }); },
    webAdminRestoreEmployee: function (a) { return rpc('dash_admin_restore_employee', { p_token: tok(), b: a[1] }); },
    webAdminExportMonth: async function (a) {
      var d = await rpc('dash_admin_export_data', { p_token: tok(), p_month: a[1] });
      return window.DashExport.build(d);
    },
    webAdminSalaryMonth: async function (a) {
      var d = await rpc('dash_admin_salary_data', { p_token: tok(), p_month: a[1] });
      if (d && d.setup_needed) return { setup_needed: true, month: a[1] };
      var res = window.DashSalary.buildMonth({ month: d.month, emps: d.emps || [], salaries: d.salaries || [], rows: d.rows || [] });
      res.today = d.today; res.salaries_loaded = (d.salaries || []).length;
      return res;
    }
  };

  async function call(fn, args) {
    var f = CALLS[fn];
    if (!f) throw new Error('Unknown action: ' + fn);
    return f(args || []);
  }

  window.StafflyAPI = { call: call, login: login, loginPin: loginPin, setPin: setPin, device: getDevice, forgetDevice: function () { setDevice(null); }, isAdmin: function () { return !!USER && ADMIN_ROLES.indexOf(USER.role) >= 0; },  logout: logout, goMobile: goMobile, user: function () { return USER; } };

  document.addEventListener('DOMContentLoaded', function () {
    var m = document.getElementById('mobBtn'), o = document.getElementById('outBtn');
    if (m) m.addEventListener('click', goMobile);
    if (o) o.addEventListener('click', logout);
  });
})();
