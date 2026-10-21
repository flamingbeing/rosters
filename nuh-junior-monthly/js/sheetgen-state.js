// The app's month as a sheet spec for sheetgen.js: the people in sheet order, what each cell would show in the department's
// sheet (the same text "Put it back" gives), WE on weekends and PH on public holidays where nothing else is, and the post call
// on the 1st of next month. Seniors (HOD, SC, consultants) are not in the app unless they were added, so their rows are not
// here: the trial sheet has the people the app knows.
import * as M from './model.js';
import { cellText } from './sheet.js';

export function specFromState(state, month, { title } = {}) {
  const gmap = M.groupMap(state), dmap = M.dutyMap(state);
  const days = M.monthDays(month);
  const hol = (state.settings && state.settings.holidays) || {};
  const holidayDays = days.map((d, i) => (hol[d] ? i + 1 : 0)).filter(Boolean);
  const people = M.staffInMonth(state, month).map(p => {
    const g = gmap.get(p.group) || {};
    const cellsOut = {};
    days.forEach((d, i) => {
      let t = cellText(state, d, p.id);
      if (!t) { const wd = M.weekday(d); if (hol[d]) t = 'PH'; else if (wd === 0 || wd === 6) t = 'WE'; }
      if (t) cellsOut[i + 1] = t;
    });
    const lastCell = M.getCell(state, days[days.length - 1], p.id);
    const next = lastCell && (lastCell.a || []).some(c => (dmap.get(c) || {}).overnight) ? 'PC' : '';
    return { grade: (g.grades && g.grades[0]) || g.name || p.group, name: p.name, days: cellsOut, next };
  });
  return { month, people, holidays: holidayDays, ...(title ? { title } : {}) };
}
