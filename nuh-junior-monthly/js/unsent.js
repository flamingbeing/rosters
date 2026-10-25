// Saves that wait for the connection: Save to cloud goes through app-sync's outbox (docsync.js), so a save made offline,
// or cut off, is kept on this device and sent again, and signing out refuses while any are unsent. If core.anawj.com
// can't be reached the save goes straight to the team's copy, as before.
import * as cloud from './cloud.js';
import { createDocSync, canReloadNow, leaveWith } from './docsync.js';

export const SYNC_URL = 'https://core.anawj.com/sync/0.4.1/index.js';
export const MODAL = 'dialog[open], .sheet-back';

const plain = o => JSON.parse(JSON.stringify(o));
// the staff list, rules and every changed month in one transaction (cloud.saveAll), as before
export async function write(kind, body, seen, force) {
  if (kind !== 'all') throw new Error('Unknown save: ' + kind);
  const s = seen || {};
  const { at, by } = await cloud.saveAll({ team: body.team, months: body.months }, { teamAt: s.team ?? null, monthsAt: s.months || {}, force });
  return { at, by };
}

// the team's copy already holds exactly this (the answer to an earlier send was lost): counts as sent
export async function already(kind, body, sig) {
  if (kind !== 'all') return null;
  const t = await cloud.loadTeam();
  if (!t) return null;
  const { updatedAt, updatedBy, ...team } = t;
  if (sig(plain(team)) !== sig(cloud.pickTeam(body.team))) return null;
  for (const x of body.months) {
    const d = await cloud.loadMonth(x.m);
    if (!d || sig(plain(d.cells)) !== sig(plain(x.cells || {})) || (d.status || 'draft') !== ((x.meta && x.meta.status) || 'draft')) return null;
  }
  return { at: updatedAt, by: updatedBy };
}

let docs = null, loading = null, owner = null, started = false;
const listeners = new Set();
export const onUnsentChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// the outbox, once core.anawj.com has answered; null when it can't be loaded (saves then go straight through)
export function load() {
  return loading ||= import(SYNC_URL).then(sync => {
    docs = createDocSync({ sync, name: 'nuh-junior-monthly-outbox', getOwner: () => owner, write, isConflict: e => e instanceof cloud.Conflict,
      already: (kind, body) => already(kind, body, sync.recordSignature),
      toRemote: e => ({ current: e.current, what: e.what, month: e.month }),
      fromRemote: r => new cloud.Conflict(r.what, r.current, r.month) });
    docs.queue.onChange(() => listeners.forEach(fn => fn()));
    return docs;
  }).catch(err => { console.warn('Unsent-saves outbox not loaded', err); return null; });
}

// at start: follow the sign-in, and send what an earlier visit left in the outbox once signed in
export async function start() {
  if (started || !cloud.enabled) return;
  started = true;
  try {
    await cloud.watchUser(u => { owner = u && u.email ? u.email.toLowerCase() : null; if (owner) load().then(d => d && d.activate()); });
  } catch (e) { started = false; console.warn('sign-in not watched', e); }
}

// { sent: true, result: { at, by } } or { sent: false, key } (kept here, waiting). Throws cloud.Conflict (with .key) when
// the team's copy moved on, or the save's error. opts.over: the Conflict the user chose to save over.
export async function save(kind, id, body, seen, opts) {
  const d = await load();
  if (d) return d.save(kind, id, body, seen, opts);
  return { sent: true, result: await write(kind, body, seen, !!opts?.over) };
}
export const finished = key => docs?.finished(key) || null;
export const dismiss = async key => (await load())?.dismiss(key);
export const counts = () => docs ? docs.unsent() : { waiting: 0, attention: 0 };
export const unsentCount = () => counts().waiting;
export async function retryAll() { const d = await load(); if (!d) return; d.queue.kick(); for (const e of d.queue.entries()) if (e.state === 'failed') await d.queue.retry(e.key).catch(() => {}); }
export async function discardAll() { const d = await load(); if (!d) return; for (const e of d.queue.entries()) if (e.state === 'failed' || e.state === 'conflict') await d.queue.archive(e.key); }
// sign-out gate: false while anything is unsent. Without the outbox there is nothing to wait for, but the clean-up still runs.
export async function leave(opts) { return leaveWith(await load(), opts); }
export const canReload = busy => canReloadNow({ unsent: unsentCount, busy, modal: MODAL });
