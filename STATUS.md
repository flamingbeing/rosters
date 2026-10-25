# Status

## Now
- Apps copied from anawj-site (21 Oct 2026). The three addresses are still served by anawj-site's Worker until the
  cut-over; this repo's Worker takes them over on its first deploy.

## Waiting on the owner
- nuh-roster claims: a service account in its Firebase project (Auth user admin + Firestore write), its email and key
  as the Worker secrets `ROSTER_SA_EMAIL` and `ROSTER_SA_KEY` (Cloudflare, Worker `rosters`); the same for ntf-roster
  (`NTF_SA_EMAIL`, `NTF_SA_KEY`). nuh-junior-monthly's (`JUNIOR_SA_*`) are set.
- Connect this repo in Workers Builds and move the three custom domains here (the owner has the link).

## Next (in order)
1. Cut-over: check each address serves this repo's copy and sign-in works (NTF through its own host).
2. anawj-site drops the three hosts and its copies.

## Recently done
- 25 Oct 2026: roster core started: the auto-fill engine moved to `lib/roster-core/solver.js` (the ~40 lines that differ
  between nuh-junior-monthly and ntf-roster are `createSolver` options); nuh-junior-monthly uses it, results pinned identical.
  ntf-roster untouched. Next for the core: rules and model (they differ by ~300-600 lines, so shared parts first).
- 25 Oct 2026: nuh-roster and nuh-junior-monthly unsent saves, two small losses fixed: sign-out clean-up now runs even
  when the outbox did not load, and a second offline save of one document no longer conflicts with the first.
- 25 Oct 2026: ntf-roster on the rules kit too (`worker/ntf.js`); all three apps now take role claims. Its Worker
  secrets `NTF_SA_EMAIL`/`NTF_SA_KEY` are still to add (until then its routes answer 503 and the members entry serves).
- 25 Oct 2026: nuh-roster on the rules kit too (same shape as nuh-junior-monthly; `worker/members.js` now holds the
  claims routes for both, one small file per app). Its Worker secrets `ROSTER_SA_EMAIL`/`ROSTER_SA_KEY` are still to
  add (until then its routes answer 503 and the members entry serves).
- 25 Oct 2026: nuh-junior-monthly on app-devkit's rules kit (v1.4.0): role claims through `/api/claims` on its host,
  removals and demotions cut off through `revoked/`, the members entry as fallback; a Checks `rules` job runs every app's
  rules tests. The Worker's service account for it is still to add (until then the routes answer 503).
- 22 Oct 2026: rules deploy keyless (WIF provider `rosters-repo` in nuh-roster, SA `firebase-rules-deployer`, rules
  admin on all three projects); runs on merge when a rules file changes, or by hand.
- 21 Oct 2026: imported nuh-roster, ntf-roster, nuh-junior-monthly, ntf-auth and `__/auth/`; one exceljs in `lib/`;
  kit from design.anawj.com; checks and rules workflows.

## Decisions (dated, one line each)
- 21 Oct 2026: one copy of exceljs at `/lib/` for the three apps (not `/vendor/`, which nuh-roster's own files use).
- 21 Oct 2026: the NTF roster's test of pulling rotations from APMES People moved out (People lives in the apmes repo).
