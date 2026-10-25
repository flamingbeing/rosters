// Characterisation of the rule engine and the model helpers on fixed inputs (made-up demo data): the app's rules.js
// and model.js must give the same rule list, words, checks and cell helpers as the pins in core-pins.json, whichever
// file holds the code (the app's own or the roster core's, lib/roster-core/).
// Run: node ntf-roster/test/core-pins.test.mjs          (--write re-records the pins; only when a change is meant)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as M from '../js/model.js';
import * as R from '../js/rules.js';
import { solve, withAssignments } from '../js/solver.js';
import { demoState } from '../js/demo.js';

const h = x => crypto.createHash('sha256').update(JSON.stringify(x, (k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))).digest('hex').slice(0, 16);
const TODAY = '2026-11-15';
const demo = demoState(TODAY);
const month = M.monthOf(TODAY), next = M.addMonths(month, 1);
const span = m => { const d = M.monthDays(m); return { from: d[0], to: d[d.length - 1] }; };
const filled = (() => { const r = solve(demo, { ...span(next), seed: 3, timeMs: 600000 }); return withAssignments(demo, r.assignments, r.codes); })();
const shifts = (demo.duties || []).filter(d => d.kind === 'shift').map(d => d.code);
const others = (demo.duties || []).filter(d => d.kind !== 'shift').map(d => d.code);
const strip = r => { const { id, ...rest } = r; return rest; };   // newRule ids are random

// every rule type, with its code lists filled in (so each one compiles and checks something)
function sampleRules(state) {
  const out = [];
  for (const type of Object.keys(R.RULE_TYPES)) {
    const r = R.newRule(type, state);
    r.id = 'pin-' + type;
    for (const spec of R.RULE_TYPES[type].params) {
      if (spec.kind === 'codes') r.params[spec.key] = spec.key === 'among' ? [] : shifts.slice(0, 3);
      else if (spec.kind === 'code' && !r.params[spec.key]) r.params[spec.key] = others[0] || shifts[0];
    }
    out.push(r);
    out.push({ ...r, id: 'pin-' + type + '-soft', hard: false, weight: 7, who: { ...R.normalizeWho(r.who), groups: [(state.groups || [])[0]?.id].filter(Boolean) } });
  }
  return out;
}

const got = {};
// the rule list itself: types, their fields and defaults, the words for a fresh rule
got.F = R.F;
got.types = Object.fromEntries(Object.entries(R.RULE_TYPES).map(([k, t]) => [k, {
  label: t.label, icon: t.icon, scope: t.scope, help: t.help, example: t.example, soft_only: !!t.soft_only,
  params: h(t.params), defaults: t.defaults(), fresh: h(strip(R.newRule(k, demo))), words: R.describeRule(R.newRule(k, demo), demo),
}]));
// each rule of the app's defaults and the demo, and the sample rules: words, problems, normal form, reach
const allRules = [...M.DEFAULT_RULES, ...(demo.rules || []), ...sampleRules(demo)];
got.rules = allRules.map(r => ({ id: r.id, words: R.describeRule(r, demo), invalid: R.validateRule(r, demo), norm: h(R.normalizeRule(r)) }));
got.reach = [R.ruleReach(M.DEFAULT_RULES), R.ruleReach(demo.rules), R.ruleReach(sampleRules(demo))];
// checks: whole months, with the demo's own rules and with every sample rule
const ev = (s, o) => { const e = R.evaluate(s, o); return { n: e.violations.length, hard: e.hard, soft: e.soft, score: e.score, failed: e.failed, v: h(e.violations), first: e.violations.slice(0, 3).map(v => v.msg) }; };
got.evaluate = {
  demoThis: ev(demo, span(month)), demoNext: ev(demo, span(next)), filledNext: ev(filled, span(next)),
  samplesThis: ev(demo, { ...span(month), rules: sampleRules(demo) }), samplesFilled: ev(filled, { ...span(next), rules: sampleRules(demo) }),
  week: ev(filled, { from: M.addDays(span(next).from, 3), to: M.addDays(span(next).from, 9) }),
};
got.evaluateRule = Object.fromEntries(sampleRules(filled).map(r => [r.id, h(R.evaluateRule(filled, r, span(next)))]));
if (R.carryBalances) got.carry = h(R.carryBalances(filled, M.addMonths(next, 1), { codes: shifts.slice(0, 2), among: others.slice(0, 3), carryMonths: 4 }));
if (R.dayOffWeight) got.dayOff = [R.dayOffWeight(false, false), R.dayOffWeight(true, false), R.dayOffWeight(false, true, 1, 0.25)];

// model helpers
const dates = ['2026-01-01', '2026-02-28', '2026-03-01', '2024-02-29', '2026-12-31', '2026-11-08'];
got.dates = dates.map(s => [M.addDays(s, 1), M.addDays(s, -1), M.addDays(s, 40), M.weekday(s), M.isWeekend(s), M.isHoliday(demo, s), M.holidayName(demo, s), M.fmtDay(s), M.monthOf(s), M.iso(M.parseISO(s))]);
got.months = ['2026-01', '2026-02', '2024-02', '2026-12'].map(m => [M.monthDays(m).length, M.monthDays(m)[0], M.addMonths(m, 1), M.addMonths(m, -13), M.fmtMonth(m)]);
got.lookups = [h(M.dutyMap(demo)), h(M.groupMap(demo)), h(M.staffMap(demo)), M.TOKENS];
got.staffInMonth = [month, next].map(m => h(M.staffInMonth(demo, m)));
got.active = (demo.staff || []).slice(0, 8).map(p => [M.staffActiveOn(p, span(month).from), M.staffActiveOn(p, '2030-01-01')]);
const codeLists = [...M.TOKENS.map(t => [t]), ['x'], ['PPC'], shifts.slice(0, 2), others.slice(0, 2), [...shifts.slice(0, 1), '@leave']];
got.expand = codeLists.map(l => [...M.expandTokens(demo, l)].sort());
{
  const per = [];
  for (const d of M.monthDays(next)) for (const p of (filled.staff || []).slice(0, 12)) {
    per.push([M.getCell(filled, d, p.id), M.effectiveCodes(filled, d, p.id), codeLists.map(l => M.matchesCodes(filled, d, p.id, l))]);
  }
  got.cells = { n: per.length, h: h(per) };
}
{
  const s = M.defaultState(), d = '2026-12-01';
  s.staff.push({ id: 'p1', name: 'Pat Example', group: (s.groups || [])[0]?.id, tags: [], fte: 1, active: true });
  const steps = [{ a: [shifts[0]] }, { r: [others[0]] }, { a: [], r: [] }, { a: [shifts[0], shifts[1]], n: 'note' }, { a: [shifts[0]], ap: true, rp: { [others[0]]: '!' }, r: [others[0]] }];
  got.setCell = steps.map(p => { M.setCell(s, d, 'p1', p); return JSON.stringify((s.cells || {})[d] || null); });
}
got.clean = { duties: h((demo.duties || []).map(M.cleanDuty)), rules: h(allRules.map(M.cleanRule)), defaults: h(M.defaultState()), migrated: h(M.migrate(JSON.parse(JSON.stringify(demo)))) };

const file = new URL('./core-pins.json', import.meta.url);
if (process.argv.includes('--write')) { fs.writeFileSync(file, JSON.stringify(got, null, 1) + '\n'); console.log('pins written:', Object.keys(got).join(', ')); }
else {
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  for (const k of Object.keys(want)) assert.deepEqual(JSON.parse(JSON.stringify(got[k])), want[k], `rules/model output changed for "${k}"`);
  console.log(`ntf-roster core-pins: ${Object.keys(want).length} groups identical`);
}
