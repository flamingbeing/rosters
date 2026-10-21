// Unit tests: posting rules, PPC, auto-fill on a small month, and the Google Sheet import / export round trip.
// Made-up names only. Run: node nuh-junior-monthly/test/app.test.mjs
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as S from '../js/sheet.js';
import { evaluate, describeRule, buildContext, dayOffWeight, carryBalances } from '../js/rules.js';
import { solve } from '../js/solver.js';
import { demoState } from '../js/demo.js';
import { apmesList } from '../js/apmes.js';
import * as G from '../js/gsheets.js';
import * as W from '../js/waitlist.js';
import * as Pools from '../js/pools.js';
import { topicOf, isPredicted, confirmedNote } from '../js/ui-rules.js';
import * as C from '../js/cloud.js';
import { relevanceOf } from '../js/ui-check.js';
import { applyAssignments, postingSet } from '../js/ui-roster.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const MONTH = '2026-12', days = M.monthDays(MONTH);

function team() {
  const s = M.defaultState();
  s.rules = s.rules.filter(r => !/^r-(c3|r1b)-(fair|sat)$/.test(r.id) && r.id !== 'r-r1b-d1');
  for (let k = 0; k < 6; k++) s.staff.push({ id: 'i' + k, name: 'Icu Person ' + k, group: 'res2', tags: [], fte: 1, active: true });
  for (let k = 0; k < 4; k++) s.staff.push({ id: 'c' + k, name: 'Cardiac Person ' + k, group: 'nhg', tags: [], fte: 1, active: true });
  for (const d of [M.addDays(days[0], -2), M.addDays(days[0], -1), ...days]) {
    for (let k = 0; k < 6; k++) M.setCell(s, d, 'i' + k, { a: ['ICU'] });
    for (let k = 0; k < 4; k++) M.setCell(s, d, 'c' + k, { a: ['C'] });
  }
  return s;
}
const evalM = s => evaluate(s, { from: days[0], to: days[days.length - 1] });
const ids = (s, rule) => evalM(s).violations.filter(v => v.ruleId === rule);

// PPC: two days after an ICU call, while still in ICU; not when the posting has ended
{
  const s = team();
  M.setCell(s, days[3], 'i0', { a: ['ICU', 'R1B'] });
  ok(M.effectiveCodes(s, days[4], 'i0').includes('x'), 'post call after R1B');
  ok(M.effectiveCodes(s, days[5], 'i0').includes('PPC'), 'PPC two days after R1B');
  M.setCell(s, days[5], 'i0', { a: ['CP'] });
  ok(!M.effectiveCodes(s, days[5], 'i0').includes('PPC'), 'no PPC once the ICU posting ended');
  M.setCell(s, days[5], 'i0', { a: ['ICU', 'R1B'] });
  ok(ids(s, 'r-ppc').length >= 1 && ids(s, 'r-ppc').every(v => v.hard === false), 'a call on the day off after post call is an EOD call: a preference, not a must-hold');
  M.setCell(s, days[5], 'i0', { a: ['ICU'] });
  M.setCell(s, days[4], 'i0', { a: ['ICU', 'R1B'] });
  ok(ids(s, 'r-r1b-gap').length >= 1 && ids(s, 'r-r1b-gap').every(v => v.hard !== false), 'a call on the post call day is never allowed');
}
// the owner's rulings (16 Oct 2026): requests and blocks are preferences; "new to ICU" is strict only for rotating residents and MOPEXes
{
  const s = team();
  ok(M.defaultState().rules.find(r => r.id === 'r-req-x').hard === false && M.defaultState().rules.find(r => r.id === 'r-req-xx').hard === false, 'requests and blocks are preferences');
  ok(M.defaultState().rules.find(r => r.id === 'r-postcall').hard !== false, 'post call as a day off stays a must-hold rule');
  s.staff.push({ id: 'rr0', name: 'Rotating Person', group: 'rr', tags: ['icunew'], fte: 1, active: true });
  for (const d of [M.addDays(days[0], -2), M.addDays(days[0], -1)]) { M.setCell(s, d, 'rr0', { a: ['CP'] }); M.setCell(s, d, 'i1', { a: ['CP'] }); }   // both start ICU on day 1
  for (const d of days) M.setCell(s, d, 'rr0', { a: ['ICU'] });
  s.staff[1].tags = ['icunew'];   // an anaesthesia resident (group res2), also new to ICU
  M.setCell(s, days[1], 'rr0', { a: ['ICU', 'R1B'] });
  M.setCell(s, days[1], 'i1', { a: ['ICU', 'R1B'] });
  const hardNew = evalM(s).violations.filter(v => v.ruleId === 'r-r1b-new' && v.hard !== false);
  ok(hardNew.length === 1 && hardNew[0].staffId === 'rr0', 'new to ICU is a must-hold only for the rotating resident');
  ok(evalM(s).violations.some(v => v.ruleId === 'r-r1b-new-res' && v.staffId === 'i1'), 'an anaesthesia resident new to ICU gets the preference instead');
  // a saved state from before the rulings is updated once
  const old = M.defaultState();
  old.rulesVersion = undefined;
  const x = old.rules.find(r => r.id === 'r-req-x'); x.hard = true; x.weight = 10;
  old.rules = old.rules.filter(r => r.id !== 'r-r1b-new-res'); delete old.rules.find(r => r.id === 'r-r1b-new').who.onlyGroups;
  const up = M.migrate(JSON.parse(JSON.stringify(old)));
  const older = M.defaultState();
  older.rulesVersion = 2;
  older.rules.find(r => r.id === 'r-postcall').params.codesA = ['x', 'PC', 'PPC'];
  older.rules = older.rules.filter(r => !['r-ppc', 'r-c3-eod'].includes(r.id));
  older.rules.find(r => r.id === 'r-r1b-gap').params.to = 2; older.rules.find(r => r.id === 'r-c3-gap').params.to = 2;
  older.rules.find(r => r.id === 'r-r1b-d1').hard = true;
  const up3 = M.migrate(JSON.parse(JSON.stringify(older)));
  ok(up3.rules.find(r => r.id === 'r-r1b-d1').hard === false, 'a day-1 ICU call becomes a last resort in an older saved state');
  ok(!up3.rules.find(r => r.id === 'r-postcall').params.codesA.includes('PPC') && up3.rules.some(r => r.id === 'r-ppc') && up3.rules.some(r => r.id === 'r-c3-eod') && up3.rules.find(r => r.id === 'r-r1b-gap').params.to === 1, 'an older saved state gets the EOD rules once');
  ok(up.rules.find(r => r.id === 'r-req-x').hard === false && up.rules.some(r => r.id === 'r-r1b-new-res') && up.rules.find(r => r.id === 'r-r1b-new').who.onlyGroups.includes('mopex'), 'an older saved state gets the rulings once');
}
// a cardiac call needs a cardiac day; first days of a posting
{
  const s = team();
  M.setCell(s, days[10], 'i1', { a: ['ICU', 'C3'] });
  ok(ids(s, 'r-c3-onc').length === 1, 'C3 off cardiac is flagged');
  s.staff[1].tags = ['icunew']; s.staff[1].group = 'rr';   // a rotating resident: strict
  for (const d of days.slice(0, 12)) M.setCell(s, d, 'i1', { a: ['CP'] });
  M.setCell(s, days[13], 'i1', { a: ['ICU', 'R1B'] });   // day 2 of the ICU block
  ok(ids(s, 'r-r1b-new').length === 1, 'new to ICU: no call on day 2');
  ok(/from day 4/.test(describeRule(s.rules.find(r => r.id === 'r-r1b-new'), s)), 'postingStart describes itself');
}
// auto-fill: one call of each a night, with no must-fix problems
{
  const s = team();
  const r = solve(s, { from: days[0], to: days[days.length - 1], timeMs: 4000 });
  ok(r.after.hard === 0, `auto-fill leaves no must-fix problems (got ${r.after.hard})`);
  let c3 = 0, r1b = 0;
  for (const m of Object.values(r.assignments)) for (const codes of Object.values(m)) { c3 += codes.filter(c => c === 'C3').length; r1b += codes.filter(c => c === 'R1B').length; }
  ok(c3 === days.length && r1b === days.length, 'one cardiac and one ICU call every night');
}
// EOD calls: with only two people on ICU a night can only be covered by a call right after the post call day, so Auto-fill uses one
// (and never a call on the post call day itself)
{
  const s = M.defaultState();
  s.rules = s.rules.filter(r => !/^r-c3/.test(r.id));
  for (let k = 0; k < 2; k++) s.staff.push({ id: 'e' + k, name: 'Eod Person ' + k, group: 'res2', tags: [], fte: 1, active: true });
  for (const d of [M.addDays(days[0], -3), M.addDays(days[0], -2), M.addDays(days[0], -1), ...days]) for (let k = 0; k < 2; k++) M.setCell(s, d, 'e' + k, { a: ['ICU'] });
  const r = solve(s, { from: days[0], to: days[days.length - 1], timeMs: 4000 });
  ok(r.after.hard === 0 && !(r.unfilled || []).length, `two people on ICU: every night covered with no must-fix problem (hard ${r.after.hard}, unfilled ${(r.unfilled || []).length})`);
  for (const [d, m] of Object.entries(r.assignments)) for (const [id, codes] of Object.entries(m)) if (codes.length) M.setCell(s, d, id, { a: [...(M.getCell(s, d, id)?.a || []), ...codes], auto: codes });
  ok(evalM(s).violations.some(v => v.ruleId === 'r-ppc'), 'and it says which nights are EOD calls');
}
// a rotation change: everyone on ICU starts on day 1 (nothing before it), yet night 1 still needs a call, so a day-1 call is the last resort
{
  const s = M.defaultState();
  s.rules = s.rules.filter(r => !/^r-c3/.test(r.id));
  for (let k = 0; k < 4; k++) s.staff.push({ id: 'n' + k, name: 'New Person ' + k, group: 'res2', tags: [], fte: 1, active: true });
  for (const d of days) for (let k = 0; k < 4; k++) M.setCell(s, d, 'n' + k, { a: ['ICU'] });
  const r = solve(s, { from: days[0], to: days[days.length - 1], timeMs: 3000 });
  ok(r.after.hard === 0 && !(r.unfilled || []).length, `a rotation change: night 1 is still covered (hard ${r.after.hard}, unfilled ${(r.unfilled || []).length})`);
}
// the Google Sheet: parse, import, and give back the same cells when nothing changed
{
  const head = ['S/N', 'Grade', 'Name', ...days.map((d, i) => String(i + 1)), '1-Jan', 'WE'];
  const wd = ['', '', '', ...days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][M.weekday(d)]), 'Fri', 'WE'];
  const row = (sn, g, name, f) => [String(sn), g, name, ...days.map((d, i) => f(i)), 'Z', '0'];
  const rows = [['legend'], ['legend 2'], ['', '', '', 'DEPARTMENT OF ANAESTHESIA STAFF ROSTER'], ['Dept', '', '', '1 to 31 December 26'], wd, head,
    row(1, 'SC', 'A Senior Person', () => 'WE'),
    row(2, 'RES2', 'Icu Example', i => (i === 4 ? 'R1B' : i === 5 ? 'PC' : i === 6 ? 'PPC' : 'ICU')),
    row(3, 'NHG', 'Cardiac Example', i => (i === 2 ? 'C3' : i === 3 ? 'PC' : 'C')),
    row(4, 'MOPEX', 'Leave Example', i => (i < 3 ? 'AL' : i === 9 ? 'X/NP' : i === 12 ? '(XX)' : '')),
    [], ['', '', 'R1', ...days.map(() => '1')]];
  const grid = S.parseGrid(rows);
  ok(grid && grid.people.length === 4 && grid.month === MONTH && S.monthFits(grid, MONTH), 'grid found, month read');
  let s = M.defaultState();
  const plan = S.planImport(s, grid, MONTH);
  ok(plan.people[0].skip && !plan.people[1].skip, 'senior rows are left alone');
  S.applyImport(s, plan, grid, { tab: 'Request' });
  const icu = s.staff.find(p => p.name === 'Icu Example');
  ok(M.getCell(s, days[4], icu.id).a.includes('ICU'), 'the posting under a call comes from the days around');
  ok(M.effectiveCodes(s, days[6], icu.id).includes('PPC'), 'PPC worked out after import');
  const ex = S.exportBlock(s, MONTH);
  ok(ex.changes.length === 0, `nothing changed, nothing differs (${ex.changes.map(c => c.cell + ' ' + c.from + '>' + c.to).join(', ')})`);
  ok([...S.countCalls(s, plan)].join(';') === 'C3,1;R1B,1', `the import review counts the calls it found (${[...S.countCalls(s, plan)].join(';')})`);
  ok(ex.topLeft === 'D7' && ex.range === 'D7:AI10', `pastes at D7 (${ex.range})`);
  ok(ex.tsv.split('\n')[3].split('\t')[9] === 'X/NP', 'an unchanged cell goes back as typed');
  // a call on the last day: the sheet's marker (Z) in the 1st-of-next-month cell is left as it is
  const cardLast = s.staff.find(p => p.name === 'Cardiac Example');
  const lastC = M.getCell(s, days[days.length - 1], cardLast.id);
  M.setCell(s, days[days.length - 1], cardLast.id, { a: [...lastC.a, 'C3'] });
  ok(!S.exportBlock(s, MONTH).changes.some(c => c.date === M.addDays(days[days.length - 1], 1)), 'a Z in the next-month column is not overwritten');
  M.setCell(s, days[days.length - 1], cardLast.id, { a: lastC.a });
  // place a cardiac call: the cell and the next day's PC change
  const card = s.staff.find(p => p.name === 'Cardiac Example');
  const c = M.getCell(s, days[20], card.id);
  M.setCell(s, days[20], card.id, { a: [...c.a, 'C3'] });
  const ex2 = S.exportBlock(s, MONTH);
  ok(ex2.changes.length === 2 && ex2.changes[0].to === 'C3' && ex2.changes[1].to === 'PC', 'a new call and its post call');
}
// reading and writing the Google Sheet (a fake Sheets API in memory): check it is unchanged before writing, write only the changes, read back
{
  const head = ['S/N', 'Grade', 'Name', ...days.map((d, i) => String(i + 1)), '1-Jan'];
  const wd = ['', '', '', ...days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][M.weekday(d)]), ''];
  const row = (sn, g, name, f) => [String(sn), g, name, ...days.map((d, i) => f(i)), 'Z'];
  const sheet = [['legend'], ['legend 2'], ['', '', '', 'DEPARTMENT OF ANAESTHESIA STAFF ROSTER'], ['Dept', '', '', '1 to 31 December 26'], wd, head,
    row(1, 'RES2', 'Icu Example', () => 'ICU'),
    row(2, 'NHG', 'Cardiac Example', () => 'C')];
  const colIdx = L => [...L].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const puts = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = decodeURIComponent(String(url));
    const json = o => ({ ok: true, status: 200, json: async () => o });
    if (/\/spreadsheets\/SHEETID\?fields/.test(u)) return json({ properties: { title: 'Test roster' }, sheets: [{ properties: { sheetId: 7, title: 'Request', gridProperties: { rowCount: 50, columnCount: 40 } } }] });
    if (/values\/'Request'!A1:/.test(u)) return json({ values: sheet.map(r => r.slice()) });
    if (/values:batchGet/.test(u)) return json({ valueRanges: [...u.matchAll(/ranges='Request'!([A-Z]+)(\d+)/g)].map(m => ({ values: [[(sheet[+m[2] - 1] || [])[colIdx(m[1])] ?? '']] })) });
    if (/values:batchUpdate/.test(u)) {
      const body = JSON.parse(opts.body);
      if (body.valueInputOption !== 'RAW') throw new Error('values must be written RAW');
      for (const d of body.data) { const m = d.range.match(/!([A-Z]+)(\d+)$/); sheet[+m[2] - 1][colIdx(m[1])] = d.values[0][0]; puts.push(m[1] + m[2]); }
      return json({});
    }
    return { ok: false, status: 404, json: async () => ({ error: { message: 'no' } }) };
  };
  G.hooks.getToken = async () => 'test-token';
  const p = G.parseSheetUrl('https://docs.google.com/spreadsheets/d/SHEETID_0123456789abcdefgh/edit?gid=7#gid=7');
  ok(p && p.id.startsWith('SHEETID') && p.gid === '7' && !G.parseSheetUrl('not a link'), 'a Google Sheet link gives its id and tab');
  const SID = 'SHEETID';
  const info = await G.getTabs(SID);
  const tab = G.chooseTab(info.tabs, null);
  ok(tab.title === 'Request', 'the Request tab is chosen');
  const grid = S.parseGrid(await G.readGrid(SID, tab));
  const s = M.defaultState();
  S.applyImport(s, S.planImport(s, grid, MONTH), grid, { tab: tab.title, source: { id: SID, gid: tab.gid, title: tab.title } });
  const lay = s.sheets[MONTH];
  ok((await G.checkUnchanged({ id: SID, gid: tab.gid }, lay, days.length)).ok, 'right after reading, the sheet is unchanged');
  const card = s.staff.find(x => x.name === 'Cardiac Example');
  M.setCell(s, days[20], card.id, { a: [...M.getCell(s, days[20], card.id).a, 'C3'] });
  const ex = S.exportBlock(s, MONTH);
  ok(ex.changes.length === 2 && ex.changes.every(c => c.row && c.k != null), 'a new call and its post call are the changes');
  // somebody edits the sheet in between: nothing may be written, and the cell is named
  sheet[7][3 + 4] = 'AL';
  const bad = await G.checkUnchanged({ id: SID, gid: tab.gid }, lay, days.length);
  ok(!bad.ok && bad.diffs.length === 1 && bad.diffs[0].now === 'AL' && bad.diffs[0].cell === 'H8', `an edit made since is found (${bad.diffs.map(d => d.cell).join(',')})`);
  // a row moved: the names no longer match
  sheet[7][3 + 4] = 'C';
  const moved = sheet.splice(6, 1)[0]; sheet.push(moved);
  ok(!(await G.checkUnchanged({ id: SID, gid: tab.gid }, lay, days.length)).ok, 'rows that moved are found');
  sheet.pop(); sheet.splice(6, 0, moved);
  ok((await G.checkUnchanged({ id: SID, gid: tab.gid }, lay, days.length)).ok, 'put back, the sheet is unchanged again');
  const w = await G.writeChanges({ id: SID }, lay, ex.changes);
  ok(w.verified && puts.length === 2 && sheet[7][3 + 20] === 'C3' && sheet[7][3 + 21] === 'PC', `only the 2 changed cells were written and read back (${puts.join(',')})`);
  ok(sheet[6].every((v, i) => v === row(1, 'RES2', 'Icu Example', () => 'ICU')[i]), 'the other rows are exactly as they were');
  s.sheets[MONTH].orig = JSON.parse(JSON.stringify(s.sheets[MONTH].orig));
  S.markWritten(s, MONTH, ex.changes);
  ok(S.exportBlock(s, MONTH).changes.length === 0, 'after writing, nothing differs from the sheet');
  ok(s.sheets[MONTH].lastWrite.changes.length === 2, 'the write is recorded so it can be undone');
  // undo: a cell somebody edited since is left alone, the other goes back
  sheet[7][3 + 21] = 'AL';
  const preview = await G.checkCells({ id: SID }, s.sheets[MONTH], s.sheets[MONTH].lastWrite.changes);
  ok(preview.skipped.length === 1 && preview.skipped[0].cell === 'Y8', 'the undo preview names the cell changed since');
  const u = await G.undoChanges({ id: SID }, s.sheets[MONTH], s.sheets[MONTH].lastWrite.changes);
  ok(u.restored.length === 1 && u.skipped.length === 1 && sheet[7][3 + 20] === 'C' && sheet[7][3 + 21] === 'AL' && u.verified, 'undo puts back only what the app wrote and leaves the other edit');
  S.markUndone(s, MONTH, u.restored, u.skipped);
  ok(s.sheets[MONTH].lastWrite.changes.length === 1 && s.sheets[MONTH].orig[8][3 + 20] === 'C', 'the undone cell is "as read" again, the other stays in the record');
  // a cell holding a formula is never overwritten
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) => (/FORMULA/.test(String(url)) ? { ok: true, status: 200, json: async () => ({ valueRanges: [{ values: [['=A1']] }] }) } : realFetch(url, o));
  let refused = '';
  try { await G.writeChanges({ id: SID }, s.sheets[MONTH], [{ cell: 'X8', row: 8, k: 20, from: 'C', to: 'C3' }]); } catch (e) { refused = e.message; }
  globalThis.fetch = realFetch;
  ok(/holds a formula/.test(refused), 'a cell holding a formula is not overwritten'); 
}
// the team copy stores a month's days as one JSON string (as a map Firestore made too many index entries): both forms read back
{
  const days0 = { '2026-12-03': { s1: { a: ['ICU', 'R1B'] } }, '2026-12-04': { s1: { a: ['ICU'], auto: ['R1B'] } } };
  ok(JSON.stringify(C.cellsFromDoc(JSON.stringify(days0))) === JSON.stringify(days0) && JSON.stringify(C.cellsFromDoc(days0)) === JSON.stringify(days0), 'the days read back from a JSON string or from a map');
  ok(Object.keys(C.cellsFromDoc('not json')).length === 0 && Object.keys(C.cellsFromDoc(null)).length === 0 && Object.keys(C.cellsFromDoc('[1]')).length === 0, 'a damaged or empty value gives no days');
  const st = C.mergeMonth(M.defaultState(), '2026-12', { cells: JSON.stringify(days0), status: 'draft' });
  ok(M.getCell(st, '2026-12-03', 's1').a.includes('R1B') && M.getCell(st, '2026-12-04', 's1').auto[0] === 'R1B', 'a month pulled from the team (days as a string) lands in the roster');
}
// the restore list: what an earlier save holds, and restoring one month leaves the other months alone
{
  const v = { cells: JSON.stringify({ '2026-12-03': { s1: { a: ['ICU'] } }, '2026-12-04': {} }), status: 'published', savedAt: 5, savedBy: { email: 'a@x.sg' } };
  ok(C.describeVersion('month', v) === '1 day filled, locked', 'a month save is described by its filled days and lock');
  ok(C.describeVersion('team', { team: { staff: [1, 2], rules: [1], duties: [] } }) === '2 staff, 1 rules, 0 duty codes', 'a team save is described by its lists');
  let st = C.mergeMonth(M.defaultState(), '2026-11', { cells: { '2026-11-03': { s1: { a: ['ICU'] } } }, status: 'draft' });
  st = C.mergeMonth(st, '2026-12', v);
  st = C.mergeMonth(st, '2026-12', { cells: {}, status: 'draft' });
  ok(M.getCell(st, '2026-11-03', 's1').a.includes('ICU') && !(M.getCell(st, '2026-12-03', 's1') || {}).a, 'restoring a month replaces only that month');
}
// locking a month: nothing in it can change until it is unlocked
{
  const mem = {};
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const { createStore } = await import('../js/store.js');
  const store = createStore({ demo: true, fallback: () => M.defaultState() });
  store.commit('add', d => { d.staff.push({ id: 'z1', name: 'Z', group: 'res2', tags: [], fte: 1, active: true }); });
  store.commit('lock', d => { M.setMonthLocked(d, MONTH, true); });
  ok(M.isMonthLocked(store.get(), MONTH), 'the month is locked');
  let told = null; store.onLocked = m => { told = m; };
  ok(store.commit('edit', d => { M.setCell(d, days[2], 'z1', { a: ['ICU'] }); }) === false && told && told[0] === MONTH && !M.getCell(store.get(), days[2], 'z1'), 'a change to a locked month is refused');
  ok(store.commit('edit next month', d => { M.setCell(d, M.addDays(days[days.length - 1], 2), 'z1', { a: ['ICU'] }); }) === true, 'another month can still change');
  store.commit('unlock', d => { M.setMonthLocked(d, MONTH, false); });
  ok(store.commit('edit', d => { M.setCell(d, days[2], 'z1', { a: ['ICU'] }); }) === true, 'unlocked, it changes again');
}
// every month starts locked (not in Practice): a month with no entry gets a locked one, existing months once per device
{
  const { createStore } = await import('../js/store.js');
  const old = M.defaultState();
  old.months['2026-09'] = { status: 'draft', publishedAt: '', note: '' };
  const store = createStore({ demo: false, fallback: () => old });
  ok(!M.isMonthLocked(store.get(), '2026-09'), 'an existing month is open before the app starts');
  store.lockAll();
  ok(M.isMonthLocked(store.get(), '2026-09'), 'every existing month is locked when the app opens');
  store.commit('unlock', d => { M.setMonthLocked(d, '2026-09', false); });
  ok(!M.isMonthLocked(store.get(), '2026-09') && store.lockAll() === true && M.isMonthLocked(store.get(), '2026-09'), 'an unlock lasts one visit: closing (or reopening) locks it again');
  ok(store.ensureLocked('2026-10') && M.isMonthLocked(store.get(), '2026-10'), 'a new month starts locked');
  store.commit('unlock', d => { M.setMonthLocked(d, '2026-10', false); });
  ok(store.ensureLocked('2026-10') === false && !M.isMonthLocked(store.get(), '2026-10'), 'a month someone unlocked is left alone');
  const demo = createStore({ demo: true, fallback: () => M.defaultState() });
  ok(demo.ensureLocked('2026-10') === false && demo.lockAll() === false && !M.isMonthLocked(demo.get(), '2026-10'), 'Practice is never locked');
}
// the header's cloud button: what it says
{
  const mem = {};
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const CSm = await import('../js/cloudstate.js');
  ok(CSm.headerState().kind === 'none', 'a browser that never used the cloud says just Cloud');
  CSm.noteChange(1000); 
  ok(CSm.headerState().kind === 'unsaved' || CSm.headerState().kind === 'none', 'a change with nothing synced yet is not called saved');
  CSm.noteSynced(5000, 'A');
  ok(CSm.headerState().kind === 'saved' && /^Saved/.test(CSm.headerState().label), 'after a save it says Saved');
  const at = CSm.read().synced;
  CSm.noteChange(at + 10);
  ok(CSm.headerState().kind === 'unsaved', 'a change after the save says Not saved');
  CSm.noteCloud(9000, 'B', true);
  ok(CSm.headerState().kind === 'both', 'unsaved changes and a newer cloud say the two differ');
  CSm.noteChange(at - 10);
  CSm.noteCloud(12000, 'B', true);
  ok(CSm.headerState().kind === 'newer', 'a newer cloud copy says so');
  delete globalThis.localStorage;
}
// the Check screen shows the things to improve that bear on what Fill places (C3, R1B), and says "any call" for every call
{
  const s = team();
  const dm = M.dutyMap(s);
  ok(describeRule(s.rules.find(r => r.id === 'r-req-r'), s).includes('any call') && /at most 2 calls a month/.test(describeRule(s.rules.find(r => r.id === 'r-sat2'), s)), 'a list of every call reads as "any call" ("calls" after a count)');
  ok(!/MO1 call, MO2 call/.test(describeRule(s.rules.find(r => r.id === 'r-req-x'), s)), 'and not as the whole list');
  s.rules.push(JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-fair'))));
  M.setCell(s, days[2], 'i0', { a: ['C3'] }); M.setCell(s, days[3], 'i0', { a: ['OGC'], r: [] });
  const mk = (ruleId, date, staffId, extra = {}) => ({ ruleId, date, staffId, hard: false, ...extra });
  const ev = { violations: [mk('r-sat2', days[2], 'i0'), mk('r-sat2', days[3], 'i0'), mk('r-c3-fair', '', '', { date: undefined, staffId: undefined }), { ruleId: 'r-fair', hard: false }, { ruleId: 'r-postcall', hard: true, date: days[3], staffId: 'i0' }] };
  const on = relevanceOf(s, ev, true), off = relevanceOf(s, ev, false);
  ok(on.keep(ev.violations[0]) && !on.keep(ev.violations[1]), 'a preference is kept when its cell holds C3 and hidden when it only holds another call');
  ok(on.keep(ev.violations[2]) && !on.keep(ev.violations[3]), 'a rule about C3 with no cell is kept; one about other calls is hidden');
  ok(on.keep(ev.violations[4]) && off.keep(ev.violations[1]) && on.hidden === 2 && off.hidden === 0, 'must-fix problems always show, and the switch off shows everything');
}
// "No calls until" a date set on a person: a hard rule, and Fill never places a call on them before it
{
  const st = team();
  ok(st.rules.some(r => r.id === 'r-nocalls' && r.type === 'noCallsUntil' && !r.hard === false), 'the rule is on by default and hard');
  const i0 = st.staff.find(x => x.id === 'i0'); i0.noCallsUntil = days[10];
  M.setCell(st, days[3], 'i0', { a: ['ICU', 'R1B'] }); M.setCell(st, days[12], 'i0', { a: ['ICU', 'R1B'] });
  const v = ids(st, 'r-nocalls');
  ok(v.length === 1 && v[0].hard && v[0].date === days[3] && /no calls until/.test(v[0].msg), 'a call before the date is a must-fix problem, one on or after it is not');
  const clear = team(); clear.staff.find(x => x.id === 'i0').noCallsUntil = days[10];
  const res = solve(clear, { from: days[0], to: days[days.length - 1], timeMs: 500, seed: 5 });
  const early = days.slice(0, 10).filter(d => (res.assignments[d].i0 || []).length);
  ok(early.length === 0, 'Fill places no call on them before their date');
  ok(days.slice(10).some(d => (res.assignments[d].i0 || []).length), 'and does place calls on them from it');
  const old = M.defaultState(); old.rulesVersion = 8; old.rules = old.rules.filter(r => r.id !== 'r-nocalls');
  ok(M.migrate(old).rules.some(r => r.id === 'r-nocalls') && M.migrate({ staff: [{ id: 'z', name: 'Z', noCallsUntil: 'soon' }] }).staff[0].noCallsUntil === '', 'a saved roster gains the rule, and a bad date is dropped');
}
// Fill only what was picked: other calls stay as they are but still count for the rules
{
  const st = team();
  const dd = days;
  const run = only => solve(st, { from: dd[0], to: dd[dd.length - 1], timeMs: 400, seed: 3, only });
  const all = run(undefined), onlyC = run(['C3']);
  const codes = r => new Set(Object.values(r.assignments).flatMap(row => Object.values(row).flat()));
  ok(codes(all).has('R1B') && codes(all).has('C3'), 'filling everything places cardiac and ICU calls');
  ok(codes(onlyC).has('C3') && !codes(onlyC).has('R1B'), 'filling only cardiac places no ICU calls');
  // an ICU call placed earlier by Fill survives a cardiac-only run
  const before = JSON.parse(JSON.stringify(st));
  const icu = Object.entries(all.assignments).flatMap(([d, row]) => Object.entries(row).filter(([, v]) => v.includes('R1B')).map(([sid]) => [d, sid]))[0];
  M.setCell(before, icu[0], icu[1], { a: [...(M.getCell(before, icu[0], icu[1])?.a || []), 'R1B'], auto: ['R1B'] });
  const after = JSON.parse(JSON.stringify(before));
  applyAssignments(after, solve(before, { from: dd[0], to: dd[dd.length - 1], timeMs: 400, seed: 3, only: ['C3'] }), dd, ['C3']);
  const cell = M.getCell(after, icu[0], icu[1]);
  ok(cell.a.includes('R1B') && cell.auto.includes('R1B'), 'an ICU call already there is left alone by a cardiac-only fill');
}
// the rosterer's points for a shared call: a weekday 1, Friday 1.5, Saturday 2, Sunday 1.5, a public holiday 1.5 (2 when the day after is off too)
{
  const wk = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 1], [1, 1], [1, 0]].map(([off, next]) => dayOffWeight(!!off, !!next));   // Mon..Sun
  ok(wk.join() === '1,1,1,1,1.5,2,1.5', `Monday to Sunday count ${wk.join(', ')}`);
  ok(dayOffWeight(true, false) === 1.5 && dayOffWeight(true, true) === 2 && dayOffWeight(false, true) === 1.5, 'a public holiday counts 1.5, or 2 when the next day is off too; the day before a day off 1.5');
  const f = M.DEFAULT_RULES.find(r => r.id === 'r-c3-fair');
  ok(f.params.scheme === 'offdays' && f.params.among.join() === 'C', 'cardiac sharing uses those points and counts C days only (not echo or perfusion weeks)');
  ok(/Fri 1\.5, Sat 2, Sun 1\.5/.test(describeRule(f, M.defaultState())), 'the rule says so in words');
  const old = M.defaultState();
  old.rulesVersion = 7;
  const oc = old.rules.find(r => r.id === 'r-c3-fair'); delete oc.params.scheme; oc.params.among = ['C', 'C-e', 'C-p'];
  const mig = M.migrate(old).rules.find(r => r.id === 'r-c3-fair');
  ok(mig.params.scheme === 'offdays' && mig.params.among.join() === 'C', 'a saved roster still in the old form gets the new points and C days only');
}
// request importance: X! must have, X? nice to have, next to X (and an older saved roster gains them)
{
  const s = team();
  const dm = M.dutyMap(s), up = new Map([...dm.keys()].map(c => [c.toUpperCase(), c]));
  ok(S.codesFromText('X!', dm, up).r.join() === 'X!' && S.codesFromText('X?', dm, up).r.join() === 'X?' && S.codesFromText('R!/R?', dm, up).r.join() === 'R!,R?', 'the sheet reads X!, X?, R! and R? as requests');
  const w = id => s.rules.find(r => r.id === id).weight;
  ok(['r-c3-fair', 'r-r1b-fair'].every(id => M.DEFAULT_RULES.find(r => r.id === id).weight === 40), 'sharing cardiac and ICU calls equally is weighted 40 (it was 10)');
  ok(w('r-req-rh') > w('r-req-r') && w('r-req-r') > w('r-req-rl') && w('r-req-rl') > 0, 'call requests have the same three levels: R! must have, R, R? nice to have');
  ok(w('r-req-xx') > w('r-req-xh') && w('r-req-xh') > w('r-req-x') && w('r-req-x') > w('r-req-xl'), 'blocked by the planner outranks must have, which outranks X, which outranks nice to have');
  const old = JSON.parse(JSON.stringify(s));
  old.rulesVersion = 3; old.rules.find(r => r.id === 'r-req-xx').weight = 80; old.rules.push({ ...JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-fair'))), weight: 10 }); old.duties = old.duties.filter(d => !['X!', 'X?', 'R!', 'R?'].includes(d.code)); old.rules = old.rules.filter(r => !['r-req-xh', 'r-req-xl', 'r-req-rh', 'r-req-rl'].includes(r.id));
  const m = M.migrate(old);
  ok(m.duties.some(d => d.code === 'X!') && m.duties.some(d => d.code === 'X?') && m.rules.some(r => r.id === 'r-req-xh') && m.rules.some(r => r.id === 'r-req-xl') && m.duties.some(d => d.code === 'R!') && m.duties.some(d => d.code === 'R?') && m.rules.some(r => r.id === 'r-req-rh') && m.rules.some(r => r.id === 'r-req-rl'), 'a saved roster gains the four request codes and their rules');
  ok(m.rules.find(r => r.id === 'r-c3-fair').weight === 40, 'a saved roster still at the old fairness weight gets the new one');
  ok(m.rules.find(r => r.id === 'r-req-xx').weight === 200, 'and a block already saved at the old weight is raised to the top');
  M.setCell(s, days[5], 'i0', { a: ['C3'], r: ['X!'] }); M.setCell(s, days[6], 'i0', { a: ['C3'], r: ['X?'] });
  ok(S.cellText(s, days[5], 'i0').includes('X!') && S.cellText(s, days[6], 'i0').includes('X?'), 'and they are written back to the sheet as typed');
}
// people the imported sheet leaves out are hidden from the month and not in post for the rules
{
  const st = M.defaultState();
  st.staff = ['s1', 's2', 's3'].map(id => ({ id, name: id.toUpperCase(), short: id, group: 'res1', tags: [], fte: 1, start: '', end: '', note: '', active: true }));
  st.sheets = { [MONTH]: { known: ['s1', 's2'], inSheet: ['s1'], rows: {} } };   // s3 was added after the sheet was read
  ok(M.staffInMonth(st, MONTH).map(p => p.id).join() === 's1,s3', 'someone the sheet leaves out is hidden; someone added later is not');
  ok(M.staffInMonth(st, '2027-01').length === 3, 'a month with no imported sheet hides nobody');
  const ctx = buildContext(st, { from: days[0], to: days[days.length - 1] });
  const i2 = ctx.index.get('s2'), i1 = ctx.index.get('s1');
  ok(ctx.act[i2 * ctx.n + ctx.lo] === 0 && ctx.act[i1 * ctx.n + ctx.lo] === 1, 'the rules treat them as not in post that month');
  st.settings.hideNotInSheet = false;
  ok(M.staffInMonth(st, MONTH).length === 3 && buildContext(st, { from: days[0], to: days[days.length - 1] }).act[i2 * ctx.n + ctx.lo] === 1, 'and the setting shows them again');
}
// import fixes found by the backtest: leave inside a posting keeps the posting; someone listed twice
{
  const head = ['S/N', 'Grade', 'Name', ...days.map((d, i) => String(i + 1)), '1-Jan'];
  const wd = ['', '', '', ...days.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][M.weekday(d)]), ''];
  const row = (sn, g, name, f) => [String(sn), g, name, ...days.map((d, i) => f(i)), ''];
  const rows = [['x'], ['x'], ['', '', '', 'December 26'], ['x'], wd, head,
    row(1, 'RES1', 'Icu Leave', i => (i === 6 ? 'TL' : i === 7 ? 'R1B' : i === 8 ? 'PC' : i === 9 ? 'PPC' : 'ICU')),
    row(2, 'RES2', 'Twice Listed', () => 'Z'),
    row(3, 'MOPEX', 'Twice Listed', i => (i < 10 ? 'CP' : 'AL'))];
  const grid = S.parseGrid(rows);
  const s = M.defaultState();
  const plan = S.planImport(s, grid, MONTH);
  ok(plan.people.filter(p => p.skip).length === 1 && plan.people[1].skip, 'the row of someone listed twice without their roster is left alone');
  S.applyImport(s, plan, grid, {});
  ok(s.sheets[MONTH].inSheet.length === s.sheets[MONTH].known.length && s.sheets[MONTH].known.length >= 2, 'an import records who the sheet lists and who was on the staff list');
  const p = s.staff.find(x => x.name === 'Icu Leave');
  ok(M.getCell(s, days[6], p.id).a.includes('ICU'), 'a day of leave inside ICU keeps the posting underneath');
  ok(!evaluate(s, { from: days[0], to: days[days.length - 1] }).violations.some(v => v.ruleId === 'r-r1b-d1' && v.staffId === p.id), 'leave inside ICU does not start a new posting');
  const ex = S.exportBlock(s, MONTH);
  ok(ex.changes.length === 0, 'and nothing is written back differently (' + ex.changes.map(c => c.cell + ' ' + c.from + '>' + c.to).join(', ') + ')');
}
// a new grade (the July change-over): a matched person moves to the end of the group the sheet's grade shows, only from
// the newest month imported; an unticked move stays; someone listed twice moves to the grade of the row that is kept
{
  const sheetFor = (month, title, people) => {
    const md = M.monthDays(month);
    const head = ['S/N', 'Grade', 'Name', ...md.map((d, i) => String(i + 1)), '1st'];
    const wd = ['', '', '', ...md.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][M.weekday(d)]), ''];
    return S.parseGrid([['x'], ['', '', '', title], wd, head, ...people.map(([g, name, code], i) => [String(i + 1), g, name, ...md.map(() => code), ''])]);
  };
  const s = M.defaultState();
  const person = (id, name, group) => s.staff.push({ id, name, short: '', group, tags: [], fte: 1, start: '', end: '', note: '', active: true });
  person('up', 'Year Up', 'res1'); person('kept', 'Kept Back', 'res1'); person('two', 'Twice Moved', 'res1');
  person('stay', 'Twice Stays', 'res1'); person('r2a', 'Res Two First', 'res2'); person('r2b', 'Res Two Last', 'res2');
  person('r1', 'Res One Other', 'res1');
  const june = sheetFor('2027-06', '1 to 30 June 27', [['RES2', 'Res Two First', 'CP'], ['RES2', 'Res Two Last', 'CP'], ['RES1', 'Year Up', 'CP'],
    ['RES1', 'Kept Back', 'CP'], ['RES1', 'Twice Moved', 'CP'], ['RES1', 'Twice Stays', 'CP'], ['RES1', 'Res One Other', 'CP']]);
  const pJun = S.planImport(s, june, '2027-06');
  ok(june.month === '2027-06' && !pJun.moves.length && !pJun.olderMoves.length, 'no grade changes, nobody moves');
  S.applyImport(s, pJun, june, {});
  const july = sheetFor('2027-07', '1 to 31 July 27', [['RES2', 'Res Two First', 'ICU'], ['RES2', 'Res Two Last', 'ICU'], ['RES2', 'Year Up', 'ICU'],
    ['RES2', 'Kept Back', 'ICU'], ['RES1', 'Twice Moved', 'Z'], ['RES2', 'Twice Moved', 'ICU'], ['RES1', 'Twice Stays', 'ICU'], ['RES2', 'Twice Stays', 'Z'],
    ['RES1', 'Res One Other', 'ICU']]);
  const pJul = S.planImport(s, july, '2027-07');
  ok(pJul.moves.map(m => `${m.name} ${m.fromGrade}>${m.toGrade}`).join(', ') === 'Year Up RES1>RES2, Kept Back RES1>RES2, Twice Moved RES1>RES2',
    `the review lists who moves grade (${pJul.moves.map(m => `${m.name} ${m.fromGrade}>${m.toGrade}`).join(', ')})`);
  const res = S.applyImport(s, pJul, july, { moves: ['up', 'two'] });   // Kept Back unticked
  const group = id => s.staff.find(p => p.id === id).group;
  ok(res.moved === 2 && group('up') === 'res2' && group('two') === 'res2', 'a new grade moves them to that group on Import');
  ok(group('kept') === 'res1', 'an unticked move stays where it was');
  ok(group('stay') === 'res1', 'listed twice: the row with the roster decides the grade');
  // the sheet is the source of truth for grades: each month shows the grade its own sheet gave, whatever People holds now
  ok(M.staffInMonth(s, '2027-07').filter(p => p.group === 'res2').map(p => p.name).join(', ') === 'Kept Back, Res Two First, Res Two Last, Year Up, Twice Moved',
    'July shows the grades July\'s sheet gave (Kept Back too, though his move to the current grade was unticked)');
  ok(M.staffInMonth(s, '2027-06').find(p => p.name === 'Year Up').group === 'res1' && M.staffInMonth(s, '2027-07').find(p => p.name === 'Year Up').group === 'res2',
    'an older month keeps the grade it had');
  ok(M.staffInMonth(s, '2027-08').find(p => p.name === 'Kept Back').group === 'res1', 'a month with no sheet uses the current grade');
  const gradeInCtx = m => { const d = M.monthDays(m); return buildContext(s, { from: d[0], to: d[d.length - 1] }).people.find(p => p.id === 'up').group; };
  ok(gradeInCtx('2027-06') === 'res1' && gradeInCtx('2027-07') === 'res2', 'the rules see each month\'s own grades (a rule about a group follows it)');
  ok(s.staff.map(p => p.id).join(',') === 'kept,stay,r2a,r2b,up,two,r1', `in the staff list too, right after the group's last person (${s.staff.map(p => p.id).join(',')})`);
  // an older month never moves anyone back
  const pOld = S.planImport(s, june, '2027-06');
  ok(pOld.latest === '2027-07' && !pOld.moves.length && pOld.olderMoves.map(m => m.id).join(',') === 'up,two', 'importing an older month moves nobody (the review says who differs)');
  S.applyImport(s, pOld, june, {});
  ok(group('up') === 'res2' && group('two') === 'res2', 'so June again leaves them in their new group');
  // the newest month again: with no ticks given, every planned move is made
  const again = S.planImport(s, july, '2027-07');
  ok(again.moves.map(m => m.id).join(',') === 'kept' && S.applyImport(s, again, july, {}).moved === 1 && group('kept') === 'res2', 'the newest month again offers the move left out, and makes it');
}
// the practice department loads and its rules can be checked
{
  const s = demoState('2026-10-15');
  ok(s.staff.length > 60, 'practice department');
  const ev = evaluate(s, { from: '2026-10-01', to: '2026-10-31' });
  ok(ev.violations.length >= 0 && !(ev.failed || []).length, 'every rule checks');
}
// the staff list for APMES People: everyone in post, in sheet order, with the sheet's grade; the roster month is the
// last one imported from the sheet
{
  const s = M.defaultState();
  s.staff.push({ id: 'a', name: 'Res Two', group: 'res2', tags: [], fte: 1, active: true },
    { id: 'b', name: 'Senior\tOne', group: 'r', tags: [], fte: 1, active: true, start: '2026-07-01' },
    { id: 'c', name: 'Gone Already', group: 'res1', tags: [], fte: 1, active: true, end: '2026-09-30' },
    { id: 'd', name: 'Not Active', group: 'res1', tags: [], fte: 1, active: false },
    { id: 'e', name: 'Mo Pex', group: 'mopex', tags: [], fte: 1, active: true, note: 'private note' });
  s.sheets = { '2026-11': {}, '2026-12': {} };
  const out = apmesList(s, { today: '2026-10-16' });
  const lines = out.text.replace(/\n$/, '').split('\n');
  ok(lines[0] === 'NUH Junior Monthly staff, roster month 2026-12, copied 2026-10-16' && lines[1] === 'Grade\tName\tFrom\tUntil', 'APMES list: the month and the header');
  ok(JSON.stringify(lines.slice(2)) === JSON.stringify(['R\tSenior One\t2026-07-01\t', 'RES2\tRes Two\t\t', 'MOPEX\tMo Pex\t\t']), 'APMES list: in post, sheet order, sheet grades (' + lines.slice(2) + ')');
  ok(out.count === 3 && out.month === '2026-12' && !out.text.includes('private'), 'APMES list: names and grades only');
  ok(apmesList(M.defaultState(), { today: '2026-10-16' }).month === '2026-10', 'APMES list: no sheet imported yet: this month');
  ok(apmesList(demoState('2026-10-15')).count > 60, 'APMES list: the practice department');
}
{
  // the cloud copy holds every month and its sheet layout
  let st = C.mergeMonth(M.defaultState(), '2026-11', { cells: { '2026-11-03': { s1: { a: ['ICU'] } } }, status: 'draft' });
  st = { ...st, sheets: { '2026-10': { rows: { s1: 3 }, orig: {}, inSheet: ['s1'], known: ['s1'] } } };
  ok(C.monthsWithContent(st).join() === '2026-10,2026-11', 'cloud: months with days or a sheet are saved');
  const pk = C.pickMonth(st, '2026-10');
  ok(pk.layout && pk.layout.rows.s1 === 3 && !C.pickMonth(st, '2026-11').layout, 'cloud: a month carries its sheet layout');
  const back = C.mergeMonth(M.defaultState(), '2026-10', { cells: '{}', layout: JSON.stringify(pk.layout), status: 'draft' });
  ok(back.sheets['2026-10'].inSheet[0] === 's1', 'cloud: the layout comes back with the month');
  const keep = C.mergeMonth(st, '2026-10', { cells: '{}', status: 'draft' });
  ok(keep.sheets['2026-10'].rows.s1 === 3, 'cloud: a copy with no layout keeps this device\'s');
}
{
  // the sheet's colours: a saved duty in its old colour moves across once; one the rosterer changed stays
  const old = M.defaultState(); old.rulesVersion = 9;
  const dd = c => old.duties.find(d => d.code === c);
  Object.assign(dd('C3'), { color: '#b71c1c', ink: '#fff' }); Object.assign(dd('S1'), { color: '#6d4c41', ink: '#fff' });
  const mig = M.migrate(JSON.parse(JSON.stringify(old)));
  const md = c => mig.duties.find(d => d.code === c);
  ok(md('C3').color === '#bf5600', 'colours: calls are orange like the sheet');
  ok(md('S1').color === '#bf5600', 'colours: a duty saved with older defaults also moves across');
  const df = c => M.DEFAULT_DUTIES.find(d => d.code === c).color;
  ok(df('ICU') === '#fff59d' && df('X') === '#c62828' && df('R') === '#1f5fd0' && df('AL') === '#aecbfa' && df('Z') === '#d5d8de', 'colours: ICU yellow, blocked red, requests blue, leave blue, grey');
}
{
  // a C3 call counts as a day on the cardiac posting (the call replaces the posting code on the sheet); R1B for ICU
  const s = M.defaultState();
  ok(postingSet(s, '@C3').has('C3') && postingSet(s, '@C3').has('C') && !postingSet(s, '@C3').has('C-e'), 'the cardiac posting filter includes C3');
  ok(postingSet(s, '@R1B').has('R1B') && postingSet(s, '@R1B').has('ICU'), 'the ICU posting filter includes R1B');
  // fairness: someone whose cardiac days are all calls (C3, no C) still counts in the share
  const t = team();
  t.rules = [JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-fair')))];
  for (const d of days) M.setCell(t, d, 'c3', { a: ['C3'] });
  const v = evaluate(t, { from: days[0], to: days[days.length - 1] }).violations.filter(x => x.ruleId === 'r-c3-fair');
  ok(v.some(x => x.staffId === 'c3'), 'a person whose cardiac days are all C3 calls is counted in the share (so they are over it)');
}
{
  // a call that replaced the posting code on the sheet is not "a cardiac call off the cardiac posting" when the person is in cardiac that week
  const t = team();
  t.rules = [JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-onc')))];
  M.setCell(t, days[5], 'c0', { a: ['C3'] });                       // C either side: in cardiac, the call replaced the C
  for (const d of days) M.setCell(t, d, 'c1', { a: [] });
  M.setCell(t, days[5], 'c1', { a: ['C3'] });                       // nowhere near cardiac
  const v = evaluate(t, { from: days[0], to: days[days.length - 1] }).violations.filter(x => x.ruleId === 'r-c3-onc');
  ok(!v.some(x => x.staffId === 'c0') && v.some(x => x.staffId === 'c1'), 'a C3 in the middle of a cardiac posting is fine, a C3 far from any cardiac day is still flagged');
}
{
  // the call on the last day of the month, the posting's C days in the next month (the sheet's call replaced the C)
  const s = M.defaultState();
  s.staff.push({ id: 'j', name: 'J', group: 'res3', tags: [], fte: 1, active: true });
  M.setCell(s, '2026-11-30', 'j', { a: ['C3'] });
  M.setCell(s, '2026-12-02', 'j', { a: ['C'] });
  const nov = M.monthDays('2026-11');
  const v = evaluate(s, { from: nov[0], to: nov[nov.length - 1] }).violations.filter(x => x.staffId === 'j').map(x => x.ruleId);
  ok(!v.includes('r-c3-onc'), 'a C3 on the last day of the month is on the cardiac posting when its C days start two days later');
}
{
  // the day-1 cardiac call rule does not apply to RES3 and senior residents
  const s = M.defaultState();
  s.rules = [JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-d1')))];
  for (const [id, g] of [['a', 'res3'], ['b', 'r'], ['c', 'res2']]) {
    s.staff.push({ id, name: id, group: g, tags: [], fte: 1, active: true });
    M.setCell(s, '2026-11-02', id, { a: ['C3'] });
    M.setCell(s, '2026-11-03', id, { a: ['C'] });
  }
  const nov = M.monthDays('2026-11');
  const who = evaluate(s, { from: nov[0], to: nov[nov.length - 1] }).violations.filter(x => x.ruleId === 'r-c3-d1').map(x => x.staffId).join();
  ok(who === 'c', 'no day-1 cardiac call preference for RES3 and senior residents, still for the others');
  const old = M.defaultState(); old.rulesVersion = 10; old.rules.find(r => r.id === 'r-c3-d1').who = { groups: [], tags: [], staff: [], exclude: [] };
  ok(M.migrate(JSON.parse(JSON.stringify(old))).rules.find(r => r.id === 'r-c3-d1').who.onlyGroups.length > 5, 'a saved roster gets the group limit once');
}
{
  // carry-over: last month's difference counts this month
  const st = M.defaultState();
  const rule = JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-fair')));
  st.rules = [rule];
  for (const id of ['x', 'y']) st.staff.push({ id, name: id, group: 'nhg', tags: [], fte: 1, active: true });
  const oct = M.monthDays('2026-10'), nov = M.monthDays('2026-11');
  for (const d of [...oct, ...nov]) for (const id of ['x', 'y']) M.setCell(st, d, id, { a: ['C'] });
  const wk = oct.filter(d => !M.isWeekend(d)).slice(0, 6);
  wk.forEach(d => M.setCell(st, d, 'x', { a: ['C3'] }));        // x took six weekday calls in October, y none
  M.setCell(st, nov[3], 'x', { a: ['C3'] }); M.setCell(st, nov[10], 'y', { a: ['C3'] });   // equal in November
  const bal = carryBalances(st, '2026-11', { ...rule.params, carryMonths: 4 });
  ok(bal.get('x') > 2.5 && bal.get('y') < -2.5, 'carry-over: x is over and y under by about three points after October');
  const flagged = c => { rule.params.carry = c; return evaluate(st, { from: nov[0], to: nov[nov.length - 1] }).violations.filter(v => v.ruleId === 'r-c3-fair').length; };
  ok(flagged(0) === 0 && flagged(1) > 0, 'carry-over: equal Novembers are fair without it, and not once October counts');
  ok(/carries over/.test(describeRule({ ...rule, params: { ...rule.params, carry: 0.5 } }, st)), 'carry-over: the rule says so');
}
{
  // fewer alerts about equal calls: a gap is only pointed out above `alert`, though Fill still aims for tolerance
  const st = M.defaultState();
  const rule = JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-fair')));
  rule.params.carry = 0; st.rules = [rule];
  ok(rule.params.alert === 1 && rule.params.alertPct === 40 && rule.params.tolerance === 1, 'equal calls: aim within 1; alert above 1 point and 40% of the average');
  for (const id of ['x', 'y']) st.staff.push({ id, name: id, group: 'nhg', tags: [], fte: 1, active: true });
  const nov = M.monthDays('2026-11');
  for (const d of nov) for (const id of ['x', 'y']) M.setCell(st, d, id, { a: ['C'] });
  const wd = nov.filter(d => !M.isWeekend(d));
  const n = k => evaluate(st, { from: nov[0], to: nov[nov.length - 1] }).violations.filter(v => v.ruleId === 'r-c3-fair').length;
  wd.slice(0, 2).forEach(d => M.setCell(st, d, 'x', { a: ['C3'] }));   // x two weekday calls, y none: each is 1 point from the mean
  ok(n() === 0, 'equal calls: a gap of one call is not pointed out');
  wd.slice(2, 6).forEach(d => M.setCell(st, d, 'x', { a: ['C3'] }));   // six against none: 3 points from the mean
  ok(n() > 0, 'equal calls: a bigger gap still is');
  const old = M.defaultState(); old.rulesVersion = 12; const oldP = old.rules.find(r => r.id === 'r-c3-fair').params; delete oldP.alert; delete oldP.alertPct;
  ok(M.migrate(JSON.parse(JSON.stringify(old))).rules.find(r => r.id === 'r-c3-fair').params.alert === 1, 'a saved roster gets the alert level once');
}
{
  // percentage alerts: a gap must be over 1 point and over alertPct of the average
  const st = M.defaultState();
  const rule = JSON.parse(JSON.stringify(M.DEFAULT_RULES.find(r => r.id === 'r-c3-fair')));
  rule.params.carry = 0; st.rules = [rule];
  for (const id of ['x', 'y', 'z']) st.staff.push({ id, name: id, group: 'nhg', tags: [], fte: 1, active: true });
  const nov = M.monthDays('2026-11');
  for (const d of nov) for (const id of ['x', 'y', 'z']) M.setCell(st, d, id, { a: ['C'] });
  const mt = nov.filter(d => { const w = new Date(d + 'T00:00:00').getDay(); return w >= 1 && w <= 4; });   // Mon to Thu: 1 point each
  const flaggedIds = () => [...new Set(evaluate(st, { from: nov[0], to: nov[nov.length - 1] }).violations.filter(v => v.ruleId === 'r-c3-fair').map(v => v.staffId))].sort().join();
  mt.slice(0, 3).forEach(d => M.setCell(st, d, 'x', { a: ['C3'] }));          // x 3 points, y and z 1 each: average 1.67
  mt.slice(3, 4).forEach(d => M.setCell(st, d, 'y', { a: ['C3'] }));
  mt.slice(4, 5).forEach(d => M.setCell(st, d, 'z', { a: ['C3'] }));
  ok(flaggedIds() === 'x', 'percentage alerts: a person with few calls well above the others is pointed out');
  // many calls: 12 against 8 (gap 2 on an average of 10 = 20%): not pointed out; with no percentage test it is
  for (const d of nov) for (const id of ['x', 'y', 'z']) M.setCell(st, d, id, { a: ['C'] });
  mt.slice(0, 12).forEach(d => M.setCell(st, d, 'x', { a: ['C3'] }));
  mt.slice(5, 13).forEach(d => M.setCell(st, d, 'y', { a: ['C3'] }));
  mt.slice(2, 12).forEach(d => M.setCell(st, d, 'z', { a: ['C3'] }));
  const sparse = flaggedIds();
  rule.params.alertPct = 0;
  ok(sparse === '' && flaggedIds() !== '', 'percentage alerts: a gap of 2 on an average of 10 is not pointed out, but is without the percentage test');
  // the R1 to R3 share compares each grade with itself
  const r = M.DEFAULT_RULES.find(x => x.id === 'r-fair');
  ok(r.params.byGroup === 'yes' && r.params.alertPct === 40, 'the R1 to R3 share compares the same grade');
}
{
  // the leave waitlist tab: names, remarks, statuses from fill colours, matching to the staff list
  ok(W.statusOfColour('#ff9900').id === 'waitlisted' && W.statusOfColour('#4a86e8').id === 'approved' && W.statusOfColour('#00ff00').id === 'expedited'
    && W.statusOfColour('#ff0000').id === 'rejected' && W.statusOfColour('#00ffff').id === 'closed' && W.statusOfColour('').id === 'adhoc' && W.statusOfColour('#ffffff').id === 'adhoc', 'waitlist: each legend colour is its status, no fill is ad hoc');
  ok(W.statusOfColour('#e08a2a').id === 'waitlisted' && !W.statusOfColour('#e08a2a').exact && W.statusOfColour('#f4a000').exact, 'waitlist: a close shade still reads as the nearest status, marked not exact');
  const sp = W.splitEntry('Alina (PM)'), sd = W.splitEntry('Ryan - medical appt');
  ok(sp.name === 'Alina' && sp.remark === 'PM' && sd.name === 'Ryan' && sd.remark === 'medical appt', 'waitlist: a remark in brackets or after a dash is split from the name');
  const staff = [{ id: 'a', name: 'Rachel Go', short: 'Rachel G' }, { id: 'b', name: 'Victoria Ng Ming Hui' }, { id: 'c', name: 'Gavin Soon Shi Hua' }, { id: 'd', name: 'Ryan Tay' }, { id: 'e', name: 'Ryan Lee' }];
  ok(W.matchStaff('rachel go', staff).id === 'a' && W.matchStaff('Victoria', staff).id === 'b' && W.matchStaff('Gavin Soon', staff).id === 'c', 'waitlist: names as the sheet writes them (case, first name, first two words) match');
  ok(W.matchStaff('Ryan', staff).ambiguous.length === 2 && W.matchStaff('Nobody Here', staff) === null, 'waitlist: two people fit -> which one; nobody fits -> not found');
  const NOV = '2026-11';
  const cell = (v, bg = '') => ({ v, bg });
  const grid = [
    [cell(''), cell('Day'), cell('Waitlist 1'), cell('Waitlist 2'), cell('Waitlist 3')],
    [cell('1', '#ccffcc'), cell('Sun'), cell(''), cell(''), cell('')],
    [cell('2'), cell('Mon'), cell('Victoria', '#ffffff'), cell('rachel go', '#4a86e8'), cell('')],
    [cell('3'), cell('Tue'), cell('Alina (PM)', '#ff9900'), cell('Ryan - medical appt', '#ff0000'), cell('')],
    [cell('4'), cell('Wed'), cell('Zed Unknown', '#00ffff'), cell(''), cell('')],
  ];
  const pw = W.parseWaitlist(grid, NOV, staff);
  ok(pw.header === 0 && pw.columns.length === 3 && pw.days === 4 && pw.entries.length === 5, `waitlist: the tab is read (${pw.entries.length} names, ${pw.days} days)`);
  const e = i => pw.entries[i];
  ok(e(0).date === '2026-11-02' && e(0).cell === 'C3' && e(0).status === 'adhoc' && e(0).staffId === 'b', 'waitlist: day, cell, status and person of the first name');
  ok(e(1).status === 'approved' && e(1).staffId === 'a' && e(2).remark === 'PM' && e(2).status === 'waitlisted' && e(3).status === 'rejected' && e(3).ambiguous.length === 2 && e(4).status === 'closed' && !e(4).staffId, 'waitlist: statuses, remarks, matches and non-matches');
  const sm = W.summarize(pw.entries);
  ok(sm.total === 5 && sm.counts.approved === 1 && sm.counts.closed === 1 && sm.unmatched === 3, 'waitlist: the legend counts');
  ok(W.parseWaitlist([['x', 'y']], NOV, staff).problems.length === 1, 'waitlist: a tab with no Waitlist heading says so');
  // reading the colours through the Sheets API (a fake)
  const keep = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    if (!/includeGridData=true/.test(u)) throw new Error('read the colours with grid data');
    if (!/effectiveFormat\.backgroundColor/.test(u) || /userEnteredValue|formula/i.test(u)) throw new Error('asks for more than text and colour');
    return { ok: true, status: 200, json: async () => ({ sheets: [{ data: [{ rowData: [
      { values: [{ formattedValue: 'Day' }, { formattedValue: 'Waitlist 1' }] },
      { values: [{ formattedValue: '3', effectiveFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } }, { formattedValue: 'Alina', effectiveFormat: { backgroundColor: { red: 1, green: 0.6 } } }] },
    ] }] }] }) };
  };
  G.hooks.getToken = async () => 'test-token';
  const got = await G.readColoured('SHEETID', { title: 'Leave Waitlist', rows: 31, cols: 24 });
  globalThis.fetch = keep;
  ok(got[1][0].bg === '' && got[1][1].bg === '#ff9900' && got[1][1].v === 'Alina' && got[0][1].v === 'Waitlist 1', 'waitlist: the colours come back as hex, white as no fill');
  ok(G.findTab([{ title: '1 - 30 Nov 26 Request' }, { title: 'Leave Waitlist' }], /wait\s*-?\s*list/i).title === 'Leave Waitlist', 'waitlist: the tab is found by its name');
}

// request screening and the strong / weak pools (the R1 to R3 rosterer's rules, 16 Oct 2026; made-up names)
{
  const s = M.defaultState();
  for (const [id, nm, tags] of [['a', 'Alpha One', []], ['b', 'Bravo Two', []], ['c', 'Charlie Three', []], ['d', 'Delta Four', []]]) s.staff.push({ id, name: nm, group: 'res2', tags, fte: 1, active: true });
  ok(s.rules.find(r => r.id === 'r-req-load').enabled && !s.rules.find(r => r.id === 'r-pool-1').enabled, 'pools: the count rules are on, the pool rules wait for the list');
  const D = M.monthDays('2026-12');
  // a: X, X/NP (one request, not two), R, R!, NP = 5 requests; b: X/NP x3 = 3 requests and 3 no-premed days
  M.setCell(s, D[1], 'a', { r: ['X'] }); M.setCell(s, D[2], 'a', { r: ['X', 'NP'] }); M.setCell(s, D[3], 'a', { r: ['R'] }); M.setCell(s, D[4], 'a', { r: ['R!'] }); M.setCell(s, D[5], 'a', { r: ['NP'] });
  for (const k of [7, 8, 9]) M.setCell(s, D[k], 'b', { r: ['X', 'NP'] });
  const ev = rule => evaluate(s, { from: D[0], to: D[D.length - 1] }).violations.filter(v => v.ruleId === rule);
  ok(ev('r-req-load').length === 1 && /Alpha/.test(ev('r-req-load')[0].message || ev('r-req-load')[0].text || JSON.stringify(ev('r-req-load')[0])), 'requests: five requests in a month is flagged, X/NP counts once');
  ok(ev('r-req-npload').length === 1, 'requests: three no-premed days is flagged');
  const text = 'Strong MO1\tWeak MO1\tStrong MO2\tWeak MO2\tStrong MO3\tWeak MO3\tResident\nAlpha One\tBravo Two\t\u2060\u2060Charlie Three \tDelta Four (GA)\t\t\tAlpha One\nNobody Known\t\t\t\t\t\t';
  const pr = Pools.parsePoolText(text);
  ok(pr.columns === 6 && pr.found.mo1s.length === 2 && pr.found.mo2s[0] === 'Charlie Three', 'pools: the table is read by its headings, odd spaces cleaned');
  const m = Pools.matchPools(pr.found, s.staff);
  ok(m.assign.length === 4 && m.unmatched.join() === 'Nobody Known', 'pools: names matched to staff, a stranger reported');
  const n = Pools.applyPools(s, m.assign);
  ok(n === 4 && s.staff.find(p => p.id === 'b').tags.join() === 'mo1,mo1w' && s.staff.find(p => p.id === 'c').tags.join() === 'mo2,mo2s', 'pools: each person gets the call level and the pool tag');
  ok(s.rules.find(r => r.id === 'r-pool-1').enabled, 'pools: the import turns the pool rules on');
  M.setCell(s, D[10], 'a', { r: ['R'] }); M.setCell(s, D[10], 'b', { r: ['R'] });   // two MO1s ask for the same day
  M.setCell(s, D[12], 'c', { r: ['R'] }); M.setCell(s, D[12], 'd', { r: ['R'] });    // strong and weak MO2
  M.setCell(s, D[14], 'a', { r: ['R'] }); M.setCell(s, D[14], 'c', { r: ['R'] });    // MO1 with MO2: no clash
  ok(ev('r-pool-1').length === 1 && ev('r-pool-2').length === 1 && ev('r-pool-3').length === 0, 'pools: two call requests on one day in the same pool are flagged, different pools are not');
  const old = M.defaultState(); old.rulesVersion = 16; old.tags = old.tags.filter(t => !/^mo\d[sw]$/.test(t.id)); old.rules = old.rules.filter(r => !/^r-(req-load|req-npload|pool-\d)$/.test(r.id));
  const mg = M.migrate(JSON.parse(JSON.stringify(old)));
  ok(mg.rulesVersion === 20 && mg.tags.some(t => t.id === 'mo3w') && mg.rules.some(r => r.id === 'r-pool-3' && !r.enabled), 'pools: a saved roster gains the tags and rules once');
}

// the Rules tab groups rules by topic
{
  const by = {};
  for (const r of M.defaultState().rules) (by[topicOf(r)] ||= []).push(r.id);
  ok(by.c3.includes('r-c3-fair') && by.r1b.includes('r-r1b-fair') && by.mo.includes('r-r1-cover') && by.requests.includes('r-req-x') && by.requests.includes('r-pool-1') && by.everyone.includes('r-leave'), 'rules tab: topics follow the duties a rule names');
  ok(!(by.everyone || []).some(id => /^r-(c3|r1b)-/.test(id)), 'rules tab: no cardiac or ICU rule is left under Everyone');
}

// the R1 to R3 rosterer's other rules (the R1 to R3 rosterer, 16 Oct 2026; made-up names)
{
  const s = M.defaultState();
  for (const [id, tags, g] of [['w1', ['mo1', 'mo1w'], 'res1'], ['w2', ['mo2', 'mo2w'], 'res2'], ['s3', ['mo3', 'mo3s'], 'res3']]) s.staff.push({ id, name: 'Test ' + id, group: g, tags, fte: 1, active: true });
  for (const r of s.rules) if (r.id.startsWith('r-mo-')) r.enabled = true;
  const D = M.monthDays('2026-12');
  const ev = rule => evaluate(s, { from: D[0], to: D[D.length - 1] }).violations.filter(v => v.ruleId === rule);
  M.setCell(s, D[3], 'w1', { a: ['R1'] }); M.setCell(s, D[3], 'w2', { a: ['R2'] }); M.setCell(s, D[3], 's3', { a: ['R3'] });
  ok(ev('r-mo-weak').length === 1, 'R1 to R3 rules: two weak MOs on the same night are flagged');
  M.setCell(s, D[5], 'w1', { a: ['R1', 'AP'] });
  ok(ev('r-mo-nogo').length >= 1, 'R1 to R3 rules: a call on a posting like AP is flagged');
  ok(ev('r-mo-res').length >= 1, 'R1 to R3 rules: a resident with fewer than 3 calls is flagged');
  const day = D.find(d => M.weekday(d) === 6 && D.indexOf(d) + 6 < D.length), at = D.indexOf(day);
  M.setCell(s, day, 's3', { a: ['R3'] }); M.setCell(s, D[at + 6], 's3', { a: ['R3'] });
  ok(ev('r-mo-satfri').length === 1, 'R1 to R3 rules: a Friday call six days after a Saturday call is flagged');
  const off = M.defaultState();
  ok(['r-mo-nogo', 'r-mo-weak', 'r-mo-satfri', 'r-mo-res', 'r-mo-fellow', 'r-mo-mopex'].every(id => off.rules.find(r => r.id === id && r.enabled === false)), 'R1 to R3 rules: all off until the group is turned on');
}

// Saturday after ICU, the Friday to Sunday cap, and a pool's call request gets its call (the R1 to R3 rosterer's rules; made-up names)
{
  const s = M.defaultState();
  for (const [id, tags] of [['p1', ['mo1', 'mo1s']], ['p2', ['fsscap']], ['p3', []]]) s.staff.push({ id, name: 'Pool ' + id, group: 'res2', tags, fte: 1, active: true });
  for (const r of s.rules) if (r.id.startsWith('r-mo-')) r.enabled = true;
  const D = M.monthDays('2026-12');
  const sat = D.filter(d => M.weekday(d) === 6);
  const ev = rule => evaluate(s, { from: D[0], to: D[D.length - 1] }).violations.filter(v => v.ruleId === rule);
  const at = d => D.indexOf(d);
  // ICU call on a Thursday, R2 on the Saturday after: flagged. ICU on a Monday, R2 on the Saturday: fine.
  const s1 = sat[1];
  M.setCell(s, D[at(s1) - 2], 'p3', { a: ['ICU', 'R1B'] }); M.setCell(s, s1, 'p3', { a: ['R2'] });
  ok(ev('r-mo-icusat1').length === 1, 'Saturday after ICU: a Saturday call two days after an ICU call is flagged');
  const s2 = sat[2];
  M.setCell(s, D[at(s2) - 5], 'p1', { a: ['ICU', 'R1B'] }); M.setCell(s, s2, 'p1', { a: ['R3'] });
  ok(ev('r-mo-icusat1').length === 1 && ev('r-mo-icusat2').length === 0, 'Saturday after ICU: an ICU call on the Monday before is allowed');
  M.setCell(s, D[at(sat[3]) - 6], 'p3', { a: ['ICU', 'R1B'] }); M.setCell(s, sat[3], 'p3', { a: ['R1'] });
  ok(ev('r-mo-icusat2').length === 1, 'Saturday after ICU: an ICU call on the Sunday six days before is flagged');
  ok(M.defaultState().rules.find(r => r.id === 'r-mo-icusat1').params.thenDay === '6' && /only on a Saturday/.test(describeRule(s.rules.find(r => r.id === 'r-mo-icusat1'), s)), 'Saturday after ICU: the rule reads in plain words');
  // the cap: three weekend-ish calls for the tagged person, the same for an untagged one is not counted
  const fri = D.filter(d => M.weekday(d) === 5);
  for (const d of [fri[0], sat[0], sat[1]]) M.setCell(s, d, 'p2', { a: ['R1'] });
  for (const d of [fri[1], sat[2], sat[3]]) M.setCell(s, d, 'p3', { a: ['R3'] });
  ok(ev('r-mo-fss').length === 1 && ev('r-mo-fss')[0].staffId === 'p2', 'Fri to Sun cap: three calls for the tagged person are flagged, an untagged person is not');
  // pool request gets its call
  const w = D[10];
  M.setCell(s, w, 'p1', { a: ['R2'], r: ['R'] });
  ok(ev('r-mo-pool-r1').length === 1, 'pool request: an MO1-pool R request given R2 instead of R1 is flagged');
  M.setCell(s, w, 'p1', { a: ['R1'], r: ['R'] });
  ok(ev('r-mo-pool-r1').length === 0, 'pool request: given R1, nothing to flag');
}

// Fill's ticks: cardiac and ICU by default; R1 to R3 can be ticked (they are auto-fill codes, start unticked)
{
  const s = M.defaultState();
  ok(['R1', 'R2', 'R3', 'C3', 'R1B'].every(c => s.duties.find(d => d.code === c).auto), 'Fill: R1 to R3 are auto-fill codes');
  ok(M.fillCodes(s).join() === 'C3,R1B', 'Fill: cardiac and ICU are ticked by default, R1 to R3 are not');
}

// confirming a predicted rule drops its To confirm tag and keeps the rest of its note
{
  ok(isPredicted({ note: 'Predicted from the roster guide: confirm or change.' }) && !isPredicted({ note: 'Asked for by the rosterer.' }) && !isPredicted({}), 'To confirm: only a predicted note carries the tag');
  ok(confirmedNote('Predicted from the roster guide: confirm or change.') === '' && confirmedNote('The guide: very hard to keep; real rosters break it often (1 in 3 cardiac calls). Predicted from the roster guide: confirm or change.') === 'The guide: very hard to keep; real rosters break it often (1 in 3 cardiac calls).', 'To confirm: confirming removes that sentence and keeps the rest of the note');
  ok(!M.defaultState().rules.some(r => isPredicted({ note: confirmedNote(r.note) })), 'To confirm: no default note still reads as predicted once confirmed');
}
console.log(`nuh-junior-monthly: ${n} checks passed`);
