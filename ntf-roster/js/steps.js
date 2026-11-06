// NTF Roster: the junior roster in three steps (import the department sheet, fill, download the filled sheet). The
// call-list guesses an import makes, the rule-by-rule report after a fill, and where each step stands. Plain
// functions over plain data; the screens are in ui-steps.js.

import * as M from './model.js';
import { levelOf, tagsFor, installJuniorPool } from './jpool.js';

// ---------- call list guesses ----------

// A person's call level guessed from their section in the sheet: resident physicians (senior and not) and junior
// residents from R2 up are the senior MO on call (MO1); R1s and medical officers are the junior MO on call (MO2).
// Locums (they take no calls, PM shifts or half calls), senior sections, nurses and anyone else: not on the call list.
// Only a guess: the rosterer checks it once.
// A Baby MO (the "(B)" after the name in the sheet, or the Baby MO tag) is the junior MO on call, weak, and gets the
// Baby MO tag so its pairing rules apply.
export const isBabyMo = p => !!p && ((p.tags || []).includes('babymo') || /(^|[·,])\s*B\s*([·,]|$)/.test(p.note || ''));
export const guessStrength = p => (guessLevel(p) === 'mo1' && isBabyMo(p) ? 'weak' : '');

export function guessLevel(p) {
  const g = p && p.group;
  if (g === 'srp' || g === 'rp') return 'mo2';
  if (g === 'jr') return /\bR1\b/i.test(`${p.note || ''} ${p.name || ''}`) ? 'mo1' : 'mo2';
  if (g === 'mo') return 'mo1';
  return '';
}

// Has the rosterer said where this person stands (a level, or "not on the call list" on purpose)?
export const levelDecided = p => !!levelOf(p) || (p && p.lvl === 'off');
export const isGuessed = p => !!(p && p.lvl === 'guess');

// After an import, in a draft: everyone in the junior pool this month whose level was never decided gets the guess
// (marked as a guess until the rosterer checks the list), and the junior rules are added the first time.
// Returns { guessed: [ids], rulesAdded: n }.
export function autoSetupPool(draft, month) {
  const guessed = [];
  const people = new Set(M.staffInMonth(draft, month).map(p => p.id));
  for (const p of draft.staff || []) {
    if (!people.has(p.id) || p.group === 'nurse' || M.poolOf(draft, p) !== 'junior' || levelDecided(p)) continue;
    const lvl = guessLevel(p);
    if (!lvl) { p.lvl = 'off'; continue; }
    const strength = guessStrength(p);
    p.tags = tagsFor(p.tags, lvl, strength);
    if (strength && !p.tags.includes('babymo')) p.tags.push('babymo');
    p.lvl = 'guess';
    guessed.push(p.id);
  }
  let rulesAdded = 0;
  if (guessed.length || (draft.staff || []).some(p => levelOf(p))) {
    if (!draft.settings.jpRules) rulesAdded = installJuniorPool(draft);
  }
  return { guessed, rulesAdded };
}

// Set one person's level from the call list check (the guess mark goes; "not on the call list" is remembered).
export function setLevel(draft, id, level, strength = '') {
  const p = (draft.staff || []).find(x => x.id === id);
  if (!p) return false;
  p.tags = tagsFor(p.tags, level, strength);
  if (level) delete p.lvl; else p.lvl = 'off';
  if (level && !draft.settings.jpRules) installJuniorPool(draft);
  return true;
}

// "Looks right": every guess in the list becomes the rosterer's own choice.
export function confirmGuesses(draft, ids = null) {
  let n = 0;
  for (const p of draft.staff || []) {
    if (!isGuessed(p) || (ids && !ids.includes(p.id))) continue;
    delete p.lvl;
    n++;
  }
  return n;
}

// ---------- the rule-by-rule report ----------

// Every switched-on rule of a (pool-scoped) state, with how often it is broken in an evaluation of the month:
// [{ id, name, hard, n, msgs: [text] }], must-hold rules first, broken ones first within each.
export function ruleReport(state, evaluation, describe = r => r.name || r.id) {
  const byRule = new Map();
  for (const v of (evaluation && evaluation.violations) || []) {
    if (!byRule.has(v.ruleId)) byRule.set(v.ruleId, []);
    byRule.get(v.ruleId).push(v);
  }
  const rows = [];
  for (const r of state.rules || []) {
    if (r.enabled === false) continue;
    const vs = byRule.get(r.id) || [];
    let name = r.name;
    if (!name) { try { name = describe(r); } catch (e) { name = r.id; } }
    rows.push({ id: r.id, name: name || r.id, hard: r.hard !== false, n: vs.length, msgs: vs.map(v => v.msg || '').filter(Boolean) });
  }
  return rows.sort((a, b) => (b.hard - a.hard) || ((b.n > 0) - (a.n > 0)));
}

// ---------- where the month stands ----------

// { imported, filled, exported }: the month came from the department sheet, has auto-filled calls, and the filled sheet
// was downloaded after the last change (settings.jsteps: { [month]: { imported, exported } } ISO times).
export function stepState(state, month) {
  const s = ((state.settings && state.settings.jsteps) || {})[month] || {};
  let filled = false;
  for (const d of M.monthDays(month)) {
    const day = (state.cells || {})[d];
    if (!day) continue;
    for (const c of Object.values(day)) if ((c.a || []).includes('C')) { filled = true; break; }
    if (filled) break;
  }
  return { imported: !!s.imported, filled, exported: !!s.exported && !!s.imported && s.exported >= s.imported, at: s };
}

// Note a step in a draft (import or export of a month).
export function markStep(draft, month, step, at = new Date().toISOString()) {
  if (!draft.settings.jsteps || typeof draft.settings.jsteps !== 'object') draft.settings.jsteps = {};
  draft.settings.jsteps[month] = { ...(draft.settings.jsteps[month] || {}), [step]: at };
}

// The filled sheet of a month was downloaded (quiet: not an undo step).
export function noteExported(store, month, at = new Date().toISOString()) {
  const all = (store.get().settings && store.get().settings.jsteps) || {};
  store.setQuiet('jsteps', { ...all, [month]: { ...(all[month] || {}), exported: at } });
}
