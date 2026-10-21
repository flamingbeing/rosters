// NTF Roster: rules as plain sentences that people read and edit. Plain functions, no DOM.
//   ruleLine(rule, state)                  one line: "MUST  Juniors: at most 7 C a month, scaled by FTE  [r-maxcall]"
//   rulesToLines(state, rules)             every rule, one line each, under a short header (Rules › Edit as text)
//   parseRuleLines(text, state, opts)      -> { rules, removed, problems }; opts { rules (the ones edited), pool }
//   rulesToFile(state, rules)              the readable rules file: one block of "key: value" lines per rule
//   parseRulesFile(text, state, opts)      -> { rules, removed: [], problems }
//   looksLikeRulesFile(text)               a pasted text in the file format (not lines, not JSON)
//   TEXT_FORMS[type]                       each rule type's sentence pattern; the builder draws its sentence from it
// Exact both ways: writing a rule and reading it back gives the same rule (test/rules-text.test.mjs). A rule that
// can't be written exactly becomes a "#" line with its id (kept as it is) or, in the file, a json: field.
// A new rule type needs one entry in TEXT_FORMS (the test fails until it has one).

import { RULE_TYPES, normalizeRule } from './rules.js';

// ---------- the sentence patterns ----------
// A pattern is a list of parts: literal words, or a slot { s, k } that writes and reads one or more params:
//   amount [min, max]   "exactly 2", "at least 1", "at most 7", "1 to 3", "any number of"
//   codes k             "C or P"; with on: true, "on C" (bare for away, at work, anything)
//   code k              one code      num k   a number      who k   people, like the Who of a rule
//   choice k, o         one of the options; an option's words may hold a nested slot ("in any {window} days")
//   flag k, t           ", scaled by FTE" when true          opt k, t, d   ", within 2", left out when it is d
//   range [from, to]    "on the next day", "on the next 2 days", "on the day before", "on days +2 to +4"
// Parts starting with "," follow the previous part without a space.
const S = (s, k, o = {}) => ({ s, k, ...o });
export const TEXT_FORMS = {
  cover: ['each day', S('amount', ['min', 'max']), S('codes', 'codes', { on: true })],
  limit: [S('amount', ['min', 'max']), S('codes', 'codes'),
    S('choice', 'period', { o: [['week', 'a week'], ['month', 'a month'], ['rolling', ['in any', S('num', 'window'), 'days']]] }),
    S('flag', 'fte', { t: 'scaled by FTE' }), S('flag', 'prorate', { t: 'pro rata' })],
  sequence: ['if', S('codes', 'ifCodes'), ', then', S('choice', 'mode', { o: [['forbid', 'no'], ['require', 'must have']] }),
    S('codes', 'thenCodes'), S('range', ['from', 'to'])],
  together: ['when on', S('codes', 'codes'), ',',
    S('choice', 'mode', { o: [['needs', ['needs at least', S('num', 'min'), 'of']], ['never', 'never with']] }),
    S('who', 'other'), 'on', S('codes', 'otherCodes')],
  maxRun: ['at most', S('num', 'max'), 'days in a row', S('codes', 'codes', { on: true })],
  requests: ['with request', S('code', 'request'), ',', S('choice', 'mode', { o: [['want', 'give'], ['avoid', 'avoid']] }),
    S('codes', 'codes'), S('choice', 'span', { o: [['day', 'that day'], ['weekend', 'that weekend']] })],
  spread: ['share', S('codes', 'codes'), 'fairly', S('choice', 'period', { o: [['month', 'each month'], ['range', 'over the dates']] }),
    S('opt', 'weekendWeight', { t: 'weekends count #', d: 2 }), S('opt', 'holidayWeight', { t: 'public holidays count #', d: 2 }),
    S('opt', 'tolerance', { t: 'within #', d: 1 })],
  eligible: ['only they may have', S('codes', 'codes')],
  standing: ['always', S('codes', 'codes', { on: true })],
  sameDay: [S('codes', 'codesA'), S('choice', 'mode', { o: [['forbid', 'never with'], ['require', 'needs']] }), S('codes', 'codesB'), 'on the same day'],
};

export const TOKEN_TEXT = {
  '@shift': 'any shift', '@leave': 'leave', '@other': 'other duty', '@request': 'a request',
  '@away': 'away', '@present': 'at work', '@any': 'anything', x: 'post call',
};
const TOKEN_ALIAS = { 'any leave': '@leave', 'any other duty': '@other', 'any request': '@request', 'a shift': '@shift' };
const BARE = ['@away', '@present', '@any'];   // read without "on": "always at work"
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_FULL = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const unset = v => v === '' || v == null || Number.isNaN(Number(v));
const numText = v => String(Number(v));
const andList = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
const NUM = '(-?\\d+(?:\\.\\d+)?)';
const lit = t => t.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');

// ---------- words for codes, people and days (a lexicon per roster) ----------
function kit(state) {
  const duties = (state.duties || []).filter(d => d && d.code);
  const groups = state.groups || [], tags = state.tags || [], staff = state.staff || [];
  const kindIds = k => groups.filter(g => g.kind === k).map(g => g.id);
  // people words: name (lower case) -> what it means; a name meaning two things is written with its kind first
  const lex = new Map();
  const add = (key, v) => { key = String(key || '').trim().toLowerCase(); if (!key) return; const a = lex.get(key) || []; if (!a.some(x => x.kind === v.kind && x.id === v.id)) a.push(v); lex.set(key, a); };
  const jr = kindIds('junior'), sr = kindIds('senior');
  add('everyone', { kind: 'all', id: '' });
  if (jr.length) add('juniors', { kind: 'set', id: 'junior', groups: jr });
  if (sr.length) add('seniors', { kind: 'set', id: 'senior', groups: sr });
  for (const g of groups) { add(g.name, { kind: 'group', id: g.id }); add(`group ${g.name}`, { kind: 'group', id: g.id }); }
  for (const t of tags) { add(t.name, { kind: 'tag', id: t.id }); add(`tag ${t.name}`, { kind: 'tag', id: t.id }); }
  for (const p of staff) {
    for (const n of [p.name, p.short]) { add(n, { kind: 'staff', id: p.id }); add(`person ${n}`, { kind: 'staff', id: p.id }); }
    add(`#${p.id}`, { kind: 'staff', id: p.id });
  }
  const unique = key => (lex.get(key.toLowerCase()) || []).length === 1;
  const nameOf = (kind, id) => {
    if (kind === 'group') { const g = groups.find(x => x.id === id); if (!g) return null; return unique(g.name) ? g.name : `group ${g.name}`; }
    if (kind === 'tag') { const t = tags.find(x => x.id === id); if (!t) return null; return unique(t.name) ? t.name : `tag ${t.name}`; }
    const p = staff.find(x => x.id === id);
    if (!p) return null;
    for (const n of [p.name, `person ${p.name}`, p.short]) if (n && unique(n)) return n;
    return `#${p.id}`;
  };

  const K = {
    codeText(c) {
      if (TOKEN_TEXT[c]) return TOKEN_TEXT[c];
      return duties.some(d => d.code === c) ? c : null;
    },
    codesText(list) {
      list = Array.isArray(list) ? list : [];
      if (!list.length) return null;
      const words = list.map(K.codeText);
      return words.every(Boolean) ? words.join(' or ') : null;
    },
    readCodes(text, out) {
      const items = text.split(/\s*,\s*|\s+or\s+/i).map(x => x.trim()).filter(Boolean);
      if (!items.length) { out.push('No codes'); return null; }
      const codes = [];
      for (const it of items) {
        const low = it.toLowerCase();
        const tok = Object.keys(TOKEN_TEXT).find(k => TOKEN_TEXT[k] === low || (k.startsWith('@') && k === low)) || TOKEN_ALIAS[low];
        if (tok) { codes.push(tok); continue; }
        const exact = duties.find(d => d.code === it);
        if (exact) { codes.push(exact.code); continue; }
        const loose = duties.filter(d => d.code.toLowerCase() === low);
        if (loose.length === 1) { codes.push(loose[0].code); continue; }
        out.push(`"${it}" is not a duty code here`);
        return null;
      }
      return codes;
    },
    whoText(who) {
      who = { groups: [], tags: [], staff: [], exclude: [], ...(isObj(who) ? who : {}) };
      const parts = [];
      const g = who.groups || [];
      if (g.length && sameSet(g, jr) && unique('juniors')) parts.push('juniors');
      else if (g.length && sameSet(g, sr) && unique('seniors')) parts.push('seniors');
      else parts.push(...g.map(id => nameOf('group', id)));
      parts.push(...(who.tags || []).map(id => nameOf('tag', id)));
      parts.push(...(who.staff || []).map(id => nameOf('staff', id)));
      const ex = (who.exclude || []).map(id => nameOf('staff', id));
      if (parts.some(x => !x) || ex.some(x => !x)) return null;
      if (!parts.length && !ex.length) return 'everyone';
      if (!unique('everyone') && !parts.length) return null;
      return `${parts.length ? andList(parts) : 'everyone'}${ex.length ? ` except ${andList(ex)}` : ''}`;
    },
    readWho(text, out) {
      const who = { groups: [], tags: [], staff: [], exclude: [] };
      const m = /^(.*?)\s+except\s+(.+)$/i.exec(text.trim());
      const main = scan(m ? m[1] : text, out);
      if (!main) return null;
      for (const v of main) {
        if (v.kind === 'all') continue;
        if (v.kind === 'set') who.groups.push(...v.groups.filter(x => !who.groups.includes(x)));
        else { const key = v.kind === 'group' ? 'groups' : v.kind === 'tag' ? 'tags' : 'staff'; if (!who[key].includes(v.id)) who[key].push(v.id); }
      }
      if (m) {
        const ex = scan(m[2], out);
        if (!ex) return null;
        for (const v of ex) {
          if (v.kind !== 'staff') { out.push(`Only people can be left out with "except" ("${m[2]}")`); return null; }
          if (!who.exclude.includes(v.id)) who.exclude.push(v.id);
        }
      }
      return who;
    },
  };
  // "Locums, Baby MO and Dr Tan": the longest known name at each point, then a comma or "and"
  function scan(text, out) {
    const t = text.trim(), low = t.toLowerCase(), found = [];
    let i = 0;
    const keys = [...lex.keys()].sort((a, b) => b.length - a.length);
    while (i < t.length) {
      const k = keys.find(key => low.startsWith(key, i) && /^(\s*(,|\band\b)\s*|\s*$)/i.test(t.slice(i + key.length)));
      if (!k) { out.push(`"${t.slice(i).split(/\s*,\s*|\s+and\s+/i)[0]}" is not a group, tag or person here`); return null; }
      const vs = lex.get(k);
      if (vs.length > 1) { out.push(`"${t.slice(i, i + k.length)}" is both a ${vs.map(v => v.kind).join(' and a ')}: write "group …", "tag …" or "person …"`); return null; }
      found.push(vs[0]);
      i += k.length;
      const sep = /^\s*(,|\band\b)?\s*/i.exec(t.slice(i));
      i += sep[0].length;
    }
    return found;
  }
  return K;
}

// "weekdays, except public holidays, from 2026-11-01"
export function whenText(when) {
  if (!isObj(when)) return '';
  const days = [...new Set((when.days || []).map(Number))].sort();
  const parts = [];
  if (days.length && days.length < 7) {
    if (sameSet(days, [0, 6])) parts.push('weekends');
    else if (sameSet(days, [1, 2, 3, 4, 5])) parts.push('weekdays');
    else parts.push(...days.map(d => DAYS[d]));
  } else if (days.length === 7) parts.push('every day');
  if (when.holidays === 'only') parts.push('public holidays only');
  if (when.holidays === 'exclude') parts.push('except public holidays');
  if (when.from) parts.push(`from ${when.from}`);
  if (when.to) parts.push(`until ${when.to}`);
  return parts.join(', ');
}
function readWhen(text, out) {
  const when = { from: '', to: '', days: [], holidays: 'any' };
  let all = false;
  for (const raw of text.split(',')) {
    const p = raw.trim().toLowerCase();
    if (!p) continue;
    let m;
    if (p === 'weekends') when.days.push(0, 6);
    else if (p === 'weekdays') when.days.push(1, 2, 3, 4, 5);
    else if (p === 'every day') all = true;
    else if (DAYS.some(d => d.toLowerCase() === p) || DAY_FULL.includes(p)) when.days.push(Math.max(DAYS.findIndex(d => d.toLowerCase() === p), DAY_FULL.indexOf(p)));
    else if (/^(on\s+)?public holidays( only)?$/.test(p)) when.holidays = 'only';
    else if (/^(except|not on|not) public holidays$/.test(p)) when.holidays = 'exclude';
    else if ((m = /^from (\d{4}-\d{2}-\d{2})(?: (?:to|until) (\d{4}-\d{2}-\d{2}))?$/.exec(p))) { when.from = m[1]; if (m[2]) when.to = m[2]; }
    else if ((m = /^(?:until|to) (\d{4}-\d{2}-\d{2})$/.exec(p))) when.to = m[1];
    else { out.push(`"${raw.trim()}" is not a day, "weekends", "weekdays", "public holidays only", "except public holidays", "from 2026-11-01" or "until 2026-11-30"`); return null; }
  }
  when.days = all ? [0, 1, 2, 3, 4, 5, 6] : [...new Set(when.days)].sort();
  return when;
}

// ---------- writing a sentence ----------
function amountText(min, max) {
  const a = unset(min) ? null : Number(min), b = unset(max) ? null : Number(max);
  if (a != null && b != null) return a === b ? `exactly ${a}` : `${a} to ${b}`;
  if (a != null) return `at least ${a}`;
  if (b != null) return `at most ${b}`;
  return 'any number of';
}
export function rangeText(from, to) {
  const f = Number(from), t = Number(to);
  if (!Number.isInteger(f) || !Number.isInteger(t)) return null;
  if (f === 1 && t === 1) return 'on the next day';
  if (f === 1 && t > 1) return `on the next ${t} days`;
  if (f === -1 && t === -1) return 'on the day before';
  if (t === -1 && f < -1) return `on the ${-f} days before`;
  const sg = n => (n > 0 ? `+${n}` : String(n));
  return f === t ? `on day ${sg(f)}` : `on days ${sg(f)} to ${sg(t)}`;
}

// The parts of a rule's sentence, each with its words: what the builder shows as blanks. Null when a value can't be
// written (no codes yet, an unknown code or person).
export function sentenceParts(rule, state, K = kit(state)) {
  const form = TEXT_FORMS[rule.type];
  if (!form) return null;
  const p = normalizeRule(rule).params;
  const parts = [];
  const put = (part, text) => { if (text == null) throw new Error('unwritable'); parts.push({ part, text }); };
  const slot = part => {
    if (typeof part === 'string') return put(part, part);
    const v = p[part.k];
    switch (part.s) {
      case 'amount': return put(part, amountText(p.min, p.max));
      case 'codes': {
        const t = K.codesText(v);
        if (t == null) return put(part, null);
        return put(part, part.on && !(v.length === 1 && BARE.includes(v[0])) ? `on ${t}` : t);
      }
      case 'code': return put(part, typeof v === 'string' && v ? K.codeText(v) : null);
      case 'num': return put(part, unset(v) ? null : numText(v));
      case 'who': return put(part, K.whoText(v));
      case 'choice': {
        const o = part.o.find(x => x[0] === v);
        if (!o) return put(part, null);
        if (typeof o[1] === 'string') return put(part, o[1]);
        const sub = [];
        for (const q of o[1]) sub.push(typeof q === 'string' ? q : (unset(p[q.k]) ? null : numText(p[q.k])));
        return put(part, sub.some(x => x == null) ? null : sub.join(' '));
      }
      case 'flag': return v ? put(part, `, ${part.t}`) : null;
      case 'opt': return unset(v) || Number(v) === part.d ? null : put(part, `, ${part.t.replace('#', numText(v))}`);
      case 'range': return put(part, rangeText(p.from, p.to));
      default: return put(part, null);
    }
  };
  try { form.forEach(slot); } catch (e) { return null; }
  return parts;
}
export function joinParts(parts) {
  return parts.map(x => x.text).filter(Boolean).reduce((s, t) => (!s ? t : t.startsWith(',') ? s + t : `${s} ${t}`), '');
}

// "Juniors: at most 7 C a month, scaled by FTE (weekends)" (no status, name, note or id). Null if it can't be written.
export function ruleSentence(rule, state, K = kit(state)) {
  const parts = sentenceParts(rule, state, K);
  if (!parts) return null;
  let body = joinParts(parts);
  const who = K.whoText(rule.who);
  if (who == null) return null;
  if (who === 'everyone') body = cap(body);
  else body = `${cap(who)}: ${body}`;
  const w = whenText(rule.when);
  return w ? `${body} (${w})` : body;
}

const flat = s => String(s || '').replace(/\s*\n\s*/g, ' / ').trim();
function statusText(rule) {
  const t = RULE_TYPES[rule.type] || {};
  const st = rule.hard !== false && !t.soft_only ? 'MUST' : `PREF ${clampW(rule.weight)}`;
  return rule.enabled === false ? `OFF ${st}` : st;
}
const clampW = w => { const n = Math.round(Number(w)); return n >= 1 ? Math.min(100, n) : 10; };

function lineOf(rule, state, K) {
  const s = ruleSentence(rule, state, K);
  if (s == null) return null;
  const name = String(rule.name || '').replace(/\s+=\s+/g, ' - ').replace(/\s*\n\s*/g, ' ').trim();
  return `${statusText(rule).padEnd(7)}  ${name ? `${name} = ` : ''}${s}${rule.note ? `  // ${flat(rule.note)}` : ''}${rule.id ? `  [${rule.id}]` : ''}`;
}

const canon = r => stableJSON(normalizeRule(r));
function stableJSON(o) {
  if (Array.isArray(o)) return `[${o.map(stableJSON).join(',')}]`;
  if (isObj(o)) return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${stableJSON(o[k])}`).join(',')}}`;
  return JSON.stringify(o ?? null);
}

// One rule as a line, or null when it can't be written and read back exactly.
export function ruleLine(rule, state, K = kit(state)) {
  const line = lineOf(rule, state, K);
  if (line == null) return null;
  const back = parseRuleLines(line, state, { rules: [rule], pool: rule.pool, K });
  return back.rules.length === 1 && !back.problems.length && canon(back.rules[0]) === canon(rule) ? line : null;
}

export const LINES_HEADER = [
  '# One rule per line. MUST = must hold; PREF 20 = a preference with priority 20 (1 to 100); OFF in front = turned off.',
  '# "Name = " in front is optional; "// note" and the [id] at the end are kept. Remove a line to delete its rule;',
  '# a new line without an [id] adds a rule. Lines starting with # are ignored.',
];

export function rulesToLines(state, rules = state.rules || []) {
  const K = kit(state);
  const out = [...LINES_HEADER, ''];
  for (const r of rules) {
    const line = ruleLine(r, state, K);
    out.push(line != null ? line : `# Kept as it is (edit it in the form): ${r.name || r.type}  [${r.id}]`);
  }
  return out.join('\n') + '\n';
}

// ---------- reading ----------
// Compile a pattern into one regular expression and the readers for its groups.
const compiled = new Map();
function compileForm(form) {
  if (compiled.has(form)) return compiled.get(form);
  let src = '^', g = 0;
  const readers = [];
  const sep = text => (text.startsWith(',') ? '\\s*' : (src === '^' ? '' : '\\s+'));
  const numSlot = (key, set) => { const i = ++g; readers.push((m, p) => { if (m[i] != null) set(p, key, Number(m[i])); }); return NUM; };
  for (const part of form) {
    if (typeof part === 'string') {
      src += sep(part) + (part.startsWith(',') ? `,\\s*${part.slice(1).trim() ? lit(part.slice(1)) : ''}` : lit(part));
      continue;
    }
    const set = (p, k, v) => { p[k] = v; };
    switch (part.s) {
      case 'amount': {
        src += sep('') + '(?:exactly\\s+' + numSlot('eq', set) + '|at\\s+least\\s+' + numSlot('ge', set) + '|at\\s+most\\s+' + numSlot('le', set) +
          '|' + numSlot('lo', set) + '\\s+to\\s+' + numSlot('hi', set) + '|(any\\s+number\\s+of))';
        const any = ++g;
        readers.push((m, p) => {
          const [mn, mx] = part.k;
          if (p.eq != null) { p[mn] = p.eq; p[mx] = p.eq; } else if (p.ge != null) { p[mn] = p.ge; p[mx] = null; } else if (p.le != null) { p[mn] = null; p[mx] = p.le; } else if (p.lo != null) { p[mn] = p.lo; p[mx] = p.hi; } else if (m[any] != null) { p[mn] = null; p[mx] = null; }
          delete p.eq; delete p.ge; delete p.le; delete p.lo; delete p.hi;
        });
        break;
      }
      case 'codes': { src += sep('') + (part.on ? '(?:on\\s+)?' : '') + '(.+?)'; const i = ++g; readers.push((m, p, K, out) => { const c = K.readCodes(m[i], out); if (c) p[part.k] = c; else p.$bad = true; }); break; }
      case 'code': { src += sep('') + '(\\S+?)'; const i = ++g; readers.push((m, p, K, out) => { const c = K.readCodes(m[i], out); if (c && c.length === 1) p[part.k] = c[0]; else p.$bad = true; }); break; }
      case 'num': src += sep('') + numSlot(part.k, set); break;
      case 'who': { src += sep('') + '(.+)'; const i = ++g; readers.push((m, p, K, out) => { const w = K.readWho(m[i], out); if (w) p[part.k] = w; else p.$bad = true; }); break; }
      case 'choice': {
        const alts = part.o.map(([value, words]) => {
          const i = ++g;
          readers.push((m, p) => { if (m[i] != null) p[part.k] = value; });
          const inner = typeof words === 'string' ? lit(words)
            : words.map(q => (typeof q === 'string' ? lit(q) : numSlot(q.k, set))).join('\\s+');
          return `(${inner})`;
        });
        src += sep('') + `(?:${alts.join('|')})`;
        break;
      }
      case 'flag': { src += `(\\s*,\\s*${lit(part.t)})?`; const i = ++g; readers.push((m, p) => { p[part.k] = m[i] != null; }); break; }
      case 'opt': {
        const [a, b] = part.t.split('#');
        src += `(?:\\s*,\\s*${lit(a)}\\s*${NUM}${b && b.trim() ? '\\s*' + lit(b) : ''})?`;
        const i = ++g;
        readers.push((m, p) => { p[part.k] = m[i] != null ? Number(m[i]) : part.d; });
        break;
      }
      case 'range': {
        src += sep('') + '(?:(on\\s+the\\s+next\\s+day)|on\\s+the\\s+next\\s+(\\d+)\\s+days|(on\\s+the\\s+day\\s+before)|on\\s+the\\s+(\\d+)\\s+days\\s+before|on\\s+days?\\s+([+-]?\\d+)(?:\\s+to\\s+([+-]?\\d+))?)';
        const i = g; g += 6;
        readers.push((m, p) => {
          const [kf, kt] = part.k;
          if (m[i + 1] != null) { p[kf] = 1; p[kt] = 1; }
          else if (m[i + 2] != null) { p[kf] = 1; p[kt] = Number(m[i + 2]); }
          else if (m[i + 3] != null) { p[kf] = -1; p[kt] = -1; }
          else if (m[i + 4] != null) { p[kf] = -Number(m[i + 4]); p[kt] = -1; }
          else { p[kf] = Number(m[i + 5]); p[kt] = m[i + 6] != null ? Number(m[i + 6]) : Number(m[i + 5]); }
        });
        break;
      }
      default: break;
    }
  }
  const c = { re: new RegExp(src + '$', 'i'), readers };
  compiled.set(form, c);
  return c;
}

// The sentence (after the who and before the when) -> { type, params } or null.
function readBody(body, K, out) {
  const tried = [];
  for (const [type, form] of Object.entries(TEXT_FORMS)) {
    if (!RULE_TYPES[type]) continue;
    const { re, readers } = compileForm(form);
    const m = re.exec(body.trim());
    if (!m) continue;
    const p = {}, probs = [];
    for (const r of readers) r(m, p, K, probs);
    if (!p.$bad) return { type, params: p };
    tried.push(...probs);
  }
  if (tried.length) out.push(...tried);
  else out.push('The sentence doesn\'t match any kind of rule (see the examples)');
  return null;
}

// Split a sentence into who, body and when. The who is the part before the first ": ", the when a closing (…).
function readSentence(text, K, out) {
  let rest = text.trim(), when = null, who = null;
  const wm = /\s*\(([^()]*)\)\s*$/.exec(rest);
  if (wm) {
    const probs = [];
    const w = readWhen(wm[1], probs);
    if (w) { when = w; rest = rest.slice(0, wm.index); }
    else if (/^\s*(weekends|weekdays|every day|from|until|public|except|sun|mon|tue|wed|thu|fri|sat)/i.test(wm[1])) { out.push(...probs); return null; }
  }
  const c = rest.indexOf(': ');
  if (c > 0) {
    who = K.readWho(rest.slice(0, c), out);
    if (!who) return null;
    rest = rest.slice(c + 2);
  }
  const body = readBody(rest, K, out);
  if (!body) return null;
  return { ...body, who: who || { groups: [], tags: [], staff: [], exclude: [] }, when: when || { from: '', to: '', days: [], holidays: 'any' } };
}

// Keep the old value when the new one says the same (lists in another order), so an untouched line is "the same".
function keepSame(old, neu) {
  if (Array.isArray(old) && Array.isArray(neu)) return old.length === neu.length && sameSet(old.map(String), neu.map(String)) ? old : neu;
  if (isObj(old) && isObj(neu)) { const o = { ...neu }; for (const k of Object.keys(neu)) if (k in old) o[k] = keepSame(old[k], neu[k]); return o; }
  return old === neu ? old : neu;
}

// A rule from its parts: { status: { enabled, hard, weight }, name, sentence | parsed, note, id }, over the rule with
// that id (fields the text doesn't show stay as they were).
function buildRule(parts, old, pool, K, out) {
  const s = parts.parsed || readSentence(parts.sentence, K, out);
  if (!s) return null;
  const t = RULE_TYPES[s.type];
  if (parts.status.hard && t.soft_only) { out.push(`${t.label} rules are always preferences: write PREF and a priority`); return null; }
  const base = old && old.type === s.type ? structuredClone(old)
    : { ...(old ? structuredClone(old) : {}), type: s.type, params: t.defaults() };
  const rule = { ...base, id: parts.id || '', type: s.type, enabled: parts.status.enabled, hard: parts.status.hard };
  if (!parts.status.hard) rule.weight = parts.status.weight;
  else if (rule.weight == null) rule.weight = 10;
  rule.name = parts.name || '';
  rule.note = old && flat(old.note) === flat(parts.note) ? old.note : (parts.note || '');
  rule.who = keepSame(base.who, { ...(isObj(base.who) ? base.who : {}), ...s.who });
  rule.when = keepSame(base.when, { ...(isObj(base.when) ? base.when : {}), ...s.when });
  rule.params = keepSame(base.params, { ...(isObj(base.params) ? base.params : {}), ...s.params });
  if (!rule.pool && pool) rule.pool = pool;
  if (old && canon(old) === canon(rule)) return old;
  return rule;
}

const STATUS_RE = /^(off\s+)?(must(?:\s+hold)?|pref(?:erence)?\s+(\d+))(?=\s|$)\s*/i;
function readStatus(text) {
  const m = STATUS_RE.exec(text);
  if (!m) return null;
  return { status: { enabled: !m[1], hard: !m[3], weight: m[3] ? clampW(m[3]) : null }, rest: text.slice(m[0].length) };
}

function finish(items, opts, problems) {
  const known = new Map((opts.rules || []).map(r => [r.id, r]));
  const seen = new Set(items.kept);
  const rules = [];
  for (const it of items.list) {
    if (it.id && seen.has(it.id)) it.id = '';   // a copied line becomes a new rule
    if (it.id) seen.add(it.id);
    const probs = [];
    const r = buildRule(it, it.id ? known.get(it.id) : null, opts.pool, items.K, probs);
    if (r) rules.push(r);
    else {
      problems.push(`${it.where}: ${probs.join('; ')}`);
      if (it.id) seen.add(it.id);   // a line that can't be read never deletes its rule
    }
  }
  const removed = (opts.rules || []).filter(r => !seen.has(r.id));
  return { rules, removed, problems };
}

// Lines -> rules. opts.rules: the rules the text was made from (matched by [id]; any missing from the text are
// `removed`); opts.pool: the roster for new rules.
export function parseRuleLines(text, state, opts = {}) {
  const K = opts.K || kit(state);
  const problems = [], list = [], kept = [];
  String(text || '').split(/\r?\n/).forEach((raw, n) => {
    let line = raw.trim();
    if (!line) return;
    const idm = /\s*\[([^\]\s]+)\]\s*$/.exec(line);
    if (line.startsWith('#')) { if (idm) kept.push(idm[1]); return; }
    const id = idm ? idm[1] : '';
    if (idm) line = line.slice(0, idm.index);
    const where = `Line ${n + 1}`;
    const st = readStatus(line);
    if (!st) { problems.push(`${where}: start with MUST, or PREF and a priority (PREF 20)`); if (id) kept.push(id); return; }
    let rest = st.rest, note = '', name = '';
    const ni = rest.indexOf(' // ');
    if (ni >= 0) { note = rest.slice(ni + 4).trim(); rest = rest.slice(0, ni); } else if (rest.startsWith('// ')) { note = rest.slice(3).trim(); rest = ''; }
    const ei = rest.indexOf(' = ');
    if (ei >= 0) { name = rest.slice(0, ei).trim(); rest = rest.slice(ei + 3); }
    list.push({ where, status: st.status, name, note, id, sentence: rest });
  });
  return finish({ list, kept, K }, opts, problems);
}

// ---------- the readable rules file (one block per rule) ----------
const FILE_HEADER = [
  '# NTF roster rules. One block per rule, starting with "- name:"; fields: strength (must hold, or preference 1 to 100),',
  '# on (yes or no), roster (junior or senior), who, rule (the sentence), when, note (more lines indented further), id.',
  '# Leave out who for everyone and when for every day. Lines starting with # are ignored.',
];
export function rulesToFile(state, rules = state.rules || []) {
  const K = kit(state);
  const out = [...FILE_HEADER];
  for (const r of rules) {
    out.push('');
    const parts = sentenceParts(r, state, K);
    const who = K.whoText(r.who);
    const block = [`- name: ${String(r.name || '').replace(/\s*\n\s*/g, ' ')}`.trimEnd()];
    const t = RULE_TYPES[r.type] || {};
    block.push(`  strength: ${r.hard !== false && !t.soft_only ? 'must hold' : `preference ${clampW(r.weight)}`}`);
    block.push(`  on: ${r.enabled === false ? 'no' : 'yes'}`);
    if (r.pool) block.push(`  roster: ${r.pool}`);
    let ok = parts && who != null;
    if (ok) {
      if (who !== 'everyone') block.push(`  who: ${cap(who)}`);
      block.push(`  rule: ${cap(joinParts(parts))}`);
      const w = whenText(r.when);
      if (w) block.push(`  when: ${w}`);
    }
    if (r.note) { const [first, ...more] = String(r.note).split('\n'); block.push(`  note: ${first}`, ...more.map(x => `    ${x}`)); }
    if (r.id) block.push(`  id: ${r.id}`);
    if (ok) {
      const back = parseRulesFile(block.join('\n'), state, { rules: [r], K });
      ok = back.rules.length === 1 && !back.problems.length && canon(back.rules[0]) === canon(r);
    }
    if (!ok) block.splice(1, block.length - 1, `  json: ${JSON.stringify(r)}`);
    out.push(...block);
  }
  return out.join('\n') + '\n';
}

export const looksLikeRulesFile = text => /^-\s+name:/m.test(String(text || ''));

export function parseRulesFile(text, state, opts = {}) {
  const K = opts.K || kit(state);
  const problems = [], list = [], kept = [], raw = [];
  let cur = null;
  String(text || '').split(/\r?\n/).forEach((line, n) => {
    if (/^\s*#/.test(line)) return;
    const start = /^-\s+name:\s?(.*)$/.exec(line);
    if (start) { cur = { at: n + 1, f: { name: start[1].trim() }, last: 'name' }; raw.push(cur); return; }
    if (!cur || !line.trim()) return;
    const kv = /^\s{1,3}(\w+):\s?(.*)$/.exec(line);
    if (kv) { cur.f[kv[1].toLowerCase()] = kv[2].trim(); cur.last = kv[1].toLowerCase(); return; }
    if (cur.last === 'note' && /^\s{4}/.test(line)) { cur.f.note += '\n' + line.slice(4); return; }
    problems.push(`Line ${n + 1}: "${line.trim()}" is not "field: value"`);
  });
  for (const b of raw) {
    const f = b.f, where = `Rule at line ${b.at}${f.name ? ` ("${f.name}")` : ''}`;
    if (f.json) {
      try { const r = JSON.parse(f.json); if (isObj(r) && RULE_TYPES[r.type]) { list.push({ where, json: r, id: r.id || '' }); continue; } } catch (e) { /* below */ }
      problems.push(`${where}: the json field can't be read`); if (f.id) kept.push(f.id); continue;
    }
    const sm = /^(must hold|must|preference\s+(\d+)|pref\s+(\d+))$/i.exec(f.strength || 'must hold');
    if (!sm) { problems.push(`${where}: strength is "must hold" or "preference" and a number`); if (f.id) kept.push(f.id); continue; }
    const wt = sm[2] || sm[3];
    const on = !/^(no|off|false)$/i.test(f.on || 'yes');
    if (!f.rule) { problems.push(`${where}: no rule: line`); if (f.id) kept.push(f.id); continue; }
    if (f.roster && !['junior', 'senior'].includes(f.roster.toLowerCase())) { problems.push(`${where}: roster is junior or senior`); if (f.id) kept.push(f.id); continue; }
    const sentence = `${f.who ? `${f.who}: ` : ''}${f.rule}${f.when ? ` (${f.when})` : ''}`;
    list.push({ where, status: { enabled: on, hard: !wt, weight: wt ? clampW(wt) : null }, name: f.name, note: f.note || '', id: f.id || '', sentence, pool: f.roster ? f.roster.toLowerCase() : '' });
  }
  const res = finishFile({ list, kept, K }, opts, problems);
  return { ...res, removed: [] };
}
function finishFile(items, opts, problems) {
  const json = items.list.filter(x => x.json);
  const res = finish({ ...items, list: items.list.filter(x => !x.json) }, opts, problems);
  // the roster written in the file wins; json blocks come back as written
  for (const r of res.rules) {
    const it = items.list.find(x => !x.json && (x.id ? x.id === r.id : false));
    if (it && it.pool && r.pool !== it.pool) r.pool = it.pool;
  }
  return { ...res, rules: [...res.rules, ...json.map(x => x.json)] };
}

export { kit as textKit };

// One example sentence per rule type, using this roster's codes (for the help under Edit as text).
export function textExamples(state) {
  const K = kit(state);
  const has = c => (state.duties || []).some(d => d.code === c);
  const C = has('C') ? 'C' : ((state.duties || []).find(d => d.kind === 'shift') || {}).code;
  if (!C) return [];
  const req = ((state.duties || []).find(d => d.kind === 'request') || {}).code;
  const ex = [
    { type: 'cover', hard: true, params: { codes: [C], min: 2, max: 2 } },
    { type: 'limit', hard: true, params: { codes: [C], period: 'month', max: 7, fte: true } },
    { type: 'sequence', hard: false, weight: 20, params: { ifCodes: [C], thenCodes: [C], mode: 'forbid', from: 1, to: 2 } },
    { type: 'sameDay', hard: true, params: { codesA: ['@leave'], codesB: ['@shift'], mode: 'forbid' } },
    { type: 'together', hard: true, params: { codes: [C], other: { groups: [], tags: [], staff: [], exclude: [] }, otherCodes: [C], mode: 'needs', min: 1 } },
    { type: 'maxRun', hard: false, weight: 20, params: { codes: ['@shift'], max: 5 } },
    req && { type: 'requests', hard: false, weight: 10, params: { request: req, codes: [C], mode: 'avoid', span: 'day' } },
    { type: 'spread', hard: false, weight: 5, params: { codes: [C], period: 'month', weekendWeight: 2, holidayWeight: 2, tolerance: 1 } },
    { type: 'eligible', hard: true, params: { codes: [C] } },
    { type: 'standing', hard: true, when: { days: [2] }, params: { codes: ['@present'] } },
  ].filter(Boolean);
  return ex.map(r => ({ type: r.type, label: RULE_TYPES[r.type].label, line: lineOf(normalizeRule({ ...r, enabled: true }), state, K) })).filter(x => x.line);
}
