// Unit tests for the sheet maker: the other tabs (js/sheetgen-tabs.js), the seniors carried from the last imported sheet
// (js/sheetgen-state.js), the locks in the Google body (js/sheetgen-gsheets.js), the Drive folder and Open / Lock calls
// (js/gsheets.js, with a fake fetch) and one month's files (js/ui-sheetmaker.js monthFiles). Made-up people only.
// Run: node nuh-junior-monthly/test/sheetmaker.test.mjs
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as S from '../js/sheet.js';
import * as G from '../js/gsheets.js';
import { buildSheet, weekdayOf } from '../js/sheetgen.js';
import { buildTabs, offRuns, requestBlock, monthLabel } from '../js/sheetgen-tabs.js';
import { specFromState, seniorRows } from '../js/sheetgen-state.js';
import { toSpreadsheetBody } from '../js/sheetgen-gsheets.js';
import { monthFiles, fileTitle, parseEmails, makerOf } from '../js/ui-sheetmaker.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

ok(monthLabel('2027-07') === 'Jul 27' && fileTitle('2027-07') === '07. Jul 27 Roster', 'tab and file names as the department names them');
// July 2027: Thu 1st; weekends 3-4, 10-11, 17-18, 24-25, 31; a made-up holiday on Fri 9 joins the weekend after it
ok(weekdayOf('2027-07', 3) === 6, 'Sat 3 July 2027');
ok(JSON.stringify(offRuns('2027-07', [9])) === JSON.stringify([[3, 4], [9, 11], [17, 18], [24, 25], [31, 31]]), 'days off as runs');

const people = [
  { grade: 'HOD', name: 'Hod Example', days: {}, next: '' }, { grade: 'C', name: 'Con Example', days: {}, next: '' },
  { grade: 'AC', name: 'Ac Example', days: {}, next: '' }, { grade: 'R', name: 'Sr Example', days: {}, next: '' },
  { grade: 'RES1', name: 'Res Example', days: {}, next: '' },
];
const model = buildSheet({ month: '2027-07', people, holidays: [9] });
const [jc, wr, lw] = buildTabs(model, { holidays: [9], dailyRosterers: 'Dr Made Up' });
ok(jc.name === 'Jul 27 Junior Call Roster' && wr.name === 'WR Premed Roster' && lw.name === 'Leave Waitlist', 'the three tabs');
const last = model.layout.lastRow;
ok(jc.cells.get('A1').f === `IFERROR(INDEX(Request!$C$1:$C$${last},MATCH("R1",Request!$D$1:$D$${last},0),0),"")`, 'the call roster looks the day up in the Request tab');
ok(/"OGD"/.test(jc.cells.get('E1').f) && /"OGN"/.test(jc.cells.get('F1').f) && /"OGC"/.test(jc.cells.get('E3').f) && /"OGC"/.test(jc.cells.get('F3').f), 'obstetric calls: OGD and OGN on a working day, OGC on a day off');
ok(/\$AH\$1:\$AH\$/.test(jc.cells.get('A31').f) && !jc.cells.has('A32') && jc.cells.get('H31').f.includes('"S1B"'), 'a row for each day, the last day in AH');
ok(jc.cells.get('A3').style.fill === 'CCFFCC' && !jc.cells.get('A2').style.fill && jc.cells.get('A9').style.fill === 'CCFFCC', 'weekends and holidays are green');
ok(wr.cells.get('A3').f.includes('"WR"') && wr.cells.get('F4').f.includes('"P6"') && !wr.cells.has('B3') && wr.cells.get('A4').f.includes('"P1"'), 'WR on the first day off, the premeds on the last');
ok(wr.cells.get('A31').f.includes('"P1"') && wr.cells.get('B31').f.includes('"P2"') && wr.cells.get('A9').f.includes('"WR"') && wr.cells.get('A11').f.includes('"P1"'), 'a single day off has the premeds only; a long weekend has both');
ok(wr.cells.get('G1').v === 'APS ward rounds' && wr.cells.get('G3').v === 'Sunday Premeds', 'the WR tab labels');
ok(lw.cells.get('B1').v === 'Day' && lw.cells.get('H1').v === 'Waitlist 6' && lw.cells.get('A32').v === 31 && lw.cells.get('B2').v === 'Thu', 'the waitlist: a row per day');
ok(lw.cells.get('I2').style.fill === 'FF9900' && lw.cells.get('J7').v.startsWith('Bad days') && lw.merges[0] === 'I10:M14' && lw.cells.get('I10').v.includes('Dr Made Up'), 'the colour key and the note naming the daily rosterers');
ok(requestBlock(model, people) === `D9:AH${last}` && model.layout.firstRow === 7 && requestBlock(model, people.slice(0, 2)) === '', 'the request block starts below the HOD, SC and consultant rows');
ok([jc, wr].every(t => [...t.cells.values()].every(c => !c.f || (c.f.match(/\(/g) || []).length === (c.f.match(/\)/g) || []).length)), 'every formula has balanced brackets');

// the Google body: four tabs, the locks
{
  const body = toSpreadsheetBody(model, { title: 'T', sheetName: 'Request', tabs: [jc, wr, lw], protect: { editors: ['A@x.org', 'a@x.org', 'b@x.org'], me: 'Me@x.org', open: 'D9:AH11' } });
  ok(body.sheets.map(s => s.properties.title).join('|') === 'Request|Jul 27 Junior Call Roster|WR Premed Roster|Leave Waitlist' && body.sheets.map(s => s.properties.sheetId).join('') === '0123', 'four tabs in order');
  const pr = body.sheets[0].protectedRanges[0];
  ok(pr.range.sheetId === 0 && pr.range.startRowIndex === undefined && pr.editors.users.join() === 'me@x.org,a@x.org,b@x.org' && !pr.warningOnly, 'the Request tab is locked to the rosterers (each once) and the person making it');
  ok(JSON.stringify(pr.unprotectedRanges[0]) === JSON.stringify({ sheetId: 0, startRowIndex: 8, endRowIndex: 11, startColumnIndex: 3, endColumnIndex: 34 }), 'with the request block open');
  ok(body.sheets[1].protectedRanges[0].range.sheetId === 1 && body.sheets[2].protectedRanges && !body.sheets[3].protectedRanges, 'the roster tabs locked, the Leave Waitlist open');
  const f = body.sheets[1].data[0].rowData[0].values[0];
  ok(f.userEnteredValue.formulaValue.startsWith('=IFERROR(') && f.userEnteredFormat.textFormat.fontFamily === 'Calibri' && f.userEnteredFormat.textFormat.fontSize === 10, 'formulas as formulas, Calibri 10');
  ok(body.sheets[3].data[0].rowData[9].values[8].userEnteredFormat.wrapStrategy === 'WRAP' && body.sheets[3].merges[0].endColumnIndex === 13, 'the note wraps in its merged box');
  const locked = toSpreadsheetBody(model, { tabs: [jc, wr, lw], protect: { editors: [], open: '' } });
  ok(locked.sheets[0].protectedRanges[0].unprotectedRanges.length === 0 && locked.sheets[0].properties.title === 'Request', 'locked for requests: nothing open');
  ok(!('editors' in locked.sheets[0].protectedRanges[0]), 'no rosterers: no editors list (only the person making it can edit)');
  ok(!toSpreadsheetBody(model, {}).sheets[0].protectedRanges, 'no locks unless asked');
}

// an imported sheet keeps each row's grade, seniors too; the next months' sheets carry the seniors' rows
const days = M.monthDays('2027-06');
const row = (sn, g, name, f) => [String(sn), g, name, ...days.map((d, i) => f(i)), 'Z', '0'];
const rows = [['legend'], ['legend 2'], ['', '', '', 'DEPARTMENT OF ANAESTHESIA STAFF ROSTER'], ['Dept', '', '', '1 to 30 June 27'],
  ['', '', '', ...days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][M.weekday(d)]), 'Thu', 'WE'],
  ['S/N', 'Grade', 'Name', ...days.map((d, i) => String(i + 1)), '1-Jul', 'WE'],
  row(1, 'HOD', 'Hod Example', () => ''), row(2, 'SC', 'Sc Example', () => 'OT'), row(3, 'C', 'Con Example', () => ''),
  row(4, 'AC', 'Ac Example', () => ''), row(5, 'HC', 'Hc Example', () => ''), row(6, 'RES1', 'Res Example', i => (i === 2 ? 'R1' : '')),
  [], ['', '', 'R1', ...days.map(() => '1')]];
const st = M.defaultState();
const grid = S.parseGrid(rows);
S.applyImport(st, S.planImport(st, grid, '2027-06'), grid, { tab: 'Request' });
const lay = st.sheets['2027-06'];
ok(lay.gradeTexts[7] === 'HOD' && lay.gradeTexts[11] === 'HC' && !lay.rows[7] && lay.rows[11], 'the import keeps every row\'s grade');
ok(seniorRows(lay).map(s => `${s.grade} ${s.name}`).join('|') === 'HOD Hod Example|SC Sc Example|C Con Example', 'the seniors\' rows in sheet order');
const spec = specFromState(st, '2027-07', { seniors: true });
ok(spec.seniorsFrom === '2027-06' && spec.people.slice(0, 3).map(p => p.name).join('|') === 'Hod Example|Sc Example|Con Example', 'July starts with June\'s seniors');
ok(spec.people[1].days[3] === 'WE' && !spec.people[1].days[1], 'the seniors\' days have only WE and PH');
ok(spec.people.find(p => p.name === 'Hc Example').grade === 'HC', 'a grade as typed in the last sheet (HC, not RP)');
ok(specFromState(st, '2027-07').people.length === spec.people.length - 3, 'without seniors: only the people the app holds');

// one month's files from the app's data
{
  st.settings.sheetMaker = { editors: ['r1@x.org', 'r2@x.org'], daily: 'Dr One and Dr Two', made: {} };
  const f = monthFiles(st, '2027-07');
  ok(f.body.properties.title === '07. Jul 27 Roster' && f.body.sheets.length === 4, 'four tabs in the July file');
  ok(f.block === `D10:AH${f.model.layout.lastRow}` && f.body.sheets[0].protectedRanges[0].editors.users.length === 2 && monthFiles(st, '2027-07', { me: 'me@x.org' }).body.sheets[0].protectedRanges[0].editors.users[0] === 'me@x.org', 'the block from the AC row, the rosterers on the locks');
  ok(f.body.sheets[3].data[0].rowData[9].values[8].userEnteredValue.stringValue.includes('Dr One and Dr Two'), 'the daily rosterers in the note');
  ok(monthFiles(st, '2027-07', { open: false }).body.sheets[0].protectedRanges[0].unprotectedRanges.length === 0, 'made locked');
  ok(parseEmails('A@x.org, b@x.org;\nc@x.org') .join() === 'a@x.org,b@x.org,c@x.org' && makerOf(M.defaultState()).anyone === true, 'emails, defaults');
}

// Drive and the locks, with a fake Google
{
  const calls = [];
  let perms = [{ id: 'p0', type: 'user', role: 'owner', emailAddress: 'me@x.org' }, { id: 'p1', type: 'user', role: 'writer', emailAddress: 'r1@x.org' }];
  const reply = (status, j) => ({ ok: status < 300, status, json: async () => j });
  const keep = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), m = init.method || 'GET', b = init.body ? JSON.parse(init.body) : null;
    calls.push({ u, m, b });
    if (u.includes('/files/GONE')) return reply(404, { error: { message: 'File not found' } });
    if (m === 'POST' && /drive\/v3\/files\?/.test(u)) return reply(200, { id: 'FOLDER1', webViewLink: 'https://drive.google.com/drive/folders/FOLDER1' });
    if (m === 'GET' && /files\/FOLDER1\/permissions/.test(u)) return reply(200, { permissions: perms });
    if (m === 'POST' && /files\/FOLDER1\/permissions/.test(u)) { perms = [...perms, { type: b.type, role: b.role, emailAddress: b.emailAddress }]; return reply(200, {}); }
    if (m === 'GET' && /files\/FOLDER1\?/.test(u)) return reply(200, { id: 'FOLDER1', trashed: false });
    if (m === 'GET' && /files\/SHEET1\?fields=parents/.test(u)) return reply(200, { parents: ['ROOT'] });
    if (m === 'PATCH') return reply(200, { id: 'SHEET1' });
    if (m === 'GET' && /spreadsheets\/SHEET1\?/.test(u)) return reply(200, { sheets: [{ properties: { sheetId: 0, title: 'Request' }, protectedRanges: [{ protectedRangeId: 77, range: { sheetId: 0 }, unprotectedRanges: [] }] }, { properties: { sheetId: 1, title: 'Jul 27 Junior Call Roster' }, protectedRanges: [{ protectedRangeId: 78, range: { sheetId: 1 } }] }] });
    if (m === 'POST' && /SHEET1:batchUpdate/.test(u)) return reply(200, {});
    return reply(500, { error: { message: 'unexpected ' + m + ' ' + u } });
  };
  G.hooks.getToken = async () => 'test-token';
  const f1 = await G.ensureFolder('GONE', 'Folder');
  ok(f1.id === 'FOLDER1' && f1.made && calls[1].b.mimeType === 'application/vnd.google-apps.folder', 'a folder gone from Drive is made again');
  ok((await G.ensureFolder('FOLDER1', 'Folder')).made === false, 'the folder is reused while it is there');
  calls.length = 0;
  const sh = await G.shareFolder('FOLDER1', { editors: ['R1@x.org', 'r2@x.org'], anyone: true });
  const posts = calls.filter(c => c.m === 'POST');
  ok(sh.added === 2 && posts[0].b.emailAddress === 'r2@x.org' && posts[0].u.includes('sendNotificationEmail=false') && posts[1].b.type === 'anyone' && !posts[1].u.includes('sendNotificationEmail'), 'sharing: new rosterers without an email, then anyone with the link');
  calls.length = 0;
  ok((await G.shareFolder('FOLDER1', { editors: ['r2@x.org'], anyone: true })).added === 0, 'sharing again adds nothing');
  calls.length = 0;
  await G.moveToFolder('SHEET1', 'FOLDER1');
  const patch = calls.find(c => c.m === 'PATCH');
  ok(patch && patch.u.includes('addParents=FOLDER1') && patch.u.includes('removeParents=ROOT'), 'the new sheet moves into the folder');
  calls.length = 0;
  const lk = await G.requestLock('SHEET1');
  ok(lk.protectedRangeId === 77 && lk.open === false, 'the Request tab\'s lock is found');
  await G.setRequestsOpen('SHEET1', 'D10:AH40');
  const up = calls.find(c => c.m === 'POST').b.requests[0].updateProtectedRange;
  ok(up.fields === 'unprotectedRanges' && up.protectedRange.protectedRangeId === 77 && up.protectedRange.unprotectedRanges[0].startRowIndex === 9 && up.protectedRange.unprotectedRanges[0].endColumnIndex === 34, 'Open for requests leaves the block open');
  calls.length = 0;
  await G.setRequestsOpen('SHEET1', null);
  ok(calls.find(c => c.m === 'POST').b.requests[0].updateProtectedRange.protectedRange.unprotectedRanges.length === 0, 'Lock closes it');
  globalThis.fetch = keep;
}

console.log(`sheetmaker: ${n} checks passed`);
