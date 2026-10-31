/* Month-end Excel, built in the browser (ported 1:1 from the old server code). */
(function () {
'use strict';
const fail = (m) => { throw new Error(m); };
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(v));
const dowOf = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8))).getUTCDay();
function colLetter(n) { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad2 = (n) => ('0' + n).slice(-2);

const fill = (hex) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + hex.replace('#', '').toUpperCase() } });
const thin = { style: 'thin', color: { argb: 'FF999999' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };


async function build(D) {
  const month = D.month, today = D.today, hourIST = D.hourIST, dataStart = D.data_start;
  if (!isMonth(month)) fail('Bad month');
  const y = +month.slice(0, 4), m = +month.slice(5), nd = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = month + '-01', lastd = month + '-' + pad2(nd);
  if (lastd < dataStart) fail('This month is before the data start');
  if (first > today) fail('This month has not started yet');

  const emps = (D.employees || []).slice().sort((x, y) => x.id - y.id);
  if (!emps.length) fail('No employees for this month');
  const byId = {}; emps.forEach((e) => (byId[e.id] = e));
  const rows = D.rows || [];

  const serial = (d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  const frac = (t) => { const a = String(t).split(':'); return ((+a[0]) * 3600 + (+a[1]) * 60 + (+(a[2] || 0))) / 86400; };
  const data = [];
  rows.forEach((r) => {
    const e = byId[r.employee_id]; if (!e) return;
    const d = +r.work_date.slice(8), base = serial(d), tail = e.name + '|' + e.location;
    let vin = r.in_time ? frac(r.in_time) : null; const vout = r.out_time ? frac(r.out_time) : null;
    if (vin === null && vout === null && (r.status === 'Present' || r.status === 'Half Day' || r.status === 'Extra Day')) vin = 'P';
    if (vin !== null) data.push([base + 'In' + tail, vin]);
    if (vout !== null) data.push([base + 'Out' + tail, vout]);
  });

  const title = 'Attendance Report - ' + MON[m - 1] + ' ' + y;
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DCC Attendance'; wb.created = new Date();
  wb.calcProperties = { fullCalcOnLoad: true };

  /* ---------- Attendance Report ---------- */
  const sh = wb.addWorksheet('Attendance Report', { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
  const ds = wb.addWorksheet('Data', { views: [{ state: 'frozen', ySplit: 1 }] });
  ds.getRow(1).values = ['Key (date serial + In/Out + name|location)', 'Time'];
  ds.getColumn(1).width = 60;
  data.forEach((d, i) => { const r = ds.getRow(i + 2); r.getCell(1).value = d[0]; r.getCell(2).value = d[1]; if (typeof d[1] === 'number') r.getCell(2).numFmt = 'hh:mm:ss'; });
  const dl = Math.max(2, data.length + 1);

  const c0 = 8, cl = c0 + 2 * nd - 1, LC = colLetter(cl), nr = emps.length;
  sh.getCell('A2').value = 'Required total days'; sh.getCell('B2').value = nd;
  sh.getCell('C2').value = 'Required Month / Year'; sh.getCell('D2').value = y; sh.getCell('E2').value = m;
  ['Employee Name', 'Location', 'Total No. of days present', 'Total present', 'No. of days Absent', 'Total sunday', 'Extra days'].forEach((h, i) => (sh.getCell(3, i + 1).value = h));
  for (let d = 1; d <= nd; d++) {
    const ci = c0 + 2 * (d - 1);
    sh.getCell(2, ci).value = { formula: 'TEXT(DATE($D$2,$E$2,' + d + '),"dddd dd/mm/yyyy")' };
    sh.mergeCells(2, ci, 2, ci + 1);
    sh.getCell(3, ci).value = 'In'; sh.getCell(3, ci + 1).value = 'Out';
  }
  emps.forEach((e, i) => {
    const r = 4 + i, rng = '$H' + r + ':$' + LC + r;
    sh.getCell(r, 1).value = e.name; sh.getCell(r, 2).value = e.location;
    const f = [
      'SUMPRODUCT(($H$3:$' + LC + '$3="In")*(' + rng + '<>"-"))',
      'C' + r + '-G' + r,
      '$B$2-F' + r + '-D' + r,
      'COUNTIF($H$2:$' + LC + '$2,"Sunday*")',
      'SUMPRODUCT(($H$3:$' + LC + '$3="In")*(LEFT($H$2:$' + LC + '$2,6)="Sunday")*(' + rng + '<>"-"))',
    ];
    f.forEach((x, k) => (sh.getCell(r, 3 + k).value = { formula: x }));
    for (let d = 1; d <= nd; d++) for (let k = 0; k < 2; k++) {
      const col = colLetter(c0 + 2 * (d - 1) + k);
      const cell = sh.getCell(r, c0 + 2 * (d - 1) + k);
      cell.value = { formula: 'IFERROR(INDEX(Data!$B$2:$B$' + dl + ',MATCH(DATE($D$2,$E$2,' + d + ')&' + col + '$3&$A' + r + '&"|"&$B' + r + ',Data!$A$2:$A$' + dl + ',0)),"-")' };
      cell.numFmt = 'hh:mm:ss';
    }
  });
  // look
  const style = (addr, o) => { const c = sh.getCell(addr); Object.assign(c, o); };
  ['A2', 'B2', 'C2', 'D2', 'E2'].forEach((a) => { sh.getCell(a).fill = fill('#f1c232'); sh.getCell(a).font = { bold: true }; });
  sh.getCell('B2').fill = fill('#ffff00'); sh.getCell('E2').fill = fill('#ffff00');
  for (let c = 1; c <= cl; c++) {
    const h = sh.getCell(3, c);
    h.fill = fill('#1c3d86'); h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
  for (let c = c0; c <= cl; c++) { const h = sh.getCell(2, c); h.fill = fill('#ffffff'); h.font = { bold: true }; h.alignment = { horizontal: 'center' }; }
  for (let d = 1; d <= nd; d++) {
    if (dowOf(month + '-' + pad2(d)) === 0) {
      const ci = c0 + 2 * (d - 1);
      for (let r = 4; r < 4 + nr; r++) for (let k = 0; k < 2; k++) sh.getCell(r, ci + k).fill = fill('#fdeceb');
    }
  }
  for (let r = 2; r < 4 + nr; r++) for (let c = 1; c <= cl; c++) {
    const cell = sh.getCell(r, c); cell.border = BORDER;
    if (r >= 4 && c >= 3) cell.alignment = { horizontal: 'center' };
    if (r >= 4 && c === 1) cell.font = { bold: true };
  }
  sh.getRow(3).height = 62; sh.getRow(2).height = 34;
  sh.getColumn(1).width = 26; sh.getColumn(2).width = 17;
  for (let c = 3; c <= 7; c++) sh.getColumn(c).width = 11;
  for (let c = c0; c <= cl; c++) sh.getColumn(c).width = 10.5;

  /* ---------- Summary + Removed ---------- */
  const upTo = lastd < today ? lastd : today;
  const dd = (iso) => iso.slice(8) + '/' + iso.slice(5, 7);
  const eachDay = (a, b) => { const out = []; for (let d = +a.slice(8); d <= +b.slice(8); d++) out.push(month + '-' + pad2(d)); return out; };
  // holidays that apply to everyone: more than half of that day's rows are "Holiday"
  const cnt = {}, tot = {};
  rows.forEach((r) => { tot[r.work_date] = (tot[r.work_date] || 0) + 1; if (r.status === 'Holiday') cnt[r.work_date] = (cnt[r.work_date] || 0) + 1; });
  const hol = {}; Object.keys(cnt).forEach((d) => { if (cnt[d] / tot[d] > 0.5 && dowOf(d) !== 0) hol[d] = 1; });
  const holUpTo = Object.keys(hol).filter((d) => d <= upTo).length;
  const per = {};
  rows.forEach((r) => {
    const o = per[r.employee_id] = per[r.employee_id] || { ex: [], half: [], night: [], abs: [], ph: 0, has: false };
    const d = r.work_date;
    if (r.in_time || r.out_time || r.status === 'Present' || r.status === 'Half Day' || r.status === 'Extra Day') o.has = true;
    if (r.status === 'Extra Day') o.ex.push(d);
    if (r.status === 'Half Day') o.half.push(d);
    if (r.night) o.night.push(d);
    if (r.status === 'Absent' && d <= upTo && !(d === today && hourIST < 21)) o.abs.push(d);
    if (r.status === 'Holiday' && !hol[d] && d <= upTo) o.ph++;
  });
  const sumRows = [], removed = [], notes = [];
  emps.forEach((e, i) => {
    const o = per[e.id] || { ex: [], half: [], night: [], abs: [], ph: 0, has: false };
    if (!o.has) { removed.push([e.name, e.location, 'No attendance in ' + MON[m - 1] + '-' + y + (e.active ? '' : ' (inactive)')]); return; }
    const s0 = e.joined_on && e.joined_on > first ? e.joined_on : first;
    const e0 = e.left_on && e.left_on < upTo ? e.left_on : upTo;
    const partial = s0 !== first || e0 !== upTo;
    if (partial) {
      if (s0 !== first) notes.push('- ' + e.name + ' (' + e.location + '): joined ' + dd(s0) + '/' + y + ' - Sundays and absent are counted from the joining date.');
      if (e0 !== upTo) notes.push('- ' + e.name + ' (' + e.location + '): left, last working day ' + dd(e0) + '/' + y + '.');
    }
    let sun = 0, hl = 0, wd = 0;
    if (partial) eachDay(s0, e0 > s0 ? e0 : s0).forEach((d) => { if (d < s0 || d > e0) return; if (dowOf(d) === 0) sun++; else if (hol[d]) hl++; else wd++; });
    sumRows.push({ e, reg: 4 + i, o, partial, sun, hl, wd });
  });

  const sm = wb.addWorksheet('Attendance Summary', { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
  const rm = wb.addWorksheet('Removed - No Attendance', { views: [{ state: 'frozen', ySplit: 1 }] });
  const upSerial = serial(+upTo.slice(8));
  const d1 = 'DATE(' + y + ',' + m + ',1)';
  const top = [['A1', 'Required total days'], ['B1', nd], ['C1', 'Required Month'], ['D1', MON[m - 1] + '-' + String(y).slice(2)], ['E1', 'Data up to'], ['F1', upSerial],
    ['G1', 'Working days'], ['H1', { formula: '(F1-' + d1 + '+1)-J1-L1' }], ['I1', 'Sundays'],
    ['J1', { formula: 'INT((F1-' + d1 + '+WEEKDAY(' + d1 + ',3)+1)/7)' }], ['K1', 'Holidays'], ['L1', holUpTo], ['M1', FULL[m - 1].toUpperCase() + '-' + y + ' Adjust']];
  top.forEach(([a, v]) => (sm.getCell(a).value = v));
  ['Employee Name', 'Location', 'Total No. of days\npresent', 'Total present', 'No. of days\nAbsent', 'Total sunday', 'Extra days', 'Holidays', 'Half day', 'Night', 'Total Working Days', 'Extra Salary', 'Less Salary', 'Working+Night sum', 'Extra day dates', 'Half day dates', 'Night dates', 'Absent dates']
    .forEach((h, i) => (sm.getCell(2, i + 1).value = h));
  const n2 = sumRows.length, tr = 3 + n2;
  sumRows.forEach((x, i) => {
    const r = 3 + i, o = x.o;
    const vals = [
      x.e.name, x.e.location,
      { formula: "'Attendance Report'!C" + x.reg },
      { formula: 'C' + r + '-G' + r },
      { formula: x.partial ? x.wd + '-D' + r + (o.ph ? '-' + o.ph : '') : '$H$1-D' + r + (o.ph ? '-' + o.ph : '') },
      x.partial ? x.sun : { formula: '$J$1' },
      o.ex.length,
      x.partial ? x.hl + o.ph : { formula: '$L$1' + (o.ph ? '+' + o.ph : '') },
      o.half.length || null, o.night.length || null,
      { formula: 'IF(D' + r + '=0,0,D' + r + '+F' + r + '+G' + r + '+H' + r + ')' },
      null, null,
      { formula: 'K' + r + '-I' + r + '*0.5+J' + r },
      o.ex.map(dd).join(', '), o.half.map(dd).join(', '), o.night.map(dd).join(', '), o.abs.map(dd).join(', '),
    ];
    vals.forEach((v, c) => { if (v !== null) sm.getCell(r, c + 1).value = v; });
  });
  if (n2) {
    const S = (c) => ({ formula: 'SUM(' + c + '3:' + c + (tr - 1) + ')' });
    sm.getCell(tr, 1).value = 'Total';
    [['C', 3], ['D', 4], ['E', 5], ['G', 7], ['I', 9], ['J', 10], ['K', 11], ['L', 12], ['M', 13], ['N', 14]].forEach(([c, i]) => (sm.getCell(tr, i).value = S(c)));
    for (let c = 1; c <= 14; c++) sm.getCell(tr, c).font = { bold: true };
  }
  const nl = ['Notes',
    '- Only employees with attendance in ' + MON[m - 1] + '-' + y + ' are listed. Employees with no attendance are on the "Removed - No Attendance" tab.',
    '- Present = a working day with an In punch (times from Supabase, admin corrections already applied). Total Working Days = present + Sundays + extra days + holidays.',
    '- Night = days marked night duty. Half days are deducted as 0.5 day. Extra Salary / Less Salary are for you to fill in (blue columns).'].concat(notes);
  nl.forEach((t, i) => (sm.getCell(tr + 3 + i, 1).value = t));
  sm.getCell(tr + 3, 1).font = { bold: true };
  // look
  for (let c = 1; c <= 18; c++) {
    const h = sm.getCell(2, c);
    h.fill = fill('#ffff00'); h.font = { bold: true, name: 'Arial', size: 10 };
    h.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    sm.getCell(1, c).font = { bold: true, name: 'Arial', size: 10 };
  }
  ['B1', 'F1', 'L1'].forEach((a) => { sm.getCell(a).font = { bold: true, name: 'Arial', size: 10, color: { argb: 'FF0000FF' } }; });
  sm.getCell('F1').numFmt = 'dd-mm-yyyy';
  ['B1', 'D1', 'F1', 'H1', 'J1', 'L1'].forEach((a) => (sm.getCell(a).alignment = { horizontal: 'center' }));
  sm.mergeCells('M1:N1'); sm.getCell('M1').alignment = { horizontal: 'center' };
  for (let r = 3; r < 3 + n2 + 1; r++) for (let c = 1; c <= 18; c++) {
    const cell = sm.getCell(r, c);
    cell.font = Object.assign({ name: 'Arial', size: c >= 15 ? 9 : 10 }, cell.font || {});
    if (c >= 3 && c <= 14) cell.alignment = { horizontal: 'center' };
  }
  for (let r = 3; r < 3 + n2; r++) [3, 7, 9, 10, 12, 13].forEach((c) => { sm.getCell(r, c).font = { name: 'Arial', size: 10, color: { argb: 'FF0000FF' } }; });
  sumRows.forEach((x, i) => { if (x.partial) sm.getCell(3 + i, 1).fill = fill('#fce4d6'); });
  for (let r = 2; r < 3 + n2 + 1; r++) for (let c = 1; c <= 14; c++) sm.getCell(r, c).border = BORDER;
  sm.getRow(2).height = 45; sm.getRow(1).height = 24;
  const w = [190, 140, 80, 70, 80, 62, 58, 65, 58, 52, 76, 66, 66, 84, 120, 120, 200, 260];
  w.forEach((px, i) => (sm.getColumn(i + 1).width = Math.round(px / 7)));

  rm.getRow(1).values = ['S.No', 'Employee Name', 'Location', 'Reason'];
  for (let c = 1; c <= 4; c++) { const h = rm.getCell(1, c); h.fill = fill('#1f4e78'); h.font = { bold: true, color: { argb: 'FFFFFFFF' } }; }
  removed.forEach((x, i) => (rm.getRow(i + 2).values = [i + 1, x[0], x[1], x[2]]));
  [7, 31, 24, 46].forEach((x, i) => (rm.getColumn(i + 1).width = x));

  const buf = await wb.xlsx.writeBuffer();
  return { ok: true, name: title, employees: n2, all: nr, blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) };
}

/* v93: ExcelJS (~940 KB) is downloaded only when someone exports, not on every visit */
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (loadExcelJS.p) return loadExcelJS.p;
  loadExcelJS.p = new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
    sc.onload = () => (window.ExcelJS ? resolve(window.ExcelJS) : reject(new Error('Excel library failed to load')));
    sc.onerror = () => { loadExcelJS.p = null; reject(new Error('Could not load the Excel library. Check the internet and try again.')); };
    document.head.appendChild(sc);
  });
  return loadExcelJS.p;
}
window.DashExport = { build, loadExcelJS };
})();
