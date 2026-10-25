// Characterisation of auto-fill on fixed inputs (made-up names only): the app's solve() must give the same
// assignments, scores and unfilled list as the pins in solver-pins.json, whichever file holds the solver.
// Run: node nuh-junior-monthly/test/solver-pins.test.mjs          (--write re-records the pins; only when a change is meant)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as M from '../js/model.js';
import { solve } from '../js/solver.js';
import { demoState } from '../js/demo.js';

const MONTH = '2026-12', days = M.monthDays(MONTH);
const range = { from: days[0], to: days[days.length - 1] };
const person = (s, id, group, n) => s.staff.push({ id, name: n + ' ' + id, group, tags: [], fte: 1, active: true });
function team() {
  const s = M.defaultState();
  s.rules = s.rules.filter(r => !/^r-(c3|r1b)-(fair|sat)$/.test(r.id) && r.id !== 'r-r1b-d1');
  for (let k = 0; k < 6; k++) person(s, 'i' + k, 'res2', 'Icu Person');
  for (let k = 0; k < 4; k++) person(s, 'c' + k, 'nhg', 'Cardiac Person');
  for (const d of [M.addDays(days[0], -2), M.addDays(days[0], -1), ...days]) {
    for (let k = 0; k < 6; k++) M.setCell(s, d, 'i' + k, { a: ['ICU'] });
    for (let k = 0; k < 4; k++) M.setCell(s, d, 'c' + k, { a: ['C'] });
  }
  return s;
}
const eod = () => {
  const s = M.defaultState(); s.rules = s.rules.filter(r => !/^r-c3/.test(r.id));
  for (let k = 0; k < 2; k++) person(s, 'e' + k, 'res2', 'Eod Person');
  for (const d of [-3, -2, -1].map(n => M.addDays(days[0], n)).concat(days)) for (let k = 0; k < 2; k++) M.setCell(s, d, 'e' + k, { a: ['ICU'] });
  return s;
};
const rotation = () => {
  const s = M.defaultState(); s.rules = s.rules.filter(r => !/^r-c3/.test(r.id));
  for (let k = 0; k < 4; k++) person(s, 'n' + k, 'res2', 'New Person');
  for (const d of days) for (let k = 0; k < 4; k++) M.setCell(s, d, 'n' + k, { a: ['ICU'] });
  return s;
};
const until = () => { const s = team(); s.staff.find(x => x.id === 'i0').noCallsUntil = days[10]; return s; };
const demo = () => demoState('2026-11-15');
const demoRange = () => { const m = M.monthOf('2026-11-15'), dd = M.monthDays(m); return { from: dd[0], to: dd[dd.length - 1] }; };

const CASES = {
  team: () => [team(), { ...range, seed: 1 }],
  teamSeed9: () => [team(), { ...range, seed: 9 }],
  eod: () => [eod(), { ...range, seed: 1 }],
  rotation: () => [rotation(), { ...range, seed: 1 }],
  noCallsUntil: () => [until(), { ...range, seed: 5 }],
  onlyC3: () => [team(), { ...range, seed: 3, only: ['C3'] }],
  onlyR1B: () => [team(), { ...range, seed: 3, only: ['R1B'] }],
  demo: () => [demo(), { ...demoRange(), seed: 7 }],
};

const digest = r => ({
  assignments: crypto.createHash('sha256').update(JSON.stringify(r.assignments)).digest('hex').slice(0, 16),
  placed: Object.values(r.assignments).reduce((n, row) => n + Object.values(row).reduce((m, c) => m + c.length, 0), 0),
  before: r.before, after: r.after, unfilled: r.unfilled, iterations: r.iterations,
});
const got = {};
// a long time limit: the search must end on its iteration budget, so the answer does not depend on how fast the device is
for (const [name, make] of Object.entries(CASES)) { const [s, o] = make(); got[name] = digest(solve(s, { ...o, timeMs: 600000 })); }

const file = new URL('./solver-pins.json', import.meta.url);
if (process.argv.includes('--write')) { fs.writeFileSync(file, JSON.stringify(got, null, 1) + '\n'); console.log('pins written:', Object.keys(got).join(', ')); }
else {
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const name of Object.keys(want)) assert.deepEqual(got[name], want[name], `auto-fill output changed for "${name}"`);
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  console.log(`solver-pins: ${Object.keys(want).length} cases identical`);
}
