// NTF Roster: steps.js tests (node, no browser): the call level guessed from a person's section, the one-time setup an
// import does for the junior pool, the call list check, the rule-by-rule report and where a month's steps stand.
// Made-up people only. Run: node ntf-roster/test/steps.test.mjs
import assert from 'node:assert/strict';

const M = await import('../js/model.js');
const S = await import('../js/steps.js');
const J = await import('../js/jpool.js');

let checks = 0;
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); checks++; };
const ok = (c, msg) => { assert.ok(c, msg); checks++; };

// guesses from the section
eq(S.guessLevel({ group: 'srp' }), 'mo2', 'senior resident physician: MO1');
eq(S.guessLevel({ group: 'rp' }), 'mo2', 'resident physician: MO1');
eq(S.guessLevel({ group: 'jr', note: 'R2-JR' }), 'mo2', 'R2 junior resident: MO1');
eq(S.guessLevel({ group: 'jr', note: 'R1-JR' }), 'mo1', 'R1 junior resident: MO2');
eq(S.guessLevel({ group: 'mo' }), 'mo1', 'medical officer: MO2');
eq(S.guessLevel({ group: 'locum' }), '', 'locum: not on the call list (no calls, PM shifts or half calls)');
eq(S.guessLevel({ group: 'cons' }), '', 'consultant: not on the call list');
eq(S.guessStrength({ group: 'mo', note: 'B' }), 'weak', 'a Baby MO ("(B)" in the sheet) starts as a weak MO2');
eq(S.guessStrength({ group: 'mo', note: 'B · 6/5/26-7/9/26' }), 'weak', 'B among other notes');
eq(S.guessStrength({ group: 'mo', tags: ['babymo'] }), 'weak', 'the Baby MO tag');
eq(S.guessStrength({ group: 'mo', note: 'B, ICU' }), 'weak', 'B in a list');
eq(S.guessStrength({ group: 'mo', note: 'Bay 4' }), '', 'other notes are not a Baby MO');
eq(S.guessStrength({ group: 'rp', note: 'B' }), '', 'only the junior MO on call is guessed weak');

// a made-up department after an import
const person = (id, group, extra = {}) => ({ id, name: `Person ${id}`, short: '', group, tags: [], fte: 1, start: '', end: '', note: '', active: true, ...extra });
function dept() {
  const st = M.defaultState();
  st.staff = [
    person('c1', 'cons'), person('r1', 'rp'), person('r2', 'rp', { tags: ['nocall'] }), person('j1', 'jr', { note: 'R3-JR' }),
    person('j2', 'jr', { note: 'R1-JR' }), person('m1', 'mo'), person('b1', 'mo', { note: 'B' }), person('m2', 'mo', { pool: 'senior' }), person('n1', 'nurse'), person('l1', 'locum'),
  ];
  return st;
}

const st = dept();
const res = S.autoSetupPool(st, '2026-12');
eq(res.guessed.sort(), ['b1', 'j1', 'j2', 'm1', 'r1'], 'everyone in the junior pool without a level is guessed');
const lv = id => J.levelOf(st.staff.find(p => p.id === id));
eq([lv('r1'), lv('r2'), lv('j1'), lv('j2'), lv('m1')], ['mo2', 'nocall', 'mo2', 'mo1', 'mo1'], 'levels after the guess; a set level is kept');
eq(lv('c1'), '', 'consultants untouched');
const b1 = st.staff.find(p => p.id === 'b1');
eq([lv('b1'), J.strengthOf(b1), b1.tags.includes('babymo')], ['mo1', 'weak', true], 'a Baby MO: weak MO2 with the Baby MO tag');
eq(lv('m2'), '', 'someone moved to the senior roster by hand is left alone');
eq(lv('n1'), '', 'nurses are never on the call list');
eq(lv('l1'), '', 'locums are not on the call list');
ok(st.staff.find(p => p.id === 'l1').lvl === 'off', 'and it is remembered, so a later import does not guess them');
ok(st.settings.jpRules === 1 && res.rulesAdded > 0, 'the junior rules are added the first time');
ok(S.isGuessed(st.staff.find(p => p.id === 'r1')), 'a guess is marked');

// a second import guesses nobody again; "not on the call list" on purpose is remembered
S.setLevel(st, 'm1', '');
eq(S.autoSetupPool(st, '2026-12').guessed, [], 'a second import guesses nobody');
eq(lv('m1'), '', 'not on the call list stays');
S.setLevel(st, 'j1', 'mo1', 'weak');
ok(!S.isGuessed(st.staff.find(p => p.id === 'j1')) && st.staff.find(p => p.id === 'j1').tags.includes('mo1weak'), 'a level set by hand drops the guess');
eq(S.confirmGuesses(st), 3, 'Looks right confirms the rest');
ok(!st.staff.some(S.isGuessed), 'no guesses left');
const again = M.migrate(JSON.parse(JSON.stringify(st)));
ok(again.staff.find(p => p.id === 'm1').lvl === 'off', 'the mark survives a save and load');

// the report: must-hold first, broken first
const rep = S.ruleReport({ rules: [
  { id: 'a', name: 'Soft ok', hard: false }, { id: 'b', name: 'Hard ok', hard: true }, { id: 'c', name: 'Hard broken', hard: true },
  { id: 'd', name: 'Off', hard: true, enabled: false }, { id: 'e', name: '', hard: false },
] }, { violations: [{ ruleId: 'c', msg: 'Mon 7 Dec: nobody' }, { ruleId: 'c', msg: 'Tue 8 Dec: nobody' }, { ruleId: 'e', msg: 'x' }] }, r => `rule ${r.id}`);
eq(rep.map(r => [r.id, r.n]), [['c', 2], ['b', 0], ['e', 1], ['a', 0]], 'order and counts; switched-off rules left out');
eq(rep[0].msgs, ['Mon 7 Dec: nobody', 'Tue 8 Dec: nobody'], 'the days come along');
eq(rep[2].name, 'rule e', 'a rule without a name is described');

// where the month stands
const s2 = dept();
eq(S.stepState(s2, '2026-12'), { imported: false, filled: false, exported: false, at: {} }, 'nothing done');
S.markStep(s2, '2026-12', 'imported', '2026-11-06T10:00:00Z');
M.setCell(s2, '2026-12-03', 'm1', { a: ['C'] });
let ss = S.stepState(s2, '2026-12');
ok(ss.imported && ss.filled && !ss.exported, 'imported and filled');
S.markStep(s2, '2026-12', 'exported', '2026-11-06T11:00:00Z');
ok(S.stepState(s2, '2026-12').exported, 'downloaded after the import');
S.markStep(s2, '2026-12', 'imported', '2026-11-06T12:00:00Z');
ok(!S.stepState(s2, '2026-12').exported, 'a new import needs a new download');
ok(!S.stepState(s2, '2027-01').imported, 'months are separate');

// saves from before 6 Nov 2026 had MO1 and MO2 the other way round: the built-in wording flips once
const old = M.defaultState();
delete old.settings.moNames;
J.installJuniorPool(old);
delete old.settings.moNames;
const flip = t => t.replace(/MO([12])/g, (_, d) => `MO${3 - d}`);
for (const t of old.tags) if (/^mo[12]/.test(t.id)) { t.name = flip(t.name); t.help = flip(t.help); }
for (const r of old.rules) if (/^r-jp-/.test(r.id)) r.name = flip(r.name);
old.tags.find(t => t.id === 'mo1').name = 'Junior on call';
const mig = M.migrate(old);
eq(mig.tags.find(t => t.id === 'mo2strong').name, 'Strong MO1', 'old tag names flip: the senior MO on call is MO1');
eq(mig.tags.find(t => t.id === 'mo1').name, 'Junior on call', 'a renamed tag is kept');
eq(mig.rules.find(r => r.id === 'r-jp-mo2').name, J.JUNIOR_RULES.find(r => r.id === 'r-jp-mo2').name, 'old rule names flip');
const twice = M.migrate(JSON.parse(JSON.stringify(mig)));
eq(twice.rules.find(r => r.id === 'r-jp-weak').name, 'A weak MO1 never on call with a weak MO2', 'only once');
const fresh = M.defaultState();
J.installJuniorPool(fresh);
eq(M.migrate(fresh).rules.find(r => r.id === 'r-jp-mo1').name, 'At least one MO2 on call every day', 'a new save is not flipped');

console.log(`steps.test.mjs: ${checks} checks passed`);
