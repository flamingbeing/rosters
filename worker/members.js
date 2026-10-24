// The rules kit's claims routes for one app (app-devkit worker/claims.js, copied beside this file). Each app that takes
// role claims has a small file that calls memberClaims() with its address, Firebase config and secret names
// (worker/junior.js, worker/roster.js, ...):
//
//   POST /api/claims          the page sends its ID token; the Worker reads members/{email} and writes the role on the
//                             account as the claim { g: { _: role }, v } (the page then calls getIdToken(true))
//   POST /api/members/sync    an admin's page, after adding, changing or removing someone: { email }. The Worker checks the
//                             caller is an admin (their members entry), then cuts off that person's older claim at once:
//                             removed -> revoked/{uid} + claims cleared + sessions ended; lowered -> new claim and
//                             revoked/{uid} until their page asks /api/claims again (it does when the entry's v is ahead of its own).
//
// Served on the app's own host only (worker/routes.js API). Needs the app's two Worker secrets (a service account of its
// Firebase project that may manage Auth users and write Firestore); without them both routes answer 503 and the pages
// use the members entry, as before.
import { admin, handleClaims, verifyIdToken } from './claims.js';

const ROLES = ['admin', 'rosterer', 'viewer'];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });

// The claim for a members entry: a known role and its v, or null (not a member, or a mistyped role: the entry path
// still serves those, as before).
export function claimFor(entry) {
  if (!entry || !ROLES.includes(entry.role)) return null;
  return { g: { _: entry.role }, v: Number.isInteger(entry.v) && entry.v >= 0 ? entry.v : 0 };
}

const emailOf = (token) => (token.email_verified === true && typeof token.email === 'string' ? token.email.toLowerCase() : '');

// { origin: 'https://<host>', project: '<firebase project id>', secrets: ['<EMAIL secret>', '<KEY secret>'] }
// -> { ORIGIN, claimFor, setup, claims, membersSync }
export function memberClaims({ origin, project, secrets: [EMAIL, KEY] }) {
  // Options for tests: { adm, verify, emulator, authBase }. Normally built from env.
  function setup(env = {}, opts = {}) {
    const adm = opts.adm !== undefined ? opts.adm
      : env[EMAIL] && env[KEY] ? admin({ project, sa: { email: env[EMAIL], key: env[KEY] } }) : null;
    const authBase = opts.authBase || 'https://identitytoolkit.googleapis.com';
    const verify = opts.verify || ((t) => verifyIdToken(t, { project: adm.project, emulator: !!opts.emulator }));
    return { adm, verify, authBase, emulator: !!opts.emulator, limit: env.CLAIMS_LIMIT };
  }

  function claims(request, cfg) {
    return handleClaims(request, { admin: cfg.adm, origin, limit: cfg.limit, verify: cfg.adm ? cfg.verify : undefined,
      emulator: cfg.emulator,
      loadClaims: async ({ token, admin: a }) => {
        const email = emailOf(token);
        return email ? claimFor(await a.getDoc(`members/${email}`)) : null;
      } });
  }

  // The accounts with this email (Google sign-ins: one): [{ uid, claims }]
  async function accountsByEmail(cfg, email) {
    const r = await fetch(`${cfg.authBase}/v1/projects/${encodeURIComponent(cfg.adm.project)}/accounts:lookup`, {
      method: 'POST', headers: { Authorization: `Bearer ${await cfg.adm.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: [email] }) });
    if (!r.ok) throw new Error(`accounts:lookup ${r.status}`);
    const users = (await r.json()).users || [];
    return users.map((u) => { let c = {}; try { c = JSON.parse(u.customAttributes || '{}'); } catch {} return { uid: u.localId, claims: c }; });
  }

  async function membersSync(request, cfg) {
    if (request.method !== 'POST') return json({ error: 'POST only.' }, 405);
    const { adm } = cfg;
    if (!adm) return json({ error: 'Claims are not set up yet.' }, 503);
    const from = request.headers.get('Origin');
    if (from && from !== origin) return json({ error: 'Wrong origin.' }, 403);
    const idToken = (request.headers.get('Authorization') || '').match(/^Bearer\s+(\S+)$/)?.[1];
    if (!idToken) return json({ error: 'Sign in first.' }, 401);
    let token;
    try { token = await cfg.verify(idToken); } catch (e) { return json({ error: 'Sign in again.', why: e?.message }, 401); }
    let body;
    try { body = await request.json(); } catch { return json({ error: 'Send { email }.' }, 400); }
    const email = String(body?.email || '').trim().toLowerCase();
    if (!/^[^@\s/]+@[^@\s/]+$/.test(email)) return json({ error: 'Send { email }.' }, 400);
    try {
      // the caller's own entry decides, never their claim (it may be older)
      const me = emailOf(token);
      const mine = me ? await adm.getDoc(`members/${me}`) : null;
      if (!mine || mine.role !== 'admin' || await adm.getDoc(`revoked/${token.sub}`)) return json({ error: 'Admins only.' }, 403);
      const want = claimFor(await adm.getDoc(`members/${email}`));
      const done = [];
      for (const { uid, claims: had } of await accountsByEmail(cfg, email)) {
        if (!want) { await adm.revoke(uid); done.push('revoked'); continue; }
        const old = had?.g?._ || '';
        if (!old || old === want.g._) { done.push('unchanged'); continue; }
        await adm.setClaims(uid, want);
        // a lower role: refuse the older claim at once; a higher one can wait for the page's own refresh
        if (ROLES.indexOf(want.g._) > ROLES.indexOf(old)) { await adm.markRevoked(uid); done.push('cut off'); }
        else done.push('raised');
      }
      return json({ ok: true, accounts: done });
    } catch (e) {
      console.error('members sync failed', e?.message);
      return json({ error: 'Couldn’t update their access. Try again.' }, 500);
    }
  }

  return { ORIGIN: origin, claimFor, setup, claims, membersSync };
}
