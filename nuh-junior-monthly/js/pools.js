// NUH Junior Monthly: the strong / weak pools of the MO1, MO2 and MO3 call levels, from the department's manpower master list.
// The list is a table with a heading row ("Strong MO1", "Weak MO1", "Strong MO2", ...) and one name under each; the other columns
// (Resident, MOPEX, Fellow) are grades the sheet already gives, so they are ignored. Pure (no screen): ui-people.js asks for it.
import { matchStaff } from './waitlist.js';

export const POOLS = [
  { id: 'mo1s', level: 'mo1', head: /^strong\s*mo\s*1$/i },
  { id: 'mo1w', level: 'mo1', head: /^weak\s*mo\s*1$/i },
  { id: 'mo2s', level: 'mo2', head: /^strong\s*mo\s*2$/i },
  { id: 'mo2w', level: 'mo2', head: /^weak\s*mo\s*2$/i },
  { id: 'mo3s', level: 'mo3', head: /^strong\s*mo\s*3$/i },
  { id: 'mo3w', level: 'mo3', head: /^weak\s*mo\s*3$/i },
];
export const POOL_TAGS = POOLS.map(p => p.id);
export const LEVEL_TAGS = ['mo1', 'mo2', 'mo3'];

const clean = s => String(s == null ? '' : s).replace(/[⁠​ ]/g, ' ').replace(/\s+/g, ' ').trim();

// text pasted from the sheet (tab separated; a comma or semicolon also works) -> { found: {mo1s: [names]...}, columns }
export function parsePoolText(text) {
  const rows = String(text || '').split(/\r?\n/).filter(r => r.trim());
  if (!rows.length) return { found: {}, columns: 0, problem: 'Nothing to read.' };
  const sep = rows[0].includes('\t') ? '\t' : rows[0].includes(';') ? ';' : ',';
  const cells = rows.map(r => r.split(sep).map(clean));
  const colOf = {};
  cells[0].forEach((c, i) => { const p = POOLS.find(x => x.head.test(c)); if (p) colOf[p.id] = i; });
  const found = {};
  for (const p of POOLS) {
    if (colOf[p.id] === undefined) continue;
    found[p.id] = cells.slice(1).map(r => r[colOf[p.id]]).filter(Boolean);
  }
  const columns = Object.keys(found).length;
  return { found, columns, problem: columns ? '' : 'No "Strong MO1", "Weak MO1" ... headings found in the first row.' };
}

// which staff go in which pool. Returns { assign: [{ id, pool, level }], unmatched: [names], ambiguous: [names], twice: [names] }
export function matchPools(found, staff) {
  const assign = [], unmatched = [], ambiguous = [], twice = [];
  const seen = new Map();
  for (const p of POOLS) {
    for (const name of found[p.id] || []) {
      const m = matchStaff(name.replace(/\(.*?\)/g, ' '), staff);
      if (!m) { unmatched.push(name); continue; }
      if (m.ambiguous) { ambiguous.push(name); continue; }
      if (seen.has(m.id)) { twice.push(name); continue; }
      seen.set(m.id, p.id);
      assign.push({ id: m.id, pool: p.id, level: p.level });
    }
  }
  return { assign, unmatched, ambiguous, twice };
}

// apply to a state draft: each matched person gets the pool tag and the call level, and loses any other pool or level tag.
// Turns the pool rules on. Returns how many people were set.
export function applyPools(draft, assign) {
  const by = new Map(assign.map(a => [a.id, a]));
  let n = 0;
  for (const p of draft.staff || []) {
    const a = by.get(p.id);
    if (!a) continue;
    p.tags = (p.tags || []).filter(t => !POOL_TAGS.includes(t) && !LEVEL_TAGS.includes(t));
    p.tags.push(a.level, a.pool);
    n++;
  }
  if (n) for (const r of draft.rules || []) if (/^r-pool-\d$/.test(r.id)) r.enabled = true;
  return n;
}
