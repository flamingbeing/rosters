// My day: where one person is on the day on screen (viewers' page; #myday).
import { postingName, matchName, namesInCell, isCoverPart } from './engine.js';
import { shortName } from './layout.js';
import * as cloud from './cloud.js';
import { buildIcs } from './ics.js';
import { addDays } from './monthly.js';
import { clone, download, h, person, postingOf, select, state, syncRooms, toast, today } from './ui-core.js';
import { isoDate, longDate, realToday, render, switchDate } from './ui-screen.js';
import { goTab } from './ui-cases.js';
import { cellParts } from './ui-roster.js';
import { parseNamePart, personOfPart } from './ui-tags.js';
import { shortOf } from './ui-person.js';
import { effectiveGeneral, generalFields } from './ui-general.js';
import { derivedFor } from './ui-monthly.js';
import { renderSheet } from './ui-premed.js';
import { cloudError, cs, isViewer } from './ui-team.js';

// ---- My day: where one person is on the day on screen (viewers' page; anyone at #myday) ----

// My day opens on today until early afternoon (people check it in the morning), then on tomorrow.
const MYDAY_SWITCH_HOUR = 14;
export const myDayDate = () => new Date().getHours() < MYDAY_SWITCH_HOUR ? realToday() : today();
// On opening: My day goes to myDayDate(); the roster leaves a past date for tomorrow (the day being made),
// with a way back. Today is left alone, for morning changes.
export function openOnTheRightDay() {
  const was = state.day.date;
  if (state.tab === 'myday') { if (myDayDate() !== was) switchDate(myDayDate()); return; }
  if (isViewer() || !state.staff.length || !was || was >= realToday()) return;
  switchDate(today());
  toast(`Opened tomorrow, ${longDate(today())}.`, { label: `Back to ${longDate(was)}`, run: () => switchDate(was) });
}
// What this person saw last time on each date, to mark what changed since: { date: { at, lines } }
const SEEN_KEY = 'nuh-roster-seen';
function seenBefore(date, pid) {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}')[date + '|' + pid] || null; } catch { return null; }
}
function markSeen(date, pid, at, lines) {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    all[date + '|' + pid] = { at, lines };
    const keys = Object.keys(all).sort(); // keep the last 60 entries
    for (const k of keys.slice(0, Math.max(0, keys.length - 60))) delete all[k];
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch { /* no storage */ }
}
let seenCache = { id: '', prev: null };
export const hhmm = t => t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
// a viewer coming back to the page after a while gets the latest saved roster
let viewerLoadedAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isViewer() && state.tab === 'myday' && Date.now() - viewerLoadedAt > 60e3) viewerLoad(state.day.date);
});

const ME_KEY = 'nuh-roster-me';
let viewerDate = null, viewerFound = null;
// A viewer sees the roster saved for the team, never a local draft.
let viewerMeta = null; // { updatedAt, updatedBy } of the roster on screen
export async function viewerLoad(date) {
  viewerDate = date; viewerFound = null; viewerLoadedAt = Date.now();
  try {
    const snap = await cloud.loadRoster(date);
    if (viewerDate !== date) return;
    viewerFound = !!snap?.roster;
    viewerMeta = snap ? { updatedAt: snap.updatedAt, updatedBy: snap.updatedBy } : null;
    state.day = snap?.day ? { ...clone(snap.day), date } : { date, rooms: [], staff: {} };
    state.roster = snap?.roster ? clone(snap.roster) : null;
    syncRooms();
  } catch (e) { if (viewerDate === date) viewerFound = 'failed'; cloudError(e); }
  render();
}
// Who "my" is: the staff record an admin linked to this account, else the name picked in this browser, else a guess
// from the member's name (myPersonGuessed says so, so My day can ask to confirm).
let myPersonGuessed = false;
function myPerson() {
  myPersonGuessed = false;
  let id = '';
  try { id = localStorage.getItem(ME_KEY) || ''; } catch { /* no storage */ }
  const linked = cs.member?.staffId && person(cs.member.staffId);
  if (linked) return linked;
  if (person(id)) return person(id);
  const guess = cs.member?.name ? matchName(cs.member.name, state.staff).person : null;
  myPersonGuessed = !!guess;
  return guess || null;
}
// Everything the roster says about p on the day on screen: [what, detail] lines.
function dayLines(p) {
  const out = [];
  const d = state.day.staff[p.id] || {};
  const off = { leave: 'On leave', mc: 'On MC', postcall: 'Post call', admin: 'Admin day (no list)' }[d.status || 'avail'];
  if (off) out.push([off, d.auto || '']);
  const r = state.roster && state.roster.date === state.day.date ? state.roster : null;
  if (r) for (const row of r.rows) {
    const room = row.label;
    for (const [key, role] of [['senior', 'Senior'], ['junior', 'Junior']]) for (const part of cellParts(row, key)) {
      if (personOfPart(part) !== p) continue;
      const cover = isCoverPart(part);
      const other = cellParts(row, key === 'senior' ? 'junior' : 'senior').filter(x => !isCoverPart(x)).map(x => shortOf(x)).join(' / ');
      const parsed = parseNamePart(part);
      out.push([`${room}${cover ? ' (ad hoc cover)' : ''}`, [role, other ? `with ${other}` : '', row.notes ? `· ${row.notes}` : '', parsed.leave ? `· leaving ${parsed.leave}` : '', parsed.cover ? `· also covers ${parsed.cover}` : ''].filter(Boolean).join(' '),
        { room, role, with: other, notes: row.notes || '', senior: key === 'junior' ? other : '' }]);
    }
    for (const part of cellParts(row, 'premed')) if (personOfPart(part) === p) out.push([`Premed for ${room}`, row.notes || '']);
  }
  const g = effectiveGeneral();
  for (const [label, key] of generalFields()) {
    const names = String(g[key] || '').split('/').flatMap(namesInCell);
    if (names.some(n => matchName(n, state.staff).person === p)) out.push([label.replace(' · ', ': '), '']);
  }
  if (d.comment) out.push(['Note', d.comment]);
  return out;
}
// What the roster says about p on another date: that date's saved day (this browser's, or the team's for a viewer),
// else what the monthly rosters say (leave, calls, clinics). rec: { day, roster } or null.
function linesOn(p, date, rec) {
  const keep = [state.day, state.roster];
  try {
    state.day = rec?.day ? { ...rec.day, date } : { date, rooms: [], staff: {} };
    state.roster = rec?.roster ? { ...rec.roster, date } : null;
    if (!rec?.day) { const r = derivedFor(date).get(p.id); if (r?.status) state.day.staff[p.id] = { status: r.status, auto: r.why }; }
    return dayLines(p);
  } finally { [state.day, state.roster] = keep; }
}
const weekDates = from => Array.from({ length: 7 }, (_, i) => addDays(from, i));
let weekOpen = false, weekRecs = {}; // date -> { day, roster } or null (viewers: from the cloud, loaded on asking)
async function loadWeek() {
  const dates = weekDates(realToday());
  if (isViewer()) {
    const got = await Promise.all(dates.map(d => weekRecs[d] !== undefined ? weekRecs[d] : cloud.loadRoster(d).catch(() => null)));
    dates.forEach((d, i) => { weekRecs[d] = got[i]?.roster ? { day: got[i].day, roster: got[i].roster } : null; });
  } else for (const d of dates) weekRecs[d] = d === state.day.date ? { day: state.day, roster: state.roster } : state.days?.[d] || null;
  render();
}
// A day's lines as one calendar event: the room (or leave, a call) as the title, everything as the details.
const eventOf = (p, date, lines) => lines.length ? { date, uid: `${date}-${p.id}@nuhroster.anawj.com`,
  title: lines.map(l => l[0]).slice(0, 2).join(' + '), details: lines.map(l => l[1] ? `${l[0]}: ${l[1]}` : l[0]).join('\n') } : null;
function downloadIcs(p, events, name) {
  const list = events.filter(Boolean);
  if (!list.length) return toast('Nothing on the roster to add yet.');
  download(name, new Blob([buildIcs(list)], { type: 'text/calendar' }));
  toast(`Calendar file downloaded (${list.length} day${list.length === 1 ? '' : 's'}). Open it to add to your calendar.`);
}
// For the logbook's case summary: the facts of one list, to paste (nothing is sent to the logbook).
async function copyForLogbook(date, meta) {
  const text = [`Date: ${longDate(date)}`, `Room: ${meta.room}`, meta.senior ? `Supervisor: ${meta.senior}` : meta.with ? `With: ${meta.with}` : '', meta.notes ? `Cases: ${meta.notes}` : ''].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(text); toast('Copied for the logbook: paste it into the case summary.'); }
  catch { prompt('Copy this for the logbook:', text.replace(/\n/g, ' · ')); }
}
function weekCard(p) {
  if (!weekOpen) return null;
  const dates = weekDates(realToday());
  if (!dates.every(d => d in weekRecs)) return h('p', { class: 'seen' }, 'Loading the week…');
  const days = dates.map(d => ({ d, lines: linesOn(p, d, weekRecs[d]), out: !!weekRecs[d]?.roster }));
  return h('div', { class: 'myweek' },
    h('h3', {}, 'My week'),
    h('ul', { class: 'myweek-list' }, days.map(x => h('li', {},
      h('button', { class: 'link', onclick: () => switchDate(x.d) }, new Date(x.d + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })),
      ' ', x.lines.length ? x.lines.map(l => l[0]).join(' · ') : h('span', { class: 'seen' }, x.out ? 'not on the roster' : 'roster not out yet'),
      !x.out && x.lines.length ? h('span', { class: 'seen' }, ' (from the monthly rosters)') : null))),
    h('button', { class: 'small', onclick: () => downloadIcs(p, days.map(x => eventOf(p, x.d, x.lines)), `My week from ${realToday()}.ics`) }, 'Add the week to my calendar'));
}
export function renderMyDay() {
  const p = myPerson();
  const date = state.day.date;
  const linked = !!(cs.member?.staffId && person(cs.member.staffId));
  const pick = linked ? h('span', { class: 'seen', title: 'An admin linked your account to this name (Settings › Team members)' }, 'your account')
    : select(p?.id || '', [['', 'Pick your name…'], ...state.staff.slice().sort((a, b) => a.name.localeCompare(b.name)).map(x => [x.id, x.name])],
      v => { try { localStorage.setItem(ME_KEY, v); } catch { /* no storage */ } render(); });
  const r = state.roster && state.roster.date === date ? state.roster : null;
  const lines = p ? dayLines(p) : [];
  const when = date === today() ? 'Tomorrow' : date === realToday() ? 'Today' : longDate(date);
  // what changed for this person since they last looked (viewers, from the saved roster's time)
  const meta = isViewer() ? viewerMeta : null;
  const key = l => l.join(' ');
  // what they saw before this version, read once per version (later renders keep the marks)
  const seenId = p && meta?.updatedAt && viewerFound === true ? `${date}|${p.id}|${meta.updatedAt}` : '';
  if (seenId && seenCache.id !== seenId) {
    seenCache = { id: seenId, prev: seenBefore(date, p.id) };
    markSeen(date, p.id, meta.updatedAt, lines.map(key));
  }
  const seen = seenId && seenCache.prev?.at !== meta.updatedAt ? seenCache.prev : null;
  const changed = seen ? new Set(lines.map(key).filter(k => !seen.lines.includes(k))) : new Set();
  const gone = seen ? seen.lines.filter(k => !lines.some(l => key(l) === k)) : [];
  return h('div', {},
    h('section', { class: 'card myday' },
      h('div', { class: 'section-head' }, h('h2', { style: 'margin:0' }, p ? `${when} for ${shortName(p) || p.name}` : 'My day'), h('span', { class: 'grow' }),
        pick),
      p && myPersonGuessed ? h('p', { class: 'warn-note' }, `Matched to ${p.name} from your account's name. Not you? Pick your name above.`) : null,
      !p ? h('p', { class: 'hint' }, 'Pick your name once; this browser remembers it.')
        : !state.staff.length ? h('p', { class: 'hint' }, 'Loading the staff list…')
        : !r && !lines.length ? h('p', { class: 'empty' }, isViewer() && viewerFound === 'failed' ? 'Couldn\'t load the roster. Check your signal, then open My day again.' : isViewer() && viewerFound === null ? 'Loading…' : `The roster for ${longDate(date)} isn't out yet.`)
        : lines.length ? h('ul', { class: 'myday-list' }, lines.map(l => h('li', { class: changed.has(key(l)) ? 'changed' : null }, h('b', {}, l[0]), l[1] ? h('span', {}, ' ', l[1]) : null, changed.has(key(l)) ? h('span', { class: 'new-tag' }, ' changed') : null,
          l[2]?.room ? h('button', { class: 'small logbook-copy', title: 'Date, room, supervisor and case notes, to paste into the logbook', onclick: () => copyForLogbook(date, l[2]) }, 'Copy for logbook') : null)))
        : h('p', { class: 'empty' }, `You're not on the roster for ${longDate(date)}.`),
      changed.size || gone.length ? h('p', { class: 'warn-note', role: 'status' }, `Changed since you last looked${gone.length ? ` (no longer: ${gone.join('; ')})` : ''}.`) : null,
      p ? h('div', { class: 'bar myday-actions' },
        lines.length ? h('button', { class: 'small', onclick: () => downloadIcs(p, [eventOf(p, date, lines)], `My day ${date}.ics`) }, 'Add to calendar') : null,
        h('button', { class: 'small', 'aria-expanded': String(weekOpen), onclick: () => { weekOpen = !weekOpen; if (weekOpen) { weekRecs = {}; loadWeek(); } else render(); } }, weekOpen ? 'Hide my week' : 'My week')) : null,
      p ? weekCard(p) : null,
      meta?.updatedAt && viewerFound === true ? h('p', { class: 'seen' }, `Saved by ${meta.updatedBy?.name || 'the rosterer'} at ${hhmm(meta.updatedAt)}${new Date(meta.updatedAt).toDateString() !== new Date().toDateString() ? `, ${longDate(isoDate(new Date(meta.updatedAt)))}` : ''}. `,
        h('button', { class: 'link', onclick: () => viewerLoad(date) }, 'Check again')) : null,
      p && r && postingOf(p) && p.role === 'junior' ? h('p', { class: 'seen' }, `Posting this week: ${postingName(postingOf(p))}`) : null,
      h('p', { class: 'hint' }, 'Add it to your home screen (browser menu › Add to Home Screen): it opens here and works with poor signal. Or bookmark ', h('code', {}, location.origin + location.pathname + '#myday'),
        isViewer() ? null : [' · ', h('button', { class: 'link', onclick: () => { history.replaceState(null, '', location.pathname); goTab('roster'); } }, 'Back to the roster')])),
    r ? renderSheet() : null);
}
