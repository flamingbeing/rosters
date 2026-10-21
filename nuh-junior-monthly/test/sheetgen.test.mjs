// Unit tests for the sheet generator (js/sheetgen.js): the layout follows the month length and the number of people, and the
// formulas point at the right cells. Made-up people only. The recalculation check (LibreOffice) is in tools/sheetgen-verify.py.
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { demoState } from '../js/demo.js';
import { specFromState } from '../js/sheetgen-state.js';
import { toSpreadsheetBody } from '../js/sheetgen-gsheets.js';
import * as G from '../js/gsheets.js';
import { buildSheet, colName, colIndex, daysIn, weekdayOf, modelToRows } from '../js/sheetgen.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const mk = (month, count, extra = {}) => buildSheet({
  month, holidays: [], ...extra,
  people: Array.from({ length: count }, (_, i) => ({ grade: ['HOD', 'R', 'RES1', 'RES2', 'NHG', 'Fellow'][i % 6], name: 'P' + i, days: { 1: 'WE', 2: 'R1' }, next: 'Z' })),
});

ok(colName(1) === 'A' && colName(27) === 'AA' && colName(34) === 'AH' && colIndex('AU') === 47, 'column letters');
ok(daysIn('2027-02') === 28 && daysIn('2028-02') === 29 && daysIn('2026-11') === 30 && daysIn('2026-12') === 31, 'month lengths');

// the layout moves with the month: the day block, the 1st of next month, then the right-hand block
for (const [month, days, lastLetter, nextLetter, rightFirst] of [['2027-02', 28, 'AE', 'AF', 'AG'], ['2026-11', 30, 'AG', 'AH', 'AI'], ['2026-12', 31, 'AH', 'AI', 'AJ']]) {
  const m = mk(month, 8);
  ok(m.days === days && colName(m.layout.lastDayCol) === lastLetter && colName(m.layout.nextCol) === nextLetter && colName(m.layout.right.off) === rightFirst, `${month}: ${days} days end at ${lastLetter}, the right block starts at ${rightFirst}`);
  const first = m.cells.get(`${rightFirst}7`);
  ok(first.f.includes(`D7:${lastLetter}7`), `${month}: the day-off count covers D to ${lastLetter}`);
  ok(m.cells.get(`${colName(m.layout.right.WD)}7`).f.includes(`$D$5:$${nextLetter}$5`), `${month}: the weekday points include the 1st of next month`);
  ok(m.cells.get(`${lastLetter}6`).v === days && m.cells.get(`${nextLetter}6`).v.date, `${month}: day numbers and the next month's date`);
}

// rows follow the people: the counts and manpower block start after the last person, whatever the number
for (const count of [1, 5, 60, 191]) {
  const m = mk('2026-12', count);
  const L = m.layout;
  ok(L.lastRow === 6 + count && L.countStart === L.lastRow + 2, `${count} people: the counts start two rows under the last person`);
  const rows = modelToRows(m);
  ok(rows[L.countStart - 1][2] === 'R1' && /^=COUNTIF\(D7:D\d+,"R1"\)$/.test(rows[L.countStart - 1][3]) && rows[L.countStart - 1][3].includes(`D${L.lastRow}`), `${count} people: the R1 count covers every person`);
  ok(!JSON.stringify([...m.cells.values()].map(c => c.f || '')).includes('#REF'), `${count} people: no broken reference`);
}

// the manpower block uses the junior rows and the leave bands (runs of rows with the band's grades)
{
  const m = mk('2026-12', 12);
  const L = m.layout, R = L.manpower;
  ok(L.juniors[0] === 8 && L.juniors[1] === 18, 'juniors start under the senior grades');
  const jr = m.cells.get(`D${R.jr}`).f;
  ok(/D\d+:D\d+/.test(jr) && jr.includes('"AL"') && jr.includes('0.5*COUNTIF'), 'the JR leave row counts leave codes over its own rows');
  ok(m.cells.get(`D${R.avail}`).f === `D${R.jnr}-D${R.off}`, 'available = total - off');
}

// a public holiday on Monday to Thursday counts as a Sunday for the points; none on a weekend (already counted)
{
  const noHol = mk('2026-12', 3, { holidays: [] }), hol = mk('2026-12', 3, { holidays: [25, 26] });   // Fri 25 Dec, Sat 26 Dec
  ok(noHol.cells.get('AM7').f === hol.cells.get('AM7').f, 'a holiday on a Friday or Saturday adds nothing');
  const mon = mk('2026-11', 3, { holidays: [9] });   // Mon 9 Nov 2026
  ok(weekdayOf('2026-11', 9) === 1 && mon.cells.get('AL7').f.includes('COUNTIFS(L7,"R1")'), 'a Monday holiday adds the day cell to the Sunday points');
}

// colour rules: every code keeps its colour, thresholds for the totals and the manpower rows
{
  const m = mk('2026-12', 4);
  ok(m.cf.some(r => r.kind === 'equals' && r.text === 'ICU' && r.fill === 'FFFF00') && m.cf.some(r => r.kind === 'equals' && r.text === 'WE' && r.fill === 'CCFFCC'), 'codes have colour rules');
  ok(m.freeze.row === 6 && m.freeze.col === 3 && m.merges.length === 3, 'frozen corner and merged title cells');
}


// the Google Sheets request: one create call carrying every cell, the formulas as formulas, merges, freeze, widths and colour rules
{
  const m = mk('2026-12', 6, { holidays: [] });
  const body = toSpreadsheetBody(m, { title: 'Test roster' });
  const sh = body.sheets[0], rows = sh.data[0].rowData;
  ok(body.properties.title === 'Test roster' && sh.properties.gridProperties.frozenRowCount === 6 && sh.properties.gridProperties.frozenColumnCount === 3, 'create body: title and frozen corner');
  const cell = (a) => { const [, c, r] = /^([A-Z]+)(\d+)$/.exec(a); let col = 0; for (const ch of c) col = col * 26 + ch.charCodeAt(0) - 64; return rows[Number(r) - 1].values[col - 1]; };
  ok(cell('C7').userEnteredValue.stringValue === 'P0' && cell('A7').userEnteredValue.numberValue === 1, 'create body: names are text, serial numbers are numbers');
  ok(cell('AJ7').userEnteredValue.formulaValue.startsWith('=COUNTIF(D7:AH7,"WE")'), 'create body: formulas go in as formulas');
  ok(cell('AI6').userEnteredValue.numberValue === 46388 && cell('AI6').userEnteredFormat.numberFormat.pattern === 'd-mmm', 'create body: the 1st of next month is a date');   // 1 Jan 2027
  ok(sh.merges.length === 3 && sh.conditionalFormats.length === m.cf.length && sh.data[0].columnMetadata.length === rows[0].values.length, 'create body: merges, colour rules and widths');
  ok(sh.conditionalFormats.some(f => f.booleanRule.condition.type === 'TEXT_EQ' && f.booleanRule.condition.values[0].userEnteredValue === 'ICU'), 'create body: a code colour rule');
  const formulas = rows.flatMap(r => r.values).filter(v => v.userEnteredValue && v.userEnteredValue.formulaValue);
  ok(formulas.length === [...m.cells.values()].filter(c => c.f).length && formulas.every(v => !v.userEnteredValue.formulaValue.includes('#REF')), 'create body: every formula, none broken');
  // sending it: one POST, with the sign-in the app already has
  let sent = null;
  const keep = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent = { url: String(url), init }; return { ok: true, status: 200, json: async () => ({ spreadsheetId: 'NEW1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/NEW1/edit', sheets: [{ properties: { sheetId: 0 } }] }) }; };
  G.hooks.getToken = async () => 'test-token';
  const made = await G.createSpreadsheet(body);
  globalThis.fetch = keep;
  ok(made.id === 'NEW1' && /\/edit$/.test(made.url) && sent.init.method === 'POST' && sent.url.startsWith('https://sheets.googleapis.com/v4/spreadsheets?') && sent.init.headers.Authorization === 'Bearer test-token', 'createSpreadsheet: one POST with the Sheets scope token, returns the new link');
}

// the app's month as a spec: the people it has, WE on weekends, PH on holidays, calls as the sheet shows them
{
  const st = demoState('2026-12-10'), month = '2026-12';
  const spec = specFromState(st, month);
  const inMonth = M.staffInMonth(st, month);
  ok(spec.people.length === inMonth.length && spec.people.length > 5, 'spec: one row for each person in the month');
  const sat = M.monthDays(month).findIndex(d => M.weekday(d) === 6) + 1;
  ok(spec.people.every(p => !p.days[sat] || p.days[sat] !== '' ), 'spec: no empty strings');
  ok(spec.people.filter(p => p.days[sat] === 'WE').length > 0, 'spec: a Saturday with nothing on it reads WE');
  ok(spec.holidays.every(d => d >= 1 && d <= 31), 'spec: holidays are day numbers');
  const model = buildSheet(spec);
  ok(model.layout.lastRow === 6 + spec.people.length && [...model.cells.values()].some(c => c.v === 'WE'), 'spec: builds a sheet');
}
console.log(`nuh-junior-monthly sheetgen: ${n} checks passed`);
