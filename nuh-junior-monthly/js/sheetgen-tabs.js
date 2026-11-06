// NUH Junior Monthly: the month sheet's other tabs, built next to the Request tab (sheetgen.js) as the department's sheet
// has them. Pure (no DOM, no network); each tab is a model like buildSheet's ({ name, cells, merges, freeze, widths, cf }).
// - "<Mon YY> Junior Call Roster": one row per day, no header; each cell looks up who has that call on that day in the
//   Request tab (IFERROR(INDEX(names, MATCH(code, day column, 0)), "")). Columns R1, R2, R3, S1, then the obstetric pair
//   (OGD and OGN on a working day, OGC in both on a weekend or public holiday), R1B, S1B.
// - "WR Premed Roster": the APS ward round (WR) on the first day of each run of weekend and holiday days, and the premeds
//   (P1 to P6) on its last day; a single holiday on a weekday has the premeds only.
// - "Leave Waitlist": a row per day with Waitlist 1 to 6, the colour key and the note about late requests (typed by hand
//   in the sheet; the app's Leave tab reads it).
// Weekend and holiday rows are green, as in the department's sheet.
import { colName, daysIn, weekdayOf } from './sheetgen.js';

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const GREEN = 'CCFFCC';

export const TAB_DEFAULTS = {
  requestTab: 'Request',
  callCols: ['R1', 'R2', 'R3', 'S1', 'OB1', 'OB2', 'R1B', 'S1B'],   // OB1 / OB2: OGD and OGN, or OGC on a day off
  premeds: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'],
  waitlists: 6,
  waitKey: [
    ['FF9900', 'Waitlisted from leave application (prioritized for approval if roster permits)'],
    ['', 'Ad hoc waitlist leave request'],
    null,
    ['00FF00', 'Waitlist leave expedited approved'],
    ['4A86E8', 'Waitlist leave approved'],
    ['FF0000', 'Bad days or waitlist leave rejected'],
  ],
  dailyRosterers: 'the daily rosterers',
};

// "Jan 27"
export function monthLabel(month) { const [y, m] = month.split('-').map(Number); return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`; }
const quote = t => (/^[A-Za-z0-9_]+$/.test(t) ? t : `'${String(t).replace(/'/g, "''")}'`);

// Days off (weekends and public holidays) as runs of consecutive days: [[first, last], ...] (day numbers)
export function offRuns(month, holidays = []) {
  const n = daysIn(month), hol = new Set(holidays), runs = [];
  const off = d => hol.has(d) || [0, 6].includes(weekdayOf(month, d));
  for (let d = 1; d <= n; d++) {
    if (!off(d)) continue;
    const a = d;
    while (d < n && off(d + 1)) d++;
    runs.push([a, d]);
  }
  return runs;
}

// The lookup the two roster tabs use: who has `code` on day d (the Request tab's day column), or blank
function lookup(req, nameCol, dayCol, lastRow, code) {
  return `IFERROR(INDEX(${req}!$${nameCol}$1:$${nameCol}$${lastRow},MATCH("${code}",${req}!$${dayCol}$1:$${dayCol}$${lastRow},0),0),"")`;
}

// main: the Request tab's model (buildSheet); opts: { holidays, requestTab, dailyRosterers }
export function buildTabs(main, opts = {}) {
  const o = { ...TAB_DEFAULTS, ...opts };
  const month = main.month, n = main.days, lay = main.layout;
  const req = quote(o.requestTab);
  const hol = new Set(o.holidays || []);
  const isOff = d => hol.has(d) || [0, 6].includes(weekdayOf(month, d));
  const nameCol = 'C', lastRow = lay.lastRow;
  const dayCol = d => colName(lay.firstDayCol + d - 1);
  const tab = name => ({ name, month, days: n, cells: new Map(), merges: [], freeze: { row: 0, col: 0 }, widths: {}, cf: [] });
  const style = d => ({ size: 10, fill: isOff(d) ? GREEN : null });

  // the junior call roster
  const jc = tab(`${monthLabel(month)} Junior Call Roster`);
  for (let d = 1; d <= n; d++) {
    o.callCols.forEach((c, i) => {
      const code = c === 'OB1' ? (isOff(d) ? 'OGC' : 'OGD') : c === 'OB2' ? (isOff(d) ? 'OGC' : 'OGN') : c;
      jc.cells.set(`${colName(i + 1)}${d}`, { f: lookup(req, nameCol, dayCol(d), lastRow, code), style: style(d) });
    });
  }
  [13.9, 15.1, 16.1, 20.1, 20, 22.4, 28.7, 20].forEach((w, i) => { jc.widths[i + 1] = w; });

  // the WR / premed roster
  const wr = tab('WR Premed Roster');
  for (const [a, b] of offRuns(month, o.holidays)) {
    if (b > a) wr.cells.set(`A${a}`, { f: lookup(req, nameCol, dayCol(a), lastRow, 'WR'), style: { size: 10 } });
    o.premeds.forEach((p, i) => wr.cells.set(`${colName(i + 1)}${b}`, { f: lookup(req, nameCol, dayCol(b), lastRow, p), style: { size: 10 } }));
  }
  const freeCol = colName(o.premeds.length + 1);
  wr.cells.set(`${freeCol}1`, { v: 'APS ward rounds', style: { size: 10, bold: true } });
  wr.cells.set(`${freeCol}3`, { v: 'Sunday Premeds', style: { size: 10, bold: true } });
  [18, 18.7, 20.4, 21.3, 21.7, 21.3, 16].forEach((w, i) => { wr.widths[i + 1] = w; });

  // the leave waitlist
  const lw = tab('Leave Waitlist');
  lw.freeze = { row: 1, col: 2 };
  lw.cells.set('B1', { v: 'Day', style: { size: 10, bold: true } });
  for (let k = 1; k <= o.waitlists; k++) lw.cells.set(`${colName(k + 2)}1`, { v: `Waitlist ${k}`, style: { size: 10, bold: true } });
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let d = 1; d <= n; d++) {
    lw.cells.set(`A${d + 1}`, { v: d, style: { size: 10, bold: true, fill: isOff(d) ? GREEN : null } });
    lw.cells.set(`B${d + 1}`, { v: WD[weekdayOf(month, d)], style: { size: 10, fill: isOff(d) ? GREEN : null } });
  }
  const keyCol = o.waitlists + 4, keyC = colName(keyCol - 1), keyT = colName(keyCol);   // I and J with 6 waitlists
  o.waitKey.forEach((k, i) => {
    if (!k) return;
    lw.cells.set(`${keyC}${i + 2}`, { v: '', style: { size: 10, fill: k[0] || null } });
    lw.cells.set(`${keyT}${i + 2}`, { v: k[1], style: { size: 10 } });
  });
  const noteEnd = colName(keyCol + 3);
  lw.cells.set(`${keyC}10`, { v: `For waitlist leave requests submitted within 5 working days of the desired leave date, please inform ${o.dailyRosterers}.`, style: { size: 10, bold: true, fill: 'D9D2E9', center: true, wrap: true } });
  lw.merges.push(`${keyC}10:${noteEnd}14`);
  lw.widths[1] = 5.6; lw.widths[2] = 6.4;
  for (let k = 1; k <= o.waitlists; k++) lw.widths[k + 2] = 16;

  return [jc, wr, lw];
}

// The rows the juniors type their requests into while the Request tab is open: day 1 to the last day, from the first row
// that isn't a senior (HOD, SC, consultant) to the last person. A1 range, e.g. "D72:AH202"; '' with no juniors.
export function requestBlock(main, people, seniorGrades = ['HOD', 'SC', 'C']) {
  const lay = main.layout;
  const k = people.findIndex(p => !seniorGrades.includes(String(p.grade || '').toUpperCase()));
  if (k < 0) return '';   // no juniors: nothing to open
  const first = lay.firstRow + k;
  return `${colName(lay.firstDayCol)}${first}:${colName(lay.lastDayCol)}${lay.lastRow}`;
}
