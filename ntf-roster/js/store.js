// NTF Roster: the one place the roster state lives. Every change goes through commit(), which works on a copy
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

  // does month m have any days filled in?
  const hasDays = (st, m) => Object.keys(st.cells || {}).some(d => d.startsWith(m + '-'));

  const store = {
    isDemo: !!demo,
    key,
    onSaveError: null,   // set by the app: shows a bar with "Download backup"
    onLocked: null,      // set by the app: a change to a locked month was refused (shows why)
    unlocked: [],
    onConflict: null,    // set by the app: another tab saved first, this change was not saved

    get() { return state; },

    // Each roster's locked months whose days (for that roster's people) this change would alter (none is allowed to):
    // [{ m, pool }]. Someone not on the staff list any more counts with the junior roster.
    lockedHit(next) {
      const hit = [];
      let poolOfId = null;
      for (const m of Object.keys(state.months || {})) {
        for (const pool of M.RULE_POOLS) {
          if (!M.isMonthLocked(state, m, pool)) continue;
          if (!poolOfId) { const map = new Map((state.staff || []).map(p => [p.id, M.poolOf(state, p)])); poolOfId = id => map.get(id) || 'junior'; }
          const changed = M.monthDays(m).some(d => {
            const a = (state.cells || {})[d] || {}, b = (next.cells || {})[d] || {};
            if (a === b) return false;
            for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) if (poolOfId(id) === pool && JSON.stringify(a[id] || null) !== JSON.stringify(b[id] || null)) return true;
            return false;
          });
          if (changed) hit.push({ m, pool });
        }
      }
      return hit;
    },

    // opts.unlock: a change the user asked for on purpose (an import) unlocks the locked months it touches, in the same
    // undo step, instead of being refused. store.unlocked lists those months until the next commit.
    commit(label, fn, opts = {}) {
      const draft = structuredClone(state);
      const out = fn(draft);
      if (out === false) return false;   // fn can cancel by returning false
      const locked = store.lockedHit(draft);
      store.unlocked = [];
      if (locked.length && opts.unlock) { for (const x of locked) M.setMonthLocked(draft, x.m, false, x.pool); store.unlocked = [...new Set(locked.map(x => x.m))]; }
      else if (locked.length) { if (typeof store.onLocked === 'function') store.onLocked(locked.map(x => x.m), label, locked); return false; }
      undo.push({ label, state });
      if (undo.length > MAX_UNDO) undo.shift();
      redo = [];
      state = draft;
      store.save();
      notify(label, 'commit');
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

    // Every month with something in it is locked whenever the app opens (as in NUH junior monthly; an empty month has
    // nothing to protect, so a new roster can be started straight away): ensureLocked locks the month on screen the
    // first time it is seen with days in it, and lockAll every such month (at start, and again when the app is closed).
    // Unlocking lasts one visit. Quiet like a Getting started tick (not an undo step); never in practice.
    ensureLocked(m) {
      if (store.isDemo || !m || (state.months || {})[m] || !hasDays(state, m)) return false;
      const at = new Date().toISOString();
      state = { ...state, months: { ...(state.months || {}), [m]: M.monthMeta({ locks: { junior: at, senior: at }, note: '' }) } };
      store.save();
      notify('Lock ' + m, 'mark');
      return true;
    },
    lockAll() {
      if (store.isDemo) return false;
      const all = new Set([...Object.keys(state.months || {}), ...Object.keys(state.cells || {}).map(d => d.slice(0, 7))]);
      const open = [...all].map(m => [m, (state.months || {})[m]]).filter(([m, v]) => !(v && M.monthMeta(v).status === 'published') && hasDays(state, m));
      if (!open.length) return false;
      const months = { ...(state.months || {}) }, at = new Date().toISOString();
      for (const [m, v] of open) { const x = M.monthMeta(v); months[m] = M.monthMeta({ ...x, locks: { junior: x.locks.junior || at, senior: x.locks.senior || at }, note: x.note || '' }); }
      state = { ...state, months };
      store.save();
      notify('Lock every month', 'mark');
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
