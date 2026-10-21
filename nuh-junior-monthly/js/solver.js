// NUH Junior Monthly: auto-fill. A pure function (no DOM), run in a Web Worker by solver-worker.js.
//
// How it works (SPEC.md "Solver"):
//   1. Clear the solver's own earlier codes in the range (codes listed in a cell's `auto`), keep everything else:
//      locked cells, manual codes, leave, requests. Only duties with `auto: true` are ever placed, at most one per
//      person per day, and never in a cell that already holds a manual auto-kind duty.
//   2. Demand comes from the enabled `cover` rules on auto codes (their minimum). `standing` rules and `limit` rules
//      with a minimum on an auto code add their people to the candidates, and the search may add that duty for them.
//   3. Greedy construction: hardest slots first (fewest candidates for the need), each filled by the candidate whose
//      placement lowers the total penalty most.
//   4. Local search with simulated annealing: move a duty to someone else, swap two people's days, swap two duties
//      on one day, move one person's duty to another day, add or drop one. Scoring is incremental: a change re-checks
//      only the touched person (person rules), the touched days (day rules) and the fairness sums (global rules).
//   5. Back to the best roster found, then drop any duty that no rule needs (no stray shifts).
//   Deterministic for a seed: own PRNG, and the search length is an iteration budget that ends early once the search
//   has converged (the time limit only cuts it short on a slow device). Extra exports for the UI: applyAssignments,
//   withAssignments, diffAssignments.

import { getCell, setCell } from './model.js';
import { buildContext, compileRules, compileWho, refresh, evaluate } from './rules.js';

const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

// mulberry32: small, fast, seedable
function prng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function solve(state, opts = {}) {
  const t0 = now();
  const { from, to } = opts;
  if (!from || !to) throw new Error('solve needs from and to');
  const seed = opts.seed ?? 1, timeMs = opts.timeMs ?? 6000, onProgress = opts.onProgress;
  const rng = prng(Math.imul(seed, 2654435761) ^ 0x9e3779b9);
  const rules = (state.rules || []).filter(r => r && r.enabled !== false);
  const beforeEv = evaluate(state, { from, to, rules });

  // ----- grid: fixed codes per cell, the auto code (index into autoCodes, 0 = none) -----
  const ctx = buildContext(state, { from, to, rules });
  const { n, P, lo, hi, act } = ctx;
  const dm = ctx.dm;
  // opts.only: fill just these codes; every other call stays as it is but still counts for the rules (post call, spacing, cover…)
  const autoCodes = (state.duties || []).filter(d => d.auto && d.kind === 'shift' && (!Array.isArray(opts.only) || opts.only.includes(d.code))).map(d => d.code);
  const autoSet = new Set(autoCodes);
  const K = autoCodes.length;
  const fixed = ctx.codes.slice();
  const free = new Uint8Array(P * n);
  const grid = new Int16Array(P * n);
  for (let p = 0; p < P; p++) {
    const id = ctx.people[p].id;
    for (let d = lo; d <= hi; d++) {
      const i = p * n + d;
      const cell = getCell(state, ctx.days[d], id);
      const locked = !!(cell && cell.lock);
      if (cell && !locked) {
        const au = cell.auto || [], a = Array.isArray(cell.a) ? cell.a : [];
        fixed[i] = au.length ? a.filter(c => !(au.includes(c) && autoSet.has(c))) : a;
        ctx.codes[i] = fixed[i];
      }
      free[i] = !locked && act[i] && !fixed[i].some(c => autoSet.has(c)) ? 1 : 0;
    }
    for (let d = lo; d <= Math.min(hi + 2, n - 1); d++) refresh(ctx, p * n + d);
  }

  // ----- rules and score caches -----
  const compiled = compileRules(ctx, rules);
  const dayR = [], perR = [], gloR = [];
  compiled.forEach(cr => { if (cr.day) dayR.push(cr); if (cr.person) perR.push(cr); if (cr.global) gloR.push(cr); });
  const dayPen = dayR.map(() => new Float64Array(n)), dayCnt = dayR.map(() => new Int32Array(n));
  const perPen = perR.map(() => new Float64Array(P)), perCnt = perR.map(() => new Int32Array(P));
  const gloPen = new Float64Array(gloR.length), gloCnt = new Int32Array(gloR.length);
  let hardPen = 0, softPen = 0, hardCnt = 0, softCnt = 0;
  const addTotals = (hard, dp, dc) => { if (hard) { hardPen += dp; hardCnt += dc; } else { softPen += dp; softCnt += dc; } };
  dayR.forEach((cr, c) => { for (let d = lo; d <= hi; d++) { ctx.n2 = 0; const v = cr.day(d, null); dayPen[c][d] = v; dayCnt[c][d] = ctx.n2; addTotals(cr.hard, v, ctx.n2); } });
  perR.forEach((cr, c) => { for (let p = 0; p < P; p++) { ctx.n2 = 0; const v = cr.person(p, null); perPen[c][p] = v; perCnt[c][p] = ctx.n2; addTotals(cr.hard, v, ctx.n2); } });
  gloR.forEach((cr, c) => { if (cr.init) cr.init(); ctx.n2 = 0; const v = cr.global(null); gloPen[c] = v; gloCnt[c] = ctx.n2; addTotals(cr.hard, v, ctx.n2); });
  const total = () => hardPen + softPen;
  // Hard problems always come first: a move's cost is its hard change scaled far above any soft change, so no
  // amount of soft penalty (a soft rule can add up past one hard unit) ever buys a hard problem. The two parts are
  // kept apart and only combined as a difference, so the scaling never swamps the soft detail.
  const HARD_SCALE = 1e6;

  // ----- incremental changes -----
  const assigned = [];                       // cell indices holding an auto code
  const pos = new Int32Array(P * n).fill(-1);
  function setGrid(i, k) {
    const old = grid[i];
    if (old === k) return old;
    grid[i] = k;
    ctx.codes[i] = k ? fixed[i].concat(autoCodes[k - 1]) : fixed[i];
    refresh(ctx, i);
    if ((i % n) + 1 < n) refresh(ctx, i + 1);
    if ((i % n) + 2 < n) refresh(ctx, i + 2);
    if (!old && k) { pos[i] = assigned.length; assigned.push(i); }
    else if (old && !k) { const j = pos[i], last = assigned.pop(); if (last !== i) { assigned[j] = last; pos[last] = j; } pos[i] = -1; }
    return old;
  }
  let moveLog = [], undoLog = [], dDays = [], dPeople = [];
  function apply(changes) {
    moveLog = []; undoLog = []; dDays = []; dPeople = [];
    const h0 = hardPen, s0 = softPen;
    for (const [i, k] of changes) {
      moveLog.push(i, setGrid(i, k));
      const p = (i / n) | 0, d = i % n;
      if (!dPeople.includes(p)) dPeople.push(p);
      if (!dDays.includes(d)) dDays.push(d);
      if (d + 1 <= hi && !dDays.includes(d + 1)) dDays.push(d + 1);
    }
    for (let c = 0; c < dayR.length; c++) {
      const cr = dayR[c];
      for (const d of dDays) {
        if (d < lo || d > hi) continue;
        ctx.n2 = 0;
        const v = cr.day(d, null), oldV = dayPen[c][d], oldC = dayCnt[c][d];
        if (v === oldV && ctx.n2 === oldC) continue;
        undoLog.push(0, c, d, oldV, oldC);
        dayPen[c][d] = v; dayCnt[c][d] = ctx.n2; addTotals(cr.hard, v - oldV, ctx.n2 - oldC);
      }
    }
    for (let c = 0; c < perR.length; c++) {
      const cr = perR[c];
      for (const p of dPeople) {
        ctx.n2 = 0;
        const v = cr.person(p, null), oldV = perPen[c][p], oldC = perCnt[c][p];
        if (v === oldV && ctx.n2 === oldC) continue;
        undoLog.push(1, c, p, oldV, oldC);
        perPen[c][p] = v; perCnt[c][p] = ctx.n2; addTotals(cr.hard, v - oldV, ctx.n2 - oldC);
      }
    }
    for (let c = 0; c < gloR.length; c++) {
      const cr = gloR[c];
      if (cr.touch) for (const p of dPeople) cr.touch(p);
      ctx.n2 = 0;
      const v = cr.global(null), oldV = gloPen[c], oldC = gloCnt[c];
      if (v === oldV && ctx.n2 === oldC) continue;
      undoLog.push(2, c, 0, oldV, oldC);
      gloPen[c] = v; gloCnt[c] = ctx.n2; addTotals(cr.hard, v - oldV, ctx.n2 - oldC);
    }
    return (hardPen - h0) * HARD_SCALE + (softPen - s0);
  }
  function revert() {
    for (let x = moveLog.length - 2; x >= 0; x -= 2) setGrid(moveLog[x], moveLog[x + 1]);
    for (const cr of gloR) if (cr.touch) for (const p of dPeople) cr.touch(p);
    for (let x = undoLog.length - 5; x >= 0; x -= 5) {
      const kind = undoLog[x], c = undoLog[x + 1], key = undoLog[x + 2], oldV = undoLog[x + 3], oldC = undoLog[x + 4];
      if (kind === 0) { addTotals(dayR[c].hard, oldV - dayPen[c][key], oldC - dayCnt[c][key]); dayPen[c][key] = oldV; dayCnt[c][key] = oldC; }
      else if (kind === 1) { addTotals(perR[c].hard, oldV - perPen[c][key], oldC - perCnt[c][key]); perPen[c][key] = oldV; perCnt[c][key] = oldC; }
      else { addTotals(gloR[c].hard, oldV - gloPen[c], oldC - gloCnt[c]); gloPen[c] = oldV; gloCnt[c] = oldC; }
    }
    moveLog = []; undoLog = [];
  }

  // ----- static blocks: placements a hard rule forbids whatever else happens (leave, eligibility, Nc...) -----
  const hardSame = compiled.filter(cr => cr.hard && cr.rule.type === 'sameDay' && cr.info && cr.info.forbid);
  // "A needs B the same day" (a cardiac call only on a cardiac day): an auto code A is blocked where the fixed codes have no B
  const hardNeed = compiled.filter(cr => cr.hard && cr.rule.type === 'sameDay' && cr.info && !cr.info.forbid);
  const hardElig = compiled.filter(cr => cr.hard && cr.rule.type === 'eligible' && cr.info);
  const hardUntil = compiled.filter(cr => cr.hard && cr.rule.type === 'noCallsUntil' && cr.info);
  const hardAvoid = compiled.filter(cr => cr.hard && cr.rule.type === 'requests' && cr.info && !cr.info.want && !cr.info.weekend);
  const blockCache = new Int8Array(P * n * (K + 1)).fill(-1);
  function blocked(p, d, k) {
    const key = (p * n + d) * (K + 1) + k;
    if (blockCache[key] >= 0) return blockCache[key] === 1;
    const i = p * n + d, code = autoCodes[k - 1];
    const els = [...fixed[i], ...ctx.req[i]];
    if (d > 0 && fixed[i - 1].some(c => dm.get(c) && dm.get(c).overnight)) els.push('x');
    let b = false;
    for (const cr of hardSame) {
      const { mA, mB, ok, inWho } = cr.info;
      if (!ok[d] || !inWho[p]) continue;
      if ((mB.elem(code) && els.some(mA.elem)) || (mA.elem(code) && els.some(mB.elem))) { b = true; break; }
    }
    if (!b) for (const cr of hardNeed) {
      const { mA, mB, ok, inWho } = cr.info;
      if (ok[d] && inWho[p] && mA.elem(code) && !mB.elem(code) && !els.some(mB.elem)) { b = true; break; }
    }
    if (!b) for (const cr of hardElig) if (cr.info.ok[d] && !cr.info.inWho[p] && cr.info.m.elem(code)) { b = true; break; }
    if (!b) for (const cr of hardUntil) {
      const { m, ok, inWho, until } = cr.info;
      if (ok[d] && inWho[p] && until[p] && ctx.days[d] < until[p] && m.elem(code)) { b = true; break; }
    }
    if (!b) for (const cr of hardAvoid) {
      const { m, code: rc, ok, inWho } = cr.info;
      if (ok[d] && inWho[p] && m.elem(code) && els.includes(rc)) { b = true; break; }
    }
    // an overnight duty makes the next day post call: blocked when that day's fixed codes can't go with post call
    if (!b && d + 1 < n && dm.get(code) && dm.get(code).overnight) {
      const next = [...fixed[i + 1], ...ctx.req[i + 1]];
      if (next.length) for (const cr of hardSame) {
        const { mA, mB, ok, inWho } = cr.info;
        if (!ok[d + 1] || !inWho[p] || !act[i + 1]) continue;
        if ((mA.elem('x') && next.some(mB.elem)) || (mB.elem('x') && next.some(mA.elem))) { b = true; break; }
      }
    }
    blockCache[key] = b ? 1 : 0;
    return b;
  }

  // ----- demand from cover rules -----
  const covers = compiled.filter(cr => cr.rule.type === 'cover' && cr.info && cr.info.min != null)
    .map(cr => ({ cr, k: (() => { const c = (cr.rule.params.codes || []).find(x => autoSet.has(x)); return c ? autoCodes.indexOf(c) + 1 : 0; })() }))
    .filter(x => x.k);
  const inPool = Array.from({ length: K + 1 }, () => new Uint8Array(P));
  const pool = Array.from({ length: K + 1 }, () => []);
  for (const { cr, k } of covers) for (const p of cr.info.list) if (!inPool[k][p]) { inPool[k][p] = 1; pool[k].push(p); }
  // Other rules that want an auto duty placed (standing duty, a limit with a minimum) add their people to the pool,
  // and the search may add that duty anywhere for them; the score decides whether it stays.
  const wants = [];
  for (const cr of compiled) {
    const t = cr.rule.type, pr = cr.rule.params || {};
    if (!(t === 'standing' || (t === 'limit' && pr.min != null && pr.min !== ''))) continue;
    const c = (pr.codes || []).find(x => autoSet.has(x));
    if (!c) continue;
    const k = autoCodes.indexOf(c) + 1;
    const W = compileWho(ctx, cr.rule.who).list;
    for (const p of W) if (!inPool[k][p]) { inPool[k][p] = 1; pool[k].push(p); }
    if (W.length) wants.push({ k, list: W });
  }
  const coverCount = (cr, d) => { let c = 0; const { list, m } = cr.info; for (const p of list) { const i = p * n + d; if (act[i] && m(i)) c++; } return c; };
  const canTake = (p, d, k) => { const i = p * n + d; return free[i] && !grid[i] && !blocked(p, d, k); };

  // ----- greedy construction -----
  const slots = [];
  for (const { cr, k } of covers) for (let d = lo; d <= hi; d++) {
    if (!cr.info.ok[d]) continue;
    const need = cr.info.min - coverCount(cr, d);
    if (need <= 0) continue;
    let cands = 0;
    for (const p of cr.info.list) if (canTake(p, d, k)) cands++;
    slots.push({ cr, k, d, slack: cands - need });
  }
  slots.sort((a, b) => a.slack - b.slack || a.d - b.d);
  for (const s of slots) {
    for (let guard = 0; guard < 50 && coverCount(s.cr, s.d) < s.cr.info.min; guard++) {
      let best = -1, bestDelta = Infinity, ties = 0;
      for (const p of s.cr.info.list) {
        if (!canTake(p, s.d, s.k)) continue;
        const i = p * n + s.d;
        const delta = apply([[i, s.k]]);
        revert();
        if (delta < bestDelta - 1e-9) { best = i; bestDelta = delta; ties = 1; }
        else if (Math.abs(delta - bestDelta) <= 1e-9 && rng() * ++ties < 1) best = i;
      }
      if (best < 0 || bestDelta >= 0) break;
      apply([[best, s.k]]);
    }
  }

  // the first draft's numbers straight away (the dialog shows them while the search goes on)
  if (onProgress) onProgress({ best: { hard: hardCnt, soft: softCnt }, pct: 0 });

  // ----- local search (simulated annealing) -----
  // The budget and the starting temperature were tuned on practice departments (Oct 2026): 500 tries per unfilled
  // slot from a cool start (T0 1) gives the same quality as the first version's 1,500 per slot from T0 25, in a third
  // of the time. The search also ends once it has converged: no must-fix problems left and no better roster found in
  // the last `patience` tries. Both are counted in tries, not time, so a seed always gives the same roster.
  // A tight department (the hard rules can only just be met) may still have must-fix problems at the end of that
  // budget: the search then carries on up to the first version's budget (1,500 per slot, at most 300,000; the
  // schedule stretches to it, so it warms up a little), or the time limit.
  const rangeDays = hi - lo + 1;
  const iterMax = Math.max(0, opts.iterations ?? Math.min(100000, Math.max(12000, slots.length * 500)));
  const iterCap = opts.iterations != null ? iterMax : Math.max(iterMax, Math.min(300000, slots.length * 1500));
  let iterLim = iterMax;
  const T0 = opts.t0 ?? 1, T1 = opts.t1 ?? 0.2, TX = opts.tx ?? 25;
  const patience = opts.patience ?? Math.max(5000, Math.round(iterMax * 0.6));
  const best = grid.slice();
  let bestHardPen = hardPen, bestSoftPen = softPen, bestHard = hardCnt, bestSoft = softCnt, bestAt = 0;
  // better = fewer hard penalty points, then fewer soft
  const better = () => hardPen < bestHardPen - 1e-9 || (Math.abs(hardPen - bestHardPen) <= 1e-9 && softPen < bestSoftPen - 1e-9);
  let it = 0, lastProg = now();
  const pick = a => a[(rng() * a.length) | 0];
  function propose() {
    if (wants.length && rng() < 0.05) {
      // add a duty another rule wants (standing duty, limit minimum)
      const { k, list } = pick(wants), q = pick(list), d = lo + ((rng() * rangeDays) | 0);
      return canTake(q, d, k) ? [[q * n + d, k]] : null;
    }
    const r = rng();
    if (!assigned.length || r < 0.08) {
      // add one where a cover is short
      if (!covers.length) return null;   // (with no cover rules, only the wants above add duties)
      const { cr, k } = pick(covers);
      const d = lo + ((rng() * rangeDays) | 0);
      if (!cr.info.ok[d]) return null;
      const cnt = coverCount(cr, d);
      if (cr.info.max != null && cnt > cr.info.max) {
        const on = cr.info.list.filter(p => grid[p * n + d] === k);
        return on.length ? [[pick(on) * n + d, 0]] : null;
      }
      if (cnt >= cr.info.min) return null;
      const q = pick(cr.info.list);
      return canTake(q, d, k) ? [[q * n + d, k]] : null;
    }
    const i = pick(assigned), p = (i / n) | 0, d = i % n, k = grid[i];
    if (r < 0.12) return [[i, 0]];                                   // drop
    if (r < 0.5) {                                                   // give it to someone else that day
      if (!pool[k].length) return null;
      const q = pick(pool[k]);
      return q !== p && canTake(q, d, k) ? [[i, 0], [q * n + d, k]] : null;
    }
    if (r < 0.8) {                                                   // two people swap days
      for (let t = 0; t < 4; t++) {
        const j = pick(assigned), q = (j / n) | 0, e = j % n;
        if (q === p || e === d || grid[j] !== k) continue;
        if (!canTake(p, e, k) || !canTake(q, d, k)) return null;
        return [[i, 0], [j, 0], [p * n + e, k], [q * n + d, k]];
      }
      return null;
    }
    if (r < 0.9) {                                                   // two duties swap on one day
      const start = (rng() * P) | 0;
      for (let t = 0; t < P; t++) {
        const q = (start + t) % P, j = q * n + d, k2 = grid[j];
        if (!k2 || k2 === k) continue;
        if (!inPool[k2][p] || !inPool[k][q] || blocked(p, d, k2) || blocked(q, d, k)) return null;
        return [[i, k2], [j, k]];
      }
      return null;
    }
    const e = lo + ((rng() * rangeDays) | 0);                       // move to another day
    return e !== d && canTake(p, e, k) ? [[i, 0], [p * n + e, k]] : null;
  }
  while (total() > 1e-9) {
    if (it >= iterLim) {
      if (bestHardPen <= 1e-9 || iterLim >= iterCap) break;
      iterLim = iterCap;   // must-fix problems left: search on
    }
    if ((it & 127) === 0) {
      if (bestHardPen <= 1e-9 && it - bestAt > patience) break;   // converged
      const t = now();
      if (t - t0 > timeMs) break;
      if (onProgress && t - lastProg >= 100) {
        lastProg = t;
        onProgress({ best: { hard: bestHard, soft: bestSoft }, pct: Math.min(99, Math.round(100 * Math.max(it / iterLim, (t - t0) / timeMs))) });
      }
    }
    it++;
    // (the extra search starts hot again, like the first version, which met tight rules more often)
    const T = it < iterMax ? T0 * Math.pow(T1 / T0, it / iterMax) : TX * Math.pow(T1 / TX, (it - iterMax) / Math.max(1, iterCap - iterMax));
    const changes = propose();
    if (!changes) continue;
    const delta = apply(changes);
    if (delta <= 1e-9 || rng() < Math.exp(-delta / T)) {
      if (better()) { bestHardPen = hardPen; bestSoftPen = softPen; bestHard = hardCnt; bestSoft = softCnt; bestAt = it; best.set(grid); }
    } else revert();
  }
  // back to the best roster found (through apply, so the score caches stay right)
  const back = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] !== best[i]) back.push([i, best[i]]);
  if (back.length) apply(back);
  // clean up: drop any duty no rule needs (removing it doesn't make the score worse), so no stray shifts are left
  for (const i of assigned.slice().sort((a, b) => a - b)) {
    if (apply([[i, 0]]) > 1e-9) revert();
  }

  // ----- result -----
  const assignments = {};
  for (let d = lo; d <= hi; d++) {
    const date = ctx.days[d], row = {};
    for (const person of state.staff || []) {
      const cell = getCell(state, date, person.id);
      if (cell && cell.lock) continue;
      const pi = ctx.index.get(person.id);
      const k = pi == null ? 0 : grid[pi * n + d];
      row[person.id] = k ? [autoCodes[k - 1]] : [];
    }
    assignments[date] = row;
  }
  const unfilled = [];
  for (const { cr, k } of covers) for (let d = lo; d <= hi; d++) {
    if (!cr.info.ok[d]) continue;
    const cnt = coverCount(cr, d);
    if (cnt < cr.info.min) unfilled.push({ date: ctx.days[d], code: autoCodes[k - 1], need: cr.info.min - cnt, ruleId: cr.rule.id });
  }
  const afterEv = evaluate(withAssignments(state, assignments), { from, to, rules });
  if (onProgress) onProgress({ best: { hard: afterEv.hard, soft: afterEv.soft }, pct: 100 });
  return {
    assignments,
    before: { hard: beforeEv.hard, soft: beforeEv.soft, score: beforeEv.score },
    after: { hard: afterEv.hard, soft: afterEv.soft, score: afterEv.score },
    unfilled, iterations: it, ms: Math.round(now() - t0),
  };
}

// Write a solve() result into a draft state (inside store.commit): replaces each unlocked cell's old auto codes
// with the new ones and keeps manual codes. Returns the number of cells changed.
export function applyAssignments(draft, assignments) {
  let changed = 0;
  for (const date of Object.keys(assignments || {})) {
    const row = assignments[date];
    for (const id of Object.keys(row)) {
      const cell = getCell(draft, date, id);
      if (cell && cell.lock) continue;
      const oldAuto = (cell && cell.auto) || [];
      const keep = cell ? (cell.a || []).filter(c => !oldAuto.includes(c)) : [];
      const add = row[id].filter(c => !keep.includes(c));
      if (oldAuto.length === add.length && add.every(c => oldAuto.includes(c))) continue;
      changed++;
      setCell(draft, date, id, { a: [...keep, ...add], auto: add });
    }
  }
  return changed;
}

// The state with a result applied, without touching the original (for previews and the after-check).
export function withAssignments(state, assignments) {
  const cells = { ...(state.cells || {}) };
  for (const date of Object.keys(assignments || {})) cells[date] = { ...(cells[date] || {}) };
  const copy = { ...state, cells };
  applyAssignments(copy, assignments);
  return copy;
}

// For the preview: how many duties the result adds and removes compared with the state now.
export function diffAssignments(state, assignments) {
  let added = 0, removed = 0, cells = 0;
  for (const date of Object.keys(assignments || {})) {
    for (const [id, codes] of Object.entries(assignments[date])) {
      const cell = getCell(state, date, id);
      if (cell && cell.lock) continue;
      const old = (cell && cell.auto) || [];
      const a = codes.filter(c => !old.includes(c)).length, r = old.filter(c => !codes.includes(c)).length;
      added += a; removed += r;
      if (a || r) cells++;
    }
  }
  return { added, removed, cells };
}
