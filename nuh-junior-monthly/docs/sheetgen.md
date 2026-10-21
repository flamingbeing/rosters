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
  `createSpreadsheet`: one Sheets API `spreadsheets.create` call with values, formulas, colours, merges, widths and colour rules. It needs only the
  Sheets scope the app already has (a new file in the signed-in person's Drive); no Drive scope. **Untested against real Google** (no sign-in
  here): the e2e uses a fake API. Do a dry run on a throwaway sheet.
- `js/sheetgen-state.js` (`specFromState`): the app's month as a spec (people in sheet order, the sheet's own cell text, WE on weekends, PH on
  holidays, post call on the 1st). Seniors (HOD, SC, consultants) are not in the app, so their rows are not in the trial sheet.
- More › "Make this month's sheet from scratch (trial)": Download as an Excel file, and Create a new Google Sheet.
- Proof: `tools/sheetgen-demo.mjs` writes a sheet for made-up people; recalculate it in LibreOffice and `tools/sheetgen-verify.py` checks every
  right-hand total and every count against the day cells (checked at 28, 29, 30 and 31 days and 5 to 191 people: 0 mismatches). Unit tests:
  `test/sheetgen.test.mjs`. Compared with a real month's sheet (details in the owner's private notes), almost all formulas came out identical; the differences were damage in the hand-made sheet and ranges that stopped one row short. The generated form has neither.
- Real-Google dry run: `tools/sheetgen-dryrun.mjs` builds the same request for made-up people, creates a throwaway "DRY RUN ... (delete me)" spreadsheet with an access token (`SHEETS_TOKEN`), reads it back and checks every total and count against the day cells plus the merges, colour rules and frozen corner (`--print-body` prints just the request). Its checks were run against LibreOffice's recalculation with a faked API: 647 values, 0 wrong.
- Real Google (17 Oct 2026): the dry run passed at 28, 30 and 31 days with 14 to 20 people (values, merges, colour rules, frozen corner); the red count block when a cell holds 0 matches the department sheet's own rule. An .xlsx export of a Google sheet keeps formulas (the per-row leave totals lose their `ARRAYFORMULA` wrapper but calculate the same), colours and the order of the conditional-format rules, but **loses Google protected ranges** and renames tabs with `/` or over 31 characters; Drive version history is the full record.
- Open: seniors' rows (from last month's sheet or People), the leave and request cells (typed in the sheet by the juniors), the band boundaries for the leave rows, locks and the other tabs (next paragraph), carry-over from last month, notes/widths/fonts.
- **Planned, not built (details in the owner's private notes):** the department sheet's Request tab is locked by default and opened for the juniors to place requests (they reach it with the share link), the Junior Call Roster and WR / Premed Roster tabs are always locked, the Leave Waitlist tab is always open. Those two roster tabs are only `IFERROR(INDEX(Request!C:C, MATCH(code, Request!day column, 0), 0), "")` lookups, so the generator should write them as formulas. A Sheets-scope-only app cannot choose the new file's folder or its sharing (a new file lands in the signed-in person's Drive root); a shared folder passes its sharing on, so the app needs the narrow `drive.file` scope, which only sees files and folders it made or the user picked.

