// NUH Junior Monthly: the Leave tab (step 1, read only). The department sheet's "Leave Waitlist" tab: who is waitlisted for
// leave on each day, and the status of each (the sheet shows it only as a cell colour, which the legend here spells out).
// "Read from the Google Sheet" reads that tab of the month's sheet (the one the month was imported from); nothing is ever
// written to the sheet from here. Changing a status (the daily rosterers' job) comes in a later step.
import * as M from './model.js';
import * as G from './gsheets.js';
import * as W from './waitlist.js';
import * as cloud from './cloud.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// The sheet the month was imported from (or the latest one that was), as { id, gid, title }.
export function sheetSource(state, month) {
  const lays = state.sheets || {};
  if (lays[month] && lays[month].source) return lays[month].source;
  const ms = Object.keys(lays).filter(m => lays[m] && lays[m].source).sort();
  return ms.length ? lays[ms[ms.length - 1]].source : null;
}

export function mount(el, app) {
  const { h, store } = app;
  el.innerHTML = '';
  const root = h('div', { class: 'wlv' });
  el.append(root);
  let busy = false;

  async function readFromSheet() {
    const state = store.get(), month = app.month;
    const src = sheetSource(state, month);
    if (!src) { app.toast(app.isDemo ? 'The practice department has no Google Sheet to read.' : 'Bring a month in from the Google Sheet first (More › Import); the Leave tab then reads the same sheet.', { kind: 'warn', ms: 7000 }); return; }
    busy = true; render();
    try {
      const info = await G.getTabs(src.id);
      const tab = G.findTab(info.tabs, /wait\s*-?\s*list/i);
      if (!tab) throw new Error('That sheet has no "Leave Waitlist" tab.');
      const rows = await G.readColoured(src.id, tab);
      const staff = M.staffInMonth(store.get(), month);
      const res = W.parseWaitlist(rows, month, staff);
      if (res.problems.length && !res.entries.length && !res.days) throw new Error(res.problems[0]);
      store.commit('Read the leave waitlist', draft => {
        if (!draft.waitlist || typeof draft.waitlist !== 'object') draft.waitlist = {};
        draft.waitlist[month] = { entries: res.entries, readAt: new Date().toISOString(), source: { id: src.id, gid: tab.gid, title: tab.title }, columns: res.columns.length };
      });
      const sm = W.summarize(res.entries);
      app.toast(`Read the Leave Waitlist: ${sm.total} ${sm.total === 1 ? 'name' : 'names'} on ${res.days} days${sm.unmatched ? `; ${sm.unmatched} not matched to the staff list` : ''}. Nothing was written to the sheet.`, { kind: 'ok', ms: 6000 });
    } catch (e) {
      console.error(e);
      app.toast(cloud.friendly ? cloud.friendly(e) : e.message, { kind: 'error', ms: 9000 });
    } finally { busy = false; render(); }
  }

  function chip(e, nameOf) {
    const st = W.STATUS_BY_ID[e.status] || W.STATUS_BY_ID.adhoc;
    const who = e.staffId ? nameOf(e.staffId) : '';
    const title = [`${st.label}`, e.staffId ? `Matched to ${who}` : e.ambiguous ? 'More than one person fits this name' : 'Not found on the staff list', e.remark ? `Remark: ${e.remark}` : '', e.exact ? '' : 'The colour was close to this status, not exact'].filter(Boolean).join('. ');
    return h('li', { class: `wl-chip wl-st-${e.status}${e.staffId ? '' : ' wl-unmatched'}`, title },
      h('span', { class: 'wl-name' }, e.staffId ? (who || e.name) : e.name),
      e.remark ? h('span', { class: 'wl-remark' }, e.remark) : null,
      h('span', { class: 'wl-stat' }, st.short),
      e.staffId ? null : h('span', { class: 'wl-q', 'aria-hidden': 'true' }, e.ambiguous ? 'which one?' : 'not on the list'));
  }

  function render() {
    const state = store.get(), month = app.month;
    const data = (state.waitlist || {})[month];
    const entries = (data && data.entries) || [];
    const names = new Map((state.staff || []).map(p => [p.id, p.short || p.name]));
    const nameOf = id => names.get(id) || '';
    const src = sheetSource(state, month);
    const sm = W.summarize(entries);
    root.innerHTML = '';

    root.append(h('div', { class: 'card wl-intro' },
      h('h2', null, `Leave waitlist, ${M.fmtMonth(month)}`),
      h('p', { class: 'muted' }, 'Who is waitlisted for leave on each day, and where each request stands. Read only: this is the sheet\'s Leave Waitlist tab, and nothing is written back to it from here.'),
      h('div', { class: 'wl-tools' },
        h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, onclick: readFromSheet, title: src ? 'Read the Leave Waitlist tab of the month\'s Google Sheet' : 'Bring the month in from the Google Sheet first (More › Import)' }, busy ? 'Reading…' : 'Read from the Google Sheet'),
        data && data.readAt ? h('span', { class: 'muted wl-when' }, `Read ${new Date(data.readAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`) : null),
      !src && !app.isDemo ? h('p', { class: 'muted' }, 'Bring the month in from the Google Sheet first (More › Import); this tab then reads the same sheet.') : null));

    // the legend: the sheet's colours as words, with how many of each
    root.append(h('div', { class: 'card wl-legend', role: 'group', 'aria-label': 'Statuses' },
      h('ul', { class: 'wl-leg' }, W.STATUSES.map(s => h('li', { class: `wl-chip wl-st-${s.id}`, title: s.hint || s.label },
        h('span', { class: 'wl-name' }, s.short), h('span', { class: 'wl-n' }, String(sm.counts[s.id] || 0)),
        h('span', { class: 'wl-legend-long' }, s.label))))));

    if (!entries.length) {
      root.append(h('div', { class: 'card wl-empty' }, h('p', null, data ? 'Nobody is on the waitlist this month.' : 'Nothing read yet for this month.')));
      return;
    }
    if (sm.unmatched) root.append(h('p', { class: 'muted wl-note' }, `${sm.unmatched} ${sm.unmatched === 1 ? 'name does' : 'names do'} not match anyone on the staff list (shown dashed, as written in the sheet).`));

    const byDay = new Map();
    for (const e of entries) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
    const list = h('ol', { class: 'wl-days', 'aria-label': 'Days of the month' });
    for (const d of M.monthDays(month)) {
      const es = (byDay.get(d) || []).sort((a, b) => a.slot - b.slot);
      const wd = M.weekday(d);
      list.append(h('li', { class: `wl-day${wd === 0 || wd === 6 ? ' we' : ''}${es.length ? '' : ' empty'}` },
        h('span', { class: 'wl-date' }, h('strong', null, String(Number(d.slice(8)))), ' ', WD[wd]),
        es.length ? h('ul', { class: 'wl-ents' }, es.map(e => chip(e, nameOf))) : h('span', { class: 'wl-none muted' }, 'no one')));
    }
    root.append(list);
  }

  render();
  return { update: render };
}
