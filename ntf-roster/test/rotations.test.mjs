// NTF Roster: rotations.js tests (node, no browser). Made-up names only.
// Run: node ntf-roster/test/rotations.test.mjs
import assert from 'node:assert/strict';
const M = await import('../js/model.js');
const R = await import('../js/rotations.js');

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };

const person = (id, name, o = {}) => ({ id, name, short: '', group: 'jr', tags: [], fte: 1, start: '', end: '', note: '', active: true, ...o });
const fresh = () => {
  const s = M.defaultState();
  s.staff = [person('a', 'Pat Sample'), person('b', 'Lee Other'), person('c', 'Sam Starter', { start: '2026-10-15' })];
  return s;
};
const TEXT = [
  ['Name', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'],
  ['Pat Sample', 'NUH', 'NTF', 'AL', '', 'KKH'],
  ['Lee Other', 'NTF', 'NTF', 'NTF', 'NTF', 'NTF'],
  ['sam  starter', 'NUH', 'NUH', 'NUH', 'NUH', 'NUH'],
  ['Ghost Person', 'NUH', '', '', '', ''],
].map(r => r.join('\t')).join('\n') + '\n';

// what the roster tells People: its names and the Mondays of the weeks the month touches
{
  const info = R.pullInfo(fresh(), '2026-10');
  eq(info.type, 'ntf-pull-info');
  eq(info.names, ['Pat Sample', 'Lee Other', 'Sam Starter']);
  eq([info.from, info.to, info.month], ['2026-09-28', '2026-10-26', '2026-10']);   // 1 Oct 2026 is a Thursday, 31 Oct a Saturday
  eq(R.pullInfo(fresh(), '2026-11').from, '2026-10-26');                              // 1 Nov is a Sunday: its week starts 26 Oct
}

// reading the text
{
  const p = R.parseRotations(TEXT);
  eq(p.weeks, ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26']);
  eq(p.rows.map(r => r.name), ['Pat Sample', 'Lee Other', 'sam  starter', 'Ghost Person']);
  eq(p.rows[0].words, ['NUH', 'NTF', 'AL', '', 'KKH']);
  eq(p.bad, 0);
  eq(R.parseRotations('Name\tnot a date\nPat\tNUH').rows, []);
  eq(R.parseRotations('Pat\tNUH\n').rows, []);
  eq(R.parseRotations('').rows, []);
  eq(R.parseRotations('Name\t2026-10-05\n\tNUH\nPat Sample\tAL\n').bad, 1);       // a line with no name
}

// the plan for October: weekdays only, inside the month, from each person's start date, not on top of leave
{
  const s = fresh();
  const plan = R.planRotations(R.parseRotations(TEXT), s, '2026-10');
  const pat = plan.fills.filter(f => f.staffId === 'a');
  eq(pat.map(f => f.date + ' ' + f.code), [
    '2026-10-01 NUH', '2026-10-02 NUH',                                              // the first week: only Thu and Fri are in October
    '2026-10-12 AL', '2026-10-13 AL', '2026-10-14 AL', '2026-10-15 AL', '2026-10-16 AL',
    '2026-10-26 KKH', '2026-10-27 KKH', '2026-10-28 KKH', '2026-10-29 KKH', '2026-10-30 KKH']);
  eq(plan.fills.filter(f => f.staffId === 'b'), []);                                 // NTF: nothing to mark
  eq(plan.fills.filter(f => f.staffId === 'c').map(f => f.date).slice(0, 2), ['2026-10-15', '2026-10-16']);   // not before the start date
  eq(plan.fills.some(f => ['2026-10-03', '2026-10-04', '2026-10-10'].includes(f.date)), false);   // weekends
  eq(plan.unmatched, ['Ghost Person']);
  eq([plan.posted, plan.people], [2, 2]);                                            // Pat and Lee are posted at NTF in some week; Pat and Sam have cells
  eq(plan.newCodes, ['KKH']);                                                        // NUH and AL exist already
  eq(plan.byCode, { NUH: 14, AL: 5, KKH: 5 });                                       // Pat 2 NUH, Sam 12 NUH (from 15 Oct), Pat AL and KKH
  eq(R.planRotations(R.parseRotations(TEXT), s, '2026-10').fills.length, plan.fills.length);   // planning changes nothing
  eq(s.cells, {});
}

// public holidays and days that already have leave or an away code are left alone; shifts are not in the way
{
  const s = fresh();
  s.settings.holidays['2026-10-14'] = 'A made-up holiday';
  M.setCell(s, '2026-10-12', 'a', { a: ['MC'] });                                    // leave from the department sheet wins
  M.setCell(s, '2026-10-13', 'a', { a: ['C'] });                                     // a planned call does not block the posting
  const plan = R.planRotations(R.parseRotations(TEXT), s, '2026-10');
  const al = plan.fills.filter(f => f.staffId === 'a' && f.code === 'AL').map(f => f.date);
  eq(al, ['2026-10-13', '2026-10-15', '2026-10-16']);
  eq(plan.busy, 1);
}

// applying: new codes are added as "other", cells keep what they had, one undo step in the app
{
  const s = fresh();
  M.setCell(s, '2026-10-13', 'a', { a: ['C'], note: 'keep me' });
  const plan = R.planRotations(R.parseRotations(TEXT), s, '2026-10');
  const sum = R.applyRotations(s, plan);
  eq(sum.codesAdded, ['KKH']);
  eq(s.duties.find(d => d.code === 'KKH').kind, 'other');
  eq(sum.cells, plan.fills.length);
  const cell = M.getCell(s, '2026-10-13', 'a');
  eq([cell.a, cell.note], [['C', 'AL'], 'keep me']);
  eq(M.getCell(s, '2026-10-01', 'a').a, ['NUH']);
  eq(M.getCell(s, '2026-10-26', 'a').a, ['KKH']);
  eq(M.getCell(s, '2026-10-05', 'b'), null);
  const again = R.applyRotations(s, R.planRotations(R.parseRotations(TEXT), s, '2026-10'));
  eq([again.codesAdded, again.cells], [[], 0]);                                      // a second apply finds the days taken: no doubles
}

// words this version does not know are skipped, not guessed
{
  const s = fresh();
  const plan = R.planRotations(R.parseRotations('Name\t2026-10-05\nPat Sample\tFOO\n'), s, '2026-10');
  eq([plan.fills.length, plan.ignored], [0, 1]);
}

console.log(`ntf-roster rotations: ${checks} checks passed`);
