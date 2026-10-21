// APMES People → NTF Roster: pull where each person is posted or away, week by week, from the rotation sheet People has open.
// This app opens People in pull mode (?pull=ntf), answers its hello with what it needs (the roster's names, the weeks of the
// month on screen) and receives the text by postMessage once the user taps Send there. The text goes to a review first;
// nothing is applied by itself.
import { pullInfo } from './rotations.js';

export const APMES_ORIGIN = 'https://apmes.anawj.com';

const peopleURL = app => (/(^|\.)anawj\.com$/.test(location.hostname) ? APMES_ORIGIN + '/people/' : new URL('../people/', location.href).href)
  + '?' + (app.isDemo ? 'demo&' : '') + 'pull=ntf#rotations';

export function pullFromPeople(app, onText) {
  const win = window.open(peopleURL(app), 'apmes-pull');
  if (!win) { app.toast('The browser blocked the new tab. Allow pop-ups for this site and try again.', { kind: 'error' }); return; }
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
