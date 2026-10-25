// Characterisation of auto-fill on fixed inputs (made-up demo data): the app's solve() must give the same assignments,
// scores and unfilled list as the pins in solver-pins.json, whichever file holds the solver.
// Run: node ntf-roster/test/solver-pins.test.mjs          (--write re-records the pins; only when a change is meant)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as M from '../js/model.js';
import { solve, withAssignments, diffAssignments } from '../js/solver.js';
import { demoState } from '../js/demo.js';

const state = demoState('2026-11-15');
const dd = M.monthDays(M.monthOf('2026-11-15'));
const range = { from: dd[0], to: dd[dd.length - 1] };
const codes = (state.duties || []).filter(d => d.auto && d.kind === 'shift').map(d => d.code);
const CASES = {
  seed1: { seed: 1 }, seed4: { seed: 4 },
  ...Object.fromEntries(codes.slice(0, 3).map(c => ['codes_' + c, { seed: 2, codes: [c] }])),
};
const h = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const got = {};
// a long time limit: the search must end on its iteration budget, so the answer does not depend on how fast the device is
for (const [name, o] of Object.entries(CASES)) {
  const r = solve(state, { ...range, timeMs: 600000, ...o });
  got[name] = { assignments: h(r.assignments), before: r.before, after: r.after, unfilled: r.unfilled, iterations: r.iterations, codes: r.codes,
    applied: h(withAssignments(state, r.assignments, r.codes).cells), diff: diffAssignments(state, r.assignments) };
}
const file = new URL('./solver-pins.json', import.meta.url);
if (process.argv.includes('--write')) { fs.writeFileSync(file, JSON.stringify(got, null, 1) + '\n'); console.log('pins written:', Object.keys(got).join(', ')); }
else {
  const want = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(got).sort(), Object.keys(want).sort());
  for (const name of Object.keys(want)) assert.deepEqual(got[name], want[name], `auto-fill output changed for "${name}"`);
  console.log(`ntf-roster solver-pins: ${Object.keys(want).length} cases identical`);
}
