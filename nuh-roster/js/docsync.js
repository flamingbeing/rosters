// Unsent saves for an app that saves whole documents (app-sync's "document" profile): every save goes to a durable
// outbox on this device first, then to the team's copy through the app's own transactional write, which keeps its
// "someone saved first" check. Offline or a dropped connection: the save waits and is sent again; it is never lost
// and never overwrites a newer copy unasked. Sign-out refuses while anything is unsent, then forgets the device.
//
// createDocSync({ sync, name, getOwner, write, isConflict, already, online })
//   sync: the app-sync module (createWriteQueue, createOutbox, forgetDevice), pinned by the app.
//   name: the outbox's database name. getOwner(): the signed-in account's email, or null.
//   write(kind, body, seen, force) -> { at } or whatever the app wants back: the app's own save (a transaction).
//     It throws its Conflict when the copy it saw is no longer the latest; `force` saves over it.
//   isConflict(e): true for that Conflict. already(kind, body, e) -> result | null: called on a conflict, says the
//     team's copy already holds exactly this content (a save whose answer was lost), so it counts as sent.
//   toRemote(e) / fromRemote(remote): the conflict as plain data (kept in the outbox) and back.
// save(kind, id, body, seen) -> { sent: true, result } | { sent: false, key } (kept on this device, waiting for the
//   connection). Throws the app's Conflict, with `.key` for dismiss(), or the save's own error.
// save(kind, id, body, null, { over: conflict }) saves over a conflict the user chose to override.
export function createDocSync({ sync, name, getOwner, write, isConflict, already = null, online = () => typeof navigator === 'undefined' || navigator.onLine !== false, toRemote = e => ({ current: e.current }), fromRemote = r => Object.assign(new Error('Someone else saved first.'), { current: r.current }), delay }) {
  const queue = sync.createWriteQueue({
    store: sync.createOutbox({ name }), getOwner, online, ...(delay ? { delay } : {}),
    labels: { recover: 'unsent saves' },
    backend: async (_owner, kind, record, base) => {
      try { return await write(kind, record.body, base?.seen ?? null, !!record.force); }
      catch (e) {
        if (!isConflict(e)) throw e;
        const same = already && await already(kind, record.body, e);
        if (same) return same;
        throw Object.assign(new Error(e.message), { code: 'write-conflict', remote: { id: record.id, ...toRemote(e) } });
      }
    },
  });
  const entry = (kind, id, state) => queue.entries().find(x => x.kind === kind && x.record.id === id && x.state === state);
  // a save followed to its end: { state, result } once it is synced or set aside, else null
  const finished = key => { const j = queue.entries().find(x => x.key === key); return j && (j.state === 'synced' || j.state === 'archived') ? { state: j.state, result: j.result } : null; };

  async function save(kind, id, body, seen = null, { over = null } = {}) {
    const email = getOwner();
    if (!email) throw new Error('Sign in to save');
    const record = { id, body, ...(over ? { force: true } : {}) };
    const base = over ? { id, ...toRemote(over) } : { id, seen };
    const conflicted = () => { const held = entry(kind, id, 'conflict'); return held && Object.assign(fromRemote(held.remote), { key: held.key }); };
    try {
      await queue.save(kind, email, record, base);
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
  // sign-out: refuses (false) while any save is unsent; otherwise the device forgets this account's outbox
  async function signOut({ proceed = async () => true, extra = null } = {}) {
    if (!(await queue.flush())) return false;
    const out = await sync.forgetDevice({ queue, proceed, extra });
    return out.wiped;
  }
  return { queue, save, finished, dismiss, unsent, signOut, activate: () => { const e = getOwner(); return e ? queue.activate(e) : null; } };
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
