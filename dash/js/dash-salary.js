/* Salary preview maths (ported 1:1 from the old server code). */
(function () {
'use strict';
const DAY = 86400000;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const t0 = (d) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/** Calendar rows of one employee (any order, may include days just outside the month, for the leave rule). */
function calcEmployee(salary, rows, month) {
  const dim = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 0)).getUTCDate();
  const perDay = salary / dim;
  const byDate = {};
  rows.forEach((r) => { byDate[r.work_date] = r.status; });
  const dates = Object.keys(byDate).sort();
  const isOff = (s) => s === 'Sunday' || s === 'Holiday';

  // nearest working day (not Sunday/Holiday) on each side of a date, looking across the whole fetched window
  function neighbour(date, step) {
    let t = t0(date) + step * DAY;
    const lo = t0(dates[0]), hi = t0(dates[dates.length - 1]);
    while (t >= lo && t <= hi) {
      const s = byDate[ymd(t)];
      if (s === undefined) return null;          // not employed / no data that day
      if (!isOff(s)) return s;
      t += step * DAY;
    }
    return null;
  }

  const c = { present: 0, half: 0, extra: 0, absent: 0, holiday: 0, sunday_paid: 0, sunday_unpaid: 0, missing: 0, in_progress: 0 };
  let paid = 0, extraDays = 0;
  const unpaidSundays = [];
  const strip = [];   // one letter per day of the month: P present, H half, E extra, A absent, S paid Sunday, X unpaid Sunday, O holiday, M missing punch, I in progress, - no data
  for (let i = 1; i <= dim; i++) strip.push('-');
  dates.forEach((d) => {
    if (d.slice(0, 7) !== month) return;
    const s = byDate[d], at = +d.slice(8, 10) - 1;
    const put = (ch) => { strip[at] = ch; };
    if (s === 'Present') { c.present++; paid += 1; put('P'); }
    else if (s === 'Half Day') { c.half++; paid += 0.5; put('H'); }
    else if (s === 'Extra Day') { c.extra++; paid += 1; extraDays += 1; put('E'); }
    else if (s === 'Absent') { c.absent++; put('A'); }
    else if (s === 'Holiday') { c.holiday++; paid += 1; put('O'); }
    else if (s === 'Sunday') {
      if (neighbour(d, -1) === 'Absent' && neighbour(d, 1) === 'Absent') { c.sunday_unpaid++; unpaidSundays.push(d); put('X'); }
      else { c.sunday_paid++; paid += 1; put('S'); }
    }
    else if (s === 'Missing Punch') { c.missing++; paid += 1; put('M'); }
    else if (s === 'In Progress') { c.in_progress++; paid += 1; put('I'); }
  });
  const base = perDay * paid;                       // paid already includes the Extra Day's own day
  const extraPay = perDay * extraDays;
  return Object.assign(c, {
    days_in_month: dim, per_day: round2(perDay), paid_days: round2(paid), extra_days_pay: round2(extraDays),
    base_pay: Math.round(base), extra_pay: Math.round(extraPay), total: Math.round(base + extraPay), unpaid_sundays: unpaidSundays, strip: strip.join(''),
  });
}
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * emps: [{id,name,location,active}], salaries: [{employee_id,monthly_salary}], rows: v_daily_attendance rows
 * (employee_id, work_date, status) covering the month plus a few days either side.
 */
function buildMonth({ month, emps, salaries, rows }) {
  const sal = {}; salaries.forEach((s) => { sal[s.employee_id] = +s.monthly_salary; });
  const by = {}; rows.forEach((r) => { (by[r.employee_id] = by[r.employee_id] || []).push(r); });
  const out = [], noSalary = [];
  emps.forEach((e) => {
    const mine = (by[e.id] || []).filter((r) => r.work_date.slice(0, 7) === month);
    if (!mine.length) return;                          // no attendance this month: nothing to pay
    if (!(sal[e.id] > 0)) { noSalary.push({ id: e.id, name: e.name, location: e.location }); return; }
    const r = calcEmployee(sal[e.id], by[e.id], month);
    out.push(Object.assign({ id: e.id, name: e.name, location: e.location, monthly_salary: sal[e.id] }, r));
  });
  const sum = (k) => out.reduce((a, r) => a + r[k], 0);
  return {
    month, people: out.length, total: sum('total'), base_pay: sum('base_pay'), extra_pay: sum('extra_pay'),
    rows: out, no_salary: noSalary,
  };
}
window.DashSalary = { calcEmployee, buildMonth };
})();
