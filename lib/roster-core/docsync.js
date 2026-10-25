// Unsent saves for a roster app that saves whole documents (app-sync's createApp with the app's own transactional write):
// every save goes to a durable outbox on this device first, then to the team's copy through the app's own write, which
// keeps its "someone saved first" check. Offline or a dropped connection: the save waits and is sent again; it is never
// lost and never overwrites a newer copy unasked. Sign-out refuses while anything is unsent, then forgets the device and
// signs out. One copy for the roster apps; what differs between apps is an option, not a fork.
//
// createDocSync({ sync, name, sdk, getOwner, write, isConflict, already, online, claims, forget, app })
//   sync: the app-sync module (createApp, recordSignature), pinned by the app.
//   name: the app's id (its outbox is `<name>-outbox`). sdk(): async () -> { A, F, auth, db, emulator }, the app's own
//   Firebase SDK, already initialised. getOwner(): the signed-in account's email, or null.
//   write(kind, body, seen, force) -> { at } or whatever the app wants back: the app's own save (a transaction).
//     It throws its Conflict when the copy it saw is no longer the latest; `force` saves over it.
//   isConflict(e): true for that Conflict. already(kind, body, e) -> result | null: called on a conflict, says the
//     team's copy already holds exactly this content (a save whose answer was lost), so it counts as sent.
//   toRemote(e) / fromRemote(remote): the conflict as plain data (kept in the outbox) and back.
//   claims: createApp's claims option (the Worker route that puts the role on the account). forget: its forget option
//   (`extra`: what the app keeps in this browser). app: more createApp options (nav, storage, ... for tests).
// -> { app, queue, save, finished, dismiss, unsent, signOut, activate }
// save(kind, id, body, seen) -> { sent: true, result } | { sent: false, key } (kept on this device, waiting for the
//   connection). Throws the app's Conflict, with `.key` for dismiss(), or the save's own error.
// save(kind, id, body, null, { over: conflict }) saves over a conflict the user chose to override.
export function createDocSync({ sync, name, sdk, getOwner, write, isConflict, already = null, online = () => typeof navigator === 'undefined' || navigator.onLine !== false, toRemote = e => ({ current: e.current }), fromRemote = r => Object.assign(new Error('Someone else saved first.'), { current: r.current }), delay, claims = null, forget = {}, app: appOptions = {} }) {
  // the copy this device's last sent save left, per document: back-to-back offline saves all carry the same `seen`, so
  // each one after the first is sent against what the one before it wrote (not as a conflict with the device's own save)
  const sentSeen = new Map();
  let leaving = null;   // the app's clean-up for the sign-out being run (signOut's `extra`)
  const commit = async (_owner, kind, record, base) => {
    const k = kind + ':' + record.id, seen = base?.seen ?? null, prev = sentSeen.get(k);
    try {
      const out = await write(kind, record.body, !record.force && prev && prev.seen === seen ? prev.at : seen, !!record.force);
      sentSeen.set(k, { seen, at: out?.at });
      return out;
    }
    catch (e) {
      if (!isConflict(e)) throw e;
      const same = already && await already(kind, record.body, e);
      if (same) return same;
      throw Object.assign(new Error(e.message), { code: 'write-conflict', remote: { id: record.id, ...toRemote(e) } });
    }
  };
  const app = sync.createApp({
    name, colls: ['roster'], path: () => [], sdk, commit,
    // the saves are the app's own transactions and it reads its documents itself: nothing is listened to or cached here
    adapter: { listen: () => () => {}, fetchOne: async () => null, clearCache: null },
    scope: u => u.email,
    nav: { get onLine() { return online(); } },
    queue: { labels: { recover: 'unsent saves' }, ...(delay ? { delay } : {}) },
    ...(claims ? { claims } : {}), ...appOptions,
    forget: { ...forget, extra: async () => { await leaving?.(); await forget.extra?.(); } },
  });
  const queue = app.queue;
  const entry = (kind, id, state) => queue.entries().find(x => x.kind === kind && x.record.id === id && x.state === state);
  // a save followed to its end: { state, result } once it is synced or set aside, else null
  const finished = key => { const j = queue.entries().find(x => x.key === key); return j && (j.state === 'synced' || j.state === 'archived') ? { state: j.state, result: j.result } : null; };
  // the outbox belongs to the signed-in account: opened once per account (sign-in does it too)
  let opened = null;
  const open = async email => { if (opened !== email) { await app.open(email); opened = email; } };

  async function save(kind, id, body, seen = null, { over = null } = {}) {
    const email = getOwner();
    if (!email) throw new Error('Sign in to save');
    await open(email);
    const record = { id, body, ...(over ? { force: true } : {}) };
    const base = over ? { id, ...toRemote(over) } : { id, seen };
    const conflicted = () => { const held = entry(kind, id, 'conflict'); return held && Object.assign(fromRemote(held.remote), { key: held.key }); };
    try {
      await app.save(kind, email, record, base);
      await queue.settle(kind, [id]);   // save() returns after 180 ms; a slow connection finds a newer copy later
    } catch (e) { throw conflicted() || e; }
    const held = conflicted();
    if (held) throw held;
    const failed = entry(kind, id, 'failed');
    if (failed) throw Object.assign(new Error(failed.error), { code: failed.code });
    const key = queue.jobKey(kind, id), job = queue.entries().find(x => x.key === key);
    return job?.state === 'synced' ? { sent: true, result: job.result } : { sent: false, key };
  }
  // the user chose to keep the team's copy: set the held save aside
  const dismiss = key => queue.archive(key);
  // saves waiting or needing the user: { waiting, attention }
  const unsent = () => ({ waiting: queue.pending(), attention: queue.attention() });
  // sign-out: refuses (false) while any save is unsent; otherwise the device forgets this account's outbox and the
  // account is signed out
  async function signOut({ extra = null } = {}) {
    leaving = extra;
    const out = await app.signOut().finally(() => { leaving = null; });
    if (out.ok) { sentSeen.clear(); opened = null; }
    return out.ok;
  }
  return { app, queue, save, finished, dismiss, unsent, signOut, activate: () => { const e = getOwner(); return e ? open(e) : null; } };
}

// Sign-out gate for an app whose outbox may not have loaded (core.anawj.com unreachable): with no outbox there is nothing
// unsent to wait for, but the app's own clean-up (`extra`: what it keeps in this browser) must still run.
export async function leaveWith(docs, opts) {
  if (!docs) { await opts?.extra?.(); return true; }
  return docs.signOut(opts);
}

// The take-over reload of a new app version waits while this says no: someone is typing, a sheet is open, a save is
// being sent or waits to be sent.
export function canReloadNow({ doc = typeof document === 'undefined' ? null : document, unsent = () => 0, busy = () => false, modal = 'dialog[open]' } = {}) {
  if (busy() || unsent() > 0) return false;
  if (!doc) return true;
  const a = doc.activeElement;
  if (a && a !== doc.body && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable)) return false;
  return !doc.querySelector(modal);
}
