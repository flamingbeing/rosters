// Saves that wait for the connection: the roster and the team list go through app-sync's outbox (docsync.js), so a
// save made offline, or cut off, is kept on this phone and sent again, and signing out refuses while any are unsent.
// If core.anawj.com can't be reached the saves go straight to the team's copy, as before.
import * as cloud from './cloud.js';
import { createDocSync, canReloadNow, leaveWith } from '../../lib/roster-core/docsync.js';

export const SYNC_URL = 'https://core.anawj.com/sync/0.6.0/index.js';
export const MODAL = 'dialog[open], .tag-editor';

const plain = o => JSON.parse(JSON.stringify(o));
// what to write for each kind: the app's own transactions (cloud.js), which keep the "someone saved first" check
export async function write(kind, body, seen, force) {
  if (kind === 'roster') return { at: await cloud.saveRoster(body.date, { day: body.day, roster: body.roster }, body.user, { expectedUpdatedAt: seen, force }) };
  if (kind === 'team') return { at: (await cloud.saveTeamAll({ team: body.team, months: body.months, rotations: body.rotations }, body.user, { expectedUpdatedAt: seen, force })).updatedAt };
  throw new Error('Unknown save: ' + kind);
}

// the team's copy already holds exactly this (the answer to an earlier send was lost): counts as sent
export async function already(kind, body, sig) {
  if (kind === 'roster') {
    const cur = await cloud.loadRoster(body.date);
    return cur && sig(plain({ day: cur.day, roster: cur.roster })) === sig(plain({ day: body.day, roster: body.roster })) ? { at: cur.updatedAt } : null;
  }
  if (kind === 'team') {
    const [t, m, r] = await Promise.all([cloud.loadTeam(), cloud.loadMonthly(), cloud.loadRotations()]);
    if (!t || !m || !r) return null;
    const { updatedAt, updatedBy, ...team } = t;
    return sig(plain({ team, months: m.months || {}, weeks: r.weeks || {} })) === sig(plain({ team: body.team, months: body.months, weeks: body.rotations.weeks || {} })) ? { at: updatedAt } : null;
  }
  return null;
}

let docs = null, loading = null, getOwner = () => null;
const listeners = new Set();
export const onUnsentChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

// the outbox, once core.anawj.com has answered; null when it can't be loaded (saves then go straight through)
export function setOwner(fn) { getOwner = fn; }
export function load() {
  return loading ||= import(SYNC_URL).then(sync => {
    docs = createDocSync({ sync, name: 'nuh-roster', sdk: cloud.sdk, claims: cloud.claimsConfig, getOwner: () => getOwner(), write, isConflict: e => e instanceof cloud.Conflict,
      already: (kind, body) => already(kind, body, sync.recordSignature),
      fromRemote: r => new cloud.Conflict(r.current) });
    docs.queue.onChange(() => listeners.forEach(fn => fn()));
    cloud.useApp(async () => docs.app);
    return docs;
  }).catch(err => { console.warn('Unsent-saves outbox not loaded', err); return null; });
}

// save one document; { sent: true, result: { at } } or { sent: false } (kept here, waiting). Throws cloud.Conflict (with
// .key) when the team's copy moved on, or the save's error.
export async function save(kind, id, body, seen, opts) {
  const d = await load();
  if (d) return d.save(kind, id, body, seen, opts);
  return { sent: true, result: await write(kind, body, seen, !!opts?.over) };
}
// after sign-in: saves left in the outbox by an earlier visit are sent now
export const resume = async () => (await load())?.activate();
export const finished = key => docs?.finished(key) || null;
export const dismiss = async key => (await load())?.dismiss(key);
export const counts = () => docs ? docs.unsent() : { waiting: 0, attention: 0 };
export const unsentCount = () => counts().waiting;
// Retry now / set aside what could not be sent
export async function retryAll() { const d = await load(); if (!d) return; d.queue.kick(); for (const e of d.queue.entries()) if (e.state === 'failed') await d.queue.retry(e.key).catch(() => {}); }
export async function discardAll() { const d = await load(); if (!d) return; for (const e of d.queue.entries()) if (e.state === 'failed' || e.state === 'conflict') await d.queue.archive(e.key); }
// sign-out gate: false while anything is unsent. Without the outbox there is nothing to wait for, but the clean-up still runs.
export async function leave(opts) { return leaveWith(await load(), opts); }
export const canReload = busy => canReloadNow({ unsent: unsentCount, busy, modal: MODAL });
