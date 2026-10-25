// NUH Junior Monthly: auto-fill. The engine is the roster core's (lib/roster-core/solver.js, one copy for the roster
// apps; how it works is written there); this file gives it this app's model and rules. Pure functions, no DOM, run in a
// Web Worker by solver-worker.js. Extra exports for the UI: applyAssignments, withAssignments, diffAssignments.
import { createSolver } from '../../lib/roster-core/solver.js';   // /lib/ is the shared folder on every host (worker/routes.js SHARED)
import { getCell, setCell } from './model.js';
import { buildContext, compileRules, compileWho, refresh, evaluate } from './rules.js';

export const { solve, applyAssignments, withAssignments, diffAssignments } = createSolver(
  { getCell, setCell, buildContext, compileRules, compileWho, refresh, evaluate },
  { fillOption: 'only', reach: 2, needBlocks: true },
);
