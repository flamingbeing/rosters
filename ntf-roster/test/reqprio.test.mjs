// NTF Roster: request priority tests (Cr / Nc limits and ! ? marks). Fake people only. Run: node ntf-roster/test/reqprio.test.mjs
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import * as R from '../js/rules.js';
import * as P from '../js/reqprio.js';
import * as io from '../js/io.js';
import { setMark } from '../js/ui-reqprio.js';

let n = 0;
const eq = (a, b, msg) => { n++; assert.deepStrictEqual(a, b, msg); };
const ok = (v, msg) => { n++; assert.ok(v, msg); };
const MONTH = '2026-11';

function base() {
  const s = M.defaultState();
  const g = s.groups[0].id;
  s.staff = [{ id: 'a', name: 'Asks Lots', group: g, tags: [] }, { id: 'b', name: 'Asks Little', group: g, tags: [] }];
  return s;
}
const prOf = s => P.monthPriorities(M.monthDays(MONTH), d => (s.cells || {})[d], P.capOf(s));

// ---------- levels ----------
{
  const s = base();
  for (const d of ['2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12']) M.setCell(s, d, 'a', { r: ['Nc'] });
  M.setCell(s, '2026-11-07', 'a', { r: ['Cr'] });
  M.setCell(s, '2026-11-10', 'b', { r: ['Nc'] });
  const pr = prOf(s);
  eq(['2026-11-03', '2026-11-05', '2026-11-07', '2026-11-10', '2026-11-12'].map(d => pr.get(`${d}|a|${d === '2026-11-07' ? 'Cr' : 'Nc'}`).level),
    ['normal', 'normal', 'low', 'low', 'low'], 'first 2 by date count in full, Cr and Nc together');
  eq(pr.get('2026-11-10|a|Nc').factor, 2 / 5, 'a later one counts cap / count');
  eq(pr.get('2026-11-10|b|Nc').level, 'normal', 'someone with one request counts in full');
  setMark(s, '2026-11-12', 'a', 'Nc', '!');
  setMark(s, '2026-11-03', 'a', 'Nc', '?');
  const pr2 = prOf(s);
  eq(pr2.get('2026-11-12|a|Nc').level, 'must', '! counts in full');
  eq(pr2.get('2026-11-03|a|Nc').level, 'low', '? gives way');
  eq([pr2.get('2026-11-05|a|Nc').level, pr2.get('2026-11-07|a|Cr').level], ['normal', 'normal'], 'a ? frees a place for the next one');
  s.settings.requestCap = 0;
  eq(prOf(s).get('2026-11-10|b|Nc').level, 'low', 'cap 0: every unmarked one is if possible');
  eq(P.weigh({ level: 'low', factor: 0.5 }, 1000, true), { pen: 30, hard: false }, 'a low Nc under a hard rule turns soft');
  eq(P.weigh({ level: 'must', factor: 1 }, 10, false), { pen: 30, hard: false }, 'a must Cr weighs 3x');
  eq(P.weigh(undefined, 1000, true), { pen: 1000, hard: true }, 'no priority: as before');
  eq(P.splitMark('Cr!'), { code: 'Cr', mark: '!' }, 'splitMark');
}

// ---------- the rule check uses them ----------
{
  const s = base();
  for (const d of ['2026-11-03', '2026-11-04', '2026-11-05']) M.setCell(s, d, 'a', { a: ['C'], r: ['Nc'] });
  M.setCell(s, '2026-11-05', 'b', { a: ['C'], r: ['Nc'] });
  const rules = s.rules.filter(r => r.id === 'r-req-nc');
  const ev = R.evaluate(s, { from: '2026-11-01', to: '2026-11-30', rules });
  const v = d => ev.violations.find(x => x.date === d && x.staffId === 'a');
  eq([v('2026-11-03').hard, v('2026-11-04').hard, v('2026-11-05').hard], [true, true, false], 'the 3rd Nc broken is soft');
  ok(/if possible/.test(v('2026-11-05').msg), 'and says so');
  ok(ev.violations.find(x => x.staffId === 'b').hard, "the other person's single Nc stays hard");
  setMark(s, '2026-11-05', 'a', 'Nc', '!');
  const ev2 = R.evaluate(s, { from: '2026-11-01', to: '2026-11-30', rules });
  ok(ev2.violations.find(x => x.date === '2026-11-05' && x.staffId === 'a').hard, 'marked ! it is hard again');
}

// ---------- marks in the cell, the import and the export ----------
{
  const s = base();
  M.setCell(s, '2026-11-03', 'a', { r: ['Cr'], rp: { Cr: '!', Nc: '?' } });
  eq(M.getCell(s, '2026-11-03', 'a').rp, { Cr: '!' }, 'only marks for requests in the cell are kept');
  M.setCell(s, '2026-11-03', 'a', { r: [] , a: ['C'] });
  ok(!M.getCell(s, '2026-11-03', 'a').rp, 'removing the request drops its mark');
  const t = io.parseCellText('Cr! note', s);
  eq([t.r, t.rp, t.note], [['Cr'], { Cr: '!' }, 'note'], 'the import reads Cr!');
  eq(io.parseCellText('Nc?', s).rp, { Nc: '?' }, 'and Nc?');
}

console.log(`request priority tests: ${n} checks passed`);
