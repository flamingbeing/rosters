// NTF Roster: rules as text (rules-share.js). Run: node ntf-roster/test/rules-share.test.mjs
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { RULE_TYPES, validateRule, evaluateRule } from '../js/rules.js';
import { rulesToText, parseRulesText, rulesGuide } from '../js/rules-share.js';

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };

const s = M.defaultState();
// round trip: copy then paste gives the same rules
const text = rulesToText(s);
const back = parseRulesText(text);
eq(back.rules.length, s.rules.length, 'copy then paste keeps every rule');
eq(back.problems, [], 'no problems on our own export');

// what Claude might send: prose around a fenced block, a bare list, one rule
const one = { id: 'r-x', type: 'limit', name: 'Max 2 calls', hard: false, weight: 40, params: { codes: ['C'], period: 'month', max: 2 } };
eq(parseRulesText('Here you go:\n```json\n' + JSON.stringify({ rules: [one] }) + '\n```\nHope that helps').rules.map(r => r.id), ['r-x'], 'JSON in a code block after prose');
eq(parseRulesText(JSON.stringify([one])).rules.length, 1, 'a bare list');
eq(parseRulesText(JSON.stringify(one)).rules.length, 1, 'a single rule');
// problems in plain English
ok(/not JSON/.test(parseRulesText('hello there').problems[0]), 'not JSON');
ok(/No rules found/.test(parseRulesText('{"a":1}').problems[0]), 'no rules');
const odd = parseRulesText(JSON.stringify({ rules: [one, { type: 'nonsense', name: 'Odd' }, 5] }));
eq(odd.rules.length, 1, 'unknown types and non-rules are dropped');
ok(odd.problems.length === 2 && /unknown type "nonsense"/.test(odd.problems[0]), 'and named');
// validation says what is wrong in words
ok(validateRule({ type: 'limit', params: { codes: ['ZZZ'], period: 'month', max: 1 } }, s).some(m => /Unknown code "ZZZ"/.test(m)), 'unknown code is named');

// the guide covers every rule type and this roster's codes
const guide = rulesGuide(s);
for (const k of Object.keys(RULE_TYPES)) ok(guide.includes('`' + k + '`'), `guide lists ${k}`);
for (const d of s.duties) ok(guide.includes('`' + d.code + '`'), `guide lists code ${d.code}`);
ok(/ntf-roster-rules/.test(guide), 'guide names the format');
ok(!s.staff.some(p => p.name && guide.includes(p.name)), 'guide holds no staff names');
console.log(`rules-share tests: ${checks} checks passed`);
