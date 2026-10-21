// NUH Junior Monthly: build the department's monthly roster sheet (the "Request" tab) from scratch, as data.
// A pure module (no screen, no network, no Excel library): buildSheet(spec) returns a plain model of the sheet (cells with
// values or formulas, merged cells, widths, the frozen corner, and colour rules) that an adapter then writes out, as an
// .xlsx file (tools/sheetgen-xlsx.mjs, the browser's ExcelJS) or as a new Google Sheet (Sheets API requests).
//
// Why this exists (owner, 17 Oct 2026): the month's sheet is made by hand from the master rotation sheet. This proves the
// whole form can be rebuilt for any people, any number of rows and any month length, formulas included, so the sheet
// can be generated instead of copied. Everything the rosterer might want to change is data at the top of this file
// (DEFAULTS: which codes count, the call points, the lists inside the manpower formulas); the formulas are written
// from those lists, so changing a formula means changing a list or one function here.
//
// The layout copies the November 2026 sheet (private notes hold the real one):
//   rows 1-2  legend; row 3 title; row 4 month text; row 5 weekday names; row 6 day numbers
//   rows 7..  one row per person: S/N, Grade, Name, one cell per day, then the 1st of the next month (for post call),
//             then the right-hand block: WE (days off), Fri / Sat / Sun / WD points, R1B, C3, OGN, OGC, S1, S1B counts,
//             Total points, and approved leave
//   below     a count of each call per day, then the manpower block (who is available, leave, the green / black rows)

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const DEFAULTS = {
  title: 'DEPARTMENT OF ANAESTHESIA STAFF ROSTER',
  dept: 'Dept: Department of Anaesthesia',
  firstRow: 7,
  // calls that earn weekend points, and what each weekday is worth (the sheet's points: Fri 1.5, Sat 2, Sun 1.5, Mon to Thu 1)
  pointCalls: ['R1', 'R2', 'R3', 'S1', 'S1B'],
  points: { Fri: 1.5, Sat: 2, Sun: 1.5, WD: 1 },
  // codes counted as a day off in the first right-hand column ("WE")
  offCodes: ['WE', 'NP', 'PH', 'RD', 'X', 'XX', 'X/NP'],
  // one count per call, in this order (the right-hand block, then the rows under the names)
  callColumns: [
    { key: 'R1B', label: 'R1B', code: 'R1B' },
    { key: 'C3', label: 'C3', code: 'C3' },
    { key: 'OGN', label: 'OGN', code: 'OGN', factor: 0.5 },
    { key: 'OGC', label: 'OGC', code: 'OGC' },
    { key: 'S1', label: 'S1', code: 'S1' },
    { key: 'S1B', label: 'S1B', code: 'S1B' },
  ],
  countRows: ['R1', 'R2', 'R3', 'R1B', 'C3', 'OGD', 'OGN', 'OGC', 'LI', 'C', 'AP', 'CP', 'ICU', 'S1', 'S1B'],
  approvedLeave: ['AL', 'SL', 'ML', 'PL', 'FCL', 'CCL', 'MC', 'HL', 'NS'],
  // manpower block
  unavailable: ['AL', 'SL', 'TL', 'CL', 'ML', 'PL', 'FCL', 'CCL', 'NS', 'MC', 'HL', 'NPL', 'NTF', 'TTSH', 'KKH', 'RD', 'Z', 'PC', 'PPC', 'Adm', 'NUH', 'Exam'],
  inPostingElsewhere: ['ICU', 'R1B', 'C', 'C3', 'C-p', 'C-e'],   // taken off "available" for the "excluding ICU and cardiac" row
  leaveCodes: ['AL', 'TL', 'CL', 'ML', 'PL', 'NS', 'MC', 'HL', 'SL', 'FCL', 'CCL', 'NUH', 'Exam'],
  greenPerDay: 4,        // the "green" (new MO) row's default; typed by hand, one number per day
  blackFactor: 0.6,      // a green MO counts as this much of a black one
  minBlack: 48,          // "Min:48" label beside the black equivalent row
  minAH: 3,              // "Min:3" label beside the available AH row
  seniorGrades: ['HOD', 'SC', 'AC', 'C'],
  // which people make up each leave band (matched on Grade); a band's rows may be in several runs
  bands: [
    { key: 'sr', label: 'SR Leave', grades: ['R'] },
    { key: 'jr', label: 'JR Leave', grades: ['RES1', 'RES2', 'RES3'] },
    { key: 'non', label: 'Total Non-Resident Leave', grades: ['NHG', 'RP', 'HC', 'LOC', 'MOPEX', 'RR', 'Fellow'] },
  ],
};

// what each code looks like (the legend's colours); the rules write these as colour rules, so a cell keeps its colour
// whatever is typed into it later
export const CODE_FILL = {
  WE: 'CCFFCC', PH: 'CCFFCC', AP: 'CCFFCC', Z: 'CCCCCC', NTF: 'CCCCCC', TTSH: 'CCCCCC', KKH: 'CCCCCC', ML: 'CCCCCC', Pain: 'CCCCCC',
  PC: 'B7B7B7', PPC: 'B7B7B7',
  AL: '4A86E8', SL: '4A86E8', TL: '4A86E8', FCL: '4A86E8', MC: '4A86E8', '0.5': '4A86E8', R: '4A86E8', R_: '4A86E8',
  X: 'FF0000', XX: 'FF0000', '(XX)': 'FF0000', NP: 'FF0000', 'X/NP': 'FF0000', OGN: 'FF0000', OGD: 'FF0000',
  ICU: 'FFFF00', C: 'FF00FF', CP: '008000', LI: 'CC99FF',
  C3: 'FF9900', R1: 'FF9900', R2: 'FF9900', R3: 'FF9900', R1B: 'FF9900', OGC: 'FF9900', AHC: 'FF9900', S1: 'FF9900', S1B: 'FF9900',
  WR: 'FCE4D6', P: 'F4CCCC', P1: 'F4CCCC', P2: 'F4CCCC', P3: 'F4CCCC', P4: 'F4CCCC', P5: 'F4CCCC', P6: 'F4CCCC',
};

export function colName(n) { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
export function colIndex(s) { let n = 0; for (const ch of s) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
const q = s => `"${s}"`;

export function daysIn(month) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function weekdayOf(month, day) { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m - 1, day)).getUTCDay(); }

// spec: { month: '2026-12', people: [{ grade, name, days: { 1: 'WE', 5: 'AL' }, next: 'Z' }], holidays: [25] (day numbers), ...DEFAULTS overrides }
// A person's `days` keys are day numbers; `next` is the cell for the 1st of the next month.
export function buildSheet(specIn) {
  const spec = { ...DEFAULTS, ...specIn };
  const month = spec.month;
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month must look like 2026-12');
  const n = daysIn(month);
  const people = spec.people || [];
  const cells = new Map();
  const set = (addr, c) => cells.set(addr, c);
  const val = (addr, v, style) => set(addr, { v, style });
  const fml = (addr, f, style) => set(addr, { f, style });

  // columns
  const C0 = 4;                       // D: day 1
  const last = C0 + n - 1;            // last day of the month
  const nextC = last + 1;             // the 1st of next month
  let rc = nextC + 1;                 // the right-hand block
  const RC = { off: rc++, Fri: rc++, Sat: rc++, Sun: rc++, WD: rc++ };
  for (const c of spec.callColumns) RC[c.key] = rc++;
  RC.total = rc++; RC.leave = rc++;
  const lastCol = RC.leave;
  const D = colName(C0), L = colName(last), NX = colName(nextC);
  const firstRow = spec.firstRow, lastRow = firstRow + people.length - 1;

  // ---- legend (rows 1-2), title, header ----
  const legend = [
    ['D1', 'X', 'red'], ['E1', 'No call request'], ['H1', 'NP', 'red'], ['I1', 'No premed request'], ['M1', 'R__', 'blue'], ['N1', 'Call request'],
    ['Q1', 'P__', 'pink'], ['R1', 'Scheduled for premed duty'], ['X1', 'AL/NS/PL/ML/TL', 'cyan'], ['AA1', 'Requested leave but not yet approved'],
    ['AI1', ' Approved leave'], ['D2', '(XX)', 'red'], ['E2', "Call blocked on person's behalf - used by the planner"], ['Q2', 'WR', 'peach'],
    ['R2', 'Saturday APS rounding duty'], ['X2', 'Include a comment with reason for blocks'],
  ];
  const LEG = { red: 'FF0000', blue: '4A86E8', pink: 'F4CCCC', cyan: '00FFFF', peach: 'FCE4D6' };
  for (const [a, v, k] of legend) val(a, v, { size: 8, fill: k ? LEG[k] : null, center: !!k });
  val('C1', 'Legend ', { size: 8 });
  val('D3', spec.title, { bold: true, size: 10, fill: 'C0C0C0', center: true });
  val('A4', spec.dept, { size: 8, center: true });
  const [yy, mm] = month.split('-').map(Number);
  val('D4', `1 to ${n} ${MONTHS[mm - 1]} ${String(yy).slice(2)}`, { size: 8, center: true });
  val('A6', 'S/N', { size: 8, fill: 'C0C0C0', center: true }); val('B6', 'Grade', { size: 8, fill: 'C0C0C0', center: true }); val('C6', 'Name', { size: 8, fill: 'C0C0C0', center: true });
  for (let d = 1; d <= n; d++) {
    const c = colName(C0 + d - 1);
    val(`${c}5`, WEEKDAYS[weekdayOf(month, d)], { size: 8, fill: 'C0C0C0', center: true });
    val(`${c}6`, d, { size: 8, center: true });
  }
  const ny = mm === 12 ? yy + 1 : yy, nm = mm === 12 ? 1 : mm + 1;
  val(`${NX}5`, WEEKDAYS[weekdayOf(`${ny}-${String(nm).padStart(2, '0')}`, 1)], { size: 8, fill: 'C0C0C0', center: true });
  set(`${NX}6`, { v: { date: `${ny}-${String(nm).padStart(2, '0')}-01` }, style: { size: 8, center: true, numFmt: 'd-mmm' } });
  const heads = [['off', 'WE'], ['Fri', 'Fri'], ['Sat', 'Sat'], ['Sun', 'Sun'], ['WD', 'WD'], ...spec.callColumns.map(c => [c.key, c.label]), ['total', 'Total'], ['leave', 'AL']];
  for (const [k, label] of heads) val(`${colName(RC[k])}5`, label, { size: 8, fill: k === 'off' ? 'CCFFCC' : k === 'leave' ? '4A86E8' : 'C0C0C0', center: true });

  // ---- people ----
  // the Total column adds Fri through the OGC count (the sheet's own range, AJ:AQ), not the S1 counts
  const totalTo = colName(RC.OGC || RC[spec.callColumns[spec.callColumns.length - 1].key]);
  const holidayCells = (holidays, r) => {
    // a public holiday on Mon to Thu counts as a Sunday for the points (what the rosterer adds by hand each month)
    const out = [];
    for (const d of holidays || []) { const w = weekdayOf(month, d); if (w >= 1 && w <= 4) out.push(`${colName(C0 + d - 1)}${r}`); }
    return out;
  };
  const callsOnDay = (day, range, r) => spec.pointCalls.map(c => `COUNTIFS($${D}$5:$${range}$5,${q(day)},$${D}${r}:$${range}${r},${q(c)})`);
  people.forEach((p, i) => {
    const r = firstRow + i;
    val(`A${r}`, i + 1, { size: 8, fill: 'C0C0C0', center: true });
    val(`B${r}`, p.grade || '', { size: 8, center: true });
    val(`C${r}`, p.name || '', { size: 8 });
    for (const [d, code] of Object.entries(p.days || {})) if (code !== '' && code != null) val(`${colName(C0 + Number(d) - 1)}${r}`, code, { size: 8, center: true });
    if (p.next) val(`${NX}${r}`, p.next, { size: 8, center: true });
    const rng = `${D}${r}:${L}${r}`;
    fml(`${colName(RC.off)}${r}`, spec.offCodes.map(c => `COUNTIF(${rng},${q(c)})`).join('+'), { size: 11, fill: '00FF00', center: true });
    fml(`${colName(RC.Fri)}${r}`, `${spec.points.Fri}*(${callsOnDay('Fri', L, r).join('+')})`, { size: 8, center: true });
    fml(`${colName(RC.Sat)}${r}`, `${spec.points.Sat}*(${callsOnDay('Sat', L, r).join('+')})`, { size: 8, center: true });
    const hol = holidayCells(spec.holidays, r).flatMap(a => spec.pointCalls.map(c => `COUNTIFS(${a},${q(c)})`));
    fml(`${colName(RC.Sun)}${r}`, `${spec.points.Sun}*(${[...callsOnDay('Sun', L, r), ...hol].join('+')})`, { size: 8, center: true });
    const wd = ['Mon', 'Tue', 'Wed', 'Thu'].map(day => `(${callsOnDay(day, NX, r).join('+')})`).join('+');
    fml(`${colName(RC.WD)}${r}`, spec.points.WD === 1 ? wd : `${spec.points.WD}*(${wd})`, { size: 8, center: true });
    for (const c of spec.callColumns) fml(`${colName(RC[c.key])}${r}`, `COUNTIF($${D}${r}:$${L}${r},${q(c.code)})${c.factor ? `*${c.factor}` : ''}`, { size: 8, center: true });
    fml(`${colName(RC.total)}${r}`, `SUM($${colName(RC.Fri)}${r}:$${totalTo}${r})`, { size: 8, center: true });
    fml(`${colName(RC.leave)}${r}`, `SUMPRODUCT(COUNTIF(${D}${r}:${NX}${r},{${spec.approvedLeave.map(q).join(',')}}))`, { size: 8, center: true });
  });

  // ---- under the names: a count of each call per day ----
  const idx = people.map((p, i) => ({ p, r: firstRow + i }));
  const juniors = idx.filter(x => !spec.seniorGrades.includes(x.p.grade));
  const j0 = juniors.length ? juniors[0].r : firstRow, j1 = juniors.length ? juniors[juniors.length - 1].r : lastRow;
  let row = lastRow + 2;
  const countStart = row;
  for (const code of spec.countRows) {
    val(`C${row}`, code, { size: 8, fill: CODE_FILL[code] || null, center: true });
    for (let d = 1; d <= n; d++) { const c = colName(C0 + d - 1); fml(`${c}${row}`, `COUNTIF(${c}${firstRow}:${c}${lastRow},${q(code)})`, { size: 8 }); }
    row++;
  }
  const countEnd = row - 1;
  row++;
  // ---- manpower ----
  const R = {};
  const lines = [
    ['Total Jnr', 'jnr'], ['Total Off (incl. Outrotation)', 'off'], ['Available Jnr Manpower', 'avail'], ['Avail Jnr (excl. ICU&C)', 'availX'], ['Green', 'green'],
    ['Black equivalent', 'black'], ['Available AH Jnr', 'ah'], ['SR Leave', 'sr'], ['JR Leave', 'jr'], ['Study Leave', 'study'], ['Total Resident Leave', 'resLeave'],
    ['Total Non-Resident Leave', 'nonLeave'], ['Total Junior Leave', 'jrLeave'],
  ];
  for (const [label, key] of lines) { R[key] = row; val(`C${row}`, label, { size: 8, fill: ['jnr', 'green'].includes(key) ? '00FFFF' : null, center: true }); row++; }
  val(`B${R.black}`, `Min:${spec.minBlack}`, { size: 8, center: true });
  val(`B${R.ah}`, `Min:${spec.minAH}`, { size: 8, center: true });
  const runsOf = grades => {   // contiguous row runs of the people whose grade is in the band
    const runs = []; let cur = null;
    for (const x of idx) {
      if (grades.includes(x.p.grade)) { if (cur && cur[1] === x.r - 1) cur[1] = x.r; else { cur = [x.r, x.r]; runs.push(cur); } }
    }
    return runs;
  };
  const list = a => `{${a.map(q).join(',')}}`;
  const bandSum = (c, grades) => {
    const runs = runsOf(grades);
    if (!runs.length) return '0';
    return runs.map(([a, b]) => `SUMPRODUCT(COUNTIF(${c}${a}:${c}${b},${list(spec.leaveCodes)}))+0.5*COUNTIF(${c}${a}:${c}${b},"0.5")`).join('+');
  };
  const bandOf = key => spec.bands.find(b => b.key === key) || { grades: [] };
  for (let d = 1; d <= n; d++) {
    const c = colName(C0 + d - 1), J = `${c}${j0}:${c}${j1}`;
    const s = { size: 8, center: true };
    fml(`${c}${R.jnr}`, `COUNTA(${J})+COUNTBLANK(${J})`, s);
    fml(`${c}${R.off}`, `SUMPRODUCT(COUNTIF(${J},${list(spec.unavailable)}))+0.5*COUNTIF(${J},"0.5")`, s);
    fml(`${c}${R.avail}`, `${c}${R.jnr}-${c}${R.off}`, s);
    fml(`${c}${R.availX}`, `${c}${R.avail}-SUMPRODUCT(COUNTIF(${J},${list(spec.inPostingElsewhere)}))`, s);
    val(`${c}${R.green}`, spec.greenPerDay, s);
    fml(`${c}${R.black}`, `${c}${R.availX}-(${c}${R.green}*${spec.blackFactor})`, s);
    fml(`${c}${R.ah}`, `COUNTIF(${J},"AH*")`, s);
    fml(`${c}${R.sr}`, bandSum(c, bandOf('sr').grades), s);
    fml(`${c}${R.jr}`, bandSum(c, bandOf('jr').grades), s);
    fml(`${c}${R.study}`, `COUNTIF(${J},"SL")`, s);
    fml(`${c}${R.resLeave}`, `${c}${R.sr}+${c}${R.jr}`, s);
    fml(`${c}${R.nonLeave}`, bandSum(c, bandOf('non').grades), s);
    fml(`${c}${R.jrLeave}`, `${c}${R.resLeave}+${c}${R.nonLeave}`, s);
  }

  // ---- colour rules: every code keeps its legend colour wherever it is typed ----
  const cf = [];
  const dayRange = `${D}${firstRow}:${NX}${lastRow}`;
  for (const [code, fill] of Object.entries(CODE_FILL)) cf.push({ sqref: dayRange, kind: 'equals', text: code, fill, font: fill === '4A86E8' || fill === '008000' ? 'FFFFFF' : null });
  cf.push({ sqref: `${colName(RC.total)}${firstRow}:${colName(RC.total)}${lastRow}`, kind: 'greaterThan', value: 6, fill: 'FF0000' });
  cf.push({ sqref: `${D}${R.availX}:${L}${R.availX} ${D}${R.black}:${L}${R.black}`, kind: 'greaterOrEqual', value: 51, fill: '00FF00' });
  cf.push({ sqref: `${D}${R.availX}:${L}${R.availX} ${D}${R.black}:${L}${R.black}`, kind: 'between', value: 46, value2: 51, fill: 'FF9900' });
  cf.push({ sqref: `${D}${R.availX}:${L}${R.availX} ${D}${R.black}:${L}${R.black}`, kind: 'lessThan', value: 46, fill: 'FF0000' });
  cf.push({ sqref: `${D}${R.ah}:${L}${R.ah}`, kind: 'lessThan', value: spec.minAH, fill: 'FF0000' });
  cf.push({ sqref: `${D}${R.ah}:${L}${R.ah}`, kind: 'greaterOrEqual', value: spec.minAH, fill: '00FF00' });
  // each call should be 1 a night: 0 is red, more than 1 blue (R1 to OGC), under 1 red (S1, S1B)
  const cnt = c => countStart + spec.countRows.indexOf(c);
  const callRows = spec.countRows.filter(c => ['R1', 'R2', 'R3', 'R1B', 'C3', 'OGD', 'OGN', 'OGC'].includes(c));
  if (callRows.length) {
    cf.push({ sqref: `${D}${cnt(callRows[0])}:${L}${cnt(callRows[callRows.length - 1])}`, kind: 'greaterThan', value: 1, fill: '4A86E8' });
    cf.push({ sqref: `${D}${countStart}:${L}${countEnd}`, kind: 'equals', text: '0', fill: 'FF0000' });
  }

  const widths = { 1: 3.4, 2: 5.9, 3: 21.3 };
  for (let c = C0; c <= nextC; c++) widths[c] = 4.0;
  for (let c = nextC + 1; c <= lastCol; c++) widths[c] = 5.5;
  return {
    month, days: n, cells, merges: [`A4:C4`, `D3:${L}3`, `D4:${colName(lastCol)}4`], freeze: { row: firstRow - 1, col: C0 - 1 },
    widths, cf,
    layout: { firstRow, lastRow, firstDayCol: C0, lastDayCol: last, nextCol: nextC, right: RC, countStart, countEnd, manpower: R, juniors: [j0, j1], lastCol },
  };
}

// Plain text of a sheet model as TSV-like rows (for tests and a quick look): formulas shown with a leading =
export function modelToRows(model) {
  const rows = [];
  for (const [addr, c] of model.cells) {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    const r = Number(m[2]) - 1, col = colIndex(m[1]) - 1;
    (rows[r] ||= [])[col] = c.f ? `=${c.f}` : (c.v && c.v.date ? c.v.date : c.v);
  }
  return rows;
}
