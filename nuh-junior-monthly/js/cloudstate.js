// NUH Junior Monthly: what the header's cloud button shows. It remembers, per device, when this browser's roster last changed,
// when it was last saved to or pulled from the cloud, and what the cloud was last known to hold. No network here: ui-team.js
// does the talking and records the answers.
const KEY = 'nuhjm-cloud-sync';
let cache = null;

function load() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null') || {};
    return { changed: +o.changed || 0, synced: +o.synced || 0, cloudAt: +o.cloudAt || 0, cloudBy: typeof o.cloudBy === 'string' ? o.cloudBy : '', newer: !!o.newer };
  } catch (e) { return { changed: 0, synced: 0, cloudAt: 0, cloudBy: '', newer: false }; }
}
export function read() { if (!cache) cache = load(); return cache; }
function write(patch) {
  cache = { ...read(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { /* private window: the label just stays as it is */ }
  return cache;
}

// this browser's roster changed (an edit, an undo, a pull's replace): nothing is new for the cloud until it is saved
export const noteChange = (at = Date.now()) => write({ changed: at });
// saved to or pulled from the cloud: this browser and the cloud now agree
export const noteSynced = (cloudAt = 0, cloudBy = '') => write({ synced: Date.now(), cloudAt: cloudAt || read().cloudAt, cloudBy: cloudBy || read().cloudBy, newer: false });
// what a check of the cloud found: the time and name of its last save, and whether it is newer than what this browser has
export const noteCloud = (cloudAt, cloudBy, newer) => write({ cloudAt: cloudAt || 0, cloudBy: cloudBy || '', newer: !!newer });

const clock = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }).replace(/^0/, '');

// { kind, label, short, title }: kind is 'none' (never used the cloud here), 'saved', 'unsaved', 'newer' or 'both'
export function headerState(now = Date.now()) {
  const s = read();
  const unsaved = s.changed > s.synced;
  const day = ms => (new Date(ms).toDateString() === new Date(now).toDateString() ? clock(ms) : new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  if (!s.synced && !s.changed && !s.cloudAt) return { kind: 'none', label: 'Cloud', short: 'Cloud', title: 'Save this roster to the cloud, or pull it from there' };
  if (unsaved && s.newer) return { kind: 'both', label: 'Cloud differs', short: 'Differs', title: 'This browser has changes the cloud lacks, and the cloud has changes this browser lacks. Open to choose.' };
  if (s.newer) return { kind: 'newer', label: 'Cloud is newer', short: 'Newer', title: 'Someone saved a newer copy to the cloud. Open to pull it.' };
  if (unsaved) return { kind: 'unsaved', label: 'Not saved', short: 'Not saved', title: 'Changes in this browser are not in the cloud yet. Open to save them.' };
  return { kind: 'saved', label: s.synced ? `Saved ${day(s.synced)}` : 'Cloud', short: 'Saved', title: 'This browser and the cloud match' + (s.synced ? ` (as of ${day(s.synced)})` : '') };
}
