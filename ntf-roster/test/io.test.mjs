// NTF Roster: io.js and demo.js tests (node, no browser). Builds a made-up department sheet in the layout of the
// "ALL STAFF LEAVE REQUEST" workbook with ExcelJS (fake names only), parses it, applies it, exports and re-reads it,
// and checks the JSON backup, ICS and CSV helpers and the practice department.
// Run: node ntf-roster/test/io.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const ExcelJS = require(path.join(here, '../../lib/exceljs.min.js'));
const M = await import('../js/model.js');
const io = await import('../js/io.js');
const { demoState, SG_HOLIDAYS } = await import('../js/demo.js');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const sorted = a => [...(a || [])].sort();

// ---------- a fake department sheet (December 2026) ----------

// Columns: A = names; B, C = 29, 30 Nov; D..AH = 1..31 Dec; AI, AJ = 1, 2 Jan; AK = the name again.
const COL = d => {
  if (d.startsWith('2026-11-')) return 2 + (+d.slice(8) - 29);
  if (d.startsWith('2026-12-')) return 3 + +d.slice(8);
  if (d.startsWith('2027-01-')) return 34 + +d.slice(8);
  throw new Error(d);
};
const LAST = 37;

function fakeSheet() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Roster');
  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 6 }];
  const put = (r, c, v) => { ws.getCell(r, c).value = v; };
  const rowLabel = (r, text) => { put(r, 1, text); put(r, LAST, text); };
  // Count rows above the title, as in the department's copy
  rowLabel(2, "Snr Doctors 'Cr' & 'C'");
  rowLabel(3, 'Total Seniors At Work');
  for (let c = 2; c < LAST; c++) { put(2, c, { formula: 'COUNTIF(B8:B9,"C")', result: 1 }); put(3, c, 5); }
  ws.mergeCells(4, 1, 4, LAST - 1);
  put(4, 1, '  STAFF LEAVE REQUEST');
  // Month row: 29 30 | 1..31 | JAN JAN (merged), and the weekday row
  put(5, 1, 'DECEMBER 2026');
  put(5, 2, 29); put(5, 3, 30);
  for (let d = 1; d <= 31; d++) put(5, 3 + d, d);
  ws.mergeCells(5, 35, 5, 36);
  put(5, 35, 'JAN');
  put(5, LAST, 'DECEMBER 2026');
  const WD = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'S'];
  for (let c = 2; c <= 36; c++) put(6, c, WD[(c - 2) % 7]);   // 29 Nov 2026 is a Sunday
  put(6, 35, 1);                                               // the department's copy has a stray number here
  let r = 7;
  const section = name => rowLabel(r++, name);
  const person = (name, cells = {}) => {
    rowLabel(r, name);
    for (const [d, v] of Object.entries(cells)) put(r, COL(d), v);
    r++;
  };
  section('SENIOR CONSULTANTS / CONSULTANTS');
  person('Dr Alicia Wong', { '2026-11-29': 'AL', '2026-12-03': 'AL', '2026-12-04': 'AL', '2026-12-10': 'Cr', '2026-12-15': 'nc' });
  person('A/Prof Bala  Krishnan', { '2026-12-24': 'NC', '2027-01-02': 'AL' });
  section('ASSOCIATE CONSULTANTS');
  person('Cheng Li Ting', { '2026-12-02': '3-4.30pm', '2026-12-05': 'NUH', '2026-12-09': 'JX', '2026-12-12': 'Clinic UG' });
  section('SENIOR RESIDENTS');
  person('Daniel Marsh (R4-SR1  24/8/26-13/12/26)', { '2026-12-07': 'CR', '2026-12-08': 'x', '2026-12-10': 'AL (AM)' });
  section('SENIOR RESIDENT PHYSICIAN');
  person('Esha Patel', { '2026-12-01': 'C', '2026-12-02': 'x' });
  section('RESIDENT PHYSICIANS');
  person('Farhan Idris', { '2026-12-16': { richText: [{ text: 'T' }, { text: 'L' }] } });
  section('JUNIOR RESIDENTS');
  person('Gina Tan (R1-JR 7/9/26-27/12/26)', { '2026-12-20': 'jx', '2026-12-21': 'bcls-pm' });
  section('LOCUM');
  person('Hakim Noor', { '2026-12-31': 'C' });
  section('MEDICAL OFFICERS');
  person('Ivan Petrov (B) 6/5/26-4/1/27', { '2026-12-12': 'Nw', '2026-12-14': 'NS', '2026-12-17': 'Nc / Pr' });
  person('Jia Hui Lim 8/9/26-4/1/27', { '2026-12-25': 'nc' });
  section('LOCUMS');
  person('Kumar Rajan', { '2026-12-18': 'MC' });
  rowLabel(r++, 'Total Juniors At Work');
  rowLabel(r++, "Junior Doctors 'Cr' & C");
  r++;
  put(r++, 1, 'MEETING REQUESTS');
  const mr = r;
  put(mr, 1, 'NAME'); put(mr + 1, 1, 'DATE/TIME'); put(mr + 2, 1, 'TYPE OF MEETINGS');
  ws.mergeCells(mr, 5, mr, 7); ws.mergeCells(mr + 1, 5, mr + 1, 7); ws.mergeCells(mr + 2, 5, mr + 2, 7);
  put(mr, 5, 'Cheng Li Ting'); put(mr + 1, 5, '2 Dec (1.30-5.30pm)'); put(mr + 2, 5, 'Faculty meeting');
  r = mr + 4;
  // Legend at the bottom (no name in column A)
  put(r, 5, 'AL'); put(r, 6, 'Annual Leave'); put(r, 13, 'Nc'); put(r, 14, 'No call');
  put(r + 1, 5, 'C'); put(r + 1, 6, 'Call'); put(r + 1, 13, 'Cr'); put(r + 1, 14, 'Call Request');
  return wb;
}

// The app's state before the import: two people already known (one by short name), with some cells.
function startState() {
  const s = M.defaultState();
  s.staff.push({ id: 's-bala', name: 'Bala Krishnan', short: 'Bala K', group: 'cons', tags: [], fte: 1, start: '', end: '', note: '', active: true });
  s.staff.push({ id: 's-kumar', name: 'Kumar Rajan Pillai', short: 'kumar  RAJAN', group: 'locum', tags: [], fte: 1, start: '', end: '', note: '', active: true });
  M.setCell(s, '2026-12-24', 's-bala', { a: ['C'], auto: ['C'] });   // a call planned in the app
  M.setCell(s, '2026-12-20', 's-bala', { a: ['AL'] });               // leave no longer on the sheet
  M.setCell(s, '2026-12-21', 's-bala', { a: ['Clinic'], note: 'keep me' });
  M.setCell(s, '2027-01-02', 's-bala', { a: ['TL'] });               // next month's own sheet wins later
  return s;
}

// ---------- helpers ----------
{
  eq(io.dmy('25/5/26'), '2026-05-25', 'dmy two-digit year');
  eq(io.dmy('3/1/2027'), '2027-01-03', 'dmy four-digit year');
  eq(io.dmy('31/2/26'), '', 'dmy rejects 31 Feb');
  eq(io.normName('Dr.  Tan Ah-Kow'), 'tan ah kow', 'normName strips titles and punctuation');
  eq(io.normName('A/Prof Bala Krishnan'), 'bala krishnan', 'normName strips A/Prof');
  eq(io.parseNameCell('Name One (R4-SR1 25/5/26-13/9/26)'), { name: 'Name One', note: 'R4-SR1', start: '2026-05-25', end: '2026-09-13' }, 'bracket note with dates');
  eq(io.parseNameCell('Name Two (B) 6/5/26-7/9/26'), { name: 'Name Two', note: 'B', start: '2026-05-06', end: '2026-09-07' }, 'bracket note, dates after');
  eq(io.parseNameCell('Prof Name Three'), { name: 'Name Three', note: '', start: '', end: '' }, 'plain name, title stripped');
  const open = io.parseNameCell('Name Four (R4-SR1 14/12/26-Jun27)');
  eq([open.name, open.start, open.end, open.note], ['Name Four', '2026-12-14', '', 'R4-SR1 until Jun27'], 'unclear end date kept in the note');
  const s = M.defaultState();
  eq(io.parseCellText('NC', s), { a: [], r: ['Nc'], note: '', u: [] }, 'NC -> Nc request');
  eq(io.parseCellText('AL / cr', s), { a: ['AL'], r: ['Cr'], note: '', u: [] }, 'split on slash, case-insensitive');
  eq(io.parseCellText('x', s), { a: [], r: [], note: '', u: [] }, 'x ignored');
  eq(io.parseCellText('Clinic UG', s), { a: ['Clinic'], r: [], note: 'UG', u: [] }, 'words beside a code are a note');
  eq(io.parseCellText('JX', s).u, ['JX'], 'one unknown word is an unknown code');
}

// ---------- parse the fake sheet ----------
const state0 = startState();
const parsed = await io.parseDeptWorkbook(fakeSheet(), state0);
{
  eq(parsed.warnings, [], 'no warnings');
  eq(parsed.months.length, 1, 'one month sheet');
  const m = parsed.months[0];
  eq(m.month, '2026-12', 'month read from the title row');
  eq(m.dates.length, 35, '35 day columns (29 Nov to 2 Jan)');
  eq([m.dates[0], m.dates[1], m.dates[2], m.dates[32], m.dates[33], m.dates[34]],
    ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-31', '2027-01-01', '2027-01-02'], 'previous-month and JAN columns map to real dates');
  eq(parsed.people.length, 11, '11 people (count rows, meeting block and legend skipped)');
  const P = Object.fromEntries(parsed.people.map(p => [p.name, p]));
  eq(Object.keys(P).sort(), ['Alicia Wong', 'Bala Krishnan', 'Cheng Li Ting', 'Daniel Marsh', 'Esha Patel', 'Farhan Idris', 'Gina Tan', 'Hakim Noor', 'Ivan Petrov', 'Jia Hui Lim', 'Kumar Rajan'], 'plain names, titles and brackets removed');
  eq(parsed.people.map(p => p.group), ['cons', 'cons', 'ac', 'sr', 'srp', 'rp', 'jr', 'locum', 'mo', 'mo', 'locum'], 'sections map to groups (LOCUM and LOCUMS both locum)');
  eq(P['Bala Krishnan'].matchId, 's-bala', 'matched by name, case and spaces ignored');
  eq(P['Kumar Rajan'].matchId, 's-kumar', 'matched by short name');
  eq(P['Alicia Wong'].matchId, null, 'new person not matched');
  eq([P['Daniel Marsh'].note, P['Daniel Marsh'].start, P['Daniel Marsh'].end], ['R4-SR1', '2026-08-24', '2026-12-13'], 'SR bracket note and dates');
  eq([P['Gina Tan'].note, P['Gina Tan'].start, P['Gina Tan'].end], ['R1-JR', '2026-09-07', '2026-12-27'], 'JR bracket note and dates');
  eq([P['Ivan Petrov'].note, P['Ivan Petrov'].start, P['Ivan Petrov'].end], ['B', '2026-05-06', '2027-01-04'], '(B) note with dates after the bracket');
  eq([P['Jia Hui Lim'].note, P['Jia Hui Lim'].start, P['Jia Hui Lim'].end], ['', '2026-09-08', '2027-01-04'], 'dates without a bracket');
  const C = (name, d) => (parsed.cells[d] || {})[P[name].key];
  eq(sorted(C('Alicia Wong', '2026-12-03').a), ['AL'], 'leave code');
  eq(C('Alicia Wong', '2026-11-29').a, ['AL'], 'previous-month column read');
  eq(C('Alicia Wong', '2026-11-29').own, false, 'previous-month cell marked as not this sheet\'s own');
  eq(C('Alicia Wong', '2026-12-10').r, ['Cr'], 'Cr request');
  eq(C('Alicia Wong', '2026-12-15').r, ['Nc'], 'nc -> Nc');
  eq(C('Bala Krishnan', '2026-12-24').r, ['Nc'], 'NC -> Nc');
  eq(C('Bala Krishnan', '2027-01-02').a, ['AL'], 'JAN column read');
  eq(C('Cheng Li Ting', '2026-12-02').note, '3-4.30pm', 'time goes to the note');
  eq(C('Cheng Li Ting', '2026-12-05').a, ['NUH'], 'other code');
  eq(C('Cheng Li Ting', '2026-12-09').u, ['JX'], 'unknown code kept aside');
  eq([C('Cheng Li Ting', '2026-12-12').a, C('Cheng Li Ting', '2026-12-12').note], [['Clinic'], 'UG'], 'Clinic UG');
  eq(C('Daniel Marsh', '2026-12-07').r, ['Cr'], 'CR -> Cr');
  eq(C('Daniel Marsh', '2026-12-08'), undefined, 'x alone gives no cell');
  eq([C('Daniel Marsh', '2026-12-10').a, C('Daniel Marsh', '2026-12-10').note], [['AL'], '(AM)'], 'AL (AM)');
  eq(C('Esha Patel', '2026-12-01').a, ['C'], 'call read as an assignment');
  eq(C('Farhan Idris', '2026-12-16').a, ['TL'], 'rich text cell');
  eq(C('Gina Tan', '2026-12-21').note, 'bcls-pm', 'bcls-pm is a note');
  eq([C('Ivan Petrov', '2026-12-17').r, C('Ivan Petrov', '2026-12-17').a], [['Nc', 'Pr'], []], 'two requests in one cell');
  eq(C('Kumar Rajan', '2026-12-18').a, ['MC'], 'second locum section read');
  eq(parsed.unknownCodes, { JX: 2, NS: 1 }, 'unknown codes counted case-insensitively');
  eq(parsed.months[0].people, 11, 'people counted per month');
  eq(parsed.meetings.length, 1, 'one meeting request');
  eq([parsed.meetings[0].date, parsed.meetings[0].matchKey], ['2026-12-02', P['Cheng Li Ting'].key], 'meeting date and person');
  ok(/Faculty meeting/.test(parsed.meetings[0].text) && /1\.30-5\.30pm/.test(parsed.meetings[0].text), 'meeting text');
}

// The same sheet given as a file (ArrayBuffer) parses the same way.
{
  const buf = await fakeSheet().xlsx.writeBuffer();
  const again = await io.parseDeptWorkbook(buf, state0, { ExcelJS });
  eq(again.people.map(p => p.name), parsed.people.map(p => p.name), 'ArrayBuffer input parses the same');
  eq(Object.keys(again.cells).length, Object.keys(parsed.cells).length, 'same days with cells');
}

// ---------- apply ----------
const draft = structuredClone(state0);
const sum = io.applyImport(draft, parsed, { unknown: { JX: 'code', NS: 'note' } });
{
  const byName = n => draft.staff.find(p => p.name === n);
  eq([sum.added, sum.matched, sum.skipped], [9, 2, 0], 'nine added, two matched');
  eq(draft.staff.length, 11, 'staff count after import');
  eq(sum.codesAdded, ['JX'], 'JX added as a code');
  const jr = draft.duties.find(d => d.code === 'JX');
  eq([jr.kind, jr.auto], ['other', false], 'new code is kind other');
  const cheng = byName('Cheng Li Ting').id, ivan = byName('Ivan Petrov').id, alicia = byName('Alicia Wong').id;
  eq(byName('Daniel Marsh').group, 'sr', 'group from the section');
  eq([byName('Daniel Marsh').start, byName('Daniel Marsh').end, byName('Daniel Marsh').note], ['2026-08-24', '2026-12-13', 'R4-SR1'], 'posting dates kept on the person');
  eq(M.getCell(draft, '2026-12-09', cheng).a, ['JX'], 'unknown code written as a code');
  eq(M.getCell(draft, '2026-12-14', ivan).note, 'NS', 'unknown code kept as a note');
  eq(M.getCell(draft, '2026-12-02', cheng).note, '3-4.30pm; Meeting Faculty meeting 1.30-5.30pm', 'meeting added as a note');
  eq(M.getCell(draft, '2026-11-29', alicia).a, ['AL'], 'neighbour-month date fills an empty cell');
  const bala = M.getCell(draft, '2026-12-24', 's-bala');
  eq([bala.a, bala.r, bala.auto], [['C'], ['Nc'], ['C']], 'planned call kept, request from the sheet added');
  eq(M.getCell(draft, '2026-12-20', 's-bala'), null, 'leave no longer on the sheet is cleared');
  eq([M.getCell(draft, '2026-12-21', 's-bala').a, M.getCell(draft, '2026-12-21', 's-bala').note], [['Clinic'], 'keep me'], 'shifts and notes off the sheet are kept');
  eq(M.getCell(draft, '2027-01-02', 's-bala').a, ['TL'], 'neighbour-month date does not overwrite');
  ok(draft.months['2026-12'], 'month entry created');
  // Skipping a person leaves them out entirely.
  const d2 = structuredClone(state0);
  const keyA = parsed.people.find(p => p.name === 'Alicia Wong').key;
  const s2 = io.applyImport(d2, parsed, { people: { [keyA]: 'skip' } });
  eq([s2.added, s2.skipped], [8, 1], 'skip choice honoured');
  ok(!d2.staff.some(p => p.name === 'Alicia Wong'), 'skipped person not added');
}

// ---------- export, then read the export back ----------
async function roundTrip(state, month, label) {
  const blob = await io.exportDeptWorkbook(state, [month], { ExcelJS });
  ok(blob instanceof Blob && blob.size > 5000, `${label}: export gives an xlsx Blob`);
  const back = await io.parseDeptWorkbook(await blob.arrayBuffer(), state, { ExcelJS });
  eq(back.warnings, [], `${label}: export re-reads without warnings`);
  const inMonth = M.staffInMonth(state, month);
  eq(back.people.length, inMonth.length, `${label}: everyone in post appears once`);
  ok(back.people.every(p => p.matchId), `${label}: every exported person matches back`);
  const keyToId = Object.fromEntries(back.people.map(p => [p.key, p.matchId]));
  let diffs = 0, cells = 0;
  for (const d of M.monthDays(month)) {
    for (const p of inMonth) {
      const want = M.getCell(state, d, p.id);
      const key = Object.keys(keyToId).find(k => keyToId[k] === p.id);
      const got = (back.cells[d] || {})[key];
      const w = want ? [sorted(want.a), sorted(want.r), want.note || ''] : [[], [], ''];
      const g = got ? [sorted(got.a), sorted(got.r), got.note || ''] : [[], [], ''];
      if (JSON.stringify(w) !== JSON.stringify(g)) { diffs++; if (diffs < 4) console.log('  differs', d, p.name, JSON.stringify(w), JSON.stringify(g)); }
      if (want) cells++;
    }
  }
  eq(diffs, 0, `${label}: export -> import gives the same ${cells} cells`);
  for (const p of back.people) {
    const s = state.staff.find(x => x.id === p.matchId);
    eq([p.note, p.start, p.end], [s.note || '', s.start || '', s.end || ''], `${label}: ${p.name} note and dates survive`);
  }
  return blob;
}
await roundTrip(draft, '2026-12', 'imported sheet');
const demo = demoState('2026-10-15');
const demoBlob = await roundTrip(demo, '2026-10', 'practice department');
{
  // Layout of the export
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await demoBlob.arrayBuffer());
  const ws = wb.worksheets[0];
  eq(ws.getCell(1, 1).value, 'STAFF LEAVE REQUEST', 'title row');
  eq(ws.getCell(2, 1).value, 'OCTOBER 2026', 'month in column A');
  eq([ws.getCell(2, 2).value, ws.getCell(3, 2).value], [27, 'Su'], 'starts on the Sunday before (27 Sep)');
  eq(ws.getCell(2, 6).value, 1, '1 Oct in column F');
  eq([ws.views[0].state, ws.views[0].xSplit, ws.views[0].ySplit], ['frozen', 1, 3], 'frozen panes on names and dates');
  eq(ws.getCell(4, 1).value, 'SENIOR CONSULTANTS / CONSULTANTS', 'first section heading');
  const lastCol = ws.getRow(2).cellCount;
  eq(ws.getCell(2, lastCol).value, 'OCTOBER 2026', 'month repeated in the last column');
  eq(ws.getCell(5, lastCol).value, ws.getCell(5, 1).value, 'name repeated in the last column');
  const texts = [];
  ws.eachRow((row) => texts.push(io.cellText(row.getCell(1).value)));
  ok(texts.includes('Total Seniors At Work') && texts.includes('Total Juniors At Work') && texts.includes("Seniors on 'C'") && texts.includes("Juniors on 'C'"), 'four count rows');
  ok(texts.includes('LEGEND'), 'legend at the bottom');
  // A call cell is filled with the call colour; the next day shows x
  let found = false;
  ws.eachRow((row, r) => {
    if (found || r < 5) return;
    for (let c = 6; c < 36 && !found; c++) {
      const v = io.cellText(row.getCell(c).value);
      if (v === 'C') {
        found = true;
        eq(row.getCell(c).fill.fgColor.argb, 'FFC62828', 'call cell coloured with the call colour');
        ok(/\bx$/.test(io.cellText(row.getCell(c + 1).value)), 'post-call day shows x');
      }
    }
  });
  ok(found, 'a call cell was found in the export');
  const seniorsOnC = [];
  ws.eachRow((row) => { if (io.cellText(row.getCell(1).value) === "Seniors on 'C'") for (let c = 6; c <= 36; c++) seniorsOnC.push(row.getCell(c).value); });
  ok(seniorsOnC.length === 31 && seniorsOnC.every(n => n >= 1), 'a senior on call every day of the month (senior residents count as seniors)');
  // Two months -> two sheets
  const two = await io.buildDeptWorkbook(demo, ['2026-10', '2026-11'], { ExcelJS });
  eq(two.worksheets.length, 2, 'one sheet per month');
  const nov = two.worksheets[1];
  eq([nov.getCell(2, 2).value, nov.getCell(3, 2).value], [1, 'Su'], '1 Nov 2026 is a Sunday: no days before');
  eq([nov.getCell(2, 32).value, nov.getCell(3, 32).value], ['DEC 1', 'Tu'], 'trailing December days labelled with the month');
  eq(nov.getCell(2, 37).value, 'NOVEMBER 2026', 'whole weeks to the Saturday (5 Dec)');
}

// ---------- JSON backup and rules ----------
{
  const text = io.backupJSON(demo);
  const back = io.restoreJSON(text);
  eq(back, M.migrate(structuredClone(demo)), 'backup -> restore gives the same state');
  eq(JSON.parse(text).kind, 'ntf-roster-backup', 'backup kind');
  assert.throws(() => io.restoreJSON('not json'), /not a NTF Roster backup/); checks++;
  assert.throws(() => io.restoreJSON(io.rulesJSON(demo)), /rules file/); checks++;
  assert.throws(() => io.restoreJSON(JSON.stringify({ kind: 'ntf-roster-backup', v: 1 })), /damaged/); checks++;
  const rules = io.parseRulesJSON(io.rulesJSON(demo));
  eq(rules.rules.length, demo.rules.length, 'rules file round trip');
  eq(rules.duties.length, demo.duties.length, 'rules file carries the duty codes');
  assert.throws(() => io.parseRulesJSON(io.backupJSON(demo)), /whole backup/); checks++;
}

// ---------- ICS ----------
{
  const s = structuredClone(demo);
  s.duties.push({ code: 'Q', name: 'Ward; rounds, late', kind: 'shift', color: '#123456', ink: '#fff', overnight: false, auto: false, hours: 4 });
  const p = s.staff.find(x => M.monthDays('2026-10').some(d => (M.getCell(s, d, x.id)?.a || []).includes('C')));
  M.setCell(s, '2026-10-30', p.id, { a: [...(M.getCell(s, '2026-10-30', p.id)?.a || []).filter(c => c !== 'C' && c !== 'P'), 'Q'], note: 'Bring\nbadge' });
  const shifts = M.monthDays('2026-10').reduce((n, d) => n + (M.getCell(s, d, p.id)?.a || []).filter(c => s.duties.find(x => x.code === c)?.kind === 'shift').length, 0);
  const ics = io.icsForPerson(s, p.id, '2026-10', { now: new Date(Date.UTC(2026, 9, 1, 8, 0, 0)) });
  ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'), 'ICS wrapper with CRLF');
  ok(!/[^\r]\n/.test(ics), 'ICS uses CRLF only');
  eq((ics.match(/BEGIN:VEVENT/g) || []).length, shifts, 'one event per shift (leave and requests left out)');
  ok(ics.includes('SUMMARY:Ward\\; rounds\\, late (Q)'), 'ICS text escaping');
  ok(ics.includes('DTSTART;VALUE=DATE:20261030\r\nDTEND;VALUE=DATE:20261031'), 'all-day event');
  ok(ics.includes('DESCRIPTION:Bring\\nbadge'), 'newline escaped in the description');
  ok(ics.includes('DTSTAMP:20261001T080000Z'), 'UTC stamp');
  ok(ics.split('\r\n').every(l => new TextEncoder().encode(l).length <= 75), 'lines folded at 75 octets');
}

// ---------- CSV ----------
{
  const s = structuredClone(demo);
  const liam = s.staff.find(p => p.name === "Liam O'Brien");
  M.setCell(s, '2026-10-05', liam.id, { note: 'Course, "BCLS"' });
  const csv = io.csvForMonth(s, '2026-10');
  const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
  ok(csv.startsWith('﻿'), 'CSV has a BOM for Excel');
  eq(lines[0].split(',').slice(0, 3), ['Name', 'Group', '2026-10-01'], 'CSV header');
  eq(lines.length, M.staffInMonth(s, '2026-10').length + 1, 'one row per person');
  const row = lines.find(l => l.startsWith("Liam O'Brien,"));
  ok(row && row.endsWith('"5: Course, ""BCLS"""'), 'CSV quoting of commas and quotes');
  // text that Excel would run as a formula gets a leading '
  liam.name = '=HYPERLINK("https://example.invalid","x")';
  const evil = io.csvForMonth(s, '2026-10').split('\r\n').find(l => l.includes('HYPERLINK'));
  ok(evil.startsWith('"\'=HYPERLINK'), 'CSV escapes formulas');
}

// ---------- damaged files are cleaned or refused (review, Oct 2026) ----------
{
  const bad = structuredClone(demo);
  bad.duties.push({ code: 'ZZ', kind: 'shift"><img src=x onerror=alert(1)>', color: 'red;}body{display:none' });
  bad.groups.unshift(null); bad.staff.push(null, { name: 'No id' }); bad.tags = [null, ...bad.tags];
  bad.settings.holidays = [];
  const back = io.restoreJSON(io.backupJSON(bad));
  const zz = back.duties.find(d => d.code === 'ZZ');
  eq([zz.kind, zz.color], ['other', '#e0e0e0'], 'duty kind and colour from the fixed set');
  ok(back.groups.every(g => g && g.id) && back.staff.every(p => p && p.id) && back.tags.every(t => t && t.id), 'no null or id-less entries');
  eq(back.settings.holidays, {}, 'holidays made an object');
  assert.throws(() => io.restoreJSON(JSON.stringify({ kind: 'ntf-roster-backup', v: 1, state: { staff: [], cells: [] } })), /damaged/); checks++;
  const rf = io.parseRulesJSON(JSON.stringify({ kind: 'ntf-roster-rules', v: 1, rules: [{ id: 'w', type: 'cover', who: { groups: null }, when: { days: '0,6' }, params: { codes: ['C'], min: 1 } }], duties: [{ code: 'QQ', kind: '<b>' }] }));
  eq([rf.rules[0].who.groups, rf.rules[0].when.days, rf.duties[0].kind], [[], [0, 6], 'other'], 'rules files are cleaned too');
}

// ---------- the practice department ----------
{
  eq(JSON.stringify(demoState('2026-10-15')), JSON.stringify(demo), 'demo is deterministic for a given day');
  const groups = {};
  for (const p of demo.staff) groups[p.group] = (groups[p.group] || 0) + 1;
  eq(groups, { cons: 13, ac: 6, ext: 2, vc: 3, sr: 4, srp: 2, rp: 3, jr: 10, locum: 2, mo: 20 }, 'department size');
  eq(demo.staff.filter(p => p.tags.includes('babymo')).length, 3, 'three Baby MOs');
  eq(new Set(demo.staff.map(p => p.id)).size, demo.staff.length, 'unique staff ids');
  ok(SG_HOLIDAYS['2026-11-08'] && SG_HOLIDAYS['2026-12-25'] && SG_HOLIDAYS['2027-08-09'] && SG_HOLIDAYS['2027-01-01'], 'Singapore holidays 2026-2027');
  eq(demo.settings.holidays, SG_HOLIDAYS, 'demo uses the holiday list');
  const juniors = new Set(['sr', 'srp', 'rp', 'jr', 'locum', 'mo']);
  const dm = M.dutyMap(demo);
  let bad = 0;
  for (const d of M.monthDays('2026-10')) {
    const onC = demo.staff.filter(p => (M.getCell(demo, d, p.id)?.a || []).includes('C'));
    if (onC.filter(p => juniors.has(p.group)).length !== 2 || onC.filter(p => ['cons', 'ac'].includes(p.group)).length !== 1) bad++;
    for (const p of demo.staff) {
      const eff = M.effectiveCodes(demo, d, p.id);
      const shift = eff.some(c => dm.get(c)?.kind === 'shift');
      if (shift && (eff.includes('x') || eff.some(c => dm.get(c)?.kind === 'leave'))) bad++;
    }
  }
  eq(bad, 0, 'this month: 2 juniors + 1 senior on call daily, no shift on leave or post call');
  ok(M.monthDays('2026-11').every(d => demo.staff.every(p => !(M.getCell(demo, d, p.id)?.a || []).includes('C'))), 'next month has no calls (left for Auto-fill)');
  ok(M.monthDays('2026-11').some(d => demo.staff.some(p => (M.getCell(demo, d, p.id)?.a || []).includes('AL'))), 'next month has leave');
  ok(M.monthDays('2026-11').some(d => demo.staff.some(p => (M.getCell(demo, d, p.id)?.r || []).length)), 'next month has requests');
  try {
    const { evaluate } = await import('../js/rules.js');
    const ev = evaluate(demo, { from: '2026-10-01', to: '2026-10-31' });
    eq(ev.hard, 0, 'rules.js finds no hard problems in the practice month');
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
    console.log('  (rules.js not usable here, skipped the rule check:', e.message, ')');
  }
}

console.log(`${checks} checks passed`);
