// NTF Roster: auto-fill. The engine is the roster core's (lib/roster-core/solver.js, one copy for the roster apps; how it
// works is written there and in SPEC.md "Solver"); this file gives it this app's model and rules. Pure functions, no DOM,
// run in a Web Worker by solver-worker.js. Extra exports for the UI: applyAssignments, withAssignments, diffAssignments.
import { createSolver } from '../../lib/roster-core/solver.js';   // /lib/ is the shared folder on every host (worker/routes.js SHARED)
import { getCell, setCell } from './model.js';
import { buildContext, compileRules, compileWho, refresh, evaluate } from './rules.js';

// This app's flavour: the option is `codes` (earlier auto codes of the other codes stay in the cell), one day of re-derive
// after a change, and no up-front "needs the same day" / "no calls until" blocks (this app has no such rules).
export const { solve, applyAssignments, withAssignments, diffAssignments } = createSolver(
  { getCell, setCell, buildContext, compileRules, compileWho, refresh, evaluate },
  { fillOption: 'codes', keepOtherAuto: true, reach: 1, needBlocks: false },
);
