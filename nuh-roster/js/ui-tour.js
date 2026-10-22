// The short guided tour.
import { DEMO, h, state, toast } from './ui-core.js';
import { demoLink } from './ui-practice.js';
import { goTab } from './ui-cases.js';
import { setRosterView } from './ui-roster.js';
import { canGenerate, runGenerate } from './ui-person.js';

// ---- a short guided tour: a ring around each part of the screen and a note beside it ----
export const TOUR_KEY = 'nuh-roster-tour';
const TOUR = [
  { sel: '#date', title: 'The day you\'re rostering', text: 'Everything follows this date. ‹ › step a day ([ and ] on a keyboard), and it warns you when it isn\'t tomorrow.' },
  { tab: 'monthly', sel: '#steps', title: 'Your morning, in five steps', text: 'Monthly rosters, cases, roster, check, then save or download. Each step turns green when it\'s done; tap one to go there.' },
  { tab: 'monthly', sel: '.board', title: 'Who\'s working', text: 'Leave, MC and post call come from the monthly rosters. Tap a name to change their day; "Select several" moves many at once.' },
  { tab: 'cases', sel: '#app label.btn.primary', title: 'Start from the admin draft', text: '"Do it all" reads the admin team\'s draft, makes the roster and shows what needs a look. In Practice, "Download a practice draft" gives you one to try.' },
  { tab: 'roster', sel: '#problems', title: 'What needs a look', text: 'Problems are listed here with a button that fixes each one, and Show to find the room.' },
  { tab: 'roster', sel: 'table.sheet', title: 'The roster', text: 'Tap a name for its box: leaving time, (L), comments, Move or swap. On a computer you can drag names; + suggests the best fits first.' },
  { tab: 'roster', sel: '.split', title: 'Send it out', text: 'Download the sheet as Excel or PDF, or save it for the team. Undo (Ctrl+Z) takes back anything.' },
  { sel: '#keyBtn', title: 'Stuck?', text: 'Key and help explains every mark (&, C, (L), the colours) and answers "How do I…?". It also has a one-page guide to print for the OT computer.' },
];
let tourStep = -1;
export function startTour() {
  // the tour points at a roster; an empty real app has none, so offer Practice (which has one) instead
  if (!DEMO && (!state.staff.length || !state.roster)) {
    toast('The tour shows a made-up roster in Practice, so it doesn\'t touch yours.', { label: 'Open Practice', run: () => window.open(demoLink(), '_blank', 'noopener') });
    return;
  }
  tourStep = 0; showTourStep();
}
function endTour() {
  tourStep = -1;
  document.getElementById('tour')?.remove();
  try { localStorage.setItem(TOUR_KEY, 'done'); } catch { /* no storage */ }
}
async function showTourStep() {
  const step = TOUR[tourStep];
  if (!step) return endTour();
  if (step.tab && state.tab !== step.tab) { await goTab(step.tab); }
  if (step.tab === 'roster' && !state.roster && DEMO && canGenerate()) runGenerate(false); // practice: make one to look at
  setRosterView('edit');
  const el = document.querySelector(step.sel);
  if (!el) { tourStep++; return showTourStep(); }
  // a tall part (the board on a phone) shows from its top; the note sits below it or at the bottom
  const tall = el.getBoundingClientRect().height > innerHeight * 0.5;
  el.scrollIntoView({ block: tall ? 'start' : 'center' });
  await new Promise(r => setTimeout(r, 120));
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top, 4), bottom = Math.min(r.bottom, innerHeight - 4);
  document.getElementById('tour')?.remove();
  const ring = h('div', { class: 'tour-ring', style: `left:${Math.max(r.left - 6, 2)}px; top:${top - 6}px; width:${Math.min(r.width + 12, innerWidth - 4)}px; height:${bottom - top + 12}px` });
  const below = !tall && bottom + 230 < innerHeight;
  const card = h('div', { class: 'tour-card', role: 'dialog', 'aria-label': step.title, style: below ? `top:${bottom + 14}px` : tall || top < 240 ? 'bottom:16px' : `bottom:${innerHeight - top + 14}px` },
    h('div', { class: 'seen' }, `${tourStep + 1} of ${TOUR.length}`),
    h('h3', {}, step.title), h('p', {}, step.text),
    h('div', { class: 'bar' },
      h('button', { class: 'small', onclick: endTour }, 'Skip'),
      h('span', { class: 'grow' }),
      tourStep ? h('button', { class: 'small', onclick: () => { tourStep--; showTourStep(); } }, 'Back') : null,
      h('button', { class: 'small primary', onclick: () => { tourStep++; showTourStep(); } }, tourStep === TOUR.length - 1 ? 'Done' : 'Next')));
  document.body.append(h('div', { id: 'tour' }, ring, card));
}
addEventListener('resize', () => { if (tourStep >= 0) showTourStep(); });
addEventListener('keydown', e => { if (tourStep >= 0 && e.key === 'Escape') endTour(); });
