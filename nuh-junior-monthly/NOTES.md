# NUH Junior Monthly: notes

A helper for the rosterer who does the NUH anaesthesia **monthly junior roster** in the department's Google Sheet.
The sheet (its formulas, colours and tabs) stays the source of truth: the app reads the month's grid tab, helps fill
calls with rules the rosterer can change at any time, and gives back only the day cells to paste over the same block.
Built on the NTF roster app (`ntf-roster/`: rules engine, rule builder, problem flags, auto-fill), in the NUHS design.
First job: cardiac (C3) and ICU (R1B) calls (owner, 15 Oct 2026).

Public repo: no real names, rosters or sheet extracts here. The real sheets, the analysis of two years of rosters and
the scripts that read them are in the owner's private notes.

- Address: `nuhjuniormonthly.anawj.com` (own subdomain: it keeps data), practice department at `?demo`.
- Static, vanilla ES modules, no build step. Data in this browser (`localStorage` `nuhjm-v1`; practice `nuhjm-demo`).
  Team sync code from the NTF app is there but off (no Firebase project).
- Design: the NUHS app kit (`https://design.anawj.com/v1/app.css` + `app.js`, linked after `tokens.css`, cached by `sw.js`; 15 Oct
  2026, as the NUH roster): the four-quarter band in the `.a-bar`, the kit's tab bar (bottom on phones up to 720 px, a
  strip on tablets, an icon rail at 1000–1599 px so a whole month of the grid fits beside it, the full sidebar from
  1600 px), white rounded groups on the grey ground, the kit's switch, segmented controls, sheets and toast look, phone
  font. The app scrolls inside `#main`, not the page, so `style.css` turns the kit's fixed bars into parts of the flex
  layout. One filled button per screen (Auto-fill steps back to tinted on Rules and More). Light only.

## The department's sheet (what the app reads and writes)

- One spreadsheet per month with a grid tab: a header row `S/N | Grade | Name | 1 … 30 | 1st of next month` (weekday
  names in the row above), one row per person, one code per day, then the 1st of next month (for carrying post call
  over). Below: count rows (each call should be 1 a day) and manpower totals; to the right, points and totals per
  person. The other tabs are formulas over this grid and the day cells hold values only, so pasting values back over
  them is safe. (Exact layout in the owner's private notes; the app finds the header row itself.)
- Grades: AC, R, RES3, RES2, RES1, NHG (TTSH cardiac residents), RP, HC, LOC, MOPEX, RR (rotating residents, the home
  department in brackets after the name), Fellow. Seniors (HOD, SC, C) are left alone on import.
- Codes: postings `C` cardiac (`C-e` echo week, `C-p` perfusion week: no calls), `ICU`, `CP`, `AP`, `OG1`, `OG2`, `LI`,
  `LivOT`, `AH`/`AH1–3`, out-rotations `KKH`, `TTSH`, `NTF`; calls `R1` `R2` `R3` (MO1–3), `S1`, `S1B`, `R1B` (ICU),
  `C3` (cardiac), `OGC`, `OGN`, `OGD`; `PC` post call, `PPC` the day off after an ICU post call; leave `AL SL TL MC ML PL
  HL FCL CCL NS 0.5`; requests `X` no call, `NP` no premed, `(XX)` blocked by the planner, `R` / `R__` call request;
  `Z` not on the roster; `WE`/`PH` are the date (ignored). A sheet cell shows one thing: the call wins over the posting.

## How the app models it

- **Postings** are codes of kind `posting` in each day's cell, planned by the week on the **Postings** tab (people ×
  weeks; Paste rotations takes names down and Mondays across from the rotation sheet). The grid shows the posting as
  the cell colour. Postings vary by year: edit them on People › Codes.
- **PC** is worked out (internal code `x`) the day after any `overnight` call. **PPC** is worked out two days after a
  duty marked `rest2` (R1B) when the person is still on the same posting that day (no PPC after the last Saturday of a
  posting). Both count as days off (`x` token, `@away`). PC/PPC typed on day 1–2 of an imported month (carried over from
  last month) stay as plain codes `PC` / `PPC`.
- **Import** (More): paste the whole grid tab copied from Google Sheets, or a downloaded .xlsx. A call, PC or PPC typed
  over a posting day gets the posting from the days around it. The layout and every cell's text are kept per month
  (`state.sheets[month]`). **A new grade** (16 Oct 2026): someone already on People whose Grade in the sheet belongs to
  another group (the July change-over, RES1 → RES2) moves to the end of that group on Import. The review lists each move,
  ticked; untick anyone who should stay. Only from the newest month imported so far (`latestImported`): an older month
  never moves anyone back (the review says who differs). Someone listed twice moves to the grade of the row that is kept.
- **Staff list for APMES People** (`js/apmes.js`; 16 Oct 2026): APMES People (`apmes.anawj.com/people/` › Import from
  roster) opens this app with `?send=apmes`; a sheet asks, then sends Grade, Name, From, Until for everyone in post (no
  roster, no notes) to the tab that opened it by `postMessage` (to `apmes.anawj.com` or this origin only) and closes.
  More › Export › Copy the staff list for APMES People gives the same text to paste there. The grade is the group's
  first sheet grade (RES2, R, AC…); the first line names the last month imported from the sheet. People's side:
  `people/NOTES.md`.
- **Put it back** (More): the block from day 1 of the first person row to the 1st of next month of the last row, as
  tab-separated text to paste at that top-left cell. Cells whose meaning didn't change go back exactly as typed;
  seniors' rows come back untouched; the list of changed cells is shown. Import again just before pasting if others edit.

## Roles and the rules kit (25 Oct 2026)

- Rules: edit `firestore.app.rules`, then build the committed `firestore.rules` with app-devkit's
  `tools/build-rules.mjs` (it pastes in the kit's `rules/common.rules`; the kit is pinned at `v1.4.0` in the Checks
  `rules` job, which fails on a stale build).
- Roles: the token's claim `g._` when there is one, else `members/{email}.role` (older pages, or while the Worker has no
  service account). Reads cost 1 lookup on claims (`revoked/{uid}`), 2 on the members entry. Changes to the members
  list always check the admin's entry, never the claim.
- Worker (`worker/junior.js`, this host only): `POST /api/claims` puts the role on the account (the page calls it after
  sign-in and when its entry's `v` is ahead, then refreshes its token); `POST /api/members/sync` (admins, after a change)
  writes `revoked/{uid}` for a removed or lowered member, so their older claim is refused at once. Without the secrets
  `JUNIOR_SA_EMAIL` and `JUNIOR_SA_KEY` both answer 503 and everything runs on the members entry.
- `members/{email}.v`: 1 when added, one more on each role change (rules-checked).

## Tests

`node nuh-junior-monthly/test/app.test.mjs` (rules, PPC, auto-fill, sheet round trip) and
`node nuh-junior-monthly/test/e2e.mjs` (static server on port 8080: every tab on desktop and phone, axe, Postings,
Auto-fill). Both run in the Checks workflow. Rules: `bash tools/test-rules.sh` (`test/rules.emulator.mjs`, the kit's
shared suite `test/rules.kit.emulator.mjs`, and the Worker's claims routes end to end in `worker/test/junior.emulator.mjs`),
in the Checks `rules` job.

## More detail (all public, code facts only)

- [docs/rules.md](docs/rules.md): the Rules tab, rule types, what gives way to what, rule versions.
- [docs/cloud-and-sheets.md](docs/cloud-and-sheets.md): reading and writing the Google Sheet, locking months, the cloud copy, earlier saves, roles.
- [docs/sheetgen.md](docs/sheetgen.md): making the month's sheet from scratch (trial).
- [docs/more-areas.md](docs/more-areas.md): leave waitlist, R1 to R3 calls and requests, shared-call points, Fill options, carry-over, rotations from People.
- [docs/screens.md](docs/screens.md): header, tabs, cell marks, colours, per-month grades and who is shown.

What is happening now and the owner's dated decisions are kept outside this repo.
