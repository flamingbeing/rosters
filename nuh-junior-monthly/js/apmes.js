// NUH Junior Monthly → APMES People (apmes.anawj.com/people/, the resident list the logbook and evals share).
// People › Import from the monthly roster asks for this app's staff list: it opens this app with ?send=apmes and gets the
// list back by postMessage once the user says Send, or the user copies it here (More › Export) and pastes it there. Names, grades and
// start and leave dates only (no roster, no notes); People compares the grades with its residents' years and lists
// the changes for the user to tick.

import * as M from './model.js';

// Where APMES People lives. On a preview or localhost both apps share one origin, so that one is allowed too.
export const APMES_ORIGIN = 'https://apmes.anawj.com';

// The list as tab-separated text: a first line naming the roster month the grades are for (the last month imported
// from the sheet, else this month), then Grade, Name, From, Until for everyone in post today or later, in sheet order.
// The grade is the sheet's own word for the group (RES2, R, AC…), so the department sheet's grid pastes the same way.
export function apmesList(state, { today = M.iso(new Date()) } = {}) {
  const months = Object.keys(state.sheets || {}).filter(m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m)).sort();
  const month = months.length ? months[months.length - 1] : M.monthOf(today);
  const groups = new Map((state.groups || []).map((g, i) => [g.id, { g, i }]));
  const clean = s => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
  const people = (state.staff || [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.active !== false && !(p.end && p.end < today) && clean(p.name))
    .sort((a, b) => ((groups.get(a.p.group)?.i ?? 999) - (groups.get(b.p.group)?.i ?? 999)) || a.i - b.i)
    .map(({ p }) => {
      const g = groups.get(p.group)?.g;
      const grade = g ? ((g.grades || [])[0] || g.id.toUpperCase()) : '';
      return [grade, clean(p.name), p.start || '', p.end || ''];
    });
  const text = [`NUH Junior Monthly staff, roster month ${month}, copied ${today}`, 'Grade\tName\tFrom\tUntil',
    ...people.map(r => r.map(clean).join('\t'))].join('\n') + '\n';
  return { text, count: people.length, month };
}

// Copy the list (More › Export, and the Send sheet when this tab wasn't opened by APMES People).
export async function copyForApmes(app) {
  const { text, count } = apmesList(app.store.get());
  try {
    await navigator.clipboard.writeText(text);
    app.toast(`Copied ${count} people: paste them in APMES People › Import from the monthly roster`, { ms: 6000 });
    return true;
  } catch (e) {
    app.toast('Copying was blocked by the browser. Try again, or use Send from APMES People.', { kind: 'warn' });
    return false;
  }
}

// Opened by APMES People (?send=apmes): ask, then send the list back to the tab that opened this one and close.
export function offerSend(app) {
  const { h } = app;
  const st = app.store.get();
  const { count, month } = apmesList(st);
  const opener = (() => { try { return window.opener && !window.opener.closed ? window.opener : null; } catch (e) { return null; } })();
  const body = h('div', { class: 'bx-form' },
    h('p', null, count
      ? `APMES People asked for this app's staff list: ${count} ${count === 1 ? 'person' : 'people'}, grades as in ${M.fmtMonth(month)}.`
      : 'APMES People asked for the staff list, but there is nobody on People › Staff in this browser yet. Sign in under More › Cloud to pull the roster, or ask the rosterer to copy the list (More › Export) and send it to you.'),
    h('p', { class: 'bx-help' }, 'It gets names, grades and start and leave dates only: no roster, no notes. Nothing changes there until you tick and apply the changes.'),
    opener ? null : h('p', { class: 'bx-help' }, 'This tab can’t reach APMES People (it was opened another way): copy the list, then paste it there.'));
  // the link forgets the ask straight away, so a reload doesn't ask again (before the sheet adds its history entry)
  try { history.replaceState(history.state, '', location.pathname + (app.isDemo ? '?demo' : '') + location.hash); } catch (e) { /* ignore */ }
  app.sheet({
    title: 'Send the staff list to APMES People?',
    body,
    actions: !count ? [{ label: 'Close' }] : [{ label: 'Cancel' }, opener ? {
      label: `Send ${count} ${count === 1 ? 'person' : 'people'}`, primary: true,
      fn: () => {
        const { text } = apmesList(app.store.get());
        // only APMES People's own address (or this one, on a preview) can receive it
        for (const origin of new Set([APMES_ORIGIN, location.origin])) {
          try { opener.postMessage({ type: 'nuhjm-staff', text }, origin); } catch (e) { /* that origin isn't the opener */ }
        }
        app.toast('Sent to APMES People. You can close this tab.', { ms: 0 });
        setTimeout(() => { try { window.close(); } catch (e) { /* the browser keeps it open */ } }, 600);
      },
    } : { label: 'Copy the list', primary: true, fn: () => copyForApmes(app) }],
  });
}
