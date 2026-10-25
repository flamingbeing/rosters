# NUH Roster: notes

What we know about the NUH anaesthesia department's daily roster and the decisions behind this app. Read this before changing `nuh-roster/`. The department section is useful to any app in the repo that deals with NUH anaesthesia staff or rosters.

The repo is public: never commit real staff names, rosters, leave, contact lists or HMS exports. Tests and demo data use made-up names only.

Topic files (all public, code facts only):

- [docs/department.md](docs/department.md): the department as the app models it: people and grades, postings, the daily roster sheet, notation, the rules it works by, the HMS monthly rosters and other inputs.
- [docs/decisions.md](docs/decisions.md): the app's decisions: address, storage, team sharing and rules, rotations, edit protection, My day, offline, sending out, practice mode, design, demo mode.
- [docs/limits.md](docs/limits.md): known limits and the notes on recent changes (live checks, accessibility, monthly planning, generator seniority, practice, help and What's new).

Setup steps (first admin, deploy) are in [README.md](README.md). What is happening now is kept outside this repo.

## Code map

| File | What |
|---|---|
| `js/engine.js` | No DOM. Grades, postings, name matching (`matchName`, short names), case-note flags, `generate()` (Hungarian assignment, double cover, AOCC/AIC, covers, premeds), `check()`, contact merge, duplicates, import planning. |
| `js/layout.js` | The sheet as cells; shared by the preview, the .xlsx and the PDF. |
| `js/xlsxio.js` | Reading drafts, staff sheets and the contact list; writing the roster workbook. |
| `js/store.js` | Loading saved data over a blank state (`mergeSaved`) and bringing old saved data up to date (`migrateRooms` v1→v4). Pure, tested. |
| `js/ics.js` | Calendar files (.ics) for My day and My week. |
| `js/help.js` | The app's own explanations: the key to the marks (`SYMBOLS`), "How do I…?" (`HOW`), What's new (`WHATS_NEW`). A test checks every mark in `guide.html` is also in the key. |
| `guide.html` | The printable one-page quick guide. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app and offline shell (VERSION stamped at deploy). |
| `js/rotations.js` | Junior rotations: weeks (by Monday), a junior's posting on a date, reading and writing the year's rotation as Excel. |
| `js/monthly.js` | The HMS monthly rosters: column definitions, PDF/Excel reading, Excel writing, what each roster means for a date. |
| `js/pdfout.js` | The roster PDF from the layout. |
| `js/pngout.js` | The roster as an image (canvas) from the layout. |
| `js/demo.js` | Demo data (invented names). |
| `js/cloud.js` | Firebase wrapper. |
| `js/unsent.js`, `js/docsync.js` | Unsent saves: the roster and team saves go through app-sync's outbox (see "Unsent saves" below). |
| `js/app.js` | The UI. |

## Testing

- `node nuh-roster/test/engine.test.mjs`: engine, monthly, duplicates, import planning. Fake names only.
- `node nuh-roster/test/e2e.mjs` (serve the repo on port 8080 first, `python3 -m http.server 8080`; `PORT=` to change,
  `SHOTS=<dir>` for screenshots): Practice with Firebase blocked, desktop and phone. 49 checks: every tour target exists,
  the live double-cover check and its fix, changes since sent and the "Updated" stamp, keyboard focus in the person
  box, the Fix 3 problems exercise, the practice draft through Do it all, monthly clashes and Undo, axe on every tab,
  phone sizes (16px fields, 30px targets, no sideways scroll), My day (copy for logbook, My week), the welcome card.
  Runs in the Checks workflow. A signed-in flow can be tried by routing `js/cloud.js` to a fake module (see how the
  13 Oct session tested viewers and team saves).
- The demo is built for tomorrow's date, so the browser test meets a different made-up day each day. A step that
  depends on the day (free seniors, who is on leave) must not assume a fixed outcome: start from "Reset this day" and
  allow for randomness (14 Oct: Fix 3 problems failed every PR when the day was short of a senior; #491).
- Real sample files (rosters, the contact list, HMS PDFs) must stay out of the repo.
- `node nuh-roster/test/docsync.test.mjs` (offline save kept and sent later, kept across a reload, a newer copy never overwritten unasked, sign-out gate and forget, reload waits while typing) and `precache.test.mjs` (sw.js holds every app-sync module at the pinned version). Both load app-sync's tag with `tools/app-sync-for-tests.mjs` (a shallow clone; `APP_SYNC_DIR=<checkout>` skips the clone).
- `node nuh-roster/test/claims.test.mjs`: when the page asks the Worker for its role claim, and the members entry's `v`.
- Rules: `bash tools/test-rules.sh` (`test/rules.emulator.mjs`, the kit's shared suite `test/rules.kit.emulator.mjs`,
  and the Worker's claims routes end to end in `worker/test/roster.emulator.mjs`), in the Checks `rules` job.

## Roles and the rules kit (25 Oct 2026)

- Rules: edit `firestore.app.rules`, then build the committed `firestore.rules` with app-devkit's
  `tools/build-rules.mjs` (it pastes in the kit's `rules/common.rules`; the kit is pinned at `v1.4.0` in the Checks
  `rules` job, which fails on a stale build).
- Roles: the token's claim `g._` when there is one, else `members/{email}.role` (older pages, or while the Worker has no
  service account). Reads cost 1 lookup on claims (`revoked/{uid}`), 2 on the members entry. Changes to the members
  list always check the admin's entry, never the claim.
- Worker (`worker/roster.js` on `worker/members.js`, this host only): `POST /api/claims` puts the role on the account
  (the page calls it after sign-in and when its entry's `v` is ahead, then refreshes its token); `POST /api/members/sync`
  (admins, after a change) writes `revoked/{uid}` for a removed or lowered member, so their older claim is refused at
  once. Without the secrets `ROSTER_SA_EMAIL` and `ROSTER_SA_KEY` both answer 503 and everything runs on the members entry.
- `members/{email}.v`: 1 when added, one more on each role change (rules-checked; older entries without one count as 0).

## Unsent saves (25 Oct 2026, app-sync 0.4.1 "document" profile)

- Saving the roster for a date and "Save for the team" go through `js/unsent.js` > `js/docsync.js`: app-sync's write
  queue and outbox (IndexedDB, then localStorage), exact pin `core.anawj.com/sync/0.4.1/`, every module precached in
  `sw.js`. The write itself is still `cloud.saveRoster` / `saveTeamAll` (one transaction, the same "someone saved first"
  check and confirm). Offline or cut off: the save is kept on the phone ("Kept on this phone"), a chip in the cloud bar
  shows how many wait (Retry; Set aside when one failed), and it is sent when the connection returns. A save whose answer
  was lost is recognised (the team's copy already holds the same content) and not shown as a conflict.
- Not the delta hub: the data is a few large documents read whole (no listeners, no `updatedAt` deltas); only the
  outbox, the sign-out gate and `canReload` are used.
- Sign-out (both buttons) refuses while any save is unsent, then `forgetDevice` forgets the outbox (and, for "Sign out
  and clear this computer", the roster, staff list and name in this browser).
- Update module 0.2.0 with `canReload`: a new version waits while someone is typing in a field or cell, a dialog or the
  person box is open, or a save waits. It is tried again when the field loses focus or the outbox empties.
- If core.anawj.com can't be reached the saves go straight to the team's copy as before (no outbox).
- Limit: a save that is sent after the page was reloaded is in the team's copy, but the page does not know its time
  (the next save shows "someone saved first" with the person's own name; OK saves over it).
