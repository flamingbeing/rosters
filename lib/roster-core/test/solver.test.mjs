// The core solver in the NTF roster's flavour gives exactly what that app's own solver.js gives (read here, never
// changed), so the app can switch to the core later with the differences already options. Made-up demo data only.
// Run: node lib/roster-core/test/solver.test.mjs
import assert from 'node:assert/strict';
import { createSolver } from '../solver.js';
import * as M from '../../../ntf-roster/js/model.js';
import * as R from '../../../ntf-roster/js/rules.js';
import * as Own from '../../../ntf-roster/js/solver.js';
import { demoState } from '../../../ntf-roster/js/demo.js';

const core = createSolver(
  { getCell: M.getCell, setCell: M.setCell, buildContext: R.buildContext, compileRules: R.compileRules, compileWho: R.compileWho, refresh: R.refresh, evaluate: R.evaluate },
  { fillOption: 'codes', keepOtherAuto: true, reach: 1, needBlocks: false },
);
const state = demoState('2026-11-15');
const dd = M.monthDays(M.monthOf('2026-11-15'));
const range = { from: dd[0], to: dd[dd.length - 1] };
const autoCodes = (state.duties || []).filter(d => d.auto && d.kind === 'shift').map(d => d.code);
let n = 0;
for (const opts of [{ seed: 1 }, { seed: 4 }, ...(autoCodes.length > 1 ? [{ seed: 2, codes: [autoCodes[0]] }] : [])]) {
  const a = Own.solve(state, { ...range, timeMs: 600000, ...opts }), b = core.solve(state, { ...range, timeMs: 600000, ...opts });
  for (const r of [a, b]) delete r.ms;
  assert.deepEqual(b, a, `core (NTF flavour) differs from ntf-roster/js/solver.js for ${JSON.stringify(opts)}`); n++;
  const sa = JSON.stringify(Own.withAssignments(state, a.assignments, a.codes).cells), sb = JSON.stringify(core.withAssignments(state, b.assignments, b.codes).cells);
  assert.equal(sb, sa, 'withAssignments differs'); n++;
  assert.deepEqual(core.diffAssignments(state, b.assignments), Own.diffAssignments(state, a.assignments)); n++;
}
console.log(`roster-core solver: ${n} checks passed (NTF flavour identical to ntf-roster's own)`);
