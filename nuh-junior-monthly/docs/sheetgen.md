# NUH Junior Monthly: making the month's sheet

Part of [NOTES.md](../NOTES.md). The trial sheet generator.

## Making the month's sheet from scratch (trial, 17 Oct 2026)

Why: the month's sheet is made by hand from the master rotation sheet. The trial asks whether the whole form can be **rebuilt for any people, any number of rows and any month length, formulas included**. Answer so far: yes (proof below). Built as pure modules so the output can be written as an Excel
file or straight into a new Google Sheet:
- `js/sheetgen.js` (`buildSheet(spec)`): the layout and every formula as data. Spec: month, people (grade, name, day cells, the cell for the 1st of
  next month), holidays. Layout moves with the month length (28 to 31 days: the day block, the 1st of next month, then the right-hand
  block: days off, Fri / Sat / Sun / weekday points, R1B / C3 / OGN / OGC / S1 / S1B counts, total, approved leave) and with the
  number of people (counts under the names, then the manpower block). Lists the rosterer may want to change (`DEFAULTS`: which codes
  count, the points, the lists inside the manpower formulas, the leave bands) are data at the top. A public holiday on Mon to Thu adds the day cell
  to the Sunday points (what the sheet does by hand). Colour rules (`CODE_FILL`) make each code keep its legend colour wherever it is typed.
  Array formulas use `SUMPRODUCT(COUNTIF(range,{...}))`, which works in Excel, LibreOffice and Google without Ctrl+Shift+Enter.
- `js/sheetgen-xlsx.js` (`toWorkbook(model, ExcelJS)`): the Excel file. `js/sheetgen-gsheets.js` (`toSpreadsheetBody`) and `gsheets.js`
  `createSpreadsheet`: one Sheets API `spreadsheets.create` call with values, formulas, colours, merges, widths and colour rules (and, since
  6 Nov 2026, the other tabs and the locks: next section).
- `js/sheetgen-state.js` (`specFromState`): the app's month as a spec (people in sheet order, the sheet's own cell text, WE on weekends, PH on
  holidays, post call on the 1st). Seniors (HOD, SC, consultants) are not in the app, so their rows are not in the trial sheet.
- More › "Make this month's sheet from scratch (trial)" was replaced on 6 Nov 2026 by "Make blank month sheets" (next section).
- Proof: `tools/sheetgen-demo.mjs` writes a sheet for made-up people; recalculate it in LibreOffice and `tools/sheetgen-verify.py` checks every
  right-hand total and every count against the day cells (checked at 28, 29, 30 and 31 days and 5 to 191 people: 0 mismatches). Unit tests:
  `test/sheetgen.test.mjs`. Compared with a real month's sheet (details in the owner's private notes), almost all formulas came out identical; the differences were damage in the hand-made sheet and ranges that stopped one row short. The generated form has neither.
- Real-Google dry run: `tools/sheetgen-dryrun.mjs` builds the same request for made-up people, creates a throwaway "DRY RUN ... (delete me)" spreadsheet with an access token (`SHEETS_TOKEN`), reads it back and checks every total and count against the day cells plus the merges, colour rules and frozen corner (`--print-body` prints just the request). Its checks were run against LibreOffice's recalculation with a faked API: 647 values, 0 wrong.
- Real Google (17 Oct 2026): the dry run passed at 28, 30 and 31 days with 14 to 20 people (values, merges, colour rules, frozen corner); the red count block when a cell holds 0 matches the department sheet's own rule. An .xlsx export of a Google sheet keeps formulas (the per-row leave totals lose their `ARRAYFORMULA` wrapper but calculate the same), colours and the order of the conditional-format rules, but **loses Google protected ranges** and renames tabs with `/` or over 31 characters; Drive version history is the full record.
- Open: the leave and request cells (typed in the sheet by the juniors), the band boundaries for the leave rows, notes.

## Making blank month sheets, the whole file (6 Nov 2026)

Why: the rosterer makes each month's file by hand. More › **Make blank month sheets** makes them for a range of months (up to 12) in
one go, as the department keeps them (structure read from the department's own files; details in the owner's private notes):
- **Tabs** (`js/sheetgen-tabs.js` `buildTabs`): `Request` (the form above), `<Mon YY> Junior Call Roster` (a row per day, columns R1, R2,
  R3, S1, the obstetric pair (OGD and OGN on a working day, OGC in both on a weekend or holiday), R1B, S1B), `WR Premed Roster` (WR on
  the first day of each run of days off, P1 to P6 on its last; a lone holiday has the premeds only; `offRuns`) and `Leave Waitlist`
  (Day, Waitlist 1 to 6, the colour key, the boxed note naming the daily rosterers, a setting). Both roster tabs are only
  `IFERROR(INDEX(Request!$C$1:$C$<last>, MATCH("<code>", Request!$<day>$1:$<day>$<last>, 0), 0), "")`, Calibri 10, days off green.
- **Seniors' rows:** an import now keeps each row's grade as typed (`layout.gradeTexts`), seniors' rows too; `specFromState(state,
  month, { seniors: true })` puts the HOD, SC and consultant rows of the latest imported month on top (days: WE and PH only) and keeps
  each person's typed grade when it is one of their group's (HC stays HC). Months imported before 6 Nov have no grade texts: import
  the latest month once.
- **Locks** (`toSpreadsheetBody(..., { tabs, protect: { editors, me, open } })`): the Request tab and both roster tabs are protected for
  the rosterers (a setting: their emails); the Leave Waitlist is open. Google refuses an editors list without the person making it
  ("You can't remove yourself as an editor"), so the app adds the signed-in account (`whoAmI`, Drive `about`); with no rosterers the
  list is left out and only the maker can edit. While **open for requests** the juniors' block is unprotected: day 1 to the last day,
  from the first row below the HOD, SC and consultant rows to the last person (`requestBlock`). The list of made sheets has **Open for
  requests / Lock requests** per month (`setRequestsOpen`: one `updateProtectedRange` of `unprotectedRanges`).
- **Folder and sharing:** the sign-in now asks for `drive.file` too (only files and folders the app made). The first run makes
  "NUH junior rosters (made by the app)" in the maker's Drive (its id in that browser; made again if it is binned), shares it with
  the rosterers as editors without a Google email and, if ticked, with anyone with the link as editor (how the juniors reach the
  sheet), and moves each new sheet into it, so each sheet takes the folder's sharing. Needs the Google Drive API on the app's
  Firebase project; without it the app says so.
- The made sheets (link, block, open or locked) are kept in `settings.sheetMaker` with the team's data, so any rosterer can Open or
  Lock them; the folder is the maker's (drive.file is per person).
- Excel (Download as an Excel file): the same four tabs, one file per month; no locks (Google's protected ranges have no Excel twin).
- **Real Google (6 Nov 2026):** `tools/sheetgen-dryrun.mjs` (now with the tabs and locks, `--delete` to bin it after) passed for July
  2027 with 14 made-up people: 929 values right (totals, counts and every roster-tab lookup), merges, 55 colour rules, the frozen
  corner, the locks as made, then Lock and Open. The folder, reuse and move were checked on real Drive too (throwaway files, deleted).
  Sharing was not run against real Google (it is outward); the unit tests and e2e check the calls with a fake API.

## Starting a month from the master rotations (6 Nov 2026)

Why: the month's people and postings come from the department's master rotation sheet, which changes all year, and people can join or leave on any day. So the master is read again whenever it changes, and each read shows what it would change before anything is applied.
- `js/master.js` (pure): `parseMaster(rows, tab)` reads a year's block tab ("26-27 Block"): row 2 holds the week labels (the first week starts on the Tuesday after the change-over; the week over New Year runs to the change-over Monday, which starts the second half), column A holds the names for July to December and the second change-over column the names for January to June (MOPEX and external residents keep column A; for externals that column holds their home department). Sections give the grade (CA1 to CA3 = RES1 to RES3, SR1 / SR2 / SMO = R, fellows, MOPEX, external residents = RR, TTSH cardiac = NHG, resident physicians = RP). `mapCode` turns the master's posting text into the app's codes (`DEFAULT_MASTER_CODES`; general-list postings have no code, obstetric float weeks are counted but not set). A name twice in a half is reported and the first row is used.
- `findPerson` matches master names to People: exact, a remembered master name (`aliases` on the person), words missing, one-letter typos. `planMaster(state, master, month)` lists new people, close matches to check, grade changes (an AC is never moved back), first and last days (from the first and last weeks the master gives), SR2s to promote to AC (offered only in January and July, unticked: the master does not say), and people on People who are not in the master (unticked). `applyMaster` applies the ticked ones in one commit: postings for every day of the month (Z outside the master's weeks), calls, leave, requests and locked cells left alone.
- More › "Start a month from the master rotations": paste the master's link (read with the Sheets scope) or pick a downloaded .xlsx, choose the month, check the lists, Apply (one Undo). In a month whose sheet was imported, the master's people for that month are shown even if the sheet has no row for them yet (`M.notInSheet`). Then "Make blank month sheets" builds the sheets. Unit tests: `test/master.test.mjs` (made-up master and people). A real comparison with a hand-made month is in the owner's private notes.
- Open: seniors' rows, ACs and LOCs not in the master (carried over from People), obstetric float days.
