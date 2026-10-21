// NTF Roster: unit tests for auto-fill (solver.js). Run: node ntf-roster/test/solver.test.mjs
// A made-up department of about 70 staff (made-up names only), the default rules, leave, requests, locked cells and
// manual codes. Plain node:assert, no browser. Takes about 10 seconds.
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { evaluate } from '../js/rules.js';
import { solve, applyAssignments, withAssignments, diffAssignments } from '../js/solver.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

const FIRST = ['Aiden', 'Bella', 'Chen', 'Devi', 'Elliot', 'Farid', 'Gita', 'Hana', 'Ivan', 'Jia', 'Kiran', 'Lena', 'Marcus', 'Nadia', 'Omar', 'Pei'];
const LAST = ['Ang', 'Bakar', 'Chua', 'Dass', 'Evans', 'Fong', 'Goh', 'Hamid', 'Iyer', 'Jensen', 'Koh', 'Lowe', 'Mohan', 'Ng', 'Osman'];
const MONTH = '2026-11', DAYS = M.monthDays(MONTH), FROM = DAYS[0], TO = DAYS[DAYS.length - 1];

// ≈ 13 cons, 6 AC, 2 ext, 3 VC, 4 SR, 2 SRP, 3 RP, 9 JR, 2 locum, 20 MO (3 Baby MOs): 64 staff, plus a few edge cases
function makeDept() {
  const s = M.defaultState();
  s.settings.holidays = { '2026-11-08': 'Deepavali', '2026-11-24': 'Made-up holiday' };   // a Sunday and a Tuesday
  const sizes = { cons: 13, ac: 6, ext: 2, vc: 3, sr: 4, srp: 2, rp: 3, jr: 9, locum: 2, mo: 20 };
  let n = 0;
  for (const [g, count] of Object.entries(sizes)) for (let k = 0; k < count; k++) {
    const name = `${FIRST[n % FIRST.length]} ${LAST[(n * 7) % LAST.length]}`;
    s.staff.push({ id: `s${n}`, name, short: `${name.split(' ')[0][0]}${name.split(' ')[1][0]}${n}`, group: g, tags: g === 'mo' && k < 3 ? ['babymo'] : [], fte: 1, start: '', end: '', note: '', active: true });
    n++;
  }
  const add = (extra) => { s.staff.push({ id: `s${n}`, name: `${FIRST[n % 16]} ${LAST[n % 15]}`, short: '', group: 'mo', tags: [], fte: 1, start: '', end: '', note: '', active: true, ...extra }); n++; };
  add({ fte: 0.5, tags: ['parttime'] });                         // part-timer
  add({ start: '2026-11-16' });                                   // joins mid-month
  add({ end: '2026-11-10' });                                     // leaves early
  add({ group: 'jr', active: false });                            // inactive: never rostered
  add({ group: 'sr' });
  add({ group: 'cons' });
  // leave blocks: a week of AL for every 5th person, staggered; some CL; requests
  s.staff.forEach((p, i) => {
    if (i % 5 === 0) { const st = (i * 3) % 24; for (let d = st; d < st + 5; d++) M.setCell(s, DAYS[d], p.id, { a: ['AL'] }); }
    if (i % 9 === 2) M.setCell(s, DAYS[(i * 4) % 30], p.id, { a: ['CL'] });
    if (i % 7 === 3) M.setCell(s, DAYS[(i * 5) % 30], p.id, { r: ['Nc'] });
    if (i % 11 === 4) M.setCell(s, DAYS[(i * 2) % 30], p.id, { r: ['Cr'] });
    if (i % 13 === 6) M.setCell(s, DAYS[(i * 7 + 1) % 30], p.id, { r: ['NP'] });
    if (i % 17 === 8) M.setCell(s, '2026-11-14', p.id, { r: ['Nw'] });
  });
  // a few clinics for seniors, a meeting note
  for (const d of ['2026-11-03', '2026-11-10', '2026-11-17']) M.setCell(s, d, 's1', { a: ['Clinic'] });
  M.setCell(s, '2026-11-05', 's2', { a: ['Mtg'], note: 'Made-up meeting' });
  return s;
}

const isAuto = new Set(M.DEFAULT_DUTIES.filter(d => d.auto).map(d => d.code));
const clone = o => structuredClone(o);

// ---------- the department, with locked cells, manual codes and old auto codes ----------
const dept = makeDept();
ok(dept.staff.length >= 68 && dept.staff.length <= 72, `about 70 staff (${dept.staff.length})`);
const jr = dept.staff.filter(p => p.group === 'mo' && !p.tags.includes('babymo'));
// locked cells: one locked with a C (counts towards cover), one locked empty (must stay empty)
M.setCell(dept, '2026-11-12', jr[3].id, { a: ['C'], lock: true });
M.setCell(dept, '2026-11-13', jr[4].id, { lock: true, note: 'Keep free' });
// manual codes: a manual C (not in auto), a manual P with a manual Clinic
M.setCell(dept, '2026-11-18', jr[5].id, { a: ['C'] });
M.setCell(dept, '2026-11-19', jr[6].id, { a: ['P'] });
// old auto codes from an earlier run: in range (to be redone) and outside the range (kept)
M.setCell(dept, '2026-11-21', jr[7].id, { a: ['P', 'Teach'], auto: ['P'] });   // P on a Saturday: no rule wants it
M.setCell(dept, '2026-10-31', jr[8].id, { a: ['C'], auto: ['C'] });            // October: outside, gives x on 1 Nov
const frozen = JSON.stringify(dept);

const before = evaluate(dept, { from: FROM, to: TO });
ok(before.hard > 50, `the empty month has many hard problems (${before.hard})`);

let progress = [];
const t0 = performance.now();
const res = solve(dept, { from: FROM, to: TO, seed: 1, timeMs: 20000, onProgress: p => progress.push({ ...p, t: performance.now() }) });
const ms = performance.now() - t0;
console.log(`  solve: ${dept.staff.length} staff, ${DAYS.length} days, ${res.iterations} iterations, ${res.ms} ms; hard ${res.before.hard} → ${res.after.hard}, soft ${res.before.soft} → ${res.after.soft}`);
eq(JSON.stringify(dept), frozen, 'solve does not change the state it is given');

// result shape
ok(res.assignments && res.before && res.after && Array.isArray(res.unfilled) && res.iterations > 0 && res.ms >= 0, 'result shape');
eq(Object.keys(res.assignments).sort(), DAYS, 'assignments for every day in range, none outside');
eq([res.before.hard, res.before.soft], [before.hard, before.soft], 'before matches evaluate');

// zero hard violations, every cover met
const filled = clone(dept);
applyAssignments(filled, res.assignments);
const after = evaluate(filled, { from: FROM, to: TO });
eq(after.hard, 0, `no hard violations after auto-fill (${after.violations.filter(v => v.hard).map(v => v.msg).slice(0, 3).join('; ')})`);
eq([res.after.hard, res.after.soft], [after.hard, after.soft], 'after matches evaluate');
eq(res.unfilled, [], 'nothing unfilled');
ok(after.soft < before.soft + 40, `soft problems kept low (${after.soft})`);

// only auto duties, at most one per cell, nobody outside their dates
let placed = 0;
for (const [date, row] of Object.entries(res.assignments)) {
  for (const [id, codes] of Object.entries(row)) {
    ok(Array.isArray(codes) && codes.length <= 1 && codes.every(c => isAuto.has(c)), `only one auto code per cell (${date} ${id})`);
    const p = dept.staff.find(x => x.id === id);
    if (codes.length) { placed++; ok(M.staffActiveOn(p, date), `${id} rostered only while in post (${date})`); }
  }
}
// 90 calls less the locked and the manual one, 20 PM weekdays less the manual P, PHD on 2 holidays
eq(placed, 90 - 2 + 19 + 2, 'exactly the shifts the cover rules ask for');
const late = dept.staff.find(p => p.start === '2026-11-16'), early = dept.staff.find(p => p.end === '2026-11-10'), inactive = dept.staff.find(p => p.active === false);
ok(DAYS.every(d => !(res.assignments[d][inactive.id] || []).length), 'inactive staff never rostered');

// locked cells kept exactly, and left out of the assignments
ok(!(jr[3].id in res.assignments['2026-11-12']) && !(jr[4].id in res.assignments['2026-11-13']), 'locked cells not in assignments');
eq(M.getCell(filled, '2026-11-12', jr[3].id), M.getCell(dept, '2026-11-12', jr[3].id), 'locked C kept');
eq(M.getCell(filled, '2026-11-13', jr[4].id), M.getCell(dept, '2026-11-13', jr[4].id), 'locked empty cell kept empty');
// manual codes kept (and not marked auto)
eq(M.getCell(filled, '2026-11-18', jr[5].id).a, ['C'], 'manual C kept');
eq(M.getCell(filled, '2026-11-18', jr[5].id).auto, [], 'manual C not marked auto');
eq(M.getCell(filled, '2026-11-19', jr[6].id).a, ['P'], 'manual P kept');
eq(M.getCell(filled, '2026-11-05', 's2'), M.getCell(dept, '2026-11-05', 's2'), 'meeting and note kept');
// every non-auto code and every request in range is still there
for (const d of DAYS) for (const [id, cell] of Object.entries(dept.cells[d] || {})) {
  const now = M.getCell(filled, d, id);
  const manual = cell.a.filter(c => !cell.auto.includes(c));
  ok(now && manual.every(c => now.a.includes(c)) && JSON.stringify(now.r) === JSON.stringify(cell.r) && now.note === cell.note, `manual codes, requests and notes kept (${d} ${id})`);
}
// leave respected (r-leave), and no one put on call against Nc (hard)
ok(!after.violations.some(v => v.ruleId === 'r-leave' || v.ruleId === 'r-req-nc' || v.ruleId === 'r-postcall'), 'leave, Nc and post call respected');
// old auto codes in range redone; outside the range untouched
ok(!M.getCell(filled, '2026-11-21', jr[7].id).auto.includes('P') || res.assignments['2026-11-21'][jr[7].id].includes('P'), 'old auto P replaced by the new result');
ok(M.getCell(filled, '2026-11-21', jr[7].id).a.includes('Teach'), 'manual code beside an old auto code kept');
eq(M.getCell(filled, '2026-10-31', jr[8].id), M.getCell(dept, '2026-10-31', jr[8].id), 'auto code outside the range untouched');
ok(!(res.assignments['2026-11-01'][jr[8].id] || []).length, 'no shift on the post-call day after the October call');

// daily cover: 2 juniors + 1 senior on call; 1 PM on weekdays (not holidays); 1 PHD on holidays
const J = new Set(['sr', 'srp', 'rp', 'jr', 'locum', 'mo']), S = new Set(['cons', 'ac']);
for (const d of DAYS) {
  const on = code => dept.staff.filter(p => (M.getCell(filled, d, p.id) || { a: [] }).a.includes(code));
  eq([on('C').filter(p => J.has(p.group)).length, on('C').filter(p => S.has(p.group)).length], [2, 1], `call cover on ${d}`);
  const pm = M.isWeekend(d) || M.isHoliday(dept, d) ? 0 : 1;
  eq(on('P').length, pm, `PM cover on ${d}`);
  eq(on('PHD').length, M.isHoliday(dept, d) ? 1 : 0, `PHD on ${d}`);
}
// the part-timer does about half as many calls as the average junior
{
  const calls = id => DAYS.filter(d => (M.getCell(filled, d, id) || { a: [] }).a.includes('C')).length;
  const pt = dept.staff.find(p => p.fte === 0.5);
  ok(calls(pt.id) <= 3, `part-timer within the FTE-scaled cap (${calls(pt.id)})`);
  ok(calls(late.id) >= 1 && calls(early.id) >= 0, 'joiner gets calls after starting');
}

// progress: some reports, at most ~10 a second, ends at 100
ok(progress.length >= 1 && progress[progress.length - 1].pct === 100, 'progress ends at 100%');
ok(progress.every(p => p.best && typeof p.best.hard === 'number' && typeof p.pct === 'number'), 'progress shape');
{
  const mid = progress.slice(0, -1);
  for (let k = 1; k < mid.length; k++) ok(mid[k].t - mid[k - 1].t >= 95, 'progress at most ~10 a second');
}

// deterministic for a seed
{
  const again = solve(dept, { from: FROM, to: TO, seed: 1, timeMs: 20000 });
  eq(JSON.stringify(again.assignments), JSON.stringify(res.assignments), 'same seed, same roster');
  eq(again.iterations, res.iterations, 'same seed, same search');
  const other = solve(dept, { from: FROM, to: TO, seed: 7, timeMs: 20000 });
  eq(other.after.hard, 0, 'another seed also has no hard violations');
  ok(JSON.stringify(other.assignments) !== JSON.stringify(res.assignments), 'another seed, another roster');
}

// respects the time budget
{
  const t = performance.now();
  const quick = solve(dept, { from: FROM, to: TO, seed: 3, timeMs: 300, iterations: 10_000_000 });
  const took = performance.now() - t;
  ok(took < 300 + 1500, `stops near the time budget (${Math.round(took)} ms for 300 ms)`);
  ok(quick.iterations < 10_000_000 && quick.after.hard <= 10, `a short run still gives a usable roster (hard ${quick.after.hard})`);
}

// re-running on a filled month keeps it valid; diffAssignments counts changes
{
  const re = solve(filled, { from: FROM, to: TO, seed: 2, timeMs: 20000, iterations: 40000 });
  eq(re.after.hard, 0, 're-run on a filled month');
  const df = diffAssignments(filled, re.assignments);
  ok(df.added === df.removed || df.added >= 0, 'diff counts');
  eq(diffAssignments(filled, res.assignments), { added: 0, removed: 0, cells: 0 }, 'no difference from the result already applied');
  const w = withAssignments(dept, res.assignments);
  eq(JSON.stringify(dept), frozen, 'withAssignments leaves the original alone');
  eq(evaluate(w, { from: FROM, to: TO }).hard, 0, 'withAssignments applies the result');
}

// infeasible day: almost every junior on leave on 20 Nov → reported as unfilled, leave never broken
{
  const s = makeDept();
  const juniors = s.staff.filter(p => J.has(p.group) && p.active !== false);
  juniors.slice(1).forEach(p => M.setCell(s, '2026-11-20', p.id, { a: ['AL'] }));
  const r = solve(s, { from: FROM, to: TO, seed: 1, timeMs: 20000, iterations: 40000 });
  const u = r.unfilled.filter(x => x.date === '2026-11-20');
  ok(u.some(x => x.code === 'C' && x.need >= 1), 'short call cover reported as unfilled');
  const f = withAssignments(s, r.assignments);
  const e = evaluate(f, { from: FROM, to: TO });
  ok(!e.violations.some(v => v.ruleId === 'r-leave'), 'never rosters someone on leave to fill a gap');
  ok(e.hard <= 3, `only the impossible day is short (${e.hard})`);
}

// edge cases: no staff; a month with no cover rules; custom auto duty with its own cover rule
{
  const empty = M.defaultState();
  const r = solve(empty, { from: FROM, to: TO, seed: 1, timeMs: 1000 });
  eq(Object.keys(r.assignments).length, 30, 'no staff: a day per date');
  ok(Object.values(r.assignments).every(row => !Object.keys(row).length), 'no staff: nothing assigned');
  assert.throws(() => solve(empty, {}), /from and to/); checks++;

  const s = makeDept();
  s.rules = s.rules.filter(x => x.type !== 'cover');
  const r2 = solve(s, { from: FROM, to: TO, seed: 1, timeMs: 1000 });
  ok(Object.values(r2.assignments).every(row => Object.values(row).every(c => !c.length)), 'no cover rules: nothing placed');

  const s3 = makeDept();
  s3.duties.push({ code: 'NS', name: 'Night stepdown', kind: 'shift', color: '#333333', ink: '#fff', overnight: true, auto: true, hours: 12 });
  s3.rules.push({ id: 'r-ns', type: 'cover', name: '', enabled: true, hard: true, weight: 10, who: { groups: ['mo'], tags: [], staff: [], exclude: [] }, when: { from: '', to: '', days: [5], holidays: 'any' }, params: { codes: ['NS'], min: 1, max: 1 }, note: '' });
  const r3 = solve(s3, { from: FROM, to: TO, seed: 1, timeMs: 20000, iterations: 40000 });
  const fridays = DAYS.filter(d => M.weekday(d) === 5);
  ok(fridays.every(d => Object.values(r3.assignments[d]).filter(c => c.includes('NS')).length === 1), 'a new auto duty is filled from its own cover rule');
  eq(r3.after.hard, 0, 'and every hard rule still holds');
}

// rules other than cover can ask for an auto duty: a standing duty, a limit with a minimum
{
  const s = makeDept();
  // cons[0] is an NUH / NTFGH / ICU consultant (never on the call cover), so only OTC itself can meet the standing rule
  const cons = [s.staff.find(p => p.group === 'ext'), ...s.staff.filter(p => p.group === 'cons').slice(1, 3)];
  const who = ids => ({ groups: [], tags: [], staff: ids, exclude: [] });
  const R = (id, type, params, o) => ({ id, type, name: '', enabled: true, hard: true, weight: 10, who: who([]), when: { from: '', to: '', days: [], holidays: 'any' }, params, note: '', ...o });
  s.rules.push(
    R('r-otc-tue', 'standing', { codes: ['OTC'] }, { who: who([cons[0].id]), when: { from: '', to: '', days: [2], holidays: 'exclude' } }),
    R('r-smo-min', 'limit', { codes: ['SMO'], period: 'month', window: 7, min: 2, max: 2, fte: false, prorate: false }, { who: who([cons[1].id, cons[2].id]) }),
  );
  const r = solve(s, { from: FROM, to: TO, seed: 1, timeMs: 20000, iterations: 40000 });
  const f = withAssignments(s, r.assignments);
  const e = evaluate(f, { from: FROM, to: TO });
  eq(e.hard, 0, `standing and minimum rules met (${e.violations.filter(v => v.hard).map(v => v.msg).slice(0, 3).join('; ')})`);
  const tuesdays = DAYS.filter(d => M.weekday(d) === 2 && !M.isHoliday(s, d));
  const away = d => M.matchesCodes(f, d, cons[0].id, ['@away']);   // leave, other, or post call
  ok(tuesdays.every(d => away(d) || r.assignments[d][cons[0].id].includes('OTC')), 'OTC every Tuesday unless away');
  ok(tuesdays.filter(d => r.assignments[d][cons[0].id].includes('OTC')).length >= 2, 'OTC placed on Tuesdays');
  ok(DAYS.every(d => M.weekday(d) === 2 || !r.assignments[d][cons[0].id].includes('OTC')), 'and only on Tuesdays');
  for (const p of [cons[1], cons[2]]) eq(DAYS.filter(d => r.assignments[d][p.id].includes('SMO')).length, 2, 'two SMO each');
}

// ---------- hard problems always come before soft ones (review, Oct 2026) ----------
{
  const s = M.defaultState();
  s.staff = ['a', 'b', 'c'].map(id => ({ id, name: `Made-up ${id.toUpperCase()}`, short: '', group: 'mo', tags: [], fte: 1, start: '', end: '', note: '', active: true }));
  const R = (id, type, params, o = {}) => ({ id, type, name: '', enabled: true, hard: true, weight: 10, note: '', who: { groups: [], tags: [], staff: [], exclude: [] }, when: { from: '', to: '', days: [], holidays: 'any' }, params, ...o });
  s.rules = [
    R('cov', 'cover', { codes: ['P'], min: 1, max: 1 }),
    R('roll', 'limit', { codes: ['P'], period: 'rolling', window: 14, min: null, max: 3, fte: false, prorate: false }, { hard: false, weight: 100 }),
  ];
  const r = solve(s, { from: FROM, to: TO, seed: 1, timeMs: 1e9, iterations: 30000 });
  eq(r.after.hard, 0, 'a heavy soft rule never leaves a fixable hard gap');
  eq(r.unfilled.length, 0, 'every day has its PM');
}
{
  // no overnight duty on the last day before a manual clinic on the next day (post call)
  const s = M.defaultState();
  s.staff = ['a', 'b', 'c'].map(id => ({ id, name: `Made-up ${id.toUpperCase()}`, short: '', group: 'cons', tags: [], fte: 1, start: '', end: '', note: '', active: true }));
  s.rules = s.rules.filter(r => ['r-leave', 'r-postcall', 'r-scall', 'r-gap'].includes(r.id));
  ok(s.rules.some(r => r.id === 'r-postcall'), 'default post-call rule exists');
  for (const id of ['a', 'b', 'c']) M.setCell(s, '2026-12-01', id, { a: ['Clinic'] });
  const r = solve(s, { from: FROM, to: TO, seed: 1, timeMs: 1e9, iterations: 10000 });
  eq(Object.values(r.assignments[TO]).filter(c => c.includes('C')).length, 0, 'nobody on call on 30 Nov before the 1 Dec clinics');
}

{
  // opts.codes: fill only these codes; earlier auto-filled shifts of the other codes stay as they are
  const s = M.defaultState();
  s.staff = ['a', 'b', 'c', 'd'].map(id => ({ id, name: `Made-up ${id.toUpperCase()}`, short: '', group: 'cons', tags: [], fte: 1, start: '', end: '', note: '', active: true }));
  const codes = s.duties.filter(d => d.auto && d.kind === 'shift').map(d => d.code);
  ok(codes.length >= 2, 'at least two auto codes in the default duties');
  const keepCode = codes[1], fillCode = codes[0];
  M.setCell(s, '2026-11-03', 'a', { a: [keepCode], auto: [keepCode] });
  const r = solve(s, { from: FROM, to: TO, seed: 1, timeMs: 1e9, iterations: 3000, codes: [fillCode] });
  eq(r.codes, [fillCode], 'the result names the codes it filled');
  ok(Object.values(r.assignments).every(row => Object.values(row).every(c => c.every(x => x === fillCode))), 'only the chosen code is placed');
  applyAssignments(s, r.assignments, r.codes);
  eq(M.getCell(s, '2026-11-03', 'a').a.includes(keepCode), true, 'an earlier auto-filled shift of another code stays');
  eq(M.getCell(s, '2026-11-03', 'a').auto.includes(keepCode), true, 'and is still marked auto-filled');
}

console.log(`solver tests: ${checks} checks passed`);
