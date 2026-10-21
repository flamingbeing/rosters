// NTF Roster: rules as plain sentences (rules-text.js). Run: node ntf-roster/test/rules-text.test.mjs
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { demoState } from '../js/demo.js';
import { RULE_TYPES, normalizeRule, validateRule } from '../js/rules.js';
import {
  TEXT_FORMS, ruleLine, rulesToLines, parseRuleLines, rulesToFile, parseRulesFile, looksLikeRulesFile, textExamples, ruleSentence,
} from '../js/rules-text.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const canon = r => JSON.stringify(normalizeRule(r), Object.keys(normalizeRule(r)).sort());
const same = (a, b, m) => eq(JSON.parse(JSON.stringify(normalizeRule(a))), JSON.parse(JSON.stringify(normalizeRule(b))), m);

// every rule type has a sentence pattern
for (const t of Object.keys(RULE_TYPES)) ok(TEXT_FORMS[t], `TEXT_FORMS has ${t}`);

// the default and demo rules: every one is written as a line and read back as the very same rule
for (const [label, s] of [['defaults', M.defaultState()], ['demo', demoState()]]) {
  const text = rulesToLines(s);
  ok(!/^# Kept/m.test(text), `${label}: every rule is written as a sentence`);
  const back = parseRuleLines(text, s, { rules: s.rules, pool: 'junior' });
  eq(back.problems, [], `${label}: no problems reading our own lines`);
  eq(back.removed, [], `${label}: nothing removed`);
  eq(back.rules.length, s.rules.length, `${label}: every rule comes back`);
  ok(back.rules.every((r, i) => r === s.rules[i]), `${label}: untouched lines give the same rule objects (review says "the same")`);
  const file = rulesToFile(s);
  ok(looksLikeRulesFile(file) && !/json:/.test(file), `${label}: the file writes every rule as words`);
  const fb = parseRulesFile(file, s, { rules: s.rules });
  eq(fb.problems, [], `${label}: file reads back`);
  ok(fb.rules.length === s.rules.length && fb.rules.every((r, i) => canon(r) === canon(s.rules[i])), `${label}: file gives the same rules`);
}

// every option of every type, with people, tags, days, dates, notes and off
const s = demoState();
const who = o => ({ groups: [], tags: [], staff: [], exclude: [], ...o });
const when = o => ({ from: '', to: '', days: [], holidays: 'any', ...o });
const R = (type, params, o = {}) => normalizeRule({ id: `t-${type}-${checks}`, type, enabled: true, hard: true, weight: 10, name: '', note: '', who: who(), when: when(), pool: 'junior', params: { ...RULE_TYPES[type].defaults(), ...params }, ...o });
const cases = [
  R('cover', { codes: ['C', 'SMO'], min: 1, max: 3 }, { who: who({ groups: ['mo'], tags: ['babymo'] }) }),
  R('cover', { codes: ['@present'], min: 8, max: null }, { when: when({ days: [1, 3, 5], holidays: 'exclude' }) }),
  R('cover', { codes: ['P'], min: null, max: 1 }, { when: when({ from: '2026-11-02', to: '2026-11-30' }) }),
  R('limit', { codes: ['C'], period: 'rolling', window: 10, min: 1, max: 3, fte: true, prorate: true }),
  R('limit', { codes: ['@shift'], period: 'week', min: null, max: 0 }, { who: who({ staff: ['d01'] }), when: when({ days: [5] }) }),
  R('limit', { codes: ['C'], period: 'month', min: 2, max: null }, { who: who({ groups: ['rp', 'jr'], exclude: ['d01', 'd02'] }), enabled: false }),
  R('sequence', { ifCodes: ['C'], thenCodes: ['C'], mode: 'require', from: 1, to: 1 }, { when: when({ days: [6] }), hard: false, weight: 35 }),
  R('sequence', { ifCodes: ['@leave'], thenCodes: ['C', 'P'], mode: 'forbid', from: -2, to: -1 }),
  R('sequence', { ifCodes: ['C'], thenCodes: ['Clinic'], mode: 'forbid', from: -1, to: -1 }),
  R('sequence', { ifCodes: ['C'], thenCodes: ['Clinic'], mode: 'forbid', from: 2, to: 4 }),
  R('sequence', { ifCodes: ['C'], thenCodes: ['Clinic'], mode: 'forbid', from: 3, to: 3 }),
  R('sameDay', { codesA: ['C'], codesB: ['Clinic', 'Inj'], mode: 'forbid' }),
  R('sameDay', { codesA: ['APS'], codesB: ['@present'], mode: 'require' }),
  R('together', { codes: ['C'], other: who({ groups: ['sr'], staff: ['d03'] }), otherCodes: ['C'], mode: 'needs', min: 2 }, { who: who({ tags: ['babymo'] }) }),
  R('together', { codes: ['C'], other: who(), otherCodes: ['@any'], mode: 'never', min: 4 }, { who: who({ staff: ['d02'] }) }),
  R('maxRun', { codes: ['@shift'], max: 6 }, { hard: false, weight: 1 }),
  R('maxRun', { codes: ['@away'], max: 10 }),
  R('requests', { request: 'Nw', codes: ['@shift'], mode: 'avoid', span: 'weekend' }, { hard: false, weight: 100 }),
  R('spread', { codes: ['C'], period: 'range', weekendWeight: 3, holidayWeight: 1.5, tolerance: 2 }, { hard: false, weight: 5 }),
  R('spread', { codes: ['C'], period: 'month' }, { hard: false, weight: 5, when: when({ days: [0, 1, 2, 3, 4, 5, 6] }) }),
  R('eligible', { codes: ['OTC'] }, { who: who({ groups: M.DEFAULT_GROUPS.filter(g => g.kind === 'senior').map(g => g.id) }) }),
  R('standing', { codes: ['Clinic'] }, { who: who({ staff: ['d03'] }), when: when({ days: [2] }), name: 'Tuesday clinic', note: 'Two lines\nof note' }),
  R('standing', { codes: ['@present'] }, { who: who({ tags: ['pain'] }), when: when({ holidays: 'only' }) }),
];
for (const r of cases) {
  const line = ruleLine(r, s);
  ok(line, `${r.type} can be written: ${JSON.stringify(r.params)}`);
  const back = parseRuleLines(line, s, { rules: [r] });
  eq(back.problems, [], `${line} reads`);
  same(back.rules[0], r, `${line} round trip`);
  // a brand-new line (no id, no rule to fall back on) gives the same rule apart from the id
  const fresh = parseRuleLines(line.replace(/\s*\[[^\]]+\]$/, ''), s, { pool: 'junior' });
  eq(fresh.problems, [], `new: ${line}`);
  // hidden settings (the number on a "never with" rule) start at the default on a new line, and stay on an edited one
  const hidden = r.type === 'together' && r.params.mode === 'never' ? { params: { ...r.params, min: 1 } } : {};
  same({ ...fresh.rules[0], id: r.id, note: r.note }, { ...r, ...hidden }, `new from words: ${line}`);
  const fb = parseRulesFile(rulesToFile(s, [r]), s, { rules: [r] });
  eq(fb.problems, [], `file: ${line}`);
  same(fb.rules[0], r, `file round trip: ${line}`);
}
ok(/Tuesday clinic = Chitra Raman: always on Clinic \(Tue\)  \/\/ Two lines \/ of note/.test(ruleLine(cases[21], s)), 'name, person, day, note on one line');
ok(/note: Two lines\n {4}of note/.test(rulesToFile(s, [cases[21]])), 'the file keeps a note\'s lines');
eq(parseRulesFile(rulesToFile(s, [cases[21]]), s, { rules: [] }).rules[0].note, 'Two lines\nof note', 'multi-line note comes back from the file');

// editing: change one number on one line, only that rule changes
{
  const st = M.defaultState();
  const text = rulesToLines(st).replace('at most 7 C a month', 'at most 6 C a month');
  const back = parseRuleLines(text, st, { rules: st.rules, pool: 'junior' });
  eq(back.problems, [], 'edited text reads');
  const changed = back.rules.filter((r, i) => r !== st.rules[i]);
  eq(changed.map(r => r.id), ['r-maxcall'], 'only the edited rule changes');
  eq(changed[0].params.max, 6, 'to 6');
  eq({ ...changed[0], params: { ...changed[0].params, max: 7 } }, st.rules.find(r => r.id === 'r-maxcall'), 'nothing else about it changes');
}
// status words: OFF, PREF n, MUST
{
  const st = M.defaultState();
  const text = rulesToLines(st)
    .replace(/^MUST(\s+)With request Nc, avoid C that day  \[r-req-nc\]$/m, 'PREF 70$1With request Nc, avoid C that day  [r-req-nc]')
    .replace(/^PREF 20(\s+)At least 3 days between calls = If C, then no C on the next 2 days  \[r-gap\]$/m, 'OFF PREF 20$1At least 3 days between calls = If C, then no C on the next 2 days  [r-gap]');
  const back = parseRuleLines(text, st, { rules: st.rules, pool: 'junior' });
  const by = id => back.rules.find(r => r.id === id);
  ok(by('r-req-nc').hard === false && by('r-req-nc').weight === 70, 'MUST to PREF 70');
  ok(by('r-gap').enabled === false, 'OFF turns a rule off');
  eq(back.rules.filter((r, i) => r !== st.rules[i]).length, 2, 'just those two changed');
}
// removing, adding, copying a line
{
  const st = M.defaultState();
  const lines = rulesToLines(st).split('\n').filter(l => !/\[r-otc\]$/.test(l));
  lines.push('MUST  Juniors: no more than', 'PREF 30  No clinic after call = If C, then no Clinic on the next day');
  const gap = lines.find(l => /\[r-gap\]$/.test(l));
  lines.push(gap.replace('next 2 days', 'next 3 days'));
  const back = parseRuleLines(lines.join('\n'), st, { rules: st.rules, pool: 'junior' });
  eq(back.removed.map(r => r.id), ['r-otc'], 'a removed line deletes its rule');
  eq(back.problems.length, 1, 'one unreadable line');
  ok(/^Line \d+: /.test(back.problems[0]), 'the problem names the line');
  const added = back.rules.filter(r => !r.id);
  eq(added.length, 2, 'a new line and a copied line are new rules');
  eq(added[0].params, { ifCodes: ['C'], thenCodes: ['Clinic'], mode: 'forbid', from: 1, to: 1 }, 'new rule params');
  ok(added[0].name === 'No clinic after call' && added[0].hard === false && added[0].weight === 30 && added[0].pool === 'junior', 'new rule name, strength and roster');
  eq(added[1].params.to, 3, 'the copy has its own change');
  ok(back.rules.find(r => r.id === 'r-gap') === st.rules.find(r => r.id === 'r-gap'), 'the original of a copied line stays');
}
// a line that can't be read never deletes its rule, and is never guessed
{
  const st = M.defaultState();
  const text = rulesToLines(st).replace('at most 7 C a month', 'at most seven calls monthly');
  const back = parseRuleLines(text, st, { rules: st.rules, pool: 'junior' });
  eq(back.removed, [], 'unreadable line keeps its rule');
  ok(!back.rules.some(r => r.id === 'r-maxcall'), 'and does not change it');
  ok(back.problems.length === 1 && /Line \d+/.test(back.problems[0]), 'it is reported');
}
// problems in plain words
const p1 = parseRuleLines('Juniors: each day exactly 2 on C', s).problems[0];
ok(/start with MUST/.test(p1), 'missing status');
ok(/"ZZ" is not a duty code/.test(parseRuleLines('MUST  Each day exactly 2 on ZZ', s).problems[0]), 'unknown code');
ok(/"Martians" is not a group, tag or person/.test(parseRuleLines('MUST  Martians: each day exactly 2 on C', s).problems[0]), 'unknown people');
ok(/always preferences/.test(parseRuleLines('MUST  Share C fairly each month', s).problems[0]), 'share fairly must be a preference');
ok(/not a day/.test(parseRuleLines('MUST  Each day exactly 2 on C (fortnightly)', s).problems.join(' ')) || parseRuleLines('MUST  Each day exactly 2 on C (fortnightly)', s).problems.length === 1, 'odd when');
ok(/doesn't match any kind of rule/.test(parseRuleLines('MUST  Be nice to each other', s).problems[0]), 'not a rule');
// words people might type
const loose = parseRuleLines('pref 15  juniors: AT MOST 3 c a week\nMust hold  Each day exactly 1 on C (Saturday, sunday)', s);
eq(loose.problems, [], 'case and full day names are fine');
eq(loose.rules[0].params.codes, ['C'], 'code case is forgiven when it is clear');
eq(loose.rules[1].when.days, [0, 6], 'days by full name');
// a rule that can't be written in words is kept as it is (a # line with its id; json in the file)
{
  const odd = normalizeRule({ id: 'r-odd', type: 'cover', pool: 'junior', params: { codes: [], min: 1 } });
  const st = { ...M.defaultState(), rules: [odd] };
  const text = rulesToLines(st);
  ok(/^# Kept as it is.*\[r-odd\]$/m.test(text), 'kept line');
  eq(parseRuleLines(text, st, { rules: st.rules }).removed, [], 'a kept line is not a delete');
  const f = rulesToFile(st);
  ok(/json: /.test(f), 'file falls back to json');
  same(parseRulesFile(f, st, { rules: [] }).rules[0], odd, 'json block comes back');
}
// the examples under Edit as text all read back
const ex = textExamples(s);
eq(ex.length, Object.keys(RULE_TYPES).length, 'one example per type');
for (const e of ex) eq(parseRuleLines(e.line, s).problems, [], `example reads: ${e.line}`);
ok(ruleSentence(cases[0], s).startsWith('Medical officers and Baby MO: each day 1 to 3 on C or SMO'), 'sentence for the builder');

console.log(`rules-text tests: ${checks} checks passed`);
