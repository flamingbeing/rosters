// NTF Roster: the rule engine. The engine is the roster core's (lib/roster-core/rules.js, one copy for the roster apps;
// how it works and how to add a rule type are written there); this file gives it this app's options: request
// priorities for Cr and Nc (reqprio.js) and "consultants" in the words. No posting duties, PPC or imported sheet; the
// plain fair-share rule (weekend and holiday weights).
import { createRules } from '../../lib/roster-core/rules.js';   // /lib/ is the shared folder on every host (worker/routes.js SHARED)
import { DEFAULT_RULES, TOKENS } from './model.js';
import { isFair, weigh, monthPriorities, capOf } from './reqprio.js';

export { DEFAULT_RULES };

export const {
  F, ruleReach, buildContext, refresh, compileCodes, compileWho, compileWhen, normalizeWho, normalizeWhen, normalizeRule,
  compileRule, compileRules, RULE_TYPES, newRule, describeRule, validateRule, runRule, evaluate, evaluateRule,
} = createRules({ TOKENS, reqprio: { isFair, weigh, monthPriorities, capOf } }, { words: { consultants: true } });
