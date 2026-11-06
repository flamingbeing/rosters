// Unit tests for starting a month from the master rotations (js/master.js): reading a block tab (weeks, the change-over
// name column, sections), matching names, the review lists and applying them. Made-up people and a made-up master only.
// Run: node nuh-junior-monthly/test/master.test.mjs
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { parseMaster, planMaster, applyMaster, chooseTab, tabYear, mapCode, findPerson, sheetName } from '../js/master.js';
import { specFromState } from '../js/sheetgen-state.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// A small master for 26-27: 26 weeks July to December, the change-over name column, 26 weeks January to June.
const labels = [];
{
  let d = new Date(2026, 6, 7);
  const end = new Date(2026, 6, 12);
  labels.push(`(MOPEX changeover)\n7* (T)-12`);
  d = new Date(end); d.setDate(d.getDate() + 1);
  for (let k = 1; k < 52; k++) {
    const s = new Date(d), e = new Date(d); e.setDate(e.getDate() + 6);
    if (s.getFullYear() === 2026 && s.getMonth() === 11 && s.getDate() === 28) e.setDate(e.getDate() + 1);   // 28 Dec to Mon 4 Jan
    labels.push(`${s.getDate()}${s.getDate() === 1 ? '*' : ''}-${e.getDate()}`);
    d = new Date(e); d.setDate(d.getDate() + 1);
  }
}
const head = ['*CHANGEOVER DAY', ...labels.slice(0, 26), '*CHANGEOVER DAY', ...labels.slice(26)];
const W = head.length;
const row = (a, ab, weeks) => { const r = Array(W).fill(''); r[0] = a; r[27] = ab; Object.entries(weeks).forEach(([k, v]) => { r[+k < 26 ? 1 + +k : 2 + +k] = v; }); return r; };
const fill = (from, to, code) => Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => [from + i, code]));
// week index: 0 = 7 Jul, 25 = 28 Dec (to 4 Jan), 26 = 5 Jan ...
const rows = [
  ['', 'Jul-26'], head,
  row('SR2 RESIDENTS', 'SR2 RESIDENTS', {}),
  row('Ann Example', 'Ann Example', { ...fill(0, 51, 'GC') }),
  row('SR1 RESIDENTS', 'SR1 RESIDENTS', {}),
  row('Ben Sample', 'Ben Sample', { ...fill(0, 25, 'ICU'), ...fill(26, 51, 'Liver') }),
  row('CA1 Residents', 'CA1 Residents', {}),
  row('Cara Test Lim', 'Cara Test Lim', { ...fill(0, 24, 'GC'), 25: 'OG1', 26: 'OG1', 27: 'NTFGH-JR', 28: 'OGNF1', 29: 'SAF' }),
  row('Cara Test Lim', 'Cara Test Lim', { 30: 'ICU' }),   // a duplicate row: the first one wins
  row('MOPEX', 'MOPEX', {}),
  row('Dan New (Pre-NS)', '', { ...fill(26, 34, 'GC') }),   // starts 5 Jan, ends 7 Mar; MOPEX names stay in column A
  row('External Residents', 'External Residents', {}),
  row('Eve Visitor (GS)', 'GS', { ...fill(27, 30, 'GC') }),
  row('Tan Fay, Gina (Cardiac 2)', 'TTSH', { ...fill(26, 30, 'C') }),
  row('TOTAL PROJECTED MANPOWER', '', {}),
  row('ICU', '', { 0: '6' }),
];

ok(tabYear('26-27 Block') === 2026 && tabYear('20 - 21, 21-22 Block') === 2020 && tabYear('Outrotation 1920') === null, 'academic year from the tab name');
ok(chooseTab(['This wk', '25-26 Block', '26-27 Block'], '2027-01') === '26-27 Block' && chooseTab(['26-27 Block', '25-26 Block'], '2026-03') === '25-26 Block', 'the tab for a month (July to June)');
ok(mapCode('NTFGH-SR').code === 'NTF' && mapCode('Liver').code === 'LI' && mapCode('GC').code === '' && mapCode('').code === null && mapCode('Prep/ Neu').code === '' && !mapCode('Mystery').known, 'master codes');

const master = parseMaster(rows, '26-27 Block');
ok(master.weeks[0].from === '2026-07-07' && master.weeks[0].to === '2026-07-12', 'the first week starts on Tuesday 7 July');
ok(master.weeks[25].from === '2026-12-28' && master.weeks[25].to === '2027-01-03' && master.weeks[26].from === '2027-01-04', 'the change-over day (4 Jan) starts the new half');
ok(master.duplicates.filter(d => d.half === 1).length === 1 && master.duplicates.every(d => d.name === 'Cara Test Lim'), 'a name twice in a half is reported');
const cara = master.people.find(p => p.name === 'Cara Test Lim');
ok(cara.halves[1].codes['2027-01-25'] === 'SAF' && !cara.halves[1].codes['2027-02-01'], 'the first row of a duplicate is used');
ok(master.people.find(p => p.name === 'Dan New (Pre-NS)').halves.length === 2, 'MOPEX names come from column A in both halves');
ok(master.people.find(p => p.name === 'Eve Visitor (GS)'), 'external residents keep column A (the change-over column holds their department)');
ok(master.people.find(p => /Gina/.test(p.name)).halves[1].group === 'nhg', 'TTSH cardiac residents go to NHG');
ok(!master.people.some(p => p.name === 'ICU'), 'the manpower rows are not people');

ok(sheetName('Dan New (Pre-NS)', 'mopex') === 'Dan New' && sheetName('Eve Visitor (GS)', 'rr') === 'Eve Visitor (GS)' && sheetName('Tan Fay, Gina (Cardiac 2)', 'nhg') === 'Gina Tan Fay', 'names for new people');

// People: Ann and Ben are known (Ben under a longer name), Cara under a typo, Old Gone left; Ann is SR2 in the R group
let state = M.defaultState();
const P = (id, name, group, extra = {}) => ({ id, name, short: '', group, tags: [], fte: 1, start: '', end: '', noCallsUntil: '', note: '', active: true, ...extra });
state.staff = [P('a', 'Ann Example', 'r'), P('b', 'Ben Sample Tan', 'res3'), P('c', 'Cara Tast Lim', 'res1'), P('g', 'Old Gone', 'res2')];
ok(findPerson(state.staff, 'Ann Example').how === 'exact' && findPerson(state.staff, 'Ben Sample').id === 'b' && findPerson(state.staff, 'Cara Test Lim').id === 'c', 'name matching (exact, words missing, a typo)');
ok(findPerson(state.staff, 'Nobody Here') === null, 'no match for a stranger');

const plan = planMaster(state, master, '2027-01');
ok(plan.add.map(e => e.name).sort().join('|') === 'Dan New (Pre-NS)|Eve Visitor (GS)|Tan Fay, Gina (Cardiac 2)', 'new people');
ok(plan.close.map(e => e.match.id).sort().join('') === 'bc', 'close names are listed for a check');
ok(plan.moves.length === 1 && plan.moves[0].id === 'b' && plan.moves[0].group === 'r', 'grade change from the sections (RES3 to SR1 = R)');
ok(plan.promote.length === 1 && plan.promote[0].id === 'a', 'January offers SR2s for AC');
ok(planMaster(state, master, '2027-02').promote.length === 0, 'promotion is offered only at the change-over months');
ok(plan.gone.length === 1 && plan.gone[0].id === 'g' && plan.gone[0].end === '2026-12-31', 'people not in the master are offered as gone');
const dan = plan.entries.find(e => /Dan/.test(e.name));
ok(dan.start === '2027-01-04' && dan.end === '2027-03-07', 'a new MOPEX gets the first and last day of their weeks');
ok(plan.floats > 0, 'obstetric float weeks are counted, not set');

// apply: defaults (promote and gone unticked), Cara left out
const draft = structuredClone(state);
const res = applyMaster(draft, plan, { off: new Set(['e:' + normKey('Cara Test Lim')]) });
function normKey(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
ok(res.added === 3 && res.moved === 1 && res.promoted === 0 && res.ended === 0, 'applied counts');
const byName = nm => draft.staff.find(p => p.name === nm);
ok(byName('Dan New').group === 'mopex' && byName('Dan New').start === '2027-01-04' && byName('Dan New').aliases[0] === 'Dan New (Pre-NS)', 'the new MOPEX with dates and the master name');
ok(byName('Ben Sample Tan').aliases.includes('Ben Sample') && byName('Ben Sample Tan').group === 'r', 'a close match remembers the master name and moves grade');
ok(M.getCell(draft, '2027-01-04', 'b').a[0] === 'LI' && M.getCell(draft, '2027-01-03', 'b').a[0] === 'ICU', 'postings by day, the change-over day in the new half');
ok(!M.getCell(draft, '2027-01-05', 'c'), 'a person left out is not touched');
ok(M.getCell(draft, '2027-01-10', byName('Ann Example').id) === null || !(M.getCell(draft, '2027-01-10', 'a').a || []).length, 'the general list has no posting');
ok(findPerson(draft.staff, 'Ben Sample').how === 'exact', 'next time the master name matches at once');

// a month whose sheet was imported hides people not on it; the master's people for the month are shown
{
  const d3 = structuredClone(state);
  d3.sheets = { '2027-01': { inSheet: ['a'], known: ['a', 'b', 'c', 'g'] } };
  applyMaster(d3, plan, {});
  ok(!M.notInSheet(d3, '2027-01').has('b') && M.notInSheet(d3, '2027-01').has('g'), 'people in the master join the imported month; others stay hidden');
}

// a second pull changes nothing more; calls typed on top stay
M.setCell(draft, '2027-01-06', 'b', { a: ['LI', 'R1'] });
const again = applyMaster(draft, planMaster(draft, master, '2027-01'), { off: new Set(['e:' + normKey('Cara Test Lim')]) });
ok(again.added === 0 && M.getCell(draft, '2027-01-06', 'b').a.join(' ') === 'LI R1', 'a re-pull adds nobody twice and keeps calls');

// ticked promotion and gone
const d2 = structuredClone(state);
applyMaster(d2, plan, { on: new Set(['p:' + normKey('Ann Example'), 'x:g']) });
ok(d2.staff.find(p => p.id === 'a').group === 'ac' && d2.staff.find(p => p.id === 'g').end === '2026-12-31', 'ticked promotion and leaving');
ok(planMaster(d2, master, '2027-01').moves.every(mv => mv.id !== 'a'), 'an AC is never moved back by the master');

// the month's sheet from scratch has the new people and their postings
const spec = specFromState(draft, '2027-01');
const benRow = spec.people.find(p => p.name === 'Ben Sample Tan');
ok(benRow && benRow.days[4] === 'LI' && benRow.days[2] === 'ICU', 'the generated sheet shows the postings');
ok(spec.people.some(p => p.name === 'Dan New' && p.grade === 'MOPEX'), 'the generated sheet has the new MOPEX');

console.log(`master: ${n} checks passed`);
