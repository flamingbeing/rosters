// NTF Roster: rotations from APMES People. People sends one word per person per week (see people/NOTES.md); this file reads
// that text, works out what it would change for the month on screen, and applies it. No page code here, so node can test it.
//
// The words: NTF (posted here: nothing to mark), NUH, KKH, TTSH, OTH (posted at another hospital: away from the NTF pool),
// and the leave codes AL, ML, NPL and NS (national service). Only weekdays that are not public holidays are filled, and only
// where the person has no leave or other away code that day yet (the department sheet wins). Shifts already planned stay.
import * as M from './model.js';

// Codes People may send that a fresh roster does not have yet; they are added as "other" (away from the pool) when applied.
export const NEW_CODES = {
  KKH: 'Posted at KKH',
  TTSH: 'Posted at TTSH',
  OTH: 'Posted at another hospital',
  NS: 'National service',
};
const SENT = new Set(['NTF', 'NUH', 'AL', 'ML', 'NPL', ...Object.keys(NEW_CODES)]);
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// Monday on or before a date
const mondayOf = s => M.addDays(s, -((M.weekday(s) + 6) % 7));

// What the roster tells People: its names and the Mondays of the weeks the month touches.
export function pullInfo(state, month) {
  const days = M.monthDays(month);
  return {
    type: 'ntf-pull-info',
    names: M.staffInMonth(state, month).map(p => p.name).filter(Boolean),
    from: mondayOf(days[0]), to: mondayOf(days[days.length - 1]), month,
  };
}

// The pasted text: a header row ("Name", then the Mondays) and one row per person, tab separated.
// -> { weeks: [monday], rows: [{ name, words: [word|''] }], bad: n } (bad: lines that could not be read)
export function parseRotations(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  const head = (lines.shift() || '').split('\t').map(x => x.trim());
  const weeks = head.slice(1);
  if (head[0].toLowerCase() !== 'name' || !weeks.length || !weeks.every(w => /^\d{4}-\d{2}-\d{2}$/.test(w))) return { weeks: [], rows: [], bad: lines.length + 1 };
  const rows = [];
  let bad = 0;
  for (const l of lines) {
    const c = l.split('\t').map(x => x.trim());
    if (!c[0]) { bad++; continue; }
    rows.push({ name: c[0], words: weeks.map((_, i) => c[i + 1] || '') });
  }
  return { weeks, rows, bad };
}

// What applying would do for `month`: { fills: [{ date, staffId, code }], people, posted, unmatched, busy, ignored, newCodes, byCode }
//   people     matched people with something to fill      posted     matched people posted at NTF in some week of the month
//   unmatched  names that are not in this roster          busy       days left alone because the person already has an away code
//   ignored    words this version does not know           newCodes   codes to add to the duties first
export function planRotations(parsed, state, month) {
  const plan = { fills: [], people: 0, posted: 0, unmatched: [], busy: 0, ignored: 0, newCodes: [], byCode: {} };
  const inMonth = new Set(M.monthDays(month));
  const staffByName = new Map(M.staffInMonth(state, month).map(p => [norm(p.name), p]));
  const kindOf = new Map((state.duties || []).map(d => [d.code, d.kind]));
  const away = c => kindOf.get(c) === 'leave' || kindOf.get(c) === 'other';
  const need = new Set();
  for (const r of parsed.rows) {
    const person = staffByName.get(norm(r.name));
    if (!person) { plan.unmatched.push(r.name); continue; }
    let filled = 0, posted = false;
    parsed.weeks.forEach((monday, i) => {
      const word = r.words[i];
      if (!word) return;
      if (!SENT.has(word)) { plan.ignored++; return; }
      for (let k = 0; k < 5; k++) {
        const date = M.addDays(monday, k);
        if (!inMonth.has(date) || M.isHoliday(state, date) || !M.staffActiveOn(person, date)) continue;
        if (word === 'NTF') { posted = true; continue; }
        const cur = M.getCell(state, date, person.id);
        if ((cur && (cur.a || []).some(away)) || plan.fills.some(f => f.date === date && f.staffId === person.id)) { plan.busy++; continue; }
        plan.fills.push({ date, staffId: person.id, code: word });
        plan.byCode[word] = (plan.byCode[word] || 0) + 1;
        if (!kindOf.has(word)) need.add(word);
        filled++;
      }
    });
    if (filled) plan.people++;
    if (posted) plan.posted++;
  }
  plan.newCodes = [...need];
  return plan;
}

// Call inside store.commit (one undo step). -> { cells, codesAdded }
export function applyRotations(draft, plan) {
  const sum = { cells: 0, codesAdded: [] };
  for (const code of plan.newCodes) {
    if ((draft.duties || []).some(d => d.code === code)) continue;
    draft.duties.push({ code, name: NEW_CODES[code] || code, kind: 'other', color: '#e0e0e0', ink: '#333', overnight: false, auto: false, hours: 0 });
    sum.codesAdded.push(code);
  }
  for (const f of plan.fills) {
    const cur = M.getCell(draft, f.date, f.staffId);
    M.setCell(draft, f.date, f.staffId, { a: [...((cur && cur.a) || []), f.code] });
    sum.cells++;
  }
  return sum;
}
