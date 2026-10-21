// NUH Junior Monthly: runs the solver off the main thread (module worker).
//   const w = new Worker(new URL('./solver-worker.js', import.meta.url), { type: 'module' });
//   w.postMessage({ type: 'solve', state, opts: { from, to, seed, timeMs } });
// Replies: { type: 'progress', best: { hard, soft }, pct } (at most ~10 a second),
//          { type: 'done', result } or { type: 'error', message }.

import { solve } from './solver.js';

self.onmessage = e => {
  const { type, state, opts } = e.data || {};
  if (type !== 'solve') return;
  try {
    let last = 0;
    const onProgress = p => {
      const t = Date.now();
      if (p.pct < 100 && t - last < 100) return;
      last = t;
      self.postMessage({ type: 'progress', best: p.best, pct: p.pct });
    };
    const result = solve(state, { ...(opts || {}), onProgress });
    self.postMessage({ type: 'done', result });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
