// NTF Roster: how much each call request (Cr) and no-call request (Nc) counts, so the people who ask for a lot don't
// crowd out the ones who ask for little. Each person's first `cap` of these in a month (by date, 2 unless Settings say
// otherwise) count in full; later ones are "if possible", and weaker the more that person asked for. The rosterer can
// mark any one: "!" counts in full whatever its place (a hard rule stays hard), "?" is only "if possible".
// The marks live in the cell (cell.rp = { Cr: '!' }); everything else is worked out here, from the cells alone.

export const FAIR_CODES = ['Cr', 'Nc'];
export const MARKS = ['!', '?'];
export const DEFAULT_CAP = 2;
// an "if possible" request under a hard rule (Nc) becomes soft at this weight, scaled down by how many the person asked for
export const LOW_FROM_HARD = 60;

export const capOf = state => {
  const c = state && state.settings && state.settings.requestCap;
  return Number.isInteger(c) && c >= 0 && c <= 31 ? c : DEFAULT_CAP;
};
export const isFair = code => FAIR_CODES.includes(code);

// "Cr!" -> { code: 'Cr', mark: '!' }; "Cr" -> { code: 'Cr', mark: '' }
export function splitMark(tok) {
  const t = String(tok || '');
  const last = t.slice(-1);
  return t.length > 1 && MARKS.includes(last) ? { code: t.slice(0, -1), mark: last } : { code: t, mark: '' };
}

// Every Cr/Nc in one month, with its level. cellsOf(date) -> { staffId: cell }. staffIds: whose to count (all when null).
// Returns Map `${date}|${staffId}|${code}` -> { date, staffId, code, mark, level: 'must' | 'normal' | 'low', rank, count, factor }
// rank: its place among the person's requests that month that are not marked "?" (0-based, by date then code; -1 for "?").
// factor: how much an "if possible" one still counts (cap / count, or 1/2 for a "?" when the person is within the cap).
export function monthPriorities(dates, cellsOf, cap = DEFAULT_CAP, staffIds = null) {
  const per = new Map();   // staffId -> [{ date, code, mark }]
  for (const d of dates) {
    const day = cellsOf(d) || {};
    for (const [sid, cell] of Object.entries(day)) {
      if (staffIds && !staffIds.has(sid)) continue;
      for (const code of (cell && cell.r) || []) {
        if (!isFair(code)) continue;
        const mark = (cell.rp && MARKS.includes(cell.rp[code])) ? cell.rp[code] : '';
        if (!per.has(sid)) per.set(sid, []);
        per.get(sid).push({ date: d, code, mark });
      }
    }
  }
  const out = new Map();
  for (const [sid, list] of per) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1));
    const count = list.length;
    let rank = 0;
    for (const x of list) {
      const r = x.mark === '?' ? -1 : rank++;
      const level = x.mark === '!' ? 'must' : x.mark === '?' ? 'low' : r < cap ? 'normal' : 'low';
      const factor = level !== 'low' ? 1 : count > cap ? Math.max(cap, 1) / count : 0.5;
      out.set(`${x.date}|${sid}|${x.code}`, { date: x.date, staffId: sid, code: x.code, mark: x.mark, level, rank: r, count, factor });
    }
  }
  return out;
}

// The penalty and hardness of one unmet request. u: the rule's unit (1000 when hard); hard: the rule is hard.
export function weigh(p, u, hard) {
  if (!p || p.level === 'normal') return { pen: u, hard };
  if (p.level === 'must') return { pen: hard ? u : u * 3, hard };
  return { pen: Math.max(1, Math.round((hard ? LOW_FROM_HARD : u) * p.factor)), hard: false };
}

export const LEVEL_WORDS = { must: 'Must (!)', normal: 'Counts in full', low: 'If possible' };
