// NUH Junior Monthly: the one place the roster state lives. Every change goes through commit(), which works on a copy
// (structuredClone), keeps the old state for undo (up to 40 steps), saves to localStorage and tells subscribers.
// Like a paper roster with a photocopy taken before every edit: undo puts the last photocopy back.
import * as M from './model.js';

const MAX_UNDO = 40;

//
// Two tabs (or the installed app and a browser tab) share one saved copy. Each save bumps a revision number kept
// beside it (`<key>-rev`); a tab never saves over a newer revision, and when another tab saves, this one reloads the
// saved copy (the `storage` event) instead of overwriting it later with its own older copy.
// A saved copy that can't be read is kept aside (`<key>-damaged-<date>`) and nothing is saved over it until the
// person chooses to start again (store.damaged; the app shows a bar with "Download damaged copy").
export function createStore({ demo = false, fallback } = {}) {
  const key = demo ? M.DEMO_KEY : M.STORE_KEY;
  const revKey = key + '-rev';
  let rev = 0;           // the revision this tab's copy came from
  let damaged = null;    // { raw, key } when the saved copy couldn't be read
  let state = load();
  let undo = [];   // [{ label, state }] newest last
  let redo = [];
  const subs = new Set();

  function readRev() { try { return Number(localStorage.getItem(revKey)) || 0; } catch (e) { return 0; } }

  function load() {
    let raw = null, saved = null;
    try { raw = localStorage.getItem(key); } catch (e) { raw = null; }
    rev = readRev();
    if (raw) {
      try { saved = JSON.parse(raw); } catch (e) { saved = null; }
      const s = saved && typeof saved === 'object' && !Array.isArray(saved) ? safeMigrate(saved) : null;
      if (s) return s;
      keepDamaged(raw);
    }
    const fresh = typeof fallback === 'function' ? fallback() : (fallback || M.defaultState());
    return safeMigrate(fresh) || M.defaultState();
  }

  function keepDamaged(raw) {
    const dkey = `${key}-damaged-${M.iso(new Date())}`;
    try { if (!localStorage.getItem(dkey)) localStorage.setItem(dkey, raw); } catch (e) { /* full: the copy stays in memory for download */ }
    damaged = { raw, key: dkey };
    console.warn('saved roster could not be read; kept as', dkey);
  }

  function safeMigrate(s) {
    try { return M.migrate ? M.migrate(s) : s; } catch (e) { console.warn('migrate failed', e); return null; }
  }

  // another tab saved: take its copy (undo steps from before would bring back our older copy, so they go)
  function reloadFromStorage(label) {
    const next = load();
    if (damaged) return;
    state = next; undo = []; redo = [];
    notify(label, 'external');
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', e => {
      if (e.key !== key && e.key !== revKey && e.key !== null) return;
      if (readRev() === rev && e.key !== null) return;
      reloadFromStorage('Updated with changes from another tab or window');
    });
  }

  // Getting started ticks (settings.onboarding: { codes, rules, shared, hidden, done }) are about the person, not the
  // roster: undo and redo keep the newer ticks instead of taking them back with the edit.
  function withMarks(next, cur) {
    const a = next.settings && next.settings.onboarding, b = cur.settings && cur.settings.onboarding;
    if (!b || JSON.stringify(a) === JSON.stringify(b)) return next;
    return { ...next, settings: { ...next.settings, onboarding: { ...(a || {}), ...b } } };
  }

  function notify(label, source) {
    for (const fn of subs) {
      try { fn(state, { label, source }); } catch (e) { console.error(e); }
    }
  }

  const store = {
    isDemo: !!demo,
    key,
    onSaveError: null,   // set by the app: shows a bar with "Download backup"
    onLocked: null,      // set by the app: a change to a locked month was refused (shows why)
    onConflict: null,    // set by the app: another tab saved first, this change was not saved

    get() { return state; },

    // Months that are locked now and whose days this change would alter (none is allowed to).
    lockedHit(next) {
      const hit = [];
      for (const m of Object.keys(state.months || {})) {
        if (!M.isMonthLocked(state, m)) continue;
        if (M.monthDays(m).some(d => JSON.stringify((state.cells || {})[d] || null) !== JSON.stringify((next.cells || {})[d] || null))) hit.push(m);
      }
      return hit;
    },

    commit(label, fn) {
      const draft = structuredClone(state);
      const out = fn(draft);
      if (out === false) return false;   // fn can cancel by returning false
      const locked = store.lockedHit(draft);
      if (locked.length) { if (typeof store.onLocked === 'function') store.onLocked(locked, label); return false; }
      undo.push({ label, state });
      if (undo.length > MAX_UNDO) undo.shift();
      redo = [];
      state = draft;
      store.save();
      notify(label, 'commit');
      return true;
    },

    // Every month is locked whenever the app opens (owner, 16 Oct 2026): a month with no entry yet gets a locked one, and
    // lockAll locks every month that exists (at start, and again when the app is closed). Unlocking lasts one visit.
    // Quiet like a Getting started tick (not an undo step); never in Practice.
    ensureLocked(m) {
      if (store.isDemo || !m || (state.months || {})[m]) return false;
      state = { ...state, months: { ...(state.months || {}), [m]: { status: 'published', publishedAt: new Date().toISOString(), note: '' } } };
      store.save();
      notify('Lock ' + m, 'mark');
      return true;
    },
    lockAll() {
      if (store.isDemo) return false;
      const open = Object.entries(state.months || {}).filter(([, v]) => !(v && v.status === 'published'));
      if (!open.length) return false;
      const months = { ...(state.months || {}) };
      for (const [m, v] of open) months[m] = { ...(v || {}), status: 'published', publishedAt: new Date().toISOString(), note: (v && v.note) || '' };
      state = { ...state, months };
      store.save();
      notify('Lock every month', 'mark');
      return true;
    },

    // A Getting started tick or "hide the checklist" (merged into settings.onboarding): saved, backed up and shared
    // like any change, but not an undo step (it isn't an edit of the roster). Subscribers get source 'mark'.
    mark(patch, label = 'Getting started') {
      const ob = (state.settings && state.settings.onboarding) || {};
      if (Object.entries(patch).every(([k, v]) => ob[k] === v)) return false;
      state = { ...state, settings: { ...state.settings, onboarding: { ...ob, ...patch } } };
      store.save();
      notify(label, 'mark');
      return true;
    },

    replace(next, label = 'Replace') {
      const migrated = safeMigrate(structuredClone(next));
      if (!migrated) throw new Error('This roster is damaged: it could not be read.');
      undo.push({ label, state });
      if (undo.length > MAX_UNDO) undo.shift();
      redo = [];
      state = migrated;
      store.save();
      notify(label, 'replace');
    },

    undo() {
      const step = undo.pop();
      if (!step) return null;
      redo.push({ label: step.label, state });
      state = withMarks(step.state, state);
      store.save();
      notify(step.label, 'undo');
      return step.label;
    },

    redo() {
      const step = redo.pop();
      if (!step) return null;
      undo.push({ label: step.label, state });
      state = withMarks(step.state, state);
      store.save();
      notify(step.label, 'redo');
      return step.label;
    },

    canUndo() { return undo.length > 0; },
    canRedo() { return redo.length > 0; },
    undoLabel() { return undo.length ? undo[undo.length - 1].label : ''; },
    redoLabel() { return redo.length ? redo[redo.length - 1].label : ''; },

    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    get damaged() { return damaged; },
    // the person chose to start again (or downloaded the damaged copy): saving may go ahead
    clearDamaged() { damaged = null; store.save(); },

    save() {
      if (damaged) return false;   // never save over a damaged copy until the person says so
      try {
        if (readRev() > rev) {
          // another tab saved after this copy was loaded: keep theirs, show it, and say this change wasn't saved
          reloadFromStorage('Not saved: this roster was changed in another tab or window. This is the latest copy; make your change again.');
          return false;
        }
        localStorage.setItem(key, JSON.stringify(state));
        rev += 1;
        localStorage.setItem(revKey, String(rev));
        return true;
      } catch (e) {
        console.warn('save failed', e);
        if (typeof store.onSaveError === 'function') store.onSaveError(e);
        return false;
      }
    },

    // Start again from a fresh state (used by "Reset practice"). Undoable like any replace.
    reset(fresh, label = 'Reset') { store.replace(fresh, label); },
  };
  return store;
}
