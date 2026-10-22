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
      if (c === '42501' || /FORBIDDEN/.test(m)) throw new Error('Only Admin, HR and Dev accounts can use the dashboard.');
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
    if (ADMIN_ROLES.indexOf(d.role) < 0) {
      try { await sb.rpc('app_logout', { p_token: d.token }); } catch (x) {}
      throw new Error('This dashboard is for Admin, HR and Dev accounts. Use the mobile app to mark attendance.');
    }
    saveUser({ token: d.token, employeeId: d.employee_id, name: d.employee_name, role: d.role });
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

  window.StafflyAPI = { call: call, login: login, logout: logout, goMobile: goMobile, user: function () { return USER; } };

  document.addEventListener('DOMContentLoaded', function () {
    var m = document.getElementById('mobBtn'), o = document.getElementById('outBtn');
    if (m) m.addEventListener('click', goMobile);
    if (o) o.addEventListener('click', logout);
  });
})();
