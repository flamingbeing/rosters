// The frame around every tab: render(), the bars at the top, the date bar, the steps and the tab buttons.
import { check } from './engine.js';
import * as cloud from './cloud.js';
import { makeDemo } from './demo.js';
import { MONTHLY, monthName, addDays } from './monthly.js';
import { checkKey, clearedForGood, dayStaff, DEMO, download, fillDemoNotes, h, KEY, otherTab, save, saveTimer, select, setCheckKey, setOtherTab, setStoreProblem, state, storeProblem, syncRooms, today } from './ui-core.js';
import { applyScenario, demoLink, resetPracticeDay, SCENARIOS, startPracticeTask } from './ui-practice.js';
import { startTour, TOUR_KEY } from './ui-tour.js';
import { finishStaffEdit, renderStaffTab, staffEditing } from './ui-staff.js';
import { goTab, renderDay } from './ui-cases.js';
import { clearUndo, renderSwapBar, setEditing, setLastRows, setRosterView } from './ui-roster.js';
import { colourCache, runGenerate } from './ui-person.js';
import { personCache, renderMonthly, syncMonthly } from './ui-monthly.js';
import { renderMyDay, viewerLoad } from './ui-myday.js';
import { placeRotGrid } from './ui-rotations.js';
import { applyCarry } from './ui-today.js';
import { renderPremed, renderRoster } from './ui-premed.js';
import { problemsOf } from './ui-problems.js';
import { renderSettings } from './ui-settings.js';
import { cs, isMember, isViewer, renderCloudBar, saveRosterToCloud, when } from './ui-team.js';

// ---------- render ----------

export const app = document.getElementById('app');
// banners (Practice, update, moved, backup, storage) sit under the app bar, above the screen
export const barHost = () => document.getElementById('bars') || document.body;
// Fields in table cells have no visible label of their own: name each from its column heading and row,
// so a screen reader says "Session, MOR 4" rather than "combo box".
function labelTableFields(root) {
  for (const f of root.querySelectorAll('td input:not([aria-label]):not([type=hidden]), td select:not([aria-label]), td textarea:not([aria-label])')) {
    if (f.labels?.length) continue;
    const td = f.closest('td'), tr = td.parentElement, table = td.closest('table');
    const col = [...tr.children].indexOf(td);
    const head = table.querySelector('thead tr')?.children[col]?.textContent.trim();
    const rowName = [...tr.children].find(c => c !== td && c.textContent.trim())?.textContent.trim()
      || tr.querySelector('input')?.value || '';
    const label = [head, rowName].filter(Boolean).join(', ') || f.placeholder || '';
    if (label) f.setAttribute('aria-label', label.slice(0, 80));
  }
  // a <label> written just before its field (not wrapping it): tie the two together
  for (const l of root.querySelectorAll('label:not([for])')) {
    const f = l.nextElementSibling;
    if (f && /^(INPUT|SELECT|TEXTAREA)$/.test(f.tagName) && !f.labels?.length && !f.getAttribute('aria-label') && !l.contains(f)) f.setAttribute('aria-label', l.textContent.trim().slice(0, 80));
  }
}
const SCREEN_TITLES = { monthly: 'Monthly', cases: 'Cases', roster: 'Roster', premed: 'Premeds', staff: 'Staff', settings: 'Settings', myday: 'My day' };
export function render() {
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  const y = window.scrollY;
  if (state.tab === 'day') state.tab = 'cases';
  colourCache.clear();
  if (state.tab === 'seniors' || state.tab === 'juniors') { state.staffRole = state.tab === 'juniors' ? 'junior' : 'senior'; state.tab = 'staff'; }
  if (state.tab === 'general' || state.tab === 'manpower') { state.monthlyView = state.tab === 'manpower' ? 'today' : state.monthlyView; state.tab = 'monthly'; }
  if (isViewer()) state.tab = 'myday';
  if (!['monthly', 'roster', 'premed', 'cases', 'staff', 'settings', 'myday'].includes(state.tab)) state.tab = 'staff';
  personCache.clear();
  syncMonthly();
  if (hashPending?.date === state.day.date) { markSaved(hashPending.date, hashPending.at); hashPending = null; }
  // checks follow every change, wherever it was made (a status on Today, a fix here)
  if (state.roster?.rows && state.roster.date === state.day.date) {
    const key = JSON.stringify([state.roster.rows, state.day, state.staff, state.settings, state.rotations]);
    if (key !== checkKey || !state.roster.checks) { setCheckKey(key); state.roster.checks = check({ rows: state.roster.rows, staff: dayStaff(), day: state.day, settings: state.settings }); }
  }
  const title = document.getElementById('screen-title'); // the large title on phones
  if (title) { title.textContent = SCREEN_TITLES[state.tab] || ''; title.hidden = !title.textContent; }
  app.replaceChildren(({ monthly: renderMonthly, roster: renderRoster, premed: renderPremed, cases: () => renderDay('cases'), staff: renderStaffTab, settings: renderSettings, myday: renderMyDay })[state.tab]());
  renderCloudBar();
  renderDateBar();
  renderSteps();
  renderSwapBar();
  renderDemoBar();
  renderMovedBar();
  if (storeProblem && !document.getElementById('store-bar')) renderStoreBar();
  if (cs.ready && (!document.getElementById('backup-bar') || isMember() || isViewer())) renderBackupBar();
  window.scrollTo(0, y);
  if (state.tab === 'monthly' && state.monthlyView === 'rotations') placeRotGrid();
  labelTableFields(app);
  save();
}
// Each date keeps its own manpower, calls, cases and roster. Switching the header date puts
// the current day away and brings up the other one (empty if it's new).
export function switchDate(date) {
  if (!date || date === state.day.date) return;
  (state.days ||= {})[state.day.date] = { day: state.day, roster: state.roster && { ...state.roster, checks: undefined } };
  const rec = state.days[date];
  delete state.days[date];
  state.day = rec?.day || { date, rooms: [], staff: {} };
  state.day.date = date;
  state.roster = rec?.roster || null;
  syncRooms();
  if (isViewer()) viewerLoad(date);
  if (DEMO && !state.monthly?.[date.slice(0, 7)]?.junior) for (const [m, v] of Object.entries(makeDemo(date).monthly)) (state.monthly ||= {})[m] ||= v; // months further out
  if (DEMO && !rec) fillDemoNotes(state.day);
  applyCarry(state.day);
  clearUndo(); setEditing(null);
  setLastRows(state.roster ? JSON.stringify(state.roster.rows) : null);
  render();
}

// The demo banner: what this is, and the way back out.
// The old address (anawj.com/nuh-roster/) with a roster saved in this browser: say where the app is now and
// offer this browser's data as a file first (Import JSON at the new address loads it).
function renderMovedBar() {
  const to = window.ROSTER_MOVED_TO;
  if (!to || document.getElementById('moved-bar')) return;
  const go = () => { try { localStorage.setItem('nuh-roster-moved', '1'); } catch { /* no storage */ } location.replace(to); };
  barHost().prepend(h('div', { id: 'moved-bar', class: 'demo-bar moved-bar' },
    h('b', {}, 'The roster has moved'), h('span', {}, ' to nuhroster.anawj.com. What this browser saved here stays at this old address: download it, then use Import JSON at the bottom of the new page.'),
    h('span', { class: 'grow' }),
    h('button', { class: 'small primary', onclick: downloadEverything }, 'Download everything'),
    h('button', { class: 'small', onclick: go }, 'Go to the new address')));
}
// The same roster open in two tabs: each would quietly write over the other. When another tab saves, this one stops
// saving and says so, with Reload to pick up the other tab's work.
addEventListener('storage', e => {
  if (e.key !== KEY || clearedForGood || otherTab) return;
  setOtherTab(true); clearTimeout(saveTimer);
  document.getElementById('tab-bar')?.remove();
  barHost().prepend(h('div', { id: 'tab-bar', class: 'demo-bar moved-bar', role: 'alert' },
    h('b', {}, 'The roster was changed in another tab.'), h('span', {}, ' This tab has stopped saving so it doesn\'t undo that. Reload to carry on here with the latest, or close this tab.'),
    h('span', { class: 'grow' }), h('button', { class: 'small primary', onclick: () => location.reload() }, 'Reload')));
});
// Not signed in to the team: the roster lives only in this browser. Once a week, suggest a backup file.
const BACKUP_KEY = 'nuh-roster-backup-nag';
function renderBackupBar() {
  document.getElementById('backup-bar')?.remove();
  if (clearedForGood || DEMO || isViewer() || isMember() || !state.staff.length) return;
  let snooze = 0;
  try { snooze = +localStorage.getItem(BACKUP_KEY) || 0; } catch { /* no storage */ }
  const last = Math.max(state.backupAt || 0, snooze);
  if (!last) { try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* no storage */ } return; } // first week: quiet
  if (Date.now() - last < 7 * 864e5) return;
  const later = () => { try { localStorage.setItem(BACKUP_KEY, String(Date.now())); } catch { /* no storage */ } renderBackupBar(); };
  barHost().prepend(h('div', { id: 'backup-bar', class: 'demo-bar' },
    h('b', {}, 'A backup?'), h('span', {}, ' The roster is kept only in this browser. Download everything once a week, or sign in to save it for the team.'),
    h('span', { class: 'grow' }),
    h('button', { class: 'small primary', onclick: () => { downloadEverything(); renderBackupBar(); } }, 'Download everything'),
    h('button', { class: 'small', onclick: later }, 'Later')));
}
// A bar when this browser can't keep the roster: storage full, or saved data that couldn't be read.
export function renderStoreBar() {
  document.getElementById('store-bar')?.remove();
  if (!storeProblem) return;
  const bar = h('div', { id: 'store-bar', class: 'demo-bar moved-bar', role: 'alert' });
  if (storeProblem === 'full') {
    const old = oldDays(90);
    bar.append(h('b', {}, 'Changes are not being kept in this browser.'),
      h('span', {}, ' Its storage is probably full. Download everything to keep a copy' + (old.length ? `, then remove days more than 3 months old (${old.length}).` : '.')),
      h('span', { class: 'grow' }),
      h('button', { class: 'small primary', onclick: downloadEverything }, 'Download everything'),
      ...(old.length ? [h('button', { class: 'small', onclick: () => removeOldDays(old) }, 'Remove old days')] : []));
  } else {
    const { corrupt, raw } = storeProblem;
    const copy = () => { download(`NUH roster, damaged saved data ${realToday()}.txt`, new Blob([corrupt ? localStorage.getItem(corrupt) || '' : raw || ''], { type: 'text/plain' })); storeProblem.downloaded = true; save(); };
    bar.append(h('b', {}, 'The roster saved in this browser couldn\'t be read, so the app started empty.'),
      h('span', {}, corrupt ? ' A copy of it is kept in this browser.' : ' It couldn\'t be copied, so download it now, before you change anything.'),
      h('span', { class: 'grow' }),
      h('button', { class: 'small primary', onclick: copy }, 'Download the damaged data'),
      h('button', { class: 'small', onclick: () => { setStoreProblem(null); renderStoreBar(); save(); } }, 'Hide'));
  }
  barHost().prepend(bar);
}
// Stored dates more than n days before today (the open date is never in state.days).
function oldDays(n) {
  const cut = addDays(realToday(), -n);
  return Object.keys(state.days || {}).filter(d => d < cut).sort();
}
function removeOldDays(dates) {
  if (!confirm(`Remove ${dates.length} days from ${dates[0]} to ${dates[dates.length - 1]} from this browser? Download everything first if you want to keep them (days saved for the team stay in the cloud).`)) return;
  for (const d of dates) delete state.days[d];
  save();
  renderStoreBar();
}
// Everything this browser holds for the roster (staff, settings, every day's roster, monthly rosters, rotations).
export function downloadEverything() {
  state.backupAt = Date.now(); save();
  const data = { kind: 'ot-roster-all', version: 1, savedAt: new Date().toISOString(), state };
  download(`NUH roster, everything in this browser ${realToday()}.json`, new Blob([JSON.stringify(data)], { type: 'application/json' }));
}

// Practice mode is the demo: a made-up department in its own storage, opened next to the real
// roster (a new tab), so people can try things without touching real data.
function renderDemoBar() {
  if (!DEMO) {
    const team = document.querySelector('.top .team');
    if (team && !document.getElementById('practice-link')) team.prepend(h('a', { id: 'practice-link', class: 'btn small', href: demoLink(), target: '_blank', rel: 'noopener', title: 'Try the app on made-up data in a new tab. Your real roster isn\'t touched.' }, 'Practice'));
    return;
  }
  if (document.getElementById('demo-bar')) return;
  barHost().prepend(h('div', { id: 'demo-bar', class: 'demo-bar' },
    h('b', {}, 'Practice'), h('span', { class: 'demo-text' }, ' · made-up staff and rosters, saved only in this browser. Try anything: nothing here touches the real roster.'),
    h('span', { class: 'grow' }),
    // on a phone the tools fold away, so the bar doesn't take a third of the screen
    h('details', { class: 'demo-tools', open: innerWidth > 600 }, h('summary', {}, 'Practice tools'), h('span', { class: 'demo-actions' },
    h('button', { class: 'small', onclick: () => startTour() }, 'Tour'),
    h('button', { class: 'small', title: 'A roster with three problems planted in it, to find and fix', onclick: startPracticeTask }, 'Fix 3 problems'),
    (() => { const sel = select('', [['', 'Try a morning…'], ...SCENARIOS.map(([k, label]) => [k, label])], v => { if (v) { applyScenario(v); sel.value = ''; } }); sel.setAttribute('aria-label', 'Practice a harder morning'); return sel; })(),
    h('button', { class: 'small', title: 'This day back to how Practice made it (Undo brings your version back)', onclick: resetPracticeDay }, 'Reset this day'),
    h('button', { class: 'small', onclick: () => { if (confirm('Start practice again from scratch?')) { try { localStorage.removeItem(KEY); localStorage.removeItem(TOUR_KEY); } catch { /* no storage */ } location.reload(); } } }, 'Start again'),
    )),
    h('a', { class: 'btn small', href: location.pathname }, 'Back to the real roster')));
}

// One date for the whole workspace, in the header: the date in words (the picker shows
// mm/dd on some phones), steps a day either way, and whether this day is saved.
export const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const realToday = () => isoDate(new Date());
export const longDate = iso => iso ? new Date(iso + 'T12:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
function renderDateBar() {
  const el = document.getElementById('date');
  if (!el) return;
  if (!el.querySelector('.date-pick')) {
    const step = n => () => switchDate(addDays(state.day.date || realToday(), n));
    el.append(
      h('div', { class: 'date-row' },
        h('button', { class: 'small', title: 'Previous day', 'aria-label': 'Previous day', onclick: step(-1) }, '‹'),
        h('label', { class: 'date-pick' }, h('span', { class: 'date-words' }), h('input', { type: 'date', 'aria-label': 'Roster date', onchange: e => { if (e.target.value) switchDate(e.target.value); } })),
        h('button', { class: 'small', title: 'Next day', 'aria-label': 'Next day', onclick: step(1) }, '›'),
        h('button', { class: 'small', 'data-go': 'today', onclick: () => switchDate(realToday()) }, 'Today'),
        h('button', { class: 'small', 'data-go': 'tomorrow', onclick: () => switchDate(today()) }, 'Tomorrow')),
      h('div', { class: 'date-notes' }, h('span', { class: 'date-warn' }), h('span', { class: 'save-state' })));
  }
  const date = state.day.date || '';
  const input = el.querySelector('input');
  if (input.value !== date) input.value = date;
  el.querySelector('.date-words').textContent = longDate(date) || 'Pick a date';
  el.querySelectorAll('[data-go]').forEach(b => b.setAttribute('aria-pressed', String(date === (b.dataset.go === 'today' ? realToday() : today()))));
  const warn = el.querySelector('.date-warn');
  warn.textContent = date && date !== today() ? `Not tomorrow: you're on ${date === realToday() ? 'today' : longDate(date)}.` : '';
  warn.hidden = !warn.textContent;
  el.querySelector('.save-state').replaceChildren(...saveState());
}

// The day's work in order, under the tabs: each step says whether it's done and goes there.
export function renderSteps() {
  const el = document.getElementById('steps');
  if (!el) return;
  if (!['monthly', 'cases', 'roster', 'premed'].includes(state.tab) || !state.staff.length) {
    el.hidden = true;
    const nb = document.getElementById('nextbar'); if (nb) nb.hidden = true;
    document.body.classList.remove('has-nextbar');
    return;
  }
  el.hidden = false;
  const date = state.day.date, month = date?.slice(0, 7);
  const mon = state.monthly?.[month] || {};
  const kinds = MONTHLY.filter(d => d.list ? mon[d.id]?.entries?.length : Object.keys(mon[d.id]?.rows || {}).length);
  const cases = state.day.rooms.filter(r => r.running && r.notes).length;
  const r = state.roster && state.roster.date === date ? state.roster : null;
  const probs = r ? problemsOf(r) : [];
  const errors = probs.filter(w => w.level === 'error').length;
  const saved = state.cloudHash?.[date]?.hash === dayHash(), out = state.outHash?.[date] === dayHash();
  const steps = [
    ['monthly', 'Monthly rosters', kinds.length ? 'ok' : 'todo', kinds.length ? `${kinds.length} of ${MONTHLY.length} loaded` : `none for ${monthName(month)}`],
    ['cases', 'Cases', cases ? 'ok' : 'todo', cases ? `${cases} rooms with cases` : 'load the admin draft'],
    ['roster', 'Roster', r ? 'ok' : 'todo', r ? 'made' : 'not made yet'],
    ['check', 'Check', !r ? 'off' : errors ? 'bad' : 'ok', !r ? '—' : errors ? `${errors} problem${errors > 1 ? 's' : ''}` : probs.length ? `${probs.length} to look at` : 'no problems'],
    ['send', 'Save or download', !r ? 'off' : saved || out ? 'ok' : 'todo', !r ? '—' : saved ? 'saved to the team' : out ? 'downloaded' : 'not yet'],
  ];
  const go = k => {
    if (k === 'check') { setRosterView('edit'); goTab('roster').then(() => document.getElementById('problems')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); return; }
    goTab(k === 'send' ? 'roster' : k);
  };
  const mark = { ok: '✓', bad: '!', todo: '', off: '' };
  el.replaceChildren(...steps.map(([k, label, st, note], i) => h('button', { class: `step ${st}` + (state.tab === k ? ' here' : ''), onclick: () => go(k) },
    h('span', { class: 'dot' }, mark[st] || String(i + 1)), h('span', { class: 'what' }, h('b', {}, label), h('small', {}, note)))));
  // phones: the next step to do, in reach of a thumb at the bottom of the screen (CSS shows it only on phones)
  let bar = document.getElementById('nextbar');
  if (!bar) { bar = h('nav', { id: 'nextbar', 'aria-label': 'Next step' }); document.body.append(bar); }
  const next = steps.find(([, , st]) => st === 'bad' || st === 'todo');
  bar.hidden = !next;
  document.body.classList.toggle('has-nextbar', !!next);
  if (next) {
    const [k, label, st, note] = next, i = steps.indexOf(next);
    // on the Roster tab with no roster, the button makes it; otherwise it goes to the step
    const make = k === 'roster' && state.tab === 'roster';
    bar.replaceChildren(h('span', { class: 'what' }, h('small', {}, `Step ${i + 1} of ${steps.length}`), h('b', {}, `${label}: ${note}`)),
      h('button', { class: 'primary' + (st === 'bad' ? ' bad' : ''), onclick: () => make ? runGenerate(false) : go(k) }, make ? 'Make it' : st === 'bad' ? 'Show' : 'Go'));
  }
}

// Whether the day on screen is saved where the team can see it.
const hashOf = o => { let x = 5381; const t = JSON.stringify(o); for (let i = 0; i < t.length; i++) x = (x * 33 ^ t.charCodeAt(i)) >>> 0; return x.toString(36); };
export const dayHash = (day = state.day, roster = state.roster) => hashOf({ day, roster: roster && { ...roster, checks: undefined } });
export let hashPending = null; // a date whose saved copy was just opened; its hash is taken after the next sync
export const setHashPending = v => (hashPending = v);
function saveState() {
  const date = state.day.date;
  if (DEMO || !cloud.enabled || !isMember()) return [h('span', { class: 'seen' }, 'Saved in this browser only')];
  const saved = state.cloudHash?.[date];
  if (!saved) return [h('span', { class: 'unsaved' }, state.roster ? 'Not saved to the team yet' : '')];
  if (saved.hash === dayHash()) return [h('span', { class: 'saved' }, `✓ Saved to the team ${when(saved.at)}`)];
  return [h('span', { class: 'unsaved' }, 'Changes not saved to the team'), ' ', h('button', { class: 'small', onclick: saveRosterToCloud }, 'Save')];
}
export function markSaved(date, at, hash = dayHash()) { (state.cloudHash ||= {})[date] = { hash, at }; }

document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', async () => {
  const t = b.dataset.tab;
  if (staffEditing() && t !== 'staff' && !(await finishStaffEdit())) return;
  state.tab = t; window.scrollTo(0, 0); render();
}));
