# NTF Roster: Data in and out, storage and sign-in

Part of [NOTES.md](../NOTES.md). Excel, rotations from APMES People, storage and team sharing, the month lock, sign-in on this host and one roster at a time.

## Excel (`js/io.js`)

Import reads the department sheet: the month row in column A (`DECEMBER 2026`) with day numbers across, including the
end of the month before and a trailing `JAN` block, mapped to real dates; section rows map to groups; names matched
ignoring case, spaces and titles; count rows, the legend and the MEETING REQUESTS block skipped (meetings become day
notes). For the people and months in the sheet, leave, requests and other codes come from the sheet; shifts already
planned in the app stay unless the sheet has a shift that day; dates from the neighbouring months only fill empty
cells. A review sheet shows people (matched or new), cells per month and unknown codes before anything changes, and
Apply is one undo step. Export writes the same layout (one sheet per month, whole weeks, colours, x after calls,
counts, legend); exporting and re-importing gives the same cells (the browser test checks it). ExcelJS is loaded
only when Excel is used.

## Rotations from APMES People (`js/rotations.js`, `js/people-pull.js`)

More › Pull rotations from APMES People… opens People (`people/?pull=ntf#rotations`, the real app on the same host in tests
and previews). People says hello, this app answers `ntf-pull-info` (its names, the Mondays of the month's weeks, the month);
the user links sheet names to roster names there once and taps Send, and the text lands in a review (More › Paste rotations…
takes the same text by hand). One word per person per week: `NTF` (posted here: nothing to mark), `NUH`, `KKH`, `TTSH`,
`OTH` (posted at another hospital) and the leave codes `AL`, `ML`, `NPL`, `NS` (national service; from SAF on the sheet).
Only the month on screen, weekdays, not public holidays, from the person's start date, and not where the person already has
a leave or away code (the department sheet wins); shifts stay. Codes the roster lacks (`KKH`, `TTSH`, `OTH`, `NS`) are added as
kind "other" on Apply. Apply is one undo step. People leaves out exam weeks and OG1/OG2 (owner, 18 Oct 2026). Both ends check
the origin; the roster never reads APMES data itself. Tests: `test/rotations.test.mjs`, `test/e2e.mjs` (the pull through
the real People app).

## Storage, practice and team sharing

- Local first: everything lives in this browser until team sharing is switched on; Backup (JSON) moves it.
- Two tabs (or the installed app and a tab) share one saved copy: each save bumps `<key>-rev`, a tab never saves over
  a newer revision, and another tab's save reloads this one ("Updated with changes from another tab"). A saved copy
  that can't be read is kept as `<key>-damaged-<date>` and nothing is saved over it until the person chooses (bar:
  Download damaged copy / Start again).
- `?demo` is the practice department (`js/demo.js`): 65 invented people, leave, requests, clinics, APS weeks and
  meetings for this month and next; this month filled with no must-fix problems, next month left for Auto-fill. It
  never signs in and saves under its own key.
- Team sharing (`js/cloud.js`, `js/ui-team.js`, `firestore.rules`): off until `js/firebase-config.js` is filled. Then
  Google sign-in; `team/main` holds staff, codes, rules and settings, `months/{YYYY-MM}` one month's cells (a JSON
  string, as in NUH junior monthly: a map of cells can pass Firestore's index-entry limit). Save to cloud sends the team
  copy and every month whose fingerprint changed, in one transaction; Pull brings every month. The header's cloud button
  (`js/cloudstate.js`, per device) shows saved, not saved or cloud newer, and opens the panel; a quiet check runs once a
  minute at most once the cloud has been used here. The pool switch does not count as a change. Every save
  checks nobody else saved since you loaded (conflict: pull theirs, save anyway, or, when the view is one pool, merge:
  `J.mergeByPool` keeps this browser's pool's people, shifts and rules only about them, takes theirs for the rest, then
  saves) and keeps a permanent copy
  (`versions`). The rules allow only `{ email, name }` stamps with the saver's own email (the app shows the email
  beside the name) and no save times more than 10 minutes in the future. Members are admin, rosterer (both save) or viewer (reads). Rules tested in the emulator
  (`tools/test-rules.sh`, project `demo-ntf-roster`). `team/main` also carries `aps` (the APS week tally); the pool you
  look at (`settings.pool`) stays in each browser. The rules deploy on merge (matrix entry in
  `deploy-firestore-rules.yml`).
- Installable and offline (`sw.js`, `manifest.webmanifest`); More ends with the app version and "Get the latest
  version" (AGENTS.md).

## Month lock and header (19 Oct 2026)

- Month lock as in NUH junior monthly: a month is locked when `months[m].status` is `published` (shared through the
  month document). `store.commit` refuses any change to a locked month's days (`onLocked` shows why); the padlock beside
  Today toggles it, and the roster shows a slim "is locked, Unlock to edit" line. Every month with days in it locks when
  the app opens and when it closes (`lockAll`, `ensureLocked`); an empty month is left open so a new roster can start.
  Excel import and Rotations from People pass `{ unlock: true }`: they unlock the months they fill, in the same undo
  step. Never in practice.
- Header: one line on phones (name, cloud, undo, redo, help; then month, Today, padlock, Fill). The main button reads
  "Fill" with no icon; it hides in a locked month.

## Sign-in on this host (19 Oct 2026)

- `authDomain` is `ntfroster.anawj.com`: the Worker serves Firebase's helper pages at `/__/auth/` (the shared copies)
  and `/__/firebase/init.json` from `ntf-auth/firebase/` (as apmes does; logbook/README.md, sign-in). The Google
  sign-in client needs `https://ntfroster.anawj.com/__/auth/handler` in its Authorised redirect URIs.
- The installed app and Firefox on Android sign in by redirect (a popup there loses its opener); elsewhere the popup,
  with redirect when a popup is blocked. `watchUser` finishes a redirect with `getRedirectResult`.
- The old address `anawj.com/ntf-roster/` (GitHub Pages; not an authorised sign-in domain) forwards to
  ntfroster.anawj.com. A browser with a roster saved there stays and shows a "Moved" bar: Download backup, then Go
  (Restore from a backup at the new address).

## One roster at a time (19 Oct 2026)

- The owner: two rosterers share the app and don't edit each other's work. The header switch is Junior | Senior only
  (no All; `settings.pool`, per browser, defaults to junior). It applies to the whole app: grid, People, Rules,
  Priorities, checks and Fill show only the roster in view. Both rosters stay editable; the switch picks which.
- Month lock is per roster: `months[m].locks = { junior, senior }` (each '' or a time). `status` is `published` only
  when both are locked (older saves: published = both locked; `M.monthMeta`). The padlock and `store.commit` act on
  the roster in view (`lockedHit` checks only that roster's people); `lockAll`/`ensureLocked` lock both. Firestore
  allows `locks` on month and version docs (`validLocks`); cloud merge by pool keeps my roster's lock, takes theirs.
- The grid's "Senior roster" / "Junior roster" toolbar button shows the other roster below, greyed and read-only
  (`tr.ro`, `.cell-ro`, no editor); kept in the UI settings (`ui.other`).
- New people start in a group of the roster in view.
- Limit: a junior-roster check can't see who is on the senior roster, so "Baby MO needs an SRP/RP on call" only counts
  junior-roster people.
