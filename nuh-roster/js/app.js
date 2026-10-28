// NUH roster: boot. Loads the saved roster (ui-core.js), opens the first screen, and wires the page-wide buttons,
// error reporting and the offline app shell. The screens live in ui-*.js (the logbook's layout).
import { DEMO, hooks, state, toast } from './ui-core.js';
import { applyScenario, SCENARIOS } from './ui-practice.js';
import { downloadEverything, render, renderStoreBar } from './ui-screen.js';
import { startTour, TOUR_KEY } from './ui-tour.js';
import { maybeWhatsNew, setLastRows, showKey, showShortcuts, undo } from './ui-roster.js';
import { closeTagEditor } from './ui-tags.js';
import { openOnTheRightDay } from './ui-myday.js';
import { canReload, onUnsentChange } from './unsent.js';

Object.assign(hooks, { renderStoreBar, undo });

setLastRows(state.roster ? JSON.stringify(state.roster.rows) : null);
state.tab = location.hash === '#myday' ? 'myday' : state.staff.length ? 'roster' : 'staff'; // the page opens on the roster
render();
openOnTheRightDay();
setTimeout(maybeWhatsNew, 1200);
// a practice link with a scenario (?demo=short): set it up once per visit
if (DEMO) {
  const sc = new URLSearchParams(location.search).get('demo');
  let done = '';
  try { done = sessionStorage.getItem('nuh-roster-scenario') || ''; } catch { /* no storage */ }
  if (SCENARIOS.some(x => x[0] === sc) && done !== sc) { try { sessionStorage.setItem('nuh-roster-scenario', sc); } catch { /* no storage */ } setTimeout(() => applyScenario(sc), 300); }
}
// practice mode opens with the tour, once
if (DEMO && !SCENARIOS.some(x => x[0] === new URLSearchParams(location.search).get('demo'))) { try { if (!localStorage.getItem(TOUR_KEY)) setTimeout(startTour, 700); } catch { /* no storage */ } }
document.getElementById('tourBtn')?.addEventListener('click', () => startTour());
document.getElementById('allBtn')?.addEventListener('click', downloadEverything);
addEventListener('hashchange', () => { if (location.hash === '#myday' && state.tab !== 'myday') { closeTagEditor(); state.tab = 'myday'; window.scrollTo(0, 0); render(); } });
document.getElementById('keysBtn')?.addEventListener('click', showShortcuts);
// Something unexpected broke mid-change: say so in plain words (the screen may not have caught up), once a minute
// at most; the details go to the console.
let lastCrash = 0;
function crashed(err) {
  console.error(err);
  if (Date.now() - lastCrash < 60e3) return;
  lastCrash = Date.now();
  toast('Something went wrong, so your last change may not have gone in. Check it, press Undo, or reload the page.', { label: 'Reload', run: () => location.reload() });
}
addEventListener('error', e => { if (e.error) crashed(e.error); });
addEventListener('unhandledrejection', e => crashed(e.reason));
// Offline app shell (sw.js): the app opens with poor signal. The shared update module (app-update register.js) checks
// for a new version on every return to the tab and every 3 h; a new one takes over at once and the page reloads once, but only when `canReload` says nobody is mid-edit.
// Loaded with import(), so a blocked core.anawj.com never stops the app; offline it comes from the saved copy.
(function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || window.ROSTER_MOVED_TO || /^(www\.)?anawj\.com$/.test(location.hostname)) return; // not at the old address (it redirects)
  import('https://core.anawj.com/update/1.4.0/register.js').then(m => {
    // a new version takes over only when nobody is typing, no sheet is open and no save is waiting to be sent
    m.register({ app: 'nuh-roster', sw: 'sw.js', canReload: () => canReload(() => false) });
    const later = () => setTimeout(m.retryUpdate, 400);
    document.addEventListener('focusout', later);
    document.addEventListener('close', later, true);
    onUnsentChange(later);
  }).catch(err => console.warn('Service worker not registered', err));
})();
document.getElementById('keyBtn')?.addEventListener('click', showKey);
// Phones: keep the bottom-sheet person box above the on-screen keyboard, and the field being typed in visible.
if (window.visualViewport) {
  const fit = () => {
    const box = document.querySelector('.tag-editor');
    if (!box || innerWidth > 600) return;
    const vv = visualViewport, covered = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    box.style.bottom = covered + 'px';
    box.style.maxHeight = Math.round(vv.height * 0.9) + 'px';
  };
  visualViewport.addEventListener('resize', fit);
  visualViewport.addEventListener('scroll', fit);
  document.addEventListener('focusin', e => {
    if (innerWidth > 600 || !e.target.closest?.('.tag-editor')) return;
    setTimeout(() => { fit(); e.target.scrollIntoView({ block: 'nearest' }); }, 250);
  });
}
