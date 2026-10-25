// NUH Junior Monthly: the rule engine. The engine is the roster core's (lib/roster-core/rules.js, one copy for the roster
// apps; how it works and how to add a rule type are written there); this file gives it this app's options: posting
// duties and PPC, calls read as on their posting, the imported sheet's grades and absences, the full fair-share rule,
// "only when that day is", "No calls until" and "Start of a posting", and its words for calls.
import { createRules } from '../../lib/roster-core/rules.js';   // /lib/ is the shared folder on every host (worker/routes.js SHARED)
import { DEFAULT_RULES, TOKENS, notInSheet, personIn, CALLS } from './model.js';

export { DEFAULT_RULES };

export const {
  F, dayOffWeight, carryBalances, ruleReach, buildContext, refresh, compileCodes, compileWho, compileWhen, normalizeWho,
  normalizeWhen, normalizeRule, compileRule, compileRules, RULE_TYPES, newRule, describeRule, validateRule, runRule,
  evaluate, evaluateRule,
} = createRules({ TOKENS, notInSheet, personIn }, {
  postings: true,
  callPost: { C3: 'C', R1B: 'ICU' },   // which posting a call belongs to (C3 is cardiac C, R1B is ICU)
  fairShare: 'full',
  sequence: { thenDay: true, skipUnplanned: true },
  types: ['noCallsUntil', 'postingStart'],
  words: {
    calls: CALLS, maxCodes: 4, trimAny: true,
    tokens: { '@posting': 'any posting', PPC: 'the day off after an ICU post call (PPC)', '@shift': 'any call or shift', x: 'post call (PC)' },
  },
});
