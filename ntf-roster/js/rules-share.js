// NTF Roster: sharing rules as text. Plain functions, no DOM.
//   rulesToText(state)       the rules as JSON text to copy (same shape as the Export file)
//   parseRulesText(text)     what a paste holds: rules, extra duty codes, and plain-English problems. Accepts the export
//                            shape, a bare list of rules, one rule, or a reply from Claude with the JSON in a code block
//   rulesGuide(state)        a Markdown guide to every rule type, the fields and this roster's codes, tags and groups
//                            (no staff names), to paste into a Claude chat so it can draft rules to paste back
// Everything is built from RULE_TYPES, so a new rule type shows up in the guide by itself.

import { RULE_TYPES, describeRule } from './rules.js';
import { TOKENS } from './model.js';

export function rulesToText(state, rules = state.rules || []) {
  const used = new Set();
  for (const r of rules) for (const v of Object.values(r.params || {})) {
    if (Array.isArray(v)) v.forEach(c => used.add(c)); else if (typeof v === 'string') used.add(v);
  }
  const duties = (state.duties || []).filter(d => used.has(d.code));
  return JSON.stringify({ kind: 'ntf-roster-rules', v: 1, rules, duties }, null, 1);
}

const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);

// Pull the first JSON value out of text that may hold prose and ```json fences around it.
function jsonIn(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) { /* look inside */ }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch (e) { /* keep looking */ } }
  const a = t.search(/[[{]/);
  if (a >= 0) {
    for (const close of ['}', ']']) {
      const b = t.lastIndexOf(close);
      if (b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* next */ } }
    }
  }
  return undefined;
}

// -> { rules, duties, problems: string[] }; rules is null when nothing usable was found.
export function parseRulesText(text) {
  const data = jsonIn(text);
  if (data === undefined) return { rules: null, duties: [], problems: ['That is not JSON. Paste the whole block exactly as it was copied (it starts with { or [).'] };
  let rules = null, duties = [];
  if (Array.isArray(data)) rules = data;
  else if (isObj(data) && Array.isArray(data.rules)) { rules = data.rules; duties = Array.isArray(data.duties) ? data.duties : []; }
  else if (isObj(data) && isObj(data.state) && Array.isArray(data.state.rules)) { rules = data.state.rules; duties = data.state.duties || []; }
  else if (isObj(data) && typeof data.type === 'string') rules = [data];
  if (!rules) return { rules: null, duties: [], problems: ['No rules found in that. Expected {"rules": [ … ]}, a list of rules, or one rule with a "type".'] };
  const problems = [];
  const good = rules.filter((r, i) => {
    if (!isObj(r)) { problems.push(`Item ${i + 1} is not a rule.`); return false; }
    if (typeof r.type !== 'string' || !RULE_TYPES[r.type]) {
      problems.push(`Item ${i + 1}${r.name ? ` ("${r.name}")` : ''}: unknown type "${r.type}". Types: ${Object.keys(RULE_TYPES).join(', ')}.`);
      return false;
    }
    return true;
  });
  return { rules: good, duties: Array.isArray(duties) ? duties : [], problems };
}

const kindWords = {
  codes: 'list of duty codes, e.g. ["C","P"]',
  code: 'one duty code',
  number: 'number',
  bool: 'true or false',
  who: 'a "who" object (see Who)',
};

function paramLine(spec) {
  let kind = kindWords[spec.kind] || spec.kind;
  if (spec.kind === 'select') kind = 'one of ' + (spec.options || []).map(o => `"${Array.isArray(o) ? o[0] : (o && o.value !== undefined ? o.value : o)}"`).join(', ');
  const bits = [`\`${spec.key}\` (${spec.label}): ${kind}`];
  if (spec.optional) bits.push('optional, null for none');
  if (spec.min != null) bits.push(`min ${spec.min}`);
  if (spec.help) bits.push(spec.help);
  return '- ' + bits.join('; ');
}

export function rulesGuide(state) {
  const L = [];
  L.push('# NTF Roster: how to write rules', '');
  L.push('Draft rules as JSON for the roster app (Rules > Paste). Reply with ONE code block: `{"kind":"ntf-roster-rules","v":1,"rules":[ … ]}`. The app shows every rule in plain English for review before anything is added, and it can be undone.', '');
  L.push('## A rule', '', '```json', JSON.stringify({
    id: 'r-example', type: 'limit', name: 'Short title', enabled: true, hard: true, weight: 10, note: '',
    who: { groups: [], tags: [], staff: [], exclude: [] },
    when: { from: '', to: '', days: [], holidays: 'any' },
    params: {},
  }, null, 1), '```', '');
  L.push('- `type`: one of the types below. `params` depends on the type.',
    '- `hard`: true = must hold; false = a preference weighed by `weight` (1 to 100, higher matters more). Some types are always preferences.',
    '- `who`: who it applies to. Empty lists = everyone. `groups` = group ids, `tags` = tag ids, `staff` = staff ids, `exclude` = staff ids left out. Use ids from the lists below; never invent ones.',
    '- `when`: limits it to dates. `from`/`to` = "YYYY-MM-DD" or ""; `days` = weekday numbers (0 Sunday … 6 Saturday), [] = every day; `holidays` = "any" | "only" | "exclude".',
    '- `pool`: "junior" or "senior" = which roster the rule belongs to (left out, it goes to the roster open in the app).',
    '- `id`: keep it unique and stable (e.g. `r-short-name`). Importing the same id again updates that rule.',
    '- `name`: a short plain title (optional; the app writes its own description).', '');
  L.push('## Rule types', '');
  for (const [key, t] of Object.entries(RULE_TYPES)) {
    L.push(`### \`${key}\`: ${t.label}${t.soft_only ? ' (always a preference)' : ''}`, '', t.help || '');
    if (t.example) L.push(`Example: ${t.example}`);
    L.push('', 'Params (defaults shown in the example):');
    for (const spec of t.params) L.push(paramLine(spec));
    let d = {};
    try { d = t.defaults(); } catch (e) { /* none */ }
    L.push('', '```json', JSON.stringify(d), '```', '');
  }
  L.push('## This roster', '');
  const duties = state.duties || [];
  L.push('Duty codes (use these in `codes`; special tokens also work: ' + TOKENS.join(', ') + '):');
  for (const d of duties) L.push(`- \`${d.code}\`: ${d.name || ''} (${d.kind || ''}${d.auto ? ', filled by Auto-fill' : ''})`);
  L.push('', 'Groups:');
  for (const g of state.groups || []) L.push(`- \`${g.id}\`: ${g.name}`);
  L.push('', 'Tags:');
  for (const t of state.tags || []) L.push(`- \`${t.id}\`: ${t.name}${t.help ? ` (${t.help})` : ''}`);
  L.push('', '## Current rules (plain English)', '');
  const cur = (state.rules || []).filter(r => r && RULE_TYPES[r.type]);
  for (const r of cur) L.push(`- \`${r.id}\` (${r.type}, ${r.hard ? 'must hold' : `preference ${r.weight}`}${r.enabled === false ? ', off' : ''}): ${r.name || describeRule(r, state)}`);
  L.push('', 'Rules > Copy gives the exact JSON of all of them, to be edited or extended.');
  return L.join('\n');
}
