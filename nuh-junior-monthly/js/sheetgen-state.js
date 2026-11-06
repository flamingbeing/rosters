// The app's month as a sheet spec for sheetgen.js: the people in sheet order, what each cell would show in the department's
// sheet (the same text "Put it back" gives), WE on weekends and PH on public holidays where nothing else is, and the post call
// on the 1st of next month. Seniors (HOD, SC, consultants) are not in the app; with { seniors: true } their rows come from the
// latest month whose sheet was imported (names and grades as typed there), at the top, with only WE and PH in their days.
// Each person's grade is the one typed in that sheet too when it is one of their group's grades (HC stays HC, not RP).
import * as M from './model.js';
import { cellText } from './sheet.js';

// The latest imported month's layout that kept the grade texts (imports from 6 Nov 2026 on), up to `month` if one is there.
export function latestLayout(state, month) {
  const all = Object.entries(state.sheets || {}).filter(([, l]) => l && l.gradeTexts && l.names).sort(([a], [b]) => a.localeCompare(b));
  const upTo = all.filter(([m]) => m <= month);
  const pick = (upTo.length ? upTo : all).pop();
  return pick ? { month: pick[0], layout: pick[1] } : null;
}

// The seniors' rows of an imported layout: rows the app left alone that hold no one it knows, in sheet order.
export function seniorRows(layout, seniorGrades = ['HOD', 'SC', 'C']) {
  return Object.keys(layout.names).map(Number).sort((a, b) => a - b)
    .filter(r => !layout.rows[r] && seniorGrades.includes(String(layout.gradeTexts[r] || '').toUpperCase()) && String(layout.names[r] || '').trim())
    .map(r => ({ grade: layout.gradeTexts[r], name: String(layout.names[r]).trim() }));
}

export function specFromState(state, month, { title, seniors = false } = {}) {
  const gmap = M.groupMap(state), dmap = M.dutyMap(state);
  const days = M.monthDays(month);
  const hol = (state.settings && state.settings.holidays) || {};
  const holidayDays = days.map((d, i) => (hol[d] ? i + 1 : 0)).filter(Boolean);
  const offText = d => { const wd = M.weekday(d); return hol[d] ? 'PH' : wd === 0 || wd === 6 ? 'WE' : ''; };
  const last = latestLayout(state, month);
  const typed = new Map();   // person id -> the grade typed in the latest sheet
  if (last) for (const [r, id] of Object.entries(last.layout.rows || {})) if (last.layout.gradeTexts[r]) typed.set(id, last.layout.gradeTexts[r]);
  const people = M.staffInMonth(state, month).map(p => {
    const g = gmap.get(p.group) || {};
    const cellsOut = {};
    days.forEach((d, i) => {
      const t = cellText(state, d, p.id) || offText(d);
      if (t) cellsOut[i + 1] = t;
    });
    const lastCell = M.getCell(state, days[days.length - 1], p.id);
    const next = lastCell && (lastCell.a || []).some(c => (dmap.get(c) || {}).overnight) ? 'PC' : '';
    const t = typed.get(p.id), grades = (g.grades || []).map(x => String(x).toUpperCase());
    const grade = t && grades.includes(t.toUpperCase()) ? t : (g.grades && g.grades[0]) || g.name || p.group;
    return { grade, name: p.name, days: cellsOut, next };
  });
  const top = seniors && last ? seniorRows(last.layout).map(s => {
    const cellsOut = {};
    days.forEach((d, i) => { const t = offText(d); if (t) cellsOut[i + 1] = t; });
    return { ...s, days: cellsOut, next: '' };
  }) : [];
  return { month, people: [...top, ...people], holidays: holidayDays, ...(title ? { title } : {}), ...(seniors ? { seniorsFrom: last ? last.month : null } : {}) };
}
