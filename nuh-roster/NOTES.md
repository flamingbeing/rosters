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
| `js/app.js` | The UI. |

## Testing

- `node nuh-roster/test/engine.test.mjs`: engine, monthly, duplicates, import planning. Fake names only.
- `node nuh-roster/test/e2e.mjs` (serve the repo on port 8080 first, `python3 -m http.server 8080`; `PORT=` to change,
  `SHOTS=<dir>` for screenshots): Practice with Firebase blocked, desktop and phone. 41 checks: every tour target exists,
  the live double-cover check and its fix, changes since sent and the "Updated" stamp, keyboard focus in the person
  box, the Fix 3 problems exercise, the practice draft through Do it all, monthly clashes and Undo, axe on every tab,
  phone sizes (16px fields, 30px targets, no sideways scroll), My day (copy for logbook, My week), the welcome card.
  Runs in the Checks workflow. A signed-in flow can be tried by routing `js/cloud.js` to a fake module (see how the
  13 Oct session tested viewers and team saves).
- The demo is built for tomorrow's date, so the browser test meets a different made-up day each day. A step that
  depends on the day (free seniors, who is on leave) must not assume a fixed outcome: start from "Reset this day" and
  allow for randomness (14 Oct: Fix 3 problems failed every PR when the day was short of a senior; #491).
- Real sample files (rosters, the contact list, HMS PDFs) must stay out of the repo.
