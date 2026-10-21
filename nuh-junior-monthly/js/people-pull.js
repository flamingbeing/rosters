// APMES People → NUH Junior Monthly: pull the critical postings (ICU, cardiac, OG floats) from the rotation sheet that
// People has open. This app opens People in pull mode (?pull=rotations), answers its hello with what it needs (staff names,
// the posting codes it accepts, the weeks on screen) and receives the postings by postMessage once the user taps Send
// there. The text lands in Postings › Paste rotations for the user to look at and Apply; nothing is applied by itself.

import * as M from './model.js';
import { APMES_ORIGIN } from './apmes.js';
import { weeksOf } from './ui-postings.js';

const peopleURL = (app) => (/(^|\.)anawj\.com$/.test(location.hostname) ? APMES_ORIGIN + '/people/' : new URL('../people/', location.href).href)
  + '?' + (app.isDemo ? 'demo&' : '') + 'pull=rotations#rotations';

// What People is told: the roster's own names, the posting codes it accepts and the Mondays shown on the Postings screen.
export function pullInfo(state, month) {
  const gmap = M.groupMap(state);
  const names = M.staffInMonth(state, month).filter(p => (gmap.get(p.group) || {}).kind !== 'senior').map(p => p.name).filter(Boolean);
  const codes = (state.duties || []).filter(d => d.kind === 'posting').map(d => d.code);
  const weeks = weeksOf(month);
  return { type: 'nuhjm-pull-info', names, codes, from: weeks[0], to: weeks[weeks.length - 1], month };
}

export function pullFromPeople(app, onText) {
  const win = window.open(peopleURL(app), 'apmes-pull');
  if (!win) { app.toast('The browser blocked the new tab. Allow pop-ups for this site and try again.', { kind: 'warn' }); return; }
  const allowed = new Set([APMES_ORIGIN, location.origin]);
  const listener = e => {
    if (!allowed.has(e.origin) || e.source !== win) return;
    const d = e.data;
    if (!d) return;
    if (d.type === 'people-pull-hello') {
      win.postMessage(pullInfo(app.store.get(), app.month), e.origin);
    } else if (d.type === 'people-rotations' && typeof d.text === 'string' && d.text.length < 200000) {
      window.removeEventListener('message', listener);
      onText(d.text);
      try { window.focus(); } catch (err) { /* the browser decides */ }
      setTimeout(() => { try { win.close(); } catch (err) { /* it stays open */ } }, 400);
    }
  };
  window.addEventListener('message', listener);
  app.toast('Opened APMES People in a new tab: open the rotation sheet there, link the names and tap Send.', { ms: 6000 });
}
