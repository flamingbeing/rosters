// Junior rotations: postings change by the week (Monday to Sunday), planned for the year. A change
// for a single day lives in that day's record (day.staff[id].posting), not here.
// Pure functions; the Excel parts take ExcelJS / cellText in.
import { POSTINGS, postingName } from './engine.js';

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const at = date => new Date(date + 'T12:00:00');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The Monday of the week a date falls in.
export function mondayOf(date) {
  const d = at(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return iso(d);
}

// Every week (by its Monday) that has a day in the year: the first may start in late December.
export function weeksOfYear(year) {
  const out = [];
  const d = at(mondayOf(`${year}-01-01`));
  while (d.getFullYear() <= year) {
    out.push(iso(d));
    d.setDate(d.getDate() + 7);
    if (d.getFullYear() > year) break;
  }
  return out;
}

export const emptyRotations = () => ({ weeks: {} });

// What a person's rotation says for a week (ignoring one-day changes), or undefined.
export const weekPosting = (rot, id, monday) => rot?.weeks?.[monday]?.[id];

// A junior's posting on a date: that day's change (dayPosting, if any), else the week's rotation,
// else their usual posting.
export function postingOn(rot, p, date, dayPosting) {
  if (!p || p.role !== 'junior') return p?.posting || '';
  if (dayPosting != null) return dayPosting;
  if (!date) return p.posting || '';
  return weekPosting(rot, p.id, mondayOf(date)) ?? (p.posting || '');
}

// Set (or clear, with null) one person's posting for some weeks.
export function setWeeks(rot, personId, mondays, code) {
  for (const m of mondays) {
    if (code == null) { if (rot.weeks[m]) { delete rot.weeks[m][personId]; if (!Object.keys(rot.weeks[m]).length) delete rot.weeks[m]; } }
    else (rot.weeks[m] ||= {})[personId] = code;
  }
}

// "Paeds", "p", "PAEDS", "Liver Transplant", "liver" -> "P"; "" / "-" -> ""; unknown -> null.
export function postingCode(text) {
  const t = String(text ?? '').trim().replace(/[()]/g, '');
  if (!t || /^[-–—]$/.test(t)) return '';
  const lc = t.toLowerCase();
  const hit = POSTINGS.find(([code, name]) => code && (code.toLowerCase() === lc || name.toLowerCase() === lc));
  if (hit) return hit[0];
  const alias = { liver: 'L', livot: 'L', 'liver ot': 'L', hpb: 'HPB', donor: 'HPB', 'special risk': 'SR', thoracic: 'SR', regional: 'RA', vascular: 'Vasc', ambulatory: 'Amb', neurosurgery: 'Neu', paediatrics: 'P', paeds: 'P', card: 'Cardiac' };
  return alias[lc] ?? null;
}

// A header cell as a week's Monday: a real date, "12/10/2026", "12 Oct 2026", "12-Oct", "12 Oct" (year given).
export function headerDate(v, year) {
  if (v instanceof Date) return mondayOf(iso(new Date(v.getTime() + 12 * 3600e3)));
  const t = String(v ?? '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return mondayOf(`${m[1]}-${m[2]}-${m[3]}`);
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return mondayOf(`${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`); }
  m = t.match(/(\d{1,2})[\s-]*([A-Za-z]{3})[a-z]*[\s-]*(\d{2,4})?/);
  if (m) {
    const mi = MONTHS.findIndex(x => x.toLowerCase() === m[2].toLowerCase());
    if (mi < 0) return null;
    const y = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : year;
    if (!y) return null;
    return mondayOf(`${y}-${String(mi + 1).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`);
  }
  return null;
}

// Read a rotation sheet: names down the first column, weeks across (a header row of dates),
// postings in the cells. person(name) -> staff member or null.
// Returns { weeks: { monday: { id: code } }, people: [ids], mondays: [the weeks it covers],
// unmatched: [names], unknown: [texts], cells }.
export function readRotationSheet(ws, cellText, person, year) {
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (c, col) => { vals[col] = c.value; });
    rows.push({ n, vals });
  });
  // the header: the first row with at least three dates in it
  let head = null, dateCols = [];
  for (const r of rows.slice(0, 15)) {
    const cols = r.vals.map((v, c) => [c, headerDate(v instanceof Date ? v : cellText(v), year)]).filter(([, d]) => d);
    if (cols.length >= 3) { head = r; dateCols = cols; break; }
  }
  if (!head) return { error: 'No row of week dates found. The sheet needs names down the first column and a row of dates (each week\'s Monday) across the top.' };
  const nameCol = Math.min(...head.vals.map((v, c) => c).filter(c => c != null && !dateCols.some(([dc]) => dc === c))) || 1;
  const weeks = {}, unmatched = [], unknown = new Set(), people = [];
  let cells = 0;
  for (const r of rows.filter(r => r.n > head.n)) {
    const name = cellText(r.vals[nameCol]).trim();
    if (!name) continue;
    const p = person(name);
    if (!p) { unmatched.push(name); continue; }
    people.push(p.id);
    for (const [c, monday] of dateCols) {
      const text = cellText(r.vals[c]).trim();
      if (!text) continue;
      const code = postingCode(text);
      if (code == null) { unknown.add(text); continue; }
      (weeks[monday] ||= {})[p.id] = code;
      cells++;
    }
  }
  return { weeks, people, mondays: [...new Set(dateCols.map(([, m]) => m))], unmatched, unknown: [...unknown], cells };
}

// Cell colours for each posting (ARGB, light so the text reads).
export const POSTING_FILL = { P: 'FFFDE2E4', Neu: 'FFE2ECF9', SR: 'FFFFF1D6', Cardiac: 'FFFCE1D4', ENT: 'FFE6F4EA', RA: 'FFE8E4F8',
  Vasc: 'FFFBE7F3', Amb: 'FFEAF6F6', Remote: 'FFF1F1E6', PACU: 'FFEFEFEF', L: 'FFDFF3E4', HPB: 'FFF3F0DA' };

// The year as a workbook in the same layout it is read from.
export function buildRotationWorkbook(ExcelJS, { year, people, rot }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Rotations ${year}`, { views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }] });
  const weeks = weeksOfYear(year);
  ws.getCell(1, 1).value = `Junior rotations ${year} (each column is the week starting that Monday)`;
  ws.getCell(1, 1).font = { bold: true };
  const head = ws.getRow(2);
  head.getCell(1).value = 'Name';
  head.getCell(2).value = 'Usual posting';
  weeks.forEach((m, i) => { const c = head.getCell(3 + i); c.value = new Date(m + 'T00:00:00Z'); c.numFmt = 'd mmm'; });
  head.font = { bold: true };
  ws.getColumn(1).width = 28; ws.getColumn(2).width = 14;
  weeks.forEach((_, i) => { ws.getColumn(3 + i).width = 8; });
  people.forEach((p, r) => {
    const row = ws.getRow(3 + r);
    row.getCell(1).value = p.name;
    row.getCell(2).value = postingName(p.posting);
    weeks.forEach((m, i) => {
      const code = weekPosting(rot, p.id, m);
      if (code == null) return;
      const c = row.getCell(3 + i);
      c.value = code;
      if (POSTING_FILL[code]) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: POSTING_FILL[code] } };
      c.alignment = { horizontal: 'center' };
    });
  });
  return wb;
}
