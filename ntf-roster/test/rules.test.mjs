// NTF Roster: unit tests for the model helpers and the rule engine. Run: node ntf-roster/test/rules.test.mjs
// Made-up names only. Plain node:assert, no browser.
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import {
  RULE_TYPES, DEFAULT_RULES, newRule, describeRule, validateRule, evaluate, evaluateRule,
} from '../js/rules.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };

// November 2026: Sun 1 Nov … Mon 30 Nov. Test holiday on Tue 10 Nov.
const NOV = { from: '2026-11-01', to: '2026-11-30' };
const P = (id, name, short, group, extra = {}) => ({ id, name, short, group, tags: [], fte: 1, start: '', end: '', note: '', active: true, ...extra });

function base() {
  const s = M.defaultState();
  s.settings.holidays = { '2026-11-10': 'Test holiday' };
  s.staff = [
    P('c1', 'Wong Mei Lan', 'WML', 'cons'),
    P('c2', 'Harold Finch', 'HF', 'cons'),
    P('a1', 'Siti Rahmah', 'SR', 'ac'),
    P('r1', 'Arjun Pillai', 'AP', 'srp'),
    P('r2', 'Grace Toh', 'GT', 'rp'),
    P('j1', 'Liam Carter', 'LC', 'jr'),
    P('m1', 'Nur Aisyah', 'NA', 'mo', { tags: ['babymo'] }),
    P('m2', 'Daniel Seah', 'DS', 'mo', { tags: ['babymo'] }),
    P('m3', 'Priya Menon', '', 'mo'),
    P('m4', 'Tom Baker', 'TB', 'mo', { fte: 0.5, tags: ['parttime'] }),
  ];
  return s;
}
const put = (s, date, id, a = [], r = []) => M.setCell(s, date, id, { a, r });
// a rule with type defaults, then params / who / when / flags
const mk = (s, type, params = {}, o = {}) => {
  const r = newRule(type, s);
  return { ...r, hard: o.hard ?? r.hard, weight: o.weight ?? 10, who: { ...r.who, ...(o.who || {}) }, when: { ...r.when, ...(o.when || {}) }, params: { ...r.params, ...params } };
};
const run = (s, rule, range = NOV) => evaluateRule(s, rule, range);

// ---------- model ----------
eq(M.STORE_KEY, 'ntf-roster-v1');
eq(M.DEMO_KEY, 'ntf-roster-demo');
eq(M.DEFAULT_GROUPS.map(g => g.id), ['cons', 'ac', 'ext', 'vc', 'sr', 'srp', 'rp', 'jr', 'locum', 'mo', 'nurse']);
eq(M.DEFAULT_GROUPS.filter(g => g.kind === 'senior').map(g => g.id), ['cons', 'ac', 'ext', 'vc', 'sr']);
eq(M.DEFAULT_TAGS.slice(0, 4).map(t => t.id), ['babymo', 'parttime', 'pain', 'icu']);
{
  const dm = new Map(M.DEFAULT_DUTIES.map(d => [d.code, d]));
  eq(M.DEFAULT_DUTIES.filter(d => d.auto).map(d => d.code), ['C', 'P', 'SMO', 'OTC', 'PHD', 'HC']);
  eq(M.DEFAULT_DUTIES.filter(d => d.overnight).map(d => d.code), ['C', 'SMO', 'W']);
  eq(M.DEFAULT_DUTIES.filter(d => d.kind === 'request').map(d => d.code), ['Cr', 'Nc', 'Wr', 'Nw', 'Pr', 'NP']);
  eq(M.DEFAULT_DUTIES.filter(d => d.kind === 'leave').length, 15);
  eq([dm.get('C').color, dm.get('C').ink, dm.get('x').kind], ['#c62828', '#fff', 'derived']);
}
eq(M.iso(new Date(2026, 10, 3)), '2026-11-03');
eq(M.addDays('2026-11-30', 1), '2026-12-01');
eq(M.addDays('2026-03-01', -1), '2026-02-28');
eq(M.monthDays('2026-02').length, 28);
eq(M.monthDays('2026-11')[0], '2026-11-01');
eq(M.addMonths('2026-12', 1), '2027-01');
eq(M.addMonths('2026-01', -1), '2025-12');
eq(M.monthOf('2026-11-03'), '2026-11');
eq([M.weekday('2026-11-01'), M.isWeekend('2026-11-07'), M.isWeekend('2026-11-06')], [0, true, false]);
eq(M.fmtDay('2026-11-03'), 'Tue 3 Nov');
eq(M.fmtMonth('2026-11'), 'November 2026');
{
  const s = base();
  ok(M.isHoliday(s, '2026-11-10') && !M.isHoliday(s, '2026-11-11'), 'isHoliday');
  eq(M.holidayName(s, '2026-11-10'), 'Test holiday');
  // setCell: dedupe, auto ⊆ a, empty cell and day deleted
  M.setCell(s, '2026-11-03', 'm1', { a: ['C', 'C', 'Clinic'], auto: ['C', 'P'] });
  eq(M.getCell(s, '2026-11-03', 'm1'), { a: ['C', 'Clinic'], r: [], auto: ['C'], note: '', lock: false });
  M.setCell(s, '2026-11-03', 'm1', { a: [], auto: [] });
  ok(!s.cells['2026-11-03'], 'empty cell and day deleted');
  M.setCell(s, '2026-11-03', 'm1', { lock: true });
  ok(M.getCell(s, '2026-11-03', 'm1').lock, 'a lock alone keeps the cell');
  // effective codes: x after an overnight shift
  put(s, '2026-11-04', 'm2', ['C']);
  eq(M.effectiveCodes(s, '2026-11-05', 'm2'), ['x']);
  eq(M.effectiveCodes(s, '2026-11-04', 'm2'), ['C']);
  put(s, '2026-11-04', 'm3', ['P']);
  eq(M.effectiveCodes(s, '2026-11-05', 'm3'), [], 'P is not overnight');
  // tokens
  const away = M.expandTokens(s, ['@away']);
  ok(away.has('AL') && away.has('NUH') && away.has('x') && !away.has('C'), '@away expands to leave, other and x');
  ok(M.expandTokens(s, ['@shift', 'Cr']).has('Cr') && M.expandTokens(s, ['@shift']).has('Inj'), 'expandTokens keeps plain codes');
  ok(!M.expandTokens(s, ['@present']).size, '@present is not a code');
  ok(M.matchesCodes(s, '2026-11-05', 'm2', ['x']), 'x matches post call');
  ok(!M.matchesCodes(s, '2026-11-05', 'm2', ['@present']), 'post call is not present');
  ok(M.matchesCodes(s, '2026-11-03', 'r1', ['@present']), 'empty weekday = present');
  ok(!M.matchesCodes(s, '2026-11-07', 'r1', ['@present']), 'empty Saturday = not present');
  ok(!M.matchesCodes(s, '2026-11-10', 'r1', ['@present']), 'empty public holiday = not present');
  put(s, '2026-11-07', 'r1', ['C']);
  ok(M.matchesCodes(s, '2026-11-07', 'r1', ['@present']), 'a weekend shift = present');
  put(s, '2026-11-12', 'r2', ['AL']);
  ok(!M.matchesCodes(s, '2026-11-12', 'r2', ['@present']) && M.matchesCodes(s, '2026-11-12', 'r2', ['@leave']), 'leave = away');
  put(s, '2026-11-13', 'r2', [], ['Nc']);
  ok(M.matchesCodes(s, '2026-11-13', 'r2', ['Nc']) && M.matchesCodes(s, '2026-11-13', 'r2', ['@request']), 'requests match');
  ok(M.matchesCodes(s, '2026-11-13', 'r2', ['@any']) && !M.matchesCodes(s, '2026-11-14', 'r2', ['@any']), '@any');
  // staff in post
  ok(M.staffActiveOn({ active: true, start: '2026-11-05', end: '' }, '2026-11-05'), 'start day is in post');
  ok(!M.staffActiveOn({ active: true, start: '', end: '2026-11-04' }, '2026-11-05'), 'after end');
  ok(!M.staffActiveOn({ active: false }, '2026-11-05'), 'inactive');
  s.staff.push(P('c3', 'Late Joiner', 'LJ', 'cons', { start: '2026-12-01' }), P('c4', 'Inactive', 'IN', 'cons', { active: false }));
  eq(M.staffInMonth(s, '2026-11').map(p => p.id), ['c1', 'c2', 'a1', 'r1', 'r2', 'j1', 'm1', 'm2', 'm3', 'm4']);
  ok(M.staffInMonth(s, '2026-12').some(p => p.id === 'c3'), 'joiner in December');
  eq(M.staffMap(s).get('m3').name, 'Priya Menon');
  ok(M.dutyMap(s).get('C').overnight && M.groupMap(s).get('mo').kind === 'junior', 'maps');
  ok(/^r-[a-z0-9]+$/.test(M.uid('r')) && M.uid() !== M.uid(), 'uid');
}
{
  // migrate fills missing fields and keeps what is there
  const s = M.migrate({ staff: [{ id: 'q', name: 'Q Test' }], rules: [{ id: 'x1', type: 'cover', params: { codes: ['C'] } }, { junk: 1 }] });
  eq([s.v, s.staff[0].group, s.staff[0].fte, s.staff[0].active, s.rules.length], [1, 'mo', 1, true, 2]);
  eq(s.rules.map(r => [r.id, r.pool]), [['x1', 'junior'], ['x1-s', 'senior']], 'a rule about everyone becomes one per roster');
  eq(s.rules[0].who, { groups: [], tags: [], staff: [], exclude: [] });
  ok(s.duties.length === M.DEFAULT_DUTIES.length && s.groups.length === 11 && s.cells && s.months, 'defaults filled');
  {
    const d = M.defaultState().rules, both = DEFAULT_RULES.filter(r => !r.pool).length;
    ok(d.length === DEFAULT_RULES.length + both, 'defaultState has the default rules, the ones about everyone once per roster');
    ok(d.every(r => r.pool === 'junior' || r.pool === 'senior'), 'every default rule has a roster');
    eq(['r-jcall', 'r-scall', 'r-otc', 'r-baby', 'r-leave', 'r-leave-s'].map(id => d.find(r => r.id === id).pool), ['junior', 'senior', 'senior', 'junior', 'junior', 'senior']);
  }
  ok(M.defaultState().rules !== M.defaultState().rules && M.defaultState().rules[0] !== DEFAULT_RULES[0], 'defaultState copies the rules');
}

// ---------- rule type metadata (the rule builder is generated from it) ----------
const KEYS = {
  cover: ['codes', 'min', 'max'],
  limit: ['codes', 'period', 'window', 'min', 'max', 'fte', 'prorate'],
  sequence: ['ifCodes', 'mode', 'thenCodes', 'from', 'to'],
  sameDay: ['codesA', 'mode', 'codesB'],
  together: ['codes', 'mode', 'other', 'otherCodes', 'min'],
  maxRun: ['codes', 'max'],
  requests: ['request', 'mode', 'codes', 'span'],
  spread: ['codes', 'period', 'weekendWeight', 'holidayWeight', 'tolerance'],
  eligible: ['codes'],
  standing: ['codes'],
};
eq(Object.keys(RULE_TYPES).sort(), Object.keys(KEYS).sort(), 'the ten rule types');
const KINDS = ['codes', 'code', 'number', 'select', 'who', 'bool'];
for (const [type, t] of Object.entries(RULE_TYPES)) {
  eq(t.params.map(p => p.key).sort(), [...KEYS[type]].sort(), `${type} param keys`);
  ok(t.label && t.icon && t.help && t.example && ['day', 'person', 'global'].includes(t.scope), `${type} words and scope`);
  ok(t.params.every(p => KINDS.includes(p.kind) && p.label && (p.kind !== 'select' || (p.options || []).length)), `${type} param specs`);
  const d = t.defaults();
  ok(KEYS[type].every(k => k in d), `${type} defaults has every key`);
  ok(t.defaults() !== d, `${type} defaults is fresh`);
}
const opts = (type, key) => RULE_TYPES[type].params.find(p => p.key === key).options.map(o => o[0]);
eq(opts('limit', 'period'), ['week', 'month', 'rolling']);
eq(opts('sequence', 'mode').sort(), ['forbid', 'require']);
eq(opts('sameDay', 'mode').sort(), ['forbid', 'require']);
eq(opts('together', 'mode').sort(), ['needs', 'never']);
eq(opts('requests', 'mode').sort(), ['avoid', 'want']);
eq(opts('requests', 'span'), ['day', 'weekend']);
eq(opts('spread', 'period'), ['month', 'range']);
ok(RULE_TYPES.spread.soft_only === true, 'spread is soft only');
eq(RULE_TYPES.together.params.find(p => p.key === 'other').kind, 'who');
eq(RULE_TYPES.requests.params.find(p => p.key === 'request').kind, 'code');
eq(RULE_TYPES.limit.params.find(p => p.key === 'fte').kind, 'bool');

// ---------- DEFAULT_RULES ----------
eq(DEFAULT_RULES.map(r => r.id), ['r-leave', 'r-postcall', 'r-jcall', 'r-scall', 'r-gap', 'r-maxcall', 'r-wkend', 'r-fair-j', 'r-fair-s',
  'r-req-cr', 'r-req-nc', 'r-req-wr', 'r-req-nw', 'r-req-pr', 'r-req-np', 'r-baby', 'r-baby2', 'r-preleave', 'r-pm', 'r-otc', 'r-phd']);
{
  const s = base();
  for (const r of DEFAULT_RULES) {
    eq(validateRule(r, s), [], `default rule ${r.id} is valid`);
    ok(describeRule(r, s).length > 10, `default rule ${r.id} is described`);
  }
  const byId = Object.fromEntries(DEFAULT_RULES.map(r => [r.id, r]));
  eq([byId['r-jcall'].params.min, byId['r-jcall'].params.max, byId['r-jcall'].hard], [2, 2, true]);
  eq([byId['r-gap'].hard, byId['r-gap'].weight, byId['r-gap'].params.from, byId['r-gap'].params.to], [false, 20, 1, 2]);
  eq([byId['r-req-nw'].hard, byId['r-req-nw'].weight, byId['r-req-nw'].params.span], [false, 50, 'weekend']);
  eq(byId['r-pm'].when, { from: '', to: '', days: [1, 2, 3, 4, 5], holidays: 'exclude' });
  eq(byId['r-phd'].when.holidays, 'only');
  eq(byId['r-otc'].who.groups, ['cons', 'ac', 'ext', 'vc']);
  eq(byId['r-baby'].params.other.groups, ['sr', 'srp', 'rp', 'ac']);
  ok(/^Each day: exactly 2 people from Senior residents, /.test(describeRule(byId['r-jcall'], s)), 'senior residents are no longer a junior section, so the rule names its sections');
}

// ---------- each rule type ----------
// cover: count of people (in who) with the codes, each day in when
{
  const s = base();
  const r = mk(s, 'cover', { codes: ['C'], min: 2, max: 2 }, { who: { groups: ['srp', 'rp', 'jr', 'locum', 'mo'] }, when: { from: '2026-11-02', to: '2026-11-04' } });
  put(s, '2026-11-02', 'r1', ['C']); put(s, '2026-11-02', 'm1', ['C']);                       // 2: fine
  put(s, '2026-11-03', 'r1', ['C']); put(s, '2026-11-03', 'c1', ['C']);                       // 1 junior (c1 is senior)
  put(s, '2026-11-04', 'r2', ['C']); put(s, '2026-11-04', 'm3', ['C']); put(s, '2026-11-04', 'j1', ['C']); // 3
  const v = run(s, r);
  eq(v.length, 2, 'cover: one short day, one over day');
  eq(v[0].msg, 'Tue 3 Nov: 1 junior on Call, needs 2');
  eq([v[0].date, v[0].hard, v[0].penalty], ['2026-11-03', true, 1000]);
  ok(v[1].msg === 'Wed 4 Nov: 3 juniors on Call, at most 2' && v[1].staffIds.length === 3, 'cover over names the people');
  // staff outside their dates don't count
  s.staff.find(p => p.id === 'r1').end = '2026-11-01';
  ok(run(s, r).some(x => x.date === '2026-11-02'), 'cover ignores people not in post');
  // holidays only / weekdays: when filter
  const ph = mk(s, 'cover', { codes: ['PHD'], min: 1, max: 1 }, { when: { holidays: 'only' } });
  eq(run(s, ph).map(x => x.date), ['2026-11-10'], 'cover holidays only');
  const pm = mk(s, 'cover', { codes: ['P'], min: 1 }, { when: { days: [1, 2, 3, 4, 5], holidays: 'exclude' } });
  eq(run(s, pm).length, 20, 'cover weekdays except the holiday: 21 weekdays - 1');
  // @present as a cover code (at least 3 seniors at work on weekdays)
  const pres = mk(s, 'cover', { codes: ['@present'], min: 3, max: null }, { who: { groups: ['cons', 'ac'] }, when: { from: '2026-11-02', to: '2026-11-08' } });
  // c1 was on call on Tue 3 Nov (present), so post call on Wed 4 Nov (not present); weekends nobody is present
  eq(run(s, pres).map(v => v.date), ['2026-11-04', '2026-11-07', '2026-11-08'], 'cover @present');
}
{
  // cover on weekends where nobody is present: @present counts 0, so a min 1 rule flags weekend days only
  const s = base();
  const r = mk(s, 'cover', { codes: ['@present'], min: 1, max: null }, { who: { staff: ['c1'] }, when: { from: '2026-11-02', to: '2026-11-08' } });
  eq(run(s, r).map(v => v.date), ['2026-11-07', '2026-11-08'], '@present false on weekends');
  put(s, '2026-11-03', 'c1', ['AL']);
  eq(run(s, r).map(v => v.date), ['2026-11-03', '2026-11-07', '2026-11-08'], '@present false on leave');
}

// limit: per week / month / rolling, fte and pro rata
{
  const s = base();
  const r = mk(s, 'limit', { codes: ['C'], period: 'month', max: 2 }, { who: { groups: ['mo'] } });
  for (const d of ['2026-11-02', '2026-11-09', '2026-11-16']) put(s, d, 'm1', ['C']);
  for (const d of ['2026-11-02', '2026-11-09']) put(s, d, 'm3', ['C']);
  let v = run(s, r);
  eq(v.length, 1, 'limit month: m1 over, m3 at the cap');
  eq(v[0].msg, 'NA: 3 Call in November 2026, at most 2');
  eq([v[0].staffId, v[0].dates], ['m1', ['2026-11-02', '2026-11-09', '2026-11-16']]);
  // fte: the part-timer (0.5) gets floor(2 × 0.5) = 1
  put(s, '2026-11-03', 'm4', ['C']); put(s, '2026-11-20', 'm4', ['C']);
  eq(run(s, r).filter(x => x.staffId === 'm4').length, 0, 'without fte the part-timer may do 2');
  r.params.fte = true;
  v = run(s, r).filter(x => x.staffId === 'm4');
  ok(v.length === 1 && /at most 1$/.test(v[0].msg), 'limit fte scales the cap');
  // prorate: someone in post for half the month gets half the cap
  r.params.fte = false; r.params.prorate = true; r.params.max = 4;
  s.staff.find(p => p.id === 'm3').start = '2026-11-16';
  put(s, '2026-11-18', 'm3', ['C']); put(s, '2026-11-22', 'm3', ['C']); put(s, '2026-11-26', 'm3', ['C']);
  v = run(s, r).filter(x => x.staffId === 'm3');
  ok(v.length === 1 && /3 Call .* at most 2$/.test(v[0].msg), 'limit prorate: 15 of 30 days, cap 2 (days before start ignored)');
  // min
  const mn = mk(s, 'limit', { codes: ['C'], period: 'month', min: 1, max: null }, { who: { staff: ['j1'] } });
  eq(run(s, mn)[0].msg, 'LC: 0 Call in November 2026, needs 1');
  // when days: weekends only
  const wk = mk(s, 'limit', { codes: ['C'], period: 'month', max: 1 }, { when: { days: [0, 6] }, hard: false, weight: 20 });
  put(s, '2026-11-07', 'r2', ['C']); put(s, '2026-11-14', 'r2', ['C']); put(s, '2026-11-11', 'r2', ['C']);
  v = run(s, wk);
  ok(v.length === 1 && v[0].staffId === 'r2' && !v[0].hard && v[0].penalty === 20, 'limit counts weekend days only, soft weight');
  // week: Mon to Sun
  const wl = mk(s, 'limit', { codes: ['@shift'], period: 'week', max: 2 }, { who: { staff: ['c2'] } });
  put(s, '2026-11-02', 'c2', ['Clinic']); put(s, '2026-11-04', 'c2', ['Inj']); put(s, '2026-11-08', 'c2', ['C']); // Mon, Wed, Sun
  put(s, '2026-11-09', 'c2', ['C']);                                                                                 // next Mon
  v = run(s, wl);
  ok(v.length === 1 && /week of Mon 2 Nov/.test(v[0].msg), 'limit week Mon–Sun');
  // rolling: any 7 days, one violation per run of bad windows
  const rl = mk(s, 'limit', { codes: ['C'], period: 'rolling', window: 7, max: 1 }, { who: { staff: ['a1'] } });
  put(s, '2026-11-02', 'a1', ['C']); put(s, '2026-11-06', 'a1', ['C']);
  eq(run(s, rl).length, 1, 'limit rolling: one report for overlapping windows');
  put(s, '2026-11-06', 'a1', []); put(s, '2026-11-09', 'a1', ['C']);
  eq(run(s, rl).length, 0, 'limit rolling: 7 days apart is fine');
}

// sequence: gaps between calls, no call before leave, require, negative offsets, cross-month context
{
  const s = base();
  const gap = mk(s, 'sequence', { ifCodes: ['C'], thenCodes: ['C'], mode: 'forbid', from: 1, to: 2 }, { hard: false, weight: 20 });
  put(s, '2026-11-02', 'r1', ['C']); put(s, '2026-11-04', 'r1', ['C']); put(s, '2026-11-07', 'r1', ['C']);
  let v = run(s, gap);
  eq(v.length, 1, 'sequence: C 2 days after C');
  eq(v[0].msg, 'AP: Call on Mon 2 Nov, then Call on Wed 4 Nov');
  eq([v[0].penalty, v[0].hard, v[0].dates], [20, false, ['2026-11-02', '2026-11-04']]);
  // previous month counts (context), but only violations touching the range are reported
  put(s, '2026-10-31', 'r2', ['C']); put(s, '2026-11-01', 'r2', ['C']);
  v = run(s, gap).filter(x => x.staffId === 'r2');
  ok(v.length === 1 && v[0].date === '2026-11-01', 'sequence sees October');
  put(s, '2026-10-28', 'j1', ['C']); put(s, '2026-10-29', 'j1', ['C']);
  ok(!run(s, gap).some(x => x.staffId === 'j1'), 'sequence ignores pairs wholly outside the range');
  // no call the night before leave
  const pre = mk(s, 'sequence', { ifCodes: ['C'], thenCodes: ['@leave'], mode: 'forbid', from: 1, to: 1 });
  put(s, '2026-11-12', 'm3', ['C']); put(s, '2026-11-13', 'm3', ['AL']);
  eq(run(s, pre).map(x => x.msg), ['Priya Menon: Call on Thu 12 Nov, then leave on Fri 13 Nov'], 'name used when short is blank');
  // the same with a negative offset: leave on d forbids C on d-1
  const pre2 = mk(s, 'sequence', { ifCodes: ['@leave'], thenCodes: ['C'], mode: 'forbid', from: -1, to: -1 });
  eq(run(s, pre2).length, 1, 'sequence negative offset');
  // require: after C, x (post call) the next day always holds; after W require Clinic fails
  const req = mk(s, 'sequence', { ifCodes: ['C'], thenCodes: ['x'], mode: 'require', from: 1, to: 1 });
  eq(run(s, req).length, 0, 'x follows C');
  const req2 = mk(s, 'sequence', { ifCodes: ['W'], thenCodes: ['Clinic'], mode: 'require', from: 1, to: 1 });
  put(s, '2026-11-20', 'c1', ['W']);
  eq(run(s, req2)[0].msg, 'WML: Weekend duty on Fri 20 Nov needs Clinic on Sat 21 Nov');
  // when applies to the "if" day
  const wkOnly = mk(s, 'sequence', { ifCodes: ['C'], thenCodes: ['C'], mode: 'forbid', from: 1, to: 2 }, { when: { days: [6] } });
  // only Saturday calls count as the "if": r1's Sat 7 Nov call has no call after it; r2's Sat 31 Oct call does (1 Nov)
  eq(run(s, wkOnly).map(v => [v.staffId, v.date]), [['r2', '2026-11-01']], 'sequence when: Saturday calls only');
}

// sameDay: forbid pairs (leave + shift, post call + shift), require
{
  const s = base();
  const leave = DEFAULT_RULES.find(r => r.id === 'r-leave'), post = DEFAULT_RULES.find(r => r.id === 'r-postcall');
  put(s, '2026-11-03', 'm1', ['AL', 'C']);
  put(s, '2026-11-05', 'm2', ['C']); put(s, '2026-11-06', 'm2', ['P']);
  put(s, '2026-11-08', 'm3', ['C']); put(s, '2026-11-09', 'm3', ['AL']);   // x and leave: allowed
  let v = run(s, leave);
  eq(v.map(x => x.msg), ['Tue 3 Nov: NA has Annual leave and Call'], 'sameDay leave + shift');
  eq([v[0].staffId, v[0].date], ['m1', '2026-11-03']);
  v = run(s, post);
  eq(v.map(x => x.msg), ['Fri 6 Nov: DS has post call and PM shift'], 'sameDay x + shift (post call with leave is fine)');
  // post call from the last day of the previous month
  put(s, '2026-10-31', 'j1', ['C']); put(s, '2026-11-01', 'j1', ['Clinic']);
  ok(run(s, post).some(x => x.staffId === 'j1' && x.date === '2026-11-01'), 'post call across months');
  // @shift + @shift means two different shifts
  const two = mk(s, 'sameDay', { codesA: ['@shift'], codesB: ['@shift'], mode: 'forbid' });
  put(s, '2026-11-12', 'c1', ['Clinic', 'Inj']);
  eq(run(s, two).filter(x => x.staffId === 'c1').length, 1, 'two shifts on one day');
  ok(!run(s, two).some(x => x.staffId === 'm2' && x.date === '2026-11-05'), 'one shift alone is fine');
  // require: Creg only with C
  const tag = mk(s, 'sameDay', { codesA: ['Creg'], codesB: ['C'], mode: 'require' });
  put(s, '2026-11-14', 'r1', ['Creg']); put(s, '2026-11-15', 'r2', ['Creg', 'C']);
  eq(run(s, tag).map(x => x.msg), ['Sat 14 Nov: AP has Call tag-on without Call']);
  // a request counts: Nc + C forbidden for juniors (who filter)
  const nc = mk(s, 'sameDay', { codesA: ['Nc'], codesB: ['C'], mode: 'forbid' }, { who: { groups: ['mo'] } });
  put(s, '2026-11-16', 'm4', ['C'], ['Nc']); put(s, '2026-11-16', 'c2', ['C'], ['Nc']);
  eq(run(s, nc).map(x => x.staffId), ['m4'], 'who filter on sameDay');
  // exclude
  nc.who.exclude = ['m4'];
  eq(run(s, nc).length, 0, 'who exclude');
}

// together: needs / never
{
  const s = base();
  const baby = DEFAULT_RULES.find(r => r.id === 'r-baby'), baby2 = DEFAULT_RULES.find(r => r.id === 'r-baby2');
  put(s, '2026-11-02', 'm1', ['C']); put(s, '2026-11-02', 'm3', ['C']);       // baby MO with a plain MO: needs fails
  put(s, '2026-11-03', 'm1', ['C']); put(s, '2026-11-03', 'r2', ['C']);       // with an RP: fine
  put(s, '2026-11-04', 'm1', ['C']); put(s, '2026-11-04', 'm2', ['C']);       // two babies: needs ×2, never ×1
  let v = run(s, baby);
  eq(v.map(x => x.date), ['2026-11-02', '2026-11-04', '2026-11-04'], 'together needs');
  ok(v[0].msg.startsWith('Mon 2 Nov: NA on Call needs someone from'), 'together needs message');
  v = run(s, baby2);
  eq(v.length, 1, 'together never: a pair counts once');
  eq(v[0].msg, 'Wed 4 Nov: NA (Call) with DS (Call)');
  eq(v[0].staffIds.sort(), ['m1', 'm2']);
  // needs min 2, other people only (not themselves)
  const two = mk(s, 'together', { codes: ['C'], other: { groups: ['cons', 'ac'], tags: [], staff: [], exclude: [] }, otherCodes: ['@present'], mode: 'needs', min: 2 }, { who: { staff: ['c1'] } });
  put(s, '2026-11-05', 'c1', ['C']);
  eq(run(s, two).length, 0, 'c2 and a1 present on a weekday');
  put(s, '2026-11-05', 'a1', ['AL']);
  eq(run(s, two)[0].penalty, 1000, 'one short of 2 (c1 itself does not count)');
}

// maxRun
{
  const s = base();
  const r = mk(s, 'maxRun', { codes: ['@shift'], max: 3 });
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06']) put(s, d, 'c1', ['Clinic']);
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) put(s, d, 'c2', ['Clinic']);
  const v = run(s, r);
  eq(v.length, 1);
  eq([v[0].staffId, v[0].penalty, v[0].msg], ['c1', 2000, 'WML: 5 days in a row of any shift from Mon 2 Nov, at most 3']);
  // a run from October into November counts
  for (const d of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']) put(s, d, 'a1', ['Clinic']);
  ok(run(s, r).some(x => x.staffId === 'a1' && x.dates.join() === '2026-11-01'), 'maxRun across months');
}

// requests: day and weekend, want and avoid
{
  const s = base();
  const cr = DEFAULT_RULES.find(r => r.id === 'r-req-cr'), nc = DEFAULT_RULES.find(r => r.id === 'r-req-nc');
  const wr = DEFAULT_RULES.find(r => r.id === 'r-req-wr'), nw = DEFAULT_RULES.find(r => r.id === 'r-req-nw');
  put(s, '2026-11-03', 'r1', [], ['Cr']);
  put(s, '2026-11-04', 'r2', ['C'], ['Cr']);
  put(s, '2026-11-05', 'j1', ['C'], ['Nc']);
  put(s, '2026-11-06', 'm1', [], ['Nc']);
  eq(run(s, cr).map(v => v.msg), ['Tue 3 Nov: AP asked for Call (Cr)'], 'Cr not met');
  eq(run(s, cr)[0].hard, false);
  eq(run(s, nc).map(v => v.msg), ['Thu 5 Nov: LC has Call despite No call (Nc)'], 'Nc broken (hard)');
  eq(run(s, nc)[0].hard, true);
  // weekend: Nw on Saturday, a shift on Sunday breaks it; Wr met by a Sunday shift
  put(s, '2026-11-07', 'c1', [], ['Nw']); put(s, '2026-11-08', 'c1', ['C']);
  put(s, '2026-11-14', 'c2', [], ['Wr']); put(s, '2026-11-15', 'c2', ['C']);
  put(s, '2026-11-21', 'a1', [], ['Wr']); put(s, '2026-11-22', 'a1', [], ['Wr']);   // both days, none given: one violation
  let v = run(s, nw);
  ok(v.length === 1 && v[0].staffId === 'c1' && v[0].penalty === 50 && v[0].dates.join() === '2026-11-08', 'Nw broken on the Sunday');
  v = run(s, wr);
  eq(v.map(x => x.staffId), ['a1'], 'Wr met by c2, not a1 (one report for the weekend)');
  ok(v[0].msg.startsWith('Weekend of Sat 21 Nov: SR asked for any shift'), 'weekend message');
}

// spread (soft only)
{
  const s = base();
  const r = mk(s, 'spread', { codes: ['C'], period: 'month', weekendWeight: 2, holidayWeight: 3, tolerance: 1 }, { who: { groups: ['mo'] }, hard: true, weight: 5 });
  // m1: 4 weekday calls; m2: 2; m3: 2; m4 (fte 0.5): 1 → per fte 2. Mean 2.5, m1 is 1.5 above (0.5 past tolerance)
  for (const d of ['2026-11-02', '2026-11-04', '2026-11-11', '2026-11-18']) put(s, d, 'm1', ['C']);
  for (const d of ['2026-11-03', '2026-11-05']) { put(s, d, 'm2', ['C']); put(s, addD(d, 14), 'm3', ['C']); }
  put(s, '2026-11-24', 'm4', ['C']);
  let v = run(s, r);
  eq(v.length, 1, 'spread flags the outlier');
  ok(v[0].staffId === 'm1' && v[0].hard === false && v[0].penalty === 2.5, 'spread is soft even if marked hard: 5 × 0.5');
  ok(/NA: Call 4 in November 2026 \(weekends and holidays count extra\); group average 2\.5/.test(v[0].msg), 'spread message');
  ok(!v[0].date && v[0].month === '2026-11', 'about the whole month: no date');
  // a weekend call weighs 2, a holiday 3
  put(s, '2026-11-24', 'm4', []); put(s, '2026-11-10', 'm4', ['C']);   // holiday: 3 per 0.5 fte = 6
  v = run(s, r);
  ok(v.some(x => x.staffId === 'm4'), 'holiday weight counts');
}
function addD(d, n) { return M.addDays(d, n); }

// eligible
{
  const s = base();
  const r = DEFAULT_RULES.find(x => x.id === 'r-otc');
  put(s, '2026-11-03', 'c1', ['OTC']); put(s, '2026-11-03', 'r1', ['OTC']);
  eq(run(s, r).map(v => v.msg), ['Tue 3 Nov: AP has OT consultant, only consultants may']);
}

// standing
{
  const s = base();
  s.staff.find(p => p.id === 'c2').tags = ['pain'];
  const r = mk(s, 'standing', { codes: ['APS'] }, { who: { tags: ['pain'] }, when: { from: '2026-11-02', to: '2026-11-06', days: [1, 2, 3, 4, 5] } });
  for (const d of ['2026-11-02', '2026-11-03']) put(s, d, 'c2', ['APS']);
  put(s, '2026-11-04', 'c2', ['AL']);                       // away: fine
  put(s, '2026-11-05', 'c2', ['Clinic']);                   // missing APS
  const v = run(s, r);
  eq(v.map(x => x.date), ['2026-11-05', '2026-11-06'], 'standing: missing on Thu and Fri, leave excused');
  eq(v[0].msg, 'Thu 5 Nov: HF has no Acute pain service');
}

// ---------- describeRule: one per type ----------
{
  const s = base();
  const J = { groups: ['srp', 'rp', 'jr', 'locum', 'mo'] };
  const D = (type, params, o) => describeRule(mk(s, type, params, o), s);
  eq(D('cover', { codes: ['C'], min: 2, max: 2 }, { who: J }), 'Each day: exactly 2 juniors on Call');
  eq(D('cover', { codes: ['P'], min: 1, max: 1 }, { who: J, when: { days: [1, 2, 3, 4, 5], holidays: 'exclude' } }), 'Weekdays except public holidays: exactly 1 junior on PM shift');
  eq(D('cover', { codes: ['@present'], min: 3, max: null }, { who: { groups: ['cons'] } }), 'Each day: at least 3 people from Senior consultants / consultants at work');
  eq(D('limit', { codes: ['C'], period: 'month', max: 7, fte: true }, { who: J }), 'Juniors: at most 7 Call a month (scaled by FTE)');
  eq(D('limit', { codes: ['C'], period: 'rolling', window: 10, min: null, max: 3 }), 'Everyone: at most 3 Call in any 10 days');
  eq(D('limit', { codes: ['C'], period: 'month', max: 2 }, { when: { days: [0, 6] } }), 'Everyone: at most 2 Call a month on weekends');
  eq(D('sequence', { ifCodes: ['C'], thenCodes: ['C'], from: 1, to: 2 }), 'After Call: no Call for the next 2 days');
  eq(D('sequence', { ifCodes: ['C'], thenCodes: ['@leave'], from: 1, to: 1 }), 'After Call: no leave the next day');
  eq(D('sequence', { ifCodes: ['@leave'], thenCodes: ['C'], from: -1, to: -1 }), 'Leave: no Call the day before');
  eq(D('sameDay', { codesA: ['@leave'], codesB: ['@shift'], mode: 'forbid' }), 'Never leave and any shift on the same day');
  eq(D('sameDay', { codesA: ['Creg'], codesB: ['C'], mode: 'require' }), 'Call tag-on only with Call on the same day');
  eq(describeRule(DEFAULT_RULES.find(r => r.id === 'r-baby2'), s), 'Baby MO on Call: never with another Baby MO on Call');
  ok(describeRule(DEFAULT_RULES.find(r => r.id === 'r-baby'), s).startsWith('Baby MO on Call: needs someone from Senior residents'), 'together needs');
  eq(D('maxRun', { codes: ['@shift'], max: 5 }), 'Everyone: at most 5 days in a row of any shift');
  eq(D('requests', { request: 'Nc', codes: ['C'], mode: 'avoid', span: 'day' }), 'No call (Nc): no Call that day');
  eq(D('requests', { request: 'Nw', codes: ['@shift'], mode: 'avoid', span: 'weekend' }), 'No weekend shift (Nw): no shift that weekend');
  eq(D('requests', { request: 'Cr', codes: ['C'], mode: 'want', span: 'day' }), 'Call request (Cr): give Call that day');
  eq(D('spread', { codes: ['C'] }, { who: J }), 'Share Call fairly among juniors (weekends x2, holidays x2)');
  eq(D('eligible', { codes: ['OTC'] }, { who: { groups: ['cons', 'ac', 'ext', 'vc'] } }), 'Only consultants may do OT consultant');
  eq(D('standing', { codes: ['APS'] }, { who: { tags: ['pain'] }, when: { days: [1, 2, 3, 4, 5] } }), 'Pain (APS): Acute pain service every day unless away (weekdays)');
  eq(D('cover', { codes: ['C'], min: 1, max: 1 }, { who: { staff: ['m1'], exclude: [] }, when: { from: '2026-11-03', to: '2026-11-09' } }), '3 Nov to 9 Nov: exactly 1 person from NA on Call');
  eq(D('maxRun', { codes: ['C'], max: 2 }, { who: { groups: ['mo'], exclude: ['m3'] } }), 'Medical officers except Priya Menon: at most 2 days in a row of Call');
  eq(describeRule({ type: 'nope' }, s), 'Unknown rule type "nope"');
}

// ---------- validateRule ----------
{
  const s = base();
  ok(validateRule(newRule('cover', s), s).includes('No codes chosen'), 'no codes');
  eq(validateRule(mk(s, 'cover', { codes: ['C'], min: 3, max: 2 }), s), ['At least is more than at most']);
  eq(validateRule(mk(s, 'cover', { codes: ['C'], min: null, max: null }), s), ['Set at least or at most']);
  eq(validateRule(mk(s, 'cover', { codes: ['ZZ'], min: 1 }), s), ['Unknown code "ZZ"']);
  eq(validateRule(mk(s, 'cover', { codes: ['@present', 'x'], min: 1 }), s), [], 'tokens and x are known');
  ok(validateRule(newRule('sequence', s), s).includes('No codes chosen for If someone has'), 'names the field');
  eq(validateRule(mk(s, 'sequence', { ifCodes: ['C'], thenCodes: ['C'], from: 3, to: 1 }), s), ['From day is after To day']);
  eq(validateRule(mk(s, 'limit', { codes: ['C'], period: 'rolling', window: '' }), s), ['Set how many days in the run']);
  eq(validateRule(mk(s, 'limit', { codes: ['C'], period: 'fortnight' }), s), ['Choose "Per"']);
  eq(validateRule(mk(s, 'requests', { request: 'C' }), s), ['C is not a request code']);
  eq(validateRule(mk(s, 'requests', { request: '' }), s), ['Choose the request code']);
  eq(validateRule(mk(s, 'cover', { codes: ['C'], min: 1 }, { who: { groups: ['nobody'], tags: ['ghost'] } }), s), ['Unknown group "nobody"', 'Unknown tag "ghost"']);
  eq(validateRule(mk(s, 'together', { codes: ['C'], otherCodes: ['C'], other: { groups: ['zz'], tags: [], staff: [], exclude: [] } }), s), ['Unknown group "zz"']);
  eq(validateRule(mk(s, 'maxRun', { codes: ['C'], max: 0 }), s), ['"At most days in a row" must be at least 1', 'At most must be 1 or more']);
  eq(validateRule(mk(s, 'cover', { codes: ['C'], min: 1 }, { hard: false, weight: 0 }), s), ['Weight must be 1 to 100']);
  eq(validateRule(mk(s, 'cover', { codes: ['C'], min: 1 }, { when: { from: '2026-11-09', to: '2026-11-01' } }), s), ['Start date is after end date']);
  eq(validateRule({ type: 'nope' }, s), ['Unknown rule type "nope"']);
  // newRule: fresh ids, hard except soft-only types, requests default to the first request code
  const a = newRule('cover', s), b = newRule('cover', s);
  ok(a.id !== b.id && a.enabled && a.hard && a.weight === 10, 'newRule');
  ok(newRule('spread', s).hard === false, 'spread starts soft');
  eq(newRule('requests', s).params.request, 'Cr');
  assert.throws(() => newRule('nope', s)); checks++;
}

// ---------- evaluate: totals, indexes, disabled rules, opts.rules ----------
{
  const s = base();
  s.rules = [
    mk(s, 'cover', { codes: ['C'], min: 1, max: 1 }, { who: { staff: ['m1', 'm2'] }, when: { from: '2026-11-02', to: '2026-11-02' } }),
    mk(s, 'sameDay', { codesA: ['@leave'], codesB: ['@shift'] }, { hard: false, weight: 7 }),
    { ...mk(s, 'eligible', { codes: ['C'] }, { who: { staff: ['c1'] } }), enabled: false },
  ];
  s.rules[0].id = 'ra'; s.rules[1].id = 'rb'; s.rules[2].id = 'rc';
  put(s, '2026-11-02', 'm1', ['C']); put(s, '2026-11-02', 'm2', ['C']);
  put(s, '2026-11-03', 'm3', ['AL', 'P']);
  const e = evaluate(s, NOV);
  eq([e.hard, e.soft, e.score], [1, 1, 1007]);
  eq(e.violations.length, 2);
  ok(e.byRule.get('ra').length === 1 && e.byRule.get('rb').length === 1 && !e.byRule.has('rc'), 'disabled rule skipped');
  ok(e.byDay.get('2026-11-02').length === 1 && e.byCell.get('2026-11-02|m1').length === 1 && e.byCell.get('2026-11-03|m3').length === 1, 'indexes');
  ok(!e.byCell.has('2026-11-02|m3'), 'byCell only where named');
  // evaluateRule checks a disabled rule (the builder's "check now"); opts.rules overrides state.rules
  eq(evaluateRule(s, s.rules[2], NOV).length, 2, 'evaluateRule ignores enabled');
  eq(evaluate(s, { ...NOV, rules: [s.rules[1]] }).violations.length, 1);
  // a range inside the month reports only those days
  eq(evaluate(s, { from: '2026-11-03', to: '2026-11-03' }).violations.map(v => v.ruleId), ['rb']);
  // broken rules are skipped, not thrown
  s.rules.push({ id: 'bad', type: 'cover', params: { codes: [] } }, { id: 'bad2', type: 'nope' });
  eq(evaluate(s, NOV).violations.length, 2, 'rules with no codes or unknown types are skipped');
}

// ---------- review fixes (Oct 2026) ----------
{
  // one extra duty over a rolling limit costs one unit, however many windows it sits in
  const s = base();
  for (let k = 0; k < 4; k++) put(s, M.addDays('2026-11-10', k), 'm3', ['P']);
  const r = mk(s, 'limit', { codes: ['P'], period: 'rolling', window: 14, min: null, max: 3 }, { hard: false, weight: 100 });
  const v = run(s, r);
  eq(v.length, 1, 'one message for a run of over-full windows');
  eq(v[0].penalty, 100, 'one extra P costs one unit, not one per window');
  eq(evaluate(s, { ...NOV, rules: [r] }).score, 100);
}
{
  // "never together": the pair counts whatever the staff order
  const s = base();
  s.tags.push({ id: 'oncall', name: 'On call' });
  put(s, '2026-11-03', 'm1', ['C']); put(s, '2026-11-03', 'm2', ['P']);
  const r = mk(s, 'together', { codes: ['@shift'], other: { groups: [], tags: ['babymo'], staff: [], exclude: [] }, otherCodes: ['C'], mode: 'never' }, { who: { tags: ['babymo'] } });
  eq(run(s, r).length, 1, 'any shift never with a Baby MO on Call');
  s.staff.reverse();
  eq(run(s, r).length, 1, 'same in the other staff order');
  put(s, '2026-11-03', 'm2', ['C']);
  eq(run(s, r).length, 1, 'both on C: counted once');
}
{
  // rules that reach further back than 7 days see last month
  const s = base();
  for (const d of M.monthDays('2026-11')) put(s, d, 'm3', ['C']);
  eq(run(s, mk(s, 'limit', { codes: ['C'], period: 'rolling', window: 60, min: null, max: 8 })).length, 1, 'a 60-day window is checked');
  const t = base();
  put(t, '2026-10-22', 'm3', ['AL']); put(t, '2026-11-02', 'm3', ['C']);
  eq(run(t, mk(t, 'sequence', { ifCodes: ['@leave'], thenCodes: ['C'], mode: 'forbid', from: 1, to: 14 })).length, 1, 'offset 11 across the month edge');
  const u = base();
  for (let k = 0; k < 14; k++) put(u, M.addDays('2026-10-20', k), 'm3', ['APS']);
  eq(run(u, mk(u, 'maxRun', { codes: ['APS'], max: 12 })).length, 1, 'a run that started 12 days before the month');
}
{
  // a call on the last day before a clinic already planned for the next day
  const s = base();
  put(s, '2026-11-30', 'c1', ['C']); put(s, '2026-12-01', 'c1', ['Clinic']);
  const r = mk(s, 'sameDay', { codesA: ['x'], codesB: ['@shift'], mode: 'forbid' });
  const v = run(s, r);
  eq(v.length, 1, 'post call on 1 Dec is November\'s problem too');
  eq(v[0].date, '2026-11-30', 'shown on the call');
  put(s, '2026-12-01', 'c2', ['AL', 'Clinic']);
  eq(run(s, mk(s, 'sameDay', { codesA: ['@leave'], codesB: ['@shift'], mode: 'forbid' })).length, 0, 'other clashes on the next day are next month\'s');
}
{
  // a weekend request on Sat 31 Oct covers Sun 1 Nov
  const s = base();
  put(s, '2026-10-31', 'm3', [], ['Nw']); put(s, '2026-11-01', 'm3', ['C']);
  const r = mk(s, 'requests', { request: 'Nw', codes: ['@shift'], mode: 'avoid', span: 'weekend' });
  const v = run(s, r);
  eq(v.length, 1, 'weekend straddling the month start');
  eq(v[0].date, '2026-11-01');
  eq(run(s, r, { from: '2026-10-01', to: '2026-10-31' }).length, 0, 'October has no duty that weekend');
}
{
  // day-after rule from 0: the same day counts (two different codes)
  const s = base();
  put(s, '2026-11-05', 'm3', ['C', 'AL']);
  eq(run(s, mk(s, 'sequence', { ifCodes: ['C'], thenCodes: ['@leave'], mode: 'forbid', from: 0, to: 0 })).length, 1);
  eq(run(s, mk(s, 'sequence', { ifCodes: ['@shift'], thenCodes: ['@shift'], mode: 'forbid', from: 0, to: 0 })).length, 0, 'a code never clashes with itself');
}
{
  // periods straddling the range: last month's excess and next month's empty days
  const s = base();
  for (const d of ['2026-10-29', '2026-10-30', '2026-10-31']) put(s, d, 'm3', ['C']);
  eq(evaluate(s, { ...NOV, rules: [mk(s, 'limit', { codes: ['C'], period: 'week', max: 2 })] }).hard, 0, 'last week of October is October\'s problem');
  eq(evaluate(s, { ...NOV, rules: [mk(s, 'limit', { codes: ['C'], period: 'rolling', window: 7, max: 2 })] }).hard, 0, 'rolling: same');
  put(s, '2026-11-01', 'm3', ['C']);
  eq(evaluate(s, { ...NOV, rules: [mk(s, 'limit', { codes: ['C'], period: 'week', max: 2 })] }).hard, 1, 'a November call on top of it counts');
  const t = base();
  for (const d of ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']) put(t, d, 'm3', ['P']);
  eq(evaluate(t, { ...NOV, rules: [mk(t, 'limit', { codes: ['P'], period: 'rolling', window: 7, min: 1, max: null }, { who: { staff: ['m3'] } })] }).violations.length, 0, 'no minimum forced onto the 30th');
}
{
  // malformed imported rules don't break the check
  const s = base();
  put(s, '2026-11-03', 'm3', ['C']); put(s, '2026-11-03', 'm4', ['C']);
  const good = mk(s, 'cover', { codes: ['C'], min: null, max: 1 });
  s.rules = [good, { id: 'w1', type: 'limit', who: { groups: null, exclude: null }, params: { codes: ['C'], max: 0 } }, { id: 'w2', type: 'cover', when: { days: '0,6' }, params: { codes: ['C'], min: 5 } }];
  const e = evaluate(s, NOV);
  ok(e.violations.some(v => v.ruleId === good.id), 'the good rule still runs');
  ok(e.violations.some(v => v.ruleId === 'w1'), 'groups: null means everyone');
  ok(e.violations.some(v => v.ruleId === 'w2' && M.isWeekend(v.date)), 'days "0,6" means weekends');
  eq(e.failed, []);
}
{
  // share fairly: a holiday on a weekend counts at least the weekend weight
  const s = base();
  s.settings.holidays = { '2026-11-08': 'Made-up holiday' };
  put(s, '2026-11-08', 'm1', ['C']); put(s, '2026-11-15', 'm2', ['C']);
  const r = mk(s, 'spread', { codes: ['C'], weekendWeight: 3, holidayWeight: 2, tolerance: 0 }, { who: { staff: ['m1', 'm2'] }, hard: false });
  eq(run(s, r).length, 0, 'Sunday holiday and ordinary Sunday weigh the same');
}

// ---------- speed: 80 staff × 31 days × 20+ rules in < 50 ms ----------
{
  const s = M.defaultState();
  s.settings.holidays = { '2026-12-25': 'Christmas Day' };
  const groups = ['cons', 'ac', 'ext', 'vc', 'sr', 'srp', 'rp', 'jr', 'locum', 'mo'];
  for (let i = 0; i < 80; i++) s.staff.push(P(`p${i}`, `Person ${i}`, `P${i}`, groups[i % 10], { tags: i % 10 === 9 && i < 30 ? ['babymo'] : [] }));
  const days = M.monthDays('2026-12');
  const codes = ['C', 'P', 'AL', 'Clinic', '', '', '', 'x', 'OTC'];
  days.forEach((d, di) => s.staff.forEach((p, pi) => { const c = codes[(di * 7 + pi * 3) % codes.length]; if (c && c !== 'x') put(s, d, p.id, [c], (di + pi) % 13 === 0 ? ['Nc'] : []); }));
  s.rules.push(mk(s, 'maxRun', { codes: ['@shift'], max: 5 }), mk(s, 'standing', { codes: ['APS'] }, { who: { tags: ['pain'] } }));
  ok(s.rules.length >= 20, '20+ rules');
  const range = { from: days[0], to: days[days.length - 1] };
  evaluate(s, range); evaluate(s, range);   // warm up
  const times = [];
  let e;
  for (let k = 0; k < 7; k++) { const t = performance.now(); e = evaluate(s, range); times.push(performance.now() - t); }
  times.sort((a, b) => a - b);
  const med = times[3];
  ok(e.violations.length > 100, 'a busy month has violations to report');
  ok(med < 50, `evaluate a month in < 50 ms (median ${med.toFixed(1)} ms)`);
  console.log(`  evaluate: 80 staff × 31 days × ${s.rules.length} rules, median ${med.toFixed(1)} ms, ${e.violations.length} violations`);
}

console.log(`rules tests: ${checks} checks passed`);
