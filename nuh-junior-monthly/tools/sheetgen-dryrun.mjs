// Dry run of "Create a new Google Sheet" against the real Google Sheets API, for made-up people (no real data).
// Builds the same request the app sends, creates a throwaway spreadsheet, reads it back and checks that Google calculated
// every right-hand total and every count under the names the way the day cells say (the same checks as
// tools/sheetgen-verify.py), and that the merges, colour rules and frozen corner arrived.
//
//   SHEETS_TOKEN=<an OAuth access token with the Sheets scope> node nuh-junior-monthly/tools/sheetgen-dryrun.mjs [2026-12] [14]
//   node nuh-junior-monthly/tools/sheetgen-dryrun.mjs --print-body 2026-12 14 > body.json     (just the request body)
//
// It makes one new file in the signed-in person's Drive, named "DRY RUN ... (delete me)"; nothing else is touched.
import { buildSheet, daysIn, weekdayOf, colName } from '../js/sheetgen.js';
import { toSpreadsheetBody } from '../js/sheetgen-gsheets.js';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const printBody = process.argv.includes('--print-body');
const month = args[0] || '2026-12', count = Number(args[1] || 14);
const grades = ['HOD', 'SC', 'AC', 'R', 'R', 'RES1', 'RES1', 'RES2', 'RES3', 'NHG', 'MOPEX', 'RR', 'Fellow', 'Fellow', 'RES1', 'RES2', 'RES3', 'R', 'LOC', 'HC'];
const n = daysIn(month);
const people = Array.from({ length: count }, (_, i) => {
  const days = {};
  for (let d = 1; d <= n; d++) if (weekdayOf(month, d) % 6 === 0) days[d] = 'WE';
  days[3 + (i % 5)] = ['R1', 'R2', 'R3', 'R1B', 'C3', 'S1', 'OGN', 'ICU', 'AL', 'X/NP'][i % 10];
  days[10 + (i % 4)] = ['R1', 'R2', 'S1B', 'OGC'][i % 4];
  return { grade: grades[i % grades.length], name: 'Person ' + (i + 1), days, next: 'Z' };
});
const model = buildSheet({ month, people, holidays: [] });
const body = toSpreadsheetBody(model, { title: `DRY RUN ${month} (delete me)`, sheetName: 'Request' });
if (printBody) { await new Promise(res => process.stdout.write(JSON.stringify(body) + '\n', res)); process.exit(0); }

const token = process.env.SHEETS_TOKEN;
if (!token) { console.error('Set SHEETS_TOKEN to an access token with the Sheets scope (https://www.googleapis.com/auth/spreadsheets).'); process.exit(2); }
const api = async (url, init = {}) => {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j.error ? j.error.message : ''}`);
  return j;
};
const made = await api('https://sheets.googleapis.com/v4/spreadsheets?fields=spreadsheetId,spreadsheetUrl', { method: 'POST', body: JSON.stringify(body) });
console.log('created:', made.spreadsheetUrl);
const L = model.layout;
const range = `Request!A1:${colName(L.lastCol)}${L.manpower.jrLeave}`;
const got = (await api(`https://sheets.googleapis.com/v4/spreadsheets/${made.spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`)).values || [];
const at = (r, c) => (got[r - 1] || [])[c - 1];
let checked = 0, bad = 0;
const check = (what, g, e) => { checked++; if (typeof g === 'string' && g.startsWith('#') || g === undefined || Math.abs(Number(g) - e) > 1e-9) { bad++; if (bad <= 12) console.log('MISMATCH', what, 'got', g, 'expected', e); } };
const d0 = L.firstDayCol, last = L.lastDayCol, nxt = L.nextCol;
const calls = ['R1', 'R2', 'R3', 'S1', 'S1B'];
for (let r = L.firstRow; r <= L.lastRow; r++) {
  const day = c => at(5, c), cell = c => at(r, c);
  const cnt = (code, upto) => { let k = 0; for (let c = d0; c <= upto; c++) if (cell(c) === code) k++; return k; };
  const pts = (wd, upto) => { let k = 0; for (let c = d0; c <= upto; c++) if (day(c) === wd && calls.includes(cell(c))) k++; return k; };
  const exp = {
    off: ['WE', 'NP', 'PH', 'RD', 'X', 'XX', 'X/NP'].reduce((a, k) => a + cnt(k, last), 0),
    Fri: 1.5 * pts('Fri', last), Sat: 2 * pts('Sat', last), Sun: 1.5 * pts('Sun', last),
    WD: ['Mon', 'Tue', 'Wed', 'Thu'].reduce((a, w) => a + pts(w, nxt), 0),
    R1B: cnt('R1B', last), C3: cnt('C3', last), OGN: 0.5 * cnt('OGN', last), OGC: cnt('OGC', last), S1: cnt('S1', last), S1B: cnt('S1B', last),
    leave: ['AL', 'SL', 'ML', 'PL', 'FCL', 'CCL', 'MC', 'HL', 'NS'].reduce((a, k) => a + cnt(k, nxt), 0),
  };
  exp.total = exp.Fri + exp.Sat + exp.Sun + exp.WD + exp.R1B + exp.C3 + exp.OGN + exp.OGC;
  for (const [k, v] of Object.entries(exp)) check(`row ${r} ${k}`, at(r, L.right[k]), v);
}
for (let r = L.countStart; r <= L.countEnd; r++) {
  const code = at(r, 3);
  for (let c = d0; c <= last; c++) { let k = 0; for (let p = L.firstRow; p <= L.lastRow; p++) if (at(p, c) === code) k++; check(`count ${code} col ${colName(c)}`, at(r, c), k); }
}
const meta = await api(`https://sheets.googleapis.com/v4/spreadsheets/${made.spreadsheetId}?fields=sheets(properties.gridProperties,merges,conditionalFormats)`);
const sh = meta.sheets[0];
const shape = (sh.merges || []).length === model.merges.length && (sh.conditionalFormats || []).length === model.cf.length && sh.properties.gridProperties.frozenRowCount === model.freeze.row && sh.properties.gridProperties.frozenColumnCount === model.freeze.col;
console.log(`checked ${checked} values: ${bad} wrong. Merges ${(sh.merges || []).length}/${model.merges.length}, colour rules ${(sh.conditionalFormats || []).length}/${model.cf.length}, frozen ${sh.properties.gridProperties.frozenRowCount} rows ${sh.properties.gridProperties.frozenColumnCount} columns.`);
console.log(bad || !shape ? 'DRY RUN FAILED' : 'DRY RUN PASSED: Google calculated every formula as expected and kept the merges, colour rules and frozen corner.');
console.log('Delete the throwaway file when done:', made.spreadsheetUrl);
process.exit(bad || !shape ? 1 : 0);
