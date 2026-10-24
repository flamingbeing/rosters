# Status

## Now
- Apps copied from anawj-site (21 Oct 2026). The three addresses are still served by anawj-site's Worker until the
  cut-over; this repo's Worker takes them over on its first deploy.

## Waiting on the owner
- nuh-junior-monthly claims: a service account in its Firebase project (Auth user admin + Firestore write), its email
  and key as the Worker secrets `JUNIOR_SA_EMAIL` and `JUNIOR_SA_KEY` (Cloudflare, Worker `rosters`).
- Connect this repo in Workers Builds and move the three custom domains here (the owner has the link).

## Next (in order)
1. Cut-over: check each address serves this repo's copy and sign-in works (NTF through its own host).
2. anawj-site drops the three hosts and its copies.

## Recently done
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
