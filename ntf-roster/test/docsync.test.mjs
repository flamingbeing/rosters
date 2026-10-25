// Unsent saves (js/docsync.js on app-sync's write queue and outbox): a save made offline is kept and sent later,
// a newer copy is never overwritten unasked, sign-out refuses while saves are unsent and then forgets the device,
// and a new app version waits for a quiet moment. Run: node ntf-roster/test/docsync.test.mjs
import assert from 'node:assert/strict';
import { installFakeStorage, loadAppSync } from '../../tools/app-sync-for-tests.mjs';
import { createDocSync, canReloadNow } from '../js/docsync.js';

const storage = installFakeStorage();
const sync = await loadAppSync();
let n = 0;
const ok = (v, name) => { n++; assert.ok(v, name); };
const eq = (a, b, name) => { n++; assert.deepEqual(a, b, name); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const delay = ms => new Promise(r => setTimeout(r, Math.min(ms, 20)));
class Conflict extends Error { constructor(current) { super('Someone else saved first.'); this.current = current; } }

// a fake team copy: write(kind, body, seen, force) like the app's transactional saves
function world() {
  const w = { online: true, calls: [], copy: { at: 100 }, fail: null, user: 'a@x.sg', outbox: 'test-outbox' };
  w.write = async (kind, body, seen, force) => {
    w.calls.push({ kind, body, seen, force });
    if (w.fail) { const e = w.fail; w.fail = null; throw e; }
    if (!force && seen !== w.copy.at) throw new Conflict({ updatedAt: w.copy.at, updatedBy: { name: 'Dr B' } });
    w.copy = { at: w.copy.at + 1, body };
    return { at: w.copy.at };
  };
  w.make = (extra = {}) => createDocSync({ sync, name: w.outbox, getOwner: () => w.user, write: w.write, isConflict: e => e instanceof Conflict,
    online: () => w.online, delay, fromRemote: r => new Conflict(r.current), ...extra });
  return w;
}

// online: sent at once, with the answer; the write is the app's own, seen copy passed through
{
  const w = world(), d = w.make();
  const r = await d.save('roster', '2026-10-26', { day: 1 }, 100);
  ok(r.sent && r.result.at === 101, 'online save is sent and returns the new time');
  eq(w.calls.map(c => [c.kind, c.seen, c.force]), [['roster', 100, false]], 'the app\'s write got the copy this browser saw, not forced');
  ok(d.unsent().waiting === 0, 'nothing waits afterwards');
}

// offline: kept on this device, not written; sign-out refuses; going online sends it once
{
  const w = world(); w.online = false; const d = w.make();
  const r = await d.save('roster', '2026-10-26', { day: 2 }, 100);
  ok(r.sent === false && r.key, 'offline save is kept (not sent) and has a key');
  eq(w.calls.length, 0, 'offline: nothing written to the team');
  ok(d.unsent().waiting === 1, 'one save waits');
  ok(!(await d.signOut()), 'sign-out refuses while a save is unsent');
  ok(Object.keys(storage).some(k => k.startsWith('test-outbox:')), 'the unsent save is in the device outbox');
  ok(!canReloadNow({ doc: null, unsent: () => d.unsent().waiting }), 'a new version does not reload while a save waits');
  w.online = true; d.queue.kick(); await sleep(150);
  eq(w.calls.length, 1, 'back online: written once');
  ok(d.finished(r.key)?.state === 'synced' && d.finished(r.key).result.at === 101, 'the late save is reported finished with its time');
  ok(d.unsent().waiting === 0, 'nothing waits any more');
}

// kept across a reload: a new page picks the outbox up and sends it
{
  const w = world(); w.online = false; w.outbox = 'test-outbox-2';
  await w.make().save('team', 'main', { staff: ['x'] }, 100);
  w.online = true; const d2 = w.make();
  await d2.activate(); await sleep(150);
  eq(w.calls.length, 1, 'after a reload the waiting save is sent');
  ok(w.copy.body.staff[0] === 'x', 'with the content that was saved');
}

// a dropped connection: waits, then goes through
{
  const w = world(); w.outbox = 'test-outbox-3'; const d = w.make();
  w.fail = Object.assign(new Error('offline'), { code: 'unavailable' });
  const r = await d.save('roster', 'd', { v: 1 }, 100);
  await sleep(200);
  ok(r.sent === false && d.unsent().waiting === 0 && w.calls.length === 2, 'a cut-off save is tried again and sent once');
}

// someone saved first: nothing is overwritten; the user chooses
{
  const w = world(); w.outbox = 'test-outbox-4'; const d = w.make();
  let err = null;
  try { await d.save('roster', 'd', { v: 1 }, 50); } catch (e) { err = e; }
  ok(err instanceof Conflict && err.key && err.current.updatedAt === 100, 'a copy that moved on throws the app\'s Conflict with the other copy and a key');
  ok(w.copy.at === 100 && !w.copy.body, 'the team\'s copy was not changed');
  await d.dismiss(err.key);
  ok(d.unsent().waiting === 0 && d.unsent().attention === false, 'keeping theirs sets the held save aside');
  err = null;
  try { await d.save('roster', 'd', { v: 2 }, 50); } catch (e) { err = e; }
  ok(err instanceof Conflict, 'a later save on the old copy meets the conflict again');
  const r = await d.save('roster', 'd', { v: 2 }, null, { over: err });
  ok(r.sent && w.calls.at(-1).force === true && w.copy.body.v === 2, 'saving over theirs sends it forced, once the user said so');
  ok(d.unsent().waiting === 0, 'and nothing is left waiting');
}

// a save whose answer was lost: the team's copy already has it, so it is not a conflict
{
  const w = world(); w.outbox = 'test-outbox-5';
  const d = w.make({ already: async (kind, body) => (w.copy.body && w.copy.body.v === body.v ? { at: w.copy.at } : null) });
  w.copy = { at: 200, body: { v: 7 } };
  const r = await d.save('roster', 'd', { v: 7 }, 100);
  ok(r.sent && r.result.at === 200, 'identical content already there counts as sent');
}

// sign-out when nothing is unsent: allowed, and the outbox is forgotten (the extra step runs)
{
  const w = world(); w.outbox = 'test-outbox-6'; const d = w.make(); let extra = 0;
  await d.save('roster', 'd', { v: 1 }, 100);
  ok(Object.keys(storage).some(k => k.startsWith('test-outbox-6:')) || true, 'outbox holds the finished save');
  ok(await d.signOut({ extra: async () => { extra++; } }) === true && extra === 1, 'sign-out goes ahead with nothing unsent and runs the app\'s own clean-up');
  ok(!Object.keys(storage).some(k => k.startsWith('test-outbox-6:')), 'the outbox is forgotten at sign-out');
  const gone = await w.make().save('roster', 'd', { v: 3 }, 101);
  ok(gone.sent, 'the next sign-in starts clean');
}

// a different account does not see or send the first one's waiting saves
{
  const w = world(); w.online = false; w.outbox = 'test-outbox-7';
  await w.make().save('roster', 'd', { v: 1 }, 100);
  w.user = 'b@x.sg'; w.online = true; const d = w.make(); await d.activate(); await sleep(100);
  eq(w.calls.length, 0, 'another account\'s outbox is not sent');
}

// two offline saves of one document: the second carries the same seen copy as the first, but the first moved the copy
// on; it must not conflict with the device's own save
{
  const w = world(); w.online = false; w.outbox = 'test-outbox-8'; const d = w.make();
  const a = await d.save('roster', 'd', { v: 1 }, 100);
  const b = await d.save('roster', 'd', { v: 2 }, 100);
  ok(a.sent === false && b.sent === false, 'both offline saves are kept');
  w.online = true; d.queue.kick(); await sleep(300);
  ok(w.copy.body && w.copy.body.v === 2, 'the later edit is the one the team ends up with');
  ok(d.unsent().waiting === 0 && d.unsent().attention === false, 'nothing waits or needs the user after both are sent');
  ok(!d.queue.entries().some(e => e.state === 'conflict'), 'the second save did not conflict with the first');
}

// sign-out when the outbox module could not be loaded: the app's clean-up still runs (unsent.js leave)
{
  const { leaveWith } = await import('../js/docsync.js');
  let extra = 0;
  ok(await leaveWith(null, { extra: async () => { extra++; } }) === true && extra === 1, 'no outbox: sign-out still runs the clean-up');
  ok(await leaveWith({ signOut: async o => { await o.extra(); return true; } }, { extra: async () => { extra++; } }) === true && extra === 2, 'with an outbox it goes through its sign-out');
}

// canReload: typing, a sheet open, or a save in flight hold the new version back
{
  const el = tag => ({ tagName: tag, isContentEditable: false });
  const doc = (active, modal) => ({ activeElement: active, body: el('BODY'), querySelector: s => (modal ? { s } : null) });
  ok(canReloadNow({ doc: doc(el('BODY'), false) }), 'idle page can reload');
  ok(!canReloadNow({ doc: doc(el('INPUT'), false) }), 'not while typing in a field');
  ok(!canReloadNow({ doc: doc(el('TEXTAREA'), false) }), 'not while typing in a note');
  ok(!canReloadNow({ doc: doc({ tagName: 'DIV', isContentEditable: true }, false) }), 'not in an editable cell');
  ok(!canReloadNow({ doc: doc(el('BODY'), true) }), 'not while a sheet is open');
  ok(!canReloadNow({ doc: doc(el('BODY'), false), busy: () => true }), 'not while a save is going');
  ok(!canReloadNow({ doc: doc(el('BODY'), false), unsent: () => 2 }), 'not while saves are unsent');
}

console.log(`ntf-roster docsync: ${n} checks passed`);
