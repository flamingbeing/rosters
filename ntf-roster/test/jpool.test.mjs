// NTF Roster: junior pool tests. Fake people only. Run: node ntf-roster/test/jpool.test.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../js/model.js';
import * as R from '../js/rules.js';
import * as S from '../js/solver.js';
import * as J from '../js/jpool.js';
import * as A from '../js/aps.js';
import * as io from '../js/io.js';
import * as cloud from '../js/cloud.js';
import { ruleForRequest } from '../js/ui-requests.js';
import { applyAssignments } from '../js/ui-roster.js';
import { bulkSet, placeRule } from '../js/ui-ruleprio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ExcelJS = createRequire(import.meta.url)(path.join(here, '../../lib/exceljs.min.js'));
let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, msg); };
const ok = (v, msg) => { n++; assert.ok(v, msg); };

const MONTH = '2026-11';
const FROM = '2026-11-01', TO = '2026-11-30';

// ---------- tags ----------
{
  eq(J.tagsFor(['babymo', 'mo1weak'], 'mo2', 'strong'), ['babymo', 'mo2strong'], 'level change keeps other tags');
  eq(J.tagsFor([], 'mo1', ''), ['mo1'], 'no strength: plain level tag');
  eq(J.tagsFor(['mo2weak'], '', ''), [], 'no level: all pool tags dropped');
  const p = { tags: ['mo2weak'] };
  eq([J.levelOf(p), J.strengthOf(p)], ['mo2', 'weak'], 'level and strength read back');
  eq(J.levelOf({ tags: ['nocall'] }), 'nocall');
}

// ---------- a small fake pool ----------
function pool() {
  const s = M.defaultState();
  s.settings.holidays['2026-11-08'] = 'Test holiday';
  let id = 0;
  const add = (name, group, level, strength, extra = {}) => {
    const p = { id: 'p' + (++id), name, short: '', group, tags: J.tagsFor(['jpool'], level, strength), fte: 1, start: '', end: '', note: '', active: true, ...extra };
    s.staff.push(p);
    return p;
  };
  const senior = [];
  for (let i = 0; i < 7; i++) senior.push(add('Senior ' + i, 'rp', 'mo2', i < 2 ? 'weak' : i < 5 ? 'strong' : ''));
  const junior = [];
  for (let i = 0; i < 14; i++) junior.push(add('Junior ' + i, i < 4 ? 'jr' : 'mo', 'mo1', i < 4 ? 'weak' : i < 9 ? 'strong' : '', i === 1 ? { note: '(R3-JR 1/9/26-1/1/27)' } : {}));
  const nocall = add('Nocall', 'rp', 'nocall', '');
  const nurse = add('Nurse', 'nurse', '', '');
  s.staff.unshift({ id: 'c1', name: 'Consultant', short: '', group: 'cons', tags: [], fte: 1, start: '', end: '', note: '', active: true });
  s.staff.unshift({ id: 'c0', name: 'Consultant 0', short: '', group: 'cons', tags: [], fte: 1, start: '', end: '', note: '', active: true });
  return { s, senior, junior, nocall, nurse };
}

// ---------- install ----------
{
  const { s } = pool();
  const before = s.rules.length;
  const added = J.installJuniorPool(s);
  eq(added, J.JUNIOR_RULES.length, 'every junior rule added');
  eq(s.rules.length, before + added);
  eq(J.installJuniorPool(s), 0, 'second install adds nothing');
  eq(s.rules.find(r => r.id === 'r-phd').enabled, false, 'public holiday day shift off (half calls instead)');
  eq(s.rules.find(r => r.id === 'r-jcall').who.tags, J.CALL_TAGS, 'old junior call rule points at the call list');
  for (const r of s.rules) eq(R.validateRule(r, s), [], 'valid: ' + r.id);
  ok(!J.JUNIOR_RULES.some(r => /Predicted/.test(r.note || '')), 'no rule is marked To confirm');
  ok(M.migrate(JSON.parse(JSON.stringify(s))).rules.length === s.rules.length, 'survives migrate');
}

// ---------- pools ----------
{
  const { s, senior } = pool();
  eq(M.poolOf(s, s.staff.find(p => p.id === 'c1')), 'senior', 'consultant: senior pool');
  eq(M.poolOf(s, senior[0]), 'junior', 'jpool tag');
  const p2 = { ...senior[0], tags: ['spool'] };
  eq(M.poolOf(s, p2), 'senior', 'spool tag wins over a junior section');
  s.settings.pool = 'junior';
  const view = M.staffInView(s, MONTH);
  ok(view.length === 7 + 14 + 2 && view.every(p => M.poolOf(s, p) === 'junior'), 'view shows the junior pool only');
  s.settings.pool = 'all';
  ok(M.staffInView(s, MONTH).length === M.staffInMonth(s, MONTH).length, 'all shows everyone');
  J.installJuniorPool(s);
  const sc = J.scopeToPool(s, 'junior', M.poolOf);
  ok(sc.staff.length === 23, 'scoped staff');
  ok(!sc.rules.some(r => r.id === 'r-scall' || r.pool === 'senior'), 'the senior roster\'s rules are left out when scoped to juniors');
  eq(sc.rules.find(r => r.id === 'r-jp-mo2').enabled, true, 'junior rule stays on');
  ok(sc.rules.some(r => r.id === 'r-leave') && !sc.rules.some(r => r.id === 'r-leave-s'), 'the junior copy of a rule about everyone');
  const all = J.scopeToPool(s, 'all', M.poolOf);
  ok(all.staff === s.staff && all.rules.length === s.rules.length, 'all: everyone, every rule');
  const lv = all.rules.find(r => r.id === 'r-leave'), lvs = all.rules.find(r => r.id === 'r-leave-s');
  ok(lv.who.only.length === 23 && lv.who.only.every(id => M.poolOf(s, s.staff.find(p => p.id === id)) === 'junior'), 'all: the junior copy covers only the junior pool');
  ok(lvs.who.only.length === s.staff.length - 23, 'all: the senior copy covers only the senior pool');
  ok(!s.rules.some(r => r.who.only), 'the saved rules are not changed');
}

// ---------- auto-fill on the fake pool ----------
{
  const { s, senior, junior, nocall } = pool();
  J.installJuniorPool(s);
  M.setCell(s, '2026-11-10', senior[0].id, { a: ['AL'], ap: true });
  M.setCell(s, '2026-11-16', junior[5].id, { r: ['Nc'] });
  M.setCell(s, '2026-11-17', junior[6].id, { a: ['JR'] });
  for (let d = 23; d <= 29; d++) M.setCell(s, '2026-11-' + d, junior[10].id, { a: ['APS'] });
  s.rules.push(ruleForRequest({ staffId: senior[3].id, name: 'Senior 3', kind: 'nocall', from: '2026-11-10', to: '2026-11-15', hard: true, note: '' }));
  const sc = J.scopeToPool(s, 'junior', M.poolOf);
  const res = S.solve(sc, { from: FROM, to: TO, seed: 1, timeMs: 5000 });
  eq(res.after.hard, 0, 'no must-hold rule broken');
  eq(res.unfilled.length, 0, 'nothing left short');
  const filled = S.withAssignments(sc, res.assignments);
  const ev = R.evaluate(filled, { from: FROM, to: TO });
  eq(ev.hard, 0, 'check agrees');
  const on = (date, code, ids) => ids.filter(p => (M.getCell(filled, date, p.id) || { a: [] }).a.includes(code));
  const days = M.monthDays(MONTH);
  let weakPairs = 0, sat3 = true, sun = true, nocallC = 0;
  for (const d of days) {
    const calls = filled.staff.filter(p => (M.getCell(filled, d, p.id) || { a: [] }).a.includes('C'));
    const mo2 = calls.filter(p => J.levelOf(p) === 'mo2').length, mo1 = calls.filter(p => J.levelOf(p) === 'mo1').length;
    if (M.weekday(d) === 6) sat3 = sat3 && calls.length === 3 && mo2 >= 1 && mo1 >= 1;
    else sun = sun && calls.length === 2 && mo2 === 1 && mo1 === 1;
    if (calls.some(p => p.tags.includes('mo2weak')) && calls.some(p => p.tags.includes('mo1weak'))) weakPairs++;
    nocallC += calls.filter(p => p.id === nocall.id).length;
    if (M.weekday(d) === 0 || d === '2026-11-08') eq(filled.staff.filter(p => (M.getCell(filled, d, p.id) || { a: [] }).a.includes('HC')).length, 1, 'one half call ' + d);
  }
  ok(sat3 && sun, 'Saturday 3 on call, other days 1 MO2 + 1 MO1');
  eq(weakPairs, 0, 'never a weak MO2 with a weak MO1');
  eq(nocallC, 0, 'the no-calls person is never on call');
  for (const d of ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']) eq(on(d, 'C', [senior[3]]).length, 0, 'request window kept ' + d);
  eq(on('2026-11-17', 'C', [junior[6]]).length + on('2026-11-17', 'P', [junior[6]]).length, 0, 'JR teaching day: no call or PM');
  eq(on('2026-11-30', 'P', [junior[10]]).length, 1, 'the Monday PM shift after the APS week goes to its holder');
  for (let d = 23; d <= 29; d++) eq(on('2026-11-' + d, 'C', [junior[10]]).length, 0, 'no call in the APS week');
}

// ---------- APS suggestions ----------
{
  const { s, senior, junior } = pool();
  const dayRange = (a, b) => { const o = []; for (let d = a; d <= b; d++) o.push(`2026-10-${d}`); return o; };
  // junior[3] had an APS week in October, junior[1] is an R3, junior[0] (a JR) already did 2, junior[2] (a JR) none
  for (const d of ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']) M.setCell(s, d, junior[3].id, { a: ['APS'] });
  M.setCell(s, '2026-11-01', junior[3].id, { a: ['APS'] });
  s.aps = { base: { [junior[0].id]: 2 }, last: {}, through: '2026-09' };
  const t = A.tally(s, MONTH);
  eq([t.get(junior[0].id), t.get(junior[3].id)], [2, 1], 'count = typed count + weeks in the roster after it');
  const plan = A.suggestMonth(s, MONTH);
  eq(plan.map(w => w.monday), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'], 'weeks that start in the month');
  const pick = plan.map(w => w.pick);
  ok(!pick.includes(junior[1].id), 'an R3 is never suggested');
  ok(!pick.includes(junior[3].id), 'nobody two months running');
  eq(new Set(pick).size, pick.length, 'nobody twice in a month');
  eq(plan[0].pick, junior[2].id, 'a JR with the fewest weeks goes first when manpower is good');
  eq(A.mondayOf('2026-11-01'), '2026-10-26', 'Sunday belongs to the week that began on the Monday before');
  // assign and clear
  s.staff.forEach(p => p);
  A.setWeek(s, '2026-11-09', junior[5].id);
  eq(A.weekHolder(s, '2026-11-09'), junior[5].id, 'week written');
  A.setWeek(s, '2026-11-09', junior[6].id);
  eq(A.weekHolder(s, '2026-11-09'), junior[6].id, 'reassigning takes the week from the first person');
  A.setWeek(s, '2026-11-09', '');
  eq(A.weekHolder(s, '2026-11-09'), '', 'week cleared');
  void senior; void dayRange;
}

// ---------- leave: other dates ----------
{
  const { s, junior } = pool();
  for (let i = 0; i < 3; i++) M.setCell(s, '2026-11-12', junior[i + 5].id, { a: ['AL'], ap: true });
  M.setCell(s, '2026-11-12', junior[9].id, { a: ['AL'] });   // not approved: the 4th on leave
  const alts = A.leaveAlternatives(s, MONTH);
  eq(alts.length, 1, 'only the unapproved leave that clashes is listed');
  eq([alts[0].staffId, alts[0].from, alts[0].clashes], [junior[9].id, '2026-11-12', ['2026-11-12']]);
  ok(alts[0].options.length >= 1 && alts[0].options.every(o => o.from !== '2026-11-12'), 'other dates offered');
  const o = alts[0].options[0];
  const draft = JSON.parse(JSON.stringify(s));
  A.moveLeave(draft, junior[9].id, '2026-11-12', '2026-11-12', o.from);
  eq([(M.getCell(draft, '2026-11-12', junior[9].id) || { a: [] }).a, M.getCell(draft, o.from, junior[9].id).a], [[], ['AL']], 'leave moved');
  eq(A.leaveAlternatives(draft, MONTH).length, 0, 'no clash after the move');
}

// ---------- the department sheet: colours, nurses, fill back ----------
{
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Roster');
  const blue = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF99CCFF' } };
  const green = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF33CC33' } };
  ws.getCell('A5').value = 'NOVEMBER 2026';
  const dates = []; for (let d = 1; d <= 30; d++) dates.push(d);
  dates.forEach((d, i) => { ws.getCell(5, 4 + i).value = d; ws.getCell(6, 4 + i).value = ['Su', 'M', 'Tu', 'W', 'Th', 'F', 'S'][(new Date(2026, 10, d)).getDay()]; });
  ws.getCell('A7').value = 'RESIDENT PHYSICIANS';
  ws.getCell('A8').value = 'Pat Example';
  ws.getCell('D8').value = 'AL'; ws.getCell('D8').fill = blue;                       // approved leave
  ws.getCell('E8').value = 'AL';                                                     // not approved
  ws.getCell('F8').value = 'ACLS-am'; ws.getCell('F8').fill = blue;                  // blue course text
  ws.getCell('G8').value = 'Cr';                                                     // a call request
  ws.getCell('H8').value = 'Pr';
  for (const c of ['J8', 'K8']) ws.getCell(c).fill = green;                          // an APS week, empty cells
  ws.getCell('A9').value = 'Sam Sample';
  ws.getCell('A10').value = 'PACU APN/PAIN APN/APS Nurses';
  ws.getCell('A11').value = 'Nina Nurse';
  const buf = await wb.xlsx.writeBuffer();
  const s = M.defaultState();
  const parsed = await io.parseDeptWorkbook(buf, s, { ExcelJS });
  eq(parsed.people.map(p => [p.name, p.group]), [['Pat Example', 'rp'], ['Sam Sample', 'rp'], ['Nina Nurse', 'nurse']], 'nurse heading becomes the nurse group');
  const sum = io.applyImport(s, parsed, {});
  const pat = s.staff.find(p => p.name === 'Pat Example'), sam = s.staff.find(p => p.name === 'Sam Sample');
  const cell = d => M.getCell(s, `2026-11-${String(d).padStart(2, '0')}`, pat.id);
  eq([cell(1).a, !!cell(1).ap], [['AL'], true], 'blue leave is approved');
  eq([cell(2).a, !!cell(2).ap], [['AL'], false], 'white leave is a request');
  eq([cell(3).a, !!cell(3).ap], [['ACLS'], true], 'blue course text becomes a leave code');
  eq(cell(4).r, ['Cr'], 'call request kept');
  eq([cell(7).a, cell(8).a], [['APS'], ['APS']], 'green empty cells are APS');
  ok(sum.cells >= 7, 'cells imported');
  // give Pat a call on a free day and Sam one on the Cr day, a PM on the Pr day, then fill the same file
  M.setCell(s, '2026-11-10', pat.id, { a: ['C'] });
  M.setCell(s, '2026-11-04', sam.id, { a: ['C'] });
  M.setCell(s, '2026-11-04', pat.id, { a: ['C'], r: ['Cr'] });
  M.setCell(s, '2026-11-05', pat.id, { a: ['P'], r: ['Pr'] });
  M.setCell(s, '2026-11-14', pat.id, { a: ['HC'] });
  const out = await io.fillDeptWorkbook(buf, s, MONTH, { ExcelJS });
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(await out.blob.arrayBuffer());
  const w2 = wb2.getWorksheet('Roster');
  eq([w2.getCell('M8').value, w2.getCell('Q8').value], ['C', 'HC'], 'calls and half calls written');
  eq([w2.getCell('G8').value, w2.getCell('H8').value], ['Cr', 'Pr'], 'a request the shift satisfies is left as written');
  eq(w2.getCell('G9').value, 'C', 'a call written in an empty cell');
  eq([w2.getCell('D8').value, w2.getCell('F8').value], ['AL', 'ACLS-am'], 'leave and course text untouched');
  eq([w2.getCell('D8').fill.fgColor.argb, w2.getCell('J8').fill.fgColor.argb], ['FF99CCFF', 'FF33CC33'], 'fills kept');
  ok(out.changed >= 3, 'cells written');
  // an APS week written for another person turns the cells green and nothing else
  A.setWeek(s, '2026-11-09', sam.id);
  const out2 = await io.fillDeptWorkbook(buf, s, MONTH, { ExcelJS });
  const wb3 = new ExcelJS.Workbook(); await wb3.xlsx.load(await out2.blob.arrayBuffer());
  eq(['L9', 'M9', 'R9'].map(c => wb3.getWorksheet('Roster').getCell(c).fill.fgColor && wb3.getWorksheet('Roster').getCell(c).fill.fgColor.argb), ['FF33CC33', 'FF33CC33', 'FF33CC33'], 'APS week painted green');
  eq(wb3.getWorksheet('Roster').getCell('D8').fill.fgColor.argb, 'FF99CCFF', 'other fills not disturbed');
  // history from old rosters
  const hist = A.historyFromParsed([parsed]);
  ok(hist.through === '2026-11', 'history: latest month');
  void sam;
}

// ---------- the quick request ----------
{
  const r = ruleForRequest({ staffId: 'p1', name: 'Pat', kind: 'nocall', from: '2026-11-10', to: '2026-11-15', hard: true, note: 'family' });
  eq([r.type, r.hard, r.params.codes, r.params.max, r.when.from, r.when.to], ['limit', true, ['C', 'HC'], 0, '2026-11-10', '2026-11-15']);
  ok(/Pat/.test(r.name) && /10 Nov/.test(r.name), 'named for the person and dates');
  const w = ruleForRequest({ staffId: 'p1', name: 'Pat', kind: 'wantcall', from: '2026-11-20', to: '2026-11-20', hard: true, note: '' });
  eq([w.hard, w.params.min, w.weight], [false, 1, 40], 'a wanted call is a preference');
  const s = M.defaultState(); s.rules.push(r);
  eq(R.validateRule(r, { ...s, staff: [{ id: 'p1', name: 'Pat', group: 'mo', tags: [] }] }), [], 'valid rule');
}

// ---------- team sharing carries the APS tally, not the pool you are looking at ----------
{
  const s = M.defaultState(); s.aps = { base: { p1: 2 }, last: { p1: '2026-10' }, through: '2026-10' }; s.settings.pool = 'junior';
  const t = cloud.pickTeam(s);
  eq(t.aps, s.aps, 'aps goes to the team copy'); ok(!('pool' in t.settings), 'the pool view stays local');
  const mine = M.defaultState(); mine.settings.pool = 'senior';
  const m = cloud.mergeTeam(mine, t);
  eq([m.aps, m.settings.pool], [s.aps, 'senior'], 'aps comes in, own pool view kept');
}

// ---------- auto-filling one pool leaves the other pool's shifts alone ----------
{
  const s = M.defaultState();
  const sg = s.groups.find(g => g.kind !== 'junior').id, jg = s.groups.find(g => g.kind === 'junior').id;
  s.staff = [{ id: 'sen', name: 'Sen', group: sg, tags: [] }, { id: 'jun', name: 'Jun', group: jg, tags: ['mo1'] }];
  M.setCell(s, '2026-11-02', 'sen', { a: ['C'], auto: ['C'] });
  const snap = J.scopeToPool(s, 'junior', M.poolOf);
  applyAssignments(s, { assignments: { '2026-11-02': { jun: ['C'] } } }, ['2026-11-02'], new Set(snap.staff.map(p => p.id)));
  eq(M.getCell(s, '2026-11-02', 'sen').a, ['C'], "the senior's auto-filled call stays");
  eq(M.getCell(s, '2026-11-02', 'jun').auto, ['C'], 'the junior gets the new call');
}

// ---------- someone else saved first: merge keeps my pool, takes theirs for the rest ----------
{
  const base = M.defaultState();
  const sg = base.groups.find(g => g.kind !== 'junior').id, jg = base.groups.find(g => g.kind === 'junior').id;
  base.staff = [{ id: 'sen', name: 'Sen', group: sg, tags: [] }, { id: 'jun', name: 'Jun', group: jg, tags: ['mo1'] }];
  base.rules = [
    { id: 'r-all', type: 'cover', name: 'Everyone', hard: true, enabled: true, who: {} },
    { id: 'r-jun', type: 'maxCount', name: 'Juniors only', hard: true, enabled: true, who: { staff: ['jun'] } },
    { id: 'r-sen', type: 'maxCount', name: 'Seniors only', hard: true, enabled: true, who: { staff: ['sen'] } },
  ];
  const mine = structuredClone(base), theirs = structuredClone(base);
  mine.settings.pool = 'junior';
  mine.staff.push({ id: 'jun2', name: 'Jun Two', group: jg, tags: ['mo2'] });
  mine.rules.find(r => r.id === 'r-jun').name = 'Juniors, my edit';
  mine.rules.find(r => r.id === 'r-sen').name = 'Seniors, my stale copy';
  mine.aps = { base: { jun: 1 } };
  M.setCell(mine, '2026-11-02', 'jun', { a: ['C'] });
  M.setCell(mine, '2026-11-02', 'sen', { a: ['P'] });      // stale: they changed the senior's day
  theirs.staff[0] = { ...theirs.staff[0], name: 'Sen Renamed' };
  theirs.rules.find(r => r.id === 'r-sen').name = 'Seniors, their edit';
  theirs.rules.find(r => r.id === 'r-jun').name = 'Juniors, their stale copy';
  theirs.settings.pool = 'senior';
  M.setCell(theirs, '2026-11-02', 'sen', { a: ['C'] });
  M.setCell(theirs, '2026-11-02', 'jun', { a: ['P'] });
  const team = cloud.pickTeam(theirs);
  const docs = [{ month: '2026-11', ...cloud.pickMonth(theirs, '2026-11').meta, cells: JSON.stringify(cloud.pickMonth(theirs, '2026-11').cells) }];
  const out = J.mergeByPool(mine, team, docs, 'junior', M.poolOf, cloud.cellsFromDoc);
  eq(out.staff.map(p => p.id).sort(), ['jun', 'jun2', 'sen'], 'my new junior is added, their senior kept');
  eq(out.staff.find(p => p.id === 'sen').name, 'Sen Renamed', "their senior's edit kept");
  eq(out.rules.find(r => r.id === 'r-jun').name, 'Juniors, my edit', 'my junior rule kept');
  eq(out.rules.find(r => r.id === 'r-sen').name, 'Seniors, their edit', 'their senior rule kept');
  ok(out.rules.some(r => r.id === 'r-all'), 'shared rule kept');
  eq(out.settings.pool, 'junior', 'my pool view stays');
  eq(out.aps, mine.aps, 'my pain service tally (junior pool)');
  eq(M.getCell(out, '2026-11-02', 'jun').a, ['C'], "my junior's shift");
  eq(M.getCell(out, '2026-11-02', 'sen').a, ['C'], "their senior's shift");
  let threw = false; try { J.mergeByPool(mine, team, docs, 'all', M.poolOf); } catch { threw = true; }
  ok(threw, 'needs one pool');
}

// each roster has its own rules: a rule about everyone is split once, and a merge keeps my roster's copy
{
  const s = M.defaultState();
  const n = s.rules.length;
  eq(M.migrate(s).rules.length, n, 'loading again does not split again');
  const mine = structuredClone(s), theirs = structuredClone(s);
  mine.settings.pool = 'junior';
  mine.rules.find(r => r.id === 'r-gap').weight = 77;      // junior copy, my edit
  mine.rules.find(r => r.id === 'r-gap-s').weight = 11;    // senior copy, stale
  theirs.rules.find(r => r.id === 'r-gap').weight = 12;    // junior copy, stale
  theirs.rules.find(r => r.id === 'r-gap-s').weight = 66;  // senior copy, their edit
  const out = J.mergeByPool(mine, cloud.pickTeam(theirs), [], 'junior', M.poolOf, cloud.cellsFromDoc);
  eq([out.rules.find(r => r.id === 'r-gap').weight, out.rules.find(r => r.id === 'r-gap-s').weight], [77, 66], 'my junior copy and their senior copy');
  eq(out.rules.length, n, 'no rule lost or doubled');
  // placing rules without a roster: by the people they name
  const t = M.defaultState();
  t.staff.push({ id: 'cx', name: 'Con X', group: 'cons', tags: [] }, { id: 'mx', name: 'Mo X', group: 'mo', tags: [] });
  M.migrate(t);
  eq(M.guessRulePool(t, { id: 'q1', who: { staff: ['cx'] } }), 'senior', 'a rule naming a consultant: senior');
  eq(M.guessRulePool(t, { id: 'q2', who: { tags: ['mo2'] } }), 'junior', 'MO2s: junior');
  eq(M.guessRulePool(t, { id: 'q3', who: { staff: ['cx', 'mx'] } }), '', 'both: split');
}

// ---------- locking a month (as in NUH junior monthly) ----------
{
  const mem = {};
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const { createStore } = await import('../js/store.js');
  const base = M.defaultState();
  base.staff = [{ id: 'z1', name: 'Z', group: base.groups[0].id, tags: [] }];
  const store = createStore({ demo: false, fallback: () => structuredClone(base) });
  ok(store.ensureLocked(MONTH) === false && !M.isMonthLocked(store.get(), MONTH), 'an empty month is not locked (a new roster can start)');
  store.commit('leave', d => { M.setCell(d, '2026-11-03', 'z1', { a: ['AL'] }); });
  ok(store.lockAll() === true && M.isMonthLocked(store.get(), MONTH), 'a month with days in it is locked when the app opens');
  let told = null; store.onLocked = m => { told = m; };
  ok(store.commit('edit', d => { M.setCell(d, '2026-11-04', 'z1', { a: ['AL'] }); }) === false && told && told[0] === MONTH, 'a change to a locked month is refused');
  ok(store.commit('next month', d => { M.setCell(d, '2026-12-04', 'z1', { a: ['AL'] }); }) === true, 'another month can still change');
  const zp = M.poolOf(store.get(), store.get().staff[0]);
  ok(store.commit('import', d => { M.setCell(d, '2026-11-05', 'z1', { a: ['AL'] }); }, { unlock: true }) === true && !M.isMonthLocked(store.get(), MONTH, zp) && store.unlocked[0] === MONTH, 'an import unlocks the months it fills');
  ok(M.isMonthLocked(store.get(), MONTH, zp === 'junior' ? 'senior' : 'junior'), '… for that roster only');
  store.undo();
  ok(M.isMonthLocked(store.get(), MONTH, zp) && !M.getCell(store.get(), '2026-11-05', 'z1'), 'undo puts the import and the lock back');
  store.commit('unlock', d => { M.setMonthLocked(d, MONTH, false, 'both'); });
  ok(store.ensureLocked(MONTH) === false && !M.isMonthLocked(store.get(), MONTH, 'junior') && !M.isMonthLocked(store.get(), MONTH, 'senior'), 'a month someone unlocked stays open this visit');
  ok(store.lockAll() === true && M.isMonthLocked(store.get(), MONTH, 'junior') && M.isMonthLocked(store.get(), MONTH, 'senior') && M.isMonthLocked(store.get(), '2026-12'), 'closing locks it again (both rosters), and the month without an entry');
  const demo = createStore({ demo: true, fallback: () => structuredClone(store.get()) });
  ok(demo.lockAll() === false, 'practice is never locked');
}

// ---------- each roster locks its own month ----------
{
  const s = M.defaultState();
  s.staff = [{ id: 'j1', name: 'J', group: 'mo', tags: [] }, { id: 's1', name: 'S', group: 'cons', tags: [] }];
  M.migrate(s);
  s.settings.pool = 'junior';
  M.setMonthLocked(s, MONTH, true);
  ok(M.isMonthLocked(s, MONTH) && M.isMonthLocked(s, MONTH, 'junior') && !M.isMonthLocked(s, MONTH, 'senior'), 'locking locks the roster in view only');
  eq(s.months[MONTH].status, 'draft', 'status published only when both are locked');
  M.setMonthLocked(s, MONTH, true, 'senior');
  eq(s.months[MONTH].status, 'published', 'both locked: published (what older copies read)');
  M.setMonthLocked(s, MONTH, false, 'senior');
  const old = M.migrate({ ...M.defaultState(), months: { [MONTH]: { status: 'published', publishedAt: '2026-10-01T00:00:00Z' } } });
  ok(M.isMonthLocked(old, MONTH, 'junior') && M.isMonthLocked(old, MONTH, 'senior'), 'a month locked before: locked for both');
  const mem = {};
  globalThis.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
  const { createStore } = await import('../js/store.js');
  const store = createStore({ demo: false, fallback: () => structuredClone(s) });
  let hits = null; store.onLocked = (m, label, h) => { hits = h; };
  ok(store.commit('senior edit', d => { M.setCell(d, '2026-11-04', 's1', { a: ['AL'] }); }) === true, 'the senior roster can still change while the junior one is locked');
  ok(store.commit('junior edit', d => { M.setCell(d, '2026-11-04', 'j1', { a: ['AL'] }); }) === false && hits && hits[0].pool === 'junior', 'the junior roster cannot');
  // the cloud: each roster's lock goes up and comes back; a document from an older app (status only) locks both
  const pm = cloud.pickMonth(store.get(), MONTH);
  eq(pm.meta.locks.junior !== '' && pm.meta.locks.senior === '', true, 'the month sent up carries each lock');
  ok(cloud.monthFromDoc({ status: 'published', publishedAt: 'x' }).locks.senior === 'x', 'old document: locked for both');
  eq(cloud.monthFromDoc({ status: 'draft', locks: { junior: '', senior: 't' } }).locks, { junior: '', senior: 't' }, 'new document: as saved');
  // merge by pool: my roster's lock, their lock for the other
  const mine = structuredClone(store.get()), theirs = structuredClone(store.get());
  M.setMonthLocked(theirs, MONTH, false, 'junior'); M.setMonthLocked(theirs, MONTH, true, 'senior');
  const docs = [{ month: MONTH, ...cloud.pickMonth(theirs, MONTH).meta, cells: JSON.stringify(cloud.pickMonth(theirs, MONTH).cells) }];
  const out = J.mergeByPool(mine, cloud.pickTeam(theirs), docs, 'junior', M.poolOf, cloud.cellsFromDoc);
  ok(out.months[MONTH].locks.junior && out.months[MONTH].locks.senior && out.months[MONTH].status === 'published', 'my junior lock kept, their senior lock taken');
}

// ---------- senior residents and moving someone by hand ----------
{
  eq(M.DEFAULT_GROUPS.find(g => g.id === 'sr').kind, 'senior', 'senior residents are a senior section');
  const old = M.defaultState();
  old.groups.find(g => g.id === 'sr').kind = 'junior';
  delete old.settings.srv;
  old.staff = [
    { id: 'r1', name: 'Fake Senior Res', group: 'sr', tags: ['jpool', 'mo2'] },
    { id: 'r2', name: 'Fake Res Phys', group: 'srp', tags: ['jpool'] },
    { id: 'r3', name: 'Fake Moved', group: 'srp', tags: ['jpool'], pool: 'senior' },
    { id: 'r4', name: 'Fake Odd', group: 'mo', tags: [], pool: 'sideways' },
  ];
  const s = M.migrate(old);
  const by = id => s.staff.find(p => p.id === id);
  eq(s.groups.find(g => g.id === 'sr').kind, 'senior', 'an older save moves the section once');
  eq([M.poolOf(s, by('r1')), M.poolOf(s, by('r2')), M.poolOf(s, by('r3'))], ['senior', 'junior', 'senior'], 'SRs senior, SRPs junior, a move by hand wins over the tag');
  eq(by('r1').tags, ['mo2'], 'the old pool tag is dropped from senior residents');
  ok(!('pool' in by('r4')), 'an unknown pool value is dropped');
  eq(M.autoPoolOf(s, by('r3')), 'junior', 'the automatic pool ignores the move');
  s.groups.find(g => g.id === 'sr').kind = 'junior';
  eq(M.migrate(s).groups.find(g => g.id === 'sr').kind, 'junior', 'a section set back to junior by hand stays');
  // a reimport keeps the move
  const parsed = { people: [{ key: 'k3', name: 'Fake Moved', group: 'srp', matchId: 'r3', note: 'R3' }], months: [], cells: [] };
  try { io.applyImport(s, parsed); } catch { /* only the people part matters here */ }
  eq([by('r3').pool, by('r3').note], ['senior', 'R3'], 'reimport keeps the move by hand');
}

// ---------- rules: no To confirm, priorities in bulk ----------
{
  const old = M.defaultState();
  delete old.settings.rcv;
  old.rules.push({ ...old.rules[0], id: 'rx', note: 'Keep this. Predicted from the drafted rules: confirm or change.' });
  const s = M.migrate(old);
  eq(s.rules.find(r => r.id === 'rx').note, 'Keep this.', 'the old To confirm sentence goes, the rest of the note stays');
  const soft = s.rules.filter(r => !r.hard).slice(0, 2), hard = s.rules.find(r => r.hard);
  const spread = s.rules.find(r => r.type === 'spread');
  const ids = new Set([...soft.map(r => r.id), hard.id]);
  eq(bulkSet(s, ids, { weight: 70 }) >= 2, true, 'set priority changes the selected rules');
  eq(soft.map(r => s.rules.find(x => x.id === r.id).weight), [70, 70], 'to 70');
  ok(s.rules.find(r => r.id === hard.id).hard, 'a must-hold rule stays must hold when given a priority');
  bulkSet(s, ids, { by: 40 });
  eq(s.rules.find(r => r.id === soft[0].id).weight, 100, 'raising stops at 100');
  bulkSet(s, new Set([spread.id]), { hard: true });
  ok(!s.rules.find(r => r.id === spread.id).hard, 'a share-fairly rule cannot become must hold');
  bulkSet(s, ids, { enabled: false });
  ok([...ids].every(id => s.rules.find(r => r.id === id).enabled === false), 'turned off together');
}

// dragging a rule in Priorities: it lands between its neighbours, ties keep the order it was dropped in
{
  const s = { rules: [
    { id: 'a', type: 'cap', hard: false, weight: 80 }, { id: 'b', type: 'cap', hard: false, weight: 50 },
    { id: 'c', type: 'cap', hard: false, weight: 50 }, { id: 'd', type: 'cap', hard: true, weight: 50 },
    { id: 's', type: 'spread', hard: false, weight: 10 }] };
  const sorted = () => s.rules.filter(r => !r.hard).sort((x, y) => y.weight - x.weight).map(r => r.id);
  ok(placeRule(s, 's', { hard: false, aboveId: 'a', belowId: 'b' }), 'moved');
  eq(s.rules.find(r => r.id === 's').weight, 65, 'between 80 and 50 it gets 65');
  placeRule(s, 'a', { hard: false, aboveId: 'b', belowId: 'c' });
  eq(sorted(), ['s', 'b', 'a', 'c'], 'between two at 50 it gets 50 and sits between them');
  placeRule(s, 'c', { hard: false, aboveId: null, belowId: 's' });
  eq(s.rules.find(r => r.id === 'c').weight, 83, 'to the top: halfway to 100');
  placeRule(s, 'b', { hard: false, aboveId: 'a', belowId: null });
  eq(sorted().at(-1), 'b', 'to the bottom');
  ok(placeRule(s, 'd', { hard: false, aboveId: 'c', belowId: 's' }) && !s.rules.find(r => r.id === 'd').hard, 'a must-hold rule dragged into preferences becomes one');
  ok(placeRule(s, 'a', { hard: true }) && s.rules.find(r => r.id === 'a').hard, 'dragged into Must hold');
  eq(placeRule(s, 's', { hard: true }), false, 'a share-fairly rule cannot go into Must hold');
  eq(placeRule(s, 'c', { hard: false, aboveId: null, belowId: 'd' }), false, 'dropped where it was: nothing changes');
}

// ---------- a half call for the No calls people is a preference (owner, 20 Oct 2026) ----------
{
  const r = J.JUNIOR_RULES.find(x => x.id === 'r-jp-nocall-hc');
  eq([r.hard, r.params.max, J.JUNIOR_RULES.some(x => x.id === 'r-jp-nocall-hc0')], [false, 0, false], 'new installs: soft, max 0, one rule');
  const old = M.defaultState();
  old.rules.push(structuredClone(J.JUNIOR_RULES.find(x => x.id === "r-jp-nocall")), { ...structuredClone(r), hard: true, weight: 10, params: { ...r.params, max: 1 } }, { ...structuredClone(r), id: 'r-jp-nocall-hc0' });
  delete old.settings.jpNch;
  const m = M.migrate(old);
  const hc = m.rules.find(x => x.id === 'r-jp-nocall-hc');
  eq([hc.hard, hc.params.max, m.rules.some(x => x.id === 'r-jp-nocall-hc0')], [false, 0, false], 'older saves: the one-a-month limit becomes a preference');
}

console.log(`junior pool tests: ${n} checks passed`);
